// src/components/recruitSim/RecruitProfile.jsx
//
// The player view (spec §26; reworked 2026-11-17) — the one place to manage a
// recruit and to SEE how his recruitment is going:
//   • where it stands: Open → Top 10 → Final → Committed
//   • interest bars: you vs the schools you're up against, plus your trend
//   • what he's weighing: how your program rates on each factor, his
//     priorities flagged once your staff learns them
//   • NIL: the only place offers are edited — starts at what he's hoping for;
//     free to change until the window closes (a LOWER number at close costs)
//   • staff: one tap sends a staff member to him
//   • Drop at the bottom (asks first). No rank-down / below-the-line here.
// Scouting shows only what you've uncovered — all of it once he commits to you.
import { useMemo, useState } from "react";
import { Modal, Logo, Stars, GradeChip, InterestMeter, Progress, RecBadge, RatingBlock, ConfirmDrop, Reveal, TrendBadge, dropBtn, htLabel, smallBtn, GOLD, SUB, INK, LINE, ROW, GOOD, BAD, BLUE } from "./ui";
import { traitView, categoryView, potentialView, staffGrade, scoutProgress, interestView, competitionView, stageView, STAGE_STEPS, factorView, recommendedBy, askHint, ceilingView, nilDefault, marketNil, revealView, trendView, bondView, decisionView } from "../../utils/recruitSim/view";
import { CAT_LABEL, CATS } from "../../utils/recruitSim/traits";
import { REGION_LABEL } from "../../utils/recruitSim/regions";
import { ROLES, ROLE_LABEL, covers, COACHES } from "../../utils/recruitSim/work";
import { boardLimits, phaseOf } from "../../utils/recruitSim/model";
import { nilAvailable } from "../../utils/recruitSim/actions";
import { historyOf } from "../../utils/recruitSim/events";
import { STAGES } from "../../utils/recruitSim/config";
import { money } from "../../utils/recruitSim/data";

const HISTORY_TEXT = {
  coachVisit: (e) => `${e.d.role} met him on a ${REGION_LABEL[e.d.region]} trip`,
  coachRecruit: (e) => `${e.d.role} recruited him directly`,
  recommend: (e) => `Recommended by the ${e.d.role}`,
  boardAdd: () => "Added to your board",
  boardRemove: () => "Dropped from your board",
  lineUp: (e) => `Moved above the line (No. ${e.d.rank})`,
  lineDown: () => "Moved below the line",
  nilOffer: (e) => (e.d.to > e.d.from ? `NIL offer ${e.d.from ? "raised" : "made"}: ${money(e.d.to)}` : e.d.to ? `NIL offer lowered to ${money(e.d.to)}` : "NIL offer withdrawn"),
  nilCut: () => "Noticed your smaller offer",
  demand: (e) => (e.d.type === "nil" ? `Said he'd commit for ${money(e.d.amount)}` : "Asked you to clear a teammate off your board"),
  demandMet: () => "You met his request",
  demandLapsed: () => "His request went unanswered",
  top10: (e, st) => `Top ${e.d.list.length} announced${e.d.list.includes(st.user) ? " — you're on it" : " — you're not on it"}`,
  final: (e, st) => `Final ${e.d.list.length}${e.d.list.includes(st.user) ? " — you made it" : " — you were cut"}`,
  commit: (e, st) => `Committed to ${st.schools[e.d.to].name}`,
  lostTo: (e, st) => `Committed to ${st.schools[e.d.to].name}`,
  dropped: (e) => `No longer considering you (left off his ${e.d.stage === "final" ? "final list" : "top 10"})`,
  reopen: () => "Reopened his recruitment",
  announce: (e, st) => `Set his decision date — ${e.d.list.map((s) => (s === st.user ? "you" : st.schools[s].name)).join(", ")}`,
  delay: () => "Pushed back his decision",
  unsigned: () => "Didn't sign",
};

