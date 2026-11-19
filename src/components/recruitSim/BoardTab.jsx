// src/components/recruitSim/BoardTab.jsx
//
// The recruiting board — the game's main screen (user, 2026-11-17):
//   left   position tracker (on board / committed — tap a position to show
//          only those players), decision watch (who announces this window),
//          the line (drag to rank;
//          a player dragged up from below lands at the bottom of it — the line
//          never has to be full), the rest of the board (drag to order — for
//          viewing only), commitments elsewhere, "Build your board" (the
//          scouts' feed) and your class (one row each, true vs public)
//   right  your staff (drag onto a recruit or a region — or tap, then tap) and
//          the map heatmap
// Sizes: Spring 10 (no line) · Summer 25, 10 above · Fall 35, 25 above.
// NIL is shown here, edited only in the player view. Dropping asks first.
import { useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDroppable, pointerWithin, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { getPageScale, unzoomTransform, toCssPx } from "../../utils/pageZoom";
import { Section, Logo, Stars, GradeChip, InterestMeter, RecBadge, StageChip, RatingBlock, ConfirmDrop, TraitStack, TrendBadge, dropBtn, htLabel, smallBtn, pillBtn, GOLD, SUB, INK, LINE, ROW, GOOD, BAD } from "./ui";
import StaffPanel from "./StaffPanel";
import USMap, { staffCollide } from "./USMap";
import { YourClass, Rankings } from "./ClassParts";
import { staffGrade, interestView, recommendedBy, stageView, lockedOutView, traitStackView, trendView, decisionView } from "../../utils/recruitSim/view";
import { boardLimits, phaseOf, evaluate } from "../../utils/recruitSim/model";
import { regionOfState } from "../../utils/recruitSim/regions";
import { ROLES } from "../../utils/recruitSim/work";
import { suggestions, positionNeeds } from "../../utils/recruitSim/suggest";
import { money } from "../../utils/recruitSim/data";

// Send a staff member to a recruit (number) or a state's region ("state:XX").
export function useStaffAssign(sim) {
  return (role, target) => {
    const { state, actions } = sim;
    if (typeof target === "string" && target.startsWith("state:")) {
      const region = regionOfState(target.slice(6));
      const cur = state.schools[state.user].staff[ROLES.indexOf(role)];
      return actions.assign(role, { kind: "area", region, pos: cur?.kind === "area" ? cur.pos : "ALL" });
    }
    if (typeof target === "number") return actions.assign(role, { kind: "recruit", r: target });
    return false;
  };
}
// Staff drags land on exactly what's under the pointer; player drags snap.
const collide = (args) => {
  if (String(args.active.id).startsWith("staff:")) return staffCollide(args);
  const hits = pointerWithin(args).filter((h) => !String(h.id).startsWith("state:"));
  if (hits.length) return hits.some((h) => typeof h.id === "number") ? hits.filter((h) => typeof h.id === "number") : hits;
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => !String(c.id).startsWith("state:")) });
};

