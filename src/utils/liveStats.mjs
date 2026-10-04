// src/utils/liveStats.mjs
//
// Game stats computed from the play-by-play (each play's `presentation`,
// see server/live/playParser.js) — what /live's Stats tab shows while a
// game is in progress, and the team side of it after (player lines switch
// to CFBD's official box score once the game is final and it's ingested).
//
// Shared by both sides — that's why it's .mjs with no imports: the
// ingester (server/live/ingest.js, CommonJS) loads it with import() and
// writes the result to liveGames/{id}/box/live after every play update, so
// viewers read one small doc instead of the whole play list. The frontend
// only computes it itself for older games stored before that doc existed.
// Plays wiped out by a penalty (NO PLAY) count only as the penalty.
// College convention (matches CFBD's box score): a sack is a rushing
// attempt for the QB and its loss comes off rushing yards.

const other = (side) => (side === "home" ? "away" : side === "away" ? "home" : null);

const emptyTeam = () => ({
  plays: 0, passAtt: 0, passCmp: 0, passYds: 0, rushAtt: 0, rushYds: 0,
  sacked: 0, sackYds: 0, firstDowns: 0, third: [0, 0], fourth: [0, 0],
  turnovers: 0, penalties: 0, penaltyYds: 0, tds: 0, fgMade: 0, fgAtt: 0,
});

const SCRIMMAGE = new Set(["pass", "incomplete", "rush", "sack", "interception", "fumble"]);

// Players are keyed by CFBD id when the parser identified them, else by
// name + side; each line remembers the We-Draft slug for linking.
function playerLine(map, p, side) {
  const key = p.cfbdId || `${side}|${p.name}`;
  if (!map.has(key)) map.set(key, { key, name: p.name, short: p.short || p.name, side: p.side || side, slug: p.wedraftSlug || null, stats: {} });
  return map.get(key);
}
const add = (line, cat, field, n = 1) => {
  const c = (line.stats[cat] ||= {});
  c[field] = (c[field] || 0) + n;
};
const maxOf = (line, cat, field, n) => {
  const c = (line.stats[cat] ||= {});
  c[field] = Math.max(c[field] || 0, n);
};
const penYards = (text) => { const m = /(\d+) yards?/.exec(text || ""); return m ? Number(m[1]) : 0; };

export function computeGameStats(plays) {
  const teams = { home: emptyTeam(), away: emptyTeam() };
  const players = new Map();

  for (const p of plays) {
    const pr = p.presentation;
    if (!pr || p.hidden || p.removed) continue;
    const off = p.offense;
    const def = other(off);
    const t = pr.type;
    const P = pr.players || {};

    // Penalties: the play itself, or a flag on another play.
    if (t === "penalty" && !/declined|offsetting/i.test(pr.detail || "")) {
      const side = pr.creditSide || off;
      if (teams[side]) { teams[side].penalties++; teams[side].penaltyYds += penYards(pr.detail); }
    } else if (pr.penaltyText && !/declined|offsetting/i.test(pr.penaltyText)) {
      const side = pr.penaltyTextSide;
      if (teams[side]) { teams[side].penalties++; teams[side].penaltyYds += penYards(pr.penaltyText); }
    }
    if (pr.nullified || !teams[off]) continue;
    const T = teams[off];
    const yards = Number.isFinite(pr.yards) ? pr.yards : 0;

    if (SCRIMMAGE.has(t)) {
      T.plays++;
      if (p.down === 3 || p.down === 4) {
        const rec = p.down === 3 ? T.third : T.fourth;
        rec[1]++;
        if (pr.firstDown || pr.touchdown) rec[0]++;
      }
      if (pr.firstDown || (pr.touchdown && t !== "interception" && t !== "fumble")) T.firstDowns++;
    }
    if (pr.touchdown) {
      const scorer = pr.creditSide || off;
      if (teams[scorer]) teams[scorer].tds++;
    }

    switch (t) {
      case "pass": {
        T.passAtt++; T.passCmp++; T.passYds += yards;
        if (P.passer) { const l = playerLine(players, P.passer, off); add(l, "passing", "att"); add(l, "passing", "cmp"); add(l, "passing", "yds", yards); if (pr.touchdown) add(l, "passing", "td"); }
        if (P.receiver) { const l = playerLine(players, P.receiver, off); add(l, "receiving", "rec"); add(l, "receiving", "yds", yards); maxOf(l, "receiving", "long", yards); if (pr.touchdown) add(l, "receiving", "td"); }
        break;
      }
      case "incomplete":
        T.passAtt++;
        if (P.passer) add(playerLine(players, P.passer, off), "passing", "att");
        break;
      case "interception":
        T.passAtt++; T.turnovers++;
        if (P.passer) { const l = playerLine(players, P.passer, off); add(l, "passing", "att"); add(l, "passing", "int"); }
        if (P.interceptor) add(playerLine(players, P.interceptor, def), "defense", "int");
        break;
      case "rush": {
        T.rushAtt++; T.rushYds += yards;
        if (P.rusher) { const l = playerLine(players, P.rusher, off); add(l, "rushing", "car"); add(l, "rushing", "yds", yards); maxOf(l, "rushing", "long", yards); if (pr.touchdown) add(l, "rushing", "td"); }
        break;
      }
      case "sack": {
        const loss = Math.abs(yards);
        T.sacked++; T.sackYds += loss;
        T.rushAtt++; T.rushYds -= loss;
        if (P.passer) { const l = playerLine(players, P.passer, off); add(l, "rushing", "car"); add(l, "rushing", "yds", -loss); }
        const sackers = P.sackers || (P.sacker ? [P.sacker] : []);
        sackers.forEach((s) => add(playerLine(players, s, def), "defense", "sacks", 1 / sackers.length));
        break;
      }
      case "fumble":
        // A run that ended in a fumble still counts as a run.
        if (/\brush\b/i.test(p.text || "") && P.fumbler) {
          T.rushAtt++; T.rushYds += yards;
          const l = playerLine(players, P.fumbler, off); add(l, "rushing", "car"); add(l, "rushing", "yds", yards);
        }
        if (pr.turnover) {
          T.turnovers++;
          if (P.recoverer) add(playerLine(players, P.recoverer, def), "defense", "fr");
        }
        if (P.forcedBy) add(playerLine(players, P.forcedBy, def), "defense", "ff");
        break;
      case "field_goal":
        T.fgAtt++;
        if (/^FIELD GOAL$/.test(pr.headline || "")) T.fgMade++;
        break;
      default:
        break;
    }
  }

  for (const T of Object.values(teams)) {
    T.totalYds = T.passYds + T.rushYds;
    T.ypp = T.plays ? T.totalYds / T.plays : 0;
  }
  const bySide = { home: [], away: [] };
  for (const l of players.values()) if (bySide[l.side]) bySide[l.side].push(l);
  return { teams, players: bySide };
}

