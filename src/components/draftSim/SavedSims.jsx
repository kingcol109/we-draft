// src/components/draftSim/SavedSims.jsx
//
// The Draft Sim page's My Drafts tab: every sim the signed-in user saved
// from the results screen (users/{uid}/draftSims, written by
// SimResults.jsx's Save), newest first — their teams' picks with each
// pick's grade and the team's, shareable as text (each pick, the grade,
// then the link — utils/draftSim/share.js) or deleted. UserProfile.js
// lists the same docs on the profile.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, deleteDoc, doc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../context/AuthContext";
import { simShareText } from "../../utils/draftSim/share";
import { textOn } from "../../utils/teamColors";
import LoadingSpinner from "../LoadingSpinner";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const BODY = "Arial, sans-serif";
const PANEL = { background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, overflow: "hidden" };
const gradeColor = (l = "") => (l.startsWith("A") ? "#3fb950" : l.startsWith("B") ? "#58a6ff" : l.startsWith("C") ? GOLD : "#f85149");
const action = { display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #2a3a58", background: "#121c2f", color: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 11, fontWeight: 900, letterSpacing: "0.05em", textDecoration: "none", cursor: "pointer", fontFamily: "inherit" };

// branding: { [abbr]: { City, Team, Color1, Color2, LogoDark, Logo1 } } (the sim's setup).
export default function SavedSims({ branding = {}, isMobile }) {
  const { user, login } = useAuth();
  const [sims, setSims] = useState(null);

  useEffect(() => {
    if (!user) { setSims(null); return undefined; }
    let live = true;
    getDocs(query(collection(db, "users", user.uid, "draftSims"), orderBy("createdAt", "desc")))
      .then((snap) => live && setSims(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => { console.error("Saved draft sims load error:", e); if (live) setSims([]); });
    return () => { live = false; };
  }, [user]);

  const teamName = (t) => { const b = branding[t] || {}; return b.Team ? `${b.City || ""} ${b.Team}`.trim() : t; };
  const remove = async (id) => {
    if (!window.confirm("Delete this saved draft?")) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "draftSims", id));
      setSims((list) => list.filter((s) => s.id !== id));
    } catch (e) {
      console.error("Saved draft sim delete error:", e);
      alert("Couldn't delete that draft — try again.");
    }
  };

  const empty = (children) => <div style={{ ...PANEL, padding: 28, textAlign: "center", color: "#c9d4e5", fontFamily: BODY, fontSize: 14, lineHeight: 1.6 }}>{children}</div>;
  if (!user) {
    return empty(<>
      Sign in to see the drafts you&apos;ve saved.
      <div><button onClick={login} style={{ ...action, background: GOLD, color: "#111", border: "none", marginTop: 12, padding: "9px 18px" }}>SIGN IN</button></div>
    </>);
  }
  if (!sims) return <LoadingSpinner label="Loading your drafts" size={32} minHeight="30vh" />;
  if (!sims.length) return empty(<>No saved drafts yet. Finish a draft and hit <strong style={{ color: "#fff" }}>Save to Profile</strong> — it shows up here.</>);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {sims.map((s) => {
        const text = simShareText({ year: s.year, teams: s.teams || [], teamName });
        const date = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
        return (
          <div key={s.id} style={PANEL}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid #1f2b42" }}>
              <span style={{ color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.14em" }}>{s.year} DRAFT SIM</span>
              <span style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>{[date, s.rounds ? `${s.rounds} round${s.rounds === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</span>
              <span style={{ flex: 1 }} />
              <a href={`sms:?&body=${encodeURIComponent(text)}`} style={action}>💬 TEXT</a>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" style={action}>𝕏 POST</a>
              <button onClick={() => remove(s.id)} style={{ ...action, color: "#f85149" }}>DELETE</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 10, padding: 12 }}>
              {(s.teams || []).map((t) => {
                const b = branding[t.team] || {};
                const c1 = b.Color1 || BLUE;
                return (
                  <div key={t.team} style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${b.Color2 || "#1f2b42"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: c1, color: textOn(c1, b.Color2 || GOLD) }}>
                      {(b.LogoDark || b.Logo1) && <img src={b.LogoDark || b.Logo1} alt="" style={{ width: 28, height: 28, objectFit: "contain" }} />}
                      <Link to={`/nfl/${t.team.toLowerCase()}`} style={{ flex: 1, minWidth: 0, color: "inherit", fontWeight: 900, fontSize: 15, textTransform: "uppercase", textDecoration: "none" }}>{teamName(t.team)}</Link>
                      <span style={{ background: "rgba(0,0,0,0.3)", color: "#fff", borderRadius: 8, padding: "2px 10px", fontSize: 20, fontWeight: 900 }}>{t.grade}</span>
                    </div>
                    <div style={{ background: "#0b1322", padding: "4px 0" }}>
                      {(t.picks || []).map((p) => (
                        <div key={p.overall} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", fontSize: 12 }}>
                          <span style={{ width: 54, flexShrink: 0, color: "#6f7f99", fontWeight: 900, fontSize: 11 }}>R{p.round} · {p.overall}</span>
                          <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {p.slug
                              ? <Link to={`/player/${p.slug}`} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", fontWeight: 900, textTransform: "uppercase", textDecoration: "none" }}>{p.first} {p.last}</Link>
                              : <span style={{ color: "#fff", fontWeight: 900, textTransform: "uppercase" }}>{p.first} {p.last}</span>}
                            <span style={{ color: "#8b9bb4", fontFamily: BODY }}> · {p.pos}{p.school ? ` · ${p.school}` : ""}{p.via ? ` · via ${p.via}` : ""}</span>
                          </span>
                          <span style={{ width: 24, textAlign: "right", fontWeight: 900, color: gradeColor(p.grade) }}>{p.grade}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
