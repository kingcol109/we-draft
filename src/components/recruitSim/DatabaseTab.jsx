// src/components/recruitSim/DatabaseTab.jsx
//
// The whole class — all 3,000 recruits, visible from day one (spec §3).
// Filter by position / region (or tap the map) / stars / interest / what you
// know, search by name or high school, and sort by clicking any column header
// (user, 2026-11-17). Public columns are plain; anything your staff uncovered
// shows as grade chips; hidden stays "?".
import { useMemo, useState } from "react";
import { Section, Stars, GradeChip, InterestMeter, Progress, RecBadge, StageChip, RatingBlock, htLabel, smallBtn, pillBtn, GOLD, SUB, LINE, ROW, INK } from "./ui";
import USMap from "./USMap";
import { categoryView, staffGrade, scoutProgress, interestView, recommendedBy, stageView } from "../../utils/recruitSim/view";
import { evaluate, boardLimits } from "../../utils/recruitSim/model";
import { POSITIONS, CATS } from "../../utils/recruitSim/traits";
import { REGIONS, REGION_LABEL, regionOfState } from "../../utils/recruitSim/regions";

const PAGE = 50;
const SHOW = [["all", "Everyone"], ["open", "Uncommitted"], ["board", "On my board"], ["recs", "Recommended"], ["scouted", "Scouted"], ["committed", "Committed"]];
const INTEREST = [["any", "Any interest"], ["4", "Very High"], ["3", "High +"], ["2", "Medium +"], ["contact", "Any contact"], ["none", "No contact"]];
// Sortable columns: key → [label, value fn (bigger = first unless asc)]
const COLS = [
  ["rank", "Rating", 52],
  ["name", "Recruit", null],
  ["staff", "I · T · P · Staff", 130],
  ["scout", "Scouted", 58],
  ["interest", "Interest", 128],
  ["stage", "Recruitment", 92],
];

