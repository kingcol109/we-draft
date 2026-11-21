// src/utils/earlyLook.js
//
// The advance look at high school prospects (user, 2026-11-21 — the name's
// still open: change EARLY_LOOK below and the page, admin tab, graphics and
// news follow). WX content: the admin promotes high school players in the
// classes after 2030 (2031 and beyond — recruits whose RecruitClass is 2028
// or later; draft class = RecruitClass + 3), ranked, with a write-up and a
// graphic each, and every admin Save publishes a dated edition, like the
// Draft Risers (utils/risers.js, the reference).
//
//   earlyLook/current {
//     live: false,     — released? Until then admin-only (404 otherwise),
//                        noindex, no sitemap / news.
//     releasedAt, intro, players: [Entry], updatedAt
//   }
//   Entry = { id (recruits doc), first, last, pos, rc (RecruitClass —
//             his high school class), hs, state, commit (Commitment, "" when
//             uncommitted), ht, wt, note, order, addedAt }
//   earlyLookEditions/{YYYY-MM-DD} { date, publishedAt, live, players }
//     — one a day (a second Save that day replaces it); `live` follows the
//       list, so a pre-release edition stays private (firestore.rules).
// Latest at EARLY_LOOK.path; a past edition at {path}/{date} (noindex).
// These kids have no We-Draft.com player pages yet — names don't link.
export const EARLY_LOOK = {
  name: "Early Look",
  path: "/early-look",
  // The graphic's tag and the page's kicker.
  tag: "EARLY LOOK",
};
export const EL_DOC = "earlyLook";
export const EL_ID = "current";
export const EL_EDITIONS = "earlyLookEditions";
// High school classes that count (2028 → the 2031 draft class).
export const EL_FIRST_RECRUIT_CLASS = 2028;
export const draftClassOf = (rc) => (Number(rc) ? String(Number(rc) + 3) : "");

export const earlyRanked = (players) => [...(players || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.addedAt ?? 0) - (b.addedAt ?? 0));
// The draft classes on the list, soonest first.
export const earlyClasses = (players) => [...new Set((players || []).map((p) => draftClassOf(p.rc)).filter(Boolean))].sort();

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isEarlyEditionDate = (d) => DATE_RE.test(String(d || ""));
export const earlyEditionPath = (date) => `${EARLY_LOOK.path}/${date}`;
// The edition a moment belongs to: its date in Eastern time.
export const earlyEditionDate = (when = new Date()) => when.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export const earlyEditionLabel = (date, opts = { month: "short", day: "numeric", year: "numeric" }) =>
  (isEarlyEditionDate(date) ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", opts) : "");

// The News feed / home News boxes, once released: its editions, newest
// first (the newest links to the latest page). [] before release.
export async function loadEarlyLookNews(max) {
  try {
    const [{ collection, getDocs, query, where }, { db }] = await Promise.all([import("firebase/firestore"), import("../firebase")]);
    // Only released editions (the rules allow no other read); newest first,
    // sorted here so the query needs no composite index.
    const snap = await getDocs(query(collection(db, EL_EDITIONS), where("live", "==", true)));
    const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.publishedAt) - ms(a.publishedAt)).slice(0, max || undefined);
    return docs.map((e, i) => {
      const d = { id: e.id };
      const top = earlyRanked(e.players).slice(0, 3).map((r) => `${r.first} ${r.last}`);
      return {
        id: `earlyLook-${d.id}`, type: "earlyLook", publishedAt: e.publishedAt,
        title: `${EARLY_LOOK.name}: High School Prospects — ${earlyEditionLabel(e.date, { month: "long", day: "numeric" })}`,
        summary: top.length ? `Featuring ${top.join(", ")}.` : "",
        href: i === 0 ? EARLY_LOOK.path : earlyEditionPath(e.date),
      };
    });
  } catch {
    return [];
  }
}
