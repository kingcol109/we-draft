// src/components/draftSim/SimBroadcast.jsx
//
// Draft Sim's live screen, dressed as a draft broadcast: the top bar
// (LIVE, round/pick, speed controls), the stage (team on the clock → "the
// pick is in" → the pick card), the user's war room when they're up (best
// available + trade offers), the board / best available / my picks tabs,
// and the analyst feed (SimFeed.jsx).
// The console under the stage: Draft, Draft Board, Suggestions (three
// picks, each with a word from the front office), My Picks, Roster (the
// user's team first) and Trades.
// One anchored screen on every device (DraftSim.jsx sizes it to the
// window): the stage and everything around it never move — only the
// console's tab content scrolls. Phones: Up Next is a slim strip of team
// abbreviations along the stage's bottom, the controls sit right above
// the console. Desktop: the bar on top, the desk down the right side.
// State comes from useDraftSim.js.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { gradeLabel, gradeLook } from "../../utils/communityGrades";
import { openNeeds, currentPick, available, pickValue, pickWorth, pickName, pickByKey, FUTURE_DISCOUNT, SIM_POSITIONS, SPECIALISTS, tradeablePicks, evaluateProposal, CPU_ACCEPT_RATIO, suggestionsFor, rngNext, NEED_KEY_NAMES, needWord } from "../../utils/draftSim/engine";
import { davinSuggestion, otherSchools } from "../../utils/draftSim/analysts";
import { useSchools } from "../DraftArchiveList";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../../utils/coachHistory";
import { textOn, readableOn } from "../../utils/teamColors";
import SimFeed, { Avatar } from "./SimFeed";
import { SPEEDS } from "./useDraftSim";
import { PlayerName } from "./FitName";
import { fetchEspnRoster, fetchDepthOrder, groupRoster } from "../../utils/nflRoster";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const PANEL = { background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, overflow: "hidden" };
const BODY = "Arial, sans-serif";

// Motion: a beat lands in place rather than swapping the stage out —
// labels and numbers flip over where they sit, the pick card turns over,
// one soft light sweep crosses the stage per beat, and the Up Next bar
// slides a slot as each pick comes off the board. Nothing flashes.
export const SIM_CSS = `
  @keyframes wdSimFlip { from { opacity: 0; transform: perspective(600px) rotateX(-70deg); } to { opacity: 1; transform: none; } }
  @keyframes wdSimCardFlip { from { opacity: 0; transform: perspective(900px) rotateY(-75deg) scale(.97); } to { opacity: 1; transform: none; } }
  @keyframes wdSimSweep { from { transform: translateX(-120%) skewX(-18deg); } to { transform: translateX(380%) skewX(-18deg); } }
  @keyframes wdSimEnvelope { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
  @keyframes wdSimGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); } 50% { box-shadow: 0 0 0 5px rgba(255,255,255,0.16); } }
  .wd-sim-flip { animation: wdSimFlip .55s cubic-bezier(.2,.8,.2,1) both; transform-origin: 50% 0; }
  .wd-sim-cardflip { animation: wdSimCardFlip .7s cubic-bezier(.2,.8,.2,1) both; }
  .wd-sim-sweep { position: absolute; top: 0; bottom: 0; left: 0; width: 30%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent); animation: wdSimSweep 1.2s ease-out both; pointer-events: none; }
  .wd-sim-envelope { animation: wdSimEnvelope 1.2s ease-in-out infinite; }
  .wd-sim-cardglow { animation: wdSimGlow 1.2s ease-in-out infinite; }
  @keyframes wdSimPulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
  @keyframes wdSimClock { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes wdSimFade { from { opacity: 0; } to { opacity: 1; } }
  .wd-sim-live-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff3b3b; animation: wdSimPulse 3s ease-in-out infinite; display: inline-block; flex-shrink: 0; }
  .wd-sim-post { animation: wdSimFade .8s ease both; }
  .wd-sim-in { animation: wdSimFade .9s ease both; }
  .wd-sim-row:hover { background: #16213a !important; }
  .wd-sim-draft:hover { filter: brightness(1.1); }
  .wd-sim-pickteam:hover { opacity: 1 !important; }
  .wd-sim-nofooter footer { display: none; }
  /* Phones: a player's name isn't a link (too easy to hit mid-draft) — the
     Draft Board's ↗ box opens his page instead. */
  @media (max-width: 767px) { .wd-sim-plink { pointer-events: none; cursor: default; } }
  html.wd-sim-lock, html.wd-sim-lock body { overflow: hidden; overscroll-behavior: none; }  html.wd-sim-navhide .wd-navbar-wrap { transform: translateY(-100%); transition: transform .25s ease !important; }
  html.wd-sim-navhide.wd-sim-navopen .wd-navbar-wrap { transform: none; }
  html.wd-sim-dark, html.wd-sim-dark body { background: #070d18; }
  html.wd-sim-dark footer { margin-top: 0; padding-top: 40px; }
  html.wd-sim-dark footer .text-gray-500 { color: #8b9bb4; }
  html.wd-sim-dark footer .text-gray-400 { color: #6f7f99; }
  .wd-sim-bar-row::-webkit-scrollbar { display: none; }
  .wd-sim-scroll { scrollbar-width: thin; scrollbar-color: #f6a21d #0b1322; }
  .wd-sim-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
  .wd-sim-scroll::-webkit-scrollbar-track { background: #0b1322; }
  .wd-sim-scroll::-webkit-scrollbar-thumb { background: linear-gradient(#f6a21d, #0055a5); border-radius: 999px; border: 2px solid #0b1322; }
  .wd-sim-scroll::-webkit-scrollbar-thumb:hover { background: #f6a21d; }
  @media (prefers-reduced-motion: reduce) {
    .wd-sim-live-dot, .wd-sim-post, .wd-sim-in, .wd-sim-flip, .wd-sim-cardflip, .wd-sim-envelope, .wd-sim-cardglow { animation: none !important; }
    .wd-sim-sweep { display: none; }
  }
`;

const brandOf = (data, team) => data.branding[team] || {};

// Prospects' school logos for dark panels and team colors — LogoBlack,
// else LogoDark, else Logo1, already resolved when the sim loads (data.js).
const logoOf = (p) => p.logoDark || p.logo;
const colors = (b) => ({ c1: b.Color1 || BLUE, c2: b.Color2 || GOLD });

function TeamLogo({ brand, team, size, dark = true }) {
  const src = dark ? brand.LogoDark || brand.Logo1 : brand.Logo1 || brand.LogoDark;
  return src
    ? <img src={src} alt={team} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
    : <span style={{ width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: size * 0.3, flexShrink: 0 }}>{team}</span>;
}

// ── Top bar ──
const BROADCAST_SKIPPABLE = ["clock", "trade", "pickIn", "reveal"];
function BroadcastBar({ s, data, isMobile, onSettings }) {
  const pick = currentPick(s.sim);
  const live = s.phase !== "done";
  // Mobile, once the draft's on: just the current speed with an arrow that
  // opens the others (the full row on the starting screen).
  const [speedsOpen, setSpeedsOpen] = useState(false);
  const collapsed = isMobile && s.phase !== "intro" && !speedsOpen;
  const speeds = collapsed ? [[s.speed, SPEEDS[s.speed]]] : Object.entries(SPEEDS);
  const chooseSpeed = (k) => {
    if (collapsed) { setSpeedsOpen(true); return; }
    s.setSpeed(k);
    setSpeedsOpen(false);
  };
  // Mock Draft mode, the user on the clock: the CPU makes this pick, or
  // the rest of the round.
  // Undo steps back one of their picks, as far as the first.
  const mockSims = s.quick && (
    <>
      {s.phase === "user" && (
        <>
          <button onClick={s.simPick} style={{ ...barBtn, background: GOLD, color: "#fff" }} title="The CPU makes this pick">Sim Pick ⏭</button>
          <button onClick={s.simRound} style={barBtn} title="The CPU makes every pick left this round">Sim Round ⏩</button>
        </>
      )}
      {s.phase !== "intro" && <button onClick={s.undo} disabled={!s.canUndo} style={{ ...barBtn, opacity: s.canUndo ? 1 : 0.4, cursor: s.canUndo ? "pointer" : "default" }} title="Take back your last pick">↶ Undo</button>}
    </>
  );
  const canSkip = s.phase === "reveal" || (s.speed !== "instant" && !s.skipToUser && BROADCAST_SKIPPABLE.includes(s.phase));
  // Skip To ▼ opens its options in place, like the speeds: the next pick,
  // the user's next pick, the end of the draft. All three are always there
  // (dimmed when they don't apply right now). On the user's own clock the
  // CPU makes their pick: Next Pick shows it, My Next Pick sims on to the
  // one after.
  // It stays open until the user closes it. End asks first: it turns into
  // "Are You Sure?", and anything else (or closing) takes that back.
  const [skipOpen, setSkipOpen] = useState(false);
  const [endSure, setEndSure] = useState(false);
  const canEnd = !s.skipToUser;
  const skips = [
    s.phase === "user"
      ? ["Next Pick", true, () => { setEndSure(false); s.simPick(); }, "The CPU makes your pick"]
      : ["Next Pick", canSkip, () => { setEndSure(false); s.skip(); }, "Make the pick now"],
    s.phase === "user"
      ? ["My Next Pick", s.userPicksAfter, () => { setEndSure(false); s.simToMyPick(); }, s.userPicksAfter ? "The CPU makes this pick, then sims to your next one" : "This is your last pick"]
      : ["My Next Pick", s.userPicksLeft && s.phase !== "simming", () => { setEndSure(false); s.simToMyPick(); }, s.userPicksLeft ? "Sim every pick up to your next one" : "You have no picks left"],
    endSure && canEnd
      ? ["Are You Sure?", true, () => { setEndSure(false); s.simToEnd(); }, "Click again to sim the rest of the draft", { background: "#c8102e" }]
      : ["End", canEnd, () => setEndSure(true), s.userPicksLeft ? "Sim the rest of the draft — the CPU makes your picks too" : "Sim the rest of the draft"],
  ];
  const skipPill = { border: "none", borderRadius: 999, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap", background: "transparent", color: "#fff" };
  const skipMenu = !["intro", "done"].includes(s.phase) && (
    <div role="group" aria-label="Skip" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, background: "#121c2f", borderRadius: 999, padding: 3 }}>
      <button onClick={() => { setSkipOpen(!skipOpen); setEndSure(false); }} aria-expanded={skipOpen} style={{ ...skipPill, background: GOLD, color: "#fff" }}>
        Skip To<span aria-hidden="true" style={{ marginLeft: 5, fontSize: 9 }}>{skipOpen ? "◀" : "▼"}</span>
      </button>
      {skipOpen && skips.map(([label, on, fn, title, look]) => (
        <button key={label} onClick={fn} disabled={!on} title={title} style={{ ...skipPill, ...look, ...(on ? null : { opacity: 0.35, cursor: "default" }) }}>{label}</button>
      ))}
    </div>
  );
  // Mock Draft mode has no speeds — CPU picks are instant.
  const controls = live && (
    <>
      {!s.quick && <div role="group" aria-label="Speed" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, background: "#121c2f", borderRadius: 999, padding: 3 }}>
        {speeds.map(([k, v]) => (
          <button key={k} onClick={() => chooseSpeed(k)} aria-pressed={s.speed === k} aria-expanded={isMobile && s.phase !== "intro" ? !collapsed : undefined} style={{
            border: "none", borderRadius: 999, padding: isMobile ? "5px 9px" : "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap",
            background: s.speed === k ? "#fff" : "transparent", color: s.speed === k ? "#0b1220" : "#9fb0c8",
          }}>{v.label}{collapsed && <span aria-hidden="true" style={{ marginLeft: 5, fontSize: 9 }}>▼</span>}</button>
        ))}
        {isMobile && s.phase !== "intro" && !collapsed && (
          <button onClick={() => setSpeedsOpen(false)} aria-label="Close speeds" style={{ border: "none", background: "transparent", color: "#9fb0c8", padding: "5px 8px", cursor: "pointer", fontSize: 9, fontFamily: "inherit" }}>◀</button>
        )}
      </div>}
      {canSkip && <button onClick={() => s.setPaused(!s.paused)} style={barBtn}>{s.paused ? "▶ Resume" : "❚❚ Pause"}</button>}
      {skipMenu}
      {mockSims}
      {onSettings && <button onClick={onSettings} style={barBtn}>Settings</button>}
    </>
  );
  // Mobile: just the controls, one row right above the console's tabs (the
  // stage says who's up) — a fixed height that never wraps; the buttons
  // scroll sideways if they run long.
  if (isMobile) {
    if (!controls) return null;
    return (
      // Scrolls sideways only — overflow-x alone would let it scroll up and
      // down too, by the pixel or two the buttons stand taller.
      <div className="wd-sim-bar-row" style={{
        display: "flex", alignItems: "center", gap: 6, height: 42, flexShrink: 0, boxSizing: "border-box", padding: "0 8px", whiteSpace: "nowrap", minWidth: 0,
        overflowX: "auto", overflowY: "hidden", overscrollBehaviorX: "contain", scrollbarWidth: "none",
        background: "#070d18", borderRadius: 12, border: "1px solid #1f2b42", margin: "6px 0",
      }}>{controls}</div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 14, flexWrap: "wrap", padding: isMobile ? "10px 12px" : "10px 16px", background: "#070d18", borderRadius: 14, border: "1px solid #1f2b42", marginBottom: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#c8102e", color: "#fff", borderRadius: 6, padding: "3px 9px", fontWeight: 900, fontSize: 11, letterSpacing: "0.14em" }}>
        <span className="wd-sim-live-dot" style={{ background: "#fff" }} /> LIVE
      </span>
      <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 13 : 15, letterSpacing: "0.08em" }}>{data.year} NFL DRAFT SIM</span>
      {pick && live && s.phase !== "intro" && (
        <span style={{ color: GOLD, fontWeight: 900, fontSize: 12, letterSpacing: "0.1em" }}>
          RD {pick.round} · PICK {pick.inRound} · NO. {pick.overall}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {live && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {!s.quick && (
            <div role="group" aria-label="Speed" style={{ display: "inline-flex", background: "#121c2f", borderRadius: 999, padding: 3 }}>
              {Object.entries(SPEEDS).map(([k, v]) => (
                <button key={k} onClick={() => s.setSpeed(k)} aria-pressed={s.speed === k} style={{
                  border: "none", borderRadius: 999, padding: isMobile ? "5px 9px" : "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900,
                  background: s.speed === k ? "#fff" : "transparent", color: s.speed === k ? "#0b1220" : "#9fb0c8",
                }}>{v.label}</button>
              ))}
            </div>
          )}
          {canSkip && <button onClick={() => s.setPaused(!s.paused)} style={barBtn}>{s.paused ? "▶ Resume" : "❚❚ Pause"}</button>}
          {skipMenu}
          {mockSims}
          {onSettings && <button onClick={onSettings} style={barBtn}>Settings</button>}
        </div>
      )}
    </div>
  );
}
const barBtn = { border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", background: "#1a2438", color: "#fff", whiteSpace: "nowrap", flexShrink: 0 };

// ── Stage ──
// One persistent frame for every stage state. Its colors cross-fade from
// team to team and only the content inside fades in — swapping whole cards
// let the dark page blink through between them.
const STAGE_FADE = "background-color 1.2s ease, color 1.2s ease";
const SECOND_COLOR_MASK = "linear-gradient(115deg, transparent 48%, #000 135%)";

const teamLook = (brand) => {
  const { c1, c2 } = colors(brand);
  return { c1, c2, ink: textOn(c1, c2), wordmark: brand.WordmarkDark || brand.Wordmark || null };
};
const NEUTRAL_LOOK = { c1: "#0d2f5c", c2: BLUE, ink: "#fff", wordmark: null };
const SIMMING_LOOK = { c1: "#0b1630", c2: "#12305c", ink: "#fff", wordmark: null };
const TRADE_LOOK = { c1: "#5a0b17", c2: "#c8102e", ink: "#fff", wordmark: null };

// One fixed height for every phase (clock, pick is in, the pick card,
// trades…), so the stage never resizes and nothing below it jumps.
const STAGE_HEIGHT = (isMobile) => (isMobile ? 290 : 260);
// Phones: Up Next's strip along the stage's bottom (UpNextStrip).
const STRIP_HEIGHT = 26;

// strip: a row under the footer, the stage that much taller.
function StageFrame({ look, isMobile, footer, strip, beat, children }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, height: STAGE_HEIGHT(isMobile) + (strip ? STRIP_HEIGHT : 0), flexShrink: 0, display: "flex", flexDirection: "column", backgroundColor: look.c1, color: look.ink, transition: STAGE_FADE }}>
      {/* The team's second color sweeping in from the right. */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundColor: look.c2, WebkitMaskImage: SECOND_COLOR_MASK, maskImage: SECOND_COLOR_MASK, transition: STAGE_FADE, pointerEvents: "none" }} />
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 22px)", pointerEvents: "none" }} />
      {/* The wordmark, right side and vertically centered. The opacity sits
          on the wrapper — the image's fade-in animation ends at opacity 1 and
          would override it. */}
      {look.wordmark && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: 0.25, pointerEvents: "none" }}>
          <img key={look.wordmark} className="wd-sim-in" src={look.wordmark} alt="" style={{
            position: "absolute", right: "-4%", top: "50%", transform: "translateY(-50%)", height: "140%", maxWidth: "72%",
            objectFit: "contain", objectPosition: "right center",
          }} />
        </div>
      )}
      {/* One light sweep across the stage per beat. */}
      {beat && <div key={beat} aria-hidden="true" className="wd-sim-sweep" />}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center" }}>{children}</div>
      {footer}
      {strip}
    </div>
  );
}

