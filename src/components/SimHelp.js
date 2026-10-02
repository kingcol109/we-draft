// src/components/SimHelp.js
// ── /sim's "? Help" overlay: what the sim is, Lab + Drive mode, and every
// control. Opened from SimPage.js's toolbar (and once automatically on a
// first visit); Esc, the ✕, or a click outside closes it. Keep the
// controls table in step with SimPage.js's keyboard/mouse handlers.
// Dynasty is left out on purpose — it's admin-only, not part of the beta. ──
import { useEffect } from "react";

const ORANGE = "#F6A21D"; // same orange as SimPage.js

const CONTROLS = [
  ["Space", "Snap the ball. During a read option ride: pull it. On the speed option: pitch."],
  ["Mouse", "The QB's eyes and chest — where he looks is who he can read and throw to."],
  ["Click (hold + release)", "Throw at the cursor. A quick tap is a bullet, a long hold is lofted."],
  ["W A S D", "Move the QB in the pocket."],
  ["Mouse (ball carrier)", "Steer the runner — direction, and how far away sets how aggressive he runs."],
  ["A / D (ball carrier)", "Hard cut left / right."],
  ["W (ball carrier)", "Burst downhill."],
  ["Hold Z / X", "Pre-snap: show the offense's (Z) or defense's (X) play art."],
  ["P", "Pause / resume. While paused, “.” steps one frame."],
  ["V", "Vision mask — see only what your player can see."],
  ["B", "Debug view — click a player to see what he perceives and why he's doing it."],
  ["R", "Reset the play (Lab only — no do-overs in a drive)."],
];

const PLAYS = [
  ["Inside Zone (read)", "Through the ride you see through the QB's eyes. It's a give unless you hit Space to pull it; after a give the mouse steers the back."],
  ["RPO", "Click (hold + release) during the ride to pull it and throw at the cursor."],
  ["Speed Option", "The QB has it from the snap and attacks the pitch key — move the mouse to take him over, Space pitches to the back."],
  ["GT Counter Read", "Space pulls it on the backside end."],
  ["QB Draw", "He shows pass, then runs — the mouse takes him."],
];

const MODES = [
  ["Lab", "Pick any formation, play, front and coverage from the toolbar and rep it as many times as you like. R resets; auto-reset tees it back up after each play."],
  ["📖 Learn", "Pick a concept and read how it works with the field right beside the article. Each ▶ button sets up a look, draws out what's about to happen (who blocks whom, the read, the back's track), then runs the play by itself on a loop. Learn is for watching: the field doesn't take your controls, but P pauses, \".\" steps a frame, and B / V / Z / X still work for a closer look."],
  ["🏈 Drive mode", "A real drive from your own 25. Call each play from the play-call screen — the defense's call is random. Four downs to gain 10. The drive ends on a touchdown, interception, safety, or turnover on downs, and you get a recap after every snap."],
];

const TOOLBAR = [
  ["Variance", "Off: every player is exactly average, so a play runs the same every time. On: each rep every player gets his own form — usually average, sometimes quick or slow, now and then exceptional. Drive mode starts with it on."],
  ["Speed / Zoom", "Slow the play down (down to 0.1×) or zoom the camera in."],
];

const h = { fontSize: "12px", fontWeight: 900, letterSpacing: "0.08em", color: ORANGE, textTransform: "uppercase", margin: "18px 0 8px" };
const row = { display: "flex", gap: "12px", padding: "6px 0", borderBottom: "1px solid #1f2937", fontSize: "13px", lineHeight: 1.45 };
const key = { flex: "0 0 150px", fontWeight: 800, color: "#e2e8f0" };
const val = { flex: 1, color: "#cbd5e1" };

function Rows({ items }) {
  return items.map(([k, v]) => (
    <div key={k} style={row}>
      <div style={key}>{k}</div>
      <div style={val}>{v}</div>
    </div>
  ));
}

export default function SimHelp({ onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.75)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto" }}
    >
      <div
        role="dialog"
        aria-label="How the sim works"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: "720px", background: "#0f172a", border: `1px solid ${ORANGE}`, borderRadius: "10px", padding: "18px 20px 22px", color: "#e2e8f0", fontFamily: "Arial, sans-serif", boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ fontWeight: 900, fontSize: "18px", letterSpacing: "0.06em", color: ORANGE }}>HOW THE SIM WORKS</div>
          <button
            onClick={onClose}
            aria-label="Close help"
            style={{ background: "none", border: "1px solid #334155", borderRadius: "6px", color: "#94a3b8", fontSize: "14px", fontWeight: 900, padding: "4px 10px", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: "13px", lineHeight: 1.55, color: "#cbd5e1", margin: "12px 0 0" }}>
          Every player on the field thinks for himself — each one sees the play from where he stands, reads what's in front of him, and
          reacts. You control the ball: the QB on passes, and whoever's carrying it on runs and after a catch. Nothing you do here is
          saved to your account. This is a beta, so expect rough edges.
        </p>

        <div style={h}>Modes</div>
        <Rows items={MODES} />

        <div style={h}>Controls</div>
        <Rows items={CONTROLS} />

        <div style={h}>Play-specific</div>
        <Rows items={PLAYS} />

        <div style={h}>Toolbar</div>
        <Rows items={TOOLBAR} />

        <div style={{ marginTop: "18px", fontSize: "12px", color: "#64748b" }}>Press Esc or click outside to close. Open this again any time from ? Help.</div>
      </div>
    </div>
  );
}
