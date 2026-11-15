// src/components/portalSim/PlayerCard.jsx
//
// The Portal Sim's player card (pages/PortalSim.jsx) — opens from Offer (or
// a player's name): a mini player profile with the recruitment built in.
//   header    his name (biggest, on top), old school → ? (or → his new one),
//             stars / position / status, headshot (ESPN's college headshot —
//             CFBD player ids are ESPN athlete ids), star-to-board
//   bio       height / weight, hometown, high school, recruiting stars,
//             seasons left, last season's role, a link to his We-Draft profile
//   grade     the We-Draft draft grade (community), his class, strengths and
//             weaknesses — when he has one
//   stats     last season (cfbRosters players[].s — one read per team,
//             cached: cfbRosters where school ==); hidden when there are none
//   interest  every school that's offered (and yours as you build it): NIL,
//             where he'd fit in that room, and how interested he is — his grade
//             of the offer plus what it's built by standing (offering early
//             helps), the leader marked, the bar he needs to commit
//   offer     NIL only — players judge the room, not promised roles (user,
//             2026-11-14): where he'd fit in yours and how he sees your offer
//             on each factor. A big enough offer commits him on the spot
//             (engine instantAmount) — never shown to the user.
// Branding: a player who's committed / transferred wears his NEW school in
// the header; an on-the-spot commit plays a celebration (the new colors
// wipe in, the logo pops with a COMMITTED stamp, confetti).
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import TransferStars from "../TransferStars";
import { gradeOffer, fitAt, offeredThisWindow, happinessOf, offerHit } from "../../utils/portalSim/engine";
import { FACTORS, commitBar } from "../../utils/portalSim/models";
import { money } from "../../utils/portalSim/data";
import { gradeLabel, gradeLook } from "../../utils/gradeScale";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#eef2f8";
const SUB = "#8b9bb4";
const LINE = "#1f2b42";
const GREEN = "#7ee2a8";
const RED = "#ff8a7a";
const ROLE_LABEL = { starter: "Starter", rotation: "Rotation", reserve: "Reserve", none: "Didn't play" };
const FIT_LABEL = { starter: "Starter", rotation: "Rotation", depth: "Depth" };
const FIT_COLOR = { starter: GREEN, rotation: GOLD, depth: RED };
const CELEBRATE_CSS = `
  @keyframes wdcWipe { from { clip-path: circle(0% at 82% 60%); } to { clip-path: circle(150% at 82% 60%); } }
  @keyframes wdcPop { 0% { transform: scale(0) rotate(-12deg); opacity: 0; } 55% { transform: scale(1.25) rotate(4deg); opacity: 1; } 75% { transform: scale(0.95) rotate(0); } 100% { transform: scale(1); opacity: 1; } }
  @keyframes wdcStamp { 0% { transform: scale(2.4) rotate(-14deg); opacity: 0; } 60% { transform: scale(0.92) rotate(-8deg); opacity: 1; } 100% { transform: scale(1) rotate(-8deg); opacity: 1; } }
  @keyframes wdcFall { 0% { transform: translate3d(0,-20px,0) rotate(0); opacity: 1; } 100% { transform: translate3d(var(--dx), var(--dy), 0) rotate(var(--rot)); opacity: 0; } }
  @keyframes wdcOut { 0%, 75% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes wdcShine { from { transform: translateX(-120%) skewX(-20deg); } to { transform: translateX(380%) skewX(-20deg); } }
  @media (prefers-reduced-motion: reduce) { .wdc-anim { animation-duration: 1ms !important; animation-delay: 0s !important; } }
`;
const VALUE_LABEL = { tier: "Program", nil: "NIL", loc: "Close to home", pt: "Playing time", success: "Winning", dev: "Development" };

