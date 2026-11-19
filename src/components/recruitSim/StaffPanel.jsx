// src/components/recruitSim/StaffPanel.jsx
//
// The six staff members, one per row, coaches apart from scouts (user,
// 2026-11-17). Assigning is direct — no forms, no Assign button:
//   • drag a staff chip onto a recruit on the board → works that recruit
//   • drag it onto a region on the map → works that region
//   • or tap a chip (it lights up), then tap a recruit row or a region
// Area assignments can cover any set of position groups (RB and TE scout
// together) — offense on one line, defense on the next; the staffer's work
// stays the same, just spread across more kids. Staff come home every window;
// "Same as last window" puts them back. Everything takes effect at close.
import { useDraggable } from "@dnd-kit/core";
import { ROLES, ROLE_LABEL, COACHES, groupsFor, groupList, POS_GROUPS } from "../../utils/recruitSim/work";
import { REGION_LABEL } from "../../utils/recruitSim/regions";
import { phaseOf } from "../../utils/recruitSim/model";
import { sideOf, OFFENSE } from "../../utils/recruitSim/traits";
import { SUB, LINE, GOLD, INK, ROW, smallBtn } from "./ui";
import { REGION_COLOR } from "./USMap";

const SHORT = { HC: "Builds interest · every position · recommends", OC: "Builds interest · offense · recommends", DC: "Builds interest · defense · recommends", HS: "Scouts every position", OS: "Scouts offense", DS: "Scouts defense" };

export default function StaffPanel({ sim, armed, setArmed, onOpen, compact = false }) {
  const { state } = sim;
  const usc = state.schools[state.user];
  const winter = phaseOf(state) === "winter";
  const last = usc.lastStaff || [];
  const canRepeat = last.some(Boolean) && last.some((a, i) => JSON.stringify(a) !== JSON.stringify(usc.staff[i]));
  return (
    <div>
      {canRepeat && (
        <button type="button" style={{ ...smallBtn("gold"), width: "100%", padding: "7px 10px", marginBottom: 6 }} onClick={() => sim.actions.repeatStaff()}>
          ↺ Same as last window
        </button>
      )}
      {[["Coaches · build interest", ["HC", "OC", "DC"]], ["Scouts · uncover grades", ["HS", "OS", "DS"]]].map(([title, roles]) => (
        <div key={title} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: SUB, textTransform: "uppercase", margin: "4px 0 6px" }}>{title}</div>
          {roles.map((role) => <StaffRow key={role} sim={sim} role={role} a={usc.staff[ROLES.indexOf(role)]} armed={armed === role} setArmed={setArmed} onOpen={onOpen} compact={compact} />)}
        </div>
      ))}
      <div style={{ fontSize: 11, color: SUB, fontWeight: 700, lineHeight: 1.4 }}>
        Drag a staff member onto {winter ? "a region on the map" : "a recruit or a region on the map"} — or tap them, then tap the target.{winter ? " Individual recruits open in Spring." : ""}
      </div>
    </div>
  );
}

function StaffRow({ sim, role, a, armed, setArmed, onOpen, compact }) {
  const { state, actions } = sim;
  const coach = COACHES.has(role);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `staff:${role}` });
  const x = a?.kind === "recruit" ? state.recruits[a.r] : null;
  const color = coach ? "#0055a5" : "#5b3fb0";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 4, borderRadius: 10, background: armed ? "rgba(246,162,29,0.14)" : ROW, border: `1px solid ${armed ? GOLD : LINE}` }}>
      <button ref={setNodeRef} {...attributes} {...listeners} type="button" onClick={() => setArmed(armed ? null : role)} title="Drag onto a recruit or a region — or tap, then tap the target"
        style={{ cursor: "grab", touchAction: "none", border: "none", background: color, color: "#fff", fontWeight: 900, fontSize: 12, borderRadius: 8, width: 40, height: 32, flexShrink: 0, opacity: isDragging ? 0.4 : 1, fontFamily: "inherit", boxShadow: armed ? `0 0 0 2px ${GOLD}` : "none" }}>
        {role}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {!a ? <span style={{ color: "#ff8a7a" }}>Unassigned</span>
            : a.kind === "area" ? <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: REGION_COLOR[a.region], marginRight: 5 }} />{REGION_LABEL[a.region]}</span>
              : <span className="rs-link" onClick={() => onOpen(a.r)}>{x.first} {x.last} <span style={{ color: SUB }}>· {x.pos}{!coach ? ` · ${state.cfg.scouting.individual[role][sideOf(x.pos)]} looks` : ""}</span></span>}
        </div>
        {!compact && !a && <div style={{ fontSize: 10, color: SUB, fontWeight: 700 }}>{ROLE_LABEL[role]} · {SHORT[role]}</div>}
        {a?.kind === "area" && <GroupPicker role={role} a={a} onPick={(pos) => actions.assign(role, { kind: "area", region: a.region, pos })} />}
      </div>
      {a && <button type="button" style={{ ...smallBtn(), padding: "2px 6px" }} title="Unassign" onClick={() => actions.assign(role, null)}>✕</button>}
    </div>
  );
}

// Offense on one line, defense on the next; pick any set (none = All).
const isOff = (g) => POS_GROUPS[g].some((p) => OFFENSE.has(p));
function GroupPicker({ role, a, onPick }) {
  const sel = groupList(a) || [];
  const all = !sel.length;
  const groups = groupsFor(role);
  const toggle = (g) => { const next = sel.includes(g) ? sel.filter((v) => v !== g) : [...sel, g]; onPick(next.length ? next : "ALL"); };
  const pill = (on) => ({ border: `1px solid ${on ? GOLD : LINE}`, background: on ? GOLD : "transparent", color: on ? "#111" : INK, borderRadius: 999, padding: "0 7px", fontSize: 9.5, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", lineHeight: "17px" });
  const line = (list, label) => list.length > 0 && (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center", marginTop: 3 }}>
      <span style={{ fontSize: 8.5, fontWeight: 900, color: SUB, width: 24, letterSpacing: "0.06em" }}>{label}</span>
      {list.map((g) => <button key={g} type="button" style={pill(sel.includes(g))} onClick={() => toggle(g)}>{g}</button>)}
    </div>
  );
  return (
    <div style={{ marginTop: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" style={pill(all)} onClick={() => onPick("ALL")}>All positions</button>
        {!all && <span style={{ fontSize: 9.5, color: SUB, fontWeight: 800 }}>{sel.length} group{sel.length > 1 ? "s" : ""}</span>}
      </div>
      {line(groups.filter(isOff), "OFF")}
      {line(groups.filter((g) => !isOff(g)), "DEF")}
    </div>
  );
}
