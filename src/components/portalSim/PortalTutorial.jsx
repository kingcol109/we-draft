// src/components/portalSim/PortalTutorial.jsx
//
// "How it works" on the Transfer Portal Sim's start screens — the setup
// screen (/portalsim) and a school's Ready screen (/portalsim/{team}) (user,
// 2026-11-18: a tutorial button that briefly explains the mechanics). A
// button that opens a short walkthrough, one step at a time. Keep the copy
// in step with the engine's rules (pages/PortalSim.jsx's header notes).
import { useEffect, useState } from "react";

const GOLD = "#f6a21d";
const LINE = "#1f2b42";

const STEPS = [
  {
    icon: "🏈", title: "Take over a program",
    body: "Pick any FBS school. You get its roster and an NIL budget that matches the program. Every window moves forward only when you hit the button in the sticky header, so take your time.",
  },
  {
    icon: "🎓", title: "Opening 1 · NFL Decisions",
    body: "Players out of eligibility are gone. Draft-eligible players weigh the NFL. The ones on the fence can be talked into staying with an NIL offer.",
  },
  {
    icon: "🚪", title: "Opening 2 · Retention",
    body: "Some of your players want out. Make them an offer to stay or let them go into the portal. Every dollar you spend keeping players comes out of your portal budget.",
  },
  {
    icon: "📋", title: "The portal opens · Evaluation",
    body: "Portal window 1 is the evaluation period, so no offers yet. Contact players to add them to My Board (contacts are limited). Your staff recommends targets and the head coach briefs you on your needs.",
  },
  {
    icon: "🧢", title: "Put your coaches to work",
    body: "Drag your head coach, coordinators and assistants onto players on your board. Every window a coach spends on a player builds his interest in your school. The head coach carries the most weight.",
  },
  {
    icon: "💰", title: "Make NIL offers",
    body: "Each player grades every school A–F on what matters to him: program, NIL, distance from home, playing time, winning and development. Lowball offers, cutting an offer or pulling one hurt his opinion of you. Players narrow their lists each window, and a big enough offer can get a commitment on the spot.",
  },
  {
    icon: "📈", title: "Market Watch",
    body: "At halftime the market shifts. Players pushed down the depth chart by new signings may enter, and stars may demand the market rate. Pay them or lose them. Then the second wave opens, and late interest counts for more.",
  },
  {
    icon: "🏆", title: "The final grade",
    body: "When the portal closes, your class is graded against every school's. You also get a money-efficiency grade (how much your roster improved per NIL dollar) and a verdict on whether your roster got better. Save it to your profile, share the image and see how it stacks up in Community.",
  },
];

// onColor: the button sits on a team-color panel (the Ready screen).
export default function PortalTutorial({ isMobile, onColor = false }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setI((n) => Math.min(STEPS.length - 1, n + 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <>
      <button type="button" onClick={() => { setI(0); setOpen(true); }} style={{
        display: "inline-flex", alignItems: "center", gap: 8, border: `2px solid ${onColor ? "rgba(255,255,255,0.55)" : "rgba(246,162,29,0.65)"}`, borderRadius: 999,
        padding: isMobile ? "8px 14px" : "9px 18px", background: "rgba(0,0,0,0.3)", color: "#fff", cursor: "pointer", fontFamily: "inherit",
        fontWeight: 900, fontSize: isMobile ? 12 : 13, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap",
      }}>
        <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: "50%", background: GOLD, color: "#111", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>?</span>
        How It Works
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="How the Transfer Portal Sim works" onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(3,7,14,0.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="wd-sim-pop" style={{ width: "100%", maxWidth: 520, background: "#0e1626", border: `1px solid ${LINE}`, borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.6)", color: "#eef2f8", fontFamily: "Arial, sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${LINE}`, background: "linear-gradient(120deg, #0d2f5c, #0a1430)" }}>
              <img src="/logos/transfer-portal-white.svg" alt="" aria-hidden="true" style={{ width: 24, height: 24 }} />
              <span style={{ flex: 1, fontWeight: 900, fontSize: 13, letterSpacing: "0.14em" }}>HOW IT WORKS</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#8b9bb4" }}>{i + 1} / {STEPS.length}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ border: "none", background: "none", color: "#fff", fontSize: 22, lineHeight: 1, cursor: "pointer", padding: "0 2px" }}>×</button>
            </div>
            {/* A fixed height (user, 2026-11-18): the modal never resizes from
                step to step — sized for the longest step, scrolling only on
                the smallest phones. */}
            <div key={i} className="wd-sim-pop" style={{ padding: isMobile ? "20px 18px" : "26px 28px", height: isMobile ? 340 : 300, boxSizing: "border-box", overflowY: "auto" }}>
              <div aria-hidden="true" style={{ fontSize: 34 }}>{step.icon}</div>
              <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, textTransform: "uppercase", marginTop: 6, lineHeight: 1.1 }}>{step.title}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(238,242,248,0.85)", marginTop: 10, lineHeight: 1.55 }}>{step.body}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderTop: `1px solid ${LINE}` }}>
              <div style={{ display: "flex", gap: 5, flex: 1 }}>
                {STEPS.map((s, n) => (
                  <button key={s.title} type="button" onClick={() => setI(n)} aria-label={`Step ${n + 1}: ${s.title}`} style={{ width: n === i ? 18 : 8, height: 8, borderRadius: 4, border: "none", padding: 0, cursor: "pointer", background: n === i ? GOLD : n < i ? "rgba(246,162,29,0.45)" : "#2a3a58", transition: "width .15s" }} />
                ))}
              </div>
              {i > 0 && <button type="button" onClick={() => setI(i - 1)} style={{ border: `1px solid ${LINE}`, background: "transparent", color: "#eef2f8", borderRadius: 999, padding: "8px 14px", fontWeight: 900, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Back</button>}
              <button type="button" onClick={() => (last ? setOpen(false) : setI(i + 1))} style={{ border: "none", background: GOLD, color: "#fff", borderRadius: 999, padding: "9px 18px", fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit" }}>
                {last ? "Let's go" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
