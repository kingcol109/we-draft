// src/utils/youtube/videoText.js
//
// A cut-up video's YouTube text (Admin → Videos → Graphics → Outline): its
// title, description (keywords, the We-Draft plug, hashtags last) and the
// pinned comment, from the player picked. Plain data in, strings out.

const POS_NAMES = {
  QB: "quarterback", RB: "running back", HB: "running back", FB: "fullback", WR: "wide receiver", TE: "tight end",
  OL: "offensive lineman", OT: "offensive tackle", T: "offensive tackle", OG: "guard", G: "guard", IOL: "interior offensive lineman", C: "center",
  DL: "defensive lineman", DT: "defensive tackle", IDL: "interior defensive lineman", NT: "nose tackle", EDGE: "edge rusher", DE: "defensive end",
  LB: "linebacker", ILB: "linebacker", OLB: "outside linebacker", MLB: "linebacker",
  DB: "defensive back", CB: "cornerback", S: "safety", FS: "safety", SS: "safety", NB: "nickel back",
  K: "kicker", P: "punter", LS: "long snapper", ATH: "athlete",
};
export const TITLE_MAX = 100;

// "#FloridaStateFootball" from "Florida State" ("Texas A&M" → "#TexasAMFootball").
export const schoolTag = (school) => {
  const s = String(school || "").replace(/[^A-Za-z0-9]/g, "");
  return s ? `#${s}Football` : "";
};

// input: { first, last, position, school, mascot, eligible (his draft class),
// slug, season ("2026"), statLine ("37 REC, 447 YDS, 6 TD"), games }.
export function cutupText(input) {
  const name = `${input.first || ""} ${input.last || ""}`.trim() || "Player";
  const pos = String(input.position || "").toUpperCase();
  const posName = POS_NAMES[pos] || pos.toLowerCase();
  const school = input.school || "";
  const season = input.season || String(new Date().getFullYear());
  const cls = input.eligible ? String(input.eligible) : "";
  const team = [school, input.mascot].filter(Boolean).join(" ");

  const title = `${name} ${season} Season Cut-Up${school || pos ? ` | ${[school, pos].filter(Boolean).join(" ")}` : ""}`;

  // The keywords are written into the sentences themselves, not listed:
  // "<name> highlights / film / <season>", "<team> football", "<school> <pos>",
  // "<cls> NFL Draft (<pos>s)", "NFL Draft prospects", "college football
  // highlights", "NFL Draft scouting", "film breakdown", "cut-up".
  const schoolPos = [school, pos].filter(Boolean).join(" ");
  const games = input.games ? `, through ${input.games} game${Number(input.games) === 1 ? "" : "s"}` : "";
  const lead = `${name} highlights and film from his ${season} season${input.statLine ? `${games} (${input.statLine})` : ""}. `
    + `This ${season} cut-up has every rep that matters from the ${schoolPos || "prospect"}, built for NFL Draft scouting and film breakdown.`;
  const who = `${name} is a${cls ? ` ${cls} NFL Draft prospect` : "n NFL Draft prospect"}${posName ? ` at ${posName}` : ""}${school ? ` for ${school}` : ""}`
    + `${team ? ` and one of the names to know in ${team} football` : ""}. `
    + `Watch the ${name} ${season} film, see how he stacks up ${cls && posName ? `against the rest of the ${cls} NFL Draft ${posName}s` : "against the rest of the class"}, then grade him yourself.`;
  const more = "New college football highlights and cut-ups of the top NFL Draft prospects every week. Subscribe so you don't miss one.";
  const url = input.slug ? `https://we-draft.com/player/${input.slug}` : "https://we-draft.com";
  const plug = [
    `📋 Evaluate ${name} and create your own draft board at We-Draft.com:`,
    url,
    "",
    "🏈 We-Draft.com is where fans scout college prospects: grade players, build big boards, run mock drafts and see how the community ranks every class.",
  ].join("\n");
  const tags = [schoolTag(school), "#NFLDraft", "#CollegeFootball"].filter(Boolean).join(" ");
  const description = [lead, who, plug, more, tags].join("\n\n");

  const comment = `Evaluate ${name} and create your own draft board at We-Draft.com`;
  return { title, description, comment };
}

