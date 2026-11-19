// src/components/recruitSim/ui.jsx
//
// Shared look for the Recruit Sim — the Portal Sim's dark broadcast panels
// (pages/PortalSim.jsx), plus the pieces that separate what's PUBLIC, what's
// a scouting RANGE, what's an EXACT grade, and what's still HIDDEN (spec §28).
import { useEffect, useState } from "react";

export const BLUE = "#0055a5";
export const GOLD = "#f6a21d";
export const BG = "#070d18";
export const INK = "#eef2f8";
export const SUB = "#8b9bb4";
export const LINE = "#1f2b42";
export const CARD = "#0e1626";
export const ROW = "#111a2b";
export const GOOD = "#5fd39a";
export const BAD = "#ff8a7a";
export const PANEL = { background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden" };

export const CSS = `
  @keyframes rsPop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .rs-pop { animation: rsPop .35s cubic-bezier(.2,.8,.2,1) both; }
  .rs-row:hover { background: #16213a !important; }
  .rs-link { cursor: pointer; }
  .rs-link:hover { text-decoration: underline; }
  .rs-scroll { scrollbar-width: thin; scrollbar-color: #f6a21d #0b1322; }
  .rs-input { background: #0b1322; border: 1px solid ${LINE}; color: ${INK}; border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 13px; font-weight: 700; }
  .rs-input:focus { outline: 2px solid ${GOLD}; outline-offset: 0; }
  select.rs-input { cursor: pointer; }
  html.rs-dark, html.rs-dark body { background: ${BG}; }
  @keyframes rsPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(246,162,29,0.0); } 50% { box-shadow: 0 0 0 4px rgba(246,162,29,0.25); } }
  .rs-pulse { animation: rsPulse 1.8s ease-in-out infinite; }
  @keyframes rsStamp { 0% { opacity: 0; transform: scale(1.8) rotate(-8deg); } 60% { opacity: 1; transform: scale(0.94) rotate(-3deg); } 100% { opacity: 1; transform: scale(1) rotate(-3deg); } }
  .rs-stamp { animation: rsStamp .55s cubic-bezier(.2,.8,.2,1) .25s both; }
  @media (prefers-reduced-motion: reduce) { .rs-pop, .rs-pulse, .rs-stamp { animation: none; } }
`;

export function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return m;
}

