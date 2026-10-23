// src/components/draftSim/SimBroadcast.jsx
//
// Draft Sim's live screen, dressed as a draft broadcast: the top bar
// (LIVE, round/pick, speed controls), the stage (team on the clock → "the
// pick is in" → the pick card), the user's war room when they're up (best
// available + trade offers), the board / best available / my picks tabs,
// the analyst feed (SimFeed.jsx) and a bottom-line ticker of recent picks.
// State comes from useDraftSim.js.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { gradeLabel } from "../../utils/communityGrades";
import { currentPick, available, fitFor, pickValue, pickWorth, pickName, pickByKey, FUTURE_DISCOUNT, SIM_POSITIONS, SPECIALISTS, tradeablePicks, evaluateProposal, CPU_ACCEPT_RATIO, suggestionsFor, rngNext } from "../../utils/draftSim/engine";
import { davinSuggestion, otherSchools } from "../../utils/draftSim/analysts";
import { useSchools } from "../DraftArchiveList";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../../utils/coachHistory";
import { textOn } from "../../utils/teamColors";
import SimFeed, { Avatar } from "./SimFeed";
import { SPEEDS } from "./useDraftSim";
import { fetchEspnRoster, fetchDepthOrder, groupRoster } from "../../utils/nflRoster";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const PANEL = { background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, overflow: "hidden" };
const BODY = "Arial, sans-serif";

