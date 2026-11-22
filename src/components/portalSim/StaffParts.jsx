// src/components/portalSim/StaffParts.jsx
//
// The coaching staff in the Portal Sim (user, 2026-11-18 — engine "Coaching
// staffs", words in utils/portalSim/staff.js):
//   StaffStrip    your five coaches and who each is working (My Board) —
//                 DRAG a coach onto a player on your board (user,
//                 2026-11-18), or tap a coach, then tap the player. Phones
//                 don't drag (user, 2026-11-18): tapping a coach opens
//                 CoachSheet, a list of your board to pick from. They come
//                 home every window; "Same as last window" puts them back.
//   CoachButtons  the player card's coaches row — tap a coach to put him on
//                 this player (or take him off)
//   OnHim         a board row's coaches (× takes one off)
//   CoachTags     which coaches a school has on him (the card's interest list)
//   RecQuote      a recommendation: who said it, the tag, the line
//   RecChip       the small "HC pick" tag on a list row (quote on hover)
//   Briefing      the head coach's read when the portal opens — the WAR
//                 ROOM (user, 2026-11-22): his three needs, each in his
//                 words, then 5 priority targets and 5 more on the radar,
//                 each tagged Long shot / Realistic / Fallback (OddsTag)
//   OddsTag       a pick's odds as a small colored tag
import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useScrollLock } from "../../utils/scrollLock";
import TransferStars from "../TransferStars";
import PopLayer, { popMaxHeight } from "./PopLayer";
import { PlayerFace } from "./PortalCommunity";
import { STAFF_ROLES, ROLE_TITLE, ROLE_SHORT, ROLE_COLOR, recQuote, recHeadline, briefing, marketReport, posPlural, posWord, ODDS, oddsOf } from "../../utils/portalSim/staff";
import { needLevelOf } from "../../utils/portalSim/engine";

const GOLD = "#f6a21d";
const INK = "#eef2f8";
const SUB = "#8b9bb4";
const LINE = "#1f2b42";

// Last name for sorting ("Jr." and the like skipped).
export const lastOf = (n) => String(n || "").split(" ").filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).slice(-1)[0] || "";

export const CoachChip = ({ role, size = "sm", dim = false }) => (
  <span title={ROLE_TITLE[role]} style={{
    flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: size === "sm" ? 26 : 34, height: size === "sm" ? 18 : 24, padding: "0 5px", borderRadius: 5,
    fontSize: size === "sm" ? 10 : 12, fontWeight: 900, letterSpacing: "0.04em", color: "#0e1626", background: ROLE_COLOR[role], opacity: dim ? 0.35 : 1,
  }}>{role}</span>
);

