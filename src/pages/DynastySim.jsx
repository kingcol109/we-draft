// src/pages/DynastySim.jsx
//
// The Dynasty Draft Sim — /draftsim/dynasty/{year} (2027–2029): a fantasy
// rookie draft of one class's QBs, RBs, WRs and TEs, on the Draft Sim's own
// broadcast (pages/DraftSim.jsx LiveSim → SimBroadcast: the stage, the
// clock, the pick cards, the desk, full screen). Reached from the Draft
// Sim's setup screen (its third mode card, right of Mock Draft).
//
// Teams are "Team 1" … "Team N" (an even 6–20, 12 by default), each with
// its own colors and numbered badge; linear order by default (snake as an
// option); 1–7 rounds (4 by default — no more than the class can fill). The
// user's slot is random unless they choose one. The board is the Draft
// Sim's community board (the Expanded Board — the whole class) with every
// other position taken out and renumbered; CPU teams each read it their own
// way and value quarterbacks a little more (utils/dynastySim/engine.js).
// No trades, no needs; nothing saved or counted.
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import { useIsMobile, GOLD } from "../components/MockDraftKit";
import { LiveSim, SimFrame, Column } from "./DraftSim";
import { DEFAULT_SPEED } from "../components/draftSim/useDraftSim";
import { DEFAULT_CHATTER } from "../utils/draftSim/analysts";
import { DEFAULT_VARIANCE } from "../utils/draftSim/engine";
import { loadSimData, loadExpandedBoard } from "../utils/draftSim/data";
import { applyBoardOrder } from "../utils/draftSim/engine";
import { latestWeeklyOrder, WEEKLY_ORDER_YEARS } from "../utils/dynastySim/weeklyOrder";
import {
  DYNASTY_POSITIONS, DYNASTY_YEARS, TEAM_COUNTS, DEFAULT_TEAMS, ROUND_COUNTS, DEFAULT_ROUNDS,
  dynastyBoard, maxRoundsFor, dynastySimData, dynastyTeam, draftOrder, dynastyBranding, pickLabel,
} from "../utils/dynastySim/engine";

const FONT = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";
const MUTED = "#8b9bb4";

