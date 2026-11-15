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
//   interest  every school that's offered or has him on its board
//             ("Contacted", graded at what it would likely offer — how the
//             interest is landing, user 2026-11-15); your offer's factor
//             bars only once it's SENT (the slider never previews them;
//             top 5 shown, the rest behind an expand): NIL,
//             where he'd fit in that room, and how interested he is — his grade
//             of the offer plus what it's built by standing (offering early
//             helps), the leader marked, the bar he needs to commit
//   sent      sending an offer (portal or retention) plays a short animation
//             (user, 2026-11-15): a band in YOUR colors sweeps the header,
//             your logo pops, OFFER SENT stamps with the amount.
//   offer     NIL only — players judge the room, not promised roles (user,
//             2026-11-14): where he'd fit in yours and how he sees your offer
//             — each factor with his interest letter (A's first, F last) and
//             the recruiting process (happiness + interest built). What an
//             offer does to his happiness is never previewed — it just
//             happens. A big enough offer commits him on the spot (engine
//             instantAmount) — never shown to the user either.
//   keep      an opening window's Retain (pages/PortalSim.jsx) opens here
//             for one of yours deciding (status considering): a retention
//             NIL offer, his odds (NFL: chance he leaves; transfer: chance he
//             stays) and how he sees staying, factor by factor (user,
//             2026-11-14).
// Branding: a player who's committed / transferred wears his NEW school in
// the header; an on-the-spot commit plays a celebration (the new colors
// wipe in, the logo pops with a COMMITTED stamp, confetti).
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import TransferStars from "../TransferStars";
import { gradeOffer, fitAt, offeredThisWindow, happinessOf, retainOdds, homeScores, likelyOffer } from "../../utils/portalSim/engine";
import { byLetter, commitBar, letterOf } from "../../utils/portalSim/models";
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
  /* The new school's watermark on a commit: pops in bold, holds, then eases down to its resting fade (0.12) — no jump when the celebration ends. */
  @keyframes wdcMark { 0% { transform: scale(0) rotate(-12deg); opacity: 0; } 12% { transform: scale(1.2) rotate(4deg); opacity: 0.9; } 18% { transform: scale(1) rotate(0); opacity: 0.9; } 55% { opacity: 0.9; } 100% { transform: scale(1); opacity: 0.12; } }
  @keyframes wdcBand { 0% { transform: translateX(-105%); } 18%, 82% { transform: translateX(0); } 100% { transform: translateX(105%); } }
  @keyframes wdcShine { from { transform: translateX(-120%) skewX(-20deg); } to { transform: translateX(380%) skewX(-20deg); } }
  @media (prefers-reduced-motion: reduce) { .wdc-anim { animation-duration: 1ms !important; animation-delay: 0s !important; } }