// CFBD's official box score (liveGames/{id}/box/players) in the same
// per-side player-line shape.
export function boxPlayers(box) {
  const out = { home: [], away: [] };
  for (const t of box?.teams || []) {
    for (const p of t.players || []) {
      const s = p.stats || {};
      const num = (v) => (v == null || v === "" ? 0 : Number(String(v).split("/")[0]) || 0);
      const stats = {};
      if (s.passing) {
        const [cmp, att] = String(s.passing["C/ATT"] || "0/0").split("/").map(Number);
        stats.passing = { cmp, att, yds: num(s.passing.YDS), td: num(s.passing.TD), int: num(s.passing.INT) };
      }
      if (s.rushing) stats.rushing = { car: num(s.rushing.CAR), yds: num(s.rushing.YDS), td: num(s.rushing.TD), long: num(s.rushing.LONG) };
      if (s.receiving) stats.receiving = { rec: num(s.receiving.REC), yds: num(s.receiving.YDS), td: num(s.receiving.TD), long: num(s.receiving.LONG) };
      if (s.defensive || s.interceptions) {
        stats.defense = {
          tot: num(s.defensive?.TOT), sacks: num(s.defensive?.SACKS), tfl: num(s.defensive?.TFL),
          pd: num(s.defensive?.PD), int: num(s.interceptions?.INT),
        };
      }
      out[t.side]?.push({ key: p.id, name: p.name, short: p.name, side: t.side, slug: p.wedraftSlug || null, stats });
    }
  }
  return out;
}

// ── Top performances ──
// Ranking value per category: yards for passing / rushing / receiving; for
// defense (the play-by-play has no tackles) an impact score — interceptions
// 3, sacks / forced fumbles / recoveries 2.
export const LEADER_CATS = ["passing", "rushing", "receiving", "defense"];
const leaderValue = {
  passing: (s) => (s.att ? s.yds || 0 : 0),
  rushing: (s) => (s.car ? s.yds || 0 : 0),
  receiving: (s) => (s.rec ? s.yds || 0 : 0),
  defense: (s) => (s.sacks || 0) * 2 + (s.int || 0) * 3 + (s.ff || 0) * 2 + (s.fr || 0) * 2,
};

// One game's best lines per category ({ passing: [{ id, name, slug, side,
// stats, v }], ... }) — kept on the game doc (statLeaders) by the ingester,
// which merges every game's into liveSlate/performances.
export function gameLeaders(stats, n = 5) {
  const out = {};
  for (const cat of LEADER_CATS) {
    out[cat] = ["home", "away"]
      .flatMap((side) => (stats.players?.[side] || []).filter((l) => l.stats[cat]).map((l) => ({
        id: l.key, name: l.name, slug: l.slug || null, side, stats: l.stats[cat], v: leaderValue[cat](l.stats[cat]),
      })))
      .filter((e) => e.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, n);
  }
  return out;
}

const n1 = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
// One category's line, e.g. "24/31 · 312 YDS · 3 TD · 1 INT". Empty when
// there's nothing to show.
export function statLine(cat, s) {
  if (!s) return "";
  const parts = {
    passing: () => (s.att ? [`${s.cmp || 0}/${s.att}`, `${s.yds || 0} YDS`, s.td && `${s.td} TD`, s.int && `${s.int} INT`] : []),
    rushing: () => (s.car ? [`${s.car} CAR`, `${s.yds || 0} YDS`, s.td && `${s.td} TD`, s.long > 0 && `LONG ${s.long}`] : []),
    receiving: () => (s.rec ? [`${s.rec} REC`, `${s.yds || 0} YDS`, s.td && `${s.td} TD`, s.long > 0 && `LONG ${s.long}`] : []),
    defense: () => [s.sacks && `${n1(s.sacks)} SACK${s.sacks === 1 ? "" : "S"}`, s.int && `${s.int} INT`, s.ff && `${s.ff} FF`, s.fr && `${s.fr} FR`],
  }[cat];
  return parts ? parts().filter(Boolean).join(" · ") : "";
}