// Logos on dark panels: LogoBlack, else LogoDark, else Logo1; onColor (a
// team-color fill) skips LogoBlack.
export function Logo({ b, size = 28, onColor = false }) {
  const src = (onColor ? null : b?.LogoBlack) || b?.LogoDark || b?.Logo1;
  return (
    <span style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {src ? <img src={src} alt={b?.School || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
    </span>
  );
}

export const pillBtn = (on, color = BLUE) => ({
  border: `1px solid ${on ? color : LINE}`, background: on ? color : "transparent", color: on ? "#fff" : INK,
  borderRadius: 999, padding: "6px 12px", fontWeight: 900, fontSize: 12, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
});
export const smallBtn = (tone = "plain") => ({
  border: `1px solid ${tone === "gold" ? GOLD : tone === "bad" ? "#5a2b2b" : LINE}`, background: tone === "gold" ? GOLD : tone === "blue" ? BLUE : "transparent",
  color: tone === "gold" ? "#111" : tone === "bad" ? BAD : INK, borderRadius: 8, padding: "4px 9px", fontWeight: 900, fontSize: 11, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
});

export function Stars({ n, size = 12 }) {
  return <span style={{ color: GOLD, fontSize: size, letterSpacing: 1, whiteSpace: "nowrap" }} title={`${n}-star`}>{"★".repeat(n)}<span style={{ color: "#33405a" }}>{"★".repeat(5 - n)}</span></span>;
}

// Grade colors: A green → F red.
const GRADE_COLOR = { A: "#1f9d5a", B: "#3c7dd9", C: "#c9971c", D: "#d0661f", F: "#c43a3a" };
// state: exact (solid) | range (dashed outline — a scouting range) | unknown (hidden, gray ?)
export function GradeChip({ label, state = "exact", size = "md", title }) {
  const fam = (label || "?").replace("~", "")[0];
  const c = GRADE_COLOR[fam] || "#46506a";
  const pad = size === "sm" ? "1px 5px" : "3px 8px";
  const fs = size === "sm" ? 11 : 13;
  if (state === "unknown") return <span title={title || "Not scouted yet"} style={{ display: "inline-block", minWidth: size === "sm" ? 20 : 30, textAlign: "center", padding: pad, borderRadius: 6, fontSize: fs, fontWeight: 900, color: "#5d6a84", background: "#121b2c", border: "1px dashed #2a3650" }}>?</span>;
  if (state === "range") return <span title={title || "Scouting range — the true grade is one of these"} style={{ display: "inline-block", minWidth: size === "sm" ? 20 : 30, textAlign: "center", padding: pad, borderRadius: 6, fontSize: fs, fontWeight: 900, color: c, background: "transparent", border: `1.5px dashed ${c}`, whiteSpace: "nowrap" }}>{label}</span>;
  return <span title={title || "Exact grade"} style={{ display: "inline-block", minWidth: size === "sm" ? 20 : 30, textAlign: "center", padding: pad, borderRadius: 6, fontSize: fs, fontWeight: 900, color: "#fff", background: c, border: `1.5px solid ${c}` }}>{label}</span>;
}

// Senior-season trend (user, 2026-11-18) — direction only, never a number.
// tv: view.trendView. dir null = your staff hasn't seen him.
export function TrendBadge({ tv, label = false }) {
  if (!tv) return null;
  if (tv.dir == null) return label ? <span title={tv.label} style={{ fontSize: 11, fontWeight: 800, color: SUB }}>Trend unknown</span> : <span title="Season trend — your staff hasn't seen him" style={{ fontSize: 11, fontWeight: 900, color: "#46506a" }}>–</span>;
  const c = tv.dir > 0 ? GOOD : tv.dir < 0 ? BAD : SUB;
  const g = tv.dir === 2 ? "▲▲" : tv.dir === 1 ? "▲" : tv.dir === -1 ? "▼" : tv.dir === -2 ? "▼▼" : "■";
  return <span title={`Senior season: ${tv.label}`} style={{ fontSize: label ? 12 : 11, fontWeight: 900, color: c, whiteSpace: "nowrap", letterSpacing: tv.dir ? "-0.08em" : 0 }}>{tv.dir === 0 && !label ? "–" : g}{label ? <span style={{ letterSpacing: 0, marginLeft: 5 }}>{tv.label}</span> : null}</span>;
}

// Interest meter: five bars + level + your place + which way it's moving
// (never a number).
export function InterestMeter({ v, compact = false }) {
  if (v.committed != null) return <span style={{ color: v.mine ? GOOD : SUB, fontSize: 12, fontWeight: 900 }}>{v.mine ? "Committed to you" : "Committed"}</span>;
  if (!v.level) return <span style={{ color: "#5d6a84", fontSize: 12, fontWeight: 800 }} title="No contact yet — put him on your board or send a coach">No contact</span>;
  const colors = ["#5d6a84", "#7f8aa3", "#c9971c", "#3c9b6a", GOOD];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }} title={v.place ? `You're No. ${v.place} for him` : "Your staff's read"}>
      <span style={{ display: "inline-flex", gap: 2, alignItems: "flex-end" }}>
        {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ width: 4, height: 6 + i * 2, borderRadius: 1, background: i <= v.lvl ? colors[v.lvl] : "#243049" }} />)}
      </span>
      {!compact && <span style={{ fontSize: 12, fontWeight: 900, color: colors[v.lvl] }}>{v.level}</span>}
      {v.place ? <span style={{ fontSize: 11, fontWeight: 900, color: v.place === 1 ? GOLD : SUB }}>#{v.place}</span> : null}
      {v.trend ? <span title={v.trend > 0 ? "Warming to you since last window" : "Cooling on you since last window"} style={{ fontSize: 10, fontWeight: 900, color: v.trend > 0 ? GOOD : BAD }}>{v.trend > 0 ? "↑" : "↓"}</span> : null}
    </span>
  );
}

