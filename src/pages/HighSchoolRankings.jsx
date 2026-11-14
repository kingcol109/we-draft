// src/pages/HighSchoolRankings.jsx
//
// /hs/rankings — the high school leaderboards: which programs have the most
// players in college football right now, and the most NFL draft picks
// (since 2000), overall and position by position, nationally or within a
// state. Public but not linked on the site yet — the admin's Branding → High
// School "HS Rankings" link and the high school pages' own rankings links are
// the way in. noindex until released.
//
// One read per view: hsAlumni/_rankings_US or hsAlumni/_rankings_{ST}
// (server/highSchools/hsIndex.js — top 25 nationally, top 15 per state, for
// every metric and position group). ?scope=GA&m=nfl&pos=QB in the URL.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import { STATE_ABBR } from "../utils/highSchoolMatch";
import { METRICS, POS_GROUPS, rankText } from "../utils/hsRanks";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0f1b2d";
const LINE = "#e3e8ef";
const LINE_2 = "#eef1f5";
const SOFT = "#f7f9fc";
const STATES = Object.entries(STATE_ABBR).sort((a, b) => a[0].localeCompare(b[0]));
const STATE_NAME = Object.fromEntries(STATES.map(([n, a]) => [a, n]));

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return m;
}

export default function HighSchoolRankings() {
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const scope = STATE_NAME[params.get("scope")] ? params.get("scope") : "US";
  const metric = params.get("m") === "nfl" ? "nfl" : "cfb";
  const pos = POS_GROUPS.some(([g]) => g === params.get("pos")) ? params.get("pos") : "ALL";
  const set = (k, v, dflt) => {
    const next = new URLSearchParams(params);
    if (v === dflt) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  const [data, setData] = useState(undefined); // undefined loading, null none
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    getDoc(doc(db, "hsAlumni", `_rankings_${scope}`))
      .then((s) => { if (!cancelled) setData(s.exists() ? s.data() : null); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [scope]);

  const rows = data?.lists?.[metric]?.[pos] || [];
  const scopeName = scope === "US" ? "National" : STATE_NAME[scope];
  const metricInfo = METRICS.find(([k]) => k === metric);
  const posLabel = pos === "ALL" ? "All Positions" : POS_GROUPS.find(([g]) => g === pos)[1];
  // With all positions showing: the leader at each position, alongside.
  const leaders = useMemo(() => POS_GROUPS.map(([g, label]) => {
    const list = data?.lists?.[metric]?.[g] || [];
    return { g, label, top: list.filter((r) => r.r === 1), v: list[0]?.v || 0 };
  }), [data, metric]);

  const pill = (on) => ({
    padding: isMobile ? "7px 14px" : "8px 18px", borderRadius: "999px", cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${on ? BLUE : LINE}`, background: on ? BLUE : "#fff", color: on ? "#fff" : INK,
    fontWeight: 900, fontSize: isMobile ? "12px" : "13px", textTransform: "uppercase", letterSpacing: "0.06em",
  });

  return (
    <>
      <Helmet>
        <title>High School Football Rankings | We-Draft.com</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "12px 12px 60px" : "24px 32px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        {/* Header band — site blue, gold rule. */}
        <div style={{ borderRadius: "14px", overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", marginBottom: "16px" }}>
          <div style={{ background: `linear-gradient(120deg, ${BLUE} 0%, #003f7d 100%)`, padding: isMobile ? "18px 16px" : "26px 28px", color: "#fff" }}>
            <div style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: GOLD }}>High School Rankings</div>
            <div style={{ fontSize: isMobile ? "24px" : "34px", fontWeight: 900, lineHeight: 1.1, marginTop: "4px" }}>
              {scopeName} · {metricInfo[1]}
            </div>
            <div style={{ marginTop: "6px", fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>
              {metric === "cfb"
                ? `Programs with the most players on ${data?.season || ""} college football rosters`
                : `Programs with the most NFL draft picks, ${data?.draftFrom || 2000}–${data?.draftTo || ""}`}
            </div>
          </div>
          <div style={{ height: "4px", background: GOLD }} />
        </div>

        {/* Filters: metric, scope, position. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          {METRICS.map(([k, label]) => (
            <button key={k} type="button" style={pill(metric === k)} onClick={() => set("m", k, "cfb")}>{label}</button>
          ))}
          <select
            value={scope}
            onChange={(e) => set("scope", e.target.value, "US")}
            aria-label="Scope"
            style={{ marginLeft: isMobile ? 0 : "auto", padding: "8px 12px", borderRadius: "10px", border: `1px solid ${LINE}`, background: "#fff", color: INK, fontWeight: 900, fontSize: "13px", fontFamily: "inherit", cursor: "pointer" }}
          >
            <option value="US">National</option>
            {STATES.map(([name, abbr]) => <option key={abbr} value={abbr}>{name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px", marginBottom: "16px" }}>
          {[["ALL", "All"], ...POS_GROUPS.map(([g]) => [g, g])].map(([g, label]) => (
            <button key={g} type="button" onClick={() => set("pos", g, "ALL")} style={{
              flexShrink: 0, padding: "6px 12px", borderRadius: "8px", cursor: "pointer", fontWeight: 900, fontSize: "12px",
              border: `1px solid ${pos === g ? GOLD : LINE}`, background: pos === g ? GOLD : "#fff", color: pos === g ? "#fff" : INK,
            }}>{label}</button>
          ))}
        </div>

        {data === undefined ? (
          <LoadingSpinner label="Loading" size={36} minHeight="260px" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: !isMobile && pos === "ALL" ? "minmax(0, 1fr) 320px" : "1fr", gap: "18px", alignItems: "start" }}>
            <Board rows={rows} scope={scope} title={`${posLabel}`} metric={metric} isMobile={isMobile} />
            {pos === "ALL" && (
              <div style={{ border: `1px solid ${LINE}`, borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
                <div style={{ background: BLUE, padding: "12px 16px", color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                  Top at Each Position
                </div>
                {leaders.map((l, i) => (
                  <button key={l.g} type="button" onClick={() => set("pos", l.g, "ALL")} style={{
                    display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: "10px 14px", background: "#fff", border: "none", cursor: "pointer",
                    borderBottom: i < leaders.length - 1 ? `1px solid ${LINE_2}` : "none", textAlign: "left", fontFamily: "inherit",
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = SOFT; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
                    <span style={{ flexShrink: 0, width: "34px", textAlign: "center", background: BLUE, color: "#fff", borderRadius: "4px", padding: "3px 0", fontSize: "11px", fontWeight: 900 }}>{l.g}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: "13px", fontWeight: 900, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.top.length === 0 ? "—" : l.top.length === 1 ? l.top[0].k : `${l.top[0].k} +${l.top.length - 1}`}
                      </span>
                      <span style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#7a8594" }}>{l.label}</span>
                    </span>
                    <span style={{ flexShrink: 0, fontSize: "16px", fontWeight: 900, color: BLUE, fontVariantNumeric: "tabular-nums" }}>{l.v || ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// The ranked list. A school with a page (a logo uploaded) links to it.
function Board({ rows, scope, title, metric, isMobile }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div style={{ background: BLUE, padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.14em", textTransform: "uppercase" }}>{title}</span>
        <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.75)", fontWeight: 900, fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {metric === "cfb" ? "Players" : "Picks"}
        </span>
      </div>
      <div style={{ height: "3px", background: GOLD }} />
      {rows.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>No schools ranked here yet.</div>
      ) : rows.map((r, i) => {
        const inner = (
          <>
            <span style={{ flexShrink: 0, width: isMobile ? "36px" : "44px", textAlign: "right", fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: r.r <= 3 ? GOLD : "#8a94a3", fontVariantNumeric: "tabular-nums" }}>{rankText(r.r, r.t)}</span>
            <span style={{ flexShrink: 0, width: isMobile ? "28px" : "34px", height: isMobile ? "28px" : "34px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {r.logo
                ? <img src={r.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                : <span style={{ width: "100%", height: "100%", borderRadius: "50%", background: LINE_2, color: "#9aa5b4", fontSize: "10px", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{r.st}</span>}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: isMobile ? "14px" : "16px", fontWeight: 900, color: r.slug ? BLUE : INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.k}</span>
              {scope === "US" && <span style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#7a8594" }}>{STATE_NAME[r.st] || r.st}</span>}
            </span>
            <span style={{ flexShrink: 0, fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: INK, fontVariantNumeric: "tabular-nums", minWidth: "36px", textAlign: "right" }}>{r.v}</span>
          </>
        );
        const style = {
          display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px", padding: isMobile ? "10px 12px" : "12px 18px",
          textDecoration: "none", background: "#fff", borderBottom: i < rows.length - 1 ? `1px solid ${LINE_2}` : "none",
        };
        return r.slug ? (
          <Link key={`${r.k}|${r.st}`} to={`/hs/${r.slug}`} style={style}
            onMouseEnter={(e) => { e.currentTarget.style.background = SOFT; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>{inner}</Link>
        ) : <div key={`${r.k}|${r.st}`} style={style}>{inner}</div>;
      })}
    </div>
  );
}
