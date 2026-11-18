// src/components/portalSim/PortalCommunity.jsx
//
// The Transfer Portal Sim's community side (user, 2026-11-18), mirroring the
// Draft Sim's (components/draftSim/SavedSims.jsx, SimCommunity.jsx,
// RecentSims.jsx, SimResults.jsx SaveButton / ShareFlow):
//   SimTabs        New Portal · My Classes · Community — over the setup
//                  screen and over a finished run ("This Portal")
//   MyClasses      /portalsim/classes — the user's saved classes, public or
//                  private, shareable, deletable; a summary on top
//   PortalCommunity /portalsim/community — Insights (from EVERY finished run,
//                  shared or not: classes signed, the most valued transfer,
//                  the schools users run, how they value positions, the
//                  most-signed transfers) and Recent Classes (/portalsim/recent)
//   SaveClassButton / ShareClass / DraftSimPromo — the Final screen's
//                  save-to-profile, branded image and Draft Sim pitch
// Saves and public copies: utils/portalSim/publicSims.js.
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../../context/AuthContext";
import { getSiteSnapshot } from "../../utils/siteSnapshots";
import { renderShareImage } from "../../utils/exportImages";
import { textOn } from "../../utils/teamColors";
import ShareSheet, { ShareIcon, ShareImagePreview, shareActions } from "../ShareSheet";
import LoadingSpinner from "../LoadingSpinner";
import TransferStars from "../TransferStars";
import {
  savePortalSim, setPortalSimVisibility, deletePortalSim, loadMyPortalSims, loadRecentPortalSims,
  portalInsights, portalTotals, loadPortalResults, gradeIndex, WEEK_MS, CLASSES_PATH, COMMUNITY_PATH, RECENT_PATH, SIM_PATH,
} from "../../utils/portalSim/publicSims";
import { SIM_YEAR } from "../../utils/draftSim/years";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const SUB = "#8b9bb4";
const LINE = "#1f2b42";
export const PANEL = { background: "#0e1626", border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden" };
const SITE = "https://we-draft.com";
// The sim's own money format (utils/portalSim/data.js money), without pulling in its loader.
const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n || 0)}`);
export const gradeColor = (g = "") => (g.startsWith("A") ? "#7ee2a8" : g.startsWith("B") ? "#9fc3ff" : g.startsWith("C") ? GOLD : "#ff8a7a");
const VERDICT_COLOR = { "Much Better": "#2ee08a", "Got Better": "#7ee2a8", "Made Whole": "#9fc3ff", "Got Worse": "#ff9f43", "Much Worse": "#ff6b5b" };
const fmtPct = (v) => `${v > 0 ? "+" : ""}${(v || 0).toFixed(1)}%`;
const chip = (on) => ({
  border: `2px solid ${on ? GOLD : "#24324d"}`, background: on ? GOLD : "#0e1626", color: on ? "#fff" : "#c9d4e5",
  borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: 11, letterSpacing: "0.05em",
});
export const action = { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #2a3a58", background: "#121c2f", color: "#fff", borderRadius: 999, padding: "7px 13px", fontSize: 11, fontWeight: 900, letterSpacing: "0.05em", textDecoration: "none", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const label = { color: SUB, fontSize: 10, fontWeight: 900, letterSpacing: "0.14em" };
const heading = { color: "#fff", fontSize: 13, fontWeight: 900, letterSpacing: "0.12em", marginBottom: 10 };

// FBS branding ({ [slug]: { School, Color1, Color2, Logo1, LogoDark, LogoBlack } }),
// from the same snapshot the sim reads — one cached read.
export function useBranding(initial) {
  const [b, setB] = useState(initial || null);
  useEffect(() => {
    if (initial) { setB(initial); return undefined; }
    let live = true;
    getSiteSnapshot("_cfbTeams").then((d) => live && setB(d?.teams || {})).catch(() => live && setB({}));
    return () => { live = false; };
  }, [initial]);
  return b;
}
const darkLogo = (b) => b?.LogoBlack || b?.LogoDark || b?.Logo1 || "";
const colorLogo = (b) => b?.LogoDark || b?.Logo1 || "";
const Logo = ({ src, size, alt = "" }) => (src
  ? <img src={src} alt={alt} title={alt} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
  : <span style={{ width: size, flexShrink: 0 }} />);

// ── Tabs: New Portal · My Classes · Community (the Draft Sim's SetupTabs). ──
// thisRun: over a finished run — "New Portal" reads "This Portal".
export function SimTabs({ tab, onTab, isMobile, thisRun = false }) {
  const tabStyle = (on) => ({
    border: "none", borderBottom: `3px solid ${on ? GOLD : "transparent"}`, background: "none", color: on ? "#fff" : SUB,
    padding: "8px 4px", marginRight: isMobile ? 14 : 20, cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: isMobile ? 11 : 13,
    letterSpacing: isMobile ? "0.05em" : "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0,
  });
  const tabs = [["new", thisRun ? "This Portal" : "New Portal", thisRun ? "This Portal" : "New"], ["classes", "My Classes", "My Classes"], ["community", "Community", "Community"]];
  return (
    <div role="tablist" style={{ display: "flex", borderBottom: `1px solid ${LINE}`, marginBottom: 14, overflowX: "auto" }}>
      {tabs.map(([key, text, short]) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => onTab(key)} style={tabStyle(tab === key)}>{isMobile ? short : text}</button>
      ))}
    </div>
  );
}

export function SubTabs({ views, view, onView }) {
  return (
    <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
      {views.map(([k, text]) => <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => onView(k)} style={chip(view === k)}>{text.toUpperCase()}</button>)}
    </div>
  );
}

// ── One saved class: its school's colors, the grade and verdict, its signings. ──
export function ClassCard({ s, branding, maxRows = Infinity, footer = null, byline = null }) {
  const [all, setAll] = useState(false);
  const b = branding[s.team] || {};
  const c1 = b.Color1 || BLUE;
  const ink = textOn(c1, b.Color2 || GOLD);
  const list = s.signings || [];
  const shown = all ? list : list.slice(0, maxRows);
  return (
    <div style={PANEL}>
      {byline}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: `linear-gradient(115deg, ${c1} 0%, ${c1} 60%, color-mix(in srgb, ${b.Color2 || GOLD} 55%, ${c1}) 100%)`, color: ink }}>
        <Logo src={colorLogo(b)} size={32} alt={s.school} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`${SIM_PATH}/${s.team}`} style={{ display: "block", color: "inherit", fontWeight: 900, fontSize: 15, textTransform: "uppercase", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.school || b.School || s.team}</Link>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", opacity: 0.9 }}>
            {s.season} PORTAL{s.verdict ? ` · ${s.verdict.toUpperCase()} ${fmtPct(s.pct)}` : ""}
          </div>
        </div>
        {s.eff && <span title="Money efficiency" style={{ textAlign: "center", background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "2px 8px" }}>
          <span style={{ display: "block", fontSize: 8, fontWeight: 900, letterSpacing: "0.1em", color: "#fff", opacity: 0.85 }}>EFF</span>
          <span style={{ display: "block", fontSize: 15, fontWeight: 900, color: gradeColor(s.eff), lineHeight: 1 }}>{s.eff}</span>
        </span>}
        <span title={s.rank ? `#${s.rank} class of ${s.of}` : "Class grade"} style={{ background: "rgba(0,0,0,0.35)", color: gradeColor(s.grade || ""), borderRadius: 8, padding: "2px 10px", fontSize: 22, fontWeight: 900 }}>{s.grade || "—"}</span>
      </div>
      <div style={{ background: "#0b1322", padding: "4px 0" }}>
        <div style={{ display: "flex", gap: 10, padding: "4px 12px 6px", fontSize: 11, fontWeight: 800, color: SUB, flexWrap: "wrap" }}>
          <span>{list.length} signed</span>
          {s.lost != null && <span>{s.lost} lost</span>}
          {s.kept ? <span>{s.kept} kept</span> : null}
          {s.spent ? <span>{money(s.spent)} NIL</span> : null}
          {s.rank ? <span>#{s.rank} class</span> : null}
        </div>
        {list.length === 0 && <div style={{ padding: "6px 12px 10px", fontSize: 12, color: SUB, fontWeight: 700 }}>No signings out of the portal.</div>}
        {shown.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", fontSize: 12, minWidth: 0 }}>
            <TransferStars stars={p.stars} size="sm" />
            <span style={{ width: 34, flexShrink: 0, textAlign: "center", fontSize: 10, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "2px 0" }}>{p.pos}</span>
            <span style={{ flex: 1, minWidth: 0, color: "#fff", fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
            <Logo src={darkLogo(branding[p.from])} size={16} alt={p.fromSchool} />
            <span style={{ width: 52, textAlign: "right", fontWeight: 900, color: "#7ee2a8", flexShrink: 0 }}>{money(p.nil)}</span>
          </div>
        ))}
        {list.length > shown.length && (
          <button type="button" onClick={() => setAll(true)} style={{ display: "block", width: "100%", background: "none", border: "none", color: GOLD, fontFamily: "inherit", fontWeight: 900, fontSize: 11, letterSpacing: "0.06em", padding: "6px 12px", cursor: "pointer", textAlign: "left" }}>
            SHOW ALL {list.length} ▾
          </button>
        )}
      </div>
      {footer}
    </div>
  );
}