export default function BoardTab({ sim, onOpen, isMobile, brand }) {
  const { state, actions } = sim;
  const u = state.user;
  const usc = state.schools[u];
  const lim = boardLimits(state);
  const phase = phaseOf(state);
  const [armed, setArmed] = useState(null);
  const [metric, setMetric] = useState("scout");
  const [dragging, setDragging] = useState(null);
  const [dropAsk, setDropAsk] = useState(null);
  // Tap a position in the tracker: show only those players (user, 2026-11-18).
  const [posFilter, setPosFilter] = useState(null);
  const shown = (r) => !posFilter || state.recruits[r].pos === posFilter;
  const assignTo = useStaffAssign(sim);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 6 } }));
  const below = usc.board.filter((r) => !usc.above.includes(r));
  const staffOn = useMemo(() => {
    const m = {};
    usc.staff.forEach((a, i) => { if (a?.kind === "recruit") (m[a.r] = m[a.r] || []).push(ROLES[i]); });
    return m;
  }, [usc.staff, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const staffByRegion = useMemo(() => {
    const m = {};
    usc.staff.forEach((a, i) => { if (a?.kind === "area") (m[a.region] = m[a.region] || []).push(ROLES[i]); });
    return m;
  }, [usc.staff, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDragEnd = ({ active, over }) => {
    setDragging(null);
    if (!over) return;
    const id = active.id;
    if (String(id).startsWith("staff:")) { assignTo(String(id).slice(6), over.id); setArmed(null); return; }
    const r = id;
    const inAbove = usc.above.includes(r);
    const toAbove = over.id === "zone:above" || usc.above.includes(over.id);
    const toBelow = over.id === "zone:below" || (usc.board.includes(over.id) && !usc.above.includes(over.id));
    if (!lim.line) {
      // Spring: one list — order it however you like (viewing only).
      if (typeof over.id === "number" && over.id !== r) actions.reorderBoard(arrayMove(usc.board, usc.board.indexOf(r), usc.board.indexOf(over.id)));
      return;
    }
    if (inAbove && toAbove && typeof over.id === "number" && over.id !== r) actions.setLine(arrayMove(usc.above, usc.above.indexOf(r), usc.above.indexOf(over.id)));
    else if (!inAbove && toAbove) actions.place(r, usc.above.length); // up from below: bottom of the line
    else if (inAbove && toBelow) actions.place(r, null);
    else if (!inAbove && toBelow && typeof over.id === "number" && over.id !== r) actions.reorderBoard(arrayMove(usc.board, usc.board.indexOf(r), usc.board.indexOf(over.id)));
  };
  // Fill open line spots from below, in your staff's order (grade + interest).
  const fillLine = () => {
    const score = (r) => evaluate(state, u, r).est + (interestView(state, r).lvl || 0) * 0.8;
    actions.setLine([...usc.above, ...below.slice().sort((a, b) => score(b) - score(a))].slice(0, lim.line));
  };
  // Tap-to-assign: an armed staff chip + a tap on a row / state.
  const tapRow = (r) => { if (armed) { assignTo(armed, r); setArmed(null); } else onOpen(r); };
  const tapState = (st) => { if (armed) { assignTo(armed, `state:${st}`); setArmed(null); } };

  const rowProps = { state, sim, onOpen: tapRow, onDrop: setDropAsk, brand, isMobile, staffOn, armed };
  const side = (
    <div className="rs-scroll" style={isMobile ? {} : { position: "sticky", top: "calc(var(--rs-head, 230px) + 8px)", maxHeight: "calc(100vh / var(--pz, 1) - var(--rs-head, 230px) - 16px)", overflowY: "auto" }}>
      <Section title="Staff">
        <div style={{ padding: 10 }}><StaffPanel sim={sim} armed={armed} setArmed={setArmed} onOpen={onOpen} compact /></div>
      </Section>
      <Section title="Map">
        <div style={{ padding: 10 }}><USMap state={state} ver={sim.ver} metric={metric} setMetric={setMetric} armed={armed} onPick={tapState} staffByRegion={staffByRegion} compact={isMobile} labelScale={1.7} /></div>
      </Section>
    </div>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={collide} onDragStart={({ active }) => setDragging(active.id)} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 360px", gap: 12, alignItems: "start" }}>
        <div>
          {isMobile && side}
          {phase !== "winter" && <PositionTracker sim={sim} pos={posFilter} setPos={setPosFilter} />}
          {phase !== "winter" && phase !== "done" && <DecisionWatch sim={sim} onOpen={onOpen} brand={brand} shown={shown} />}
          {phase === "winter" ? (
            <Section title="Recruiting board">
              <div style={{ padding: 18, color: SUB, fontWeight: 700, lineHeight: 1.5 }}>The board opens in <b style={{ color: INK }}>Spring</b> with 10 spots. This winter, drag your staff onto the map: scouts sweep a region for grades, coaches start relationships and may come back raving about someone.</div>
            </Section>
          ) : phase !== "done" && (
            <>
              {lim.line > 0 && (
                <Zone id="zone:above" title={`Above the line · ${usc.above.length}/${lim.line}`}
                  right={usc.above.length < Math.min(lim.line, usc.board.length) ? <button type="button" style={smallBtn("gold")} onClick={fillLine}>Fill the line</button> : null}
                  note={`Ranked — higher means more interest every window. Only these players can commit to you, and only they get NIL offers. Drag to re-rank; someone dragged up from below joins at the bottom. You don't have to fill it.`}>
                  <SortableContext items={usc.above} strategy={verticalListSortingStrategy}>
                    {usc.above.map((r, k) => (shown(r) ? <Row key={r} r={r} k={k} {...rowProps} /> : null))}
                  </SortableContext>
                  {!usc.above.length && <Empty>Drag recruits up here from below.</Empty>}
                  {usc.above.length > 0 && posFilter && !usc.above.some(shown) && <Empty>No {posFilter}s above the line.</Empty>}
                </Zone>
              )}
              <Zone id="zone:below" title={lim.line ? `Below the line · ${below.length}` : `Board · ${usc.board.length}/${lim.size}`}
                note={lim.line ? "Still recruiting and scouting them — but they can't commit to you from here. Drag to order them (just for viewing)." : "Every spring spot is equal: each builds interest and scouts him every window (more the closer he is to campus). Drag to order. The line opens in Summer."}>
                <SortableContext items={lim.line ? below : usc.board} strategy={verticalListSortingStrategy}>
                  {(lim.line ? below : usc.board).filter(shown).map((r) => <Row key={r} r={r} k={-1} {...rowProps} />)}
                </SortableContext>
                {posFilter && (lim.line ? below : usc.board).length > 0 && !(lim.line ? below : usc.board).some(shown) && <Empty>No {posFilter}s here.</Empty>}
                {!(lim.line ? below : usc.board).length && <Empty>Nobody here yet — your scouts' picks are below, or use the Recruits tab.</Empty>}
                <div style={{ padding: "8px 14px", fontSize: 12, color: SUB, fontWeight: 800, borderTop: `1px solid ${LINE}` }}>{lim.size - usc.board.length} open spot{lim.size - usc.board.length === 1 ? "" : "s"} of {lim.size}</div>
              </Zone>
              <LockedOut sim={sim} onOpen={onOpen} brand={brand} />
              <BuildBoard sim={sim} onOpen={onOpen} isMobile={isMobile} pos={posFilter} setPos={setPosFilter} />
            </>
          )}
          <YourClass sim={sim} onOpen={onOpen} isMobile={isMobile} />
          <Rankings sim={sim} brand={brand} />
        </div>
        {!isMobile && side}
      </div>
      <DragOverlay dropAnimation={null} style={{ zoom: 1 / getPageScale() }}>
        {dragging != null ? (String(dragging).startsWith("staff:")
          ? <span style={{ display: "inline-block", background: GOLD, color: "#111", fontWeight: 900, borderRadius: 8, padding: "7px 10px", boxShadow: "0 8px 20px rgba(0,0,0,0.5)" }}>{String(dragging).slice(6)}</span>
          : <span style={{ display: "inline-block", background: "#16213a", border: `1px solid ${GOLD}`, color: INK, fontWeight: 900, borderRadius: 8, padding: "8px 12px", boxShadow: "0 8px 20px rgba(0,0,0,0.5)" }}>{state.recruits[dragging].first} {state.recruits[dragging].last}</span>) : null}
      </DragOverlay>
      {dropAsk != null && <ConfirmDrop x={state.recruits[dropAsk]} onCancel={() => setDropAsk(null)} onConfirm={() => { actions.remove(dropAsk); setDropAsk(null); }} />}
    </DndContext>
  );
}

function Zone({ id, title, note, right, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef}>
      <Section title={title} right={right} style={{ border: `1px solid ${isOver ? GOLD : LINE}` }}>
        <div style={{ padding: "7px 14px", fontSize: 12, color: SUB, fontWeight: 700, borderBottom: `1px solid ${LINE}` }}>{note}</div>
        {children}
      </Section>
    </div>
  );
}
const Empty = ({ children }) => <div style={{ padding: 16, color: SUB, fontWeight: 700, fontSize: 13 }}>{children}</div>;

function Row({ state, sim, r, k, onOpen, onDrop, brand, isMobile, staffOn, armed }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: r });
  const x = state.recruits[r];
  const usc = state.schools[state.user];
  const stacks = traitStackView(state, r);
  const sg = staffGrade(state, r);
  const iv = interestView(state, r);
  const tv = trendView(state, r);
  const offer = usc.nil[r] || 0;
  const above = k >= 0;
  const demand = x.demand && x.demand.s === state.user;
  return (
    <div ref={setNodeRef} style={{ transform: DndCSS.Transform.toString(unzoomTransform(transform)), transition, opacity: isDragging ? 0.35 : 1 }}>
      <div className="rs-row" {...(isMobile ? {} : { ...attributes, ...listeners })} onClick={() => onOpen(r)} style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, padding: isMobile ? "8px 10px" : "7px 12px", borderBottom: `1px solid ${LINE}`, cursor: armed ? "copy" : "pointer",
        background: isOver && armed ? "rgba(246,162,29,0.18)" : demand ? "rgba(246,162,29,0.07)" : ROW, outline: isOver ? `1px solid ${GOLD}` : "none", flexWrap: isMobile ? "wrap" : "nowrap" }}>
        <span {...(isMobile ? { ...attributes, ...listeners } : {})} onClick={(e) => e.stopPropagation()} title="Drag to move" style={{ cursor: "grab", touchAction: isMobile ? "none" : "auto", width: 26, textAlign: "center", fontWeight: 900, fontSize: above ? 16 : 13, color: above ? GOLD : SUB, userSelect: "none" }}>{above ? k + 1 : "⋮⋮"}</span>
        <RatingBlock x={x} size={17} />
        <div style={{ flex: 1, minWidth: isMobile ? 150 : 170 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 900, fontSize: 14 }}>{x.first} {x.last}</span>
            <span style={{ fontSize: 11, fontWeight: 900, color: GOLD }}>{x.pos}</span>
            <RecBadge roles={recommendedBy(state, r)} />
            {demand && <span style={{ fontSize: 10, fontWeight: 900, color: "#111", background: GOLD, borderRadius: 4, padding: "1px 5px" }}>REQUEST</span>}
          </div>
          <div style={{ fontSize: 11, color: SUB, fontWeight: 700, marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Stars n={x.stars} size={10} /><span>{x.hs} ({x.st})</span><span>{htLabel(x.ht)} {x.wt}</span>
            {(staffOn[r] || []).map((role) => <span key={role} style={{ fontSize: 9, fontWeight: 900, color: "#fff", background: ["HC", "OC", "DC"].includes(role) ? "#0055a5" : "#5b3fb0", borderRadius: 4, padding: "0 4px" }}>{role}</span>)}
          </div>
        </div>
        <TraitStack stacks={stacks} width={isMobile ? 58 : 62} />
        {tv && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: 40 }} title={`Senior season: ${tv.label}`}>
            <span style={{ fontSize: 8.5, fontWeight: 900, color: SUB, letterSpacing: "0.08em" }}>SEASON</span>
            <span style={{ height: 22, display: "flex", alignItems: "center" }}><TrendBadge tv={tv} /></span>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }} title="Staff grade — your staff's overall read">
          <span style={{ fontSize: 8.5, fontWeight: 900, color: SUB, letterSpacing: "0.08em" }}>STAFF</span>
          {sg ? <GradeChip label={sg.label} state={sg.sure ? "exact" : "range"} size="sm" title="Staff grade" /> : <GradeChip state="unknown" size="sm" title="Staff grade — scout more" />}
        </div>
        <div style={{ width: isMobile ? "auto" : 128 }}><InterestMeter v={iv} /></div>
        <div style={{ width: isMobile ? "auto" : 70 }}><StageChip sv={stageView(state, r)} brand={brand} state={state} /></div>
        {above && <div style={{ width: 64, textAlign: "right", fontSize: 12, fontWeight: 900, color: offer ? INK : BAD }} title="NIL offer — change it in his player view">{offer ? money(offer) : "No NIL"}</div>}
        <button type="button" style={dropBtn} onClick={(e) => { e.stopPropagation(); onDrop(r); }}>Drop</button>
      </div>
    </div>
  );
}