// The pick-is-in icon: an envelope with the card inside.
const PickInIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
    <rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M3.5 7l8.5 6 8.5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

const tag = (isMobile) => ({ display: "inline-block", background: "rgba(0,0,0,0.3)", color: "#fff", borderRadius: 6, padding: "3px 10px", fontWeight: 900, fontSize: isMobile ? 11 : 13, letterSpacing: "0.2em" });
const bigName = (isMobile) => ({ fontSize: isMobile ? 28 : 52, fontWeight: 900, lineHeight: 1, textTransform: "uppercase", margin: "8px 0 6px", overflowWrap: "anywhere" });
const pad = (isMobile) => ({ display: "flex", alignItems: "center", gap: isMobile ? 14 : 26, padding: isMobile ? "18px 16px" : "26px 30px", width: "100%", boxSizing: "border-box" });

// The clock, filling left to right in the team's own accent color. Always
// there under the pick stage (empty on the user's clock and the pick card)
// so the stage's content area never changes height.
function ClockBar({ s, pick, look, running }) {
  return (
    <div style={{ position: "relative", height: 6, background: "rgba(0,0,0,0.28)" }}>
      {running && (
        <div key={`bar-${pick.overall}-${pick.owner}-${s.speed}`} style={{
          height: "100%", background: look.ink, opacity: 0.85, transformOrigin: "left", transition: "background-color 1.2s ease",
          ...(s.phase === "pickIn" ? {} : { animation: `wdSimClock ${s.timing.clock}ms linear forwards`, animationPlayState: s.paused ? "paused" : "running" }),
        }} />
      )}
    </div>
  );
}

// One line of text shrunk only as far as it takes to fit its box.
function ShrinkText({ text, max, min, style }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.fontSize = `${max}px`;
      const ratio = el.clientWidth / Math.max(1, el.scrollWidth);
      const next = ratio < 1 ? Math.max(min, Math.floor(max * ratio)) : max;
      el.style.fontSize = `${next}px`;
      setSize(next);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement || el);
    return () => ro.disconnect();
  }, [text, max, min]);
  return <div ref={ref} style={{ ...style, fontSize: size, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</div>;
}

// ── The pick stage: one persistent layout from "on the clock" through "the
// pick is in" to the pick itself, and on to the next team. A beat only
// changes what changed — the logo holds its size and spot (the next
// team's fades in where the last one was), the label, name and numbers
// flip over in place, and the card on the right turns over to show the
// pick. ──
const LOGO_SIZE = (isMobile) => (isMobile ? 76 : 132);

function StageLogo({ brand, team, isMobile }) {
  const size = LOGO_SIZE(isMobile);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div key={team} className="wd-sim-in" style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.35))" }}>
        <TeamLogo brand={brand} team={team} size={size} />
      </div>
    </div>
  );
}

function StageTag({ mode, isUser, isMobile }) {
  const [k, body] = mode === "pickIn"
    ? ["in", <><PickInIcon size={isMobile ? 15 : 18} /> THE PICK IS IN</>]
    : mode === "reveal"
      ? ["sel", "OFFICIAL PICK"]
      : ["clock", isUser ? "YOU'RE ON THE CLOCK" : "ON THE CLOCK"];
  return (
    <div style={{ height: isMobile ? 24 : 28, display: "flex", alignItems: "center" }}>
      <span key={k} className="wd-sim-flip" style={{ ...tag(isMobile), display: "inline-flex", alignItems: "center", gap: 8, background: mode === "pickIn" ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.3)" }}>{body}</span>
    </div>
  );
}

function PickBox({ label, value, isMobile, solid }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minWidth: isMobile ? 48 : 66,
      padding: isMobile ? "3px 8px" : "6px 12px", borderRadius: 10, overflow: "hidden",
      background: solid ? "#fff" : "rgba(0,0,0,0.32)", color: solid || "#fff", boxShadow: solid ? "0 6px 18px rgba(0,0,0,0.25)" : "none",
      transition: "color 1.2s ease",
    }}>
      <span style={{ fontSize: isMobile ? 9 : 10, fontWeight: 900, letterSpacing: "0.18em", opacity: solid ? 0.8 : 0.75 }}>{label}</span>
      <span key={String(value)} className="wd-sim-flip" style={{ display: "block", fontSize: isMobile ? 20 : 34, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

// Counts the clock down, frozen while paused; restarts when it remounts.
function useCountdown(ms, paused) {
  const [left, setLeft] = useState(ms);
  const state = useRef({ left: ms, last: 0 });
  useEffect(() => {
    if (paused) return undefined;
    state.current.last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      state.current.left = Math.max(0, state.current.left - (now - state.current.last));
      state.current.last = now;
      setLeft(state.current.left);
    }, 100);
    return () => clearInterval(t);
  }, [paused]);
  return left;
}

const cardLabel = { fontSize: 10, fontWeight: 900, letterSpacing: "0.18em", opacity: 0.75 };

// The team's remaining picks this draft, current one first.
function TeamPicks({ s, team, isMobile }) {
  const left = s.sim.picks.slice(s.sim.idx).filter((p) => p.owner === team && !p.future).slice(0, isMobile ? 4 : 6);
  if (!left.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      <span style={cardLabel}>PICKS</span>
      {left.map((p, i) => (
        <span key={p.overall} style={{ fontSize: 11, fontWeight: 900, padding: "2px 7px", borderRadius: 999, fontVariantNumeric: "tabular-nums", background: i === 0 ? "#fff" : "rgba(255,255,255,0.12)", color: i === 0 ? "#0b1220" : "#fff" }}>{p.overall}</span>
      ))}
    </div>
  );
}

// Mock Draft mode: the team's top three open needs, for the Your Pick card.
function TopNeeds({ s, team, isMobile }) {
  const needs = openNeeds(s.sim, team).slice(0, 3);
  if (!needs.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", margin: isMobile ? "0 0 8px" : "0 0 10px" }}>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.8 }}>TOP NEEDS</span>
      {needs.map((n) => (
        <span key={n.key} title={n.label} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 900 }}>{NEED_KEY_NAMES[n.key] || n.key}</span>
      ))}
    </div>
  );
}