// Where his recruitment is (Open / Top 10 / Final / Committed) — and whether
// you're on his list.
export function StageChip({ sv, brand, state }) {
  if (sv.step === 3 && sv.school != null) {
    const mine = sv.school === state.user;
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 900, color: mine ? GOOD : SUB, whiteSpace: "nowrap" }}><Logo b={brand(state.schools[sv.school].slug)} size={16} />{mine ? "Yours" : "Committed"}</span>;
  }
  if (sv.step === 0) return null; // still open — nothing to flag (user, 2026-11-17)
  if (sv.decision) return <span className="rs-pulse" title={sv.inIt ? "He announces at the end of this window — you're a finalist" : "He announces at the end of this window — you're not a finalist"} style={{ fontSize: 10, fontWeight: 900, color: "#111", background: sv.inIt ? GOLD : "#7a8296", borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap" }}>📅 DECIDING</span>;
  const tone = sv.inIt ? GOOD : BAD;
  return <span title={sv.step && !sv.inIt ? "You're not on his list" : ""} style={{ fontSize: 11, fontWeight: 900, color: tone, whiteSpace: "nowrap" }}>{sv.label}{sv.step > 0 && sv.step < 3 ? (sv.inIt ? " ✓" : " ✕") : ""}</span>;
}

// Public rating, big, with the national rank under it.
export function RatingBlock({ x, size = 18 }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 46, lineHeight: 1 }} title="Public We-Draft.com rating · national rank">
      <span style={{ fontSize: size, fontWeight: 900 }}>{x.rating.toFixed(1)}</span>
      <span style={{ fontSize: 10, fontWeight: 900, color: SUB, marginTop: 2 }}>#{x.rank}</span>
    </span>
  );
}

