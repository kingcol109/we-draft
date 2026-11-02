// src/components/profileHub/BoardsTab.jsx
//
// The profile hub's Boards tab, for one class (2027 / 2028): My Board — the
// user's highest-graded players (users/{uid}/evaluations, players for name
// and class, playerPhotos for headshots) — and their Whiteboard as a mini
// grid: how many players they've placed at each position on Day 1 / 2 / 3
// and UDFA (whiteboards/{uid}_{class}, pages/Whiteboard.js).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, documentId, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import LoadingSpinner from "../LoadingSpinner";
import { GRADE_SCALE, gradeLook } from "../../utils/communityGrades";
import { loadPhotos } from "../../utils/profileHub";
import { SIM_YEAR, SIM_YEARS } from "../../utils/draftSim/years";

const BLUE = "#0055a5";
const MUTED = "#5b6b84";
const CARD = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)", overflow: "hidden" };
const TOP = 8;
const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
const DAYS = [["Day 1", ["ROUND 1"]], ["Day 2", ["ROUND 2", "ROUND 3"]], ["Day 3", ["ROUND 4", "ROUND 5", "ROUND 6", "ROUND 7"]], ["UDFA", ["UDFA"]]];
const chunks = (ids, n = 30) => { const out = []; for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n)); return out; };

// Every graded player (Watchlist last), with name, class and headshot.
async function loadGraded(uid) {
  const evs = await getDocs(collection(db, "users", uid, "evaluations")).then((s) => s.docs.map((d) => ({ id: d.id, grade: d.data().grade || "Watchlist" }))).catch(() => []);
  const players = {};
  await Promise.all(chunks(evs.map((e) => e.id)).map(async (c) => {
    const snap = await getDocs(query(collection(db, "players"), where(documentId(), "in", c))).catch(() => null);
    snap?.docs.forEach((d) => { players[d.id] = d.data(); });
  }));
  return evs.filter((e) => players[e.id]).map((e) => ({ ...e, p: players[e.id] }));
}

async function loadWhiteboard(uid, year) {
  const snap = await getDoc(doc(db, "whiteboards", `${uid}_${year}`)).catch(() => null);
  if (!snap?.exists()) return null;
  const d = snap.data();
  return { board: d.board || {}, unranked: (d.unranked || []).length, updatedAt: d.updatedAt };
}

function GradeChip({ grade }) {
  const look = gradeLook(grade);
  return (
    <span title={grade} style={{ marginLeft: "auto", flexShrink: 0, minWidth: 48, textAlign: "center", color: "#fff", background: look.bg, border: `2px solid ${look.border}`, borderRadius: 6, padding: "2px 6px", font: "900 12px Arial, sans-serif" }}>
      {look.qualifier ? `${look.qualifier[0]} ` : ""}{grade === "Watchlist" ? "WL" : look.short}
    </span>
  );
}