function ClockFace({ s, team, isMobile, isUser }) {
  const left = useCountdown(s.timing.clock, s.paused);
  const secs = Math.ceil(left / 1000);
  if (isUser) {
    // Mobile: "YOUR PICK" big across the card.
    if (isMobile) {
      return (
        <>
          <ShrinkText text="YOUR PICK" max={52} min={30} style={{ fontWeight: 900, lineHeight: 1, color: GOLD }} />
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: BODY, opacity: 0.9, margin: "6px 0 8px" }}>Draft from the board below.</div>
          {s.quick && <TopNeeds s={s} team={team} isMobile />}
          <TeamPicks s={s} team={team} isMobile />
        </>
      );
    }
    return (
      <>
        <span style={cardLabel}>ON THE CLOCK</span>
        <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, margin: "6px 0 10px", color: GOLD }}>YOUR PICK</div>
        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: BODY, opacity: 0.85, marginBottom: 10 }}>Draft from the board below.</div>
        {s.quick && <TopNeeds s={s} team={team} />}
        <TeamPicks s={s} team={team} isMobile={isMobile} />
      </>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "row" : "column", alignItems: isMobile ? "center" : "flex-start", gap: isMobile ? 16 : 0 }}>
      <div>
        <span style={cardLabel}>{s.paused ? "PAUSED" : "TIME LEFT"}</span>
        <div style={{ fontSize: isMobile ? 44 : 72, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", margin: isMobile ? "2px 0 0" : "4px 0 10px", color: secs <= 3 && !s.paused ? "#ffd2d2" : "#fff", transition: "color .3s ease" }}>
          0:{String(secs).padStart(2, "0")}
        </div>
      </div>
      <TeamPicks s={s} team={team} isMobile={isMobile} />
    </div>
  );
}

function PickInFace({ pick, isMobile }) {
  // Mobile: the envelope beside the words, sized to the card's short height.
  if (isMobile) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, height: "100%" }}>
        <span className="wd-sim-envelope" style={{ display: "inline-flex" }}><PickInIcon size={52} /></span>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: "0.1em", lineHeight: 1.05 }}>THE PICK IS IN</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: BODY, opacity: 0.85, marginTop: 4 }}>No. {pick.overall} · announcing the pick…</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: isMobile ? 4 : 8, height: "100%" }}>
      <span className="wd-sim-envelope" style={{ display: "inline-flex" }}><PickInIcon size={isMobile ? 32 : 54} /></span>
      <div style={{ fontSize: isMobile ? 15 : 20, fontWeight: 900, letterSpacing: "0.14em" }}>THE PICK IS IN</div>
      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: BODY, opacity: 0.8 }}>No. {pick.overall} · announcing the pick…</div>
    </div>
  );
}

function RevealFace({ event, data, isMobile, ink }) {
  const p = event.prospect;
  const brand = brandOf(data, event.team);
  const label = gradeLabel(p.avg);
  const schoolLogo = p.logo || logoOf(p);
  // Off the board's order only — a pick right on it needs no note.
  const valueText = event.value === 0 ? null : event.value > 0 ? `+${event.value} value` : `${event.value} reach`;
  const gradeName = p.mine ? "My Grade" : "Comm. Grade";
  if (isMobile) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: "100%", minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <span style={{ ...cardLabel, color: ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>THE {(brand.Team || event.team).toUpperCase()} SELECT</span>
          <div style={{ fontSize: 15, fontWeight: 900, lineHeight: 1.1, marginTop: 4, color: "#33415a", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.First}</div>
          <ShrinkText text={p.Last} max={34} min={18} style={{ flexShrink: 0, fontWeight: 900, lineHeight: 1.02, textTransform: "uppercase", color: ink, margin: "0 0 6px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: BODY, minWidth: 0 }}>
            <span style={{ background: ink, color: "#fff", borderRadius: 6, padding: "2px 8px", fontWeight: 900, fontSize: 12, flexShrink: 0 }}>{p.Position}</span>
            <span style={{ fontWeight: 800, fontSize: 13, color: "#0f1b2d", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.School}</span>
          </div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            {label && <GradeBadge label={label} small />}
            <span style={{ fontSize: 11, fontWeight: 800, fontFamily: BODY, color: "#5b6b84", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Board #{p.rank}{valueText ? ` (${valueText})` : ""}</span>
          </div>
        </div>
        {schoolLogo && <img src={schoolLogo} alt="" style={{ width: 92, height: 92, objectFit: "contain", flexShrink: 0, marginRight: -4 }} />}
      </div>
    );
  }
  return (
    <>
      <span style={{ ...cardLabel, color: ink, flexShrink: 0 }}>THE {(brand.Team || event.team).toUpperCase()} SELECT</span>
      {!isMobile && <div style={{ flexShrink: 0, fontSize: 18, fontWeight: 900, lineHeight: 1.1, marginTop: 6, color: "#33415a", textTransform: "uppercase" }}>{p.First}</div>}
      <ShrinkText text={isMobile ? `${p.First} ${p.Last}` : p.Last} max={isMobile ? 26 : 38} min={isMobile ? 15 : 20}
        style={{ flexShrink: 0, fontWeight: 900, lineHeight: 1.02, textTransform: "uppercase", color: ink, margin: isMobile ? "3px 0 5px" : "0 0 8px" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: BODY, minWidth: 0, flexShrink: 0 }}>
        <span style={{ background: ink, color: "#fff", borderRadius: 6, padding: "2px 8px", fontWeight: 900, fontSize: 12, flexShrink: 0 }}>{p.Position}</span>
        {schoolLogo && <img src={schoolLogo} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />}
        <span style={{ fontWeight: 800, fontSize: isMobile ? 12 : 14, color: "#0f1b2d", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.School}</span>
      </div>
      {isMobile ? (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 7 }}>
          {label && <GradeBadge label={label} small />}
          <span style={{ fontSize: 11, fontWeight: 800, fontFamily: BODY, color: "#5b6b84" }}>Board #{p.rank}{valueText ? ` (${valueText})` : ""}</span>
        </div>
      ) : (
        // One row, always — the card's a fixed height.
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", marginTop: 10, minWidth: 0, flexShrink: 0 }}>
          <Stat label="Board" value={`#${p.rank}`} sub={valueText} />
          {label && (
            <span style={{ display: "flex", alignItems: "center", gap: 8, background: "#f1f4f8", borderRadius: 10, padding: "5px 10px 5px 5px", minWidth: 0 }}>
              <GradeBadge label={label} />
              <span style={{ minWidth: 0, fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", color: "#5b6b84", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {gradeName.toUpperCase()}<br /><span style={{ fontSize: 11, color: "#0f1b2d", letterSpacing: "0.04em" }}>{label.toUpperCase()}</span>
              </span>
            </span>
          )}
        </div>
      )}
    </>
  );
}

// A community (or My Board) grade as player pages brand it: the round in
// its color, EARLY / MIDDLE / LATE over a 1st, ROUND under it.
function GradeBadge({ label, small = false }) {
  const { short, bg, border, qualifier } = gradeLook(label);
  const tiny = { fontWeight: 900, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1 };
  if (small) {
    return (
      <span title={label} style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, background: bg, border: `2px solid ${border}`, borderRadius: 6, padding: "1px 6px", color: "#fff" }}>
        {qualifier && <span style={{ ...tiny, fontSize: 8 }}>{qualifier}</span>}
        <span style={{ fontSize: 12, fontWeight: 900, lineHeight: 1.2 }}>{short}</span>
        <span style={{ ...tiny, fontSize: 8 }}>RD</span>
      </span>
    );
  }
  return (
    <span title={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, flexShrink: 0, minWidth: 50, background: bg, border: `3px solid ${border}`, borderRadius: 6, padding: "4px 7px" }}>
      {qualifier && <span style={{ ...tiny, fontSize: 7 }}>{qualifier}</span>}
      <span style={{ fontSize: 20, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>{short}</span>
      <span style={{ ...tiny, fontSize: 7, color: "rgba(255,255,255,0.8)" }}>ROUND</span>
    </span>
  );
}

function Stat({ label, value, sub }) {
  return (
    <span style={{ background: "#f1f4f8", color: "#0f1b2d", borderRadius: 10, padding: "5px 10px", minWidth: 64, flexShrink: 0, whiteSpace: "nowrap" }}>
      <span style={{ display: "block", fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", color: "#5b6b84" }}>{label.toUpperCase()}</span>
      <span style={{ display: "block", fontSize: 16, fontWeight: 900, lineHeight: 1.1 }}>{value}</span>
      {sub && <span style={{ display: "block", fontSize: 10, fontWeight: 800, color: "#5b6b84", fontFamily: BODY }}>{sub}</span>}
    </span>
  );
}

// The right-hand card: glass while the team's on the clock, turning over
// to white for the pick.
function StageCard({ mode, s, data, isMobile, pick, team, look, event }) {
  const reveal = mode === "reveal";
  const ink = readableOn(look.c1, "#ffffff");
  const faceKey = mode === "reveal" ? `reveal-${pick.overall}` : mode === "pickIn" ? `in-${pick.overall}` : `clock-${pick.overall}-${s.speed}`;
  let face;
  if (reveal) face = <RevealFace event={event} data={data} isMobile={isMobile} ink={ink} />;
  else if (mode === "pickIn") face = <PickInFace pick={pick} isMobile={isMobile} />;
  else face = <ClockFace s={s} team={team} isMobile={isMobile} isUser={mode === "user"} />;
  return (
    <div className={mode === "pickIn" ? "wd-sim-cardglow" : undefined} style={{
      position: "relative", flex: isMobile ? 1 : "0 0 40%", maxWidth: isMobile ? "none" : 400, minHeight: 0,
      borderRadius: 14, overflow: "hidden",
      background: reveal ? "#fff" : "rgba(0,0,0,0.3)",
      border: `1px solid ${reveal ? "#fff" : "rgba(255,255,255,0.18)"}`,
      boxShadow: reveal ? "0 14px 34px rgba(0,0,0,0.38)" : "none",
      color: "#fff",
      transition: "background-color .5s ease, border-color .5s ease, box-shadow .5s ease",
    }}>
      <div key={faceKey} className={reveal ? "wd-sim-cardflip" : "wd-sim-flip"} style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center",
        padding: isMobile ? "10px 14px" : "16px 20px", boxSizing: "border-box",
      }}>
        {face}
      </div>
    </div>
  );
}

function PickStage({ s, data, isMobile, mode, pick, team, look, event, trade }) {
  const brand = brandOf(data, team);
  const isUser = s.sim.userTeams.includes(team);
  const { c1 } = colors(brand);
  const info = (
    <div style={{ minWidth: 0, flex: 1 }}>
      <StageTag mode={mode} isUser={isUser} isMobile={isMobile} />
      <div style={{ margin: isMobile ? "4px 0 6px" : "8px 0 10px" }}>
        <div key={team} className="wd-sim-flip">
          <ShrinkText text={brand.Team || team} max={isMobile ? 30 : 48} min={isMobile ? 16 : 22} style={{ fontWeight: 900, lineHeight: 1.05, textTransform: "uppercase" }} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: isMobile ? 6 : 8, flexWrap: "wrap" }}>
        <PickBox label="ROUND" value={pick.round} isMobile={isMobile} />
        <PickBox label="PICK" value={pick.inRound} isMobile={isMobile} solid={c1} />
        <PickBox label="OVERALL" value={pick.overall} isMobile={isMobile} />
        {/* A trade up shows where the pick came from, beside the numbers —
            not over the player's name. */}
        {trade ? <PickBox label="TRADED UP" value={trade.from} isMobile={isMobile} />
          : pick.via && <PickBox label="VIA" value={pick.via} isMobile={isMobile} />}
      </div>
    </div>
  );
  const card = <StageCard mode={mode} s={s} data={data} isMobile={isMobile} pick={pick} team={team} look={look} event={event} />;
  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "stretch", gap: isMobile ? 12 : 26, padding: isMobile ? "14px" : "22px 26px", height: "100%", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 14 : 26, flex: isMobile ? "0 0 auto" : 1, minWidth: 0 }}>
        <StageLogo brand={brand} team={team} isMobile={isMobile} />
        {info}
      </div>
      {card}
    </div>
  );
}

// The NFL's divisions, for naming a group the user drafts as.
const DIVISIONS = {
  "AFC East": ["BUF", "MIA", "NE", "NYJ"], "AFC North": ["BAL", "CIN", "CLE", "PIT"],
  "AFC South": ["HOU", "IND", "JAX", "TEN"], "AFC West": ["DEN", "KC", "LV", "LAC"],
  "NFC East": ["DAL", "NYG", "PHI", "WAS"], "NFC North": ["CHI", "DET", "GB", "MIN"],
  "NFC South": ["ATL", "CAR", "NO", "TB"], "NFC West": ["ARI", "LAR", "SF", "SEA"],
};
const andList = (xs) => (xs.length < 3 ? xs.join(" & ") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`);

// The intro's headline for the teams the user drafts as → { tag, title }:
// one team or two or three by name, a conference or whole divisions by
// name, all 32 as the league, anything else as a count.
export function introHeadline(teams, nickname, year) {
  if (!teams.length) return { tag: "THE DRAFT IS ABOUT TO BEGIN", title: `${year} NFL Draft` };
  if (teams.length >= 32) return { tag: "YOU'RE RUNNING THE WHOLE LEAGUE", title: "All 32 Teams" };
  const has = (list) => list.every((t) => teams.includes(t));
  const divs = Object.entries(DIVISIONS).filter(([, list]) => has(list));
  const covered = divs.flatMap(([, list]) => list);
  if (teams.length > 3 && covered.length === teams.length) {
    const confs = ["AFC", "NFC"].filter((c) => divs.filter(([d]) => d.startsWith(c)).length === 4);
    if (confs.length === 1 && teams.length === 16) return { tag: "DRAFTING FOR THE", title: confs[0] };
    if (divs.length <= 2) return { tag: "DRAFTING FOR THE", title: andList(divs.map(([d]) => d)) };
  }
  if (teams.length <= 3) return { tag: "DRAFTING AS THE", title: andList(teams.map(nickname)) };
  return { tag: "DRAFTING FOR", title: `${teams.length} Teams` };
}
// Logo size for a group of n on the intro, smaller the more there are.
const groupLogo = (n, isMobile) => (n <= 3 ? (isMobile ? 44 : 56) : n <= 8 ? (isMobile ? 34 : 44) : n <= 16 ? (isMobile ? 28 : 34) : (isMobile ? 24 : 28));

// Before the first pick: who the user is drafting as.
function IntroContent({ s, data, isMobile, onPickTeam }) {
  const teams = s.sim.userTeams;
  const one = teams.length === 1 ? teams[0] : null;
  const all = teams.length >= 32;
  const head = introHeadline(teams, (t) => brandOf(data, t).Team || t, data.year);
  // Several teams: all their logos, in pick order of their first pick.
  const firstOf = (t) => s.sim.picks.find((p) => p.owner === t)?.overall ?? Infinity;
  const ordered = [...teams].sort((a, b) => firstOf(a) - firstOf(b));
  const logoSize = groupLogo(teams.length, isMobile);
  const logoGrid = (maxWidth) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(teams.length, all ? 8 : teams.length <= 3 ? 3 : teams.length <= 8 ? 4 : 6)}, ${logoSize}px)`, gap: all ? 4 : 6, justifyContent: "center", maxWidth }}>
      {ordered.map((t) => <TeamLogo key={t} brand={brandOf(data, t)} team={t} size={logoSize} />)}
    </div>
  );
  const first = s.sim.picks.find((p) => teams.includes(p.owner));
  // The team's second color (site gold when drafting as several or none).
  const buttonColor = (one && brandOf(data, one).Color2) || GOLD;
  const startButton = (
    <button onClick={s.start} className="wd-sim-draft" style={{ marginTop: isMobile ? 0 : 14, border: "none", borderRadius: 999, padding: isMobile ? "11px 26px" : "12px 26px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: isMobile ? 15 : 16, letterSpacing: "0.1em", background: buttonColor, color: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,0.25)" }}>
      START THE DRAFT ▶
    </button>
  );
  const firstLine = !first ? "All 32 teams on the CPU."
    : all ? "Every pick is yours — you're on the clock from No. 1."
      : teams.length > 1 ? `First up: No. ${first.overall} (Round ${first.round}), the ${brandOf(data, first.owner).Team || first.owner}.`
        : `Your first pick: No. ${first.overall} (Round ${first.round}).`;
  // Mobile: the team's logo oversized behind everything at 30% (contain, so
  // a wide one like the Jets' runs the full width), the team name big over
  // it, and the start button centered along the bottom of the stage.
  if (isMobile) {
    const bg = one && (brandOf(data, one).LogoDark || brandOf(data, one).Logo1);
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "16px 14px 18px", boxSizing: "border-box" }}>
        {bg && (
          // Fills the stage, then grows from its center — dead center however
          // wide or tall the logo is.
          <img aria-hidden="true" alt="" src={bg} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", objectPosition: "center", transform: "scale(1.25)", transformOrigin: "center", opacity: 0.3, pointerEvents: "none" }} />
        )}
        {onPickTeam && (
          <button onClick={onPickTeam} className="wd-sim-pickteam" style={{ position: "absolute", top: 10, right: 12, zIndex: 1, border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: BODY, fontWeight: 700, fontSize: 12, color: "inherit", opacity: 0.85, textDecoration: "underline", textUnderlineOffset: 3 }}>
            {teams.length ? "Pick another team" : "Pick a team"}
          </button>
        )}
        <div style={{ position: "relative", flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {teams.length > 1 && logoGrid("100%")}
          <div style={{ ...tag(isMobile), fontSize: all ? 12 : 16, padding: "5px 14px", letterSpacing: "0.22em" }}>{head.tag}</div>
          <ShrinkText text={head.title} max={teams.length > 1 ? 52 : 96} min={20}
            style={{ maxWidth: "100%", fontWeight: 900, lineHeight: 1, textTransform: "uppercase", textShadow: "0 3px 14px rgba(0,0,0,0.35)" }} />
          {teams.length > 1 && <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.85, fontFamily: BODY }}>{firstLine}</div>}
        </div>
        <div style={{ position: "relative" }}>{startButton}</div>
      </div>
    );
  }
  return (
    <div style={{ ...pad(isMobile), flexWrap: "wrap" }}>
      {one ? <TeamLogo brand={brandOf(data, one)} team={one} size={LOGO_SIZE(isMobile)} /> : teams.length > 1 && <div style={{ flexShrink: 0 }}>{logoGrid(all ? 300 : 280)}</div>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={tag(isMobile)}>{head.tag}</div>
        <ShrinkText text={head.title} max={52} min={24} style={{ ...bigName(isMobile), overflowWrap: "normal" }} />
        <div style={{ fontSize: 14, fontWeight: 800, opacity: 0.85, fontFamily: BODY }}>{firstLine}</div>
        {startButton}
        {/* Back to the setup screen's team picker, nothing selected. */}
        {onPickTeam && (
          <button onClick={onPickTeam} className="wd-sim-pickteam" style={{ display: "block", marginTop: 10, border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: BODY, fontWeight: 700, fontSize: 13, color: "inherit", opacity: 0.85, textDecoration: "underline", textUnderlineOffset: 3 }}>
            {teams.length ? "Pick another team" : "Pick a team"}
          </button>
        )}
      </div>
    </div>
  );
}

