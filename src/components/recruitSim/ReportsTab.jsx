// src/components/recruitSim/ReportsTab.jsx
//
// What changed since the last window (spec §11, §28; reworked 2026-11-17):
//   • your new commitments first — a moment, not a news line, with the
//     reveal (true overall vs his public rating)
//   • your program's news — only the biggest item per player; commitments
//     elsewhere at the bottom, one row each
//   • Players to watch + senior-season movers (left) · Coach reports
//     (right), then scouting
// Around the country is its own tab (NationalTab). Rows open the player —
// no View buttons. Everything comes from the engine's report / events
// (utils/recruitSim/reports.js) — nothing invented.
import { useMemo } from "react";
import { Section, smallBtn, RecBadge, Logo, RatingBlock, Stars, Reveal, GOLD, SUB, INK, LINE, ROW, GOOD, BAD, BLUE } from "./ui";
import { reportSections, watchList } from "../../utils/recruitSim/reports";
import { revealView } from "../../utils/recruitSim/view";
import { boardLimits, phaseOf } from "../../utils/recruitSim/model";
import { STAGES } from "../../utils/recruitSim/config";

export default function ReportsTab({ sim, onOpen, isMobile, brand, goTab }) {
  const { state } = sim;
  const rep = state.reports[state.reports.length - 1];
  const sec = useMemo(() => reportSections(state, rep), [state, rep, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const watch = useMemo(() => watchList(state, rep), [state, rep, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const phase = phaseOf(state);
  if (!sec) return <Welcome state={state} goTab={goTab} />;
  const name = (r) => `${state.recruits[r].first} ${state.recruits[r].last}`;
  const toneColor = { good: GOOD, bad: BAD, action: GOLD };

  return (
    <div>
      <PhaseTip phase={phase} state={state} goTab={goTab} />
      <Commits sim={sim} list={sec.commits} brand={brand} onOpen={onOpen} isMobile={isMobile} />
      <Section title={`Your program · ${sec.stage} report`}>
        {sec.mine.length ? sec.mine.map((m) => (
          <div key={m.r} className="rs-row" onClick={() => onOpen(m.r)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${LINE}`, background: m.demand ? "rgba(246,162,29,0.08)" : ROW, cursor: "pointer" }}>
            {m.s != null ? <Logo b={brand(state.schools[m.s].slug)} size={20} /> : <span style={{ width: 8, height: 8, margin: "0 6px", borderRadius: 4, background: toneColor[m.tone], flexShrink: 0 }} />}
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{m.text}</span>
            {m.demand && <span style={{ fontSize: 10, fontWeight: 900, color: "#111", background: GOLD, borderRadius: 4, padding: "2px 6px" }}>RESPOND</span>}
            {m.decision && <span className="rs-pulse" style={{ fontSize: 10, fontWeight: 900, color: "#111", background: GOLD, borderRadius: 4, padding: "2px 6px" }}>THIS WEEK</span>}
          </div>
        )) : <div style={{ padding: 14, color: SUB, fontWeight: 700, fontSize: 13 }}>Quiet window for your program.</div>}
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
        <div>
          {phase !== "done" && <Watch sim={sim} list={watch} onOpen={onOpen} />}
          {sec.dev.some((d) => !d.mine) && (
            <Section title="Senior season · on your radar">
              <div style={{ padding: "6px 14px", fontSize: 12, color: SUB, fontWeight: 700, borderBottom: `1px solid ${LINE}` }}>Players your staff has seen whose fall just turned — big moves only. Which way, not how far.</div>
              {sec.dev.filter((d) => !d.mine).slice(0, 10).map((d) => (
                <div key={d.r} className="rs-row" onClick={() => onOpen(d.r)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 14px", borderBottom: `1px solid ${LINE}`, background: ROW, cursor: "pointer" }}>
                  <span style={{ fontSize: 15 }}>{d.dir > 0 ? "📈" : "📉"}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: d.dir > 0 ? INK : SUB }}>{d.text}</span>
                </div>
              ))}
            </Section>
          )}
          <Section title="Scouting reports">
            {sec.staff.filter((s) => ["HS", "OS", "DS"].includes(s.role)).map((s) => (
              <div key={s.role} style={{ padding: "10px 14px", borderBottom: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 13, fontWeight: 900 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: SUB, fontWeight: 700, marginTop: 2 }}>{s.line}</div>
                {s.recruits.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {s.recruits.map((x) => (
                      <button key={x.r} type="button" onClick={() => onOpen(x.r)} style={{ ...smallBtn(), fontWeight: 800 }}>
                        {name(x.r)} <span style={{ color: SUB }}>· {state.recruits[x.r].pos}{x.exact ? ` · ${x.exact} exact` : ""}{x.range ? ` · ${x.range} range${x.range > 1 ? "s" : ""}` : ""}{x.pot ? " · potential" : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sec.board && <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: SUB }}>Board scouting: <b style={{ color: INK }}>{sec.board.ranges + sec.board.exact}</b> grades on {sec.board.recruits} recruits ({sec.board.exact} exact){sec.board.pot ? `, potential on ${sec.board.pot}` : ""}.</div>}
          </Section>
        </div>
        <div>
          <Section title="Coach reports">
            {sec.staff.filter((s) => ["HC", "OC", "DC"].includes(s.role)).map((s) => (
              <div key={s.role} style={{ padding: "10px 14px", borderBottom: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 13, fontWeight: 900 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: SUB, fontWeight: 700, marginTop: 2 }}>{s.line}</div>
                {s.recs.map((rc) => (
                  <div key={rc.r} className="rs-row" onClick={() => onOpen(rc.r)} style={{ marginTop: 8, background: "rgba(246,162,29,0.08)", border: `1px solid rgba(246,162,29,0.4)`, borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}>
                    <div style={{ fontSize: 13, fontStyle: "italic", lineHeight: 1.45 }}>“{rc.text}”</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                      <RecBadge roles={[s.role]} />
                      <span style={{ fontSize: 12, fontWeight: 900 }}>{name(rc.r)} · {state.recruits[rc.r].pos} · No. {state.recruits[rc.r].rank}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

// Your new commitments — the moment of the window.
function Commits({ sim, list, brand, onOpen, isMobile }) {
  const { state } = sim;
  if (!list?.length) return null;
  const usc = state.schools[state.user];
  const b = brand(usc.slug) || {};
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${Math.min(list.length, 3)}, minmax(0, 1fr))`, gap: 10, marginBottom: 12 }}>
      {list.map((c, i) => {
        const x = state.recruits[c.r];
        return (
          <div key={c.r} className="rs-pop rs-row" onClick={() => onOpen(c.r)} style={{ animationDelay: `${i * 0.08}s`, cursor: "pointer", borderRadius: 16, overflow: "hidden", border: `2px solid ${GOLD}`, background: `linear-gradient(125deg, ${b.Color1 || BLUE}, #0e1626 80%)`, boxShadow: "0 10px 30px rgba(246,162,29,0.18)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
              <Logo onColor b={b} size={isMobile ? 44 : 54} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="rs-stamp" style={{ display: "inline-block", fontSize: 11, fontWeight: 900, letterSpacing: "0.2em", color: GOLD }}>{c.how === "announce" ? "📅 HE CHOSE YOU!" : "COMMITTED!"}{c.how === "demand" ? " · YOU MET HIS NUMBER" : ""}</div>
                <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.first} {x.last}</div>
                <div style={{ fontSize: 12, fontWeight: 800, marginTop: 3 }}><span style={{ color: GOLD }}>{x.pos}</span> · <Stars n={x.stars} size={11} /> · {x.city}, {x.st}</div>
              </div>
            </div>
            {c.jump && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px", background: GOLD, color: "#111", fontSize: 12, fontWeight: 900 }}>
                <span style={{ letterSpacing: "0.14em" }}>UPSET</span>
                <Logo b={brand(state.schools[c.jump.over].slug)} size={18} />
                <span style={{ fontWeight: 800, lineHeight: 1.25 }}>You jumped <b>{state.schools[c.jump.over].name}</b> — you were No. {c.jump.place || "?"} when he decided</span>
              </div>
            )}
            {c.field?.length > 1 && (
              <div style={{ padding: "8px 16px 4px", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", color: SUB, marginBottom: 4 }}>WHERE IT STOOD WHEN HE DECIDED</div>
                {c.field.map(([s2, pct]) => (
                  <div key={s2} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <Logo b={brand(state.schools[s2].slug)} size={18} />
                    <div style={{ flex: 1, height: 7, borderRadius: 4, background: "#1b2538", overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(3, Math.min(100, pct))}%`, height: "100%", background: s2 === state.user ? GOLD : "#6aa6ff" }} />
                    </div>
                    {s2 === state.user && <span style={{ fontSize: 9, fontWeight: 900, color: GOLD }}>YOU</span>}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 16px", background: "rgba(0,0,0,0.35)" }}>
              <div style={{ textAlign: "center" }}><RatingBlock x={x} size={18} /><div style={{ fontSize: 8.5, fontWeight: 900, color: SUB, letterSpacing: "0.08em", marginTop: 2 }}>WEBSITE</div></div>
              <span style={{ color: SUB, fontWeight: 900 }}>→</span>
              <Reveal rv={revealView(state, c.r)} big={!isMobile} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Around the country — its own tab (user, 2026-11-17). The last few windows.
export function NationalTab({ sim, onOpen, brand }) {
  const { state } = sim;
  const reps = state.reports.slice(-4).reverse();
  const secs = useMemo(() => reps.map((rp) => reportSections(state, rp)), [state, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!reps.length) return <Section title="Around the country"><div style={{ padding: 14, color: SUB, fontWeight: 700, fontSize: 13 }}>Nothing yet — national news starts once the season gets going.</div></Section>;
  return (
    <div>
      {secs.map((sec, k) => (
        <Section key={reps[k].st} title={`Around the country · ${STAGES[reps[k].st]?.label}`}>
          {sec.national.length ? sec.national.slice(0, 40).map((n) => (
            <div key={n.r} className="rs-row" onClick={() => onOpen(n.r)} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 14px", borderBottom: `1px solid ${LINE}`, fontSize: 13, fontWeight: 700, background: ROW, cursor: "pointer" }}>
              {n.s != null ? <Logo b={brand(state.schools[n.s].slug)} size={20} /> : <span style={{ width: 20 }} />}
              <span style={{ flex: 1 }}>{n.text}</span>
            </div>
          )) : <div style={{ padding: 14, color: SUB, fontWeight: 700, fontSize: 13 }}>Quiet nationally — lists and commitments pick up in the fall.</div>}
        </Section>
      ))}
    </div>
  );
}

function Welcome({ state, goTab }) {
  return (
    <Section title="Winter · Your first window">
      <div style={{ padding: "16px 18px", lineHeight: 1.6, fontSize: 14, fontWeight: 600 }}>
        <p style={{ margin: "0 0 10px" }}>The entire class of <b>{state.N.toLocaleString()}</b> recruits is already out there — every name in the Recruits tab is real to this world. The public rankings are a starting point, not the truth. Your job: sign the best class you can — by the truth, not the rankings.</p>
        <ol style={{ margin: "0 0 12px 18px", padding: 0 }}>
          <li><b>Staff</b> — send your six staff members to regions. Scouts uncover grades; coaches start relationships and may come back raving about someone. Staff come home after every window — "Same as last window" sends them back out.</li>
          <li><b>Close Winter</b> from the header. Reports arrive at the start of Spring, when your 10-man board opens.</li>
          <li>Summer: the board grows to 25 with a 10-spot line (fill it as you like) — NIL offers go to players above the line. Fall: 35 on the board, 25 above the line, and recruits start deciding.</li>
        </ol>
        <button type="button" style={smallBtn("gold")} onClick={() => goTab("staff")}>Assign your staff →</button>
      </div>
    </Section>
  );
}

// One line on what this window asks of you.
function PhaseTip({ phase, state, goTab }) {
  const usc = state.schools[state.user];
  const tip = {
    spring: ["Spring: build your 10-man board (your scouts' picks are on the Board tab). Every spot builds interest and scouts him — more the closer he is to campus. Staff came home: send them back out.", "board", "Go to board"],
    summer: ["Summer: the board grows to 25. Put the players you want above the line (up to 10) and give each an NIL offer in his player view. Only above-the-line recruits can commit to you.", "board", "Set the line"],
    fall: [`Fall: 35 on the board, 25 above the line. Recruits are narrowing lists and committing. ${usc.commits.length} committed to you.`, "board", "Board"],
    signing: ["Signing Day: everyone left decides now. Last chance to adjust offers and the line.", "board", "Board"],
  }[phase];
  if (!tip) return null;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", marginBottom: 12, borderRadius: 12, border: `1px solid ${GOLD}`, background: "rgba(246,162,29,0.07)", fontSize: 13, fontWeight: 700 }}>
      <span style={{ flex: 1 }}>{tip[0]}</span>
      <button type="button" style={smallBtn("gold")} onClick={() => goTab(tip[1])}>{tip[2]}</button>
    </div>
  );
}

// Players worth a look from this window's work — one tap onto the board.
function Watch({ sim, list, onOpen }) {
  const { state, actions } = sim;
  const usc = state.schools[state.user];
  const lim = boardLimits(state);
  const room = lim.size - usc.board.length;
  return (
    <Section title={`Players to watch · ${list.length}`} right={<span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{lim.size ? `${room} board spot${room === 1 ? "" : "s"} open` : "Board opens in Spring"}</span>}>
      <div style={{ padding: "6px 14px", fontSize: 12, color: SUB, fontWeight: 700, borderBottom: `1px solid ${LINE}` }}>Not on your board yet — turned up by your staff this window.</div>
      {list.map((w) => {
        const x = state.recruits[w.r];
        return (
          <div key={w.r} className="rs-row" onClick={() => onOpen(w.r)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 14px", borderBottom: `1px solid ${LINE}`, background: ROW, cursor: "pointer" }}>
            <RatingBlock x={x} size={15} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><span style={{ fontWeight: 900, fontSize: 13 }}>{x.first} {x.last}</span> <span style={{ color: GOLD, fontSize: 11, fontWeight: 900 }}>{x.pos}</span> <Stars n={x.stars} size={9} /> <span style={{ fontSize: 11, color: SUB, fontWeight: 700 }}>{x.city}, {x.st}</span></div>
              <div style={{ fontSize: 11, color: GOOD, fontWeight: 800 }}>{w.why.join(" · ")}</div>
            </div>
            {lim.size > 0 && <button type="button" style={smallBtn("gold")} disabled={room <= 0} onClick={(e) => { e.stopPropagation(); actions.add(w.r); }}>{room > 0 ? "+ Board" : "Full"}</button>}
          </div>
        );
      })}
      {!list.length && <div style={{ padding: 14, color: SUB, fontWeight: 700, fontSize: 13 }}>Nobody new this window — send your staff out wider.</div>}
    </Section>
  );
}