// Motion is kept slow and soft on purpose — fades only, nothing that
// slides, sweeps or flashes.
export const SIM_CSS = `
  @keyframes wdSimPulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
  @keyframes wdSimClock { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes wdSimFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes wdSimTicker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  .wd-sim-live-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff3b3b; animation: wdSimPulse 3s ease-in-out infinite; display: inline-block; flex-shrink: 0; }
  .wd-sim-post { animation: wdSimFade .8s ease both; }
  .wd-sim-in { animation: wdSimFade .9s ease both; }
  .wd-sim-row:hover { background: #16213a !important; }
  .wd-sim-draft:hover { filter: brightness(1.1); }
  .wd-sim-scroll { scrollbar-width: thin; scrollbar-color: #f6a21d #0b1322; }
  .wd-sim-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
  .wd-sim-scroll::-webkit-scrollbar-track { background: #0b1322; }
  .wd-sim-scroll::-webkit-scrollbar-thumb { background: linear-gradient(#f6a21d, #0055a5); border-radius: 999px; border: 2px solid #0b1322; }
  .wd-sim-scroll::-webkit-scrollbar-thumb:hover { background: #f6a21d; }
  @media (prefers-reduced-motion: reduce) {
    .wd-sim-live-dot, .wd-sim-post, .wd-sim-in, .wd-sim-ticker-track { animation: none !important; }
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
const BROADCAST_SKIPPABLE = ["clock", "pickIn", "reveal"];
function BroadcastBar({ s, data, isMobile, onSettings }) {
  const pick = currentPick(s.sim);
  const live = s.phase !== "done";
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
          <div role="group" aria-label="Speed" style={{ display: "inline-flex", background: "#121c2f", borderRadius: 999, padding: 3 }}>
            {Object.entries(SPEEDS).map(([k, v]) => (
              <button key={k} onClick={() => s.setSpeed(k)} aria-pressed={s.speed === k} style={{
                border: "none", borderRadius: 999, padding: isMobile ? "5px 9px" : "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900,
                background: s.speed === k ? "#fff" : "transparent", color: s.speed === k ? "#0b1220" : "#9fb0c8",
              }}>{v.label}</button>
            ))}
          </div>
          {(s.phase === "reveal" || (s.speed !== "instant" && !s.skipToUser && BROADCAST_SKIPPABLE.includes(s.phase))) && (
            <>
              <button onClick={() => s.setPaused(!s.paused)} style={barBtn}>{s.paused ? "▶ Resume" : "❚❚ Pause"}</button>
              <button onClick={s.skip} style={barBtn} title="Make the pick now">Skip to Next Pick ⏭</button>
            </>
          )}
          {s.userPicksLeft && !["user", "simming", "intro"].includes(s.phase) && <button onClick={s.simToMyPick} style={{ ...barBtn, background: GOLD, color: "#111" }}>Sim to My Pick ⏩</button>}
          {onSettings && <button onClick={onSettings} style={barBtn}>Settings</button>}
        </div>
      )}
    </div>
  );
}
const barBtn = { border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", background: "#1a2438", color: "#fff" };

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
const STAGE_HEIGHT = (isMobile) => (isMobile ? 200 : 260);

function StageFrame({ look, isMobile, footer, children }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, height: STAGE_HEIGHT(isMobile), display: "flex", flexDirection: "column", backgroundColor: look.c1, color: look.ink, transition: STAGE_FADE }}>
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
      <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>{children}</div>
      {footer}
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

// The clock, filling left to right in the team's own accent color.
function ClockBar({ s, pick, look }) {
  const pickIn = s.phase === "pickIn";
  return (
    <div style={{ position: "relative", height: 6, background: "rgba(0,0,0,0.28)" }}>
      <div key={`bar-${pick.overall}-${pick.owner}-${s.speed}`} style={{
        height: "100%", background: look.ink, opacity: 0.85, transformOrigin: "left", transition: "background-color 1.2s ease",
        ...(pickIn ? {} : { animation: `wdSimClock ${s.timing.clock}ms linear forwards`, animationPlayState: s.paused ? "paused" : "running" }),
      }} />
    </div>
  );
}

function ClockContent({ s, data, isMobile, pick }) {
  const team = pick.owner;
  const brand = brandOf(data, team);
  const isUser = s.sim.userTeams.includes(team);
  const { c1 } = colors(brand);
  return (
    <div style={pad(isMobile)}>
      <TeamLogo brand={brand} team={team} size={isMobile ? 76 : 132} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {s.phase === "pickIn" ? (
          <div key="in" className="wd-sim-in" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.38)", color: "#fff", borderRadius: 6, padding: "4px 12px", fontWeight: 900, fontSize: isMobile ? 12 : 14, letterSpacing: "0.18em" }}>
            <PickInIcon size={isMobile ? 18 : 22} /> THE PICK IS IN
          </div>
        ) : (
          <div style={tag(isMobile)}>{isUser ? "YOU'RE ON THE CLOCK" : "ON THE CLOCK"}</div>
        )}
        <div style={bigName(isMobile)}>{brand.Team || team}</div>
        {/* Round and pick, scoreboard-size — the pick itself in white with
            the team's color, the rest on smoked glass. */}
        <div style={{ display: "flex", alignItems: "stretch", gap: isMobile ? 6 : 8, marginTop: isMobile ? 6 : 10, flexWrap: "wrap" }}>
          <PickBox label="ROUND" value={pick.round} isMobile={isMobile} />
          <PickBox label="PICK" value={pick.inRound} isMobile={isMobile} solid={c1} />
          <PickBox label="OVERALL" value={`No. ${pick.overall}`} isMobile={isMobile} />
          {pick.via && <PickBox label="VIA" value={pick.via} isMobile={isMobile} />}
        </div>
      </div>
    </div>
  );
}

function PickBox({ label, value, isMobile, solid }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minWidth: isMobile ? 52 : 78,
      padding: isMobile ? "4px 10px" : "6px 16px", borderRadius: 10,
      background: solid ? "#fff" : "rgba(0,0,0,0.32)", color: solid || "#fff", boxShadow: solid ? "0 6px 18px rgba(0,0,0,0.25)" : "none",
    }}>
      <span style={{ fontSize: isMobile ? 9 : 11, fontWeight: 900, letterSpacing: "0.18em", opacity: solid ? 0.8 : 0.75 }}>{label}</span>
      <span style={{ fontSize: isMobile ? 24 : 40, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

// Before the first pick: who the user is drafting as.
function IntroContent({ s, data, isMobile }) {
  const teams = s.sim.userTeams;
  const one = teams.length === 1 ? teams[0] : null;
  const first = s.sim.picks.find((p) => teams.includes(p.owner));
  // The team's second color (site gold when drafting as several or none).
  const buttonColor = (one && brandOf(data, one).Color2) || GOLD;
  return (
    <div style={{ ...pad(isMobile), flexWrap: "wrap" }}>
      {one ? <TeamLogo brand={brandOf(data, one)} team={one} size={isMobile ? 76 : 132} /> : teams.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxWidth: isMobile ? "100%" : 220 }}>
          {teams.slice(0, 8).map((t) => <TeamLogo key={t} brand={brandOf(data, t)} team={t} size={isMobile ? 36 : 48} />)}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={tag(isMobile)}>{teams.length ? "DRAFTING AS THE" : "THE DRAFT IS ABOUT TO BEGIN"}</div>
        <div style={bigName(isMobile)}>{teams.length ? teams.map((t) => brandOf(data, t).Team || t).join(", ") : `${data.year} NFL Draft`}</div>
        <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 800, opacity: 0.85, fontFamily: BODY }}>
          {first ? `Your first pick: No. ${first.overall} (Round ${first.round}).` : "All 32 teams on the CPU."}
        </div>
        <button onClick={s.start} className="wd-sim-draft" style={{ marginTop: 14, border: "none", borderRadius: 999, padding: isMobile ? "10px 20px" : "12px 26px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: isMobile ? 14 : 16, letterSpacing: "0.1em", background: buttonColor, color: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,0.25)" }}>
          START THE DRAFT ▶
        </button>
      </div>
    </div>
  );
}

// Instant / Sim to My Pick: the board fills while the stage just says so.
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

function PickContent({ event, data, isMobile, look, trade }) {
  const p = event.prospect;
  const team = event.team;
  const brand = brandOf(data, team);
  const label = gradeLabel(p.avg);
  const fit = event.fit?.s;
  const schoolLogo = logoOf(p);
  const valueText = event.value === 0 ? "On the board" : event.value > 0 ? `+${event.value} value` : `${event.value} reach`;
  return (
    <div style={{ ...pad(isMobile), paddingTop: isMobile ? 14 : 22, paddingBottom: isMobile ? 14 : 22 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <TeamLogo brand={brand} team={team} size={isMobile ? 64 : 110} />
        <span style={{ background: "rgba(0,0,0,0.3)", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em" }}>NO. {event.pick.overall}</span>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, letterSpacing: "0.18em", opacity: 0.85 }}>THE {(brand.Team || team).toUpperCase()} SELECT</span>
          {trade && <span style={{ background: "rgba(0,0,0,0.38)", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 900, letterSpacing: "0.12em" }}>TRADED UP FROM {trade.from}</span>}
        </div>
        <div style={{ fontSize: isMobile ? 24 : 44, fontWeight: 900, lineHeight: 0.98, textTransform: "uppercase", margin: isMobile ? "4px 0 6px" : "6px 0 8px", overflowWrap: "anywhere" }}>
          {p.First} <br />{p.Last}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: BODY }}>
          <span style={{ background: "#fff", color: look.c1, borderRadius: 6, padding: "3px 9px", fontWeight: 900, fontSize: 13 }}>{p.Position}</span>
          {schoolLogo && <img src={schoolLogo} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />}
          <span style={{ fontWeight: 800, fontSize: isMobile ? 13 : 15 }}>{p.School}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <Stat label="Board" value={`#${p.rank}`} sub={valueText} />
          {label && <Stat label="Comm. Grade" value={label.replace(" Round", "").replace("First", "1st").replace("Second", "2nd")} />}
          {fit != null && <Stat label="Staff Fit" value={Math.round(fit)} />}
          {event.pick.via && !trade && <Stat label="Via" value={event.pick.via} />}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <span style={{ background: "rgba(0,0,0,0.28)", color: "#fff", borderRadius: 10, padding: "6px 10px", minWidth: 70 }}>
      <span style={{ display: "block", fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", opacity: 0.75 }}>{label.toUpperCase()}</span>
      <span style={{ display: "block", fontSize: 16, fontWeight: 900, lineHeight: 1.1 }}>{value}</span>
      {sub && <span style={{ display: "block", fontSize: 10, fontWeight: 800, opacity: 0.8, fontFamily: BODY }}>{sub}</span>}
    </span>
  );
}