export default function RecruitProfile({ sim, r, brand, onClose, onOpen, isMobile }) {
  const { state, actions } = sim;
  const x = state.recruits[r];
  const u = state.user;
  const usc = state.schools[u];
  const lim = boardLimits(state);
  const traits = traitView(state, r);
  const cats = categoryView(state, r, traits);
  const pot = potentialView(state, r);
  const sg = staffGrade(state, r);
  const recs = recommendedBy(state, r);
  const onBoard = usc.board.includes(r);
  const committedHere = x.commit === u;
  const b = x.commit >= 0 ? brand(state.schools[x.commit].slug) : null;
  const [dropAsk, setDropAsk] = useState(false);
  const history = useMemo(() => historyOf(state, r).slice().reverse(), [state, r, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const headBg = b ? `linear-gradient(115deg, ${b.Color1 || BLUE}, #0e1626)` : "linear-gradient(115deg, #13254a, #0e1626)";

  return (
    <Modal onClose={onClose} width={960}>
      <div style={{ position: "relative", padding: isMobile ? "16px 14px" : "20px 24px", background: headBg, borderBottom: `1px solid ${LINE}` }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 10, right: 12, background: "rgba(0,0,0,0.35)", border: "none", color: INK, borderRadius: 999, width: 30, height: 30, fontSize: 16, cursor: "pointer" }}>✕</button>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "8px 10px" }}><RatingBlock x={x} size={30} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", color: GOLD }}>{x.pos} · {x.pos} No. {x.posRank}</div>
            <div style={{ fontSize: isMobile ? 24 : 32, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, marginTop: 2 }}>{x.first} {x.last}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
              <Stars n={x.stars} size={15} />
              <RecBadge roles={recs} />
            </div>
          </div>
          {b && <div style={{ textAlign: "center", marginRight: 30 }}><Logo onColor b={b} size={56} /><div style={{ fontSize: 11, fontWeight: 900, marginTop: 2 }}>{committedHere ? "COMMITTED TO YOU" : "COMMITTED"}</div></div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8, marginTop: 14 }}>
          {[["High School", x.hs], ["Hometown", `${x.city}, ${x.st}`], ["Height / Weight", `${htLabel(x.ht)} · ${x.wt}`], ["Region", REGION_LABEL[x.region]]].map(([k, v]) => (
            <div key={k} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "7px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 900, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.1fr" }}>
        {/* Scouting */}
        <div style={{ padding: isMobile ? 14 : 20, borderRight: isMobile ? "none" : `1px solid ${LINE}` }}>
          <Heading right={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: SUB, fontWeight: 800 }}><Progress p={scoutProgress(state, r)} /> scouted</span>}>Scouting</Heading>
          {committedHere && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${GOOD}`, background: "rgba(95,211,154,0.07)" }}>
              <span style={{ flex: 1, minWidth: 140, fontSize: 12, color: GOOD, fontWeight: 800 }}>He's yours — full profile unlocked. Website {x.rating.toFixed(1)} vs the truth:</span>
              <Reveal rv={revealView(state, r)} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {CATS.map((c) => (
              <div key={c} style={{ flex: 1, minWidth: 80, background: ROW, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>{CAT_LABEL[c]}</div>
                <div style={{ marginTop: 4 }}><GradeChip label={cats[c].label} state={cats[c].state} /></div>
              </div>
            ))}
            <div style={{ flex: 1, minWidth: 80, background: ROW, borderRadius: 10, padding: "8px 10px", textAlign: "center", border: pot ? `1px solid ${GOLD}` : "1px solid transparent" }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>Potential</div>
              <div style={{ marginTop: 4 }}>{pot ? <GradeChip label={pot} /> : <GradeChip state="unknown" title="Potential is the hardest thing to uncover — about 1 look in 500" />}</div>
            </div>
          </div>
          <Ceiling sim={sim} r={r} cats={cats} />
          {CATS.map((c) => (
            <div key={c} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase", marginBottom: 4 }}>{CAT_LABEL[c]}</div>
              {traits.filter((t) => t.cat === c).map((t) => (
                <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 8, background: ROW, marginBottom: 3 }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 800 }}>{t.name}</span>
                  <GradeChip label={t.label} state={t.state} size="sm" />
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "8px 10px", border: `1px solid ${LINE}`, borderRadius: 10 }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 900 }}>Staff grade<div style={{ fontSize: 11, color: SUB, fontWeight: 700 }}>Your staff's evaluation from what you've uncovered</div></span>
            {sg ? <GradeChip label={sg.label} state={sg.sure ? "exact" : "range"} title={sg.sure ? "Fully scouted" : "Estimate — more scouting will sharpen it"} /> : <GradeChip state="unknown" title="Scout at least half his traits" />}
          </div>
        </div>

        {/* Recruiting */}
        <div style={{ padding: isMobile ? 14 : 20 }}>
          <Heading>Recruitment</Heading>
          <Demand sim={sim} r={r} />
          <Decision sim={sim} r={r} brand={brand} />
          <StageTrack sim={sim} r={r} brand={brand} />
          <Season sim={sim} r={r} />
          {x.commit < 0 && x.status !== "unsigned" && (
            <>
              <HowItsGoing sim={sim} r={r} brand={brand} />
              <Weighing sim={sim} r={r} />
              <BoardSpot sim={sim} r={r} lim={lim} />
              <NilEditor key={`${r}-${usc.nil[r] || 0}`} sim={sim} r={r} />
              <StaffOn sim={sim} r={r} />
            </>
          )}
          {sim.error && <div style={{ color: BAD, fontSize: 12, fontWeight: 800, margin: "6px 0" }}>{sim.error}</div>}
          <Sub>History</Sub>
          <div className="rs-scroll" style={{ maxHeight: 170, overflowY: "auto" }}>
            {history.length ? history.slice(0, 40).map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${LINE}` }}>
                <span style={{ color: SUB, fontWeight: 800, minWidth: 82 }}>{STAGES[e.st]?.label}</span>
                <span style={{ fontWeight: 700, color: e.k === "commit" && e.d?.to === u ? GOOD : INK }}>{(HISTORY_TEXT[e.k] || (() => e.k))(e, state)}</span>
              </div>
            )) : <div style={{ fontSize: 12, color: SUB }}>Nothing yet.</div>}
          </div>
          {onBoard && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
              <button type="button" style={dropBtn} onClick={() => setDropAsk(true)}>Drop from board</button>
            </div>
          )}
        </div>
      </div>
      {dropAsk && <ConfirmDrop x={x} onCancel={() => setDropAsk(false)} onConfirm={() => { actions.remove(r); setDropAsk(false); }} />}
    </Modal>
  );
}

