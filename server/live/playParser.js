// server/live/playParser.js
//
// Raw CFBD play text → a structured, display-ready `presentation` object.
// The raw text is never modified or discarded (it stays in the play's
// `text` field); this only adds a layer on top, versioned (PARSER_VERSION)
// so stored plays can be re-parsed later from their raw text alone
// (scripts/reparsePlays.js) — no re-fetching from CFBD.
//
// Built against real CFBD/ESPN-style text, e.g.
//   "(03:30) No Huddle-Shotgun #1 K.Taylor pass complete short right to
//    #3 A.Evans III caught at Bama03, for 2 yards to the Bama00 TOUCHDOWN,
//    clock 03:26 #80 K.Ferrie kick attempt good (H: #47 W.Wilkinson, ...)"
// Parsing is best-effort: anything it can't place still renders, via
// `confidence: "fallback"` + a cleaned `fallbackText`.
//
// Players: names come from the text ("#3 A.Evans III"). When the caller
// passes context, each is resolved to a CFBD athlete id — "cfbd" when CFBD
// itself linked that athlete to this play (/plays/stats, postgame), or
// "inferred" when matched by jersey/initial/last name against the team's
// CFBD roster (server/live/rosters.js). A We-Draft profile slug rides along
// only when that CFBD player has a suggested/verified link.

const PARSER_VERSION = 4; // 2: full names for identified players; 3: creditSide; 4: "St. Clair"-style surnames

// "#3 A.Evans III", "#28 C.O'Neal", "#16 J.Overton, Jr.", "#19 C.McDonald III"
const NAME = String.raw`#(\d+)\s+((?:[A-Z][A-Za-z]*\.)+\s?[A-Z][A-Za-z'’-]+(?:,?\s(?:Jr|Sr)\.?|\s(?:II|III|IV|V)\b)?)`;
const nameRe = (g = "") => new RegExp(NAME, g);

const FORMATION = /^(?:(?:No Huddle|Shotgun|Pistol|Under Center|Wildcat|Empty)[\s-]*)+/i;

// "K.Taylor" → "K. Taylor"; "J.Overton, Jr." → "J. Overton Jr."
const displayName = (raw) => raw.replace(/,(\s)/, "$1").replace(/^((?:[A-Z][A-Za-z]*\.)+)\s?/, "$1 ").replace(/\.(?=[A-Z][a-z])/g, ". ").trim();

const normLast = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

// Initial + candidate last names. "T.St. Clair" is ambiguous on its face —
// "St." could be a second initial (as in "J.J.McCarthy") or part of the
// surname ("St. Clair") — so both readings are tried against the roster.
function splitName(raw) {
  const clean = raw.replace(/,/g, "");
  const all = /^((?:[A-Z][A-Za-z]*\.)+)\s?(.+)$/.exec(clean);
  if (!all) return { initial: "", lasts: [normLast(clean)] };
  const first = /^([A-Z][A-Za-z]*\.)\s?(.+)$/.exec(clean);
  return { initial: all[1][0].toUpperCase(), lasts: [...new Set([normLast(all[2]), normLast(first[2])])] };
}