function TradeContent({ event, data, isMobile }) {
  const to = brandOf(data, event.to);
  const from = brandOf(data, event.from);
  return (
    <div style={{ ...pad(isMobile), flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
      <div style={{ fontSize: isMobile ? 26 : 44, fontWeight: 900, letterSpacing: "0.12em" }}>TRADE ALERT</div>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 24, marginTop: 14, flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <TeamLogo brand={to} team={event.to} size={isMobile ? 54 : 84} />
          <div style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>GET {pickName(event.pick).toUpperCase()}</div>
        </div>
        <span style={{ fontSize: 30, fontWeight: 900, color: GOLD }}>⇄</span>
        <div style={{ textAlign: "center" }}>
          <TeamLogo brand={from} team={event.from} size={isMobile ? 54 : 84} />
          <div style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>GET {event.give.map((p) => pickName(p).toUpperCase()).join(" + ")}</div>
        </div>
      </div>
      {event.target && (
        <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, fontFamily: BODY, opacity: 0.9 }}>
          The {to.Team || event.to} are moving up — {event.target.First} {event.target.Last} ({event.target.Position}) is still on the board.
        </div>
      )}
    </div>
  );
}

function Stage({ s, data, isMobile }) {
  let look = NEUTRAL_LOOK;
  let key = s.phase;
  let content = null;
  let footer = null;

  const pickEvent = s.phase === "reveal" ? s.reveal?.events.filter((e) => e.type === "pick").pop() : null;
  const tradeEvent = s.phase === "reveal" ? s.reveal?.events.find((e) => e.type === "trade") : null;
  const pick = currentPick(s.sim);

  if (s.phase === "intro") {
    if (s.sim.userTeams.length === 1) look = teamLook(brandOf(data, s.sim.userTeams[0]));
    content = <IntroContent s={s} data={data} isMobile={isMobile} />;
  } else if (s.phase === "simming") {
    look = SIMMING_LOOK;
    content = <SimmingContent s={s} data={data} isMobile={isMobile} />;
  } else if (pickEvent) {
    look = teamLook(brandOf(data, pickEvent.team));
    key = `pick-${pickEvent.pick.overall}`;
    content = <PickContent event={pickEvent} data={data} isMobile={isMobile} look={look} trade={tradeEvent} />;
  } else if (tradeEvent) {
    look = TRADE_LOOK;
    key = `trade-${tradeEvent.pick.overall}`;
    content = <TradeContent event={tradeEvent} data={data} isMobile={isMobile} />;
  } else if (pick) {
    look = teamLook(brandOf(data, pick.owner));
    key = `clock-${pick.overall}-${pick.owner}`;
    content = <ClockContent s={s} data={data} isMobile={isMobile} pick={pick} />;
    if (!s.sim.userTeams.includes(pick.owner)) footer = <ClockBar s={s} pick={pick} look={look} />;
  }

  return (
    <StageFrame look={look} isMobile={isMobile} footer={footer}>
      <div key={key} className="wd-sim-in" style={{ width: "100%" }}>{content}</div>
    </StageFrame>
  );
}