function Heading({ children, right }) {
  return <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}><div style={{ flex: 1, fontSize: 13, fontWeight: 900, letterSpacing: "0.14em", color: GOLD, textTransform: "uppercase" }}>{children}</div>{right}</div>;
}
const Sub = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "center", margin: "14px 0 6px" }}>
    <span style={{ flex: 1, fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>{children}</span>{right}
  </div>
);

// His request — NIL ultimatums commit him the moment you meet them.
function Demand({ sim, r }) {
  const { state, actions } = sim;
  const x = state.recruits[r];
  const d = x.demand && x.demand.s === state.user ? x.demand : null;
  if (!d || x.commit >= 0) return null;
  const rival = d.type === "pt" ? state.recruits[d.target] : null;
  return (
    <div style={{ border: `2px solid ${GOLD}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12, background: "rgba(246,162,29,0.08)" }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: GOLD }}>HIS REQUEST · ANSWER BY THE END OF {STAGES[d.until - 1]?.label?.toUpperCase()}</div>
      <div style={{ fontSize: 14, fontWeight: 800, margin: "4px 0 8px" }}>
        {d.type === "nil" ? `"Get me to ${money(d.amount)} and I'll commit right now."` : `"I want a clear path at ${x.pos}. Take ${rival.first} ${rival.last} off your board."`}
      </div>
      {d.type === "nil"
        ? <button type="button" style={smallBtn("gold")} onClick={() => actions.offer(r, d.amount)}>Offer {money(d.amount)} — he commits</button>
        : <button type="button" style={smallBtn("gold")} onClick={() => actions.remove(d.target)}>Drop {rival.last}</button>}
      {d.type === "nil" && <span style={{ fontSize: 11, color: SUB, fontWeight: 700, marginLeft: 8 }}>{money(nilAvailable(state.schools[state.user]) + (state.schools[state.user].nil[r] || 0))} available for him</span>}
    </div>
  );
}

// Open → Top 10 → Final → Committed.
function StageTrack({ sim, r, brand }) {
  const { state } = sim;
  const sv = stageView(state, r);
  const x = state.recruits[r];
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {STAGE_STEPS.map((label, i) => (
          <div key={label} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: 6, borderRadius: 3, background: i < sv.step ? "rgba(255,255,255,0.55)" : i === sv.step ? GOLD : "#1b2538" }} />
            <div style={{ fontSize: 10, fontWeight: 900, marginTop: 3, color: i === sv.step ? INK : SUB }}>{i === sv.step ? sv.label : label}</div>
          </div>
        ))}
      </div>
      {x.commit >= 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, fontWeight: 900, color: x.commit === state.user ? GOOD : INK }}>
          <Logo b={brand(state.schools[x.commit].slug)} size={22} /> Committed to {state.schools[x.commit].name} · {STAGES[x.commitStage]?.label}
        </div>
      ) : sv.step > 0 ? (
        <div style={{ fontSize: 12, fontWeight: 800, marginTop: 6, color: sv.inIt ? GOOD : BAD }}>{sv.inIt ? `You're on his ${sv.step === 2 ? "final list" : "list"}.` : "You're not on his list — he's no longer considering you."}</div>
      ) : null}
    </div>
  );
}

// Interest bars: you vs the competition, and your trend line.
function HowItsGoing({ sim, r, brand }) {
  const { state } = sim;
  const iv = interestView(state, r);
  const comp = competitionView(state, r);
  const t = state.trend?.[r] || [];
  return (
    <>
      <Sub right={<InterestMeter v={iv} />}>How it's going</Sub>
      {/* Logos only; 💪 = pushing hard (a coach on him, or top 5 on their line); their NIL offer if any. */}
      {comp.length ? comp.map((c) => (
        <div key={c.s} title={`${state.schools[c.s].name}${c.push ? " — pushing hard" : ""}${c.nil ? ` · NIL offer ${money(c.nil)}` : ""}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, padding: c.you ? "2px 4px" : "2px 4px", borderRadius: 8, background: c.you ? "rgba(246,162,29,0.1)" : "transparent" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, width: 46, flexShrink: 0 }}>
            <Logo b={brand(state.schools[c.s].slug)} size={24} />
            {c.push ? <span style={{ fontSize: 15, lineHeight: 1 }} aria-label="Pushing hard">💪</span> : null}
          </span>
          <div style={{ flex: 1, height: 10, borderRadius: 5, background: "#1b2538", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(3, Math.min(100, c.pct))}%`, height: "100%", background: c.you ? GOLD : c.place === 1 ? "#6aa6ff" : "#46597d" }} />
          </div>
          <span style={{ width: 66, fontSize: 11, fontWeight: 900, color: c.nil ? INK : "#5d6a84", textAlign: "right", whiteSpace: "nowrap" }}>{c.nil ? money(c.nil) : c.above ? "No NIL" : c.onBoard ? "Below line" : "—"}</span>
          <span style={{ width: 26, fontSize: 11, fontWeight: 900, color: c.you ? GOLD : SUB, textAlign: "right" }}>{c.out ? "out" : c.place ? `#${c.place}` : "—"}</span>
        </div>
      )) : <div style={{ fontSize: 12, color: SUB, fontWeight: 700 }}>Nobody's in on him yet.</div>}
      {comp.length > 0 && !iv.intel && <div style={{ fontSize: 11, color: SUB, fontWeight: 700, marginTop: 2 }}>You haven't made contact yet — put him on your board or send a coach.</div>}
      {t.length >= 2 && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34, marginTop: 8 }} title="Your standing each window (share of his leader)">
          {t.slice(-12).map(([st, place, pct]) => (
            <div key={st} title={`${STAGES[st]?.label}: ${place ? `No. ${place}` : "outside his top 12"}`} style={{ flex: 1, maxWidth: 14, height: `${Math.max(8, pct)}%`, background: place === 1 ? GOOD : "#3c7dd9", borderRadius: 2, opacity: 0.85 }} />
          ))}
          <span style={{ fontSize: 10, color: SUB, fontWeight: 800, marginLeft: 4, alignSelf: "center" }}>trend</span>
        </div>
      )}
    </>
  );
}

