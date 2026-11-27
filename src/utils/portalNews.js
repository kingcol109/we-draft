// src/utils/portalNews.js
//
// Portal News: /portal/news (pages/PortalNews.jsx) — the Transfer Portal's
// editorial companion, like the Draft Risers are the draft's. The live
// portal (/portal) has every entry; this page picks the ones worth writing
// about, in two sections:
//   Entered     notable players who just entered (still uncommitted)
//   Committed   players who've picked their new school
// Each player gets his graphic (utils/instagram/transfer.js — the portal
// cover, or the transfer cover in its "welcome" / "classic" design, drawn
// from one of his action shots placed for First Pick), a flip card with his
// scouting report on the back, the admin's write-up and his season stats.
//
// One doc:
//   portalNews/current {
//     entries: [Entry], updatedAt
//   }
//   Entry = {
//     id (players doc id), slug, first, last, pos,       — copied from the
//                                    players doc when the admin adds him
//     status: "entered" | "committed",
//     from: school he left, to: school he picked ("" while entered),
//     date: "YYYY-MM-DD" — the day he entered, or committed,
//     note: the admin's write-up,
//     stats: [{ key: "passing.YDS", label, value, season }] — his CFBD season
//            line (public numbers, never PFF), as utils/risers.js picks them,
//     shot: url — the placed action shot his graphic uses (else his first),
//     design: "welcome" | "classic" — a committed player's graphic,
//     destinations: [school, …] (up to 3) — an entered player's potential
//            landing spots, shown in place of his stats on the page,
//     prediction: one of them — We-Draft.com's pick ("" for none),
//     projected: true — (entered only) he ISN'T in the portal yet: the admin
//            expects him to enter. He sits in the IN list, in its one order,
//            but is labeled PROJECTED everywhere (pill, card back, graphic
//            headline), never "in the portal"; the admin drops them in bulk
//            once the real portal fills up, or flips one to Entered when he goes in.
//     order: 0… within its section, addedAt (ms),
//   }
// No doc yet (the admin hasn't published one): on localhost, or with
// ?sim=1, the page shows the simulation (utils/portalNewsSim.js) under a
// SIMULATED banner, so the design can be seen; on the live site, nothing.
export const PORTAL_NEWS_PATH = "/portal/news";
export const PORTAL_NEWS_DOC = ["portalNews", "current"];
export const MAX_DESTINATIONS = 3;

// The position filters, each its own page: /portal/news/qb … (the live
// portal's own groups, /portal/qb). A player's listed position → its group.
export const NEWS_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB"];
export const NEWS_POSITION_NAMES = {
  QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OL: "Offensive Line",
  EDGE: "Edge Rusher", DL: "Defensive Line", LB: "Linebacker", DB: "Defensive Back",
};
// Spelled out for titles (user, 2026-11-19: "Quarterbacks", not "QBs"): the
// players, plural, and one of them.
export const NEWS_POSITION_PLURAL = {
  QB: "Quarterbacks", RB: "Running Backs", WR: "Wide Receivers", TE: "Tight Ends", OL: "Offensive Linemen",
  EDGE: "Edge Rushers", DL: "Defensive Linemen", LB: "Linebackers", DB: "Defensive Backs",
};
export const NEWS_POSITION_PERSON = {
  QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OL: "Offensive Lineman",
  EDGE: "Edge Rusher", DL: "Defensive Lineman", LB: "Linebacker", DB: "Defensive Back",
};
const POS_GROUP = { FB: "RB", OT: "OL", OG: "OL", IOL: "OL", C: "OL", G: "OL", T: "OL", DT: "DL", NT: "DL", DE: "EDGE", ILB: "LB", OLB: "LB", CB: "DB", S: "DB", SAF: "DB", FS: "DB", SS: "DB", NB: "DB" };
export const newsPosGroup = (pos) => { const p = String(pos || "").toUpperCase(); return POS_GROUP[p] || p; };
// "qb" → "QB" (null when it isn't one of the filters).
export const newsPosFromSlug = (slug) => { const p = String(slug || "").toUpperCase(); return NEWS_POSITIONS.includes(p) ? p : null; };
// IN (in the portal) and OUT (committed): each a page of its own too —
// /portal/news/in, /portal/news/qb/out.
export const NEWS_SIDES = ["in", "out"];
export const newsPath = (pos = "", side = "") => `${PORTAL_NEWS_PATH}${pos ? `/${pos.toLowerCase()}` : ""}${NEWS_SIDES.includes(side) ? `/${side}` : ""}`;