// ── Player resolution ─────────────────────────────────────────────────
// ctx: { offense: "home"|"away"|null, athletes: [{id,name}], rosters: { home: [...], away: [...] } }
// roster entry: { id, jersey, first, last, slug, status }
function resolvePlayer(token, side, ctx = {}) {
  if (!token) return null;
  const jersey = Number(token.jersey);
  const { initial, lasts } = splitName(token.raw);
  const player = { name: displayName(token.raw), jersey: Number.isFinite(jersey) ? jersey : null, side: side || null, cfbdId: null, source: null, wedraftSlug: null };
  const rosterAll = [...(ctx.rosters?.[side] || []), ...(side ? [] : [...(ctx.rosters?.home || []), ...(ctx.rosters?.away || [])])];
  const sameName = (first, lastName) => lasts.includes(normLast(lastName)) && (first || "")[0]?.toUpperCase() === initial;

  // 1. CFBD's own play ↔ athlete links (postgame /plays/stats).
  const linked = (ctx.athletes || []).filter((a) => {
    const parts = (a.name || "").split(/\s+/);
    return sameName(parts[0], parts.slice(1).join(" "));
  });
  if (linked.length === 1) {
    player.cfbdId = linked[0].id;
    player.source = "cfbd";
  } else {
    // 2. Inferred from the team roster: name, narrowed by jersey if needed.
    let hits = rosterAll.filter((r) => sameName(r.first, r.last));
    if (hits.length > 1 && player.jersey != null) hits = hits.filter((r) => r.jersey === player.jersey);
    if (!hits.length && player.jersey != null) {
      const byJersey = rosterAll.filter((r) => r.jersey === player.jersey && lasts.includes(normLast(r.last)));
      if (byJersey.length === 1) hits = byJersey;
    }
    if (hits.length === 1) {
      player.cfbdId = hits[0].id;
      player.source = "inferred";
    }
  }
  if (player.cfbdId) {
    const r = rosterAll.find((x) => x.id === player.cfbdId) || [...(ctx.rosters?.home || []), ...(ctx.rosters?.away || [])].find((x) => x.id === player.cfbdId);
    if (r?.slug && (r.status === "verified" || r.status === "suggested")) player.wedraftSlug = r.slug;
    // Full name once the player is identified ("K. Taylor" → "Kamario
    // Taylor"), from the roster or CFBD's own athlete link. The play
    // text's abbreviated form is kept as `short`.
    const full = r ? `${r.first || ""} ${r.last || ""}`.trim() : linked.length === 1 ? linked[0].name : "";
    if (full && full.includes(" ")) {
      player.short = player.name;
      player.name = full;
    }
  }
  return player;
}

const tok = (m) => (m ? { jersey: m[1], raw: m[2] } : null);
const firstName = (s) => tok(nameRe().exec(s || ""));
const allNames = (s) => [...(s || "").matchAll(nameRe("g"))].map(tok);

// ── Type ──────────────────────────────────────────────────────────────

function typeFrom(cfbdType, text) {
  const t = cfbdType || "";
  if (/^(Pass Reception|Passing Touchdown|Pass Completion)$/.test(t)) return "pass";
  if (t === "Pass Incompletion") return "incomplete";
  if (/^(Rush|Rushing Touchdown)$/.test(t)) return "rush";
  if (t === "Sack") return "sack";
  if (/Interception/.test(t)) return "interception";
  if (/^Fumble/.test(t)) return "fumble";
  if (/Field Goal/.test(t)) return "field_goal";
  if (/Punt/.test(t)) return "punt";
  if (/Kickoff/.test(t)) return "kickoff";
  if (t === "Penalty") return "penalty";
  if (t === "Safety") return "safety";
  if (/Extra Point|Two Point|2pt|PAT/.test(t)) return "conversion";
  if (t === "Timeout") return "timeout";
  if (/End Period|End of Half|End of Game|End of Regulation|Start of Period/.test(t)) return "period";
  // No (or unknown) provider type — read it from the text (scoreboard's lastPlay).
  const x = text || "";
  if (/intercepted/i.test(x)) return "interception";
  if (/fumble/i.test(x) && /recovered by/i.test(x)) return "fumble";
  if (/sacked/i.test(x)) return "sack";
  if (/pass complete/i.test(x)) return "pass";
  if (/pass incomplete/i.test(x)) return "incomplete";
  if (/\brush\b|\brun\b|scramble/i.test(x)) return "rush";
  if (/field goal/i.test(x)) return "field_goal";
  if (/\bpunt\b/i.test(x)) return "punt";
  if (/kickoff/i.test(x)) return "kickoff";
  if (/^PENALTY|PENALTY/.test(x)) return "penalty";
  if (/^Timeout/i.test(x)) return "timeout";
  if (/kick attempt|\bKICK\)?\s*$|two.point|2.?pt/i.test(x)) return "conversion";
  if (/^End of/i.test(x)) return "period";
  return "other";
}

// ── Text cleanup ──────────────────────────────────────────────────────

function clean(text) {
  let s = (text || "").trim().replace(/^\(\d{1,2}:\d{2}\)\s*/, "");
  s = s.replace(FORMATION, "").trim();
  return s;
}

