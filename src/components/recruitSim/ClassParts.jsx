// src/components/recruitSim/ClassParts.jsx
//
// The class (user, 2026-11-17):
//   YourClass    on the Board, at the bottom — one row per commitment, with
//                the reveal: his TRUE overall vs his public rating (finding
//                the underrated guys is the game)
//   Rankings     national class rankings by the website's public ratings
//   FinalScreen  after Signing Day, in place of the whole game UI: every
//                signee by true overall, classes ranked by true overall AND
//                by the website, and how you did
import { useMemo, useState } from "react";
import { Section, Stars, Logo, Reveal, RatingBlock, smallBtn, pillBtn, GOLD, SUB, INK, LINE, ROW, BLUE, GOOD, BAD } from "./ui";
import { classRankings } from "../../utils/recruitSim/engine";
import { classReport } from "../../utils/recruitSim/grading";
import { revealView } from "../../utils/recruitSim/view";
import { money } from "../../utils/recruitSim/data";

export function useRankings(sim, key = "rating") {
  const { state, ver } = sim;
  return useMemo(() => classRankings(state, key), [state, ver, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Your commitments — one row each, the truth beside the ranking.
export function YourClass({ sim, onOpen, isMobile }) {
  const { state } = sim;
  const usc = state.schools[state.user];
  const ranks = useRankings(sim);
  const at = ranks.findIndex((c) => c.s === state.user) + 1;
  const signees = usc.commits.map((r) => state.recruits[r]).sort((a, b) => b.rating - a.rating);
  if (!signees.length) return null;
  return (
    <Section title={`Your class · ${signees.length}/${state.cfg.classLimit}`} right={<span style={{ fontSize: 12, fontWeight: 900, color: GOLD }}>No. {at} on the website</span>}>
      {signees.map((x, k) => (
        <div key={x.i} className="rs-row" onClick={() => onOpen(x.i)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 14px", borderBottom: `1px solid ${LINE}`, background: ROW, cursor: "pointer" }}>
          <span style={{ width: 20, fontWeight: 900, color: GOLD }}>{k + 1}</span>
          <RatingBlock x={x} size={14} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.first} {x.last} <span style={{ color: GOLD, fontSize: 11 }}>{x.pos}</span></div>
            <div style={{ fontSize: 11, color: SUB, fontWeight: 700 }}><Stars n={x.stars} size={9} /> {x.city}, {x.st}{isMobile ? "" : ` · ${money(usc.paid[x.i] || 0)} NIL`}</div>
          </div>
          <Reveal rv={revealView(state, x.i)} />
        </div>
      ))}
    </Section>
  );
}

export function Rankings({ sim, brand, top = 10 }) {
  const { state } = sim;
  const ranks = useRankings(sim);
  const [all, setAll] = useState(false);
  const u = state.user;
  const at = ranks.findIndex((c) => c.s === u) + 1;
  if (!ranks.some((c) => c.n > 0)) return null; // nothing to rank before the first commitment
  const n = all ? 25 : top;
  const rows = ranks.slice(0, n).concat(at > n ? [ranks[at - 1]] : []);
  return (
    <Section title="National class rankings" right={<button type="button" style={smallBtn()} onClick={() => setAll(!all)}>{all ? "Top 10" : "Top 25"}</button>}>
      {rows.map((c) => {
        const k = ranks.indexOf(c) + 1;
        const sc = state.schools[c.s];
        return (
          <div key={c.s} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", borderBottom: `1px solid ${LINE}`, background: c.s === u ? "rgba(246,162,29,0.12)" : ROW }}>
            <span style={{ width: 24, fontWeight: 900, color: k <= 3 ? GOLD : SUB }}>{k}</span>
            <Logo b={brand(sc.slug)} size={20} />
            <span style={{ flex: 1, fontWeight: 900, fontSize: 12 }}>{sc.name}</span>
            <span style={{ fontSize: 11, color: SUB, fontWeight: 800 }}>{c.n} · {c.stars[5] ? `${c.stars[5]}×5★ ` : ""}{c.stars[4] ? `${c.stars[4]}×4★` : ""}</span>
          </div>
        );
      })}
    </Section>
  );
}

// ── Signing Day: the scoreboard ──
export function FinalScreen({ sim, brand, isMobile, onOpen, onNew }) {
  const { state } = sim;
  const u = state.user;
  const usc = state.schools[u];
  const truth = useRankings(sim, "dev");
  const web = useRankings(sim, "rating");
  const field = truth.length;
  const tAt = truth.findIndex((c) => c.s === u) + 1;
  const wAt = web.findIndex((c) => c.s === u) + 1;
  // The report card (user, 2026-11-18): talent, NIL value, needs, evaluation, size.
  const card = useMemo(() => classReport(state, u), [state, sim.ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const grade = card.grade;
  const b = brand(usc.slug) || {};
  const fin = (x) => (x.ovrDev != null ? x.ovrDev : x.ovr);
  const signees = usc.commits.map((r) => state.recruits[r]).sort((a, b2) => fin(b2) - fin(a));
  const rv = signees.map((x) => revealView(state, x.i));
  const steals = rv.filter((v) => v.delta >= 2).length;
  const busts = rv.filter((v) => v.delta <= -2).length;
  const avgT = signees.length ? signees.reduce((a, x) => a + fin(x), 0) / signees.length : 0;
  const ups = rv.filter((v) => v.jump >= 1.5).length;
  const downs = rv.filter((v) => v.jump <= -1.5).length;
  const avgW = signees.length ? signees.reduce((a, x) => a + x.rating, 0) / signees.length : 0;
  const best = signees.slice().sort((a, b2) => (fin(b2) - b2.rating) - (fin(a) - a.rating))[0];
  const worst = signees.slice().sort((a, b2) => (fin(a) - a.rating) - (fin(b2) - b2.rating))[0];
  const gap = wAt - tAt;
  const verdict = !signees.length ? "You didn't sign anyone."
    : gap >= 10 ? `Your scouts won this one. The websites had you No. ${wAt}; on the field this is the No. ${tAt} class in the country.`
      : gap >= 3 ? `You found value the rankings missed — No. ${wAt} on the website, No. ${tAt} for real.`
        : gap > -3 ? `What you saw is what you got — the rankings had your class about right (No. ${wAt} website, No. ${tAt} true).`
          : gap > -10 ? `The tape is a little kinder to the website than to you: No. ${wAt} on paper, No. ${tAt} in truth.`
            : `Paper tigers. The websites loved this class (No. ${wAt}); the truth says No. ${tAt}.`;

  return (
    <div>
      <div className="rs-pop" style={{ borderRadius: 18, overflow: "hidden", marginBottom: 12, border: `1px solid ${LINE}`, background: `linear-gradient(120deg, ${b.Color1 || BLUE}, #0e1626 75%)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 22, padding: isMobile ? 16 : "26px 30px", flexWrap: "wrap" }}>
          <Logo onColor b={b} size={isMobile ? 60 : 96} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.2em", color: GOLD }}>SIGNING DAY · FINAL REPORT CARD</div>
            <div style={{ fontSize: isMobile ? 28 : 44, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>{usc.name}</div>
            <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 800, marginTop: 8, lineHeight: 1.45, maxWidth: 640 }}>{verdict}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" style={{ ...smallBtn("gold"), padding: "7px 14px", fontSize: 12 }} onClick={onNew}>Start a new season</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Big label="CLASS GRADE" value={<span className="rs-stamp" style={{ display: "inline-block" }}>{grade}</span>} big />
            <Big label="TRUE RANK" value={`No. ${tAt}`} sub={`of ${field}`} />
            <Big label="WEBSITE RANK" value={`No. ${wAt}`} sub={gap ? `${gap > 0 ? "▲" : "▼"} ${Math.abs(gap)} ${gap > 0 ? "better" : "worse"} for real` : "dead on"} subColor={gap > 0 ? GOOD : gap < 0 ? BAD : SUB} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(6, 1fr)", gap: 1, background: LINE, borderTop: `1px solid ${LINE}` }}>
          <Stat label="Signees" v={`${signees.length}/${state.cfg.classLimit}`} />
          <Stat label="Avg final overall" v={avgT.toFixed(1)} />
          <Stat label="Avg website rating" v={avgW.toFixed(1)} />
          <Stat label="Steals / misses" v={<><span style={{ color: GOOD }}>{steals}</span> / <span style={{ color: BAD }}>{busts}</span></>} />
          <Stat label="Jumped up / slid" v={<><span style={{ color: GOOD }}>▲{ups}</span> / <span style={{ color: BAD }}>▼{downs}</span></>} />
          <Stat label="NIL spent" v={money(usc.spent)} />
        </div>
      </div>

      <Section title="Report card · how the class was built">
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(5, minmax(0, 1fr))", gap: 1, background: LINE }}>
          {card.parts.map((p, i) => (
            <div key={p.key} className="rs-pop" style={{ animationDelay: `${0.15 + i * 0.12}s`, background: "#0b1322", padding: "12px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 30, fontWeight: 900, lineHeight: 1, minWidth: 44, color: p.grade[0] === "A" ? GOOD : p.grade[0] === "B" ? "#6aa6ff" : p.grade[0] === "C" ? GOLD : BAD }}>{p.grade}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: INK, textTransform: "uppercase" }}>{p.label}</div>
                <div style={{ fontSize: 11.5, color: SUB, fontWeight: 700, marginTop: 3, lineHeight: 1.4 }}>{p.note}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
        <div>
          {signees.length > 0 && best && worst && best !== worst && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <Spot title="Best find" x={best} rv={revealView(state, best.i)} color={GOOD} onOpen={onOpen} />
              <Spot title="Biggest miss" x={worst} rv={revealView(state, worst.i)} color={BAD} onOpen={onOpen} />
            </div>
          )}
          <Section title={`Your signees · by final overall (true + potential jump)`}>
            {signees.map((x, k) => (
              <div key={x.i} className="rs-row" onClick={() => onOpen(x.i)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${LINE}`, background: ROW, cursor: "pointer" }}>
                <span style={{ width: 22, fontWeight: 900, color: GOLD, fontSize: 15 }}>{k + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.first} {x.last} <span style={{ color: GOLD, fontSize: 11 }}>{x.pos}</span></div>
                  <div style={{ fontSize: 11, color: SUB, fontWeight: 700 }}><Stars n={x.stars} size={9} /> Website {x.rating.toFixed(1)} · No. {x.rank}</div>
                </div>
                <Reveal rv={rv[k]} />
              </div>
            ))}
            {!signees.length && <div style={{ padding: 16, color: SUB, fontWeight: 700 }}>No signees this year.</div>}
          </Section>
        </div>
        <ClassBoard state={state} brand={brand} truth={truth} web={web} />
      </div>
    </div>
  );
}

function ClassBoard({ state, brand, truth, web }) {
  const [by, setBy] = useState("truth");
  const [all, setAll] = useState(false);
  const u = state.user;
  const tRank = new Map(truth.map((c, i) => [c.s, i + 1]));
  const wRank = new Map(web.map((c, i) => [c.s, i + 1]));
  const list = by === "truth" ? truth : web;
  const n = all ? 50 : 25;
  const at = list.findIndex((c) => c.s === u);
  const rows = list.slice(0, n).concat(at >= n ? [list[at]] : []);
  return (
    <Section title="Class rankings" right={<span style={{ display: "flex", gap: 4 }}>
      <button type="button" style={{ ...pillBtn(by === "truth"), padding: "3px 9px", fontSize: 11 }} onClick={() => setBy("truth")}>Final overall</button>
      <button type="button" style={{ ...pillBtn(by === "web"), padding: "3px 9px", fontSize: 11 }} onClick={() => setBy("web")}>Website</button>
    </span>}>
      <div style={{ display: "flex", gap: 8, padding: "5px 12px", fontSize: 10, fontWeight: 900, color: SUB, letterSpacing: "0.08em", borderBottom: `1px solid ${LINE}` }}>
        <span style={{ width: 26 }}>{by === "truth" ? "TRUE" : "WEB"}</span><span style={{ flex: 1 }}>SCHOOL</span><span style={{ width: 52, textAlign: "right" }}>AVG</span><span style={{ width: 44, textAlign: "right" }}>{by === "truth" ? "WEB" : "TRUE"}</span>
      </div>
      {rows.map((c) => {
        const k = list.indexOf(c) + 1;
        const other = by === "truth" ? wRank.get(c.s) : tRank.get(c.s);
        const sc = state.schools[c.s];
        const d = other - k;
        return (
          <div key={c.s} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", borderBottom: `1px solid ${LINE}`, background: c.s === u ? "rgba(246,162,29,0.16)" : ROW }}>
            <span style={{ width: 26, fontWeight: 900, color: k <= 3 ? GOLD : INK }}>{k}</span>
            <Logo b={brand(sc.slug)} size={20} />
            <span style={{ flex: 1, fontWeight: 900, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sc.name} <span style={{ color: SUB, fontWeight: 800 }}>· {c.n}</span></span>
            <span style={{ width: 52, textAlign: "right", fontSize: 12, fontWeight: 900 }}>{c.avg ? c.avg.toFixed(1) : "—"}</span>
            <span style={{ width: 44, textAlign: "right", fontSize: 11, fontWeight: 900, color: by === "truth" ? (d > 0 ? GOOD : d < 0 ? BAD : SUB) : SUB }}>{other}</span>
          </div>
        );
      })}
      <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: SUB, fontWeight: 700 }}>
        <span>{by === "truth" ? "Ranked by final overall (true + potential jump) — green: better than the website said." : "Ranked by the website's public ratings."}</span>
        <button type="button" style={smallBtn()} onClick={() => setAll(!all)}>{all ? "Top 25" : "Top 50"}</button>
      </div>
    </Section>
  );
}

function Big({ label, value, sub, subColor, big }) {
  return (
    <div style={{ textAlign: "center", background: "rgba(0,0,0,0.35)", borderRadius: 14, padding: big ? "10px 22px" : "10px 16px", minWidth: big ? 110 : 96 }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: SUB }}>{label}</div>
      <div style={{ fontSize: big ? 52 : 28, fontWeight: 900, color: big ? GOLD : INK, lineHeight: 1.05 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, fontWeight: 900, color: subColor || SUB }}>{sub}</div>}
    </div>
  );
}
function Stat({ label, v }) {
  return (
    <div style={{ background: "#0b1322", padding: "10px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, marginTop: 2 }}>{v}</div>
    </div>
  );
}
function Spot({ title, x, rv, color, onOpen }) {
  return (
    <div className="rs-row" onClick={() => onOpen(x.i)} style={{ background: ROW, border: `1px solid ${color}`, borderRadius: 14, padding: "10px 12px", cursor: "pointer" }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color }}>{title.toUpperCase()}</div>
      <div style={{ fontWeight: 900, fontSize: 15, marginTop: 3 }}>{x.first} {x.last} <span style={{ color: GOLD, fontSize: 11 }}>{x.pos}</span></div>
      <div style={{ fontSize: 11, color: SUB, fontWeight: 700, marginBottom: 6 }}><Stars n={x.stars} size={9} /> Website {x.rating.toFixed(1)} · No. {x.rank}</div>
      <Reveal rv={rv} />
    </div>
  );
}
