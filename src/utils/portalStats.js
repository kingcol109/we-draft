// src/utils/portalStats.js
//
// Season stats for the public Transfer Portal's position Stats view
// (pages/TransferPortal.jsx — /portal/qb?view=stats). Pure (no Firebase):
// the snapshot builder (server/portal/public.js) packs each portal player's
// CFBD season stats (cfbRosters players[].s — { category: { statType: n } })
// with packStats, into compSnapshots/_portal_stats(_n):
//   { season (the stats' season), part, parts, rows: { [poolId]: packed } }
// packed: only the non-zero fields below, by short key ({ py: 3120, pt: 28 }).
// The page reads it only when the Stats view opens (portalData.js
// fetchPortalStats) and lays it out with STAT_COLUMNS.

// [short key, CFBD category, CFBD statType]
export const STAT_FIELDS = [
  ["pc", "passing", "COMPLETIONS"], ["pa", "passing", "ATT"], ["py", "passing", "YDS"], ["pt", "passing", "TD"], ["pi", "passing", "INT"],
  ["rc", "rushing", "CAR"], ["ry", "rushing", "YDS"], ["rt", "rushing", "TD"],
  ["re", "receiving", "REC"], ["wy", "receiving", "YDS"], ["wt", "receiving", "TD"],
  ["tk", "defensive", "TOT"], ["tf", "defensive", "TFL"], ["sk", "defensive", "SACKS"], ["qh", "defensive", "QB HUR"], ["pd", "defensive", "PD"],
  ["in", "interceptions", "INT"],
  ["fm", "kicking", "FGM"], ["fa", "kicking", "FGA"], ["fl", "kicking", "LONG"], ["xm", "kicking", "XPM"], ["xa", "kicking", "XPA"],
  ["pn", "punting", "NO"], ["pv", "punting", "YPP"], ["p2", "punting", "In 20"], ["pl", "punting", "LONG"],
];

export function packStats(s) {
  if (!s) return null;
  const out = {};
  STAT_FIELDS.forEach(([k, cat, type]) => {
    const v = Number(s[cat]?.[type]);
    if (v) out[k] = Math.round(v * 10) / 10;
  });
  return Object.keys(out).length ? out : null;
}

const n = (x) => Number(x) || 0;
const ratio = (a, b, digits = 1) => (n(b) ? (n(a) / n(b)).toFixed(digits) : "");
const pct = (a, b) => (n(b) ? `${((n(a) / n(b)) * 100).toFixed(1)}` : "");

// One column: [label, title, value(packed) → number | string, sort value?]
const col = (label, title, value, sort) => ({ label, title, value, sort: sort || ((x) => Number(value(x)) || 0) });
const DEFENSE = [
  col("TKL", "Total tackles", (x) => n(x.tk)),
  col("TFL", "Tackles for loss", (x) => n(x.tf)),
  col("SCK", "Sacks", (x) => n(x.sk)),
  col("QBH", "QB hurries", (x) => n(x.qh)),
  col("PD", "Passes defended", (x) => n(x.pd)),
  col("INT", "Interceptions", (x) => n(x.in)),
];
const RECEIVING = [
  col("REC", "Receptions", (x) => n(x.re)),
  col("YDS", "Receiving yards", (x) => n(x.wy)),
  col("AVG", "Yards per catch", (x) => ratio(x.wy, x.re)),
  col("TD", "Receiving touchdowns", (x) => n(x.wt)),
];

// The columns each position's Stats view shows. OL: none (CFBD keeps no
// individual stats for linemen) — the page hides the Stats view there.
export const STAT_COLUMNS = {
  QB: [
    col("CMP/ATT", "Completions / attempts", (x) => (n(x.pa) ? `${n(x.pc)}/${n(x.pa)}` : 0), (x) => n(x.pc)),
    col("PCT", "Completion percentage", (x) => pct(x.pc, x.pa)),
    col("YDS", "Passing yards", (x) => n(x.py)),
    col("TD", "Passing touchdowns", (x) => n(x.pt)),
    col("INT", "Interceptions thrown", (x) => n(x.pi)),
    col("RUSH", "Rushing yards", (x) => n(x.ry)),
    col("R TD", "Rushing touchdowns", (x) => n(x.rt)),
  ],
  RB: [
    col("CAR", "Carries", (x) => n(x.rc)),
    col("YDS", "Rushing yards", (x) => n(x.ry)),
    col("YPC", "Yards per carry", (x) => ratio(x.ry, x.rc)),
    col("TD", "Rushing touchdowns", (x) => n(x.rt)),
    col("REC", "Receptions", (x) => n(x.re)),
    col("REC YDS", "Receiving yards", (x) => n(x.wy)),
    col("REC TD", "Receiving touchdowns", (x) => n(x.wt)),
  ],
  WR: RECEIVING,
  TE: RECEIVING,
  EDGE: DEFENSE,
  DL: DEFENSE,
  LB: DEFENSE,
  DB: DEFENSE,
  K: [
    col("FG", "Field goals made / attempted", (x) => (n(x.fa) ? `${n(x.fm)}/${n(x.fa)}` : 0), (x) => n(x.fm)),
    col("PCT", "Field goal percentage", (x) => pct(x.fm, x.fa)),
    col("LONG", "Longest field goal", (x) => n(x.fl)),
    col("XP", "Extra points made / attempted", (x) => (n(x.xa) ? `${n(x.xm)}/${n(x.xa)}` : 0), (x) => n(x.xm)),
  ],
  P: [
    col("PUNTS", "Punts", (x) => n(x.pn)),
    col("AVG", "Yards per punt", (x) => (n(x.pv) ? n(x.pv).toFixed(1) : "")),
    col("IN 20", "Punts inside the 20", (x) => n(x.p2)),
    col("LONG", "Longest punt", (x) => n(x.pl)),
  ],
};