// One cfbRosters doc per school, fetched once a session.
const rosterCache = new Map();
function rosterRow(school, id) {
  if (!rosterCache.has(school)) {
    rosterCache.set(school, getDocs(query(collection(db, "cfbRosters"), where("school", "==", school), limit(1)))
      .then((snap) => new Map((snap.docs[0]?.data()?.players || []).map((r) => [String(r.id), r])))
      .catch(() => new Map()));
  }
  return rosterCache.get(school).then((m) => m.get(String(id)) || null);
}

const ft = (inches) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null);
const pctTxt = (v) => (v == null ? null : `${(Number(v) * (Number(v) <= 1 ? 100 : 1)).toFixed(1)}%`);
const num = (v) => (v == null ? null : Number(v).toLocaleString());

// The stat tiles for his position group — only what's there.
function statTiles(pos, s) {
  if (!s) return [];
  const g = (c, k) => s[c]?.[k];
  const t = (label, v) => (v == null ? null : [label, v]);
  const out = {
    QB: [t("Pass Yds", num(g("passing", "YDS"))), t("Pass TD", g("passing", "TD")), t("INT", g("passing", "INT")), t("Comp %", pctTxt(g("passing", "PCT"))), t("Yds/Att", g("passing", "YPA")), t("Rush Yds", num(g("rushing", "YDS"))), t("Rush TD", g("rushing", "TD"))],
    RB: [t("Carries", g("rushing", "CAR")), t("Rush Yds", num(g("rushing", "YDS"))), t("Yds/Car", g("rushing", "YPC")), t("Rush TD", g("rushing", "TD")), t("Rec", g("receiving", "REC")), t("Rec Yds", num(g("receiving", "YDS"))), t("Rec TD", g("receiving", "TD"))],
    WR: [t("Rec", g("receiving", "REC")), t("Rec Yds", num(g("receiving", "YDS"))), t("Yds/Rec", g("receiving", "YPR")), t("Rec TD", g("receiving", "TD")), t("Long", g("receiving", "LONG")), t("Rush Yds", num(g("rushing", "YDS")))],
    K: [t("FG", g("kicking", "FGM") != null ? `${g("kicking", "FGM")}/${g("kicking", "FGA")}` : null), t("FG %", pctTxt(g("kicking", "PCT"))), t("Long", g("kicking", "LONG")), t("XP", g("kicking", "XPM") != null ? `${g("kicking", "XPM")}/${g("kicking", "XPA")}` : null), t("Points", g("kicking", "PTS"))],
    P: [t("Punts", g("punting", "NO")), t("Yds/Punt", g("punting", "YPP")), t("Inside 20", g("punting", "In 20")), t("Long", g("punting", "LONG")), t("Touchbacks", g("punting", "TB"))],
    DEF: [t("Tackles", g("defensive", "TOT")), t("Solo", g("defensive", "SOLO")), t("TFL", g("defensive", "TFL")), t("Sacks", g("defensive", "SACKS")), t("QB Hurries", g("defensive", "QB HUR")), t("PD", g("defensive", "PD")), t("INT", g("interceptions", "INT"))],
  };
  const key = pos === "TE" ? "WR" : ["QB", "RB", "WR", "K", "P"].includes(pos) ? pos : pos === "OL" ? null : "DEF";
  return key ? out[key].filter(Boolean) : [];
}

const pill = (on, color = BLUE) => ({
  border: `1px solid ${on ? color : LINE}`, background: on ? color : "transparent", color: on ? "#fff" : INK,
  borderRadius: 999, padding: "7px 13px", fontWeight: 900, fontSize: 12, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
});
const H = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "18px 0 8px", flexWrap: "wrap" }}>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", color: SUB, textTransform: "uppercase" }}>{children}</div>
    <span style={{ flex: 1, height: 1, background: LINE, minWidth: 20 }} />
    {right}
  </div>
);
const Logo = ({ b, size = 26 }) => {
  const src = b?.LogoDark || b?.Logo1;
  return <span style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{src ? <img src={src} alt={b?.School || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : null}</span>;
};
const Box = ({ label, children }) => (
  <div style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 10px" }}>
    <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 900, marginTop: 2 }}>{children}</div>
  </div>
);

