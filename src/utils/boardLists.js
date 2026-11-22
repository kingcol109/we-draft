// src/utils/boardLists.js
//
// Board lists for Profile → My Binder (components/profileHub/BinderBoards.jsx,
// drawn by components/print/BoardListPages.jsx): a class's board, printed
// round by round or position by position, in two versions —
//   user ("mine"): their Whiteboard (whiteboards/{uid}_{class}): the Big
//     Board order round by round, or each position group's order; with
//     their own grade (users/{uid}/evaluations) and their star / red flag.
//   community: the community class lists (compSnapshots/class_{class}_{pos}):
//     ranked by the community grade (cr) — round by round grouped by the
//     round the community grade rounds to, or each position's list.
// Player names, schools, logos and community grades come from those same
// class snapshots — one read per position, cached for the session.
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { getSiteSnapshot } from "./siteSnapshots";
import { gradeLabel } from "./gradeScale";
import { communityFor } from "./communityGrades";

// The Whiteboard's position groups (CB and S sit in DB) and rounds.
export const BOARD_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
const SNAPSHOT_POSITIONS = [...BOARD_POSITIONS, "CB", "S"];
const groupOf = (pos) => (pos === "CB" || pos === "S" ? "DB" : pos);
const ROUNDS = ["ROUND 1", "ROUND 2", "ROUND 3", "ROUND 4", "ROUND 5", "ROUND 6", "ROUND 7", "UDFA"];
const roundTitle = (r) => (r === "UDFA" ? "Undrafted Free Agents" : `Round ${r.replace("ROUND ", "")}`);
export const POSITION_NAMES = {
  QB: "Quarterbacks", RB: "Running Backs", WR: "Wide Receivers", TE: "Tight Ends", OL: "Offensive Line",
  DL: "Defensive Line", EDGE: "Edge Rushers", LB: "Linebackers", DB: "Defensive Backs",
};
// The community grade (1 Early 1st … 10 UDFA) → its round.
const roundOfGrade = (g) => {
  const v = Math.round(g);
  return v <= 3 ? "ROUND 1" : v >= 10 ? "UDFA" : `ROUND ${v - 2}`;
};

// Every player in a class: id → { id, first, last, pos (group), rawPos, school, logo, g, cr }.
async function classIndex(cls) {
  const snaps = await Promise.all(SNAPSHOT_POSITIONS.map((pos) => getSiteSnapshot(`class_${cls}_${pos}`).catch(() => null)));
  const out = {};
  snaps.forEach((sd, i) => {
    const raw = SNAPSHOT_POSITIONS[i];
    const add = (id, r) => {
      out[id] = { id, first: r.F || "", last: r.L || "", pos: groupOf(raw), rawPos: raw, school: r.s || "", logo: r.lg || "", g: r.g ?? null, cr: r.cr ?? null, ht: r.ht || null, wt: r.wt || null };
    };
    (sd?.rows || []).forEach((r) => add(r.i, r));
    Object.entries(sd?.hidden || {}).forEach(([id, h]) => add(id, h));
  });
  return out;
}

/**
 * → { title, subtitle, sections: [{ title, rows }], empty?: string }
 * rows: { rank, sub (a second rank / round tag), first, last, pos, school,
 *   logo, community (grade label), mine (their grade), starred, flagged }
 * opts: { uid, cls, source: "mine" | "community", by: "round" | "position",
 *   pos: "ALL" | a position group, limit (community round-by-round),
 *   evals: [{ id, grade }] }
 */