// Instant / Skip to My Pick: the board fills while the stage just says so.
function SimmingContent({ s, data, isMobile }) {
  const made = s.sim.picks.filter((p) => p.selection).length;
  const total = s.sim.picks.length;
  const last = [...s.sim.picks].reverse().find((p) => p.selection);
  const lastPl = last && s.sim.byId[last.selection];
  const mine = s.skipToUser ? s.sim.picks.slice(s.sim.idx).find((p) => s.sim.userTeams.includes(p.owner)) : null;
  return (
    <div style={{ ...pad(isMobile), flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
      <div style={{ fontSize: isMobile ? 30 : 52, fontWeight: 900, letterSpacing: "0.12em" }}>SIMMING…</div>
      <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 800, color: "#9fb0c8", fontFamily: BODY, marginTop: 6 }}>
        Pick {Math.min(made + 1, total)} of {total}{mine ? ` · to your pick at No. ${mine.overall}` : ""}
      </div>
      <div style={{ height: 6, width: "100%", background: "rgba(255,255,255,0.1)", borderRadius: 999, marginTop: 16, overflow: "hidden", maxWidth: 560 }}>
        <div style={{ height: "100%", width: `${(made / Math.max(1, total)) * 100}%`, background: GOLD, transition: "width .3s linear" }} />
      </div>
      {lastPl && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#c9d4e5", fontFamily: BODY }}>
          Last: No. {last.overall} {brandOf(data, last.owner).Team || last.owner} — {lastPl.First} {lastPl.Last}, {lastPl.Position}
        </div>
      )}
    </div>
  );
}

// The trade announcement — the whole stage: who moves up, who moves down,
// and what each side gets. Labels read under the (plural) nickname:
// "JETS / MOVE UP · GET".
// Side by side on every screen; a phone just runs everything smaller.
function TradeSide({ brand, team, label, picks, isMobile, align }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: isMobile ? 5 : 8, textAlign: "center", justifyContent: align }}>
      <span className="wd-sim-in" style={{ display: "inline-flex", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.4))" }}><TeamLogo brand={brand} team={team} size={isMobile ? 92 : 104} /></span>
      <div style={{ minWidth: 0, maxWidth: "100%" }}>
        <div style={{ fontSize: isMobile ? 19 : 24, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, overflowWrap: "anywhere" }}>{brand.Team || team}</div>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: isMobile ? "0.12em" : "0.16em", opacity: 0.75, marginTop: isMobile ? 3 : 4 }}>{label}</div>
        <div style={{ display: "flex", gap: isMobile ? 4 : 5, flexWrap: "wrap", justifyContent: "center", marginTop: 5 }}>
          {picks.map((p) => <span key={p} style={{ background: "rgba(0,0,0,0.35)", borderRadius: 999, padding: isMobile ? "3px 9px" : "3px 10px", fontSize: isMobile ? 12 : 13, fontWeight: 900, whiteSpace: "nowrap" }}>{p}</span>)}
        </div>
      </div>
    </div>
  );
}

function TradeContent({ event, data, isMobile }) {
  const to = brandOf(data, event.to);
  const from = brandOf(data, event.from);
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: isMobile ? 8 : 14, width: "100%", height: "100%", padding: isMobile ? "10px 8px 12px" : "18px 30px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: isMobile ? "center" : "flex-start", gap: isMobile ? 10 : 12, flexWrap: isMobile ? "nowrap" : "wrap", minWidth: 0 }}>
        <span className="wd-sim-flip" style={{ display: "inline-block", flexShrink: 0, background: "#fff", color: "#a50e24", borderRadius: 8, padding: isMobile ? "3px 10px" : "4px 14px", fontSize: isMobile ? 20 : 36, fontWeight: 900, letterSpacing: "0.1em", lineHeight: 1.1 }}>TRADE</span>
        <span style={{ fontSize: isMobile ? 12 : 15, fontWeight: 900, letterSpacing: isMobile ? "0.1em" : "0.14em", opacity: 0.85, whiteSpace: isMobile ? "nowrap" : "normal", overflow: "hidden", textOverflow: "ellipsis" }}>{pickName(event.pick).toUpperCase()} CHANGES HANDS</span>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: isMobile ? 6 : 18, flex: 1, minHeight: 0 }}>
        <TradeSide brand={to} team={event.to} label="MOVE UP · GET" picks={[pickName(event.pick)]} isMobile={isMobile} align="center" />
        <span aria-hidden="true" style={{ fontSize: isMobile ? 22 : 40, fontWeight: 900, color: GOLD, alignSelf: "center", lineHeight: 1 }}>⇄</span>
        <TradeSide brand={from} team={event.from} label="MOVE DOWN · GET" picks={event.give.map(pickName)} isMobile={isMobile} align="center" />
      </div>
    </div>
  );
}

