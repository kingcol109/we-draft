// src/utils/voice/intentsNfl.js
//
// /voice: NFL players and the Combine (2026-11-25 log: "what were Anthony
// Richardson's combine measurables", "how tall is Anthony Richardson",
// "where did Cam Newton go to college").
//   - Any player question about a name that's only an NFL draft pick
//     (compSnapshots/_draftHistory, exact name) is answered here — the engine
//     routes it (engine.js resolve → slots.nfl + the question asked).
//   - Combine numbers for anyone: compSnapshots/_combine_{year} (the Combine
//     hub's data, 2000 on) — his draft year, or a prospect's class.
import { miss } from "./reply";
import { plain } from "./text";

const WHO = "(?<who>.+?)(?:'s|s')?";
const nameKey = (s) => plain(s).replace(/\b(?:jr|sr|ii|iii|iv|v|junior|senior)\b/g, "").replace(/\s+/g, " ").trim();
const ROUND = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
const ordinal = (k) => `${k}${k % 100 > 10 && k % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"}`;
const FRACTION = { 0.25: " and a quarter", 0.5: " and a half", 0.75: " and three quarters", 0.125: " and an eighth", 0.375: " and three eighths", 0.625: " and five eighths", 0.875: " and seven eighths" };
const inches = (v) => { const w = Math.floor(v); const f = Math.round((v - w) * 1000) / 1000; return `${w}${FRACTION[f] || (f ? `.${String(f).slice(2)}` : "")}`; };
const height = (v) => `${Math.floor(v / 12)} foot ${inches(v % 12)}`;
const broad = (v) => `${Math.floor(v / 12)} foot ${Math.round(v % 12)}`;

// One Combine number, said: [label, phrase]
const METRIC = {
  height: ["Height", (v) => height(v)],
  weight: ["Weight", (v) => `${v} pounds`],
  forty: ["40-yard dash", (v) => `a ${v} forty`],
  vertical: ["Vertical", (v) => `a ${inches(v)} inch vertical`],
  broad: ["Broad jump", (v) => `a ${broad(v)} broad jump`],
  bench: ["Bench press", (v) => `${v} reps on the bench`],
  arm: ["Arm length", (v) => `${inches(v)} inch arms`],
  hand: ["Hand size", (v) => `${inches(v)} inch hands`],
  threeCone: ["3-cone", (v) => `a ${v} three cone`],
  shuttle: ["Short shuttle", (v) => `a ${v} shuttle`],
};
const METRIC_WORDS = { "40": "forty", forty: "forty", "40 yard dash": "forty", "forty yard dash": "forty", "40 time": "forty", "forty time": "forty", vertical: "vertical", "vertical jump": "vertical", vert: "vertical", "broad jump": "broad", broad: "broad", bench: "bench", "bench press": "bench", "arm length": "arm", arms: "arm", "hand size": "hand", hands: "hand", "three cone": "threeCone", "3 cone": "threeCone", shuttle: "shuttle", "short shuttle": "shuttle", wingspan: "arm" };
const METRIC_RE = "(?<metric>40 yard dash|forty yard dash|40 time|forty time|40|forty|vertical jump|vertical|vert|broad jump|broad|bench press|bench|arm length|arms|hand size|hands|three cone|3 cone|short shuttle|shuttle|wingspan)";

/** His Combine row: by slug, else exact name (+ school when known), in that year's snapshot. */
async function combineRow(ctx, year, { name, slug, school }) {
  if (!ctx.combine || !year) return null;
  const rows = await ctx.combine(year);
  return rows.find((r) => slug && r.slug === slug) || rows.find((r) => nameKey(r.name) === nameKey(name) && (!school || !r.school || plain(r.school) === plain(school))) || rows.find((r) => nameKey(r.name) === nameKey(name)) || null;
}

