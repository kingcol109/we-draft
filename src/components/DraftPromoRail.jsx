// src/components/DraftPromoRail.jsx
//
// Promo cards for a draft page's side rail (pages/Risers.jsx's right rail),
// one class at a time:
//   SimRailCard         the Mock Draft Simulator for the class (/draftsim)
//   WeeklyMockRailCard  the class's current Weekly Mock (/mocks/{year}) —
//                       its week and its No. 1 pick, from the summary
//                       AdminWeeklyMock.jsx writes on Publish (utils/
//                       weeklyMockNews.js — one cached read), the team's
//                       dark logo from nfl/{abbr}
// Both dark cards, rail width (~220px).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { SIM_YEAR, SIM_YEARS } from "../utils/draftSim/years";
import { loadWeeklyMockSummary, weeklyYearHref, weeklyMockDate, WEEKLY_YEARS } from "../utils/weeklyMockNews";

const GOLD = "#f6a21d";
const RED = "#c8102e";
const HEAD = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";
const STYLE = `.wd-promo { transition: transform .15s, box-shadow .15s; } .wd-promo:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(0,0,0,0.3); }
.wd-promo:hover .wd-promo-cta { filter: brightness(1.08); }`;
const card = (accent) => ({
  display: "block", textDecoration: "none", color: "#fff", borderRadius: 14, overflow: "hidden", fontFamily: BODY,
  background: "radial-gradient(260px 160px at 85% -20%, #1d4580 0%, transparent 70%), linear-gradient(180deg, #0b1a33 0%, #070d18 100%)",
  border: `1px solid ${accent}66`, boxShadow: "0 8px 22px rgba(7,13,24,0.22)",
});
const tag = (bg) => ({ display: "inline-block", background: bg, borderRadius: 5, padding: "3px 8px", fontWeight: 900, fontSize: 10, letterSpacing: "0.14em" });
const cta = { display: "block", textAlign: "center", background: GOLD, color: "#fff", borderRadius: 9, padding: "10px 10px", fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" };

export function SimRailCard({ year: want }) {
  const year = SIM_YEARS.includes(String(want)) ? String(want) : SIM_YEAR;
  const to = `/draftsim${year === SIM_YEAR ? "" : `/${year}`}`;
  return (
    <Link to={to} className="wd-promo" aria-label={`Run the ${year} Mock Draft Simulator`} style={card(GOLD)}>
      <style>{STYLE}</style>
      {/* On the clock: a pick card, the timer running. */}
      <div style={{ padding: "14px 14px 0" }}>
        <span style={tag(RED)}>DRAFT SIM</span>
        <div style={{ marginTop: 12, borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: `linear-gradient(135deg, ${GOLD}, #ffcf6b)`, display: "grid", placeItems: "center", fontFamily: HEAD, fontWeight: 900, fontSize: 17, color: "#0b1a33", flexShrink: 0 }}>1</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: GOLD }}>ON THE CLOCK</div>
            <div style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 900, letterSpacing: "0.02em" }}>You · 0:59</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 900, lineHeight: 1.05, textTransform: "uppercase" }}>
          {year} Mock Draft <span style={{ color: GOLD }}>Simulator</span>
        </div>
        <ul style={{ listStyle: "none", margin: "10px 0 14px", padding: 0, display: "grid", gap: 5, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
          {["Make every pick", "Trade up and down", "Live analyst desk", "Get your class graded"].map((x) => (
            <li key={x} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: "50%", background: `${GOLD}33`, color: GOLD, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 900 }}>✓</span>{x}
            </li>
          ))}
        </ul>
        <span className="wd-promo-cta" style={cta}>Run the Sim →</span>
      </div>
    </Link>
  );
}

export function WeeklyMockRailCard({ year: want }) {
  const year = WEEKLY_YEARS.includes(String(want)) ? String(want) : WEEKLY_YEARS[0];
  const [summary, setSummary] = useState(undefined);
  const [logo, setLogo] = useState("");
  useEffect(() => {
    let live = true;
    setSummary(undefined);
    setLogo("");
    loadWeeklyMockSummary(year).then(async (s) => {
      if (!live) return;
      setSummary(s);
      const abbr = Object.keys(s?.teams || {}).find((k) => s.teams[k]?.first?.overall === 1);
      if (!abbr) return;
      const t = await getDoc(doc(db, "nfl", abbr)).catch(() => null);
      const d = t?.exists() ? t.data() : null;
      if (live) setLogo(d?.LogoDark || d?.Logo1 || "");
    });
    return () => { live = false; };
  }, [year]);
  const abbr = Object.keys(summary?.teams || {}).find((k) => summary.teams[k]?.first?.overall === 1);
  const top = abbr ? summary.teams[abbr] : null;
  const date = weeklyMockDate(summary?.publishedAt, { month: "short", day: "numeric" });
  return (
    <Link to={weeklyYearHref(year)} className="wd-promo" aria-label={`The ${year} Weekly Mock Draft`} style={card("#4f8fe0")}>
      <style>{STYLE}</style>
      <div style={{ padding: "14px 14px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={tag("#1d5fbf")}>WEEKLY MOCK</span>
          {date && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>{date}</span>}
        </div>
        <div style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 900, lineHeight: 1.05, textTransform: "uppercase", marginTop: 10 }}>
          {year} {summary?.rounds ? `${summary.rounds}-Round ` : ""}<span style={{ color: GOLD }}>Mock Draft</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.75)", marginTop: 6, lineHeight: 1.45 }}>Our latest projection for every team, updated every week.</div>
        {top?.first?.name && (
          <div style={{ marginTop: 12, borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, flexShrink: 0, display: "grid", placeItems: "center" }}>
              {logo ? <img src={logo} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} /> : <span style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 13 }}>{abbr}</span>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: GOLD }}>NO. 1 PICK</div>
              <div style={{ fontFamily: HEAD, fontSize: 14, fontWeight: 900, lineHeight: 1.15 }}>{top.first.name}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.65)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[top.first.pos, top.first.school].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        )}
        <span className="wd-promo-cta" style={{ ...cta, marginTop: 14 }}>See the Mock →</span>
      </div>
    </Link>
  );
}