// The football part of the text: drops the PAT/clock tail and anything
// after PENALTY / review notes.
function mainPart(s) {
  return s
    .split(/\sPENALTY\s|\.\s*The previous play is under/)[0]
    .replace(/,?\s*clock \d{1,2}:\d{2}.*$/i, "")
    .replace(/\s+#\d+\s+\S+\s+kick attempt.*$/i, "")
    .trim();
}

function tacklersIn(s) {
  // Last parenthetical that isn't the holder/snapper note: "(#28 C.O'Neal; #5 D.Lee Jr.)"
  const groups = [...s.matchAll(/\(([^()]*#\d+[^()]*)\)/g)].map((m) => m[1]).filter((g) => !/^H:/.test(g.trim()));
  return groups.length ? allNames(groups[groups.length - 1]) : [];
}

const yardsWord = (n) => `${n}-yard`;
const plural = (n) => `${n} yard${Math.abs(n) === 1 ? "" : "s"}`;

// ── Main ──────────────────────────────────────────────────────────────

// play: normalized play (server/live/provider.js) — uses text, type, yards,
// offense, period, clock, down, distance, scoring, bigPlay.
function presentPlay(play, ctx = {}) {
  const raw = play.text || "";
  const s = clean(raw);
  const main = mainPart(s);
  const type = typeFrom(play.type, s);
  const offense = play.offense || null;
  const defense = offense === "home" ? "away" : offense === "away" ? "home" : null;
  const c = { ...ctx, offense };
  const P = (t, side) => resolvePlayer(t, side, c);
  const td = /TOUCHDOWN/i.test(s) || /Touchdown/.test(play.type || "");
  const firstDown = /1ST DOWN/i.test(s) && !td; // redundant on a touchdown
  // Structured yards when the provider gave them; otherwise read from the
  // text ("for 7 yards gain", "for 3 yards loss", "for no gain").
  const textYards = (() => {
    if (/for no gain/i.test(s)) return 0;
    const ym = /for (\d+) yards?(?: (gain|loss))?/i.exec(s);
    return ym ? (ym[2] && ym[2].toLowerCase() === "loss" ? -Number(ym[1]) : Number(ym[1])) : null;
  })();
  const yards = Number.isFinite(play.yards) ? play.yards : textYards;
  const nullified = /NO PLAY/i.test(s);

  const out = {
    v: PARSER_VERSION,
    type,
    headline: "",
    emphasis: "normal",
    line: [],
    detail: "",
    players: {},
    yards,
    touchdown: td && !nullified,
    firstDown,
    interception: type === "interception",
    fumble: /fumble/i.test(s),
    turnover: false,
    scoring: !!play.scoring,
    penalty: /PENALTY/.test(s),
    nullified,
    confidence: "parsed",
    fallbackText: null,
  };
  const playerTok = (p) => (p ? { player: p } : null);
  const txt = (t) => ({ text: t });
  let m;

  switch (type) {
    case "pass": {
      m = new RegExp(`${NAME}\\s+pass complete.*?\\bto\\s+${NAME}`).exec(main);
      const passer = m ? P({ jersey: m[1], raw: m[2] }, offense) : P(firstName(main), offense);
      const receiver = m ? P({ jersey: m[3], raw: m[4] }, offense) : null;
      Object.assign(out.players, { passer, receiver, tacklers: td ? [] : tacklersIn(main).map((t) => P(t, defense)) });
      out.headline = td ? "TOUCHDOWN" : "PASS COMPLETE";
      out.line = receiver ? [playerTok(passer), txt("→"), playerTok(receiver)] : [playerTok(passer)].filter(Boolean);
      out.detail = td ? (yards != null ? `${yardsWord(yards)} TD pass` : "TD pass") : yards == null ? "" : yards > 0 ? plural(yards) : yards === 0 ? "No gain" : `Loss of ${plural(-yards)}`;
      if (!passer) out.confidence = "partial";
      break;
    }
    case "incomplete": {
      m = new RegExp(`${NAME}\\s+pass incomplete(?:.*?\\bto\\s+${NAME})?`).exec(main);
      const passer = m ? P({ jersey: m[1], raw: m[2] }, offense) : P(firstName(main), offense);
      const receiver = m && m[3] ? P({ jersey: m[3], raw: m[4] }, offense) : null;
      const brokenUp = /broken up by\s+#/.exec(main) ? P(firstName(main.split(/broken up by/)[1]), defense) : null;
      Object.assign(out.players, { passer, receiver, defender: brokenUp });
      out.headline = "PASS INCOMPLETE";
      out.emphasis = "muted";
      out.line = receiver ? [playerTok(passer), txt("→"), playerTok(receiver)] : [playerTok(passer)].filter(Boolean);
      out.detail = brokenUp ? `Broken up by ${brokenUp.name}` : "";
      break;
    }
    case "rush": {
      const rusher = P(firstName(main), offense);
      Object.assign(out.players, { rusher, tacklers: td ? [] : tacklersIn(main).map((t) => P(t, defense)) });
      out.headline = td ? "TOUCHDOWN" : "RUSH";
      out.line = [playerTok(rusher)].filter(Boolean);
      out.detail = td ? (yards != null ? `${yardsWord(yards)} TD run` : "TD run") : yards == null ? "" : yards > 0 ? `${yardsWord(yards)} run` : yards === 0 ? "No gain" : `Loss of ${plural(-yards)}`;
      if (!rusher) out.confidence = "partial";
      break;
    }
    case "sack": {
      const passer = P(firstName(main), offense);
      const sackers = tacklersIn(main).map((t) => P(t, defense));
      const loss = (m = /loss of (\d+) yards?/i.exec(main)) ? Number(m[1]) : yards != null ? -yards : null;
      Object.assign(out.players, { passer, sacker: sackers[0] || null, sackers });
      out.headline = "SACK";
      out.emphasis = "negative";
      out.line = sackers.length
        ? [...sackers.flatMap((p, i) => (i ? [txt("&"), playerTok(p)] : [playerTok(p)])), txt(sackers.length > 1 ? "sack" : "sacks"), playerTok(passer)].filter(Boolean)
        : [playerTok(passer), txt("sacked")].filter(Boolean);
      out.detail = loss != null ? `-${plural(loss)}` : "";
      if (/fumble by/i.test(main)) { out.fumble = true; out.detail += out.detail ? " · Fumble" : "Fumble"; }
      break;
    }
    case "interception": {
      m = new RegExp(`${NAME}\\s+pass intercepted by\\s+${NAME}`).exec(main);
      const passer = m ? P({ jersey: m[1], raw: m[2] }, offense) : null;
      const interceptor = m ? P({ jersey: m[3], raw: m[4] }, defense) : null;
      const ret = (m = /return (\d+) yards?/i.exec(main)) ? Number(m[1]) : null;
      Object.assign(out.players, { passer, interceptor });
      out.turnover = true;
      out.headline = td ? "PICK-SIX" : "INTERCEPTION";
      out.emphasis = td ? "td" : "turnover";
      out.line = interceptor ? [playerTok(interceptor), txt("intercepts"), playerTok(passer)].filter(Boolean) : [playerTok(passer)].filter(Boolean);
      out.detail = td ? `${yardsWord(ret ?? 0)} interception return TD` : ret ? `Returned ${plural(ret)}` : "";
      if (!interceptor) out.confidence = "partial";
      break;
    }
    case "fumble": {
      const fm = new RegExp(`(?:fumbled|fumble) by\\s+${NAME}`).exec(main);
      const fumbler = fm ? P({ jersey: fm[1], raw: fm[2] }, offense) : P(firstName(main), offense);
      const rm = new RegExp(`recovered by\\s+(\\S+)\\s+${NAME}`).exec(main);
      const lost = /Opponent|Return Touchdown/.test(play.type || "") || (play.type == null && false);
      const recoverer = rm ? P({ jersey: rm[2], raw: rm[3] }, lost ? defense : offense) : null;
      const forced = /forced by\s+#/.test(main) ? P(firstName(main.split(/forced by/)[1]), defense) : null;
      Object.assign(out.players, { fumbler, recoverer, forcedBy: forced });
      out.fumble = true;
      out.turnover = lost;
      out.headline = td ? "FUMBLE RETURN TD" : lost ? "FUMBLE LOST" : "FUMBLE";
      out.emphasis = td ? "td" : lost ? "turnover" : "negative";
      out.line = [playerTok(fumbler), txt("fumbles")].filter(Boolean);
      out.detail = recoverer ? `Recovered by ${recoverer.name}` : "";
      if (!fumbler) out.confidence = "partial";
      break;
    }
    case "field_goal": {
      const kicker = P(firstName(main), offense);
      const dist = (m = /from (\d+) yards?/i.exec(main)) ? Number(m[1]) : null;
      const good = /\bGOOD\b/.test(main) && !/NO GOOD/.test(main);
      const blocked = /BLOCKED/i.test(main) || /Blocked/.test(play.type || "");
      Object.assign(out.players, { kicker });
      out.headline = good ? "FIELD GOAL" : blocked ? "FG BLOCKED" : "FG MISSED";
      out.emphasis = good ? "score" : "negative";
      out.line = [playerTok(kicker)].filter(Boolean);
      out.detail = dist ? `${yardsWord(dist)} field goal${good ? "" : blocked ? " blocked" : " no good"}` : "";
      out.yards = dist;
      break;
    }
    case "punt": {
      const punter = P(firstName(main), offense);
      const dist = (m = /punt (\d+) yards?/i.exec(main)) ? Number(m[1]) : null;
      const rt = new RegExp(`${NAME}\\s+return (\\d+) yards?`).exec(main);
      const fc = new RegExp(`fair catch by\\s+${NAME}`).exec(main);
      const returner = rt ? P({ jersey: rt[1], raw: rt[2] }, defense) : fc ? P({ jersey: fc[1], raw: fc[2] }, defense) : null;
      Object.assign(out.players, { punter, returner });
      out.headline = td ? "PUNT RETURN TD" : /muffed/i.test(main) ? "MUFFED PUNT" : "PUNT";
      out.emphasis = td ? "td" : /muffed/i.test(main) ? "turnover" : "muted";
      out.line = [playerTok(punter)].filter(Boolean);
      out.detail = [dist ? `${yardsWord(dist)} punt` : "", rt ? `${returner?.name} return ${plural(Number(rt[3]))}` : fc ? `Fair catch by ${returner?.name}` : /touchback/i.test(main) ? "Touchback" : ""].filter(Boolean).join(" · ");
      break;
    }
    case "kickoff": {
      const kicker = P(firstName(main), offense);
      const rt = new RegExp(`${NAME}\\s+return (\\d+) yards?`).exec(main);
      const returner = rt ? P({ jersey: rt[1], raw: rt[2] }, defense) : null;
      Object.assign(out.players, { kicker, returner });
      out.headline = td ? "KICK RETURN TD" : "KICKOFF";
      out.emphasis = td ? "td" : "muted";
      out.line = td && returner ? [playerTok(returner)] : [playerTok(kicker)].filter(Boolean);
      out.detail = td ? `${yardsWord(Number(rt[3]))} return TD` : rt ? `${returner?.name} return ${plural(Number(rt[3]))}` : /touchback/i.test(main) ? "Touchback" : "";
      break;
    }
    case "penalty": {
      const pm = /PENALTY\s+(\S+)\s+(.+?)(?:\s+\((#\d+[^)]*)\))?\s+(\d+)\s+yards?/.exec(s);
      const declined = /declined/i.exec(s);
      const who = pm?.[3] ? P(firstName(pm[3]), null) : null;
      Object.assign(out.players, { penalized: who });
      out.headline = "PENALTY";
      out.emphasis = "negative";
      out.line = who ? [playerTok(who)] : [];
      out.detail = pm ? `${pm[1]} ${pm[2].replace(/\s+on\s*$/, "")} · ${plural(Number(pm[4]))}${nullified ? " · No play" : ""}` : declined ? "Declined" : "";
      if (!pm && !declined) { out.confidence = "fallback"; out.fallbackText = s; }
      out.teamPenalty = !who;
      break;
    }
    case "safety": {
      const tackler = (m = new RegExp(`${NAME}\\s+SAFETY`).exec(s)) ? P({ jersey: m[1], raw: m[2] }, defense) : null;
      Object.assign(out.players, { tackler });
      out.headline = "SAFETY";
      out.emphasis = "score";
      out.line = tackler ? [playerTok(tackler)] : [];
      out.detail = "2 points";
      break;
    }
    case "conversion": {
      // "(P. Woodring KICK)", "#80 K.Ferrie kick attempt good", "TWO-POINT CONVERSION ATTEMPT ..."
      const two = /two.point|2.?pt/i.test(s) || /Two Point|2pt/.test(play.type || "");
      const loose = /^\(?([A-Z]\.\s?[A-Z][A-Za-z'’-]+)\s+KICK\)?/i.exec(s);
      const kicker = firstName(s) ? P(firstName(s), offense) : loose ? P({ jersey: null, raw: loose[1] }, offense) : null;
      const failed = /no good|missed|failed|blocked/i.test(s) || /Missed|Blocked/.test(play.type || "");
      Object.assign(out.players, { kicker });
      out.headline = two ? "2-PT CONVERSION" : "EXTRA POINT";
      out.emphasis = failed ? "negative" : "muted";
      out.line = kicker && !two ? [playerTok(kicker)] : [];
      out.detail = failed ? (two ? "Failed" : "No good") : "Good";
      break;
    }
    case "timeout": {
      m = /Timeout\s+(.+?),/i.exec(s);
      out.headline = "TIMEOUT";
      out.emphasis = "muted";
      out.detail = m ? m[1] : "";
      break;
    }
    case "period": {
      m = /End of (\d)(?:st|nd|rd|th) quarter/i.exec(s);
      out.headline = m ? `END OF Q${m[1]}` : /half/i.test(s) ? "HALFTIME" : (play.type || "END OF PERIOD").toUpperCase();
      out.emphasis = "muted";
      break;
    }
    default: {
      out.headline = (play.type && play.type !== "Unknown" ? play.type : "PLAY").toUpperCase();
      out.line = [playerTok(P(firstName(main), offense))].filter(Boolean);
      out.confidence = "fallback";
      out.fallbackText = main || s;
    }
  }

  // Which team the play is credited to (the badge shown on it): the
  // defense for sacks, interceptions, recovered fumbles, safeties, blocked
  // field goals and return TDs; otherwise the team with the ball.
  const defensive = type === "sack" || type === "interception" || type === "safety"
    || (type === "fumble" && out.turnover)
    || (type === "field_goal" && /BLOCKED/i.test(main))
    || ((type === "punt" || type === "kickoff") && td);
  out.creditSide = defensive ? defense : offense;

  // Penalty on an otherwise-parsed play: note it, don't lose it.
  if (type !== "penalty" && out.penalty) {
    const pm = /PENALTY\s+(\S+)\s+(.+?)(?:\s+\(#|\s+\d+\s+yards?|$)/.exec(s);
    if (pm) out.penaltyText = `${pm[1]} ${pm[2]}`.trim();
  }
  if (out.touchdown && out.emphasis === "normal") out.emphasis = "td";
  if (out.emphasis === "normal" && play.bigPlay?.priority >= 2) out.emphasis = "big";
  // No individual named (team kneel, team penalty): show the team instead.
  if (out.line.length === 0 && play.offenseName && (type === "rush" || type === "pass" || type === "sack")) out.line = [txt(play.offenseName)];
  if (out.line.length === 0 && !["timeout", "period", "penalty"].includes(type) && out.confidence === "parsed") out.confidence = "partial";
  if (out.confidence !== "parsed" && !out.fallbackText) out.fallbackText = main || s;
  // Drop empty roles so the stored doc stays lean.
  out.players = Object.fromEntries(Object.entries(out.players).filter(([, v]) => v && (!Array.isArray(v) || v.length)));
  return out;
}

// Every resolved player on a presentation (for follow/My Players matching).
const presentationAthleteIds = (pres) => {
  const ids = new Set();
  for (const v of Object.values(pres?.players || {})) {
    for (const p of Array.isArray(v) ? v : [v]) if (p?.cfbdId) ids.add(p.cfbdId);
  }
  return [...ids];
};

module.exports = { PARSER_VERSION, presentPlay, presentationAthleteIds, typeFrom };