// Players who just dropped you (shown the window after).
function LockedOut({ sim, onOpen, brand }) {
  const { state } = sim;
  const list = lockedOutView(state);
  if (!list.length) return null;
  return (
    <Section title={`Gone since last window · ${list.length}`}>
      {list.map((o) => {
        const x = state.recruits[o.r];
        return (
          <div key={o.r} className="rs-row rs-link" onClick={() => onOpen(o.r)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 14px", borderBottom: `1px solid ${LINE}`, background: ROW, opacity: 0.85 }}>
            <RatingBlock x={x} size={14} />
            <span style={{ flex: 1, fontWeight: 900, fontSize: 13 }}>{x.first} {x.last} <span style={{ color: GOLD, fontSize: 11 }}>{x.pos}</span></span>
            {o.stage === "commit"
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: BAD, flexWrap: "wrap" }}>Committed to <Logo b={brand(state.schools[o.to].slug)} size={20} />{state.schools[o.to].name}{o.jump ? <span style={{ fontSize: 10, fontWeight: 900, color: "#111", background: GOLD, borderRadius: 4, padding: "1px 5px" }}>{o.jump.over === state.user ? "JUMPED YOU" : `UPSET FROM NO. ${o.jump.place || "?"}`}</span> : null}</span>
              : <span style={{ fontSize: 12, fontWeight: 800, color: BAD }}>No longer considering you — left you off his {o.stage === "final" ? "final list" : "top 10"}</span>}
          </div>
        );
      })}
    </Section>
  );
}

