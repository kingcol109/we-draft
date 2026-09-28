// src/components/SimPlayCall.js
// ── Drive mode's play-call screen (/sim): pick a formation, then a play —
// each card is the real formation and play art, drawn by the sim's own
// renderer. The defense is picked at random by the page. ──

import { useEffect, useRef, useState } from "react";
import { SimEngine } from "../sim/engine";
import { OFFENSE_PLAYS, FORMATIONS } from "../sim/playbook";
import { LOS } from "../sim/field";
import { drawPlayCard } from "../sim/render";
import { downLabel, spotLabel } from "../sim/drive";
import SimRecap from "./SimRecap";

const ORANGE = "#F6A21D";
const TYPE = { run: ["RUN", "#4ade80"], pass: ["PASS", "#60a5fa"] };

function PlayCard({ formation, play, onPick }) {
  const ref = useRef(null);
  const def = OFFENSE_PLAYS[play];
  useEffect(() => {
    const c = ref.current;
    const dpr = window.devicePixelRatio || 1;
    const W = 190;
    const H = 124;
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    // A throwaway engine, built at the current spot so the live play's
    // line of scrimmage is left alone.
    const e = new SimEngine({ formation, play, front: "4-3", coverage: "cover3", ballOn: LOS, lineToGain: LOS + 10 });
    drawPlayCard(c.getContext("2d"), e, W, H, dpr);
  }, [formation, play]);
  const [tag, color] = def.fake ? ["PLAY ACTION", "#f472b6"] : TYPE[def.type] || ["", "#94a3b8"];
  return (
    <button
      onClick={() => onPick(formation, play)}
      style={{
        background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", padding: "6px", cursor: "pointer",
        textAlign: "left", color: "#e2e8f0",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = ORANGE)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#334155")}
    >
      <canvas ref={ref} style={{ display: "block", borderRadius: "4px" }} />
      <div style={{ marginTop: "5px", fontWeight: 900, fontSize: "13px" }}>{def.label}</div>
      <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", color }}>{tag}</div>
    </button>
  );
}

export default function SimPlayCall({ drive, last, driveEnd, recap, onPick, onClose }) {
  const forms = Object.keys(FORMATIONS);
  const [formation, setFormation] = useState(forms[0]);
  const plays = Object.keys(OFFENSE_PLAYS).filter((k) => OFFENSE_PLAYS[k].formations.includes(formation));
  return (
    <div
      style={{
        position: "absolute", inset: 0, background: "rgba(2,6,23,0.93)", borderRadius: "6px", padding: "14px 16px",
        overflowY: "auto", zIndex: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "14px", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: "20px", color: ORANGE, letterSpacing: "0.04em" }}>{downLabel(drive)}</div>
        <div style={{ fontWeight: 700, color: "#cbd5e1" }}>Ball on the {spotLabel(drive.ballOn)}</div>
        <div style={{ color: "#94a3b8", fontSize: "12px" }}>Drive {drive.n}</div>
        <div style={{ flex: 1 }} />
        {onClose && (
          <button onClick={onClose} style={{ background: "none", border: "1px solid #475569", color: "#cbd5e1", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontWeight: 700, fontSize: "12px" }}>
            Keep current call
          </button>
        )}
      </div>

      {recap && <SimRecap call={recap.call} recap={recap.recap} driveEnd={recap.driveEnd} />}
      {!recap && driveEnd && (
        <div style={{ marginTop: "8px", padding: "8px 10px", borderRadius: "6px", background: driveEnd.kind === "td" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.12)", border: `1px solid ${driveEnd.kind === "td" ? "#4ade80" : "#f87171"}` }}>
          <b>Drive {driveEnd.n} over — {driveEnd.text}</b> <span style={{ color: "#94a3b8" }}>({driveEnd.summary})</span>. New drive from your own 25.
        </div>
      )}
      {!recap && last && !driveEnd && (
        <div style={{ marginTop: "6px", fontSize: "12px", color: "#cbd5e1" }}>
          Last play: <b>{last.call}</b> vs <b>{last.defense}</b> — {last.text}
        </div>
      )}

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "12px" }}>
        {forms.map((f) => (
          <button
            key={f}
            onClick={() => setFormation(f)}
            style={{
              padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.04em",
              border: `1px solid ${f === formation ? ORANGE : "#475569"}`,
              background: f === formation ? "rgba(246,162,29,0.18)" : "#1e293b",
              color: f === formation ? ORANGE : "#e2e8f0",
            }}
          >
            {FORMATIONS[f].label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(204px, 1fr))", gap: "10px", marginTop: "12px" }}>
        {plays.map((k) => (
          <PlayCard key={`${formation}:${k}`} formation={formation} play={k} onPick={onPick} />
        ))}
      </div>
      <div style={{ marginTop: "10px", fontSize: "11px", color: "#64748b" }}>
        The defense's call is random each snap. Pick a play, then snap with Space.
      </div>
    </div>
  );
}
