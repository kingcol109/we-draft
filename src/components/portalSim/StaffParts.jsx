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
//   Briefing      the head coach's read when the portal opens: priorities,
//                 then the targets he and the staff recommend
import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useScrollLock } from "../../utils/scrollLock";
import TransferStars from "../TransferStars";
import { STAFF_ROLES, ROLE_TITLE, ROLE_SHORT, ROLE_COLOR, recQuote, recHeadline, briefing, posPlural } from "../../utils/portalSim/staff";
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
        <div style={{ fontWeight: 700, fontStyle: "italic", color: INK }}>“{recQuote(state, pid, rec)}”</div>
      </div>
    </div>
  );
}
// compact: the phone rows' tag beside the name — "★HC", no border growth.
export const RecChip = ({ state, pid, rec, compact = false }) => (rec ? (
  <span title={`${ROLE_TITLE[rec.by]}: “${recQuote(state, pid, rec)}”`} style={compact
    ? { flexShrink: 0, display: "inline-flex", alignItems: "center", fontSize: 9, fontWeight: 900, letterSpacing: "0.02em", color: "#0e1626", background: GOLD, borderRadius: 4, padding: "1px 4px", lineHeight: 1.3, whiteSpace: "nowrap" }
    : { flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 900, letterSpacing: "0.04em", color: GOLD, border: "1px solid rgba(246,162,29,0.5)", borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap" }}>
    {compact ? `★${rec.by}` : `★ ${rec.by} pick`}
  </span>
) : null);

// The head coach's briefing — right after the NFL and departures are set.
export function Briefing({ sim, team, brand, isMobile, onClose }) {
  useScrollLock(true);
  const { state, recs } = sim;
  const b = brand(team) || {};
  const c1 = b.Color1 || "#0055a5";
  const { intro, priorities } = briefing(state, team);
  const targets = Object.entries(recs).map(([pid, rec]) => ({ p: state.players[pid], rec })).filter((x) => x.p?.status === "portal")
    .sort((a, b) => b.p.stars - a.p.stars || lastOf(a.p.name).localeCompare(lastOf(b.p.name)));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 19000, background: "rgba(3,7,14,0.75)", display: "flex", alignItems: isMobile ? "stretch" : "flex-start", justifyContent: "center", padding: isMobile ? 0 : "70px 16px 24px", overflowY: "auto", overscrollBehavior: "contain" }}>
      <div role="dialog" aria-label="Head coach's briefing" onClick={(e) => e.stopPropagation()} className="wd-sim-pop wd-sim-scroll" style={{ width: "100%", maxWidth: 820, background: "#0e1626", border: isMobile ? "none" : `1px solid ${LINE}`, borderRadius: isMobile ? 0 : 18, overflow: "hidden", color: INK, maxHeight: isMobile ? "100%" : "none", overflowY: isMobile ? "auto" : "visible", overscrollBehavior: "contain", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ position: "relative", overflow: "hidden", padding: isMobile ? "18px 14px" : "22px 24px", background: `linear-gradient(115deg, ${c1} 0%, color-mix(in srgb, ${c1} 55%, #000) 100%)` }}>
          {(b.LogoDark || b.Logo1) && <img src={b.LogoDark || b.Logo1} alt="" aria-hidden="true" style={{ position: "absolute", right: -20, top: "50%", transform: "translateY(-50%)", height: 180, opacity: 0.12, pointerEvents: "none" }} />}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
            <CoachChip role="HC" size="md" />
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.18em", opacity: 0.85 }}>HEAD COACH · THE PORTAL IS OPEN</div>
              <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05 }}>Where we stand</div>
            </div>
          </div>
          <div style={{ position: "relative", marginTop: 12, fontSize: isMobile ? 14 : 16, fontWeight: 800, fontStyle: "italic", lineHeight: 1.45 }}>“{intro}”</div>
        </div>
        <div style={{ padding: isMobile ? "12px 14px 18px" : "16px 24px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", color: SUB, margin: "4px 0 8px" }}>PRIORITIES</div>
          {priorities.length === 0 ? <div style={{ color: SUB, fontWeight: 700, fontSize: 13 }}>No pressing needs.</div> : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 6 }}>
              {priorities.slice(0, 8).map((x) => {
                const [, label, color] = needLevelOf(x.level);
                return (
                  <div key={x.pos} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "#111a2b", border: `1px solid ${LINE}` }}>
                    <span style={{ width: 42, flexShrink: 0, textAlign: "center", fontWeight: 900, color: "#9fc3ff" }}>{x.pos}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color }}>{label}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: SUB, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {x.lost.length ? `Lost ${x.lost.slice(0, 2).map((l) => l.name).join(", ")}${x.lost.length > 2 ? ` +${x.lost.length - 2}` : ""}` : "Room to improve"}
                        {x.goal ? ` · ${x.have} of ${x.goal} ${posPlural(x.pos)}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", color: SUB, margin: "18px 0 8px" }}>TARGETS WE LIKE ({targets.length})</div>
          {targets.length === 0 ? <div style={{ color: SUB, fontWeight: 700, fontSize: 13 }}>No one realistic yet — we'll keep looking every window.</div> : targets.map(({ p, rec }) => {
            const on = sim.starred.has(p.id);
            return (
              <div key={p.id} style={{ padding: "10px 0", borderTop: `1px solid ${LINE}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <TransferStars stars={p.stars} size="sm" />
                  <span style={{ width: 40, flexShrink: 0, textAlign: "center", fontSize: 11, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "3px 0" }}>{p.sub || p.pos}</span>
                  <button type="button" onClick={() => sim.openCard(p.id)} style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0, fontWeight: 900, fontSize: 15, textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: 3 }}>{p.name}</button>
                  <span style={{ fontSize: 11, fontWeight: 800, color: SUB, whiteSpace: "nowrap" }}>{state.teams[p.team]?.school}</span>
                  <button type="button" disabled={!on && sim.board.full} onClick={() => sim.toggleStar(p.id)} style={{ border: `1px solid ${on ? "#2e7d32" : LINE}`, background: on ? "#2e7d32" : "transparent", color: "#fff", borderRadius: 999, padding: "5px 11px", fontWeight: 900, fontSize: 11, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: !on && sim.board.full ? 0.4 : 1 }}>{on ? "On board" : "Contact"}</button>
                </div>
                {!on && <RecQuote state={state} pid={p.id} rec={rec} compact />}
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={onClose} style={{ border: "none", borderRadius: 999, padding: "11px 24px", fontWeight: 900, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", background: GOLD, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Let's go to work →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