export const NEWS_STATUS = {
  entered: { key: "entered", label: "In the Portal", short: "ENTERED", section: "In the Portal", c1: "#f6a21d", c2: "#ffd36b", ink: "#9a5b00", tint: "#fff6e3" },
  // Not a section of its own: a projected player is an "entered" entry with
  // projected: true (see above) — this is just how he's labeled.
  projected: { key: "projected", label: "Projected to Enter", short: "PROJECTED", section: "In the Portal", c1: "#7c5cd6", c2: "#b9a6f2", ink: "#5b3fb5", tint: "#f3effe" },
  committed: { key: "committed", label: "Committed", short: "COMMITTED", section: "Committed", c1: "#16a34a", c2: "#4ade80", ink: "#15803d", tint: "#ecfbf1" },
};

// Projected to enter the portal (not in it yet) — see the Entry notes above.
export const isProjected = (e) => e?.status === "entered" && !!e.projected;
// His label: projected, entered or committed.
export const newsStatusOf = (e) => NEWS_STATUS[isProjected(e) ? "projected" : e?.status] || NEWS_STATUS.entered;
// His graphic's headline (in place of IN THE PORTAL): "" for the default.
export const PROJECTED_HEADLINE = "PROJECTED TO ENTER";
export const newsHeadlineOf = (e) => (isProjected(e) ? PROJECTED_HEADLINE : "");

// His seasons of eligibility left for the season the portal feeds
// (utils/eligibility.js seasonsLeft — the portal board's ELIG): "3 years of
// eligibility", "~2 years of eligibility" (estimated), "" when unknown.
export function eligibilityText(player, seasonsLeft) {
  const left = player ? seasonsLeft(player) : null;
  if (!left) return "";
  if (!left.n) return "No eligibility left";
  return `${left.est ? "~" : ""}${left.n} year${left.n === 1 ? "" : "s"} of eligibility`;
}

// A section's entries, in the admin's order (then newest first).
export function newsSection(entries, status) {
  return (entries || []).filter((e) => e.status === status)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(b.date || "").localeCompare(String(a.date || "")) || (b.addedAt ?? 0) - (a.addedAt ?? 0));
}

// Projected players get a graphic only if they're among the top 3 projected
// at their position (user, 2026-11-25), in the IN list's order; everyone
// past that gets a headshot and his stats instead. Players actually in the
// portal, and committed ones, always get theirs.
// entries: the WHOLE board (not a position's slice), so a player's graphic is
// the same on every page. → Set of the projected ids that get one.
export const PROJECTED_GRAPHICS = 3;
export function projectedGraphicIds(entries) {
  const seen = {};
  const ids = new Set();
  newsSection(entries, "entered").filter(isProjected).forEach((e) => {
    const g = newsPosGroup(e.pos);
    seen[g] = (seen[g] || 0) + 1;
    if (seen[g] <= PROJECTED_GRAPHICS) ids.add(e.id);
  });
  return ids;
}
// Does he get a graphic? (ids: projectedGraphicIds of the whole board.)
export const getsGraphic = (e, ids) => !isProjected(e) || !!ids?.has(e.id);
// The IN count: the players actually in the portal (not the projected ones).
export const inPortalCount = (list) => (list || []).filter((e) => e.status === "entered" && !e.projected).length;