const chip = (on) => ({
  border: `2px solid ${on ? GOLD : "#24324d"}`, background: on ? GOLD : "#0e1626", color: on ? "#fff" : "#c9d4e5",
  borderRadius: 999, padding: "7px 14px", cursor: "pointer", fontFamily: FONT, fontWeight: 900, fontSize: 12, letterSpacing: "0.05em",
});
const smallChip = (on) => ({ ...chip(on), padding: "5px 11px", fontSize: 11 });
const label = { color: MUTED, fontFamily: FONT, fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" };
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0;

function Field({ title, note, children }) {
  return (
    <div>
      <div style={{ ...label, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>
      {note && <div style={{ color: "#9fb0c8", fontSize: 12, fontFamily: BODY, lineHeight: 1.5, marginTop: 6 }}>{note}</div>}
    </div>
  );
}

export default function DynastySim() {
  const { year: yearParam } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const year = DYNASTY_YEARS.includes(yearParam) ? yearParam : null;
  const [loaded, setLoaded] = useState(null); // { base, board }
  const [error, setError] = useState(false);
  // run: { config, data } once started; settings: the setup's choices, kept for Settings.
  const [run, setRun] = useState(null);
  const [settings, setSettings] = useState(null);
  const contentRef = useRef(null);

  useEffect(() => {
    document.documentElement.classList.add("wd-sim-dark");
    return () => document.documentElement.classList.remove("wd-sim-dark");
  }, []);
  useEffect(() => {
    if (!year) return undefined;
    let live = true;
    setLoaded(null); setError(false); setRun(null);
    // 2029: the players in the latest Weekly Mock's pick order first, then the board's.
    Promise.all([loadSimData(year), loadExpandedBoard(year), WEEKLY_ORDER_YEARS.includes(year) ? latestWeeklyOrder(year).catch(() => []) : []])
      .then(([base, board, mockOrder]) => live && setLoaded({ base, board: dynastyBoard(mockOrder.length ? applyBoardOrder(board, mockOrder) : board) }))
      .catch((e) => { console.error("Dynasty sim board error:", e); if (live) setError(true); });
    return () => { live = false; };
  }, [year]);

  if (!year) return <Navigate to={`/draftsim/dynasty/${DYNASTY_YEARS[0]}`} replace />;

  // A run from the setup's choices: the user's slot and the grid's moved picks.
  const start = (s) => {
    const slot = s.slot;
    const data = dynastySimData(loaded.base, loaded.board, { year, teams: s.teams, rounds: s.rounds, snake: s.snake, owners: s.owners });
    setSettings(s);
    setRun({
      data,
      config: {
        mode: "sim", teams: [dynastyTeam(slot)], rounds: s.rounds, baseRounds: s.rounds, speed: DEFAULT_SPEED, chatter: DEFAULT_CHATTER,
        board: "community", seed: newSeed(), cpuTrades: "off", variance: DEFAULT_VARIANCE,
      },
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const backToSetup = () => { setRun(null); window.scrollTo(0, 0); };

  return (
    <SimFrame isMobile={isMobile}>
      {error ? (
        <Column isMobile={isMobile}><div style={{ color: "#fff", textAlign: "center", padding: 60, fontFamily: BODY }}>Couldn&apos;t load the {year} class — try again.</div></Column>
      ) : !loaded ? (
        <Column isMobile={isMobile}><LoadingSpinner label="Loading the class" size={40} minHeight="50vh" /></Column>
      ) : run ? (
        <div data-sim-fs="">
          <LiveSim key={run.config.seed} data={run.data} config={run.config} myGrades={null} isMobile={isMobile} contentRef={contentRef}
            onRerun={() => start(settings)} onSettings={backToSetup} onPickTeam={backToSetup} onDone={() => {}} tabs={null}
            carryYear={null} carrying={false} prepareCarry={async () => null} onBegin={() => {}} />
        </div>
      ) : (
        <Column isMobile={isMobile} contentRef={contentRef}>
          <Setup board={loaded.board} year={year} isMobile={isMobile} initial={settings} onStart={start}
            onYear={(y) => navigate(`/draftsim/dynasty/${y}`)} navigate={navigate} />
        </Column>
      )}
    </SimFrame>
  );
}

// ── Setup ──
function Setup({ board, year, isMobile, initial, onYear, onStart, navigate }) {
  const [teams, setTeams] = useState(initial?.teams || DEFAULT_TEAMS);
  const [rounds, setRounds] = useState(initial?.rounds || DEFAULT_ROUNDS);
  // Linear by default, like most dynasty rookie drafts (user, 2026-11-24).
  const [snake, setSnake] = useState(initial?.snake ?? false);
  const [slotChoice, setSlotChoice] = useState(initial?.slotChoice ?? "random");
  // Random: drawn now (so the grid knows which team is theirs), again on a new team count.
  const [randomSlot, setRandomSlot] = useState(() => initial?.slot || 1 + Math.floor(Math.random() * (initial?.teams || DEFAULT_TEAMS)));
  const cap = maxRoundsFor(board, teams);
  const useRounds = Math.min(rounds, cap);
  const mySlot = slotChoice === "random" ? Math.min(randomSlot, teams) : Math.min(slotChoice, teams);
  // The grid's moved picks ({ [overall]: slot }) — kept while the draft's shape stays the same.
  const [owners, setOwners] = useState(() => initial?.owners || {});
  const shape = `${teams}:${useRounds}:${snake}`;
  const lastShape = useRef(initial ? `${initial.teams}:${initial.rounds}:${initial.snake}` : shape);
  useEffect(() => {
    if (lastShape.current !== shape) { lastShape.current = shape; setOwners({}); }
  }, [shape]);
  const moved = Object.keys(owners).length;
  const counts = DYNASTY_POSITIONS.map((p) => `${board.filter((x) => x.Position === p).length} ${p}`).join(" · ");
  const modes = [
    ["Draft Sim", "The broadcast: on the clock, the desk, trades.", () => navigate("/draftsim")],
    ["Mock Draft", "The sim with no pauses between picks.", () => navigate("/draftsim", { state: { opts: { mode: "mock" } } })],
    ["Dynasty", "Fantasy rookie draft: QB, RB, WR, TE.", null],
  ];
  return (
    <div className="wd-sim-in">
      <div style={{ textAlign: "center", margin: isMobile ? "6px 0 14px" : "14px 0 18px", color: "#fff" }}>
        <div style={{ color: GOLD, fontFamily: FONT, fontSize: 12, letterSpacing: "0.2em" }}>FANTASY FOOTBALL</div>
        <h1 style={{ fontFamily: FONT, fontSize: isMobile ? 28 : 42, lineHeight: 1.05, margin: "6px 0", textTransform: "uppercase" }}>{year} Dynasty Draft Simulator</h1>
        <div style={{ color: "#c9d4e5", fontSize: 14, maxWidth: 620, margin: "0 auto", lineHeight: 1.5, fontFamily: BODY }}>Draft the {year} class&apos;s quarterbacks, running backs, receivers and tight ends, live, against the CPU. Every other team reads the board its own way.</div>
      </div>
      <div style={{ background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, padding: isMobile ? 14 : 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 18 }}>
          {modes.map(([title, note, go]) => (
            <button key={title} onClick={go || undefined} aria-pressed={!go} style={{
              textAlign: "left", borderRadius: 12, padding: isMobile ? "9px 10px" : "12px 16px", cursor: go ? "pointer" : "default", fontFamily: FONT,
              border: `2px solid ${!go ? GOLD : "#1f2b42"}`, background: !go ? "rgba(246,162,29,0.12)" : "#0b1322",
            }}>
              <span style={{ display: "block", color: !go ? GOLD : "#fff", fontWeight: 900, fontSize: isMobile ? 12 : 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>{title}</span>
              <span style={{ display: "block", color: MUTED, fontSize: isMobile ? 10.5 : 12, fontFamily: BODY, marginTop: 2 }}>{note}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 18 }}>
          <Field title="Class" note={`${board.length} players: ${counts}.`}>
            {DYNASTY_YEARS.map((y) => <button key={y} onClick={() => y !== year && onYear(y)} aria-pressed={y === year} style={chip(y === year)}>{y}</button>)}
          </Field>
          <Field title="Teams">
            {TEAM_COUNTS.map((n) => <button key={n} onClick={() => { setTeams(n); setRandomSlot(1 + Math.floor(Math.random() * n)); if (slotChoice !== "random" && slotChoice > n) setSlotChoice("random"); }} aria-pressed={teams === n} style={smallChip(teams === n)}>{n}</button>)}
          </Field>
          <Field title="Rounds" note={cap < 7 ? `The ${year} class fills ${cap} round${cap === 1 ? "" : "s"} for ${teams} teams.` : null}>
            {ROUND_COUNTS.map((r) => {
              const off = r > cap;
              return <button key={r} onClick={() => !off && setRounds(r)} disabled={off} aria-pressed={useRounds === r} style={{ ...smallChip(useRounds === r), opacity: off ? 0.35 : 1, cursor: off ? "not-allowed" : "pointer" }}>{r}</button>;
            })}
          </Field>
          <Field title="Order" note={snake ? `The order reverses every round (1–${teams}, then ${teams}–1).` : "Team 1 picks first every round, like a rookie draft."}>
            <button onClick={() => setSnake(false)} aria-pressed={!snake} style={chip(!snake)}>Linear</button>
            <button onClick={() => setSnake(true)} aria-pressed={snake} style={chip(snake)}>Snake</button>
          </Field>
          <Field title="Your Pick" note={slotChoice === "random" ? `Random: you drew the ${ordinal(mySlot)} pick — you're Team ${mySlot}.` : `You pick ${ordinal(slotChoice)} in round 1 — you're Team ${mySlot}.`}>
            <button onClick={() => setSlotChoice("random")} aria-pressed={slotChoice === "random"} style={smallChip(slotChoice === "random")}>Random</button>
            {Array.from({ length: teams }, (_, i) => i + 1).map((n) => <button key={n} onClick={() => setSlotChoice(n)} aria-pressed={slotChoice === n} style={smallChip(slotChoice === n)}>{n}</button>)}
          </Field>
        </div>
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={label}>Picks</span>
            <span style={{ color: "#9fb0c8", fontSize: 12, fontFamily: BODY }}>
              {moved ? `${moved} pick${moved === 1 ? "" : "s"} moved.` : "Give any pick to any team — yourself included — before the draft."}
            </span>
            {moved > 0 && <button onClick={() => setOwners({})} style={{ ...smallChip(false), marginLeft: "auto" }}>Reset picks</button>}
          </div>
          <PickGrid teams={teams} rounds={useRounds} snake={snake} mySlot={mySlot} owners={owners} isMobile={isMobile}
            onOwner={(overall, slot, original) => setOwners((o) => { const n = { ...o }; if (slot === original) delete n[overall]; else n[overall] = slot; return n; })} />
        </div>
        <button onClick={() => onStart({ teams, rounds: useRounds, snake, slotChoice, slot: mySlot, owners })} className="wd-sim-draft" style={{
          width: "100%", marginTop: 22, border: "none", borderRadius: 999, padding: "14px 18px", cursor: "pointer", fontFamily: FONT, fontWeight: 900,
          fontSize: 14, letterSpacing: "0.06em", background: GOLD, color: "#fff",
        }}>
          START THE {year} DYNASTY DRAFT · {teams} TEAMS · {useRounds} ROUND{useRounds === 1 ? "" : "S"} →
        </button>
      </div>
    </div>
  );
}

// ── The pick grid ──
// Every pick before the draft, one column per round — picks run down each
// column (1.01, 1.02 …), never across. Each pick's team can be changed: to
// the user (Team mySlot) or any CPU team. A moved pick shows where it came
// from ("via 3"); the user's picks are outlined in gold.
function PickGrid({ teams, rounds, snake, mySlot, owners, isMobile, onOwner }) {
  const picks = useMemo(() => draftOrder(teams, rounds, snake), [teams, rounds, snake]);
  const brands = useMemo(() => dynastyBranding(teams), [teams]);
  const colWidth = isMobile ? 132 : 150;
  return (
    <div className="wd-sim-scroll" style={{ overflowX: "auto", paddingBottom: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${rounds}, ${colWidth}px)`, gap: 8, width: "max-content" }}>
        {Array.from({ length: rounds }, (_, r) => (
          <div key={r} style={{ display: "grid", gap: 4, alignContent: "start" }}>
            <div style={{ ...label, textAlign: "center", padding: "2px 0 4px" }}>Round {r + 1}</div>
            {picks.filter((p) => p.round === r + 1).map((p) => {
              const owner = owners[p.overall] || p.slot;
              const b = brands[dynastyTeam(owner)];
              const mine = owner === mySlot;
              return (
                <label key={p.overall} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 8, cursor: "pointer",
                  background: `linear-gradient(90deg, ${b.Color1}cc, #0b1322 85%)`, border: `2px solid ${mine ? GOLD : "#1f2b42"}`,
                }}>
                  <img src={b.Logo1} alt="" style={{ width: 22, height: 22, flexShrink: 0 }} />
                  <span style={{ display: "grid", minWidth: 0, flex: 1 }}>
                    <span style={{ color: "#fff", fontFamily: FONT, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{pickLabel(p)}{owner !== p.slot ? <span style={{ color: "#c9d4e5", fontFamily: BODY, fontWeight: 700 }}> · via {p.slot}</span> : null}</span>
                    <select id={`dynasty-pick-${p.overall}`} aria-label={`Pick ${pickLabel(p)} belongs to`} value={owner} onChange={(e) => onOwner(p.overall, Number(e.target.value), p.slot)}
                      style={{ background: "transparent", color: mine ? GOLD : "#fff", border: "none", fontFamily: FONT, fontSize: 11, padding: 0, cursor: "pointer", width: "100%" }}>
                      {Array.from({ length: teams }, (_, i) => i + 1).map((n) => <option key={n} value={n} style={{ color: "#000" }}>{n === mySlot ? `Team ${n} (You)` : `Team ${n}`}</option>)}
                    </select>
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