// Your five coaches and who they're on — drag one onto a board player
// (armed: tapped, waiting for a tap on a player).
export function StaffStrip({ sim, onOpen, isMobile, armed, setArmed }) {
  const { state, staff, lastStaff } = sim;
  const canRepeat = lastStaff && Object.values(lastStaff).some(Boolean) && !Object.values(staff).some(Boolean) && sim.phase === "window";
  const [picking, setPicking] = useState(null); // phones: the coach whose player you're picking
  return (
    <div style={{ padding: "10px 12px", borderBottom: `1px solid ${LINE}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: SUB }}>YOUR STAFF</span>
        <span style={{ flex: "1 1 260px", fontSize: 11, fontWeight: 700, color: SUB }}>
          {isMobile
            ? "Tap a coach to pick the player he works — or set it from a player's card. Every window a coach is on a player builds his interest."
            : "Drag a coach onto a player on your board (or tap the coach, then the player). The head coach pushes hardest at every position; coordinators and assistants work their own side of the ball best. They come home every window."}
        </span>
        {canRepeat && <button type="button" onClick={sim.repeat} style={{ border: `1px solid ${GOLD}`, background: "rgba(246,162,29,0.12)", color: GOLD, borderRadius: 999, padding: "5px 11px", fontWeight: 900, fontSize: 11, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>↺ Same as last window</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 5}, minmax(0, 1fr))`, gap: 6 }}>
        {STAFF_ROLES.map((role) => <StaffCard key={role} sim={sim} role={role} p={staff[role] ? state.players[staff[role]] : null} onOpen={onOpen} armed={armed === role} setArmed={setArmed} isMobile={isMobile} onPick={() => setPicking(role)} />)}
      </div>
      {picking && <CoachSheet sim={sim} role={picking} onClose={() => setPicking(null)} />}
    </div>
  );
}
function StaffCard({ sim, role, p, onOpen, armed, setArmed, isMobile, onPick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `coach:${role}`, disabled: sim.phase !== "window" || isMobile });
  // Phones: the whole card opens the player picker.
  if (isMobile) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "7px 9px", borderRadius: 10, background: "#111a2b", border: `1px solid ${p ? `${ROLE_COLOR[role]}66` : LINE}` }}>
        <button type="button" disabled={sim.phase !== "window"} onClick={onPick} aria-label={`Assign the ${ROLE_TITLE[role]}`} style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <CoachChip role={role} size="md" />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", color: SUB, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ROLE_SHORT[role]}</span>
            <span style={{ display: "block", fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: p ? INK : GOLD }}>{p ? p.name : "Tap to assign"}</span>
          </span>
        </button>
        {p && <button type="button" aria-label="Take him off" onClick={() => sim.assign(role, null)} style={{ all: "unset", cursor: "pointer", color: SUB, fontWeight: 900, fontSize: 14, padding: "4px 4px" }}>✕</button>}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "7px 9px", borderRadius: 10, background: armed ? "rgba(246,162,29,0.14)" : "#111a2b", border: `1px solid ${armed ? GOLD : p ? `${ROLE_COLOR[role]}66` : LINE}` }}>
      <button ref={setNodeRef} {...attributes} {...listeners} type="button" onClick={() => setArmed(armed ? null : role)} title="Drag onto a player on your board — or tap, then tap the player"
        style={{ all: "unset", cursor: "grab", touchAction: "none", opacity: isDragging ? 0.25 : 1, display: "inline-flex", boxShadow: armed ? `0 0 0 2px ${GOLD}` : "none", borderRadius: 6, transition: "transform .12s", transform: isDragging ? "scale(0.9)" : undefined }}>
        <CoachChip role={role} size="md" />
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", color: SUB, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ROLE_SHORT[role]}</div>
        {p ? <button type="button" onClick={() => onOpen(p.id)} style={{ all: "unset", cursor: "pointer", fontSize: 13, fontWeight: 900, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{p.name}</button>
          : <div style={{ fontSize: 12, fontWeight: 800, color: "#5b6b84" }}>{armed ? "Tap a player…" : "Open"}</div>}
      </div>
      {p && <button type="button" title="Take him off" onClick={() => sim.assign(role, null)} style={{ all: "unset", cursor: "pointer", color: SUB, fontWeight: 900, fontSize: 12, padding: "0 2px" }}>✕</button>}
    </div>
  );
}
// Phones: pick the player a coach works — your board, in your order (a
// bottom sheet over the sim; the page behind stays put).
export function CoachSheet({ sim, role, onClose }) {
  useScrollLock(true);
  const { staff } = sim;
  const board = sim.boardList.filter((p) => p.status === "portal");
  const pick = (pid) => { sim.assign(role, staff[role] === pid ? null : pid); onClose(); };
  return (
    <div role="dialog" aria-modal="true" aria-label={`Assign the ${ROLE_TITLE[role]}`} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(3,7,14,0.75)", display: "flex", alignItems: "flex-end", justifyContent: "center", overscrollBehavior: "contain" }}>
      <div onClick={(e) => e.stopPropagation()} className="wd-sim-pop" style={{ width: "100%", maxWidth: 520, maxHeight: "78vh", display: "flex", flexDirection: "column", background: "#0e1626", borderTop: `3px solid ${ROLE_COLOR[role]}`, borderRadius: "16px 16px 0 0", color: INK, paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${LINE}` }}>
          <CoachChip role={role} size="md" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 15 }}>{ROLE_TITLE[role]}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: SUB }}>Pick the player he works this window</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ all: "unset", cursor: "pointer", fontSize: 22, fontWeight: 900, padding: "0 6px" }}>×</button>
        </div>
        <div className="wd-sim-scroll" style={{ overflowY: "auto", overscrollBehavior: "contain", flex: 1, minHeight: 0 }}>
          {board.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: SUB, fontWeight: 700, fontSize: 13 }}>Your board is empty — contact players first.</div> : board.map((p, i) => {
            const on = staff[role] === p.id;
            const others = STAFF_ROLES.filter((r) => r !== role && staff[r] === p.id);
            return (
              <button key={p.id} type="button" onClick={() => pick(p.id)} style={{ all: "unset", boxSizing: "border-box", width: "100%", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${LINE}`, background: on ? `${ROLE_COLOR[role]}22` : "transparent" }}>
                <span style={{ width: 18, textAlign: "right", fontWeight: 900, fontSize: 12, color: i < 3 ? GOLD : SUB }}>{i + 1}</span>
                <TransferStars stars={p.stars} size="sm" />
                <span style={{ fontSize: 11, fontWeight: 900, color: "#9fc3ff", width: 30, textAlign: "center" }}>{p.sub || p.pos}</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                {others.map((r) => <CoachChip key={r} role={r} />)}
                <span style={{ fontSize: 11, fontWeight: 900, color: on ? ROLE_COLOR[role] : SUB }}>{on ? "On him ✓" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// The player card's coaches: tap one to put him on this player — or, if
// he's already on him, to take him off. Where each coach is now, under him.
export function CoachButtons({ sim, pid }) {
  const { state, staff } = sim;
  const off = sim.phase !== "window";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6, width: "100%" }}>
      {STAFF_ROLES.map((r) => {
        const on = staff[r] === pid;
        const where = staff[r] && !on ? state.players[staff[r]] : null;
        return (
          <button key={r} type="button" disabled={off} onClick={() => sim.assign(r, on ? null : pid)} title={on ? `Take the ${ROLE_TITLE[r]} off him` : `Put the ${ROLE_TITLE[r]} on him`}
            style={{ all: "unset", cursor: off ? "default" : "pointer", boxSizing: "border-box", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 2px", borderRadius: 10,
              background: on ? `${ROLE_COLOR[r]}26` : "#0b1322", border: `1px solid ${on ? ROLE_COLOR[r] : LINE}` }}>
            <CoachChip role={r} size="md" dim={!on && !!where} />
            <span style={{ fontSize: 9, fontWeight: 900, color: on ? ROLE_COLOR[r] : SUB, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>
              {on ? "ON HIM" : where ? lastOf(where.name) : "FREE"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// A board row's coaches — × takes one off.
export function OnHim({ sim, pid }) {
  const roles = STAFF_ROLES.filter((r) => sim.staff[r] === pid);
  if (!roles.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 3, flexShrink: 0 }}>
      {roles.map((r) => (
        <button key={r} type="button" title={`${ROLE_TITLE[r]} is on him — click to take him off`} onClick={(e) => { e.stopPropagation(); sim.assign(r, null); }} style={{ all: "unset", cursor: "pointer", display: "inline-flex" }}>
          <CoachChip role={r} />
        </button>
      ))}
    </span>
  );
}

// A school's coaches on him.
export const CoachTags = ({ state, slug, pid }) => {
  const roles = STAFF_ROLES.filter((r) => state.teams[slug]?.staff?.[r] === pid);
  if (!roles.length) return null;
  return <span style={{ display: "inline-flex", gap: 3 }}>{roles.map((r) => <CoachChip key={r} role={r} />)}</span>;
};

// A recommendation: role, tag, the line.
export function RecQuote({ state, pid, rec, compact = false }) {
  if (!rec) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: compact ? "0 16px 10px 16px" : "10px 12px", ...(compact ? {} : { borderRadius: 10, background: "rgba(246,162,29,0.08)", border: "1px solid rgba(246,162,29,0.35)" }) }}>
      <CoachChip role={rec.by} size={compact ? "sm" : "md"} />
      <div style={{ minWidth: 0, fontSize: compact ? 12 : 13, lineHeight: 1.45 }}>
        <span style={{ fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: compact ? 10 : 11 }}>{recHeadline(state, rec)}</span>
        {!compact && <span style={{ fontWeight: 800, color: SUB }}> · {ROLE_TITLE[rec.by]}</span>}
        {!compact && <span style={{ marginLeft: 8 }}><OddsTag rec={rec} /></span>}
        <div style={{ fontWeight: 700, fontStyle: "italic", color: INK }}>“{recQuote(state, pid, rec)}”</div>
      </div>
    </div>
  );
}
// A pick's odds (user, 2026-11-22): Long shot / Realistic / Fallback.
export const OddsTag = ({ rec, odds = oddsOf(rec), size = "sm" }) => {
  const o = ODDS[odds];
  if (!o) return null;
  return (
    <span title={o.blurb} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, fontSize: size === "sm" ? 9 : 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: o.color, background: `${o.color}1f`, border: `1px solid ${o.color}66`, borderRadius: 999, padding: size === "sm" ? "1px 7px" : "3px 9px", whiteSpace: "nowrap", lineHeight: 1.4 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: o.color }} />{o.label}
    </span>
  );
};
// compact: the phone rows' tag beside the name — "★HC", no border growth.
export const RecChip = ({ state, pid, rec, compact = false }) => (rec ? (
  <span title={`${ROLE_TITLE[rec.by]}: “${recQuote(state, pid, rec)}”`} style={compact
    ? { flexShrink: 0, display: "inline-flex", alignItems: "center", fontSize: 9, fontWeight: 900, letterSpacing: "0.02em", color: "#0e1626", background: GOLD, borderRadius: 4, padding: "1px 4px", lineHeight: 1.3, whiteSpace: "nowrap" }
    : { flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 900, letterSpacing: "0.04em", color: GOLD, border: "1px solid rgba(246,162,29,0.5)", borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap" }}>
    {compact ? `★${rec.by}` : `★ ${rec.by} pick`}
  </span>
) : null);

// The head coach's needs as cards (the briefing, and Market Watch's
// halftime report): number, position, need level, his words, the facts.
export function NeedCards({ top, isMobile }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${Math.max(1, top.length)}, minmax(0, 1fr))`, gap: 10 }}>
      {top.map((x, i) => {
        const [, need, color] = needLevelOf(x.level);
        const fact = [x.lost?.length ? `Lost ${x.lost.slice(0, 2).map((l) => l.name).join(", ")}${x.lost.length > 2 ? ` +${x.lost.length - 2}` : ""}` : null, x.goal != null && x.have < x.goal ? `${x.have} of ${x.goal} ${posPlural(x.pos)}` : `${x.have} ${x.have === 1 ? posWord(x.pos) : posPlural(x.pos)} on the roster`].filter(Boolean).join(" · ");
        return (
          <div key={x.pos} className="wd-sim-pop" style={{ animationDelay: `${0.1 + i * 0.12}s`, position: "relative", padding: "14px 14px 12px", borderRadius: 14, background: `linear-gradient(160deg, ${color}1c, #0e1626 55%)`, border: `1px solid ${color}55`, borderTop: `3px solid ${color}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ fontSize: isMobile ? 26 : 32, fontWeight: 900, lineHeight: 1, letterSpacing: "0.02em" }}>{x.pos}</span>
              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0e1626", background: color, borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" }}>{need}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800, fontStyle: "italic", lineHeight: 1.45 }}>“{x.line}”</div>
            <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: SUB }}>{fact}</div>
          </div>
        );
      })}
    </div>
  );
}

