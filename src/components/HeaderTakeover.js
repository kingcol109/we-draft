// src/components/HeaderTakeover.js
//
// The live scoreboard's big-moment takeover (LivePage.js GameView): after a
// touchdown, field goal, safety or turnover — and when the game ends — the
// board becomes that team's. No wipe: the board's own two colors morph (the
// other team's half turns into the scoring team's color — LivePage.js
// swaps --ac / --hc, registered below as animatable colors), then the
// team's full color, its second color (continuous moving stripes, a glow,
// the label and badge) and the logo already on the board — lifted off its
// spot, moving toward the middle and growing — come up over it, with the
// call beside it. At the end it all fades and the logo goes back to its
// place; LivePage.js then counts the score up to the new total.
//
//   kind: "td" | "pick6" | "fumble6" | "kr6" | "pr6" | "fg" | "int" | "fumble" | "safety" | "win"
//   (pick6 / fumble6 — a defensive touchdown off an interception / fumble —
//   and kr6 / pr6 — a kick / punt returned for a touchdown — get their own:
//   a giant 6; a lightning streak for the pick, a loose-ball bounce on the
//   logo for the fumble, speed streaks and the logo sprinting the length of
//   the board for a return)
//   side: "away" | "home" — the team the moment belongs to
//   game: { away, home } — color, color2, mascot, logo, logoDark, short/school
// The scoreboard hides its own logo for `side` while this runs (the
// .wdl-mu.tk-away / .tk-home class), so the moving logo reads as the same one.
import { useEffect, useLayoutEffect, useRef } from "react";
import { teamShort } from "../utils/live";

const CALLS = {
  td: { word: "Touchdown", pts: "+6", ms: 5000 },
  pick6: { word: "Pick-6", pts: "+6", ms: 5800 },
  fumble6: { word: "Fumble-6", pts: "+6", ms: 5800 },
  kr6: { word: "Kick return TD", pts: "+6", ms: 5800 },
  pr6: { word: "Punt return TD", pts: "+6", ms: 5800 },
  fg: { word: "Field goal", pts: "+3", ms: 4300 },
  safety: { word: "Safety", pts: "+2", ms: 4300 },
  int: { word: "Interception", pts: null, ms: 4600 },
  fumble: { word: "Fumble recovery", pts: null, ms: 4600 },
  win: { word: "Win", pts: null, ms: 7200 },
};
export const TAKEOVER_POINTS = { td: 6, pick6: 6, fumble6: 6, kr6: 6, pr6: 6, fg: 3, safety: 2 };
const OUT_MS = 800;
// Stripe period (px, across the stripes) and the horizontal shift that moves
// the pattern by exactly one period at -58deg — so the loop is seamless.
const STRIPE = 46;
const STRIPE_SHIFT = (STRIPE / Math.sin((58 * Math.PI) / 180)).toFixed(2);

