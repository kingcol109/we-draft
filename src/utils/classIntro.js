// src/utils/classIntro.js
//
// "Meet the Class of 2030" (user, 2026-11-21) — a one-time WX article that
// introduces the 2030 NFL Draft class (the 2027 high school signees) when
// the class launches in December: the admin picks 3–5 players at each
// position, each with a graphic (utils/instagram/prospectIntro.js) and a
// write-up, tied to the school he signed with. No editions — one page,
// edited in place until it's released, then left as the class's intro.
//
// One doc: classIntro/{year}
//   {
//     live: false,              — released? Until then the page is admin-only
//                                 (404 for everyone else), noindex, out of
//                                 the sitemap, news and team/player pages.
//     releasedAt,               — first release (the article's date)
//     intro: "…",               — the lead (blank lines split paragraphs)
//     positions: { [POS]: [Pick] },
//     updatedAt,
//   }
//   Pick = { id (players doc), slug, first, last, pos, school (his
//            commitment — players.School), hs, state, ht, wt, note, order,
//            shot (a placed action shot, when he has one), addedAt }
// Name / school / high school are copied from the players doc on every save.
export const CLASS_INTRO_YEAR = "2030";
export const CLASS_INTRO_DOC = "classIntro";
export const classIntroPath = (year = CLASS_INTRO_YEAR) => `/class-of-${year}`;
// The high school class that makes up the draft class (2030 → 2027).
export const signingClassOf = (year) => String(Number(year) - 3);

// The positions, in page order — "3–5 players each" (the admin's call).
export const CI_POSITIONS = [
  { key: "QB", name: "Quarterbacks" }, { key: "RB", name: "Running Backs" }, { key: "WR", name: "Wide Receivers" },
  { key: "TE", name: "Tight Ends" }, { key: "OL", name: "Offensive Linemen" }, { key: "EDGE", name: "Edge Rushers" },
  { key: "DL", name: "Defensive Linemen" }, { key: "LB", name: "Linebackers" }, { key: "DB", name: "Defensive Backs" },
];
export const CI_MIN = 3;
export const CI_MAX = 5;

export const picksIn = (positions, pos) => [...(positions?.[pos] || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.addedAt ?? 0) - (b.addedAt ?? 0));
// Every pick, in page order (position, then the admin's order); sec: the
// section he's listed in (an ATH can sit under WR).
export const allPicks = (positions) => CI_POSITIONS.flatMap((p) => picksIn(positions, p.key).map((x) => ({ ...x, sec: p.key })));

// The year's doc, or null (cached for the visit). Before release only an
// admin can read it (firestore.rules) — everyone else gets null.
const cache = new Map();
export function loadClassIntro(year = CLASS_INTRO_YEAR) {
  const y = String(year);
  if (!cache.has(y)) {
    cache.set(y, (async () => {
      const [{ doc, getDoc }, { db }] = await Promise.all([import("firebase/firestore"), import("../firebase")]);
      const s = await getDoc(doc(db, CLASS_INTRO_DOC, y));
      return s.exists() ? s.data() : null;
    })().catch(() => null));
  }
  return cache.get(y);
}
const released = (d) => !!(d && d.live);

// His In The News item (player pages), once released: "Meet the Class of
// 2030: Smith".
export async function classIntroNewsItem(player) {
  if (!player?.id) return null;
  const d = await loadClassIntro();
  if (!released(d)) return null;
  const p = allPicks(d.positions).find((x) => x.id === player.id);
  if (!p) return null;
  return {
    id: `classIntro${CLASS_INTRO_YEAR}`, type: "classIntro", aboutPlayer: true, publishedAt: d.releasedAt || d.updatedAt,
    href: classIntroPath(), title: `Meet the Class of ${CLASS_INTRO_YEAR}: ${player.Last || p.last}`,
  };
}

// A college team page's item, once released: the signees it has in the
// article — "Meet the Class of 2030: Smith and Jones".
export async function classIntroTeamItem(school) {
  const d = await loadClassIntro();
  if (!released(d)) return null;
  const norm = (s) => String(s || "").trim().toLowerCase();
  const ours = allPicks(d.positions).filter((p) => norm(p.school) === norm(school));
  if (!ours.length) return null;
  const lasts = ours.map((p) => p.last).filter(Boolean);
  const who = lasts.length > 3 ? `${lasts.slice(0, 3).join(", ")} and More`
    : lasts.length > 1 ? `${lasts.slice(0, -1).join(", ")} and ${lasts[lasts.length - 1]}` : lasts[0];
  return { id: `classIntro${CLASS_INTRO_YEAR}`, type: "classIntro", title: `Meet the Class of ${CLASS_INTRO_YEAR}: ${who}`, href: classIntroPath(), publishedAt: d.releasedAt || d.updatedAt };
}

// The News feed / home News boxes, once released: one item.
export async function loadClassIntroNews() {
  const d = await loadClassIntro();
  if (!released(d)) return [];
  const names = allPicks(d.positions).slice(0, 3).map((p) => `${p.first} ${p.last}`);
  return [{
    id: `classIntro${CLASS_INTRO_YEAR}`, type: "classIntro", publishedAt: d.releasedAt || d.updatedAt,
    title: `Meet the Class of ${CLASS_INTRO_YEAR}: The ${CLASS_INTRO_YEAR} NFL Draft Class`,
    summary: names.length ? `Featuring ${names.join(", ")} and more.` : "",
    href: classIntroPath(),
  }];
}