// ── The Console: the tabbed panel under the stage. A fixed height with its
// own scrolling, so the page itself doesn't have to. ──
const consoleHeight = (isMobile) => (isMobile ? "58vh" : 400);
// The Draft Board can run 100 deep — it alone scrolls, inside this.
const boardHeight = (isMobile) => (isMobile ? "70vh" : 720);
const DRAFT_BTN = { flexShrink: 0, border: "none", borderRadius: 999, padding: "7px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", background: GOLD, color: "#111" };
const EMPTY = { padding: 20, color: "#6f7f99", fontSize: 13, fontFamily: BODY };

// "Your pick" strip across the top of a tab while the user's on the clock.
function YourPickBanner({ s, data, text }) {
  const pick = currentPick(s.sim);
  if (s.phase !== "user" || !pick) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "linear-gradient(90deg, rgba(246,162,29,0.2), transparent)", borderBottom: "1px solid #1f2b42" }}>
      <TeamLogo brand={brandOf(data, pick.owner)} team={pick.owner} size={28} />
      <span style={{ color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em" }}>YOUR PICK · NO. {pick.overall}</span>
      <span style={{ marginLeft: "auto", color: "#9fb0c8", fontSize: 12, fontFamily: BODY }}>{text}</span>
    </div>
  );
}

