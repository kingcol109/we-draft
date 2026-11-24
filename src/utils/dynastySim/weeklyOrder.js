// src/utils/dynastySim/weeklyOrder.js
//
// The Dynasty Draft Sim's board for a far-off class (2029 — user,
// 2026-11-24): the players in the order the latest published Weekly Mock
// took them, then everyone else in the community board's order
// (pages/DynastySim.jsx → engine applyBoardOrder). The latest week is the
// one the class's summary names (config — utils/weeklyMockNews.js), else
// the newest published weeklyMocks doc for the year.
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { loadWeeklyMockSummary } from "../weeklyMockNews";

export const WEEKLY_ORDER_YEARS = ["2029"];

// [player id], in the latest published Weekly Mock's pick order ([] if none).
export async function latestWeeklyOrder(year) {
  const summary = await loadWeeklyMockSummary(year);
  let week = null;
  if (summary?.weekId) {
    const s = await getDoc(doc(db, "weeklyMocks", summary.weekId));
    if (s.exists() && s.data().publishedAt) week = s.data();
  }
  if (!week) {
    const snap = await getDocs(query(collection(db, "weeklyMocks"), where("year", "==", String(year))));
    week = snap.docs.map((d) => d.data()).filter((w) => w.publishedAt)
      .sort((a, b) => b.publishedAt.toMillis() - a.publishedAt.toMillis())[0] || null;
  }
  return [...(week?.picks || [])].sort((a, b) => a.overall - b.overall).map((p) => p.player?.id).filter(Boolean);
}