// Where your board and class stand at each position (user, 2026-11-17).
// Tap one to show only those players on the board (user, 2026-11-18).
function PositionTracker({ sim, pos, setPos }) {
  const { state } = sim;
  const needs = useMemo(() => positionNeeds(state), [state, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const usc = state.schools[state.user];
  const above = useMemo(() => { const m = {}; usc.above.forEach((r) => { const p = state.recruits[r].pos; m[p] = (m[p] || 0) + 1; }); return m; }, [usc.above, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(9, minmax(0, 1fr))", gap: 4 }}>
        {needs.map((n) => {
          const short = n.commits + n.board < n.want;
          const on = pos === n.pos;
          return (
            <button key={n.pos} type="button" onClick={() => setPos(on ? null : n.pos)} title={`${n.pos}: ${n.board} on your board${above[n.pos] ? ` (${above[n.pos]} above the line)` : ""} · ${n.commits} committed · plan ${n.want}${on ? " — tap to show everyone" : " — tap to show only " + n.pos + "s"}`}
              style={{ background: on ? "rgba(246,162,29,0.16)" : ROW, border: `1px solid ${on ? GOLD : short ? "rgba(246,162,29,0.55)" : LINE}`, borderRadius: 10, padding: "5px 2px", textAlign: "center", minWidth: 0, cursor: "pointer", color: INK, fontFamily: "inherit", opacity: pos && !on ? 0.55 : 1 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: GOLD }}>{n.pos}</div>
              <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.1 }}>{n.board}</div>
              <div style={{ fontSize: 9, fontWeight: 800, color: SUB, whiteSpace: "nowrap", overflow: "hidden" }}>on board</div>
              <div style={{ fontSize: 12, fontWeight: 900, color: n.commits >= n.want ? GOOD : n.commits ? INK : SUB, marginTop: 2 }}>{n.commits}<span style={{ color: SUB, fontSize: 10 }}>/{n.want}</span></div>
              <div style={{ fontSize: 9, fontWeight: 800, color: SUB, whiteSpace: "nowrap", overflow: "hidden" }}>committed</div>
            </button>
          );
        })}
      </div>
      {pos && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12, fontWeight: 800, color: GOLD }}>
          Showing {pos}s only
          <button type="button" style={smallBtn()} onClick={() => setPos(null)}>Show everyone</button>
        </div>
      )}
    </div>
  );
}