export const TAKEOVER_STYLE = `
/* the board's team colors animate when they change (the morph) */
@property --ac { syntax: "<color>"; inherits: true; initial-value: #2a4a7a; }
@property --hc { syntax: "<color>"; inherits: true; initial-value: #7a2a2a; }
.wdl-mu { transition: --ac 0.9s ease-in-out, --hc 0.9s ease-in-out; }
.tk { position: absolute; inset: 0; z-index: 6; overflow: hidden; pointer-events: none; }
/* everything but the logo fades at the end (the logo flies home instead) */
.tk-layers { position: absolute; inset: 0; animation: tk-out ${OUT_MS}ms ease-in calc(var(--ms) - ${OUT_MS}ms) forwards; }
@keyframes tk-out { to { opacity: 0; } }
/* full color, rising from where the logo lands */
.tk-fill { position: absolute; inset: 0;
  background: radial-gradient(ellipse 75% 120% at var(--gx) 50%, color-mix(in srgb, var(--tc) 78%, #fff) 0%, var(--tc) 45%, color-mix(in srgb, var(--tc) 55%, #000) 100%);
  animation: tk-in 0.9s ease-out 0.3s both; }
@keyframes tk-in { from { opacity: 0; } to { opacity: 1; } }
/* second color: one continuous stripe pattern sliding, plus a glow */
.tk-stripes { position: absolute; inset: -80px -120px;
  background: repeating-linear-gradient(-58deg, color-mix(in srgb, var(--tc2) 30%, transparent) 0 14px, transparent 14px ${STRIPE}px);
  animation: tk-in 0.6s ease-out 0.9s both, tk-slide 1.4s linear 0.9s infinite; }
@keyframes tk-slide { from { transform: translateX(0); } to { transform: translateX(${STRIPE_SHIFT}px); } }
.tk-glow { position: absolute; inset: 0; background: radial-gradient(ellipse 40% 90% at var(--gx) 50%, color-mix(in srgb, var(--tc2) 42%, transparent), transparent 70%);
  animation: tk-in 0.6s ease-out 1s both; }
.tk-shine { position: absolute; top: -20%; bottom: -20%; width: 26%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent);
  animation: tk-shine 1.1s ease-out 1s both; }
.tk.home .tk-shine { animation-name: tk-shine-r; }
@keyframes tk-shine { from { left: -40%; transform: skewX(-20deg); } to { left: 120%; transform: skewX(-20deg); } }
@keyframes tk-shine-r { from { left: 120%; transform: skewX(20deg); } to { left: -40%; transform: skewX(20deg); } }
.tk-ring { position: absolute; left: var(--x1); top: var(--y1); width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; border: 4px solid var(--tc2);
  opacity: 0; animation: tk-ring 1.1s ease-out 1.05s forwards; }
@keyframes tk-ring { from { transform: scale(0.3); opacity: 0.9; } to { transform: scale(16); opacity: 0; } }
/* the board's own logo, lifted off its spot: moves toward the middle and grows */
.tk-logo { position: absolute; object-fit: contain; filter: drop-shadow(0 10px 24px rgba(0,0,0,0.5));
  left: var(--x1); top: var(--y1); width: var(--w1); height: var(--w1); margin: calc(var(--w1) / -2) 0 0 calc(var(--w1) / -2);
  animation: tk-logo-go 1.05s cubic-bezier(.45,0,.2,1.15) 0.25s both, tk-bob 1.8s ease-in-out 1.4s infinite, tk-logo-back ${OUT_MS}ms cubic-bezier(.6,0,.4,1) calc(var(--ms) - ${OUT_MS}ms) forwards; }
@keyframes tk-logo-go {
  from { left: var(--x0); top: var(--y0); width: var(--w0); height: var(--w0); margin: calc(var(--w0) / -2) 0 0 calc(var(--w0) / -2); }
  to { left: var(--x1); top: var(--y1); width: var(--w1); height: var(--w1); margin: calc(var(--w1) / -2) 0 0 calc(var(--w1) / -2); } }
@keyframes tk-logo-back {
  from { left: var(--x1); top: var(--y1); width: var(--w1); height: var(--w1); margin: calc(var(--w1) / -2) 0 0 calc(var(--w1) / -2); }
  to { left: var(--x0); top: var(--y0); width: var(--w0); height: var(--w0); margin: calc(var(--w0) / -2) 0 0 calc(var(--w0) / -2); } }
@keyframes tk-bob { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-5px) rotate(var(--tilt)); } }
/* the call, on the open side of the logo */
.tk-text { position: absolute; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; color: #fff; text-shadow: 0 4px 18px rgba(0,0,0,0.45); }
.tk.away .tk-text { left: calc(var(--x1) + var(--w1) / 2 + clamp(12px, 2.4vw, 34px)); right: 3%; align-items: flex-start; }
.tk.home .tk-text { right: calc(100% - var(--x1) + var(--w1) / 2 + clamp(12px, 2.4vw, 34px)); left: 3%; align-items: flex-end; text-align: right; }
.tk-team { font-weight: 900; font-size: clamp(12px, 1.5vw, 22px); letter-spacing: 0.22em; text-transform: uppercase; color: var(--tc2); text-shadow: 0 2px 8px rgba(0,0,0,0.5);
  animation: tk-rise 0.45s ease-out 0.95s both; }
.tk-line { display: flex; align-items: center; gap: clamp(8px, 1.2vw, 16px); }
.tk.home .tk-line { flex-direction: row-reverse; }
.tk-word { font-weight: 900; font-size: clamp(24px, 4.6vw, 68px); line-height: 0.95; letter-spacing: 0.01em; text-transform: uppercase; font-style: italic;
  animation: tk-slam 0.6s cubic-bezier(.2,1.3,.4,1) 1s both; }
@keyframes tk-rise { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes tk-slam { 0% { transform: scale(2.2); opacity: 0; filter: blur(10px); } 60% { transform: scale(0.95); opacity: 1; filter: blur(0); } 100% { transform: scale(1); } }
.tk-pts { flex-shrink: 0; font-weight: 900; font-size: clamp(24px, 4vw, 60px); line-height: 1.1; color: #fff; border: 3px solid var(--tc2);
  border-radius: 14px; padding: 0 12px; background: color-mix(in srgb, var(--tc2) 22%, rgba(0,0,0,0.15)); animation: tk-pop 0.5s cubic-bezier(.2,1.6,.4,1) 1.4s both; }
@keyframes tk-pop { from { transform: scale(0) rotate(-12deg); } to { transform: none; } }
/* turnovers: the call shakes */
.tk.int .tk-word, .tk.fumble .tk-word { animation: tk-slam 0.6s cubic-bezier(.2,1.3,.4,1) 1s both, tk-shake 0.5s ease-in-out 1.6s 2; }
@keyframes tk-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-8px) rotate(-1deg); } 40% { transform: translateX(7px) rotate(1deg); } 60% { transform: translateX(-5px); } 80% { transform: translateX(4px); } }
/* pick-6 / fumble-6: a giant 6 behind the call */
.tk-six { position: absolute; top: 50%; font-weight: 900; font-style: italic; line-height: 1; font-size: clamp(160px, 26vw, 360px); color: transparent;
  -webkit-text-stroke: 3px color-mix(in srgb, var(--tc2) 70%, transparent); text-shadow: 0 0 40px color-mix(in srgb, var(--tc2) 35%, transparent);
  animation: tk-six-in 0.9s cubic-bezier(.2,1.2,.3,1) 0.55s both, tk-six-pulse 1.4s ease-in-out 1.5s infinite; }
.tk.away .tk-six { right: 6%; }
.tk.home .tk-six { left: 6%; }
@keyframes tk-six-in { from { transform: translateY(-50%) scale(3.2) rotate(-25deg); opacity: 0; } to { transform: translateY(-50%) scale(1) rotate(-8deg); opacity: 0.9; } }
@keyframes tk-six-pulse { 0%, 100% { transform: translateY(-50%) scale(1) rotate(-8deg); } 50% { transform: translateY(-50%) scale(1.05) rotate(-8deg); } }
/* pick-6: a lightning streak cuts across — the ball taken the other way */
.tk-bolt { position: absolute; top: 46%; height: 10px; left: -10%; right: -10%; transform: skewY(-9deg); background: linear-gradient(90deg, transparent, var(--tc2) 30%, #fff 50%, var(--tc2) 70%, transparent);
  box-shadow: 0 0 22px var(--tc2), 0 0 44px color-mix(in srgb, var(--tc2) 60%, transparent); opacity: 0; animation: tk-bolt 0.55s ease-out 0.6s both, tk-bolt 0.45s ease-out 1.9s forwards; }
.tk.home .tk-bolt { transform: skewY(9deg); }
@keyframes tk-bolt { 0% { clip-path: inset(0 100% 0 0); opacity: 1; } 55% { clip-path: inset(0 0 0 0); opacity: 1; } 100% { clip-path: inset(0 0 0 100%); opacity: 0; } }
.tk.home .tk-bolt { animation-name: tk-bolt-r, tk-bolt-r; }
@keyframes tk-bolt-r { 0% { clip-path: inset(0 0 0 100%); opacity: 1; } 55% { clip-path: inset(0 0 0 0); opacity: 1; } 100% { clip-path: inset(0 100% 0 0); opacity: 0; } }
.tk.pick6 .tk-word { animation: tk-slam 0.6s cubic-bezier(.2,1.3,.4,1) 1s both, tk-shake 0.45s ease-in-out 1.65s 2; }
/* fumble-6: the logo comes off its spot like a loose ball — bouncing — then settles */
.tk.fumble6 .tk-logo { animation: tk-logo-go 1.05s cubic-bezier(.45,0,.2,1.15) 0.25s both, tk-loose 1.3s ease-out 0.35s both, tk-bob 1.8s ease-in-out 1.8s infinite,
  tk-logo-back ${OUT_MS}ms cubic-bezier(.6,0,.4,1) calc(var(--ms) - ${OUT_MS}ms) forwards; }
@keyframes tk-loose {
  0% { transform: translateY(0) rotate(0); } 18% { transform: translateY(-34px) rotate(-70deg); } 34% { transform: translateY(0) rotate(-140deg); }
  48% { transform: translateY(-20px) rotate(-200deg); } 62% { transform: translateY(0) rotate(-260deg); } 74% { transform: translateY(-9px) rotate(-310deg); }
  86% { transform: translateY(0) rotate(-350deg); } 100% { transform: translateY(0) rotate(-360deg); } }
.tk.fumble6 .tk-word { animation: tk-slam 0.6s cubic-bezier(.2,1.3,.4,1) 1.05s both, tk-shake 0.45s ease-in-out 1.7s 2; }
/* kick / punt return TD: speed streaks, and the logo sprints in from the far
   end of the board (the return) before it settles */
.tk-speed { position: absolute; inset: 0; overflow: hidden; opacity: 0; animation: tk-in 0.3s ease-out 0.25s both, tk-fade-out 0.6s ease-in 2s forwards; }
.tk-speed i { position: absolute; left: 0; height: 3px; width: 38%; border-radius: 2px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--tc2) 80%, #fff)); }
.tk.away .tk-speed i { animation: tk-streak-r 0.55s linear infinite; }
.tk.home .tk-speed i { animation: tk-streak-l 0.55s linear infinite; background: linear-gradient(270deg, transparent, color-mix(in srgb, var(--tc2) 80%, #fff)); }
@keyframes tk-streak-r { from { transform: translateX(-120%); } to { transform: translateX(320%); } }
@keyframes tk-streak-l { from { transform: translateX(320%); } to { transform: translateX(-120%); } }
.tk.kr6 .tk-logo, .tk.pr6 .tk-logo { animation: tk-logo-go 1.05s cubic-bezier(.45,0,.2,1.15) 0.25s both, tk-sprint 1.1s cubic-bezier(.15,.85,.25,1) 0.25s both, tk-bob 1.8s ease-in-out 1.6s infinite,
  tk-logo-back ${OUT_MS}ms cubic-bezier(.6,0,.4,1) calc(var(--ms) - ${OUT_MS}ms) forwards; }
@keyframes tk-sprint { 0% { transform: translateX(var(--sprint)) skewX(var(--lean)); } 70% { transform: translateX(0) skewX(var(--lean)); } 85% { transform: translateX(calc(var(--sprint) * -0.04)) skewX(0); } 100% { transform: none; } }
.tk.kr6 .tk-word, .tk.pr6 .tk-word { animation: tk-slam 0.6s cubic-bezier(.2,1.3,.4,1) 1.05s both; }
/* win: confetti in both colors */
.tk-confetti { position: absolute; top: -20px; width: 8px; height: 14px; border-radius: 2px; animation: tk-fall linear both; }
/* hidden until its own delay is up (fill: both shows the first frame
   early), then it drops in from above the board */
@keyframes tk-fall { 0% { transform: translateY(0) rotate(0); opacity: 0; } 4% { opacity: 1; } 100% { transform: translateY(420px) rotate(720deg); opacity: 0.2; } }
/* the scoreboard's own logo hides while it's lifted */
.wdl-mu.tk-away .wdl-mu-team.away .wdl-mu-logo, .wdl-mu.tk-home .wdl-mu-team.home .wdl-mu-logo { visibility: hidden; }
/* the score counting up afterwards (LivePage.js ScoreNum) */
.wdl-score-bump { animation: wdl-score-bump 1s cubic-bezier(.2,1.4,.4,1) both !important; }
@keyframes wdl-score-bump { 0% { transform: scale(1); } 25% { transform: scale(1.32); color: var(--bump, #fff); text-shadow: 0 0 34px var(--bump, #fff); } 100% { transform: scale(1); } }
`;