// How your program rates on what he weighs.
function Weighing({ sim, r }) {
  const { state } = sim;
  const rows = factorView(state, r);
  const color = { Strong: GOOD, Okay: GOLD, Weak: BAD };
  const concerns = rows.filter((f) => f.priority && f.rating === "Weak");
  return (
    <>
      <Sub>What he's weighing</Sub>
      {rows.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: `1px solid ${LINE}` }}>
          <span style={{ width: 128, fontSize: 12, fontWeight: f.priority ? 900 : 700, color: f.priority ? INK : SUB }}>{f.priority ? "★ " : ""}{f.label}</span>
          <span style={{ width: 52, fontSize: 11, fontWeight: 900, color: color[f.rating] }}>{f.rating}</span>
          <span style={{ flex: 1, fontSize: 11, color: SUB, fontWeight: 700 }}>{f.note}</span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: concerns.length ? BAD : SUB, fontWeight: 800, marginTop: 5 }}>
        {concerns.length ? `Concern: ${concerns.map((f) => f.label.toLowerCase()).join(" and ")} — it's one of his priorities.` : rows.some((f) => f.priority) ? "★ = what matters most to him." : "Spend time with him to learn what matters most to him."}
      </div>
    </>
  );
}

// Board spot: add, or move above the line (no rank-down / below from here).
function BoardSpot({ sim, r, lim }) {
  const { state, actions } = sim;
  const usc = state.schools[state.user];
  const onBoard = usc.board.includes(r);
  const rank = usc.above.indexOf(r) + 1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "8px 10px", background: ROW, borderRadius: 10 }}>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 900 }}>{onBoard ? (rank ? `Above the line · No. ${rank}` : lim.line ? "On your board · below the line" : "On your board") : "Not on your board"}</span>
      {!onBoard && <button type="button" style={smallBtn("gold")} disabled={!lim.size} onClick={() => actions.add(r)}>{lim.size ? `+ Add to board (${usc.board.length}/${lim.size})` : "Board opens in Spring"}</button>}
      {onBoard && lim.line > 0 && !rank && <button type="button" style={smallBtn("blue")} disabled={usc.above.length >= lim.line} title={usc.above.length >= lim.line ? "The line is full" : ""} onClick={() => actions.place(r, usc.above.length)}>Move above the line</button>}
    </div>
  );
}