function Stage({ s, data, isMobile, onPickTeam, strip = null }) {
  let look = NEUTRAL_LOOK;
  let key = s.phase;
  let content = null;
  let footer = null;
  let beat = null;

  const pickEvent = s.phase === "reveal" ? s.reveal?.events.filter((e) => e.type === "pick").pop() : null;
  const tradeEvent = s.phase === "reveal" ? s.reveal?.events.find((e) => e.type === "trade") : null;
  // Before the reveal, the pick that's coming (made after any trade up —
  // so "the pick is in" shows the team that moved up).
  const pendingTrade = ["trade", "pickIn"].includes(s.phase) ? s.pendingEvents?.find((e) => e.type === "trade") : null;
  const pendingPick = s.phase === "pickIn" ? s.pendingEvents?.find((e) => e.type === "pick") : null;
  const pick = currentPick(s.sim);

  if (s.phase === "intro") {
    if (s.sim.userTeams.length === 1) look = teamLook(brandOf(data, s.sim.userTeams[0]));
    content = <IntroContent s={s} data={data} isMobile={isMobile} onPickTeam={onPickTeam} />;
  } else if (s.phase === "simming") {
    look = SIMMING_LOOK;
    content = <SimmingContent s={s} data={data} isMobile={isMobile} />;
  } else if (s.phase === "trade" && pendingTrade) {
    look = TRADE_LOOK;
    key = `trade-${pendingTrade.pick.overall}`;
    beat = key;
    content = <TradeContent event={pendingTrade} data={data} isMobile={isMobile} />;
  } else if (pickEvent || (pick && !tradeEvent)) {
    // Clock, pick is in, the user's clock and the pick card all share one
    // mounted PickStage (same key), so each beat updates it in place.
    const mode = pickEvent ? "reveal" : s.phase === "pickIn" ? "pickIn" : s.phase === "user" ? "user" : "clock";
    const at = pickEvent ? pickEvent.pick : pendingPick ? pendingPick.pick : pick;
    const team = pickEvent ? pickEvent.team : pendingPick ? pendingPick.team : pick.owner;
    look = teamLook(brandOf(data, team));
    key = "pick-stage";
    beat = `${mode}-${at.overall}`;
    content = <PickStage s={s} data={data} isMobile={isMobile} mode={mode} pick={at} team={team} look={look} event={pickEvent} trade={tradeEvent || pendingTrade} />;
    footer = <ClockBar s={s} pick={at} look={look} running={mode === "pickIn" || mode === "clock"} />;
  } else if (tradeEvent) {
    look = TRADE_LOOK;
    key = `trade-${tradeEvent.pick.overall}`;
    content = <TradeContent event={tradeEvent} data={data} isMobile={isMobile} />;
  }

  return (
    // Mobile: no wordmark behind the stage — before the draft the team's
    // logo is the background (IntroContent), and during it the stage is
    // too busy for one.
    <StageFrame look={isMobile ? { ...look, wordmark: null } : look} isMobile={isMobile} footer={footer} strip={strip} beat={beat}>
      <div key={key} className="wd-sim-in" style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}>{content}</div>
    </StageFrame>
  );
}