`;
const VALUE_LABEL = { tier: "Program", nil: "NIL", loc: "Close to home", pt: "Playing time", success: "Winning", dev: "Development" };
const WANTS_LABEL = { level: "Wants a bigger stage", snaps: "Wants snaps", money: "Wants a bigger NIL deal", home: "Wants to be closer to home", winning: "Wants to win", development: "Wants to develop", roster: "Cut for roster space" };
const pctOf = (x) => `${Math.round((x || 0) * 100)}%`;
// His interest letters (how much a factor matters to him).
export const LETTER_COLOR = { A: "#7ee2a8", B: "#9fc3ff", C: "#f6a21d", F: "#ff8a7a" };
export const Letter = ({ l, size = 22 }) => (
  <span title={`${l} interest`} style={{ width: size, height: size, borderRadius: 6, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: size * 0.58, color: "#0e1626", background: LETTER_COLOR[l] || "#8b9bb4" }}>{l}</span>
);

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
// Dark panels: LogoBlack first; onColor (a team-color fill) skips it.
const Logo = ({ b, size = 26, onColor = false }) => {
  const src = (onColor ? null : b?.LogoBlack) || b?.LogoDark || b?.Logo1;
  return <span style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{src ? <img src={src} alt={b?.School || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : null}</span>;
};
// A small tag beside a school's name (You / Not sent / Leader).
const Tag = ({ color, children }) => (
  <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color, border: `1px solid ${color}`, borderRadius: 999, padding: "2px 6px", lineHeight: 1.2 }}>{children}</span>
);
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
  // One of yours deciding (opening windows): his retention offer starts at
  // what's out there, or what it takes to keep him.
  const keeping = p?.status === "considering";
  const [nil, setNil] = useState(() => (keeping ? p.retain?.nil ?? Math.round(retainOdds(state, p, null).ask / 1000) * 1000 : mine?.nil ?? p?.ask ?? 0));
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
  // Offer sent: plays when your offer (or retention offer) on him changes.
  const [sent, setSent] = useState(null); // { at, nil, keep }
  const sentKey = p?.status === "considering" ? (p.retain ? `k${p.retain.nil}` : null) : p?.offers?.[team] ? `o${p.offers[team].nil}|${p.offers[team].window}` : null;
  const prevSent = useRef(sentKey);
  useEffect(() => {
    if (sentKey && sentKey !== prevSent.current) setSent({ at: Date.now(), nil: p.status === "considering" ? p.retain.nil : p.offers[team].nil, keep: p.status === "considering" });
    prevSent.current = sentKey;
  }, [sentKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sent) return undefined;
    const t = setTimeout(() => setSent(null), 2300);
    return () => clearTimeout(t);
  }, [sent]);
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
  // The evaluation period (portal window 1): boards only, no offers.
  const evalPeriod = sim.board.evalPeriod;
  const onBoard = sim.starred.has(pid);
  const canOffer = sim.phase === "window" && p?.status === "portal" && !cutYou && !evalPeriod;
  const canRetain = sim.phase === "window" && keeping && p?.team === team;
  // His interest in every offer — yours as you're building it (it keeps the
  // interest it's built if you're raising an offer that's out there).
  // His interest in every offer that's out there — yours only once it's
  // sent, at what you sent (the slider never previews it).
  // Schools evaluating him (on their boards, no offer yet) are in it too,
  // graded at what they'd likely offer — how the interest is landing.
  const interest = useMemo(() => {
    if (!p) return [];
    const slugs = [...new Set([...Object.keys(p.offers), ...(p.status === "portal" ? Object.keys(p.evals || {}) : [])])].filter((slug) => state.teams[slug]);
    const list = slugs.map((slug) => {
      const o = p.offers[slug] || null;
      return { slug, o, evaluating: !o, ...gradeOffer(state, slug, p, o || likelyOffer(state, slug, p)), fit: fitAt(state, slug, p).fit, yours: slug === team };
    });
    return list.sort((a, b) => b.grade - a.grade);
  }, [p, state, team]);
  const [allOffers, setAllOffers] = useState(false);
  const TOP_OFFERS = 5;
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
  const yours = interest.find((x) => x.yours && !x.evaluating); // your sent offer (not just evaluating)
  const bar = commitBar(p, state.window || 1, state.windows, state.cfg, home?.tier);
  const top = interest[0];
  const room = fitAt(state, team, p);
  // One move per player per window; going lower than before upsets him.
  const moved = offeredThisWindow(state, team, p);
  // His happiness with you (it moves when you act — never previewed).
  const happy = happinessOf(p, team);
  const happyColor = (h) => (h >= 80 ? GREEN : h >= 50 ? GOLD : RED);
  const pts = (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
  const order = byLetter(p);
  const tiles = statTiles(p.pos, row?.s);
  const label = p.dg != null ? gradeLabel(p.dg) : null;
  const look = label ? gradeLook(label) : null;
  const draftClass = row?.slug?.match(/-(\d{4})-[a-z]+$/)?.[1] || null;
  const slideMax = Math.max(Math.round((p.ask * 2.5) / 1000) * 1000, 10000);
  const to = p.status === "committed" ? p.to : null;
  // Moving: in the portal, signed somewhere, or unsigned — the → ? and the
  // recruitment only show then (a player still on a roster has neither).
  const moving = ["portal", "committed", "unsigned"].includes(p.status);
  const status = keeping ? (p.considering === "nfl" ? ["Deciding on the NFL", GOLD] : [WANTS_LABEL[p.reason] || "Wants to leave", RED])
    : p.status === "portal" ? ["In the portal", GOLD] : p.status === "committed" ? [`Committed to ${state.teams[p.to]?.school}`, GREEN] : p.status === "unsigned" ? ["Unsigned", SUB] : ["", SUB];
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
        maxHeight: isMobile ? "100%" : "none", overflowY: isMobile ? "auto" : "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <style>{CELEBRATE_CSS}</style>
        {/* Header, in his school's colors (his new one once he's committed):
            name on top, old school → ? (or → the new one). */}
        <div style={{ position: "relative", overflow: "hidden", background: celebrate ? `linear-gradient(115deg, ${o1} 0%, ${o1} 50%, color-mix(in srgb, ${o2} 70%, ${o1}) 100%)` : `linear-gradient(115deg, ${c1} 0%, ${c1} 50%, color-mix(in srgb, ${c2} 70%, ${c1}) 100%)` }}>
          {/* On a commit: the new school's colors wipe in over the old. */}
          {celebrate ? <div key={celebrate} className="wdc-anim" style={{ position: "absolute", inset: 0, background: `linear-gradient(115deg, ${c1} 0%, ${c1} 50%, color-mix(in srgb, ${c2} 70%, ${c1}) 100%)`, animation: "wdcWipe .9s cubic-bezier(.6,0,.2,1) both" }} /> : null}
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 85% 120%, rgba(0,0,0,0.05), rgba(0,0,0,0.55) 70%)" }} />
          {/* A big faint logo behind it all — his new school's once committed. */}
          {(hb.LogoDark || hb.Logo1) && <img key={hb.School} src={hb.LogoDark || hb.Logo1} alt="" aria-hidden="true" className="wdc-anim" style={{ position: "absolute", right: -30, top: -40, width: isMobile ? 190 : 280, opacity: 0.12, pointerEvents: "none", animation: celebrate ? "wdcMark 3.2s .4s ease-out both" : undefined }} />}
          {celebrate ? <div key={`s${celebrate}`} className="wdc-anim" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "30%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)", animation: "wdcShine 1.1s .5s ease-out both", pointerEvents: "none" }} /> : null}
          <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: isMobile ? 10 : 18, padding: isMobile ? "14px 14px 0" : "18px 22px 0" }}>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: isMobile ? 14 : 18 }}>
              <div style={{ fontSize: isMobile ? 30 : 48, fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, letterSpacing: "-0.01em", paddingRight: isMobile ? 70 : 150, textShadow: "0 2px 12px rgba(0,0,0,0.35)" }}>{p.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: isMobile ? 10 : 14 }}>
                <Logo onColor b={b} size={isMobile ? 34 : 44} />
                {moving && <span style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, opacity: 0.85 }}>→</span>}
                {!moving ? null : to ? <span key={celebrate || "to"} className="wdc-anim" style={{ display: "inline-flex", animation: celebrate ? "wdcPop .7s .35s cubic-bezier(.2,.8,.2,1) both" : undefined }}><Logo onColor b={brand(to)} size={isMobile ? 34 : 44} /></span>
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
          {/* Offer sent: your colors sweep across, your logo, the stamp. */}
          {sent && !celebrate ? (() => {
            const yb = brand(team) || {};
            const y1 = yb.Color1 || BLUE;
            const y2 = yb.Color2 || GOLD;
            return (
              <div key={`s${sent.at}`} aria-live="polite" className="wdc-anim" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4, animation: "wdcBand 2.3s cubic-bezier(.7,0,.3,1) both", background: `linear-gradient(115deg, ${y1} 0%, ${y1} 55%, color-mix(in srgb, ${y2} 70%, ${y1}) 100%)`, display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 12 : 20, overflow: "hidden" }}>
                <div className="wdc-anim" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "30%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)", animation: "wdcShine 1s .35s ease-out both" }} />
                <span className="wdc-anim" style={{ display: "inline-flex", animation: "wdcPop .6s .3s cubic-bezier(.2,.8,.2,1) both" }}><Logo onColor b={yb} size={isMobile ? 72 : 112} /></span>
                <div className="wdc-anim" style={{ animation: "wdcStamp .5s .45s cubic-bezier(.2,.8,.2,1) both", border: "3px solid #fff", borderRadius: 12, padding: isMobile ? "6px 12px" : "8px 18px", background: "rgba(0,0,0,0.35)" }}>
                  <div style={{ fontSize: isMobile ? 20 : 30, fontWeight: 900, letterSpacing: "0.08em", lineHeight: 1 }}>{sent.keep ? "OFFER TO STAY" : "OFFER SENT"}</div>
                  <div style={{ fontSize: isMobile ? 13 : 16, fontWeight: 900, letterSpacing: "0.1em", marginTop: 4, color: GOLD }}>{money(sent.nil)} NIL</div>
                </div>
              </div>
            );
          })() : null}
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
          <div key={`f${celebrate}`} aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }}>
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
            // Signed: the deal he took, then the rest of the mix.
            <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(126,226,168,0.08)", border: "1px solid rgba(126,226,168,0.45)", borderRadius: 10, padding: "10px 12px" }}>
              <Logo b={brand(to)} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>Committed to {state.teams[to]?.school}{to === team ? " — your signing" : ""}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: SUB }}>{p.deal?.window ? `Portal window ${p.deal.window}` : ""}</div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: GREEN }}>{money(p.deal?.nil || 0)}</div>
            </div>
            {/* The rest of the mix when he committed — who else was on him. */}
            {(p.mix || []).filter((x) => x.slug !== to && state.teams[x.slug]).map((x) => (
              <div key={x.slug} style={{ display: "grid", gridTemplateColumns: "26px minmax(0,1fr) auto 36px", alignItems: "center", gap: 10, background: x.slug === team ? "rgba(246,162,29,0.08)" : "#111a2b", border: `1px solid ${x.slug === team ? "rgba(246,162,29,0.45)" : LINE}`, borderRadius: 10, padding: "6px 10px", marginTop: 6 }}>
                <Logo b={brand(x.slug)} size={22} />
                <span style={{ fontWeight: 900, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state.teams[x.slug].school}{x.slug === team ? " (you)" : ""}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: x.nil != null ? SUB : "#9fc3ff" }}>{x.nil != null ? money(x.nil) : "Contacted"}</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: "#9fc3ff", textAlign: "right" }}>{Math.round(x.g * 100)}</span>
              </div>
            ))}
            </>
          ) : interest.length === 0 ? <div style={{ fontSize: 13, color: SUB, fontWeight: 700 }}>No schools on him yet.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Top 5 (yours pinned under them if it's further down), the rest behind the expand. */}
              {(allOffers ? interest : interest.filter((x, j) => j < TOP_OFFERS || x.yours)).map((x) => {
                const i = interest.indexOf(x);
                const g = Math.round(x.grade * 100);
                const color = x.yours ? GOLD : i === 0 ? GREEN : "#9fc3ff";
                // NIL, where he'd fit, interest built, how he feels about
                // them, and their portal reputation.
                const meta = (
                  <>
                    {x.evaluating ? <span style={{ color: "#9fc3ff" }}>Contacted</span> : money(x.o.nil)} · <span style={{ color: FIT_COLOR[x.fit] }}>{FIT_LABEL[x.fit]}</span>
                    {x.held > 0 ? <span style={{ color: GREEN }}> · {pts(x.held)} built</span> : null}
                    {x.happy < 100 ? <span style={{ color: happyColor(x.happy) }}> · happiness {x.happy}</span> : null}
                    {/* He sees them chasing others at his position. */}
                    {x.snub > 0 ? <span style={{ color: RED }} title={`They're chasing other ${p.pos}s`}> · {pts(-x.snub)} chasing others</span> : null}
                  </>
                );
                return (
                  <div key={x.slug} style={{ display: "grid", gridTemplateColumns: isMobile ? "28px minmax(0,1fr) 40px" : "30px 250px minmax(120px,1fr) 230px 44px", alignItems: "center", gap: 10, background: x.yours ? "rgba(246,162,29,0.08)" : "#111a2b", border: `1px solid ${x.yours ? "rgba(246,162,29,0.45)" : LINE}`, borderRadius: 10, padding: "8px 10px" }}>
                    <Logo b={brand(x.slug)} size={26} />
                    <div style={{ minWidth: 0 }}>
                      {/* The school, then small tags — the name never loses room to them. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span style={{ fontWeight: 900, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{state.teams[x.slug]?.school}</span>
                                {x.yours && <Tag color={GOLD}>{i >= TOP_OFFERS ? `You · #${i + 1}` : "You"}</Tag>}
                        {i === 0 && <Tag color={GREEN}>Leader</Tag>}
                      </div>
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
              {interest.length > TOP_OFFERS && (
                <button type="button" onClick={() => setAllOffers((v) => !v)} style={{ alignSelf: "center", marginTop: 2, background: "none", border: `1px solid ${LINE}`, borderRadius: 999, color: GOLD, fontWeight: 900, fontSize: 12, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit" }}>
                  {(() => {
                    const hidden = interest.filter((x, j) => j >= TOP_OFFERS && !x.yours).length;
                    return allOffers ? "Show top 5" : `Show ${hidden} more school${hidden === 1 ? "" : "s"}`;
                  })()}
                </button>
              )}
            </div>
          )}

          {cutYou && p.status === "portal" && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13, borderRadius: 10 }}>
              He cut you from his list after portal window {cutYou}. You can't offer him again.
            </div>
          )}
          {/* Contact him: puts him on your board, and interest starts building
              (the evaluation period's whole move). Removing him is at the
              bottom, by the offer buttons. */}
          {p.status === "portal" && !cutYou && sim.phase === "window" && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderRadius: 10, background: onBoard ? "rgba(126,226,168,0.08)" : "#111a2b", border: `1px solid ${onBoard ? "rgba(126,226,168,0.45)" : LINE}` }}>
              <div style={{ flex: "1 1 220px", fontSize: 12, fontWeight: 700, color: SUB, lineHeight: 1.45 }}>
                {onBoard ? <><b style={{ color: GREEN }}>Contacted</b> {p.evals[team] === (state.cfg.board?.evalWindow ?? 1) ? "in the evaluation period" : `in window ${p.evals[team]}`} — interest building.</>
                  : evalPeriod ? <><b style={{ color: GOLD }}>Evaluation period:</b> no offers yet. Contact him and interest starts building now.</>
                    : <>Not contacted. An offer counts as a contact — or contact him first to start building interest.</>}
                <span> Contacts {sim.board.count}/{sim.board.limit}.</span>
              </div>
              {!onBoard && (
                <button type="button" disabled={sim.board.full} onClick={() => sim.toggleStar(p.id)} style={{ ...pill(true, GOLD), opacity: sim.board.full ? 0.5 : 1 }}>
                  {sim.board.full ? "No contacts left" : "Contact"}
                </button>
              )}
            </div>
          )}
          {/* The evaluation period has no offer buttons — Remove sits alone. */}
          {!canOffer && onBoard && p.status === "portal" && sim.phase === "window" && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" style={{ ...pill(false), color: RED }} onClick={() => sim.toggleStar(p.id)}>Drop</button>
            </div>
          )}
          {/* Keep him: a retention offer (opening windows). */}
          {canRetain && <Retain p={p} sim={sim} team={team} nil={nil} setNil={setNil} isMobile={isMobile} />}

          {/* The offer: NIL. He judges your room himself. */}
          {canOffer && (
            <>
              <H right={<span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{money(max)} available</span>}>{mine ? "Your offer" : "Make an offer"}</H>
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
                  {/* His letters always; how you score on each only once
                      you've sent an offer. */}
                  {order.map((k) => {
                    const v = yours ? yours.scores[k] || 0 : null;
                    return (
                      <div key={k} style={{ display: "grid", gridTemplateColumns: "22px 96px minmax(0,1fr)", alignItems: "center", gap: 8, marginTop: 7 }}>
                        <Letter l={letterOf(p, k, state.cfg)} />
                        <span style={{ fontSize: 12, fontWeight: 800 }}>{VALUE_LABEL[k]}</span>
                        {v == null ? <span /> : <div style={{ height: 8, borderRadius: 4, background: "#1a2438", overflow: "hidden" }}><div style={{ width: `${Math.round(v * 100)}%`, height: "100%", background: v >= 0.66 ? GREEN : v >= 0.33 ? GOLD : RED }} /></div>}
                      </div>
                    );
                  })}
                  {!yours && <div style={{ fontSize: 12, fontWeight: 800, color: SUB, marginTop: 10 }}>Make an offer to see how he sees it.</div>}
                  {/* The recruiting process — happiness with you and interest built. */}
                  {yours && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
                      <div style={{ display: "grid", gridTemplateColumns: "118px minmax(0,1fr) 34px", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800 }}>Process</span>
                        <div style={{ height: 8, borderRadius: 4, background: "#1a2438", overflow: "hidden" }}><div style={{ width: `${Math.round((yours.process || 0) * 100)}%`, height: "100%", background: happyColor(happy) }} /></div>
                        <span style={{ fontSize: 12, fontWeight: 900, textAlign: "right", color: happyColor(happy) }}>{Math.round((yours.process || 0) * 100)}</span>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: SUB, marginTop: 5 }}>
                        Happiness with you <b style={{ color: happyColor(happy) }}>{happy}</b>{yours.held > 0 ? <> · <span style={{ color: GREEN }}>{pts(yours.held)} interest built</span></> : null}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 700, color: SUB, marginTop: 8 }}>{yours ? "Bars: how your school scores with the offer you sent. " : ""}Letters: how much he cares (A's first). The factors count 3× the process.</div>
                </div>
              </div>
              {moved ? (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "#13233f", color: "#9fc3ff", fontWeight: 800, fontSize: 13, borderRadius: 8 }}>
                  You've made your move on him this window. You can offer again next window.
                </div>
              ) : null}
              {sim.error && <div style={{ marginTop: 10, padding: "8px 12px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13, borderRadius: 8 }}>{sim.error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
                {/* Drop: off your board — pulling your offer too, if one's out. */}
                {onBoard && <button type="button" title={mine ? "Drop him — pulls your offer" : "Drop him from your board"} style={{ ...pill(false), color: RED }} onClick={() => sim.toggleStar(p.id)}>Drop</button>}
                {mine && !moved && <button type="button" style={pill(false)} onClick={() => sim.retract(p.id)}>Pull Offer</button>}
                <button type="button" disabled={nil > max || moved} style={{ ...pill(true, "#2e7d32"), padding: "11px 22px", fontSize: 14, opacity: nil > max || moved ? 0.5 : 1 }} onClick={() => sim.offer(p.id, { nil })}>{mine ? "New Offer" : "Make Offer"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Keep him: one of yours deciding in an opening window ──
// NFL: his chance of leaving, before → with your offer. Transfer: his chance
// of staying with it, and how he sees staying, factor by factor (A's first).
function Retain({ p, sim, team, nil, setNil, isMobile }) {
  const { state, view } = sim;
  const nfl = p.considering === "nfl";
  const base = retainOdds(state, p, null);
  const odds = retainOdds(state, p, { nil });
  const max = view.available + (p.retain?.nil || 0);
  const room = fitAt(state, team, p);
  const scores = nfl ? null : homeScores(state, p, { nil });
  const slideMax = Math.max(Math.round((base.ask * 2.5) / 1000) * 1000, 10000);
  const good = (c) => (c >= 0.6 ? GREEN : c >= 0.35 ? GOLD : RED);
  return (
    <>
      <H right={<span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{money(max)} available</span>}>{p.retain ? "Your offer to keep him" : "Keep him"}</H>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1.1fr) minmax(0,1fr)", gap: 14 }}>
        <div style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB }}>NIL</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{nfl ? "To stay out of the draft" : "To stay"}: about <b style={{ color: INK }}>{money(base.ask)}</b></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: nil > max ? RED : INK, minWidth: 96 }}>{money(nil)}</span>
            <input type="range" min={0} max={slideMax} step={Math.max(1000, Math.round(base.ask / 100 / 1000) * 1000)} value={Math.min(nil, slideMax)} onChange={(e) => setNil(Number(e.target.value))} aria-label="Retention NIL" style={{ flex: 1, accentColor: GOLD }} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {[0.5, 0.8, 1, 1.25, 1.5].map((m) => <button key={m} type="button" style={pill(Math.round(base.ask * m / 1000) * 1000 === nil, BLUE)} onClick={() => setNil(Math.round((base.ask * m) / 1000) * 1000)}>{m === 1 ? "Ask" : `${Math.round(m * 100)}%`}</button>)}
            <input type="number" min={0} step={10000} value={nil} onChange={(e) => setNil(Math.max(0, Number(e.target.value) || 0))} aria-label="Retention NIL amount" style={{ width: 110, background: "#0b1322", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 10px", fontWeight: 800, fontSize: 12 }} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginTop: 12, lineHeight: 1.45 }}>
            Coming back, he'd fit as <b style={{ color: FIT_COLOR[room.fit] }}>{FIT_LABEL[room.fit]}</b> in your {p.pos} room
            {room.better.length ? <> — {room.better.length} better player{room.better.length === 1 ? "" : "s"} ({room.better.slice(0, 3).map((x) => x.name.split(" ").slice(-1)[0]).join(", ")}{room.better.length > 3 ? "…" : ""})</> : <> — no one better there</>}.
          </div>
        </div>
        <div style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
          {nfl ? (
            <>
              <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB }}>CHANCE HE LEAVES FOR THE NFL</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: SUB }}>{pctOf(base.chance)}</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: SUB }}>→</span>
                <span style={{ fontSize: 34, fontWeight: 900, color: good(1 - odds.chance) }}>{pctOf(odds.chance)}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginTop: 8, lineHeight: 1.45 }}>The better his draft grade, the less money moves him.</div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB }}>CHANCE HE STAYS</span>
                <span style={{ fontSize: 26, fontWeight: 900, color: good(odds.chance) }}>{pctOf(odds.chance)}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: SUB, marginTop: 6 }}>How he sees staying</div>
              {byLetter(p).map((k) => {
                const v = scores[k] || 0;
                return (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "22px 96px minmax(0,1fr)", alignItems: "center", gap: 8, marginTop: 7 }}>
                    <Letter l={letterOf(p, k, state.cfg)} />
                    <span style={{ fontSize: 12, fontWeight: 800 }}>{VALUE_LABEL[k]}</span>
                    <div style={{ height: 8, borderRadius: 4, background: "#1a2438", overflow: "hidden" }}><div style={{ width: `${Math.round(v * 100)}%`, height: "100%", background: v >= 0.66 ? GREEN : v >= 0.33 ? GOLD : RED }} /></div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, fontWeight: 700, color: SUB, marginTop: 8 }}>Bars: how your school scores with this offer. Letters: how much he cares.</div>
            </>
          )}
        </div>
      </div>
      {sim.error && <div style={{ marginTop: 10, padding: "8px 12px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13, borderRadius: 8 }}>{sim.error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
        {p.retain && <button type="button" style={pill(false)} onClick={() => sim.unretain(p.id)}>Pull Offer</button>}
        <button type="button" disabled={nil > max} style={{ ...pill(true, "#2e7d32"), padding: "11px 22px", fontSize: 14, opacity: nil > max ? 0.5 : 1 }} onClick={() => sim.retain(p.id, { nil })}>{p.retain ? "Update Offer" : "Make Offer"}</button>
      </div>
    </>
  );
}