// NIL — starts at what he's hoping for (else the market for his ranking).
function NilEditor({ sim, r }) {
  const { state, actions } = sim;
  const p = phaseOf(state);
  const usc = state.schools[state.user];
  const offer = usc.nil[r] || 0;
  const above = usc.above.includes(r);
  const hope = askHint(state, r);
  const base = nilDefault(state, r);
  const [val, setVal] = useState(offer || base);
  if (!(p === "summer" || p === "fall" || p === "signing")) return null;
  const locked = usc.nilSnap?.[r] || 0;
  const max = Math.max(base * 2.5, offer * 1.5, 50000);
  const room = nilAvailable(usc) + offer;
  const step = state.cfg.offerStep;
  const set = (v) => setVal(Math.max(0, Math.round(v / step) * step));
  return (
    <div style={{ background: ROW, borderRadius: 12, padding: "10px 12px", marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>
        <span>NIL offer</span><span>{money(room)} available for him</span>
      </div>
      {!above ? <div style={{ fontSize: 12, color: SUB, marginTop: 6, fontWeight: 700 }}>Only recruits above the line get NIL offers.</div> : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 900, minWidth: 92, color: val > room ? BAD : INK }}>{money(val)}</span>
            <input type="range" min={0} max={max} step={step} value={Math.min(val, max)} onChange={(e) => set(Number(e.target.value))} style={{ flex: 1, accentColor: GOLD }} />
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
            <button type="button" style={smallBtn()} onClick={() => set(val * 0.9)}>−10%</button>
            <button type="button" style={smallBtn()} onClick={() => set(val * 1.1)}>+10%</button>
            {hope && <button type="button" style={smallBtn()} onClick={() => set(hope)}>His hope {money(hope)}</button>}
            <button type="button" style={smallBtn()} onClick={() => set(marketNil(state, r))}>Market {money(marketNil(state, r))}</button>
            <input className="rs-input" inputMode="numeric" value={val} onChange={(e) => setVal(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} style={{ width: 100, padding: "3px 6px" }} />
            <span style={{ flex: 1 }} />
            <button type="button" style={smallBtn("gold")} disabled={val === offer} onClick={() => actions.offer(r, val)}>{offer ? "Update offer" : "Make offer"}</button>
          </div>
          <div style={{ fontSize: 11, color: SUB, marginTop: 6, fontWeight: 700, lineHeight: 1.4 }}>
            {offer ? <>Current offer <b style={{ color: INK }}>{money(offer)}</b>. </> : <b style={{ color: BAD }}>No offer yet. </b>}
            {hope ? <>He's hoping for about <b style={{ color: INK }}>{money(hope)}</b>. </> : <>Typical for his ranking: about {money(marketNil(state, r))}. </>}
            Change it freely until the window closes{locked ? <> — ending below <b style={{ color: INK }}>{money(locked)}</b> (last window's number) costs interest</> : ""}.
          </div>
        </>
      )}
    </div>
  );
}

// One tap sends a staff member to him. Relationships build: each window a
// staffer spends on him makes the next count more (user, 2026-11-18). A
// coordinator can work the other side of the ball — at a discount.
function StaffOn({ sim, r }) {
  const { state, actions } = sim;
  const x = state.recruits[r];
  const usc = state.schools[state.user];
  if (phaseOf(state) === "winter") return <><Sub>Staff</Sub><div style={{ fontSize: 12, color: SUB, fontWeight: 700 }}>Individual assignments open in Spring.</div></>;
  const bonds = bondView(state, r);
  const cap = state.cfg.staff.bond.cap;
  return (
    <>
      <Sub>Staff on him · relationships</Sub>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5 }}>
        {ROLES.map((role, i) => {
          const a = usc.staff[i];
          const on = a?.kind === "recruit" && a.r === r;
          const off = COACHES.has(role) && !covers(role, x.pos);
          const bd = bonds[i];
          return (
            <button key={role} type="button" title={`${ROLE_LABEL[role]}${on ? " — on him (tap to unassign)" : a ? " — tap to move him here" : ""} · ${bd.n % 1 ? bd.n.toFixed(2) : bd.n} window${bd.n === 1 ? "" : "s"} with him (regional contact counts ¼) · next visit ×${bd.mult.toFixed(2)}${off ? " (other side of the ball)" : ""}`}
              onClick={() => actions.assign(role, on ? null : { kind: "recruit", r })}
              style={{ border: `1px solid ${on ? GOLD : LINE}`, background: on ? GOLD : "transparent", color: on ? "#111" : INK, borderRadius: 8, padding: "5px 8px", fontWeight: 900, fontSize: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span>{role}{on ? " ✓" : ""}</span>
                {off && <span style={{ fontSize: 9, fontWeight: 900, color: on ? "#111" : "#e0a24a" }}>OFF-SIDE</span>}
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 900, color: on ? "#111" : bd.mult > 1.001 ? GOOD : bd.mult < 0.999 ? BAD : SUB }}>×{bd.mult.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", gap: 2, marginTop: 3 }}>
                {Array.from({ length: cap }, (_, k) => {
                  const f = Math.max(0, Math.min(1, bd.n - k));
                  return <span key={k} style={{ flex: 1, height: 3, borderRadius: 2, background: on ? "rgba(0,0,0,0.2)" : "#1b2538", overflow: "hidden" }}><span style={{ display: "block", width: `${f * 100}%`, height: "100%", background: on ? "#111" : GOLD }} /></span>;
                })}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: SUB, fontWeight: 700, marginTop: 4 }}>Coaches build interest; scouts uncover grades (and a little interest). Every window a staffer spends with him makes the next visit land harder — keep the same person on him. Meeting him on a regional trip counts a quarter as much. A coach on a kid he recommended gets more; a coordinator on the other side of the ball, less.</div>
    </>
  );
}

// He's set a decision date — the end of this window.
function Decision({ sim, r, brand }) {
  const { state } = sim;
  const d = decisionView(state, r);
  if (!d) return null;
  const u = state.user;
  return (
    <div className="rs-pulse" style={{ border: `2px solid ${GOLD}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12, background: "rgba(246,162,29,0.08)" }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: GOLD }}>📅 DECISION · HE ANNOUNCES AT THE END OF THIS WINDOW</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "8px 0 4px", flexWrap: "wrap" }}>
        {d.field.map((f) => (
          <span key={f.s} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 900, color: f.s === u ? GOLD : INK }}>
            <Logo b={brand(state.schools[f.s].slug)} size={24} />{f.s === u ? "You" : ""}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 800, color: d.inIt ? INK : BAD }}>
        {!d.inIt ? "You're not one of his finalists." : d.pick === u ? (d.conf === "Confident" ? "Your staff thinks you've got him." : d.conf === "Leaning" ? "Your staff thinks he's leaning your way — keep pushing." : "Your staff calls it a coin flip. Everything you do this week counts.") : "Your staff thinks you're behind. A coach on him and a better NIL offer could still flip it."}
      </div>
    </div>
  );
}

// His senior season, as your staff reads it.
function Season({ sim, r }) {
  const tv = trendView(sim.state, r);
  if (!tv) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "-2px 0 10px", fontSize: 12, fontWeight: 800 }}>
      <span style={{ color: SUB, fontSize: 10, fontWeight: 900, letterSpacing: "0.12em" }}>SENIOR SEASON</span>
      <TrendBadge tv={tv} label />
    </div>
  );
}

// Potential: what it means once found; what hints at it before then.
function Ceiling({ sim, r, cats }) {
  const { state } = sim;
  const c = ceilingView(state, r);
  if (c) {
    const color = c.dir > 0 ? GOOD : c.dir < 0 ? BAD : SUB;
    return (
      <div style={{ fontSize: 12, fontWeight: 800, color, margin: "-4px 0 12px", lineHeight: 1.4 }}>
        {c.dir > 0 ? "▲" : c.dir < 0 ? "▼" : "•"} Potential {c.grade}: {c.label.toLowerCase()} by the end of his senior season.
      </div>
    );
  }
  const phy = cats.phy;
  return (
    <div style={{ fontSize: 11, color: SUB, fontWeight: 700, margin: "-4px 0 12px", lineHeight: 1.4 }}>
      Potential decides the jump he makes over his senior season — and it's the hardest thing to find (about 1 scouting look in 500).
      {phy.state !== "unknown" ? <> His athletic grades (<b style={{ color: INK }}>{phy.label}</b>) are a clue; so is how his fall is going.</> : " His athletic grades are a clue — scout his Physical traits — and so is how his fall is going."}
    </div>
  );
}