export default function PlayerCard({ pid, sim, team, brand, isMobile, onClose }) {
  const { state, view } = sim;
  const p = state.players[pid];
  const [row, setRow] = useState(undefined); // undefined loading, null none
  const mine = p?.offers?.[team];
  const [nil, setNil] = useState(mine?.nil ?? p?.ask ?? 0);
  const [shot, setShot] = useState(true);
  // Commit celebration: plays when he goes portal → committed while open.
  const [celebrate, setCelebrate] = useState(0);
  const prevStatus = useRef(p?.status);
  useEffect(() => {
    if (prevStatus.current === "portal" && p?.status === "committed") setCelebrate(Date.now());
    prevStatus.current = p?.status;
  }, [p?.status]);
  useEffect(() => {
    if (!celebrate) return undefined;
    const t = setTimeout(() => setCelebrate(0), 3600);
    return () => clearTimeout(t);
  }, [celebrate]);
  const confetti = useMemo(() => Array.from({ length: celebrate ? 70 : 0 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.5, dur: 1.4 + Math.random() * 1.2, dx: `${(Math.random() - 0.5) * 220}px`,
    dy: `${260 + Math.random() * 380}px`, rot: `${(Math.random() - 0.5) * 900}deg`, w: 6 + Math.random() * 7, i,
  })), [celebrate]);

  const home = state.teams[p?.team];
  useEffect(() => { if (home) rosterRow(home.school, pid).then(setRow); }, [home, pid]);
  // Esc closes; the page behind doesn't scroll.
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);

  // A school he's cut from his list can't offer again.
  const cutYou = p?.cut?.[team] || null;
  const canOffer = sim.phase === "window" && p?.status === "portal" && !cutYou;
  // His interest in every offer — yours as you're building it (it keeps the
  // interest it's built if you're raising an offer that's out there).
  const interest = useMemo(() => {
    if (!p) return [];
    const list = Object.entries(p.offers).filter(([k]) => k !== team).map(([slug, o]) => ({ slug, o, ...gradeOffer(state, slug, p, o), fit: fitAt(state, slug, p).fit }));
    if (canOffer || mine) {
      const o = { nil, since: mine?.since ?? state.window };
      list.push({ slug: team, o, ...gradeOffer(state, team, p, o), fit: fitAt(state, team, p).fit, yours: true, draft: !mine || mine.nil !== nil });
    }
    return list.sort((a, b) => b.grade - a.grade);
  }, [p, state, team, nil, canOffer, mine]);
  if (!p) return null;

  const max = view.available + (mine?.nil || 0);
  const b = brand(p.team) || {};
  // The header wears his new school once he's committed / transferred.
  const nb = p.status === "committed" ? brand(p.to) || b : null;
  const hb = nb || b;
  const c1 = hb.Color1 || BLUE;
  const c2 = hb.Color2 || GOLD;
  const o1 = b.Color1 || BLUE;
  const o2 = b.Color2 || GOLD;
  const yours = interest.find((x) => x.yours);
  const bar = commitBar(p, state.window || 1, state.windows, state.cfg, home?.tier);
  const top = interest[0];
  const room = fitAt(state, team, p);
  // One move per player per window; going lower than before upsets him.
  const moved = offeredThisWindow(state, team, p);
  // His happiness with you, and what this offer would cost it.
  const happy = happinessOf(p, team);
  const hit = offerHit(state, team, p, nil);
  const happyAfter = Math.max(0, happy - hit.drop);
  const happyColor = (h) => (h >= 80 ? GREEN : h >= 50 ? GOLD : RED);
  const pts = (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
  const weights = p.personality;
  const wsum = FACTORS.reduce((a, k) => a + (weights[k] || 0), 0) || 1;
  const tiles = statTiles(p.pos, row?.s);
  const label = p.dg != null ? gradeLabel(p.dg) : null;
  const look = label ? gradeLook(label) : null;
  const draftClass = row?.slug?.match(/-(\d{4})-[a-z]+$/)?.[1] || null;
  const slideMax = Math.max(Math.round((p.ask * 2.5) / 1000) * 1000, 10000);
  const to = p.status === "committed" ? p.to : null;
  // Moving: in the portal, signed somewhere, or unsigned — the → ? and the
  // recruitment only show then (a player still on a roster has neither).
  const moving = ["portal", "committed", "unsigned"].includes(p.status);
  const status = p.status === "portal" ? ["In the portal", GOLD] : p.status === "committed" ? [`Committed to ${state.teams[p.to]?.school}`, GREEN] : p.status === "unsigned" ? ["Unsigned", SUB] : ["", SUB];
  const bio = [
    row?.ht || row?.wt ? ["Height / Weight", [ft(row?.ht), row?.wt ? `${row.wt} lbs` : null].filter(Boolean).join(" · ")] : null,
    row?.home ? ["Hometown", row.home] : null,
    row?.hs ? ["High school", [row.hs, row.hss].filter(Boolean).join(", ")] : null,
    row?.stars ? ["Recruit", `${row.stars}★${row.rank ? ` · #${row.rank} nationally` : ""}${row.rc ? ` · ${row.rc} class` : ""}`] : null,
    ["Eligibility", `${p.elig} season${p.elig === 1 ? "" : "s"} left`],
    ["Last season", ROLE_LABEL[p.role] || "—"],
  ].filter(Boolean);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(3,7,14,0.72)", display: "flex", alignItems: isMobile ? "stretch" : "flex-start", justifyContent: "center", padding: isMobile ? 0 : "70px 16px 24px", overflowY: "auto" }}>
      <div role="dialog" aria-label={p.name} onClick={(e) => e.stopPropagation()} className="wd-sim-pop wd-sim-scroll" style={{
        position: "relative", width: "100%", maxWidth: 860, background: "#0e1626", border: isMobile ? "none" : `1px solid ${LINE}`, borderRadius: isMobile ? 0 : 18, overflow: "hidden", color: INK,
        maxHeight: isMobile ? "100%" : "none", overflowY: isMobile ? "auto" : "visible", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <style>{CELEBRATE_CSS}</style>
        {/* Header, in his school's colors (his new one once he's committed):
            name on top, old school → ? (or → the new one). */}
        <div style={{ position: "relative", overflow: "hidden", background: celebrate ? `linear-gradient(115deg, ${o1} 0%, ${o1} 50%, color-mix(in srgb, ${o2} 70%, ${o1}) 100%)` : `linear-gradient(115deg, ${c1} 0%, ${c1} 50%, color-mix(in srgb, ${c2} 70%, ${c1}) 100%)` }}>
          {/* On a commit: the new school's colors wipe in over the old. */}
          {celebrate ? <div key={celebrate} className="wdc-anim" style={{ position: "absolute", inset: 0, background: `linear-gradient(115deg, ${c1} 0%, ${c1} 50%, color-mix(in srgb, ${c2} 70%, ${c1}) 100%)`, animation: "wdcWipe .9s cubic-bezier(.6,0,.2,1) both" }} /> : null}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 85% 120%, rgba(0,0,0,0.05), rgba(0,0,0,0.55) 70%)" }} />
          {/* A big faint logo behind it all — his new school's once committed. */}
          {(hb.LogoDark || hb.Logo1) && <img key={hb.School} src={hb.LogoDark || hb.Logo1} alt="" aria-hidden="true" className="wdc-anim" style={{ position: "absolute", right: -30, top: -40, width: isMobile ? 190 : 280, opacity: 0.12, pointerEvents: "none", animation: celebrate ? "wdcPop .8s .4s both" : undefined }} />}
          {celebrate ? <div key={`s${celebrate}`} className="wdc-anim" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "30%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)", animation: "wdcShine 1.1s .5s ease-out both", pointerEvents: "none" }} /> : null}
          <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: isMobile ? 10 : 18, padding: isMobile ? "14px 14px 0" : "18px 22px 0" }}>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: isMobile ? 14 : 18 }}>
              <div style={{ fontSize: isMobile ? 30 : 48, fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, letterSpacing: "-0.01em", paddingRight: isMobile ? 70 : 150, textShadow: "0 2px 12px rgba(0,0,0,0.35)" }}>{p.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: isMobile ? 10 : 14 }}>
                <Logo b={b} size={isMobile ? 34 : 44} />
                {moving && <span style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, opacity: 0.85 }}>→</span>}
                {!moving ? null : to ? <span key={celebrate || "to"} className="wdc-anim" style={{ display: "inline-flex", animation: celebrate ? "wdcPop .7s .35s cubic-bezier(.2,.8,.2,1) both" : undefined }}><Logo b={brand(to)} size={isMobile ? 34 : 44} /></span>
                  : <span aria-label="Undecided" style={{ width: isMobile ? 34 : 44, height: isMobile ? 34 : 44, borderRadius: "50%", border: "2px dashed rgba(255,255,255,0.6)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 18 : 22, fontWeight: 900 }}>?</span>}
                <div style={{ minWidth: 0, marginLeft: 4 }}>
                  <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{home?.school}{to ? ` → ${state.teams[to]?.school}` : ""}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <TransferStars stars={p.stars} size="sm" />
                    <span style={{ fontSize: 11, fontWeight: 900, background: "rgba(0,0,0,0.35)", borderRadius: 6, padding: "3px 7px" }}>{p.pos}</span>
                    {status[0] && <span style={{ fontSize: 11, fontWeight: 900, color: status[1] }}>{status[0]}</span>}
                    {p.team === team && <span style={{ fontSize: 11, fontWeight: 900, color: RED }}>Your player</span>}
                  </div>
                </div>
              </div>
            </div>
            {shot && <img src={`https://a.espncdn.com/i/headshots/college-football/players/full/${p.id}.png`} alt="" onError={() => setShot(false)}
              style={{ flexShrink: 0, height: isMobile ? 110 : 160, width: "auto", objectFit: "contain", alignSelf: "flex-end", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }} />}
          </div>
          {celebrate ? (
            <div key={`c${celebrate}`} aria-live="polite" style={{ position: "absolute", inset: 0, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div className="wdc-anim" style={{ animation: "wdcOut 3.6s both" }}>
                <div className="wdc-anim" style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, background: "rgba(0,0,0,0.6)", border: "3px solid #fff", borderRadius: 14, padding: isMobile ? "8px 14px" : "10px 22px", animation: "wdcStamp .55s .7s cubic-bezier(.2,.8,.2,1) both", boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
                  <Logo b={nb} size={isMobile ? 40 : 60} />
                  <div>
                    <div style={{ fontSize: isMobile ? 22 : 34, fontWeight: 900, letterSpacing: "0.08em", lineHeight: 1 }}>COMMITTED</div>
                    <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.9, marginTop: 3 }}>{(state.teams[p.to]?.school || "").toUpperCase()}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
            <button type="button" onClick={() => sim.toggleStar(p.id)} aria-label={sim.starred.has(p.id) ? "Unstar" : "Star"} style={{ ...pill(sim.starred.has(p.id), GOLD), background: sim.starred.has(p.id) ? GOLD : "rgba(0,0,0,0.4)", borderColor: "transparent" }}>{sim.starred.has(p.id) ? "★" : "☆"}{isMobile ? "" : sim.starred.has(p.id) ? " On your board" : " Star"}</button>
            <button type="button" onClick={onClose} aria-label="Close" style={{ ...pill(false), background: "rgba(0,0,0,0.4)", borderColor: "transparent", padding: "7px 11px" }}>✕</button>
          </div>
        </div>

        {celebrate ? (
          <div key={`f${celebrate}`} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 0, pointerEvents: "none", zIndex: 5 }}>
            {confetti.map((c) => (
              <span key={c.i} className="wdc-anim" style={{
                position: "absolute", left: `${c.left}%`, top: 0, width: c.w, height: c.w * 0.45, borderRadius: 2,
                background: [c1, c2, "#ffffff", GOLD][c.i % 4], "--dx": c.dx, "--dy": c.dy, "--rot": c.rot,
                animation: `wdcFall ${c.dur}s ${0.75 + c.delay}s cubic-bezier(.2,.6,.4,1) both`,
              }} />
            ))}
          </div>
        ) : null}
        <div style={{ padding: isMobile ? "4px 14px 20px" : "6px 22px 22px" }}>
          {/* Bio. */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 3}, minmax(0, 1fr))`, gap: 8, marginTop: 14 }}>
            {bio.map(([k, v]) => <Box key={k} label={k}>{v}</Box>)}
          </div>
          {row?.slug && <a href={`/player/${row.slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 10, fontSize: 12, fontWeight: 900, color: GOLD }}>Full We-Draft profile ↗</a>}

          {/* The We-Draft draft grade. */}
          {look && (
            <>
              <H right={<span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>Community grade on We-Draft.com</span>}>We-Draft draft grade</H>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
                <div style={{ flex: "0 0 auto", minWidth: 150, background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ background: look.bg, border: `2px solid ${look.border}`, borderRadius: 10, padding: "6px 12px", fontWeight: 900, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
                    {look.qualifier && <div style={{ fontSize: 9, letterSpacing: "0.12em", marginBottom: 3 }}>{look.qualifier}</div>}{look.short}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900 }}>{label}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: SUB }}>{draftClass ? `${draftClass} draft class` : "Draft class"}</div>
                  </div>
                </div>
                {[["Strengths", p.str, GREEN], ["Weaknesses", p.weak, RED]].map(([k, list, color]) => list?.length ? (
                  <div key={k} style={{ flex: "1 1 200px", background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color, textTransform: "uppercase" }}>{k}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {list.map((x) => <span key={x} style={{ fontSize: 12, fontWeight: 900, borderRadius: 999, padding: "4px 10px", border: `1px solid ${color}55`, color }}>{x}</span>)}
                    </div>
                  </div>
                ) : null)}
              </div>
            </>
          )}

          {/* Last season's stats — only when there are some. */}
          {tiles.length > 0 && (
            <>
              <H>Last season</H>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 92 : 104}px, 1fr))`, gap: 8 }}>
                {tiles.map(([k, v]) => (
                  <div key={k} style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 900 }}>{v}</div>
                    <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: SUB, textTransform: "uppercase" }}>{k}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* College interest — the recruitment. */}
          {moving && <H right={to ? null : <span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{p.list ? `Down to his top ${p.list} · ` : ""}Commits at {Math.round(bar * 100)}+ · offers land the window after they're made</span>}>{to ? "Commitment" : "College interest"}</H>}
          {!moving ? null : to ? (
            // Signed: the deal he took.
            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(126,226,168,0.08)", border: "1px solid rgba(126,226,168,0.45)", borderRadius: 10, padding: "10px 12px" }}>
              <Logo b={brand(to)} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>Committed to {state.teams[to]?.school}{to === team ? " — your signing" : ""}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: SUB }}>{p.deal?.window ? `Portal window ${p.deal.window}` : ""}</div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: GREEN }}>{money(p.deal?.nil || 0)}</div>
            </div>
          ) : interest.length === 0 ? <div style={{ fontSize: 13, color: SUB, fontWeight: 700 }}>No offers yet.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {interest.map((x, i) => {
                const g = Math.round(x.grade * 100);
                const color = x.yours ? GOLD : i === 0 ? GREEN : "#9fc3ff";
                // NIL, where he'd fit, interest built, how he feels about
                // them, and their portal reputation.
                const meta = (
                  <>
                    {money(x.o.nil)} · <span style={{ color: FIT_COLOR[x.fit] }}>{FIT_LABEL[x.fit]}</span>
                    {x.held > 0 ? <span style={{ color: GREEN }}> · {pts(x.held)} built</span> : null}
                    {x.happy < 100 ? <span style={{ color: happyColor(x.happy) }}> · happiness {x.happy}</span> : null}
                  </>
                );
                return (
                  <div key={x.slug} style={{ display: "grid", gridTemplateColumns: isMobile ? "28px minmax(0,1fr) 40px" : "30px 170px minmax(0,1fr) 270px 44px", alignItems: "center", gap: 10, background: x.yours ? "rgba(246,162,29,0.08)" : "#111a2b", border: `1px solid ${x.yours ? "rgba(246,162,29,0.45)" : LINE}`, borderRadius: 10, padding: "8px 10px" }}>
                    <Logo b={brand(x.slug)} size={26} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state.teams[x.slug]?.school}{x.yours ? (x.draft ? " · not sent" : " · you") : ""}{i === 0 ? " · leader" : ""}</div>
                      {isMobile && <div style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{meta}</div>}
                      {isMobile && <div style={{ height: 6, borderRadius: 3, background: "#1a2438", marginTop: 4, overflow: "hidden" }}><div style={{ width: `${Math.min(100, g)}%`, height: "100%", background: color }} /></div>}
                    </div>
                    {!isMobile && (
                      <div style={{ position: "relative", height: 10, borderRadius: 5, background: "#1a2438", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, g)}%`, height: "100%", background: color, borderRadius: 5 }} />
                        <div title="Commit line" style={{ position: "absolute", top: -2, bottom: -2, left: `${Math.min(100, bar * 100)}%`, width: 2, background: "#fff", opacity: 0.6 }} />
                      </div>
                    )}
                    {!isMobile && <div style={{ fontSize: 12, fontWeight: 800, color: SUB, textAlign: "right" }}>{meta}</div>}
                    <div style={{ fontSize: 18, fontWeight: 900, color, textAlign: "right" }}>{g}</div>
                  </div>
                );
              })}
            </div>
          )}

          {cutYou && p.status === "portal" && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13, borderRadius: 10 }}>
              He cut you from his list after portal window {cutYou}. You can't offer him again.
            </div>
          )}
          {/* The offer: NIL. He judges your room himself. */}
          {canOffer && (
            <>
              <H right={<span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{money(max)} available</span>}>{mine ? "Your offer" : "Make an offer"}</H>
              <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB, whiteSpace: "nowrap" }}>HAPPINESS WITH YOU</span>
                <div title="Lowballs, offering less than before and pulling offers wear it down" style={{ position: "relative", flex: 1, height: 10, borderRadius: 5, background: "#1a2438", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${happy}%`, background: hit.drop ? "rgba(255,138,122,0.45)" : happyColor(happy), transition: "width .3s" }} />
                  {hit.drop ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${happyAfter}%`, background: happyColor(happyAfter), transition: "width .3s" }} /> : null}
                </div>
                <span style={{ fontSize: 18, fontWeight: 900, color: happyColor(hit.drop ? happyAfter : happy), minWidth: 54, textAlign: "right" }}>{hit.drop ? `${happy}→${happyAfter}` : happy}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1.1fr) minmax(0,1fr)", gap: 14 }}>
                <div style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB }}>NIL</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>Asking about <b style={{ color: INK }}>{money(p.ask)}</b></span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                    <span style={{ fontSize: 28, fontWeight: 900, color: nil > max ? RED : INK, minWidth: 96 }}>{money(nil)}</span>
                    <input type="range" min={0} max={slideMax} step={Math.max(1000, Math.round(p.ask / 100 / 1000) * 1000)} value={Math.min(nil, slideMax)} onChange={(e) => setNil(Number(e.target.value))} aria-label="NIL offer" style={{ flex: 1, accentColor: GOLD }} />
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {[0.5, 0.8, 1, 1.25, 1.5, 2].map((m) => <button key={m} type="button" style={pill(Math.round(p.ask * m / 1000) * 1000 === nil, BLUE)} onClick={() => setNil(Math.round((p.ask * m) / 1000) * 1000)}>{m === 1 ? "Ask" : `${Math.round(m * 100)}%`}</button>)}
                    <input type="number" min={0} step={10000} value={nil} onChange={(e) => setNil(Math.max(0, Number(e.target.value) || 0))} aria-label="NIL amount" style={{ width: 110, background: "#0b1322", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 10px", fontWeight: 800, fontSize: 12 }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginTop: 12, lineHeight: 1.45 }}>
                    In your {p.pos} room he'd fit as <b style={{ color: FIT_COLOR[room.fit] }}>{FIT_LABEL[room.fit]}</b>
                    {room.better.length ? <> — {room.better.length} better player{room.better.length === 1 ? "" : "s"} ({room.better.slice(0, 3).map((x) => x.name.split(" ").slice(-1)[0]).join(", ")}{room.better.length > 3 ? "…" : ""})</> : <> — no one better there</>}, you start {room.starters}.
                    {room.chasing.length ? <> He sees you're also chasing {room.chasing.length} other {p.pos}{room.chasing.length === 1 ? "" : "s"} ({room.chasing.slice(0, 3).map((x) => x.name.split(" ").slice(-1)[0]).join(", ")}).</> : null}
                    {!mine && !moved && state.window < state.windows ? " Offer now: interest builds every window your offer stands." : ""}
                  </div>
                </div>
                {/* How he sees it. */}
                <div style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB }}>HOW HE SEES YOUR OFFER</span>
                    <span style={{ fontSize: 22, fontWeight: 900, color: yours && top && yours.slug === top.slug ? GREEN : GOLD }}>{yours ? Math.round(yours.grade * 100) : "—"}</span>
                  </div>
                  {yours && [...FACTORS].sort((a, b2) => (weights[b2] || 0) - (weights[a] || 0)).map((k) => {
                    const w = (weights[k] || 0) / wsum;
                    const v = yours.scores[k] || 0;
                    return (
                      <div key={k} style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr) 34px", alignItems: "center", gap: 8, marginTop: 7 }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>{VALUE_LABEL[k]}</span>
                        <div style={{ height: 8, borderRadius: 4, background: "#1a2438", overflow: "hidden" }}><div style={{ width: `${Math.round(v * 100)}%`, height: "100%", background: v >= 0.66 ? GREEN : v >= 0.33 ? GOLD : RED }} /></div>
                        <span title="How much he cares" style={{ fontSize: 11, fontWeight: 900, color: SUB, textAlign: "right" }}>{Math.round(w * 100)}%</span>
                      </div>
                    );
                  })}
                  {yours?.held > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: GREEN, marginTop: 8 }}>+{Math.round(yours.held * 100)} from your offer standing</div>}
                  <div style={{ fontSize: 11, fontWeight: 700, color: SUB, marginTop: 8 }}>Bars: how your school scores. %: how much he cares.</div>
                </div>
              </div>
              {moved ? (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "#13233f", color: "#9fc3ff", fontWeight: 800, fontSize: 13, borderRadius: 8 }}>
                  You've made your move on him this window. You can offer again next window.
                </div>
              ) : hit.drop ? (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13, borderRadius: 8 }}>
                  {hit.lower ? `That's less than your last offer (${money(hit.prior)}).` : "That's well under what he's asking."} He'll take it personally — happiness {happy} → {happyAfter}.
                </div>
              ) : null}
              {sim.error && <div style={{ marginTop: 10, padding: "8px 12px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13, borderRadius: 8 }}>{sim.error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
                {mine && !moved && <button type="button" style={pill(false)} title="Pulling an offer costs his happiness with you" onClick={() => { sim.retract(p.id); onClose(); }}>Pull Offer</button>}
                <button type="button" disabled={nil > max || moved} style={{ ...pill(true, "#2e7d32"), padding: "11px 22px", fontSize: 14, opacity: nil > max || moved ? 0.5 : 1 }} onClick={() => { if (sim.offer(p.id, { nil }) === true) onClose(); }}>{mine ? "New Offer" : "Make Offer"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