// A Film Breakdown Live stream's YouTube text: same input as cutupText.
export function filmLiveText(input) {
  const name = `${input.first || ""} ${input.last || ""}`.trim() || "Player";
  const pos = String(input.position || "").toUpperCase();
  const posName = POS_NAMES[pos] || pos.toLowerCase();
  const school = input.school || "";
  const season = input.season || String(new Date().getFullYear());
  const cls = input.eligible ? String(input.eligible) : "";
  const schoolPos = [school, pos].filter(Boolean).join(" ");
  const title = `${name} Film Breakdown LIVE${schoolPos ? ` | ${schoolPos}` : ""}`;
  const games = input.games ? ` through ${input.games} game${Number(input.games) === 1 ? "" : "s"}` : "";
  const lead = `We're live breaking down ${name}'s film${schoolPos ? `, the ${schoolPos}` : ""}: the ${season} tape${input.statLine ? `${games} (${input.statLine})` : ""}, rep by rep. `
    + `What he wins with, what shows up on every snap, and where he fits ${cls ? `in the ${cls} NFL Draft` : "in the NFL Draft"}.`;
  const who = `${name} is a${cls ? ` ${cls} NFL Draft prospect` : "n NFL Draft prospect"}${posName ? ` at ${posName}` : ""}${school ? ` for ${school}` : ""}. `
    + "Drop your questions and your grade in the chat.";
  const url = input.slug ? `https://we-draft.com/player/${input.slug}` : "https://we-draft.com";
  const plug = [
    `📋 Evaluate ${name} and create your own draft board at We-Draft.com:`,
    url,
    "",
    "🏈 We-Draft.com is where fans scout college prospects: grade players, build big boards, run mock drafts and see how the community ranks every class.",
  ].join("\n");
  const more = "Live film breakdowns of the top NFL Draft prospects every week. Subscribe and turn on notifications so you catch the next one.";
  const tags = [schoolTag(school), "#NFLDraft", "#FilmBreakdown"].filter(Boolean).join(" ");
  const description = [lead, who, plug, more, tags].join("\n\n");
  const comment = `What's your grade on ${name}? Evaluate him and create your own draft board at We-Draft.com`;
  return { title, description, comment };
}

// A season's row of a table ({ cols, rows: [{ year, vals }] }) as "37 REC, 447 YDS, 6 TD".
export function statLineOf(table, season) {
  const row = table?.rows?.find((r) => r.year === season);
  if (!row) return "";
  return table.cols.map((c, i) => (row.vals[i] !== "" && row.vals[i] != null ? `${row.vals[i]} ${c}` : "")).filter(Boolean).join(", ");
}

// ── X ──
export const X_MAX = 280;
// X counts every link as 23 characters, whatever its length.
export const xLength = (s) => String(s || "").replace(/https?:\/\/\S+/g, "x".repeat(23)).length;

// The X post for a cut-up (the We-Draft outline): who and what, the stat
// line, the player's page, two hashtags. Same input as cutupText.
export function xCutupText(input) {
  const name = `${input.first || ""} ${input.last || ""}`.trim() || "Player";
  const pos = String(input.position || "").toUpperCase();
  const season = input.season || String(new Date().getFullYear());
  const who = [input.school, pos].filter(Boolean).join(" ");
  const games = input.games ? ` through ${input.games} game${Number(input.games) === 1 ? "" : "s"}` : "";
  const url = input.slug ? `https://we-draft.com/player/${input.slug}` : "https://we-draft.com";
  const lines = [
    `🎥 ${name}'s ${season} season cut-up${who ? ` | ${who}` : ""}`,
    input.statLine ? `${input.statLine}${games}` : "",
    `Evaluate ${name} and build your own draft board 👇\n${url}`,
    [schoolTag(input.school), "#NFLDraft"].filter(Boolean).join(" "),
  ].filter(Boolean);
  let post = lines.join("\n\n");
  // Over the limit: drop the stat line first, then the school tag.
  if (xLength(post) > X_MAX) post = lines.filter((l, i) => i !== 1).join("\n\n");
  return post;
}
