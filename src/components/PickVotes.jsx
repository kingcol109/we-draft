// src/components/PickVotes.jsx
//
// Up / down votes on a Weekly Mock team page's picks (WeeklyTeamMock.jsx —
// the full mock doesn't have them). Anyone can vote, no sign-in: one vote
// per pick per browser (localStorage), tap it again to take it back, tap
// the other to switch. A vote belongs to the player at that pick — the
// class, the round and the pick's original team — so it carries week to
// week while the mock keeps him there, and a new player there starts at 0.
//
// mockPickVotes/{year}_{round}_{original}_{playerId}: { up, down, team,
// year, playerId }. Counts move by increment(); firestore.rules lets a
// write change each count by at most one.
import { useState } from "react";
import { collection, doc, getDocs, increment, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";

const STORE = "wd-mock-votes";
export const pickVoteKey = (year, pick) => (pick?.player?.id ? `${year}_${pick.round}_${pick.original}_${pick.player.id}` : null);

const readMine = () => {
  try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch { return {}; }
};
const saveMine = (key, vote) => {
  const all = readMine();
  if (vote) all[key] = vote; else delete all[key];
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* private mode: the vote still counts */ }
};

// A team's counts for a class: { [key]: { up, down } }.
export async function loadPickVotes(year, team) {
  const snap = await getDocs(query(collection(db, "mockPickVotes"), where("year", "==", String(year)), where("team", "==", team)));
  return Object.fromEntries(snap.docs.map((d) => [d.id, { up: d.data().up || 0, down: d.data().down || 0 }]));
}

const ThumbIcon = ({ down }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={down ? { transform: "rotate(180deg)" } : undefined}>
    <path d="M7 10v11H3V10h4zm0 0l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7" />
  </svg>
);

export default function PickVotes({ voteKey, year, team, playerId, counts }) {
  const [mine, setMine] = useState(() => readMine()[voteKey] || null);
  // This browser's change on top of the loaded counts, so a tap shows at once.
  const [delta, setDelta] = useState({ up: 0, down: 0 });
  const [busy, setBusy] = useState(false);

  const vote = async (kind) => {
    if (busy) return;
    const next = mine === kind ? null : kind;
    const d = { up: (next === "up") - (mine === "up"), down: (next === "down") - (mine === "down") };
    const prev = mine;
    setMine(next); saveMine(voteKey, next);
    setDelta((x) => ({ up: x.up + d.up, down: x.down + d.down }));
    setBusy(true);
    try {
      await setDoc(doc(db, "mockPickVotes", voteKey), {
        team, year: String(year), playerId, up: increment(d.up), down: increment(d.down),
      }, { merge: true });
    } catch (e) {
      console.error("Pick vote", e);
      setMine(prev); saveMine(voteKey, prev);
      setDelta((x) => ({ up: x.up - d.up, down: x.down - d.down }));
    } finally {
      setBusy(false);
    }
  };

  const button = (kind) => {
    const on = mine === kind;
    const color = on ? (kind === "up" ? "#15803d" : "#b91c1c") : "#8a95a5";
    const n = Math.max(0, (counts?.[kind] || 0) + delta[kind]);
    return (
      <button type="button" onClick={() => vote(kind)} aria-pressed={on} title={kind === "up" ? "Good pick" : "Bad pick"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "4px 10px", cursor: "pointer",
          border: `1px solid ${on ? `${color}55` : "#e1e6ee"}`, background: on ? (kind === "up" ? "#e8f6ee" : "#fdecec") : "transparent",
          color, fontFamily: "Arial, sans-serif", fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums",
          transition: "background-color .15s ease, color .15s ease, border-color .15s ease",
        }}>
        <ThumbIcon down={kind === "down"} />
        <span>{n}</span>
      </button>
    );
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
      {button("up")}
      {button("down")}
    </span>
  );
}