// Decision watch: players on your board (or with you on their list) who
// announce at the end of this window — your last chance to push.
function DecisionWatch({ sim, onOpen, brand, shown }) {
  const { state } = sim;
  const u = state.user;
  const usc = state.schools[u];
  const list = usc.board.filter(shown).map((r) => [r, decisionView(state, r)]).filter(([, d]) => d);
  if (!list.length) return null;
  list.sort((a, b) => b[1].inIt - a[1].inIt);
  return (
    <Section title={`📅 Decision watch · ${list.length} announcing this week`} style={{ border: `1px solid ${GOLD}` }}>
      <div style={{ padding: "6px 14px", fontSize: 12, color: SUB, fontWeight: 700, borderBottom: `1px solid ${LINE}` }}>They pick at the end of this window. Put a coach on him, raise the NIL, move him up the line — this is the week.</div>
      {list.map(([r, d]) => {
        const x = state.recruits[r];
        const me = d.field.find((f) => f.s === u);
        const lead = d.pick === u;
        return (
          <div key={r} className="rs-row" onClick={() => onOpen(r)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${LINE}`, background: d.inIt ? "rgba(246,162,29,0.07)" : ROW, cursor: "pointer", flexWrap: "wrap" }}>
            <RatingBlock x={x} size={15} />
            <div style={{ flex: 1, minWidth: 150 }}>
              <div style={{ fontWeight: 900, fontSize: 13 }}>{x.first} {x.last} <span style={{ color: GOLD, fontSize: 11 }}>{x.pos}</span></div>
              <div style={{ fontSize: 11, fontWeight: 800, color: !d.inIt ? BAD : lead ? GOOD : GOLD }}>
                {!d.inIt ? "You're not a finalist" : lead ? (d.conf === "Confident" ? "Staff: we're in great shape" : d.conf === "Leaning" ? "Staff: leaning our way — don't let up" : "Staff: coin flip — push now") : me ? `Staff: we're behind (${me.pct}% of the leader) — make a push` : "Staff: long shot"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {d.field.map((f) => (
                <span key={f.s} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: f.s === d.pick ? 1 : 0.75 }}>
                  <Logo b={brand(state.schools[f.s].slug)} size={22} />
                  <span style={{ width: 34, height: 4, borderRadius: 2, background: "#1b2538", overflow: "hidden" }}><span style={{ display: "block", width: `${Math.max(6, f.pct)}%`, height: "100%", background: f.s === u ? GOLD : "#6aa6ff" }} /></span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

// Build your board — advice from your staff (user, 2026-11-18: "it should
// feel like you're getting advice from scouts"). Each pick is one staffer
// telling you why, in his words; refreshed every window. Follows the
// tracker's position filter.
const ROLE_NAME = { HS: "Head Scout", OS: "Offensive Scout", DS: "Defensive Scout", HC: "Head Coach", OC: "Off. Coordinator", DC: "Def. Coordinator" };
const KIND_COLOR = { coach: GOLD, ceiling: GOOD, riser: GOOD, gem: "#6aa6ff", leaning: GOOD, alone: "#c08cff", need: "#e0a24a", local: "#33b6a8", reach: BAD, fit: SUB };
function BuildBoard({ sim, onOpen, isMobile, pos, setPos }) {
  const { state, actions } = sim;
  const box = useRef(null);
  // Adding someone grows the board above this list — keep this list where it
  // is on screen so the page doesn't jump (user, 2026-11-18).
  const addHere = (r) => {
    const el = box.current;
    const before = el ? el.getBoundingClientRect().top : 0;
    actions.add(r);
    requestAnimationFrame(() => {
      if (!el) return;
      const d = el.getBoundingClientRect().top - before;
      if (!d) return;
      let sc = el.parentElement;
      while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      if (sc && sc !== document.body) sc.scrollTop += d; else window.scrollBy(0, toCssPx(d));
    });
  };
  const usc = state.schools[state.user];
  const lim = boardLimits(state);
  const [open, setOpen] = useState(true);
  const [more, setMore] = useState(false);
  const needs = useMemo(() => positionNeeds(state), [state, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => (open ? suggestions(state, { limit: 16, pos }) : []), [state, sim.ver, pos, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const room = lim.size - usc.board.length;
  const fresh = list.filter((g) => g.fresh).length;
  const fill = () => { suggestions(state, { limit: room }).forEach((g) => actions.add(g.r)); };
  const shown = more ? list : list.slice(0, 8);
  return (
    <div ref={box}><Section title={`Your staff's picks${fresh ? ` · ${fresh} new this week` : ""}`} right={<span style={{ display: "flex", gap: 6 }}>{room > 0 && list.length > 0 && <button type="button" style={smallBtn("gold")} onClick={fill}>Take the top {room}</button>}<button type="button" style={smallBtn()} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button></span>}>
      {open && (
        <>
          <div style={{ padding: "8px 14px", display: "flex", gap: 5, flexWrap: "wrap", borderBottom: `1px solid ${LINE}`, alignItems: "center" }}>
            <button type="button" style={{ ...pillBtn(!pos), padding: "4px 9px", fontSize: 11 }} onClick={() => setPos(null)}>All</button>
            {needs.map((n) => (
              <button key={n.pos} type="button" onClick={() => setPos(pos === n.pos ? null : n.pos)} title={`Plan ${n.want} · ${n.commits} committed · ${n.board} on board`}
                style={{ ...pillBtn(pos === n.pos), padding: "4px 9px", fontSize: 11, borderColor: pos === n.pos ? undefined : n.open > n.board ? GOLD : LINE }}>{n.pos}</button>
            ))}
            <span style={{ fontSize: 11, color: SUB, fontWeight: 700, marginLeft: "auto" }}>From what they saw on the trail · only kids your staff has eyes on</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 8, padding: 10 }}>
            {shown.map((g) => {
              const x = state.recruits[g.r];
              const kc = KIND_COLOR[g.kind] || SUB;
              const coach = ["HC", "OC", "DC"].includes(g.voice);
              return (
                <div key={g.r} className="rs-row" onClick={() => onOpen(g.r)} style={{ background: ROW, border: `1px solid ${LINE}`, borderLeft: `3px solid ${kc}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 900, color: "#fff", background: coach ? "#0055a5" : "#5b3fb0", borderRadius: 4, padding: "1px 5px" }}>{g.voice}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{ROLE_NAME[g.voice]}</span>
                    <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 900, color: "#0b1322", background: kc, borderRadius: 4, padding: "1px 6px", letterSpacing: "0.05em", textTransform: "uppercase" }}>{g.head}</span>
                    {g.fresh && <span style={{ fontSize: 9.5, fontWeight: 900, color: "#6aa6ff" }}>NEW</span>}
                  </div>
                  <div style={{ fontSize: 13, fontStyle: "italic", lineHeight: 1.4, color: INK }}>“{g.quote}”</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <RatingBlock x={x} size={14} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><span style={{ fontWeight: 900, fontSize: 13 }}>{x.first} {x.last}</span> <span style={{ color: GOLD, fontSize: 11, fontWeight: 900 }}>{x.pos}</span> <Stars n={x.stars} size={9} /></div>
                      <div style={{ fontSize: 10.5, color: SUB, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.city}, {x.st} · confidence {g.confidence.toLowerCase()}</div>
                    </div>
                    <button type="button" style={smallBtn("gold")} disabled={room <= 0} onClick={(e) => { e.stopPropagation(); addHere(g.r); }}>{room > 0 ? "+ Board" : "Full"}</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignContent: "flex-end" }}>
                      {g.facts.map((f) => <span key={f} style={{ fontSize: 10, fontWeight: 800, color: SUB, border: `1px solid ${LINE}`, borderRadius: 999, padding: "1px 7px" }}>{f}</span>)}
                    </div>
                    <TraitStack stacks={traitStackView(state, g.r)} width={52} />
                  </div>
                </div>
              );
            })}
          </div>
          {list.length > 8 && <div style={{ padding: "0 10px 10px" }}><button type="button" style={smallBtn()} onClick={() => setMore(!more)}>{more ? "Fewer" : `${list.length - 8} more picks`}</button></div>}
          {!list.length && <Empty>No picks{pos ? ` at ${pos}` : ""} yet — send your scouts across the country.</Empty>}
        </>
      )}
      {sim.error && <div style={{ padding: "6px 14px", color: BAD, fontWeight: 800, fontSize: 12 }}>{sim.error}</div>}
    </Section></div>
  );
}
