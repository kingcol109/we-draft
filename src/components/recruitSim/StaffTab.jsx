// src/components/recruitSim/StaffTab.jsx
//
// The staff, full size (user, 2026-11-17): one staffer per row, coaches apart
// from scouts, a big map to drop them on, and your board as drop targets for
// individual work. Same drag / tap-to-assign as the Board tab; no Assign
// button — it all takes effect when the window closes.
import { useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDroppable } from "@dnd-kit/core";
import { Section, RatingBlock, InterestMeter, GOLD, SUB, LINE, ROW } from "./ui";
import StaffPanel from "./StaffPanel";
import USMap, { staffCollide } from "./USMap";
import { getPageScale } from "../../utils/pageZoom";
import { useStaffAssign } from "./BoardTab";
import { phaseOf } from "../../utils/recruitSim/model";
import { interestView } from "../../utils/recruitSim/view";
import { ROLES } from "../../utils/recruitSim/work";

export default function StaffTab({ sim, onOpen, isMobile }) {
  const { state } = sim;
  const usc = state.schools[state.user];
  const winter = phaseOf(state) === "winter";
  const [armed, setArmed] = useState(null);
  const [metric, setMetric] = useState("scout");
  const [dragging, setDragging] = useState(null);
  const assignTo = useStaffAssign(sim);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 6 } }));
  const staffByRegion = useMemo(() => {
    const m = {};
    usc.staff.forEach((a, i) => { if (a?.kind === "area") (m[a.region] = m[a.region] || []).push(ROLES[i]); });
    return m;
  }, [usc.staff, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (target) => { if (armed) { assignTo(armed, target); setArmed(null); } };

  return (
    <DndContext sensors={sensors} collisionDetection={staffCollide} onDragStart={({ active }) => setDragging(active.id)} onDragCancel={() => setDragging(null)}
      onDragEnd={({ active, over }) => { setDragging(null); if (over) assignTo(String(active.id).slice(6), over.id); setArmed(null); }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(320px, 1fr) minmax(0, 1.2fr)", gap: 12, alignItems: "start" }}>
        <Section title="Your staff">
          <div style={{ padding: 12 }}><StaffPanel sim={sim} armed={armed} setArmed={setArmed} onOpen={onOpen} /></div>
        </Section>
        <div>
          <Section title="Send them out">
            <div style={{ padding: 12 }}><USMap state={state} ver={sim.ver} metric={metric} setMetric={setMetric} armed={armed} onPick={(st) => go(`state:${st}`)} staffByRegion={staffByRegion} compact={isMobile} /></div>
          </Section>
          {!winter && (
            <Section title="Or work one recruit">
              <div style={{ padding: "6px 12px", fontSize: 12, color: SUB, fontWeight: 700 }}>Drop a coach to build the most interest with him, or a scout for 10–12 concentrated looks (exact grades).</div>
              {usc.board.length ? usc.board.map((r) => <Target key={r} sim={sim} r={r} armed={armed} onTap={() => (armed ? go(r) : onOpen(r))} />)
                : <div style={{ padding: 14, color: SUB, fontWeight: 700, fontSize: 13 }}>Your board is empty.</div>}
            </Section>
          )}
        </div>
      </div>
      <DragOverlay style={{ zoom: 1 / getPageScale() }} dropAnimation={null}>
        {dragging ? <span style={{ display: "inline-block", background: GOLD, color: "#111", fontWeight: 900, borderRadius: 8, padding: "7px 10px", boxShadow: "0 8px 20px rgba(0,0,0,0.5)" }}>{String(dragging).slice(6)}</span> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Target({ sim, r, armed, onTap }) {
  const { state } = sim;
  const x = state.recruits[r];
  const { setNodeRef, isOver } = useDroppable({ id: r });
  const on = state.schools[state.user].staff.map((a, i) => (a?.kind === "recruit" && a.r === r ? ROLES[i] : null)).filter(Boolean);
  return (
    <div ref={setNodeRef} className="rs-row" onClick={onTap} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 12px", borderBottom: `1px solid ${LINE}`, background: isOver ? "rgba(246,162,29,0.18)" : ROW, cursor: armed ? "copy" : "pointer", outline: isOver ? `1px solid ${GOLD}` : "none" }}>
      <RatingBlock x={x} size={14} />
      <span style={{ flex: 1, fontWeight: 900, fontSize: 13 }}>{x.first} {x.last} <span style={{ color: GOLD, fontSize: 11 }}>{x.pos}</span></span>
      {on.map((role) => <span key={role} style={{ fontSize: 10, fontWeight: 900, color: "#fff", background: ["HC", "OC", "DC"].includes(role) ? "#0055a5" : "#5b3fb0", borderRadius: 4, padding: "1px 5px" }}>{role}</span>)}
      <InterestMeter v={interestView(state, r)} compact />
    </div>
  );
}