// "Are you sure?" before dropping a recruit.
export function ConfirmDrop({ x, onConfirm, onCancel }) {
  return (
    <Modal onClose={onCancel} width={420}>
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>Drop {x.first} {x.last}?</div>
        <div style={{ fontSize: 13, color: SUB, fontWeight: 700, margin: "8px 0 16px", lineHeight: 1.5 }}>
          Are you sure? This will affect his recruitment — he stops getting attention from your board, any NIL offer is pulled, and staff working him are freed up.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={smallBtn()} onClick={onCancel}>Keep him</button>
          <button type="button" style={dropBtn} onClick={onConfirm}>Drop</button>
        </div>
      </div>
    </Modal>
  );
}
export const dropBtn = { border: "none", background: "#c43a3a", color: "#fff", borderRadius: 8, padding: "5px 12px", fontWeight: 900, fontSize: 11, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

export function Progress({ p, w = 54 }) {
  return (
    <span title={`Scouted ${Math.round(p * 100)}%`} style={{ display: "inline-block", width: w, height: 6, borderRadius: 3, background: "#1b2538", overflow: "hidden", verticalAlign: "middle" }}>
      <span style={{ display: "block", width: `${Math.round(p * 100)}%`, height: "100%", background: p >= 0.99 ? GOOD : "linear-gradient(90deg, #3c7dd9, #6aa6ff)" }} />
    </span>
  );
}

export function RecBadge({ roles }) {
  if (!roles?.length) return null;
  return <span title={`Recommended by ${roles.join(", ")}`} style={{ fontSize: 10, fontWeight: 900, color: "#111", background: GOLD, borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>★ {roles.join("·")}</span>;
}

export const htLabel = (inches) => `${Math.floor(inches / 12)}'${inches % 12}"`;

export function Modal({ onClose, children, width = 880 }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(3,7,14,0.78)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "calc(70px / var(--pz, 1)) 10px 20px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="rs-pop" style={{ ...PANEL, width: "100%", maxWidth: width, color: INK, fontFamily: "Arial, sans-serif", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, right, children, style }) {
  return (
    <div style={{ ...PANEL, marginBottom: 12, ...style }}>
      {title != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${LINE}` }}>
          <div style={{ flex: 1, fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", color: SUB, textTransform: "uppercase" }}>{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// Trait stacks (user, 2026-11-17): Instincts / Technique / Physical, each
// with its three traits under it — see what you know without opening him.
const CAT_SHORT = { ins: "INS", tec: "TEC", phy: "PHY" };
function Mini({ label, state }) {
  const fam = (label || "?").replace("~", "")[0];
  const c = GRADE_COLOR[fam] || "#46506a";
  const base = { display: "inline-block", minWidth: 22, textAlign: "center", borderRadius: 4, fontSize: 9.5, fontWeight: 900, lineHeight: "13px", padding: "0 2px", whiteSpace: "nowrap" };
  if (state === "unknown") return <span style={{ ...base, color: "#5d6a84", border: "1px dashed #2a3650" }}>?</span>;
  if (state === "range") return <span style={{ ...base, color: c, border: `1px dashed ${c}` }}>{label}</span>;
  return <span style={{ ...base, color: "#fff", background: c, border: `1px solid ${c}` }}>{label}</span>;
}
export function TraitStack({ stacks, width = 62 }) {
  return (
    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
      {stacks.map((g) => (
        <div key={g.cat} style={{ width, background: "#0b1322", borderRadius: 6, padding: "3px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }} title={`${CAT_SHORT[g.cat]} — category grade`}>
            <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: "0.08em", color: SUB }}>{CAT_SHORT[g.cat] || g.cat}</span>
            <Mini label={g.label} state={g.state} />
          </div>
          {g.traits.map((t) => (
            <div key={t.name} title={`${t.name}${t.state === "unknown" ? " — not scouted" : t.state === "range" ? " — scouting range" : ""}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, marginTop: 1 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: "#a9b6cc", overflow: "hidden", whiteSpace: "nowrap" }}>{t.abbr}{t.arrow ? <span style={{ color: t.arrow > 0 ? GOOD : BAD }}>{t.arrow > 0 ? "▴" : "▾"}</span> : null}</span>
              <Mini label={t.label} state={t.state} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// The reveal once he's yours: true overall, the jump his potential gives
// him, and where he ends up — vs the website's rating.
const REVEAL_COLOR = { STEAL: GOOD, UNDERRATED: GOOD, "AS ADVERTISED": SUB, OVERRATED: "#e0a24a", BUST: BAD };
export function Reveal({ rv, big = false }) {
  if (!rv) return null;
  const c = REVEAL_COLOR[rv.tag];
  const jc = rv.jump > 0.05 ? GOOD : rv.jump < -0.05 ? BAD : SUB;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: big ? 10 : 7, whiteSpace: "nowrap" }} title={`True overall ${rv.now.toFixed(1)} · potential ${rv.pot} → ${rv.jump >= 0 ? "+" : ""}${rv.jump.toFixed(1)} → ${rv.ovr.toFixed(1)} (website ${rv.rating.toFixed(1)})`}>
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
        <span style={{ fontSize: big ? 14 : 11, fontWeight: 900, color: INK }}>{rv.now.toFixed(1)}</span>
        <span style={{ fontSize: big ? 9 : 8, fontWeight: 900, color: SUB, marginTop: 2, letterSpacing: "0.06em" }}>TRUE</span>
      </span>
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
        <span style={{ fontSize: big ? 13 : 11, fontWeight: 900, color: jc }}>{rv.jump > 0 ? "▲" : rv.jump < 0 ? "▼" : ""}{Math.abs(rv.jump).toFixed(1)}</span>
        <span style={{ fontSize: big ? 9 : 8, fontWeight: 900, color: SUB, marginTop: 2, letterSpacing: "0.06em" }}>POT {rv.pot}</span>
      </span>
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
        <span style={{ fontSize: big ? 30 : 17, fontWeight: 900, color: c === SUB ? INK : c }}>{rv.ovr.toFixed(1)}</span>
        <span style={{ fontSize: big ? 10 : 8.5, fontWeight: 900, color: SUB, marginTop: 2, letterSpacing: "0.08em" }}>FINAL</span>
      </span>
      <span style={{ fontSize: big ? 11 : 9, fontWeight: 900, color: rv.tag === "AS ADVERTISED" ? SUB : "#111", background: rv.tag === "AS ADVERTISED" ? "transparent" : c, border: `1px solid ${c}`, borderRadius: 4, padding: big ? "2px 7px" : "1px 5px", letterSpacing: "0.06em" }}>{rv.tag}</span>
    </span>
  );
}