const SPEED = Array.from({ length: 14 }, (_, i) => ({ top: 6 + ((i * 41) % 88), delay: -((i * 0.13) % 0.55), o: 0.35 + ((i * 7) % 6) / 10 }));
const CONFETTI = Array.from({ length: 44 }, (_, i) => ({
  left: (i * 37) % 100, delay: 1.1 + (i % 11) * 0.17, dur: 2.2 + ((i * 7) % 10) / 6, kind: i % 3,
}));

// "Trojans" → "Trojans win"; a singular mascot ("Crimson Tide") wins.
const winWord = (name) => (/s$/i.test(name) && !/ss$/i.test(name) ? "win" : "wins");

export default function HeaderTakeover({ kind, side, game, onDone }) {
  const call = CALLS[kind] || CALLS.td;
  const ref = useRef(null);
  useEffect(() => {
    const t = setTimeout(onDone, call.ms);
    return () => clearTimeout(t);
  }, [call.ms, onDone]);

  // Start where the board's logo is; end toward the middle, bigger.
  useLayoutEffect(() => {
    const el = ref.current;
    const board = el?.closest(".wdl-mu") || el?.parentElement;
    if (!el || !board) return;
    const b = board.getBoundingClientRect();
    if (!b.width) return;
    const logoEl = board.querySelector(`.wdl-mu-team.${side} .wdl-mu-logo`);
    const r = logoEl?.getBoundingClientRect();
    const w0 = r?.width || Math.min(110, b.height * 0.45);
    const x0 = r ? r.left - b.left + r.width / 2 : (side === "away" ? b.width * 0.1 : b.width * 0.9);
    const y0 = r ? r.top - b.top + r.height / 2 : b.height * 0.4;
    const w1 = Math.min(b.height * 0.78, Math.max(w0 * 1.55, 90), b.width * 0.26);
    const x1 = side === "away" ? b.width * 0.22 : b.width * 0.78;
    const set = (k, v) => el.style.setProperty(k, `${Math.round(v)}px`);
    set("--x0", x0); set("--y0", y0); set("--w0", w0);
    set("--x1", x1); set("--y1", b.height / 2); set("--w1", w1);
    el.style.setProperty("--gx", side === "away" ? "22%" : "78%");
  }, [side]);

  const team = game?.[side] || {};
  const color = team.color || "#1d2840";
  const color2 = team.color2 || "#ffffff";
  const logo = team.logoDark || team.logo;
  const name = team.mascot || teamShort(team);
  return (
    <div ref={ref} className={`tk ${side} ${kind}`} style={{
      "--tc": color, "--tc2": color2, "--ms": `${call.ms}ms`, "--tilt": side === "away" ? "-4deg" : "4deg",
      "--sprint": side === "away" ? "-70vw" : "70vw", "--lean": side === "away" ? "-14deg" : "14deg",
    }} aria-live="polite">
      <div className="tk-layers">
        <div className="tk-fill" />
        <div className="tk-stripes" />
        <div className="tk-glow" />
        <div className="tk-shine" />
        {kind !== "win" && <div className="tk-ring" />}
        {["pick6", "fumble6", "kr6", "pr6"].includes(kind) && <div className="tk-six">6</div>}
        {(kind === "kr6" || kind === "pr6") && (
          <div className="tk-speed">{SPEED.map((x, i) => <i key={i} style={{ top: `${x.top}%`, animationDelay: `${x.delay}s`, opacity: x.o }} />)}</div>
        )}
        {kind === "pick6" && <div className="tk-bolt" />}
        {kind === "win" && CONFETTI.map((c, i) => (
          <span key={i} className="tk-confetti" style={{ left: `${c.left}%`, background: c.kind === 0 ? "#fff" : c.kind === 1 ? color2 : `color-mix(in srgb, ${color} 60%, #fff)`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }} />
        ))}
        <div className="tk-text">
          <div className="tk-team">{kind === "win" ? "Final" : name}</div>
          <div className="tk-line">
            <div className="tk-word">{kind === "win" ? `${name} ${winWord(name)}` : call.word}</div>
            {call.pts && <div className="tk-pts">{call.pts}</div>}
          </div>
        </div>
      </div>
      {logo && <img className="tk-logo" src={logo} alt="" />}
    </div>
  );
}