// "Nov 18" (opts: other toLocaleDateString fields).
export const newsDate = (d, opts = { month: "short", day: "numeric" }) =>
  (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", opts) : "");

// His season stats' title: "2026 Season at Pittsburgh".
export const statsTitleOf = (e) => {
  const season = (e?.stats || []).find((s) => s?.season)?.season;
  return [season ? `${season} Season` : "Season", e?.from ? `at ${e.from}` : ""].filter(Boolean).join(" ");
};

const isLocal = () => typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
export const wantsSim = () => typeof window !== "undefined" && (isLocal() || new URLSearchParams(window.location.search).get("sim") === "1");

// → { entries, updatedAt (Date | null), simulated } — the published doc, the
// simulation when there's none (see above), else { entries: [] }.
export async function loadPortalNews() {
  if (typeof window !== "undefined" && window.__PORTAL_NEWS_TEST__) return { ...window.__PORTAL_NEWS_TEST__, simulated: false };
  let data = null;
  try {
    const [{ doc, getDoc }, { db }] = await Promise.all([import("firebase/firestore"), import("../firebase")]);
    const s = await getDoc(doc(db, ...PORTAL_NEWS_DOC));
    data = s.exists() ? s.data() : null;
  } catch {
    data = null;
  }
  if (data?.entries?.length) return { entries: data.entries, updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : null, simulated: false };
  if (wantsSim()) {
    const { PORTAL_NEWS_SIM } = await import("./portalNewsSim");
    return { entries: PORTAL_NEWS_SIM.entries, updatedAt: new Date(`${PORTAL_NEWS_SIM.updated}T12:00:00`), simulated: true };
  }
  return { entries: [], updatedAt: null, simulated: false };
}

// ── Player pages: his Portal News item ──
// The board, read once a visit (player pages — like the Draft Risers board,
// utils/risers.js loadRiserBoard). The simulation counts on localhost, as
// on the page.
let boardOnce = null;
export const loadPortalNewsBoard = () => { if (!boardOnce) boardOnce = loadPortalNews().catch(() => ({ entries: [], updatedAt: null })); return boardOnce; };

// His In The News item when he's on Portal News — like the weekly mocks and
// the Draft Risers: dated the board's last save, linking to his position's
// list (/portal/news/lb): null when he isn't on it.
//   IN:  "Transfer Portal: We-Draft.com Predicts Simmons to Oregon"
//        (no prediction: "Top Transfer Portal Edge Rushers: Simmons")
//   OUT: "Top Transfer Portal Moves: Heintschel to Florida State"
export async function portalNewsItem(player) {
  if (!player?.id) return null;
  const board = await loadPortalNewsBoard();
  const e = (board.entries || []).find((x) => x.id === player.id);
  if (!e) return null;
  const last = player.Last || e.last;
  const g = newsPosGroup(e.pos);
  const pos = NEWS_POSITIONS.includes(g) ? g : "";
  const committed = e.status === "committed";
  const when = board.updatedAt || (/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") ? new Date(`${e.date}T12:00:00`) : null);
  const title = committed
    ? `Top Transfer Portal Moves: ${last} to ${e.to}`
    : isProjected(e)
      ? `Transfer Portal Watch: ${last} Projected to Enter`
        : e.prediction && (e.destinations || []).includes(e.prediction)
        ? `Transfer Portal: We-Draft.com Predicts ${last} to ${e.prediction}`
        : `Top Transfer Portal ${pos ? NEWS_POSITION_PLURAL[pos] : "Players"}: ${last}`;
  return {
    id: `portalNews-${e.id}`, type: "portal", aboutPlayer: true,
    // (Shaped like a Firestore timestamp: the page reads toDate / toMillis.)
    publishedAt: when ? { toDate: () => when, toMillis: () => when.getTime() } : null,
    href: newsPath(pos), title,
  };
}

// ── A player's graphic, served (api/portal-news/[file].js → api/portal-graphic.js) ──
// One permanent URL per player, at a descriptive filename, like the Draft
// Risers': /api/portal-news/colin-simmons-2027-edge-transfer-portal.webp.
// small: the 600px copy; fmt: "webp" (the page) or "png" (social previews,
// structured data); v: the board's last save (ms) — the same image until the
// admin saves again, so the CDN keeps it.
const SITE_URL = "https://we-draft.com";
export const portalImageUrl = (slug, small = false, v = "", fmt = "png") =>
  `${SITE_URL}/api/portal-news/${encodeURIComponent(slug)}-transfer-portal${small ? "-600" : ""}.${fmt === "webp" ? "webp" : "png"}${v ? `?v=${v}` : ""}`;