const measured = (res, only = null) => {
  const keys = only ? [only] : ["height", "weight", "forty", "vertical", "broad", "bench", "arm", "hand"];
  return keys.filter((k) => res?.[k] != null).map((k) => METRIC[k][1](res[k]));
};
const listed = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const NFL_INTENTS = [
  {
    id: "nfl.player",
    mode: "general",
    title: "Combine numbers (and NFL players)",
    examples: ["what were Anthony Richardson's combine measurables", "what did Kromah run in the 40", "how fast was Anthony Richardson at the combine"],
    patterns: [
      // (Plain "measurements" is player.measure; the Combine is said.)
      new RegExp(`^(?:what (?:were|are|was) |what's |whats |read me |give me |tell me |show me )?(?:the )?${WHO} (?:combine (?:measurables|measureables|measurable|measurements|numbers|results|stats|testing|times)|testing numbers|athletic testing|combine)$`),
      new RegExp(`^(?:what (?:were|are) )?(?:the )?combine (?:measurables|measureables|measurements|numbers|results) (?:for|of) (?<who>.+?)$`),
      new RegExp(`^(?:how|what) did (?<who>.+?) (?:test|do|look) at the combine$`),
      new RegExp(`^how (?:fast|quick) (?:was|is|did) (?<who>.+?)(?: run)?(?: at the combine| in the 40| in the forty)?$`),
      new RegExp(`^what did (?<who>.+?) run (?:in )?(?:the )?(?:40|forty)(?: yard dash)?(?: at the combine)?$`),
      new RegExp(`^(?:what (?:was|is) |what's |whats )?${WHO} ${METRIC_RE}(?: at the combine)?$`),
      new RegExp(`^how high did (?<who>.+?) jump(?: at the combine)?$`),
    ],
    fixed: [{}, {}, {}, { metric: "forty" }, { metric: "forty" }, {}, { metric: "vertical" }],
    accept: (s) => !s.metric || !!METRIC_WORDS[s.metric] || !!METRIC[s.metric],
    run: async ({ player, nfl, ask, field, topic, metric }, ctx) => {
      const key = metric ? METRIC_WORDS[metric] || metric : null;
      // A prospect / CFBD player: his class's Combine.
      if (!nfl) {
        const d = ctx.player ? await ctx.player(player.id).catch(() => null) : null;
        const name = `${d?.First || player.first} ${d?.Last || player.last}`.trim();
        const year = Number(d?.Eligible) || null;
        const row = year && year <= new Date().getFullYear() ? await combineRow(ctx, year, { name, slug: d?.Slug, school: d?.School }) : null;
        if (!row) return miss(`I don't have Combine numbers for ${name}${year ? ` (the ${year} class)` : ""}.`, "combine-none");
        const said = measured(row.results, key);
        if (!said.length) return miss(`${name} didn't do that at the ${year} Combine.`, "combine-metric-none");
        const speak = key ? `${name} had ${said[0]} at the ${year} Combine.` : `At the ${year} Combine, ${name} measured ${listed(said)}.`;
        return { say: speak, speak, title: name, sub: `${year} Combine`, rows: Object.entries(row.results || {}).filter(([k]) => METRIC[k]).map(([k, v]) => [METRIC[k][0], String(v)]), tone: "answer" };
      }
      // An NFL draft pick.
      const name = nfl.name;
      const row = await combineRow(ctx, nfl.year, { name, school: nfl.school });
      const res = row?.results || {};
      const drafted = `${nfl.team ? `The ${nfl.team} took him` : "He was drafted"} ${nfl.pick ? `${ordinal(nfl.pick)} overall` : `in the ${ROUND[nfl.round] || ordinal(nfl.round)} round`} in ${nfl.year}`;
      const college = nfl.school ? `${name} played college football at ${nfl.school}.` : "";
      let speak;
      const f = field || (ask === "player.field" ? "height" : null);
      if (key || ask === "nfl.player" || ask === "player.measure") {
        const said = measured(res, key);
        speak = said.length ? (key ? `${name} had ${said[0]} at the ${nfl.year} Combine.` : `At the ${nfl.year} Combine, ${name} measured ${listed(said)}.`) : `I don't have ${name}'s Combine numbers.`;
      } else if (f === "height" || f === "weight") {
        const v = res[f];
        speak = v != null ? `${name} measured ${METRIC[f][1](v)} at the ${nfl.year} Combine.` : `I don't have ${name}'s ${f}.`;
      } else if (f === "school" || ask === "player.background" || topic === "career" || topic === "hs") {
        speak = `${college} ${drafted}.`.trim();
      } else if (f === "position") {
        speak = `${name} was drafted as a ${nfl.pos}.`;
      } else {
        speak = `${college} ${drafted}${nfl.pos ? ` as a ${nfl.pos}` : ""}.${measured(res).length ? ` At the Combine he measured ${listed(measured(res).slice(0, 3))}.` : ""}`.trim();
      }
      return {
        say: speak, speak, title: name, sub: [nfl.pos, nfl.school, `${nfl.year} R${nfl.round}${nfl.pick ? ` #${nfl.pick}` : ""}`, nfl.team].filter(Boolean).join(" · "),
        rows: [["Drafted", `${nfl.year} · round ${nfl.round}${nfl.pick ? `, pick ${nfl.pick}` : ""}`], ["Team", nfl.team || "—"], ["College", nfl.school || "—"], ...Object.entries(res).filter(([k]) => METRIC[k]).map(([k, v]) => [METRIC[k][0], String(v)])],
        tone: "answer",
      };
    },
  },
];