// The takeover a newly revealed play calls for, or null: a touchdown (the
// scoring team — a pick-six belongs to the defense), a made field goal, a
// safety, or a turnover (the team that took the ball).
export function takeoverForPlay(play) {
  const pr = play?.presentation || {};
  if (!play || pr.nullified || play.hidden) return null;
  const other = (s) => (s === "home" ? "away" : s === "away" ? "home" : null);
  const scorer = pr.creditSide || play.offense;
  // A defensive touchdown: an interception or a lost fumble returned for six.
  const defense = pr.creditSide && pr.creditSide !== play.offense ? pr.creditSide : other(play.offense);
  if (pr.touchdown && (pr.type === "interception" || pr.interception)) return { kind: "pick6", side: defense };
  if (pr.touchdown && (pr.type === "fumble" || pr.fumble) && (pr.turnover || (pr.creditSide && pr.creditSide !== play.offense))) return { kind: "fumble6", side: defense };
  if (pr.touchdown && (pr.type === "kickoff" || pr.type === "punt")) {
    return { kind: pr.type === "kickoff" ? "kr6" : "pr6", side: pr.creditSide || pr.players?.returner?.side || other(play.offense) };
  }
  if (pr.touchdown) return { kind: "td", side: scorer };
  if (pr.type === "field_goal" && /^FIELD GOAL$/.test(pr.headline || "")) return { kind: "fg", side: scorer };
  if (pr.type === "safety") return { kind: "safety", side: pr.creditSide || other(play.offense) };
  if (pr.turnover) return { kind: /intercept/i.test(`${pr.headline || ""} ${play.text || ""}`) ? "int" : "fumble", side: other(play.offense) };
  return null;
}

// A scoring takeover's team, checked against whose score actually went up
// on the play (prev: the score shown before it). The parser's credit can be
// wrong on odd plays — a sack-fumble returned for a TD credited to the
// offense, a muffed kick recovered in the end zone by the kicking team —
// so the score decides; a TD by the side without the ball becomes a
// Fumble-6 (the defense, or the kicking team on a kick / punt).
export function checkScorer(t, play, prev) {
  if (!t || !play || !prev || play.homeScore == null || play.awayScore == null || prev.home == null || prev.away == null) return t;
  if (!["td", "pick6", "fumble6", "kr6", "pr6", "fg", "safety"].includes(t.kind)) return t;
  const dh = play.homeScore - prev.home;
  const da = play.awayScore - prev.away;
  const side = dh > 0 && da <= 0 ? "home" : da > 0 && dh <= 0 ? "away" : null;
  if (!side || side === t.side) return t;
  const pr = play.presentation || {};
  if (t.kind === "td" && side !== play.offense && (pr.fumble || pr.type === "fumble")) return { ...t, kind: "fumble6", side };
  if ((t.kind === "kr6" || t.kind === "pr6") && side === play.offense) return { ...t, kind: "fumble6", side };
  return { ...t, side };
}