export async function loadBoardList({ uid, cls, source, by, pos = "ALL", limit = 100, evals = [] }) {
  const idx = await classIndex(cls);
  const myGrade = Object.fromEntries(evals.map((e) => [e.id, e.grade || ""]));
  const row = (p, extra) => ({
    id: p.id, ht: p.ht, wt: p.wt,
    first: p.first, last: p.last, pos: p.rawPos, school: p.school, logo: p.logo,
    community: p.g != null ? gradeLabel(p.g) : "", mine: myGrade[p.id] || "", ...extra,
  });
  const groups = pos === "ALL" ? BOARD_POSITIONS : [pos];
  const posLabel = pos === "ALL" ? "" : `${pos} `;

  if (source === "mine") {
    const wb = uid ? await getDoc(doc(db, "whiteboards", `${uid}_${cls}`)).then((x) => (x.exists() ? x.data() : null)).catch(() => null) : null;
    const board = wb?.board || {};
    const marks = wb?.markers || {};
    const flags = (id) => ({ starred: !!marks[id]?.starred, flagged: !!marks[id]?.flagged });
    const title = `My ${cls} ${posLabel}Board`;
    if (by === "round") {
      // The Big Board order, numbered overall.
      let n = 0;
      const sections = ROUNDS.map((r) => {
        const ids = wb?.bigBoard?.[r]?.length ? wb.bigBoard[r] : BOARD_POSITIONS.flatMap((g) => board[r]?.[g] || []);
        const rows = ids.map((id) => { n += 1; const p = idx[id]; return p && groups.includes(p.pos) ? row(p, { rank: n, ...flags(id) }) : null; }).filter(Boolean);
        return { title: roundTitle(r), rows };
      }).filter((s) => s.rows.length);
      return { title, subtitle: "Round by round · from my Whiteboard", sections, empty: sections.length ? "" : `Nothing on your ${cls} Whiteboard yet.` };
    }
    const sections = groups.map((g) => {
      let n = 0;
      const rows = ROUNDS.flatMap((r) => (board[r]?.[g] || []).map((id) => {
        const p = idx[id];
        if (!p) return null;
        n += 1;
        return row(p, { rank: n, sub: r === "UDFA" ? "UDFA" : `R${r.replace("ROUND ", "")}`, ...flags(id) });
      })).filter(Boolean);
      return { title: POSITION_NAMES[g] || g, rows };
    }).filter((s) => s.rows.length);
    return { title, subtitle: "Position by position · from my Whiteboard", sections, empty: sections.length ? "" : `Nothing on your ${cls} Whiteboard yet.` };
  }

  // Community: graded players, by community rank.
  const graded = Object.values(idx).filter((p) => p.g != null && p.cr != null).sort((a, b) => a.cr - b.cr);
  const title = `Community ${cls} ${posLabel}Board`;
  if (by === "round") {
    const list = graded.filter((p) => groups.includes(p.pos)).slice(0, limit);
    const sections = ROUNDS.map((r) => ({ title: roundTitle(r), rows: list.filter((p) => roundOfGrade(p.g) === r).map((p) => row(p, { rank: p.cr })) }))
      .filter((s) => s.rows.length);
    return { title, subtitle: `Round by round · top ${list.length} by community grade`, sections, empty: sections.length ? "" : "No community grades yet." };
  }
  const sections = groups.map((g) => ({
    title: POSITION_NAMES[g] || g,
    rows: graded.filter((p) => p.pos === g).slice(0, limit).map((p, i) => row(p, { rank: i + 1, sub: `#${p.cr}` })),
  })).filter((s) => s.rows.length);
  return { title, subtitle: "Position by position · ranked by community grade", sections, empty: sections.length ? "" : "No community grades yet." };
}

// 74 → 6'2"
export const fmtInches = (n) => (n ? `${Math.floor(n / 12)}'${Math.round(n % 12)}"` : "");

/**
 * The Snapshot style's extras for the listed players: { [id]: { headshot,
 * strengths } } — their headshot (playerPhotos, one read each) and the
 * community's top strengths (the _grades snapshot, one read).
 */
export async function loadSnapshotExtras(ids) {
  const [photos, comm] = await Promise.all([
    Promise.all(ids.map((id) => getDoc(doc(db, "playerPhotos", id)).then((x) => [id, x.exists() ? x.data().headshot?.url || "" : ""]).catch(() => [id, ""]))),
    communityFor(ids).catch(() => ({})),
  ]);
  const shot = Object.fromEntries(photos);
  return Object.fromEntries(ids.map((id) => [id, { headshot: shot[id] || "", strengths: comm[id]?.strengths || [] }]));
}