export default function BoardsTab({ uid, isMobile }) {
  const [year, setYear] = useState(SIM_YEAR);
  const [graded, setGraded] = useState(null);
  const [photos, setPhotos] = useState({});
  const [wb, setWb] = useState(undefined);
  useEffect(() => {
    let live = true;
    loadGraded(uid).then((g) => { if (live) setGraded(g); });
    return () => { live = false; };
  }, [uid]);
  useEffect(() => {
    let live = true;
    setWb(undefined);
    loadWhiteboard(uid, year).then((w) => { if (live) setWb(w); });
    return () => { live = false; };
  }, [uid, year]);

  const mine = (graded || []).filter((g) => String(g.p.Eligible) === year)
    .sort((a, b) => (GRADE_SCALE[a.grade] || 99) - (GRADE_SCALE[b.grade] || 99) || `${a.p.Last}`.localeCompare(`${b.p.Last}`));
  const top = mine.slice(0, TOP);
  const topKey = top.map((g) => g.id).join("|");
  useEffect(() => {
    if (!topKey) return undefined;
    let live = true;
    loadPhotos(topKey.split("|")).then((m) => { if (live) setPhotos((x) => ({ ...x, ...m })); });
    return () => { live = false; };
  }, [topKey]);

  const head = (title, right) => (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "12px 14px 8px" }}>
      <h3 style={{ margin: 0, font: "900 13px Arial, sans-serif", letterSpacing: ".14em", textTransform: "uppercase", color: BLUE }}>{title}</h3>
      <span style={{ font: "800 11px Arial, sans-serif", color: "#8a95a5" }}>{right}</span>
    </div>
  );
  const foot = (text, to, cta) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f6f8fb", font: "800 11px Arial, sans-serif", color: MUTED }}>
      <span>{text}</span>
      <Link to={to} style={{ flexShrink: 0, color: BLUE, font: "900 11px Arial, sans-serif", letterSpacing: ".08em", textTransform: "uppercase", textDecoration: "none" }}>{cta} →</Link>
    </div>
  );

  let placed = 0;
  const grid = DAYS.map(([day, rounds]) => [day, POSITIONS.map((pos) => {
    const n = rounds.reduce((t, r) => t + (wb?.board?.[r]?.[pos]?.length || 0), 0);
    placed += n;
    return n;
  })]);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {SIM_YEARS.map((y) => (
          <button key={y} onClick={() => setYear(y)} aria-pressed={y === year} style={{ border: `2px solid ${y === year ? BLUE : "#d8e0ea"}`, background: y === year ? BLUE : "#fff", color: y === year ? "#fff" : MUTED, borderRadius: 999, padding: "5px 14px", font: "900 12px Arial, sans-serif", letterSpacing: ".06em", cursor: "pointer" }}>{y} CLASS</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, alignItems: "start" }}>
        <div style={CARD}>
          {head("My Board", graded ? `${year} · ${mine.length} graded` : "")}
          {!graded ? <LoadingSpinner size={24} minHeight="120px" /> : top.length ? top.map((g, i) => (
            <Link key={g.id} to={g.p.Slug ? `/player/${g.p.Slug}` : "#"} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderTop: "1px solid #eef1f5", textDecoration: "none" }}>
              <span style={{ width: 18, font: "900 13px Arial, sans-serif", color: "#8a95a5" }}>{i + 1}</span>
              <span style={{ width: 40, height: 29, flexShrink: 0, display: "block" }}>
                {photos[g.id]?.headshot && <img src={photos[g.id].headshot} alt="" style={{ width: 40, height: 29, maxWidth: "none", objectFit: "contain", objectPosition: "bottom" }} />}
              </span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: "block", font: "900 13px Arial, sans-serif", color: "#0f1b2d" }}>{g.p.First} {g.p.Last}</b>
                <em style={{ font: "normal 700 11px Arial, sans-serif", color: "#7a8597" }}>{[g.p.Position, g.p.School].filter(Boolean).join(" · ")}</em>
              </span>
              <GradeChip grade={g.grade} />
            </Link>
          )) : (
            <div style={{ padding: "6px 14px 14px", font: "700 13px Arial, sans-serif", color: MUTED }}>You haven&apos;t graded any {year} prospects yet.</div>
          )}
          {foot(mine.length > TOP ? `+${mine.length - TOP} more graded` : "Grade players from their pages", "/boards", "Open board")}
        </div>
        <div style={CARD}>
          {head("Whiteboard", wb?.updatedAt?.toDate ? `${year} · edited ${wb.updatedAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : year)}
          {wb === undefined ? <LoadingSpinner size={24} minHeight="120px" /> : (
            <div style={{ display: "grid", gridTemplateColumns: `44px repeat(${POSITIONS.length}, 1fr)`, gap: 3, padding: "4px 14px 12px" }}>
              <div />
              {POSITIONS.map((p) => <div key={p} style={{ textAlign: "center", font: "800 10px Arial, sans-serif", color: "#7a8597", padding: "3px 0" }}>{p}</div>)}
              {grid.map(([day, counts]) => [
                <div key={day} style={{ display: "flex", alignItems: "center", font: "900 10px Arial, sans-serif", color: "#0f1b2d" }}>{day}</div>,
                ...counts.map((n, i) => (
                  <div key={`${day}-${i}`} style={{ textAlign: "center", borderRadius: 4, padding: "6px 0", font: "900 12px Arial, sans-serif",
                    background: !n ? "#f6f8fb" : day === "Day 1" ? BLUE : "#eef3fa", color: !n ? "#c3cad6" : day === "Day 1" ? "#fff" : BLUE }}>{n || "·"}</div>
                )),
              ])}
            </div>
          )}
          {foot(wb ? `${placed} placed${wb.unranked ? ` · ${wb.unranked} unranked` : ""}` : "Not started yet", "/whiteboard", "Open whiteboard")}
        </div>
      </div>
    </div>
  );
}
