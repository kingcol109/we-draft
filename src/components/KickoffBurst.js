// src/components/KickoffBurst.js
//
// The kickoff animation: played once, over the scoreboard, when a game's
// first play arrives while someone is watching (hooks/usePlayReveal.js
// kickoffAt). Both teams' colors sweep in and meet at a slant, the logos
// slam together with a flash, a football spins through, and KICKOFF lands
// in the middle. It sizes itself to its container (container query
// units), so the same component plays over /live's scoreboard and over the
// 1920×1080 broadcast scorebug.
//
// at: when it started (ms) — a late mount plays only what's left, and
// nothing once KICKOFF_MS is up. The parent must be position: relative.
import { useEffect, useState } from "react";
import { KICKOFF_MS } from "../hooks/usePlayReveal";

export const KICKOFF_BURST_STYLE = `
.kob { position: absolute; inset: 0; z-index: 30; overflow: hidden; pointer-events: none; container-type: size;
  animation: kob-out ${KICKOFF_MS}ms linear both; }
@keyframes kob-out { 0%, 86% { opacity: 1; } 100% { opacity: 0; } }
.kob-half { position: absolute; top: -10%; bottom: -10%; width: 62%; }
.kob-half.a { left: -6%; background: linear-gradient(100deg, color-mix(in srgb, var(--kac) 85%, #000) 0%, var(--kac) 70%);
  clip-path: polygon(0 0, 100% 0, 84% 100%, 0 100%); animation: kob-in-a 0.55s cubic-bezier(.2,.9,.2,1) both; }
.kob-half.h { right: -6%; background: linear-gradient(260deg, color-mix(in srgb, var(--khc) 85%, #000) 0%, var(--khc) 70%);
  clip-path: polygon(16% 0, 100% 0, 100% 100%, 0 100%); animation: kob-in-h 0.55s cubic-bezier(.2,.9,.2,1) both; }
@keyframes kob-in-a { from { transform: translateX(-105%); } to { transform: none; } }
@keyframes kob-in-h { from { transform: translateX(105%); } to { transform: none; } }
.kob-seam { position: absolute; left: 50%; top: -20%; bottom: -20%; width: 1.4cqw; margin-left: -0.7cqw; background: #f6a21d;
  transform: skewX(-9deg) scaleY(0); box-shadow: 0 0 4cqh 1cqh rgba(246,162,29,0.75); animation: kob-seam 0.4s 0.5s ease-out both; }
@keyframes kob-seam { to { transform: skewX(-9deg) scaleY(1); } }
.kob-logo { position: absolute; top: 50%; width: min(34cqh, 18cqw); height: min(34cqh, 18cqw); object-fit: contain;
  filter: drop-shadow(0 1cqh 2cqh rgba(0,0,0,0.55)); }
/* fly in, collide at the seam (with the flash), then make room for KICKOFF */
.kob-logo.a { right: 50%; animation: kob-logo-a 1.6s 0.15s both; }
.kob-logo.h { left: 50%; animation: kob-logo-h 1.6s 0.15s both; }
@keyframes kob-logo-a { 0% { transform: translate(-60cqw, -50%) rotate(-25deg); animation-timing-function: cubic-bezier(.5,0,.9,.5); }
  35% { transform: translate(0, -50%) rotate(0); animation-timing-function: ease-out; } 45% { transform: translate(-2.5cqw, -50%) rotate(-6deg) scale(1.08); animation-timing-function: cubic-bezier(.2,.9,.2,1); }
  100% { transform: translate(-30cqw, -50%) rotate(0) scale(1); } }
@keyframes kob-logo-h { 0% { transform: translate(60cqw, -50%) rotate(25deg); animation-timing-function: cubic-bezier(.5,0,.9,.5); }
  35% { transform: translate(0, -50%) rotate(0); animation-timing-function: ease-out; } 45% { transform: translate(2.5cqw, -50%) rotate(6deg) scale(1.08); animation-timing-function: cubic-bezier(.2,.9,.2,1); }
  100% { transform: translate(30cqw, -50%) rotate(0) scale(1); } }
.kob-flash { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, #fff 0%, rgba(255,255,255,0.65) 22%, transparent 60%);
  opacity: 0; animation: kob-flash 0.7s 0.7s ease-out both; }
@keyframes kob-flash { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }
.kob-ball { position: absolute; left: 0; top: 0; width: min(16cqh, 9cqw); height: min(16cqh, 9cqw); offset-path: none;
  animation: kob-ball 1.3s 0.85s cubic-bezier(.25,.6,.5,1) both; }
.kob-ball svg { width: 100%; height: 100%; animation: kob-spin 0.38s linear 8; filter: drop-shadow(0 0.6cqh 1cqh rgba(0,0,0,0.5)); }
@keyframes kob-ball { 0% { transform: translate(8cqw, 90cqh) scale(0.6); opacity: 0; } 10% { opacity: 1; }
  50% { transform: translate(48cqw, 4cqh) scale(1.15); } 100% { transform: translate(104cqw, 40cqh) scale(0.7); opacity: 1; } }
@keyframes kob-spin { to { transform: rotate(360deg); } }
.kob-word { position: absolute; left: 0; right: 0; top: 50%; text-align: center; font-weight: 900; font-style: italic; color: #fff;
  font-size: min(30cqh, 13cqw); line-height: 1; letter-spacing: 0.04em; text-transform: uppercase;
  text-shadow: 0 0.5cqh 0 rgba(0,0,0,0.35), 0 0 4cqh rgba(246,162,29,0.85);
  -webkit-text-stroke: 0.25cqh rgba(0,0,0,0.25); animation: kob-word 1.4s 1.15s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes kob-word { 0% { transform: translateY(-50%) scale(2.6); opacity: 0; letter-spacing: 0.5em; }
  45% { transform: translateY(-50%) scale(0.94); opacity: 1; letter-spacing: 0.02em; } 60%, 100% { transform: translateY(-50%) scale(1); opacity: 1; letter-spacing: 0.04em; } }
.kob-sub { position: absolute; left: 0; right: 0; top: calc(50% + min(17cqh, 7.4cqw)); text-align: center; color: #f6a21d;
  font-weight: 900; font-size: min(7cqh, 2.6cqw); letter-spacing: 0.32em; text-transform: uppercase; animation: kob-sub 0.5s 1.75s ease-out both; }
@keyframes kob-sub { from { opacity: 0; transform: translateY(1.5cqh); } to { opacity: 1; transform: none; } }
.kob-shine { position: absolute; inset: 0; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.35) 50%, transparent 65%);
  transform: translateX(-100%); animation: kob-shine 0.9s 1.9s ease-in-out both; }
@keyframes kob-shine { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) {
  .kob *, .kob *::before { animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; }
  .kob-ball, .kob-flash, .kob-shine { display: none; }
}
`;