// The class as text — for Messages / X / copy.
export function classShareText(s, url) {
  const top = (s.signings || []).slice(0, 5).map((p) => `${p.stars}★ ${p.pos} ${p.name}${p.fromSchool ? ` (${p.fromSchool})` : ""}`);
  return [
    `My ${s.season} ${s.school} transfer portal class: ${s.grade || "—"}${s.rank ? ` (#${s.rank} in the country)` : ""}${s.verdict ? ` · ${s.verdict}` : ""}`,
    ...top,
    (s.signings || []).length > 5 ? `+${s.signings.length - 5} more` : null,
    "",
    `Run yours: ${url || `${SITE}${SIM_PATH}/${s.team}`}`,
  ].filter((x) => x !== null).join("\n");
}

// ── My Classes ──
export function MyClasses({ branding, isMobile }) {
  const { user, profile, login } = useAuth();
  const [sims, setSims] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (!user) { setSims(null); return undefined; }
    let live = true;
    loadMyPortalSims(user.uid).then((list) => live && setSims(list))
      .catch((e) => { console.error("Saved portal classes load error:", e); if (live) setSims([]); });
    return () => { live = false; };
  }, [user]);
  const head = (
    <Helmet>
      <title>My Transfer Portal Classes | We-Draft.com</title>
      <meta name="robots" content="noindex" />
    </Helmet>
  );
  const remove = async (id) => {
    if (!window.confirm("Delete this saved portal class?")) return;
    try {
      await deletePortalSim(user.uid, id);
      setSims((list) => list.filter((s) => s.id !== id));
    } catch (e) {
      console.error("Portal class delete error:", e);
      alert("Couldn't delete that class — try again.");
    }
  };
  const toggle = async (s) => {
    const visibility = s.visibility === "public" ? "private" : "public";
    setBusy(s.id);
    try {
      await setPortalSimVisibility(user.uid, profile?.username, s, visibility);
      setSims((list) => list.map((x) => (x.id === s.id ? { ...x, visibility } : x)));
    } catch (e) {
      console.error("Portal class visibility error:", e);
      alert("Couldn't change that — try again.");
    } finally {
      setBusy("");
    }
  };
  const empty = (children) => <div style={{ ...PANEL, padding: 28, textAlign: "center", color: "#c9d4e5", fontSize: 14, lineHeight: 1.6 }}>{head}{children}</div>;
  if (!user) {
    return empty(<>
      Sign in to see the portal classes you&apos;ve saved.
      <div><button type="button" onClick={login} style={{ ...action, background: GOLD, border: "none", marginTop: 12, padding: "9px 18px" }}>SIGN IN</button></div>
    </>);
  }
  if (!sims || !branding) return <>{head}<LoadingSpinner label="Loading your classes" size={32} minHeight="30vh" /></>;
  if (!sims.length) return empty(<>No saved classes yet. Close out a portal and hit <strong style={{ color: "#fff" }}>Save to Profile</strong> — it shows up here.</>);

  // The summary: classes, best grade, schools run, players signed.
  const best = [...sims].sort((a, b) => gradeIndex(a.grade) - gradeIndex(b.grade) || (b.pct || 0) - (a.pct || 0))[0];
  const schools = new Set(sims.map((s) => s.team)).size;
  const signed = sims.reduce((n, s) => n + (s.signings || []).length, 0);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {head}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 4}, minmax(0, 1fr))`, gap: 10 }}>
        {[["CLASSES SAVED", sims.length], ["SCHOOLS RUN", schools], ["PLAYERS SIGNED", signed], ["BEST CLASS", best ? `${best.grade} · ${best.school}` : "—"]].map(([k, v]) => (
          <div key={k} style={{ ...PANEL, padding: "10px 14px", minWidth: 0 }}>
            <div style={label}>{k}</div>
            <div style={{ color: "#fff", fontSize: 20, fontWeight: 900, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{typeof v === "number" ? v.toLocaleString() : v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 12, alignItems: "start" }}>
        {sims.map((s) => {
          const date = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
          const isPublic = s.visibility === "public";
          const text = classShareText(s);
          return (
            <ClassCard key={s.id} s={s} branding={branding} maxRows={8}
              byline={<div style={{ padding: "7px 12px", fontSize: 11, color: SUB, fontWeight: 800, borderBottom: `1px solid ${LINE}` }}>{[date, s.live ? "Real portal" : s.frequency && s.frequency !== "default" ? `${s.frequency[0].toUpperCase()}${s.frequency.slice(1)} frequency` : "Projected portal"].filter(Boolean).join(" · ")}</div>}
              footer={(
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 10px 10px", borderTop: `1px solid ${LINE}` }}>
                  <button type="button" onClick={() => toggle(s)} disabled={busy === s.id} title={isPublic ? "Showing on Recent Classes — make it private" : "Private — show it on Recent Classes"}
                    style={{ ...action, color: isPublic ? "#7ee2a0" : "#9fb0c8", borderColor: isPublic ? "#2e7d4f" : "#2a3a58" }}>
                    {busy === s.id ? "…" : isPublic ? "🌐 PUBLIC" : "🔒 PRIVATE"}
                  </button>
                  <a href={`sms:?&body=${encodeURIComponent(text)}`} style={action}><ShareIcon name="message" size={14} />TEXT</a>
                  <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" style={action}><ShareIcon name="x" size={13} />POST</a>
                  <button type="button" onClick={() => remove(s.id)} style={{ ...action, color: "#f85149", marginLeft: "auto" }}>DELETE</button>
                </div>
              )} />
          );
        })}
      </div>
    </div>
  );
}

// ── Community: Insights · Recent Classes ──
export const COMMUNITY_VIEWS = [["insights", "Insights"], ["recent", "Recent Classes"]];
export function PortalCommunity({ view, onView, branding, isMobile }) {
  return (
    <div>
      <SubTabs views={COMMUNITY_VIEWS} view={view} onView={onView} />
      {!branding ? <LoadingSpinner label="Loading" size={32} minHeight="30vh" />
        : view === "recent" ? <RecentClasses branding={branding} isMobile={isMobile} /> : <Insights branding={branding} isMobile={isMobile} />}
    </div>
  );
}

const Masthead = ({ title, isMobile, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    <div style={{ marginRight: "auto" }}>
      <div style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.16em" }}>FROM THE COMMUNITY</div>
      <div style={{ color: "#fff", fontSize: isMobile ? 22 : 28, fontWeight: 900, lineHeight: 1.05 }}>{title}</div>
    </div>
    {children}
  </div>
);

// Every finished run counts, shared or not (user, 2026-11-18) —
// portalSimResults (utils/portalSim/publicSims.js): totals over all of them,
// the lists from the newest INSIGHTS_SAMPLE.
function Insights({ branding, isMobile }) {
  const [period, setPeriod] = useState("all");
  const [data, setData] = useState(undefined); // { totals, runs } | null
  // "This week" from a fixed moment per load.
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    setData(undefined);
    const since = period === "week" ? now - WEEK_MS : 0;
    Promise.all([portalTotals(since), loadPortalResults({ since })])
      .then(([totals, runs]) => live && setData({ totals, runs }))
      .catch((e) => { console.error("Portal insights load error:", e); if (live) setData(null); });
    return () => { live = false; };
  }, [period, now]);
  const ins = useMemo(() => (data ? portalInsights(data.runs) : null), [data]);
  const head = (
    <Helmet>
      <title>Transfer Portal Sim Community Insights | We-Draft.com</title>
      <meta name="description" content="What We-Draft.com Transfer Portal Sim users do: the schools they run, the transfers they sign and pay most, and how they value every position." />
      <link rel="canonical" href={`${SITE}${COMMUNITY_PATH}`} />
    </Helmet>
  );
  const nameOf = (slug) => branding[slug]?.School || slug;
  const top = ins?.mostValued;
  const maxTeam = Math.max(1, ...(ins?.topTeams || []).slice(0, 6).map((t) => t.n));
  const maxAvg = Math.max(1, ...(ins?.positions || []).map((x) => x.avg));
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {head}
      <Masthead title="PORTAL INSIGHTS" isMobile={isMobile}>
        {[["week", "THIS WEEK"], ["all", "ALL TIME"]].map(([k, t]) => <button key={k} type="button" onClick={() => setPeriod(k)} aria-pressed={period === k} style={chip(period === k)}>{t}</button>)}
      </Masthead>
      {data === undefined ? <LoadingSpinner label="Loading insights" size={32} minHeight="30vh" />
        : !data || !ins || data.totals.runs === 0 ? (
          <div style={{ ...PANEL, padding: 28, textAlign: "center", color: "#c9d4e5", fontSize: 14, lineHeight: 1.6 }}>
            {data === null ? "Insights aren't available right now — check back soon." : `No portals closed ${period === "week" ? "this week " : ""}yet — run one to the end and you're on the board.`}
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr) minmax(0, 1fr)" : "repeat(3, minmax(0, 1fr)) minmax(0, 2fr)", gap: 10 }}>
              {[["CLASSES SIGNED", data.totals.runs.toLocaleString()], ["TRANSFERS SIGNED", data.totals.signings.toLocaleString()], ["NIL SPENT", money(data.totals.spent)]].map(([k, n]) => (
                <div key={k} style={{ ...PANEL, padding: "10px 14px" }}>
                  <div style={label}>{k}</div>
                  <div style={{ color: "#fff", fontSize: 22, fontWeight: 900, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{n}</div>
                </div>
              ))}
              {/* The transfer users pay the most for, on average. */}
              <div style={{ ...PANEL, padding: "10px 14px", minWidth: 0, gridColumn: isMobile ? "1 / -1" : "auto" }}>
                <div style={label}>MOST VALUED TRANSFER</div>
                {top ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    <Logo src={darkLogo(branding[top.from])} size={26} alt={top.fromSchool} />
                    <span style={{ color: "#fff", fontWeight: 900, fontSize: 17 }}>{top.name}</span>
                    <span style={{ color: SUB, fontSize: 12, fontWeight: 800 }}>{top.stars}★ {top.pos} · {top.fromSchool}</span>
                    <span style={{ marginLeft: "auto", textAlign: "right" }} title={`${top.n} signing${top.n === 1 ? "" : "s"}`}>
                      <span style={{ display: "block", color: "#7ee2a8", fontSize: 15, fontWeight: 900 }}>{money(top.avgNil)}</span>
                      <span style={{ display: "block", color: SUB, fontSize: 10, fontWeight: 800 }}>AVG NIL · {top.n}×</span>
                    </span>
                  </div>
                ) : <div style={{ color: SUB, fontSize: 13, marginTop: 6 }}>No signings yet.</div>}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ ...PANEL, padding: 14 }}>
                  <div style={heading}>MOST POPULAR SCHOOLS</div>
                  {ins.topTeams.slice(0, 6).map((t) => (
                    <div key={t.t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                      <Logo src={darkLogo(branding[t.t])} size={22} alt={nameOf(t.t)} />
                      <Link to={`${SIM_PATH}/${t.t}`} style={{ color: "#dbe4f0", fontSize: 12, fontWeight: 900, width: isMobile ? 110 : 140, flexShrink: 0, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(t.t)}</Link>
                      <span style={{ flex: 1, minWidth: 0, height: 10, background: "#121c2f", borderRadius: 4 }}>
                        <span style={{ display: "block", width: `${(t.n / maxTeam) * 100}%`, height: "100%", background: GOLD, borderRadius: 4 }} />
                      </span>
                      <span style={{ width: 28, textAlign: "right", color: SUB, fontSize: 11, fontWeight: 900 }}>{t.n}</span>
                    </div>
                  ))}
                </div>
                {/* How users value each position: average NIL per signing
                    (the bar) and the position's share of all NIL spent. */}
                <div style={{ ...PANEL, padding: 14 }}>
                  <div style={heading}>HOW USERS VALUE POSITIONS</div>
                  <div style={{ color: SUB, fontSize: 12, marginBottom: 8 }}>Average NIL per transfer signed, and each position&apos;s share of all the NIL users spend.</div>
                  {ins.positions.length === 0 ? <div style={{ color: SUB, fontSize: 12 }}>No signings yet.</div> : ins.positions.map((x) => (
                    <div key={x.pos} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                      <span style={{ width: 40, flexShrink: 0, textAlign: "center", fontSize: 11, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "2px 0" }}>{x.pos}</span>
                      <span style={{ flex: 1, minWidth: 0, height: 10, background: "#121c2f", borderRadius: 4 }} title={`${x.n} signings`}>
                        <span style={{ display: "block", width: `${(x.avg / maxAvg) * 100}%`, height: "100%", background: "#7ee2a8", borderRadius: 4 }} />
                      </span>
                      <span style={{ width: 54, textAlign: "right", color: "#dbe4f0", fontSize: 12, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{money(x.avg)}</span>
                      <span style={{ width: 40, textAlign: "right", color: SUB, fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{Math.round(x.share * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ ...PANEL, padding: 14 }}>
                <div style={heading}>MOST SIGNED TRANSFERS</div>
                <div style={{ color: SUB, fontSize: 12, marginBottom: 8 }}>The players users sign most — and where they take them most.</div>
                {ins.topPlayers.map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: i ? "1px solid #18233a" : "none", minWidth: 0 }}>
                    <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 18, textAlign: "right" }}>{i + 1}</span>
                    <TransferStars stars={p.stars} size="sm" />
                    <span style={{ color: "#fff", fontWeight: 900, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ color: SUB, fontSize: 11, flexShrink: 0 }}>{p.pos}</span>
                    <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title={`Most often to ${nameOf(p.dest)} (${p.destN})`}>
                      <Logo src={darkLogo(branding[p.from])} size={16} alt={p.fromSchool} />
                      <span style={{ color: SUB, fontSize: 11 }}>→</span>
                      <Logo src={darkLogo(branding[p.dest])} size={16} alt={nameOf(p.dest)} />
                    </span>
                    <span style={{ width: 42, textAlign: "right", color: "#dbe4f0", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{p.n}×</span>
                  </div>
                ))}
              </div>
            </div>
            {data.totals.runs > ins.runs && <div style={{ color: SUB, fontSize: 11, fontWeight: 700 }}>Totals count every portal users have closed; the lists come from the newest {ins.runs.toLocaleString()}.</div>}
          </>
        )}
    </div>
  );
}

function RecentClasses({ branding, isMobile }) {
  const [team, setTeam] = useState("");
  const [sims, setSims] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setSims(null);
    setError(false);
    loadRecentPortalSims({ team }).then((l) => live && setSims(l))
      .catch((e) => { console.error("Recent portal classes load error:", e); if (live) { setError(true); setSims([]); } });
    return () => { live = false; };
  }, [team]);
  const schools = useMemo(() => Object.entries(branding).map(([slug, b]) => [slug, b.School || slug]).sort((a, b) => a[1].localeCompare(b[1])), [branding]);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Helmet>
        <title>Recent Transfer Portal Sim Classes | We-Draft.com</title>
        <meta name="description" content="The latest transfer portal classes users built in the We-Draft.com Transfer Portal Simulator — every signing, NIL deal and grade, by school." />
        <link rel="canonical" href={`${SITE}${RECENT_PATH}`} />
      </Helmet>
      <Masthead title="RECENT PORTAL CLASSES" isMobile={isMobile}>
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="School"
          style={{ background: "#0e1626", color: "#fff", border: `2px solid ${team ? GOLD : "#24324d"}`, borderRadius: 999, padding: "7px 12px", fontFamily: "inherit", fontWeight: 900, fontSize: 12, maxWidth: 220 }}>
          <option value="">ALL SCHOOLS</option>
          {schools.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
        </select>
      </Masthead>
      {!sims ? <LoadingSpinner label="Loading classes" size={32} minHeight="30vh" /> : sims.length === 0 ? (
        <div style={{ ...PANEL, padding: 28, textAlign: "center", color: "#c9d4e5", fontSize: 14, lineHeight: 1.6 }}>
          {error ? "Couldn't load classes — try again." : `No public classes${team ? ` for ${branding[team]?.School || team}` : ""} yet. Close out a portal and save it to your profile — it shows up here.`}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 12, alignItems: "start" }}>
          {sims.map((s) => {
            const date = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
            return (
              <ClassCard key={s.id} s={s} branding={branding} maxRows={6}
                byline={<div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "7px 12px", fontSize: 11, color: SUB, borderBottom: `1px solid ${LINE}` }}>
                  <span style={{ color: "#fff", fontWeight: 900 }}>{s.username || "We-Draft.com user"}</span>
                  <span>{[s.live ? "Real portal" : "Projected", date].filter(Boolean).join(" · ")}</span>
                </div>} />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Final screen: Save to Profile (public by default, a switch to private). ──
export function SaveClassButton({ makeRec }) {
  const { user, profile, login } = useAuth();
  const [state, setState] = useState("idle"); // idle | waiting | saving | saved | error
  const [saved, setSaved] = useState(null);
  const [toggling, setToggling] = useState(false);
  const save = async (uid) => {
    setState("saving");
    try {
      const rec = makeRec();
      const id = await savePortalSim(uid, profile?.username, rec);
      setSaved({ ...rec, id, visibility: "public" });
      setState("saved");
    } catch (e) {
      console.error("Portal class save error:", e);
      setState("error");
    }
  };
  useEffect(() => {
    if (state === "waiting" && user) save(user.uid);
  }, [state, user]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = async () => {
    if (toggling) return;
    const visibility = saved.visibility === "public" ? "private" : "public";
    setToggling(true);
    try {
      await setPortalSimVisibility(user.uid, profile?.username, saved, visibility);
      setSaved((s) => ({ ...s, visibility }));
    } catch (e) {
      console.error("Portal class visibility error:", e);
      alert("Couldn't change that — try again.");
    } finally {
      setToggling(false);
    }
  };
  const btn = { ...action, padding: "9px 16px", fontSize: 12 };
  if (state === "saved") {
    const isPublic = saved.visibility === "public";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Link to={CLASSES_PATH} style={{ ...btn, background: "#163a24", color: "#7ee2a0", borderColor: "#2e7d4f" }}>SAVED ✓ MY CLASSES</Link>
        <button type="button" onClick={toggle} disabled={toggling} title={isPublic ? "Showing on Recent Classes — tap to make it private" : "Private — tap to show it on Recent Classes"}
          style={{ ...btn, background: "transparent", color: isPublic ? "#7ee2a0" : "#9fb0c8", borderColor: isPublic ? "#2e7d4f" : "#2a3a58" }}>
          {toggling ? "…" : isPublic ? "🌐 PUBLIC · MAKE PRIVATE" : "🔒 PRIVATE · MAKE PUBLIC"}
        </button>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button type="button" onClick={() => { if (state === "saving") return; if (user) save(user.uid); else { setState("waiting"); login(); } }} disabled={state === "saving"}
        style={{ ...btn, background: "rgba(0,0,0,0.35)", borderColor: GOLD }}>
        {state === "saving" ? "SAVING…" : state === "error" ? "SAVE FAILED — RETRY" : "SAVE TO PROFILE"}
      </button>
      {state === "waiting" && <span style={{ color: "#c9d4e5", fontSize: 11, fontWeight: 700, maxWidth: 220 }}>Sign in or create a free account — it saves as soon as you&apos;re in.</span>}
    </span>
  );
}

// ── Final screen: the class as a branded image (Instagram's 4:5, 720 × 900
// captured at 1.5×), with Save image, X, Messages and Copy. ──
export function ShareClass({ rec, branding, isMobile }) {
  const cardRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState(null);
  const [failed, setFailed] = useState(false);
  const building = useRef(false);
  const url = `${SITE}${SIM_PATH}/${rec.team}`;
  const text = classShareText(rec, url);
  const build = async () => {
    if (image || building.current || !cardRef.current) return;
    building.current = true;
    setFailed(false);
    try {
      setImage(await renderShareImage(cardRef.current, { pixelRatio: 1.5, backgroundColor: "#070d18" }));
    } catch (e) {
      console.error("Portal class image error:", e);
      setFailed(true);
    } finally {
      building.current = false;
    }
  };
  const saveImage = () => {
    if (!image) return;
    const a = document.createElement("a");
    a.download = `${rec.team}-${rec.season}-portal-class.png`;
    a.href = image;
    a.click();
  };
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); build(); }} style={{ ...action, padding: "9px 16px", fontSize: 12, background: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.55)" }}>
        <ShareIcon name="download" size={14} />SAVE IMAGE / SHARE
      </button>
      {createPortal(<div style={{ position: "absolute", left: -9999, top: 0 }} aria-hidden="true"><ClassStory ref={cardRef} rec={rec} branding={branding} /></div>, document.body)}
      <ShareSheet dark open={open} onClose={() => setOpen(false)} title="Share your portal class"
        preview={<ShareImagePreview src={image} alt="Your portal class, ready to share" failed={failed} />}
        below={isMobile ? <div className="wdss-text">{text}</div> : null}
        primary={[{ label: "Save image", icon: "download", onClick: saveImage, disabled: !image }]}
        actions={[shareActions.x(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`), shareActions.text(text), shareActions.copy(text)]} />
    </>
  );
}

const STORY_W = 720;
const STORY_H = 900;
const HEAVY = "'Arial Black', Arial, sans-serif";
const starText = (n) => "★".repeat(Math.max(0, Math.min(6, n || 0)));
// The image: the school's colors, logo and name, the grade and verdict,
// then the signings (best first — as many as fit), and the footer.
export const ClassStory = forwardRef(function ClassStory({ rec, branding }, ref) {
  const b = branding[rec.team] || {};
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  const list = rec.signings || [];
  const MAX = 11;
  const shown = list.slice(0, MAX);
  const name = String(rec.school || b.School || "").toUpperCase();
  const nameSize = Math.max(34, Math.min(70, Math.floor(470 / (Math.max(name.length, 1) * 0.72))));
  return (
    <div ref={ref} style={{ width: STORY_W, height: STORY_H, position: "relative", overflow: "hidden", fontFamily: "Arial, Helvetica, sans-serif", color: "#fff", background: `linear-gradient(150deg, ${c1} 0%, color-mix(in srgb, ${c1} 70%, #000) 55%, #070d18 100%)` }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
      {colorLogo(b) && <img src={colorLogo(b)} alt="" style={{ position: "absolute", right: -90, top: -60, width: 420, height: 420, objectFit: "contain", opacity: 0.1 }} />}
      {/* Header */}
      <div style={{ position: "relative", padding: "30px 34px 0", display: "flex", alignItems: "center", gap: 18 }}>
        {colorLogo(b) && <img src={colorLogo(b)} alt="" style={{ width: 96, height: 96, objectFit: "contain", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.45))" }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "inline-block", background: GOLD, color: "#111", fontWeight: 900, fontSize: 13, letterSpacing: "0.14em", padding: "4px 10px", borderRadius: 6 }}>MY {rec.season} TRANSFER PORTAL CLASS</div>
          <div style={{ fontFamily: HEAVY, fontSize: nameSize, lineHeight: 1, marginTop: 8, textShadow: "4px 4px 0 rgba(0,0,0,0.35)", whiteSpace: "nowrap" }}>{name}</div>
        </div>
      </div>
      {/* Grade row */}
      <div style={{ position: "relative", display: "flex", gap: 10, padding: "18px 34px 0" }}>
        {[["CLASS GRADE", rec.grade || "—", gradeColor(rec.grade || ""), rec.rank ? `#${rec.rank} OF ${rec.of}` : ""], ["MONEY EFF.", rec.eff || "—", gradeColor(rec.eff || ""), money(rec.spent || 0)], ["ROSTER", rec.verdict ? rec.verdict.toUpperCase() : "—", VERDICT_COLOR[rec.verdict] || "#fff", fmtPct(rec.pct)]].map(([k, v, color, sub], i) => (
          <div key={k} style={{ flex: i === 2 ? 1.5 : 1, background: "rgba(0,0,0,0.38)", border: `2px solid ${i === 0 ? c2 : "rgba(255,255,255,0.15)"}`, borderRadius: 14, padding: "8px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.85 }}>{k}</div>
            <div style={{ fontFamily: HEAVY, fontSize: i === 2 ? 24 : 40, lineHeight: i === 2 ? "48px" : 1.1, color }}>{v}</div>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>{sub}</div>
          </div>
        ))}
      </div>
      {/* Signings */}
      <div style={{ position: "relative", margin: "16px 34px 0", background: "rgba(0,0,0,0.42)", borderRadius: 16, padding: "6px 0" }}>
        {shown.length === 0 && <div style={{ padding: "26px 16px", textAlign: "center", fontWeight: 900, fontSize: 18, opacity: 0.85 }}>Ran it back — no portal signings.</div>}
        {shown.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px", height: 46, borderTop: i ? "1px solid rgba(255,255,255,0.08)" : "none" }}>
            <span style={{ width: 62, color: GOLD, fontSize: 15, letterSpacing: "-1px", flexShrink: 0 }}>{starText(p.stars)}</span>
            <span style={{ width: 44, flexShrink: 0, textAlign: "center", fontSize: 13, fontWeight: 900, background: "rgba(255,255,255,0.14)", borderRadius: 6, padding: "3px 0" }}>{p.pos}</span>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: 19, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
            {colorLogo(branding[p.from]) ? <img src={colorLogo(branding[p.from])} alt="" style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 28 }} />}
            <span style={{ width: 70, textAlign: "right", fontWeight: 900, fontSize: 16, color: "#7ee2a8", flexShrink: 0 }}>{money(p.nil)}</span>
          </div>
        ))}
        {list.length > MAX && <div style={{ padding: "6px 16px 4px", fontWeight: 900, fontSize: 14, opacity: 0.8 }}>+{list.length - MAX} MORE</div>}
      </div>
      {/* Footer */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 70, background: "#070d18", borderTop: `4px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 34px" }}>
        <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: "0.14em" }}>BUILD YOURS</span>
        <span style={{ fontFamily: HEAVY, fontSize: 22, color: GOLD }}>WE-DRAFT.COM/PORTALSIM</span>
      </div>
    </div>
  );
});

// ── Final screen: on to the Draft Sim. ──
// toNfl: how many of the user's players left for the draft.
export function DraftSimPromo({ toNfl = 0, school, isMobile }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 18, flexWrap: "wrap", padding: isMobile ? "14px" : "16px 22px", background: "radial-gradient(500px 180px at 10% -40%, #12305c 0%, #070d18 75%), #070d18", borderTop: `2px solid ${GOLD}`, borderBottom: `1px solid ${LINE}` }}>
      <span style={{ background: "#c8102e", borderRadius: 5, padding: "3px 9px", fontWeight: 900, fontSize: 10, letterSpacing: "0.14em", flexShrink: 0 }}>UP NEXT · DRAFT SIM</span>
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        <div style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: isMobile ? 17 : 20, textTransform: "uppercase", lineHeight: 1.15 }}>
          Your roster&apos;s set. Now run the <span style={{ color: GOLD }}>{SIM_YEAR} NFL Draft</span>.
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)", marginTop: 4, lineHeight: 1.45 }}>
          {toNfl > 0
            ? `${toNfl} ${school ? `${school} ` : ""}${toNfl === 1 ? "player" : "players"} headed to the draft. See where they land: make every pick in the Mock Draft Simulator, trade up or down and get a grade for your class.`
            : "Make every pick in the Mock Draft Simulator: draft for one team or all 32, trade up or down and get a live grade from the analyst desk."}
        </div>
      </div>
      <Link to="/draftsim" style={{ flexShrink: 0, background: GOLD, color: "#fff", borderRadius: 999, padding: "11px 22px", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none", boxShadow: "0 6px 18px rgba(246,162,29,0.3)" }}>
        Run the Draft Sim →
      </Link>
    </div>
  );
}
