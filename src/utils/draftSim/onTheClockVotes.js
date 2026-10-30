// src/utils/draftSim/onTheClockVotes.js
//
// On the Clock's votes — cosmetic only; they never change a pick (the
// script was drafted before the show). Two per pick:
//   take   while a team's on the clock: who should they take? (the beat's
//          `top` four)
//   grade  once it's in: grade the pick, A–F
// Tallies live in simShows/{id}/tally/{overall} ({ take: { [pid]: n },
// grade: { A: n, … } }) — public read, written only by api/on-the-clock.js,
// which keeps each voter to one take and one grade per pick.
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";

export const GRADES = ["A", "B", "C", "D", "F"];
const POINTS = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const LETTERS = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];

// { A: n, … } → { letter, count } (the average, on a +/− scale).
export function gradeOf(counts = {}) {
  const count = GRADES.reduce((t, g) => t + (counts[g] || 0), 0);
  if (!count) return { letter: null, count: 0 };
  const avg = GRADES.reduce((t, g) => t + POINTS[g] * (counts[g] || 0), 0) / count;
  return { letter: LETTERS[Math.max(0, Math.min(12, Math.round(avg * 3)))], count };
}

// Every pick's tally: { [overall]: { take: { [pid]: n }, grade: { letter, count, counts } } }.
export function useShowVotes(showId) {
  const [votes, setVotes] = useState({});
  useEffect(() => {
    if (!showId) return undefined;
    setVotes({});
    return onSnapshot(collection(db, "simShows", showId, "tally"), (s) => {
      const out = {};
      s.docs.forEach((d) => {
        const v = d.data();
        out[d.id] = { take: v.take || {}, grade: { ...gradeOf(v.grade), counts: v.grade || {} } };
      });
      setVotes(out);
    }, () => {});
  }, [showId]);
  return votes;
}