// The head coach's briefing — right after the NFL and departures are set.
// The WAR ROOM (user, 2026-11-22): a dark tactical board — his three needs
// as big cards with his words on each, then the targets: 5 priority (the
// three needs first) and 5 more on the radar, every one tagged with its
// odds. Renders over the page (PopLayer) and scrolls inside itself.
const ODDS_RANK = { longshot: 0, realistic: 1, fallback: 2 };
export const WR_BG = "#0a1120";
export const GRID = "linear-gradient(rgba(120,160,220,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(120,160,220,0.05) 1px, transparent 1px)";
export const MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
export function Briefing({ sim, team, brand, isMobile, onClose }) {
  useScrollLock(true);
  const { state, recs } = sim;
  const b = brand(team) || {};
  const c1 = b.Color1 || "#0055a5";
  // Second half: the halftime report's read and priorities (user, 2026-11-22).
  const half = state.cfg.split?.at && state.window > state.cfg.split.at;
  const { intro, top } = half ? marketReport(state, team) : briefing(state, team);
  const topPos = top.map((x) => x.pos);
  const all = Object.entries(recs).map(([pid, rec]) => ({ p: state.players[pid], rec })).filter((x) => x.p?.status === "portal");
  const at = (rec) => { const i = topPos.indexOf(rec.pos); return i < 0 ? 9 : i; };
  const ordered = all.sort((a, b) => at(a.rec) - at(b.rec) || (at(a.rec) < 9 ? ODDS_RANK[oddsOf(a.rec)] - ODDS_RANK[oddsOf(b.rec)] : (b.rec.pri || 0) - (a.rec.pri || 0)) || b.p.stars - a.p.stars || lastOf(a.p.name).localeCompare(lastOf(b.p.name)));
  const priority = ordered.slice(0, 5);
  const radar = ordered.slice(5, 10);
  const label = { fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: SUB, textTransform: "uppercase" };
  const target = ({ p, rec }, i, hot) => {
    const on = sim.starred.has(p.id);
    const from = brand(p.team, p) || {};
    return (
      <div key={p.id} style={{ display: "flex", gap: isMobile ? 10 : 14, alignItems: "flex-start", padding: isMobile ? "10px 10px" : "12px 14px", borderRadius: 12, marginBottom: 8, background: hot ? "linear-gradient(90deg, rgba(246,162,29,0.08), rgba(17,26,43,0.9) 40%)" : "#0e1626", border: `1px solid ${hot ? "rgba(246,162,29,0.35)" : LINE}`, borderLeft: `4px solid ${ODDS[oddsOf(rec)]?.color || LINE}` }}>
        <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12, color: hot ? GOLD : SUB, width: 18, flexShrink: 0, paddingTop: isMobile ? 10 : 13 }}>{String(i + 1).padStart(2, "0")}</span>
        <PlayerFace id={p.id} size={isMobile ? 40 : 48} ring={from.Color1 || LINE} logo={from.LogoDark || from.Logo1 || ""} badge />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => sim.openCard(p.id)} style={{ all: "unset", cursor: "pointer", fontWeight: 900, fontSize: isMobile ? 15 : 17, textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: 3 }}>{p.name}</button>
            <OddsTag rec={rec} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap", fontSize: 11, fontWeight: 800, color: SUB }}>
            <TransferStars stars={p.stars} size="sm" />
            <span style={{ color: "#9fc3ff", fontWeight: 900 }}>{p.sub || p.pos}</span>
            <span>· {state.teams[p.team]?.school}</span>
            <span>· {p.elig} yr{p.elig === 1 ? "" : "s"} left</span>
          </div>
          {!on && (
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 7 }}>
              <CoachChip role={rec.by} />
              <div style={{ fontSize: 12, lineHeight: 1.45, color: "#c9d4e5", fontStyle: "italic", fontWeight: 700 }}>“{recQuote(state, p.id, rec)}”</div>
            </div>
          )}
        </div>
        <button type="button" disabled={!on && sim.board.full} onClick={() => sim.toggleStar(p.id)} style={{ flexShrink: 0, alignSelf: "center", border: `1px solid ${on ? "#2e7d32" : GOLD}`, background: on ? "#2e7d32" : "rgba(246,162,29,0.12)", color: on ? "#fff" : GOLD, borderRadius: 999, padding: "7px 14px", fontWeight: 900, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: !on && sim.board.full ? 0.4 : 1 }}>{on ? "✓ On board" : "Contact"}</button>
      </div>
    );
  };
  return (
    <PopLayer>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 19000, background: "rgba(3,7,14,0.8)", display: "flex", alignItems: isMobile ? "stretch" : "center", justifyContent: "center", padding: isMobile ? 0 : 20, overscrollBehavior: "contain" }}>
        <div role="dialog" aria-modal="true" aria-label="Head coach's briefing" onClick={(e) => e.stopPropagation()} className="wd-sim-pop" style={{ width: "100%", maxWidth: 940, maxHeight: isMobile ? "100%" : popMaxHeight(40), display: "flex", flexDirection: "column", background: WR_BG, backgroundImage: GRID, backgroundSize: "28px 28px", border: isMobile ? "none" : `1px solid #24324d`, borderRadius: isMobile ? 0 : 18, overflow: "hidden", color: INK, fontFamily: "Arial, sans-serif", boxShadow: "0 30px 80px rgba(0,0,0,0.7)" }}>
          {/* The room's header: status bar, then the head coach. */}
          <div style={{ flexShrink: 0, position: "relative", overflow: "hidden", background: `radial-gradient(700px 220px at 0% 0%, color-mix(in srgb, ${c1} 70%, transparent) 0%, transparent 70%), linear-gradient(180deg, #0d1628, #0a1120)`, borderBottom: "1px solid #24324d" }}>
            {(b.LogoDark || b.Logo1) && <img src={b.LogoDark || b.Logo1} alt="" aria-hidden="true" style={{ position: "absolute", right: -30, top: "50%", transform: "translateY(-50%)", height: 200, opacity: 0.08, pointerEvents: "none" }} />}
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "8px 14px" : "8px 22px", borderBottom: "1px solid rgba(255,255,255,0.06)", ...label, fontSize: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#ff5b5b", whiteSpace: "nowrap", flexShrink: 0 }}><span className="wd-wr-live" style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff5b5b" }} />WAR ROOM</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.School || state.teams[team]?.school} · Portal window {state.window}{sim.board.evalPeriod ? " · Evaluation period" : ""}</span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={onClose} aria-label="Close" style={{ all: "unset", cursor: "pointer", color: INK, fontSize: 20, lineHeight: 1, padding: "0 2px" }}>×</button>
            </div>
            <div style={{ position: "relative", padding: isMobile ? "14px 14px 16px" : "18px 22px 20px", display: "flex", gap: 14, alignItems: "flex-start" }}>
              <CoachChip role="HC" size="md" />
              <div style={{ minWidth: 0 }}>
                <div style={{ ...label, color: GOLD }}>{half ? "Halftime report" : "Head coach's briefing"}</div>
                <div style={{ marginTop: 6, fontSize: isMobile ? 15 : 22, fontWeight: 900, lineHeight: 1.3 }}>“{intro}”</div>
              </div>
            </div>
          </div>
          {/* The board — scrolls inside the room. */}
          <div className="wd-sim-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: isMobile ? "14px 12px 18px" : "18px 22px 22px" }}>
            <style>{"@keyframes wdWrLive { 0%, 100% { opacity: 1 } 50% { opacity: .25 } } .wd-wr-live { animation: wdWrLive 1.4s ease-in-out infinite; }"}</style>
            <div style={{ ...label, marginBottom: 10 }}>{half ? "Second-half priorities" : "The three needs"}</div>
            {top.length === 0 ? <div style={{ color: SUB, fontWeight: 700, fontSize: 13 }}>No pressing needs — we get to be picky.</div> : (
              <NeedCards top={top} isMobile={isMobile} />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "22px 0 10px" }}>
              <span style={{ ...label, color: GOLD }}>Priority targets</span>
              <span style={{ flex: 1, height: 1, background: "#24324d", minWidth: 20 }} />
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>{Object.keys(ODDS).map((k) => <OddsTag key={k} odds={k} />)}</span>
            </div>
            {priority.length === 0 ? <div style={{ color: SUB, fontWeight: 700, fontSize: 13 }}>No one realistic yet — we&apos;ll keep looking every window.</div> : priority.map((x, i) => target(x, i, true))}
            {radar.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 10px" }}>
                  <span style={label}>Also on our radar</span>
                  <span style={{ flex: 1, height: 1, background: "#24324d" }} />
                </div>
                {radar.map((x, i) => target(x, i + 5, false))}
              </>
            )}
          </div>
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "10px 12px" : "12px 22px", borderTop: "1px solid #24324d", background: "#0b1322" }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: SUB, whiteSpace: "nowrap" }}>{sim.board.count}/{sim.board.limit} contacts</span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={onClose} style={{ border: "none", borderRadius: 999, padding: isMobile ? "10px 16px" : "11px 24px", fontWeight: 900, fontSize: isMobile ? 12 : 14, letterSpacing: "0.06em", textTransform: "uppercase", background: GOLD, color: "#fff", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Let&apos;s go to work →</button>
          </div>
        </div>
      </div>
    </PopLayer>
  );
}