// A name that's the full one when it fits its box, else the short one
// (ellipsized if even that doesn't). Re-checked as the box resizes.
function FitName({ full, short, style }) {
  const ref = useRef(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;";
      probe.style.font = getComputedStyle(el).font;
      probe.textContent = full;
      el.appendChild(probe);
      setFits(probe.offsetWidth <= el.clientWidth);
      probe.remove();
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);
  return (
    <span ref={ref} title={full} style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", ...style }}>
      {fits ? full : short}
    </span>
  );
}

// Draft tab: the picks so far, round by round (or just the user's).
function DraftTab({ s, data, isMobile }) {
  const rounds = [...new Set(s.sim.picks.map((p) => p.round))];
  const current = currentPick(s.sim);
  const [round, setRound] = useState(null);
  const [mineOnly, setMineOnly] = useState(false);
  const shownRound = round ?? current?.round ?? rounds[0];
  const picks = mineOnly
    ? s.sim.picks.filter((p) => s.sim.userTeams.includes(p.owner))
    : s.sim.picks.filter((p) => p.round === shownRound);
  const chipBtn = (on) => ({ ...barBtn, background: on ? GOLD : "#1a2438", color: on ? "#111" : "#9fb0c8" });
  const cols = isMobile ? 2 : 4;
  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {rounds.length > 1 && rounds.map((r) => (
          <button key={r} onClick={() => { setRound(r); setMineOnly(false); }} aria-pressed={!mineOnly && shownRound === r} style={chipBtn(!mineOnly && shownRound === r)}>R{r}</button>
        ))}
        {s.sim.userTeams.length > 0 && <button onClick={() => setMineOnly((v) => !v)} aria-pressed={mineOnly} style={chipBtn(mineOnly)}>My Picks</button>}
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
                  ? <FitName full={`${pl.First} ${pl.Last}`} short={`${pl.First[0]}. ${pl.Last}`} style={{ color: "#fff", fontSize: 12, fontWeight: 900 }} />
                  : <span style={{ display: "block", color: "#55657e", fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>{live ? "On the clock" : "—"}</span>}
                {pl && <span style={{ display: "block", color: "#8b9bb4", fontSize: 10, fontWeight: 800, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.Position} {pl.School}</span>}
              </span>
            </div>
          );
        })}
      </div>
      {mineOnly && picks.length === 0 && <div style={EMPTY}>No picks for your teams in this sim.</div>}
    </div>
  );
}