function Ball() {
  return (
    <svg viewBox="0 0 64 40" aria-hidden="true">
      <ellipse cx="32" cy="20" rx="30" ry="17" fill="#7a3f17" stroke="#3d1f0b" strokeWidth="2" />
      <path d="M10 9c5 4 5 18 0 22M54 9c-5 4-5 18 0 22" stroke="#fff" strokeWidth="2.4" fill="none" />
      <path d="M22 20h20" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      {[25, 29, 33, 37].map((x) => <path key={x} d={`M${x} 16v8`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />)}
    </svg>
  );
}

export default function KickoffBurst({ at, away = {}, home = {}, sub = "Game on" }) {
  const left = at ? at + KICKOFF_MS - Date.now() : 0;
  const [done, setDone] = useState(left <= 0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setDone(true), left);
    return () => clearTimeout(t);
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (done || left <= 0) return null;
  const logo = (t) => t.logoDark || t.logo;
  return (
    <div className="kob" aria-label="Kickoff" role="img"
      style={{ "--kac": away.color || "#2a4a7a", "--khc": home.color || "#7a2a2a", animationDelay: `${left - KICKOFF_MS}ms` }}>
      <div className="kob-half a" />
      <div className="kob-half h" />
      <div className="kob-seam" />
      {logo(away) && <img className="kob-logo a" src={logo(away)} alt="" />}
      {logo(home) && <img className="kob-logo h" src={logo(home)} alt="" />}
      <div className="kob-flash" />
      <div className="kob-ball"><Ball /></div>
      <div className="kob-word">Kickoff</div>
      <div className="kob-sub">{sub}</div>
      <div className="kob-shine" />
    </div>
  );
}