export default function DatabaseTab({ sim, onOpen, isMobile, brand }) {
  const { state, actions, ver } = sim;
  const u = state.user;
  const usc = state.schools[u];
  const lim = boardLimits(state);
  const [pos, setPos] = useState("ALL");
  const [region, setRegion] = useState("ALL");
  const [stars, setStars] = useState(0);
  const [show, setShow] = useState("open");
  const [interest, setInterest] = useState("any");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(["rank", true]); // [key, ascending]
  const [page, setPage] = useState(0);
  const [map, setMap] = useState(false);
  const [metric, setMetric] = useState("talent");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const board = new Set(usc.board);
    let list = state.recruits.filter((x) => {
      if (pos !== "ALL" && x.pos !== pos) return false;
      if (region !== "ALL" && x.region !== region) return false;
      if (stars && x.stars !== stars) return false;
      if (show === "open" && (x.commit >= 0 || x.status === "unsigned")) return false;
      if (show === "committed" && x.commit < 0) return false;
      if (show === "board" && !board.has(x.i)) return false;
      if (show === "recs" && !state.recMask[u * state.N + x.i]) return false;
      if (show === "scouted" && scoutProgress(state, x.i) === 0) return false;
      if (interest !== "any") {
        const v = interestView(state, x.i);
        if (interest === "none" ? v.level || v.committed != null : !v.level) return false;
        if (/^\d$/.test(interest) && v.lvl < Number(interest)) return false;
      }
      if (term && !`${x.first} ${x.last}`.toLowerCase().includes(term) && !x.hs.toLowerCase().includes(term) && !x.city.toLowerCase().includes(term)) return false;
      return true;
    });
    const [key, asc] = sort;
    const val = {
      rank: (x) => x.rank,
      name: (x) => `${x.last} ${x.first}`,
      staff: (x) => { const e = evaluate(state, u, x.i); return e.known >= 0.5 ? -e.est : 999; },
      scout: (x) => -scoutProgress(state, x.i),
      interest: (x) => { const v = interestView(state, x.i); return v.committed != null ? (v.mine ? -1000 : 900) : v.level ? -(v.lvl * 100 + (13 - (v.place || 13))) : 999; },
      stage: (x) => { const sv = stageView(state, x.i); return -(sv.step * 10 + (sv.inIt ? 5 : 0)); },
    }[key];
    const keyed = list.map((x) => [val(x), x]);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1].rank - b[1].rank) * (asc ? 1 : -1));
    return keyed.map(([, x]) => x);
  }, [state, ver, pos, region, stars, show, interest, q, sort, u, usc.board]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = rows.slice(pg * PAGE, pg * PAGE + PAGE);
  const reset = (fn) => (v) => { fn(v); setPage(0); };
  const sortBy = (k) => { setSort(([cur, asc]) => (cur === k ? [k, !asc] : [k, true])); setPage(0); };

  return (
    <Section title={`Recruits · ${rows.length.toLocaleString()} of ${state.N.toLocaleString()}`} right={<button type="button" style={smallBtn(map ? "gold" : "plain")} onClick={() => setMap(!map)}>{map ? "Hide map" : "Map"}</button>}>
      {map && (
        <div style={{ padding: 12, borderBottom: `1px solid ${LINE}` }}>
          <USMap state={state} ver={ver} metric={metric} setMetric={setMetric} selected={region === "ALL" ? null : region} droppable={false}
            onPick={(st) => { const rg = regionOfState(st); reset(setRegion)(region === rg ? "ALL" : rg); }} compact={isMobile} />
        </div>
      )}
      <div style={{ padding: "10px 14px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: `1px solid ${LINE}` }}>
        <input className="rs-input" value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search name, high school, town" style={{ flex: isMobile ? "1 1 100%" : "0 1 240px" }} />
        <select className="rs-input" value={pos} onChange={(e) => reset(setPos)(e.target.value)}><option value="ALL">All positions</option>{POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <select className="rs-input" value={region} onChange={(e) => reset(setRegion)(e.target.value)}><option value="ALL">All regions</option>{REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        <select className="rs-input" value={stars} onChange={(e) => reset(setStars)(Number(e.target.value))}><option value={0}>All stars</option>{[5, 4, 3, 2].map((s) => <option key={s} value={s}>{s}-star</option>)}</select>
        <select className="rs-input" value={interest} onChange={(e) => reset(setInterest)(e.target.value)}>{INTEREST.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <div style={{ padding: "8px 14px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: `1px solid ${LINE}` }}>
        {SHOW.map(([k, l]) => <button key={k} type="button" style={pillBtn(show === k)} onClick={() => reset(setShow)(k)}>{l}</button>)}
      </div>
      {/* Column headers — click to sort, again to flip. */}
      <div style={{ display: "flex", gap: isMobile ? 6 : 12, padding: "6px 14px", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: SUB, textTransform: "uppercase", borderBottom: `1px solid ${LINE}`, flexWrap: isMobile ? "wrap" : "nowrap" }}>
        {COLS.map(([k, l, w]) => (
          <button key={k} type="button" onClick={() => sortBy(k)} style={{ all: "unset", cursor: "pointer", width: isMobile ? "auto" : w || undefined, flex: w ? undefined : 1, color: sort[0] === k ? GOLD : SUB, whiteSpace: "nowrap" }}>
            {l}{sort[0] === k ? (sort[1] ? " ▲" : " ▼") : ""}
          </button>
        ))}
        {!isMobile && <span style={{ width: 70 }} />}
      </div>
      {shown.map((x) => {
        const cats = categoryView(state, x.i);
        const sg = staffGrade(state, x.i);
        const on = usc.board.includes(x.i);
        return (
          <div key={x.i} className="rs-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: isMobile ? "8px 10px" : "7px 14px", borderBottom: `1px solid ${LINE}`, background: on ? "rgba(0,85,165,0.16)" : ROW, flexWrap: isMobile ? "wrap" : "nowrap" }}>
            <span style={{ width: 52, display: "flex", justifyContent: "center" }}><RatingBlock x={x} size={18} /></span>
            <div style={{ flex: 1, minWidth: 170 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span className="rs-link" onClick={() => onOpen(x.i)} style={{ fontWeight: 900, fontSize: 14, color: INK }}>{x.first} {x.last}</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: GOLD }}>{x.pos}</span>
                <Stars n={x.stars} size={10} />
                <RecBadge roles={recommendedBy(state, x.i)} />
              </div>
              <div style={{ fontSize: 11, color: SUB, fontWeight: 700, marginTop: 2 }}>{x.hs} · {x.city}, {x.st} · {REGION_LABEL[x.region]} · {htLabel(x.ht)} {x.wt}</div>
            </div>
            <div style={{ width: isMobile ? "auto" : 130, display: "flex", gap: 3 }}>
              {CATS.map((c) => <GradeChip key={c} label={cats[c].label} state={cats[c].state} size="sm" />)}
              <span style={{ width: 4 }} />
              {sg ? <GradeChip label={sg.label} state={sg.sure ? "exact" : "range"} size="sm" /> : <GradeChip state="unknown" size="sm" />}
            </div>
            {!isMobile && <span style={{ width: 58 }}><Progress p={scoutProgress(state, x.i)} w={50} /></span>}
            <span style={{ width: isMobile ? "auto" : 128 }}><InterestMeter v={interestView(state, x.i)} /></span>
            <span style={{ width: isMobile ? "auto" : 92 }}><StageChip sv={stageView(state, x.i)} brand={brand} state={state} /></span>
            <span style={{ width: 70, textAlign: "right" }}>
              {x.commit < 0 && x.status !== "unsigned" && (on ? <span style={{ fontSize: 11, fontWeight: 900, color: SUB }}>On board ✓</span>
                : <button type="button" style={{ ...smallBtn("gold"), opacity: lim.size ? 1 : 0.4, cursor: lim.size ? "pointer" : "default" }} disabled={!lim.size} title={lim.size ? "" : "The board opens in Spring"} onClick={() => actions.add(x.i)}>+ Board</button>)}
            </span>
          </div>
        );
      })}
      {!shown.length && <div style={{ padding: 20, color: SUB, fontWeight: 700 }}>No recruits match.</div>}
      {sim.error && <div style={{ padding: "6px 14px", color: "#ff8a7a", fontWeight: 800, fontSize: 12 }}>{sim.error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", justifyContent: "center" }}>
        <button type="button" style={smallBtn()} disabled={pg === 0} onClick={() => setPage(pg - 1)}>← Prev</button>
        <span style={{ fontSize: 12, fontWeight: 800, color: SUB }}>Page {pg + 1} of {pages}</span>
        <button type="button" style={smallBtn()} disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next →</button>
      </div>
    </Section>
  );
}