// Draft Board tab: everyone still available. Drafting happens here.
function DraftBoardTab({ s, data, isMobile }) {
  const [pos, setPos] = useState("ALL");
  const [q, setQ] = useState("");
  const team = currentPick(s.sim)?.owner;
  const onClock = s.phase === "user";
  const rows = useMemo(() => available(s.sim)
    .filter((p) => (pos === "ALL" || p.Position === pos) && (!q || `${p.First} ${p.Last} ${p.School}`.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 100), [s.sim, pos, q]);

  return (
    <div>
      <YourPickBanner s={s} data={data} text="Pick a player — no clock on you." />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "10px 12px", borderBottom: "1px solid #1f2b42" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search prospects"
          style={{ flex: "1 1 140px", minWidth: 0, background: "#121c2f", border: "1px solid #24324d", borderRadius: 999, color: "#fff", padding: "6px 12px", fontSize: 13, fontFamily: BODY, outline: "none" }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["ALL", ...SIM_POSITIONS, ...SPECIALISTS].map((k) => (
            <button key={k} onClick={() => setPos(k)} aria-pressed={pos === k} style={{
              border: "none", borderRadius: 999, padding: "5px 9px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900,
              background: pos === k ? GOLD : "#1a2438", color: pos === k ? "#111" : "#9fb0c8",
            }}>{k}</button>
          ))}
        </div>
      </div>
      {rows.map((p) => {
        const fit = team ? fitFor(p, team) : null;
        const label = gradeLabel(p.avg);
        return (
          <div key={p.id} className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "8px 10px" : "9px 14px", borderBottom: "1px solid #18233a" }}>
            <span style={{ width: 30, textAlign: "right", color: "#6f7f99", fontWeight: 900, fontSize: 13, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{p.rank}</span>
            {logoOf(p) ? <img src={logoOf(p)} alt="" style={{ width: 26, height: 26, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 26, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", fontWeight: 900, fontSize: 14, textDecoration: "none", textTransform: "uppercase" }}>{p.First} {p.Last}</Link>
              <div style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>{p.Position} · {p.School}{label ? ` · ${label}` : ""}</div>
            </div>
            {fit != null && (
              <span title="Staff fit for the team on the clock" style={{ flexShrink: 0, borderRadius: 8, padding: "3px 7px", fontSize: 11, fontWeight: 900, background: fit >= 80 ? "rgba(246,162,29,0.18)" : "#16213a", color: fit >= 80 ? GOLD : "#9fb0c8" }}>
                FIT {Math.round(fit)}
              </span>
            )}
            {onClock && <button className="wd-sim-draft" onClick={() => s.draft(p.id)} style={DRAFT_BTN}>DRAFT</button>}
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

function SuggestionsTab({ s, data, isMobile }) {
  const pick = currentPick(s.sim);
  const team = pick?.owner;
  const { value, staff } = useMemo(() => (team ? suggestionsFor(s.sim, team) : { value: null, staff: [] }), [s.sim, team]);
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
  if (!pick) return <div style={EMPTY}>The draft&apos;s over.</div>;
  const brand = brandOf(data, team);
  const staffNames = data.staff[team] || {};
  const onClock = s.phase === "user";
  const shownStaff = davin ? staff.slice(0, 1) : staff;
  const grade = value ? gradeLabel(value.avg) : null;

  return (
    <div>
      <YourPickBanner s={s} data={data} text="Your war room's picks — draft one right here." />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #1f2b42" }}>
        <TeamLogo brand={brand} team={team} size={24} />
        <span style={{ color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.12em" }}>{(brand.Team || team).toUpperCase()} SUGGESTIONS</span>
        <span style={{ marginLeft: "auto", color: "#6f7f99", fontSize: 11, fontFamily: BODY }}>No. {pick.overall}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 10, padding: 12 }}>
        {value && (
          <SuggestionCard tag="VALUE PICK" accent={BLUE} p={value} onClock={onClock} s={s}
            reason={`Best player left on the We-Draft.com board — No. ${value.rank}${grade ? `, ${grade} community grade` : ""}.`} />
        )}
        {shownStaff.map(({ p, slot, score }) => {
          const who = staffNames[slot]?.n;
          return (
            <SuggestionCard key={`${slot}-${p.id}`} tag={`${slot}${who ? ` ${who.toUpperCase()}` : ""}`} accent={GOLD} p={p} onClock={onClock} s={s}
              reason={`${who ? `${SLOT_TITLE[slot]} ${who}` : `The ${SLOT_TITLE[slot].toLowerCase()}`} has drafted this kind of ${POS_WORD[p.Position] || p.Position} before — ${slot} fit ${Math.round(score)}.`} />
          );
        })}
        {davin && <DavinCard davin={davin} school={legendSchool} />}
        {!value && !shownStaff.length && !davin && <div style={EMPTY}>Nothing left to suggest.</div>}
      </div>
    </div>
  );
}

function SuggestionCard({ tag, accent, p, reason, onClock, s }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#121c2f", border: "1px solid #1f2b42", borderTop: `3px solid ${accent}`, borderRadius: 12, padding: 12, minWidth: 0 }}>
      <span style={{ alignSelf: "flex-start", background: accent, color: accent === GOLD ? "#111" : "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {logoOf(p) ? <img src={logoOf(p)} alt="" style={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0 }} /> : null}
        <span style={{ minWidth: 0 }}>
          <Link to={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", color: "#fff", fontWeight: 900, fontSize: 15, textTransform: "uppercase", textDecoration: "none", lineHeight: 1.1 }}>{p.First} {p.Last}</Link>
          <span style={{ display: "block", color: "#8b9bb4", fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginTop: 2 }}>{p.Position} {p.School} · Board #{p.rank}</span>
        </span>
      </div>
      <div style={{ color: "#c9d4e5", fontSize: 12, fontFamily: BODY, lineHeight: 1.45, flex: 1 }}>{reason}</div>
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
  const team = chosen || onClock || s.sim.userTeams[0] || NFL_TEAM_ABBRS[0];
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
        <select value={team} onChange={(e) => setChosen(e.target.value === onClock ? null : e.target.value)} aria-label="Team" style={{ ...selectStyle, marginLeft: "auto", padding: "5px 10px", fontSize: 12 }}>
          {NFL_TEAM_ABBRS.map((t) => <option key={t} value={t}>{nameOf(t)}{t === onClock ? " (on the clock)" : ""}</option>)}
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
function TradesTab({ s, data, isMobile }) {
  const userTeams = s.sim.userTeams;
  const [team, setTeam] = useState(userTeams[0] || null);
  const [partner, setPartner] = useState("");
  const [give, setGive] = useState([]);
  const [get, setGet] = useState([]);
  const [result, setResult] = useState(null);
  const pick = currentPick(s.sim);
  const includeCurrent = s.phase === "user";

  if (!userTeams.length) return <div style={EMPTY}>Trades are for your own teams — pick one in Settings.</div>;

  const mine = tradeablePicks(s.sim, team, { includeCurrent });
  const partners = NFL_TEAM_ABBRS.filter((t) => !userTeams.includes(t) && tradeablePicks(s.sim, t, { includeCurrent }).length)
    .sort((a, b) => (brandOf(data, a).Team || a).localeCompare(brandOf(data, b).Team || b));
  const theirs = partner ? tradeablePicks(s.sim, partner, { includeCurrent }) : [];
  const verdict = evaluateProposal(s.sim, { give, get });
  const toggle = (list, setList, n) => { setResult(null); setList(list.includes(n) ? list.filter((x) => x !== n) : [...list, n]); };
  const own = pick ? pickValue(s.sim.chart, pick.overall) : 0;

  const propose = () => {
    const v = s.proposeTrade({ team, partner, give, get });
    setResult(v.accept ? { ok: true, text: `Done — the ${brandOf(data, partner).Team || partner} accepted.` } : { ok: false, text: "They passed. Add more to your side." });
    if (v.accept) { setGive([]); setGet([]); }
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
      {/* Offers for the pick on the clock. */}
      <div>
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
      </div>

      {/* Propose a trade. */}
      <div>
        <div style={{ ...labelSm, marginBottom: 8 }}>Propose a Trade</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {userTeams.length > 1 && (
            <select value={team} onChange={(e) => { setTeam(e.target.value); setGive([]); setResult(null); }} aria-label="Your team" style={selectStyle}>
              {userTeams.map((t) => <option key={t} value={t}>{brandOf(data, t).Team || t}</option>)}
            </select>
          )}
          <select value={partner} onChange={(e) => { setPartner(e.target.value); setGet([]); setResult(null); }} aria-label="Trade partner" style={selectStyle}>
            <option value="">Trade with…</option>
            {partners.map((t) => <option key={t} value={t}>{brandOf(data, t).City} {brandOf(data, t).Team || t}</option>)}
          </select>
        </div>
        {partner && (
          <>
            <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
              {pickList(`YOU GIVE · ${(brandOf(data, team).Team || team).toUpperCase()}`, mine, give, (n) => toggle(give, setGive, n))}
              {pickList(`YOU GET · ${(brandOf(data, partner).Team || partner).toUpperCase()}`, theirs, get, (n) => toggle(get, setGet, n))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <span style={{ color: "#c9d4e5", fontSize: 13, fontFamily: BODY }}>
                You give <strong>{verdict.give.toLocaleString()}</strong> pts · you get <strong>{verdict.get.toLocaleString()}</strong> pts
                {give.length > 0 && get.length > 0 && (
                  <span style={{ color: verdict.accept ? "#3fb950" : GOLD, fontWeight: 800 }}>
                    {verdict.accept ? " · they'd take it" : ` · they want ${Math.ceil(verdict.get * CPU_ACCEPT_RATIO - verdict.give).toLocaleString()} more pts`}
                  </span>
                )}
              </span>
              <button onClick={propose} disabled={!give.length || !get.length} style={{ ...DRAFT_BTN, marginLeft: "auto", opacity: give.length && get.length ? 1 : 0.5, cursor: give.length && get.length ? "pointer" : "default" }}>
                PROPOSE TRADE
              </button>
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

function Console({ s, data, isMobile }) {
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
    ["suggestions", "Suggestions"],
    ["roster", "Roster"],
    ["trades", "Trades", s.sim.offers.length],
  ];
  const body = {
    desk: <SimFeed feed={s.feed} height={consoleHeight(isMobile)} isMobile={isMobile} />,
    draft: <DraftTab s={s} data={data} isMobile={isMobile} />,
    board: <DraftBoardTab s={s} data={data} isMobile={isMobile} />,
    suggestions: <SuggestionsTab s={s} data={data} isMobile={isMobile} />,
    roster: <RosterTab s={s} data={data} isMobile={isMobile} />,
    trades: <TradesTab s={s} data={data} isMobile={isMobile} />,
  }[tab];
  return (
    <div style={{ ...PANEL, marginTop: 12 }}>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "board" ? <div className="wd-sim-scroll" style={{ maxHeight: boardHeight(isMobile), overflowY: "auto" }}>{body}</div> : body}
    </div>
  );
}

// ── The picks ticker — a full-width strip across the top of the sim
// (DraftSim.jsx renders it right under the navbar). ──
export function SimTicker({ s, data }) {
  const made = s.sim.picks.filter((p) => p.selection).slice(-12).reverse();
  const items = made.map((p) => {
    const pl = s.sim.byId[p.selection];
    return `${p.overall}. ${(brandOf(data, p.owner).Team || p.owner).toUpperCase()} — ${pl.First} ${pl.Last}, ${pl.Position}, ${pl.School}`;
  });
  const up = currentPick(s.sim);
  const line = items.length
    ? items.join("     ◆     ")
    : `THE ${data.year} NFL DRAFT SIM IS UNDERWAY${up ? `     ◆     ${(brandOf(data, up.owner).Team || up.owner).toUpperCase()} ON THE CLOCK` : ""}`;
  return (
    <div style={{ display: "flex", alignItems: "stretch", overflow: "hidden", borderBottom: "1px solid #1f2b42", background: "#04080f" }}>
      <span style={{ flexShrink: 0, background: GOLD, color: "#111", fontWeight: 900, fontSize: 11, letterSpacing: "0.14em", padding: "8px 12px", display: "flex", alignItems: "center" }}>THE PICKS</span>
      <div style={{ overflow: "hidden", flex: 1, display: "flex", alignItems: "center" }}>
        <div className="wd-sim-ticker-track" style={{ display: "inline-flex", whiteSpace: "nowrap", animation: `wdSimTicker ${Math.max(70, items.length * 12)}s linear infinite`, color: "#dbe4f0", fontSize: 12, fontWeight: 800, fontFamily: BODY }}>
          <span style={{ paddingRight: 60 }}>{line}</span>
          <span style={{ paddingRight: 60 }} aria-hidden="true">{line}</span>
        </div>
      </div>
    </div>
  );
}

export default function SimBroadcast({ s, data, isMobile, onSettings }) {
  return (
    <div>
      <BroadcastBar s={s} data={data} isMobile={isMobile} onSettings={onSettings} />
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 360px", gap: 12, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <Stage s={s} data={data} isMobile={isMobile} />
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