// ── Phones: Up Next as a slim strip along the stage's bottom — the next
// picks by number and team abbreviation (no logos), the team on the clock
// brightest, the user's own picks ("YOU") in gold. ──
function UpNextStrip({ s }) {
  const upcoming = s.sim.picks.slice(s.sim.idx).filter((p) => !p.future).slice(0, 12);
  if (s.phase === "done" || !upcoming.length) return null;
  const onClock = ["clock", "pickIn", "user"].includes(s.phase);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, height: STRIP_HEIGHT, flexShrink: 0, padding: "0 10px", background: "rgba(0,0,0,0.38)", whiteSpace: "nowrap", overflow: "hidden" }}>
      <span style={{ flexShrink: 0, color: GOLD, fontSize: 9, fontWeight: 900, letterSpacing: "0.16em" }}>UP NEXT</span>
      <div style={{ display: "flex", gap: 11, overflow: "hidden", WebkitMaskImage: "linear-gradient(90deg, #000 85%, transparent)", maskImage: "linear-gradient(90deg, #000 85%, transparent)" }}>
        {upcoming.map((p, i) => {
          const mine = s.sim.userTeams.includes(p.owner);
          const now = i === 0 && onClock;
          return (
            <span key={p.overall} style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", color: mine ? GOLD : now ? "#fff" : "rgba(255,255,255,0.72)" }}>
              <span style={{ fontSize: 9, opacity: 0.65, marginRight: 3, fontVariantNumeric: "tabular-nums" }}>{p.inRound === 1 && p.round > 1 ? `R${p.round}·` : ""}{p.overall}</span>
              {mine ? "YOU" : p.owner}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Up Next: the draft order coming up, right under the stage. The track
// slides one slot left as each pick comes off the board (not while
// simming — that moves too fast to follow). The team on the clock is in
// its own color; the user's picks are outlined in gold. ──
function UpNextBar({ s, data, isMobile }) {
  const trackRef = useRef(null);
  const prevIdx = useRef(s.sim.idx);
  const itemW = isMobile ? 62 : 78;
  const upcoming = s.sim.picks.slice(s.sim.idx).filter((p) => !p.future).slice(0, isMobile ? 8 : 16);
  useLayoutEffect(() => {
    const moved = s.sim.idx - prevIdx.current;
    prevIdx.current = s.sim.idx;
    const el = trackRef.current;
    if (!el?.animate || moved <= 0 || moved > 3 || s.phase === "simming") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ transform: `translateX(${moved * (itemW + 6)}px)` }, { transform: "translateX(0)" }], { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
  }, [s.sim.idx, s.phase, itemW]);
  if (s.phase === "done" || !upcoming.length) return null;
  const onClock = ["clock", "pickIn", "user"].includes(s.phase);
  return (
    <div style={{ ...PANEL, marginTop: 10, display: "flex", alignItems: "stretch" }}>
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: isMobile ? "0 10px" : "0 14px", background: "#070d18", borderRight: "1px solid #1f2b42", color: GOLD, fontWeight: 900, fontSize: isMobile ? 10 : 11, letterSpacing: "0.16em", lineHeight: 1.3 }}>
        UP<br />NEXT
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden", padding: 8, WebkitMaskImage: "linear-gradient(90deg, #000 85%, transparent)", maskImage: "linear-gradient(90deg, #000 85%, transparent)" }}>
        <div ref={trackRef} style={{ display: "flex", gap: 6 }}>
          {upcoming.map((p, i) => {
            const brand = brandOf(data, p.owner);
            const { c1 } = colors(brand);
            const now = i === 0 && onClock;
            const mine = s.sim.userTeams.includes(p.owner);
            const roundStart = p.inRound === 1 && p.round > 1;
            return (
              <div key={p.overall} title={`No. ${p.overall} — ${brand.Team || p.owner}${p.via ? ` (via ${p.via})` : ""}`} style={{
                flex: `0 0 ${itemW}px`, height: isMobile ? 60 : 68, boxSizing: "border-box", borderRadius: 10,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                background: now ? c1 : "#121c2f",
                border: `1px solid ${mine ? GOLD : now ? "rgba(255,255,255,0.55)" : "#1f2b42"}`,
                transition: "background-color .6s ease, border-color .6s ease",
              }}>
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", fontVariantNumeric: "tabular-nums", color: now ? textOn(c1) : roundStart ? GOLD : "#9fb0c8" }}>
                  {roundStart ? `RD ${p.round} · ${p.overall}` : `NO. ${p.overall}`}
                </span>
                <TeamLogo brand={brand} team={p.owner} size={isMobile ? 24 : 30} />
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", color: mine ? GOLD : now ? textOn(c1) : "#dbe4f0" }}>{mine ? "YOU" : p.owner}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── The Console: the tabbed panel under the stage. A fixed height with its
// own scrolling, so the page itself doesn't have to. ──
const consoleHeight = (isMobile) => (isMobile ? "58vh" : 400);
// The Draft Board can run 100 deep — it alone scrolls, inside this.
const boardHeight = (isMobile) => (isMobile ? "70vh" : 720);
const DRAFT_BTN = { flexShrink: 0, border: "none", borderRadius: 999, padding: "7px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", background: GOLD, color: "#fff" };
const EMPTY = { padding: 20, color: "#6f7f99", fontSize: 13, fontFamily: BODY };

// "Your pick" strip across the top of a tab while the user's on the clock.
// Desktop only — on a phone the stage right above already says it.
function YourPickBanner({ s, data, text, isMobile }) {
  const pick = currentPick(s.sim);
  if (isMobile || s.phase !== "user" || !pick) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "linear-gradient(90deg, rgba(246,162,29,0.2), transparent)", borderBottom: "1px solid #1f2b42" }}>
      <TeamLogo brand={brandOf(data, pick.owner)} team={pick.owner} size={28} />
      <span style={{ color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em" }}>YOUR PICK · NO. {pick.overall}</span>
      <span style={{ marginLeft: "auto", color: "#9fb0c8", fontSize: 12, fontFamily: BODY }}>{text}</span>
    </div>
  );
}

// Draft tab: the picks so far, round by round (or just the user's).
function DraftTab({ s, data, isMobile }) {
  const rounds = [...new Set(s.sim.picks.map((p) => p.round))];
  const current = currentPick(s.sim);
  const [round, setRound] = useState(null);
  const shownRound = round ?? current?.round ?? rounds[0];
  const picks = s.sim.picks.filter((p) => p.round === shownRound);
  const chipBtn = (on) => ({ ...barBtn, background: on ? GOLD : "#1a2438", color: on ? "#fff" : "#9fb0c8" });
  if (isMobile) return <MobileDraftList s={s} data={data} rounds={rounds} shownRound={shownRound} setRound={setRound} picks={picks} current={current} chipBtn={chipBtn} />;
  const cols = 4;
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {rounds.length > 1 && rounds.map((r) => (
          <button key={r} onClick={() => setRound(r)} aria-pressed={shownRound === r} style={chipBtn(shownRound === r)}>R{r}</button>
        ))}
      </div>
      {/* Down the columns, not across: 1–8 in the first, 9–16 the next… */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(picks.length / cols) || 1}, auto)`, gridAutoFlow: "column", gap: 6 }}>
        {picks.map((p) => {
          const b = brandOf(data, p.owner);
          const pl = s.sim.byId[p.selection];
          const live = current && current.overall === p.overall && s.phase !== "done";
          const mine = s.sim.userTeams.includes(p.owner);
          return (
            <div key={p.overall} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "7px 8px", borderRadius: 10, minWidth: 0,
              background: live ? "rgba(246,162,29,0.16)" : pl ? "#121c2f" : "#0b1322",
              border: `1px solid ${live ? GOLD : mine ? "#3a5a8c" : "#1a2640"}`,
            }}>
              <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 22, textAlign: "right", flexShrink: 0 }}>{p.overall}</span>
              <TeamLogo brand={b} team={p.owner} size={22} />
              <span style={{ minWidth: 0, flex: 1 }}>
                {pl
                  ? <Link className="wd-sim-plink" to={`/player/${pl.Slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none" }}><PlayerName p={pl} style={{ color: "#fff", fontSize: 12, fontWeight: 900 }} /></Link>
                  : <span style={{ display: "block", color: "#55657e", fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>{live ? "On the clock" : "—"}</span>}
                {pl && <span style={{ display: "block", color: "#8b9bb4", fontSize: 10, fontWeight: 800, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.Position} {pl.School}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The Draft tab on a phone: one pick per row, top to bottom, round chips
// on top, the pick on the clock highlighted. (No scrolling to it — the list
// is part of the page now, and that would yank the page away from the stage.)
function MobileDraftList({ s, data, rounds, shownRound, setRound, picks, current, chipBtn }) {
  const liveOverall = current && s.phase !== "done" ? current.overall : null;
  return (
    <div>
      {rounds.length > 1 && (
        <div className="wd-sim-scroll" style={{ display: "flex", gap: 4, padding: "8px 10px", background: "#0e1626", borderBottom: "1px solid #1f2b42", overflowX: "auto" }}>
          {rounds.map((r) => <button key={r} onClick={() => setRound(r)} aria-pressed={shownRound === r} style={{ ...chipBtn(shownRound === r), flexShrink: 0 }}>Round {r}</button>)}
        </div>
      )}
      {picks.map((p) => {
        const b = brandOf(data, p.owner);
        const pl = s.sim.byId[p.selection];
        const live = p.overall === liveOverall;
        const mine = s.sim.userTeams.includes(p.owner);
        return (
          <div key={p.overall} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", minWidth: 0,
            borderBottom: "1px solid #18233a", borderLeft: `3px solid ${live ? GOLD : mine ? "#3a5a8c" : "transparent"}`,
            background: live ? "rgba(246,162,29,0.14)" : "transparent",
          }}>
            <span style={{ color: live ? GOLD : "#6f7f99", fontWeight: 900, fontSize: 13, width: 26, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{p.overall}</span>
            <TeamLogo brand={b} team={p.owner} size={30} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {pl ? (
                <>
                  <Link className="wd-sim-plink" to={`/player/${pl.Slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none" }}><PlayerName p={pl} style={{ color: "#fff", fontSize: 14, fontWeight: 900 }} /></Link>
                  <span style={{ display: "block", color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {pl.Position} · {pl.School}{p.via ? ` · via ${p.via}` : ""}
                  </span>
                </>
              ) : (
                <>
                  <span style={{ display: "block", color: live ? "#fff" : "#9fb0c8", fontSize: 13, fontWeight: 900, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.Team || p.owner}</span>
                  <span style={{ display: "block", color: live ? GOLD : "#55657e", fontSize: 11, fontWeight: 800 }}>{live ? "On the clock" : mine ? "Your pick" : "Up later"}{p.via ? ` · via ${p.via}` : ""}</span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// My Picks tab: the user's teams' selections so far — pick, player, board
// value or reach, the need he filled — then the picks still to come, with
// how far off each one is.
function MyPicksTab({ s, data, isMobile }) {
  const teams = s.sim.userTeams;
  return (
    <div>
      {teams.map((team) => {
        const brand = brandOf(data, team);
        const mine = s.sim.picks.filter((p) => p.owner === team);
        const made = mine.filter((p) => p.selection);
        const left = mine.filter((p) => !p.selection && !p.future);
        return (
          <div key={team}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #1f2b42", flexWrap: "wrap" }}>
              <TeamLogo brand={brand} team={team} size={24} />
              <span style={{ color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.12em" }}>{(brand.Team || team).toUpperCase()} PICKS</span>
              <span style={{ marginLeft: "auto", color: "#6f7f99", fontSize: 11, fontFamily: BODY }}>
                {made.length} made · {left.length} to go
              </span>
            </div>
            {!made.length && <div style={{ ...EMPTY, paddingBottom: 8 }}>No selections yet.</div>}
            {made.map((p) => {
              const pl = s.sim.byId[p.selection];
              const value = SPECIALISTS.includes(pl.Position) ? 0 : p.overall - pl.rank;
              // Mobile: just who they took — no value or need columns.
              if (isMobile) {
                return (
                  <div key={p.overall} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #18233a", minWidth: 0 }}>
                    <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 30, flexShrink: 0, lineHeight: 1.25, textAlign: "center" }}>R{p.round}<br />{p.overall}</span>
                    {logoOf(pl) ? <img src={logoOf(pl)} alt="" style={{ width: 30, height: 30, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 30, flexShrink: 0 }} />}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Link className="wd-sim-plink" to={`/player/${pl.Slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none" }}><PlayerName p={pl} style={{ color: "#fff", fontWeight: 900, fontSize: 14 }} /></Link>
                      <span style={{ display: "block", color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.Position} · {pl.School}</span>
                    </span>
                  </div>
                );
              }
              return (
                <div key={p.overall} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid #18233a", minWidth: 0 }}>
                  <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 52, flexShrink: 0, lineHeight: 1.25, textAlign: "center", whiteSpace: "nowrap" }}>R{p.round}<br />No. {p.overall}</span>
                  {logoOf(pl) ? <img src={logoOf(pl)} alt="" style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 28, flexShrink: 0 }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Link className="wd-sim-plink" to={`/player/${pl.Slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none" }}><PlayerName p={pl} style={{ color: "#fff", fontWeight: 900, fontSize: 14 }} /></Link>
                    <span style={{ display: "block", color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{pl.Position} · {pl.School} · Board #{pl.rank}</span>
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 900, color: value > 0 ? "#4ade80" : value < 0 ? "#ff8a9a" : "#9fb0c8", width: 64, textAlign: "right" }}>
                    {value > 0 ? `+${value} value` : value < 0 ? `${value} reach` : "on the board"}
                  </span>
                  <span style={{ flexShrink: 0, minWidth: 170, fontSize: 11, fontWeight: 800, fontFamily: BODY, color: p.need ? "#ffb3bf" : "#55657e" }}>
                    {p.need ? (p.need.label === "Crowded Room" ? `Into a crowded room: ${NEED_KEY_NAMES[p.need.key] || p.need.key}` : `Filled: ${needLine(p.need)}`) : "No need filled"}
                  </span>
                </div>
              );
            })}
            {left.length > 0 && !isMobile && (
              <div style={{ padding: "8px 14px 4px", color: "#8b9bb4", fontSize: 10, fontWeight: 900, letterSpacing: "0.16em" }}>REMAINING PICKS</div>
            )}
            {!isMobile && left.map((p) => {
              const away = s.sim.picks.indexOf(p) - s.sim.idx;
              const live = away === 0 && s.phase !== "done";
              return (
                <div key={p.overall} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid #18233a", background: live ? "rgba(246,162,29,0.1)" : "transparent" }}>
                  <span style={{ color: live ? GOLD : "#6f7f99", fontWeight: 900, fontSize: 11, width: 52, flexShrink: 0, lineHeight: 1.25, textAlign: "center", whiteSpace: "nowrap" }}>R{p.round}<br />No. {p.overall}</span>
                  <span style={{ flex: 1, minWidth: 0, color: live ? "#fff" : "#9fb0c8", fontSize: 13, fontWeight: 900 }}>
                    {live ? "On the clock" : away === 1 ? "Next pick" : `In ${away} picks`}
                  </span>
                  {p.via && <span style={{ flexShrink: 0, color: "#6f7f99", fontSize: 11, fontWeight: 800, fontFamily: BODY }}>via {p.via}</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Draft Board tab: everyone still available. Drafting happens here.
function DraftBoardTab({ s, data, isMobile }) {
  const [pos, setPos] = useState("ALL");
  const [q, setQ] = useState("");
  const onClock = s.phase === "user";
  const rows = useMemo(() => available(s.sim)
    .filter((p) => (pos === "ALL" || p.Position === pos) && (!q || `${p.First} ${p.Last} ${p.School}`.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 100), [s.sim, pos, q]);

  return (
    <div>
      <YourPickBanner s={s} data={data} isMobile={isMobile} text="Pick a player." />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "10px 12px", borderBottom: "1px solid #1f2b42" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search prospects"
          style={{ flex: "1 1 140px", minWidth: 0, background: "#121c2f", border: "1px solid #24324d", borderRadius: 999, color: "#fff", padding: "6px 12px", fontSize: 13, fontFamily: BODY, outline: "none" }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["ALL", ...SIM_POSITIONS, ...SPECIALISTS].map((k) => (
            <button key={k} onClick={() => setPos(k)} aria-pressed={pos === k} style={{
              border: "none", borderRadius: 999, padding: "5px 9px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900,
              background: pos === k ? GOLD : "#1a2438", color: pos === k ? "#fff" : "#9fb0c8",
            }}>{k}</button>
          ))}
        </div>
      </div>
      {rows.map((p) => {
        const label = gradeLabel(p.avg);
        return (
          <div key={p.id} className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "8px 10px" : "9px 14px", borderBottom: "1px solid #18233a" }}>
            <span style={{ width: 30, textAlign: "right", color: "#6f7f99", fontWeight: 900, fontSize: 13, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{p.rank}</span>
            {logoOf(p) ? <img src={logoOf(p)} alt="" style={{ width: 26, height: 26, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 26, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link className="wd-sim-plink" to={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", fontWeight: 900, fontSize: 14, textDecoration: "none", textTransform: "uppercase" }}>{p.First} {p.Last}</Link>
              <div style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>{p.Position} · {p.School}{label ? ` · ${label}${p.mine ? " (yours)" : ""}` : ""}</div>
            </div>
            {onClock && <button className="wd-sim-draft" onClick={() => s.draft(p.id)} style={DRAFT_BTN}>DRAFT</button>}
            {/* Phones: his player page, in a new tab, from a box at the row's end. */}
            {isMobile && p.Slug && (
              <Link to={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" aria-label={`${p.First} ${p.Last}'s player page`} style={{
                flexShrink: 0, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8,
                border: "1px solid #24324d", background: "#121c2f", color: "#9fb0c8", fontSize: 15, fontWeight: 900, textDecoration: "none",
              }}>↗</Link>
            )}
          </div>
        );
      })}
      {rows.length === 0 && <div style={{ ...EMPTY, textAlign: "center" }}>No prospects match.</div>}
    </div>
  );
}

// Suggestions tab: three cards for the team on the clock — the best value
// left on the We-Draft.com board (community grades), one or two players a
// GM / head coach / coordinator has a strong preference for (nflFit, see
// engine suggestionsFor), and now and then (DAVIN_CHANCE) Davin McGavitt's
// joke pick from his favorite-players list instead of the second staff card.
const DAVIN_CHANCE = 0.3;
const SLOT_TITLE = { GM: "GM", HC: "Head Coach", OC: "Off. Coordinator", DC: "Def. Coordinator" };
const POS_WORD = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", OL: "lineman", DL: "defensive lineman", EDGE: "edge rusher", LB: "linebacker", DB: "defensive back", K: "kicker", P: "punter" };

// Only ever for the user's own teams: their pick when they're on the
// clock, otherwise their next one coming up (from the board as it stands).
function SuggestionsTab({ s, data, isMobile }) {
  const onPick = currentPick(s.sim);
  const pick = onPick && s.sim.userTeams.includes(onPick.owner)
    ? onPick
    : s.sim.picks.slice(s.sim.idx).find((p) => !p.future && s.sim.userTeams.includes(p.owner));
  const team = pick?.owner;
  const { value, need, coach, needs, topNeed } = useMemo(() => (pick ? suggestionsFor(s.sim, team, pick.overall) : { value: null, need: null, coach: null, needs: {}, topNeed: null }), [s.sim, team, pick]);
  // Davin's in or not is settled once per pick (a seeded roll), so the card
  // doesn't flicker in and out as the board changes.
  const overall = pick?.overall;
  const davin = useMemo(() => {
    if (!team) return null;
    let seed = (s.sim.seed ^ Math.imul(overall, 2654435761)) | 0;
    const rand = () => { const r = rngNext(seed); seed = r.seed; return r.value; };
    return rand() < DAVIN_CHANCE ? davinSuggestion(team, { ...s.ctx, rand }) : null;
  }, [team, overall]); // eslint-disable-line react-hooks/exhaustive-deps
  const legendSchool = useLegendSchool(davin?.legend.school, data);
  if (!pick) return <div style={EMPTY}>{onPick ? "You're out of picks in this draft." : "The draft's over."}</div>;
  const brand = brandOf(data, team);
  const upcoming = pick !== onPick;
  const staffNames = data.staff[team] || {};
  const onClock = s.phase === "user";
  // The front office's voice: the GM on the value and need picks (else the
  // head coach), the staffer himself on his own favorite.
  const speaker = (slot) => {
    const order = slot ? [slot] : ["GM", "HC"];
    const found = order.find((k) => staffNames[k]?.n) || order[0];
    return { name: staffNames[found]?.n || "", title: SLOT_TITLE[found] };
  };
  const ctx = { nick: brand.Team || team, overall: pick.overall, topNeed };
  const cards = [];
  if (value) {
    cards.push(<SuggestionCard key="value" tag="VALUE PICK" accent={BLUE} p={value} onClock={onClock} s={s}
      quote={{ text: frontOfficeLine("value", value, needs[value.id], ctx), by: speaker() }} />);
  }
  if (need) {
    cards.push(<SuggestionCard key="need" tag="NEED PICK" accent={NEED_RED} p={need} onClock={onClock} s={s}
      quote={{ text: frontOfficeLine("need", need, needs[need.id], ctx), by: speaker() }} />);
  }
  if (coach) {
    const who = staffNames[coach.slot]?.n;
    cards.push(<SuggestionCard key="coach" tag={`${coach.slot}${who ? ` ${who.toUpperCase()}` : ""}`} accent={GOLD} p={coach.p} onClock={onClock} s={s}
      quote={{ text: frontOfficeLine("coach", coach.p, needs[coach.p.id], ctx), by: speaker(coach.slot) }} />);
  }
  // Davin only takes a spot that's open — three suggestions at most.
  if (davin && cards.length < 3) cards.push(<DavinCard key="davin" davin={davin} school={legendSchool} />);

  return (
    <div>
      <YourPickBanner s={s} data={data} isMobile={isMobile} text="Your war room's picks — draft one right here." />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #1f2b42" }}>
        <TeamLogo brand={brand} team={team} size={24} />
        <span style={{ color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.12em" }}>{ctx.nick.toUpperCase()} SUGGESTIONS</span>
        <span style={{ marginLeft: "auto", color: "#6f7f99", fontSize: 11, fontFamily: BODY }}>{upcoming ? `Your next pick · No. ${pick.overall}` : `No. ${pick.overall}`}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 10, padding: 12 }}>
        {cards.slice(0, 3)}
        {!cards.length && <div style={EMPTY}>Nothing left to suggest.</div>}
      </div>
    </div>
  );
}

// A team need, as the suggestion cards say it: "Cornerback (Upgrade Needed)".
const NEED_RED = "#d6455d";
const needLine = (n) => `${NEED_KEY_NAMES[n.key] || n.key} (${n.label})${n.note ? ` — ${n.note}` : ""}`;

// What the front office says about a suggestion (kind: value / need /
// coach). ctx: { nick, overall, topNeed }.
function frontOfficeLine(kind, p, need, { overall, topNeed }) {
  const name = `${p.First} ${p.Last}`;
  const pos = POS_WORD[p.Position] || p.Position;
  const word = need ? needWord(need.key) : pos;
  if (kind === "need") {
    return need?.label === "Aging Talent" ? `${name} is the guy to take over at ${word} when it's time.` : `We need a ${word}, and ${name} is the best one left.`;
  }
  if (kind === "value") {
    return need ? `${name} is the best player on our board, and he fills a need. Easy call.` : `${name} is the best player on our board. You don't pass on that.`;
  }
  if (need) return `${name} is the kind of player I like, and he fits a need.`;
  if (topNeed && p.rank <= overall + 5) return `Even though we have bigger needs than ${pos}, ${name} is too good to pass up.`;
  return `${name} is the kind of ${pos} I like. He'd fit what we do.`;
}

// A suggestion: its label, the player, and the front office's word on him
// (quote: { text, by: { name, title } }) — the label and the quote say why.
function SuggestionCard({ tag, accent, p, onClock, s, quote }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#121c2f", border: "1px solid #1f2b42", borderTop: `3px solid ${accent}`, borderRadius: 12, padding: 12, minWidth: 0 }}>
      <span style={{ alignSelf: "flex-start", background: accent, color: accent === GOLD ? "#111" : "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {logoOf(p) ? <img src={logoOf(p)} alt="" style={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0 }} /> : null}
        <span style={{ minWidth: 0 }}>
          <Link className="wd-sim-plink" to={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", color: "#fff", fontWeight: 900, fontSize: 15, textTransform: "uppercase", textDecoration: "none", lineHeight: 1.1 }}>{p.First} {p.Last}</Link>
          <span style={{ display: "block", color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginTop: 2 }}>{p.Position} {p.School} · Board #{p.rank}</span>
        </span>
      </div>
      {quote && (
        <blockquote style={{ margin: 0, padding: "6px 10px", borderLeft: `3px solid ${accent}`, background: "rgba(255,255,255,0.04)", borderRadius: "0 8px 8px 0" }}>
          <span style={{ display: "block", color: "#fff", fontSize: 13, fontFamily: BODY, fontStyle: "italic", lineHeight: 1.4 }}>“{quote.text}”</span>
          <span style={{ display: "block", color: "#8b9bb4", fontSize: 11, fontWeight: 800, marginTop: 3 }}>— {quote.by.name ? `${quote.by.name}, ${quote.by.title}` : quote.by.title}</span>
        </blockquote>
      )}
      <span style={{ flex: 1 }} />
      {onClock && <button className="wd-sim-draft" onClick={() => s.draft(p.id)} style={{ ...DRAFT_BTN, alignSelf: "flex-start" }}>DRAFT</button>}
    </div>
  );
}

// A favorite's school branding: one of the admin's other schools, an NFL
// team (by full name — "New York Jets"), else the real school's doc →
// { logo, color } (logo dark-ready).
const nflByName = Object.fromEntries(Object.entries(NFL_TEAMS).map(([abbr, n]) => [n, abbr]));
function useLegendSchool(name, data) {
  const other = name ? otherSchools().find((o) => o.name === name) : null;
  const nfl = name ? nflByName[name] : null;
  const docs = useSchools(name && !other && !nfl ? [name] : []);
  if (!name) return null;
  if (other) return { logo: other.logo || "", color: other.color1 || "" };
  if (nfl) { const b = brandOf(data, nfl); return { logo: b.LogoDark || b.Logo1 || "", color: b.Color1 || "" }; }
  const d = docs[name];
  return d ? { logo: d.LogoBlack || d.LogoDark || d.Logo1 || "", color: d.Color1 || "" } : { logo: "", color: "" };
}

function DavinCard({ davin, school }) {
  const { analyst, legend, pos, text } = davin;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#141a2e", border: "1px dashed #4b3a7a", borderTop: `3px solid ${analyst.color}`, borderRadius: 12, padding: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Avatar analyst={analyst} size={22} />
        <span style={{ background: analyst.color, color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em" }}>DAVIN&apos;S PICK</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {school?.logo ? <img src={school.logo} alt="" style={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0 }} /> : null}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", color: "#fff", fontWeight: 900, fontSize: 15, textTransform: "uppercase", lineHeight: 1.1 }}>{legend.name}</span>
          <span style={{ display: "block", color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginTop: 2 }}>{pos}{legend.school ? ` ${legend.school}` : ""}</span>
        </span>
      </div>
      <div style={{ color: "#c9d4e5", fontSize: 12, fontFamily: BODY, lineHeight: 1.45, flex: 1, fontStyle: "italic" }}>&ldquo;{text}&rdquo;</div>
      <span style={{ alignSelf: "flex-start", color: "#8b7fb8", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em" }}>NOT IN THIS DRAFT</span>
    </div>
  );
}

// Roster tab: a team's current roster by position group, in the team
// page's Depth Chart order (utils/nflRoster.js), with the rookies it's
// drafted in this sim slotted into their groups. Follows the team on the
// clock until another team is picked.
const rosterCache = {};
const loadRoster = (team) => rosterCache[team] || (rosterCache[team] = Promise.all([
  fetchEspnRoster(team),
  fetchDepthOrder(team).catch(() => []),
]).catch((e) => { delete rosterCache[team]; throw e; }));

function RosterTab({ s, data, isMobile }) {
  const onClock = currentPick(s.sim)?.owner;
  const [chosen, setChosen] = useState(null);
  // The user's own team by default (not whoever's on the clock) — in Mock
  // Draft mode, the team on the clock, a pick from the list holding only
  // until the next pick's up.
  useEffect(() => { if (s.quick) setChosen(null); }, [s.quick, onClock]);
  const team = chosen || (s.quick ? onClock : s.sim.userTeams[0]) || onClock || NFL_TEAM_ABBRS[0];
  const brand = brandOf(data, team);
  const [loaded, setLoaded] = useState({});
  useEffect(() => {
    if (loaded[team]) return undefined;
    let live = true;
    loadRoster(team)
      .then(([roster, order]) => live && setLoaded((m) => ({ ...m, [team]: { roster, order } })))
      .catch(() => live && setLoaded((m) => ({ ...m, [team]: { roster: [], order: [], failed: true } })));
    return () => { live = false; };
  }, [team, loaded]);
  const got = loaded[team];
  const rookies = s.sim.picks.filter((p) => p.owner === team && p.selection).map((p) => {
    const pl = s.sim.byId[p.selection];
    return { id: `sim-${pl.id}`, fullName: `${pl.First} ${pl.Last}`, position: pl.Position, rosterStatus: "active", rookie: p, prospect: pl };
  });
  const groups = got ? groupRoster([...got.roster, ...rookies], got.order) : null;
  const look = colors(brand);
  const nameOf = (t) => (brandOf(data, t).Team ? `${brandOf(data, t).City || ""} ${brandOf(data, t).Team}`.trim() : t);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #1f2b42", flexWrap: "wrap" }}>
        <TeamLogo brand={brand} team={team} size={24} />
        <span style={{ color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.12em" }}>{(brand.Team || team).toUpperCase()} ROSTER</span>
        {rookies.length > 0 && <span style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em" }}>+{rookies.length} DRAFTED</span>}
        <select value={team} onChange={(e) => setChosen(e.target.value)} aria-label="Team" style={{ ...selectStyle, marginLeft: "auto", padding: "5px 10px", fontSize: 12 }}>
          {NFL_TEAM_ABBRS.map((t) => <option key={t} value={t}>{nameOf(t)}{s.sim.userTeams.includes(t) ? " (your team)" : t === onClock ? " (on the clock)" : ""}</option>)}
        </select>
      </div>
      {!got ? <div style={EMPTY}>Loading roster…</div>
        : got.failed || !Object.keys(groups).length ? <div style={EMPTY}>Roster unavailable.</div>
        : Object.entries(groups).map(([group, players]) => (
          <div key={group} style={{ padding: "10px 14px", borderBottom: "1px solid #18233a" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <span style={{ color: "#c9d4e5", fontWeight: 900, fontSize: 11, letterSpacing: "0.14em" }}>{group.toUpperCase()}</span>
              <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11 }}>{players.length}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 3}, minmax(0, 1fr))`, gap: 6 }}>
              {players.map((pl) => <RosterChip key={pl.id} pl={pl} c1={look.c1} year={data.year} />)}
            </div>
          </div>
        ))}
    </div>
  );
}

const ROSTER_TAGS = { reserve: "IR", suspended: "SUSP", ps: "PS" };
function RosterChip({ pl, c1, year }) {
  const r = pl.rookie;
  const tag = ROSTER_TAGS[pl.rosterStatus];
  const exp = pl.experience === 0 ? "Rookie" : pl.experience != null ? `${pl.experience} yr${pl.experience === 1 ? "" : "s"}` : null;
  const sub = r
    ? `R${r.round} · No. ${r.overall} · ${pl.prospect.School}`
    : [pl.jersey && `#${pl.jersey}`, pl.position, exp].filter(Boolean).join(" · ");
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7, padding: "6px 9px", borderRadius: 10, minWidth: 0,
      background: r ? "rgba(246,162,29,0.12)" : "#121c2f", border: `1px solid ${r ? GOLD : "#1a2640"}`,
      borderLeft: `3px solid ${r ? GOLD : c1}`, opacity: tag ? 0.6 : 1,
    }}>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", color: "#fff", fontSize: 12, fontWeight: 900, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.fullName}</span>
        <span style={{ display: "block", color: r ? GOLD : "#8b9bb4", fontSize: 10, fontWeight: 800, fontFamily: BODY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
      </span>
      {(r || tag) && <span style={{ flexShrink: 0, borderRadius: 5, padding: "1px 5px", fontSize: 9, fontWeight: 900, letterSpacing: "0.08em", background: r ? GOLD : "#2a3550", color: r ? "#111" : "#c9d4e5" }}>{r ? `${year} DRAFT PICK` : tag}</span>}
    </div>
  );
}

const pickLabel = (p) => (p.future ? pickName(p) : `R${p.round} · No. ${p.overall}`);

// Trades tab: offers for the user's pick, and proposing their own deals.
// Mock Draft mode (s.quick): the user deals for both sides — any two teams,
// done the moment they say so, no offers coming in.
function TradesTab({ s, data, isMobile }) {
  const god = s.quick;
  const userTeams = god ? NFL_TEAM_ABBRS : s.sim.userTeams;
  const [team, setTeam] = useState(god ? "" : userTeams[0] || null);
  const [partner, setPartner] = useState("");
  const [give, setGive] = useState([]);
  const [get, setGet] = useState([]);
  const [result, setResult] = useState(null);
  const pick = currentPick(s.sim);
  // The pick on the clock trades too — the user's, or a CPU team's until
  // its card is turned in (instant sims move too fast to deal mid-pick).
  const includeCurrent = !["simming", "done"].includes(s.phase);

  if (!userTeams.length) return <div style={EMPTY}>Trades are for your own teams — pick one in Settings.</div>;

  const byName = (a, b) => (brandOf(data, a).Team || a).localeCompare(brandOf(data, b).Team || b);
  const mine = team ? tradeablePicks(s.sim, team, { includeCurrent }) : [];
  const partners = NFL_TEAM_ABBRS.filter((t) => t !== team && (god || !userTeams.includes(t)) && tradeablePicks(s.sim, t, { includeCurrent }).length).sort(byName);
  const sides = god ? NFL_TEAM_ABBRS.filter((t) => tradeablePicks(s.sim, t, { includeCurrent }).length).sort(byName) : userTeams;
  const theirs = partner ? tradeablePicks(s.sim, partner, { includeCurrent }) : [];
  const verdict = evaluateProposal(s.sim, { give, get });
  const toggle = (list, setList, n) => { setResult(null); setList(list.includes(n) ? list.filter((x) => x !== n) : [...list, n]); };
  const own = pick ? pickValue(s.sim.chart, pick.overall) : 0;

  const propose = () => {
    const v = s.proposeTrade({ team, partner, give, get });
    setResult(v.accept ? { ok: true, text: god ? "Done — the picks have moved." : `Done — the ${brandOf(data, partner).Team || partner} accepted.` } : v.stale ? { ok: false, text: "Too late — a pick in that deal was just made." } : v.movedUp ? { ok: false, text: "They passed — they traded up already and aren't moving back down." } : { ok: false, text: "They passed. Add more to your side." });
    if (v.accept || v.stale) { setGive([]); setGet([]); }
  };

  const pickList = (title, picks, chosen, onToggle) => (
    <div style={{ flex: 1, minWidth: 0, background: "#0b1322", borderRadius: 12, border: "1px solid #1f2b42" }}>
      <div style={{ padding: "8px 12px", color: "#fff", fontWeight: 900, fontSize: 11, letterSpacing: "0.12em", borderBottom: "1px solid #1f2b42" }}>{title}</div>
      {picks.length === 0 && <div style={{ ...EMPTY, padding: 12 }}>No picks to trade.</div>}
      {picks.map((p) => (
        <label key={p.overall} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "pointer", color: chosen.includes(p.overall) ? "#fff" : "#c9d4e5", fontSize: 13, fontFamily: BODY }}>
          <input type="checkbox" checked={chosen.includes(p.overall)} onChange={() => onToggle(p.overall)} />
          <span style={{ fontWeight: 800 }}>{pickLabel(p)}</span>
          {p.future
            ? <span style={{ color: GOLD, fontSize: 11, fontWeight: 800 }}>−{Math.round((1 - FUTURE_DISCOUNT) * 100)}%</span>
            : p.capital && <span style={{ color: "#6f7f99", fontSize: 11 }}>(not simmed)</span>}
          <span style={{ marginLeft: "auto", color: "#8b9bb4", fontSize: 12 }}>{pickWorth(s.sim, p).toLocaleString()} pts</span>
        </label>
      ))}
    </div>
  );

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Offers for the pick on the clock (none in Mock Draft mode). */}
      {!god && <div>
        <div style={{ ...labelSm, marginBottom: 8 }}>Offers{s.sim.offers.length ? ` (${s.sim.offers.length})` : ""}</div>
        {s.sim.offers.length === 0 ? (
          <div style={{ color: "#6f7f99", fontSize: 13, fontFamily: BODY }}>Teams call when you&apos;re on the clock — offers show up here.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
            {s.sim.offers.map((o) => {
              const ob = brandOf(data, o.team);
              return (
                <div key={o.team} style={{ background: "#121c2f", borderRadius: 12, border: `1px solid ${GOLD}`, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <TeamLogo brand={ob} team={o.team} size={28} />
                    <span style={{ color: "#fff", fontWeight: 900, fontSize: 13 }}>{ob.Team || o.team}</span>
                  </div>
                  <div style={{ color: "#dbe4f0", fontSize: 13, fontFamily: BODY, margin: "8px 0", lineHeight: 1.45 }}>
                    They give <strong>{o.give.map((n) => pickName(pickByKey(s.sim, n))).join(" + ")}</strong> for No. {pick?.overall}.
                    <span style={{ color: "#8b9bb4" }}> Trade chart: {own ? Math.round((o.value / own) * 100) : 0}% of your pick.</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => s.takeOffer(o)} style={{ ...barBtn, background: "#2e7d32" }}>Accept</button>
                    <button onClick={() => s.declineOffer(o)} style={barBtn}>Decline</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>}

      {/* Propose a trade. */}
      <div>
        <div style={{ ...labelSm, marginBottom: 8 }}>{god ? "Make a Trade" : "Propose a Trade"}</div>
        {god && <div style={{ color: "#8b9bb4", fontSize: 13, fontFamily: BODY, marginBottom: 8 }}>Pick any two teams and the picks each one sends — it goes through as you build it.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {(god || userTeams.length > 1) && (
            <select value={team || ""} onChange={(e) => { setTeam(e.target.value); setGive([]); if (e.target.value === partner) { setPartner(""); setGet([]); } setResult(null); }} aria-label={god ? "First team" : "Your team"} style={selectStyle}>
              {god && <option value="">Team…</option>}
              {sides.map((t) => <option key={t} value={t}>{god ? `${brandOf(data, t).City || ""} ${brandOf(data, t).Team || t}`.trim() : brandOf(data, t).Team || t}</option>)}
            </select>
          )}
          <select value={partner} onChange={(e) => { setPartner(e.target.value); setGet([]); setResult(null); }} aria-label="Trade partner" style={selectStyle}>
            <option value="">Trade with…</option>
            {partners.map((t) => <option key={t} value={t}>{brandOf(data, t).City} {brandOf(data, t).Team || t}</option>)}
          </select>
        </div>
        {team && partner && (
          <>
            <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
              {pickList(`${god ? "SENDS" : "YOU GIVE"} · ${(brandOf(data, team).Team || team).toUpperCase()}`, mine, give, (n) => toggle(give, setGive, n))}
              {pickList(`${god ? "SENDS" : "YOU GET"} · ${(brandOf(data, partner).Team || partner).toUpperCase()}`, theirs, get, (n) => toggle(get, setGet, n))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <span style={{ color: "#c9d4e5", fontSize: 13, fontFamily: BODY }}>
                {god
                  ? <>The {brandOf(data, team).Team || team} send <strong>{verdict.give.toLocaleString()}</strong> pts · the {brandOf(data, partner).Team || partner} send <strong>{verdict.get.toLocaleString()}</strong> pts</>
                  : <>You give <strong>{verdict.give.toLocaleString()}</strong> pts · you get <strong>{verdict.get.toLocaleString()}</strong> pts</>}
                {!god && give.length > 0 && get.length > 0 && (
                  <span style={{ color: verdict.accept ? "#3fb950" : GOLD, fontWeight: 800 }}>
                    {verdict.accept ? " · they'd take it" : verdict.movedUp ? " · they traded up already — not moving back down" : ` · they want ${Math.ceil(verdict.get * CPU_ACCEPT_RATIO - verdict.give).toLocaleString()} more pts`}
                  </span>
                )}
              </span>
              {(() => {
                const ready = god ? give.length + get.length > 0 : give.length > 0 && get.length > 0;
                return (
                  <button onClick={propose} disabled={!ready} style={{ ...DRAFT_BTN, marginLeft: "auto", opacity: ready ? 1 : 0.5, cursor: ready ? "pointer" : "default" }}>
                    {god ? "MAKE TRADE" : "PROPOSE TRADE"}
                  </button>
                );
              })()}
            </div>
            {result && <div style={{ marginTop: 8, color: result.ok ? "#3fb950" : GOLD, fontSize: 13, fontWeight: 800, fontFamily: BODY }}>{result.text}</div>}
          </>
        )}
      </div>
    </div>
  );
}
const labelSm = { color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" };
const selectStyle = { background: "#121c2f", color: "#fff", border: "1px solid #24324d", borderRadius: 999, padding: "7px 12px", fontSize: 13, fontFamily: BODY, outline: "none" };

function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" className="wd-sim-scroll" style={{ display: "flex", gap: 4, padding: 6, borderBottom: "1px solid #1f2b42", background: "#0b1322", overflowX: "auto" }}>
      {tabs.map(([k, label, badge]) => (
        <button key={k} role="tab" aria-selected={active === k} onClick={() => onChange(k)} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          border: "none", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", whiteSpace: "nowrap",
          background: active === k ? "#1f2b42" : "transparent", color: active === k ? "#fff" : "#8b9bb4",
        }}>
          {label.toUpperCase()}
          {badge > 0 && (
            <span aria-label={`${badge} new`} style={{ minWidth: 18, height: 18, borderRadius: 999, background: "#c8102e", color: "#fff", fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
              {badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Console({ s, data, isMobile, fill = false }) {
  const [tab, setTab] = useState(isMobile ? "desk" : "draft");
  // Simming: watch the picks fill in. On the clock: the board, to draft.
  useEffect(() => {
    if (s.phase === "simming") setTab("draft");
    if (s.phase === "user") setTab("board");
  }, [s.phase]);
  const tabs = [
    ...(isMobile ? [["desk", "The Desk"]] : []),
    ["draft", "Draft"],
    ["board", "Draft Board"],
    // Suggestions are only for the user's own teams — none when watching.
    ...(s.sim.userTeams.length ? [["suggestions", "Suggestions"], ["mypicks", "My Picks"]] : []),
    ["roster", "Roster"],
    ["trades", "Trades", s.sim.offers.length],
  ];
  const body = {
    desk: <SimFeed feed={s.feed} height={isMobile ? "auto" : consoleHeight(isMobile)} isMobile={isMobile} />,
    draft: <DraftTab s={s} data={data} isMobile={isMobile} />,
    board: <DraftBoardTab s={s} data={data} isMobile={isMobile} />,
    suggestions: <SuggestionsTab s={s} data={data} isMobile={isMobile} />,
    mypicks: <MyPicksTab s={s} data={data} isMobile={isMobile} />,
    roster: <RosterTab s={s} data={data} isMobile={isMobile} />,
    trades: <TradesTab s={s} data={data} isMobile={isMobile} />,
  }[tab];
  // Mobile (and the anchored desktop screen, fill): the console fills the
  // rest of the screen under the stage — the tab bar stays put and only the
  // tab's content scrolls (from the top again on each tab).
  if (isMobile || fill) {
    return (
      <div style={{ ...PANEL, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", ...(isMobile ? {} : { marginTop: 12 }) }}>
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        <div key={tab} className="wd-sim-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>{body}</div>
      </div>
    );
  }
  return (
    <div style={{ ...PANEL, marginTop: 12 }}>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "board" ? <div className="wd-sim-scroll" style={{ maxHeight: boardHeight(isMobile), overflowY: "auto" }}>{body}</div> : body}
    </div>
  );
}

// fill (desktop): the anchored screen — sized by its parent (DraftSim.jsx),
// the console the only part that scrolls.
export default function SimBroadcast({ s, data, isMobile, onSettings, onPickTeam, fill = false }) {
  // Mobile: the anchored part — the stage, Up Next along its bottom — then
  // the controls and the console filling the rest of the screen (DraftSim.jsx
  // pins this to the viewport).
  if (isMobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Stage s={s} data={data} isMobile onPickTeam={onPickTeam} strip={<UpNextStrip s={s} />} />
        <BroadcastBar s={s} data={data} isMobile onSettings={onSettings} />
        <Console s={s} data={data} isMobile />
      </div>
    );
  }
  if (fill) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <BroadcastBar s={s} data={data} isMobile={false} onSettings={onSettings} />
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gridTemplateRows: "minmax(0, 1fr)", gap: 12 }}>
          <div style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Stage s={s} data={data} isMobile={false} onPickTeam={onPickTeam} />
            <UpNextBar s={s} data={data} isMobile={false} />
            <Console s={s} data={data} isMobile={false} fill />
          </div>
          <SimFeed feed={s.feed} height="100%" isMobile={false} />
        </div>
      </div>
    );
  }
  return (
    <div>
      <BroadcastBar s={s} data={data} isMobile={isMobile} onSettings={onSettings} />
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 360px", gap: 12, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <Stage s={s} data={data} isMobile={isMobile} onPickTeam={onPickTeam} />
          <UpNextBar s={s} data={data} isMobile={isMobile} />
          <Console s={s} data={data} isMobile={isMobile} />
        </div>
        {!isMobile && (
          <div style={{ position: "sticky", top: 12 }}>
            <SimFeed feed={s.feed} height="calc(100vh / var(--pz, 1) - 120px)" isMobile={false} />
          </div>
        )}
      </div>
    </div>
  );
}
