// src/components/SimRecap.js
// ── Drive mode's last-play recap (/sim): both calls, the result, and the
// story of the snap (built by sim/recap.js). Shown at the top of the
// play-call screen, so you read it while you pick the next play. ──

import { placementZone } from "../sim/throwFeedback";

const ORANGE = "#F6A21D";
const TONE = { good: "#4ade80", bad: "#f87171", info: "#94a3b8" };

function YardBar({ bar }) {
  // A strip from the line of scrimmage: air yards, then after the catch / run.
  const span = Math.max(10, Math.abs(bar.total), bar.air);
  const pct = (v) => `${Math.min(100, (Math.max(0, v) / span) * 100)}%`;
  const loss = bar.total < 0;
  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ position: "relative", height: "12px", background: "#1e293b", borderRadius: "6px", overflow: "hidden" }}>
        {loss ? (
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(-bar.total), background: "#f87171" }} />
        ) : (
          <>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(bar.air), background: "#60a5fa" }} />
            <div
              style={{
                position: "absolute", top: 0, bottom: 0, left: pct(bar.air),
                width: pct(Math.min(bar.after, span - Math.max(0, bar.air))), background: "#4ade80",
              }}
            />
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: "14px", marginTop: "5px", fontSize: "11px", color: "#94a3b8" }}>
        {loss ? (
          <span>
            <b style={{ color: "#f87171" }}>{Math.round(bar.total)}</b> yds
          </span>
        ) : bar.air > 0 ? (
          <>
            <span>
              <b style={{ color: "#60a5fa" }}>{Math.round(bar.air)}</b> in the air
            </span>
            <span>
              <b style={{ color: "#4ade80" }}>{Math.max(0, Math.round(bar.after))}</b> after the catch
            </span>
          </>
        ) : (
          <span>
            <b style={{ color: "#4ade80" }}>{Math.round(bar.total)}</b> on the ground
          </span>
        )}
      </div>
    </div>
  );
}

// ── The throw, after the fact: the meter as it read at the release (type,
// power, the chips) and, beside it, the receiver's upper body as the passer
// saw him with where the ball got to him. ──
const METER_TONE = { good: "#4ade80", ok: "#F6A21D", bad: "#f87171" };
function ThrowCard({ t }) {
  const fb = t.feedback;
  return (
    <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "8px", padding: "8px 10px", background: "#0055A5", border: `3px solid ${ORANGE}`, borderRadius: "6px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
          <div style={{ fontStyle: "italic", fontWeight: 900, fontSize: "15px", color: "#fff", fontFamily: "'Arial Black', Arial, sans-serif" }}>{fb.type}</div>
          <div style={{ fontWeight: 900, fontSize: "10px", color: "rgba(255,255,255,0.75)" }}>{fb.who ? `TO ${fb.who}` : "NO TARGET"}</div>
        </div>
        <div style={{ position: "relative", height: "8px", background: "rgba(0,0,0,0.35)", marginTop: "5px" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${fb.u * 100}%`, background: ORANGE }} />
          {[18, 45, 75].map((m) => <div key={m} style={{ position: "absolute", left: `${m}%`, top: "-2px", bottom: "-2px", width: "2px", background: "rgba(255,255,255,0.5)" }} />)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "7px" }}>
          {fb.chips.map((c) => (
            <span key={c.text} style={{ fontStyle: "italic", fontWeight: 900, fontSize: "10px", color: "#fff", background: "rgba(0,0,0,0.3)", borderLeft: `3px solid ${METER_TONE[c.tone]}`, padding: "2px 6px" }}>{c.text}</span>
          ))}
        </div>
        <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 800, color: "#fff" }}>
          {t.placement ? placementZone(t.placement) : `Never got to ${t.target || "him"}`}
        </div>
      </div>
      <PlayerFigure pl={t.placement} jersey={t.jersey || { color: "#0055A5", number: 88 }} />
    </div>
  );
}

// A receiver front-on, as the passer sees him — a helmet and facemask over
// his jersey (shoulder pads, team color, his number) — and the reach of his
// hands (dashed), with the ball where it got to him. Field yards → SVG: ±1.1 wide, 0–2.6 high.
function PlayerFigure({ pl, jersey }) {
  const W = 92;
  const H = 104;
  const sc = H / 2.6;
  const X = (lat) => W / 2 - lat * sc;
  const Y = (z) => H - z * sc;
  const out = pl && pl.d > 1.6;
  const bx = pl ? X(Math.max(-1.05, Math.min(1.05, pl.lat))) : null;
  const by = pl ? Y(Math.max(0.15, Math.min(2.5, pl.z))) : null;
  const skin = "#c68b59";
  const dark = "#0b1220";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Where the throw got to the receiver" style={{ flex: "none" }}>
      {/* the reach of his hands */}
      <rect x={X(0.75)} y={Y(2.35)} width={1.5 * sc} height={1.8 * sc} rx="6" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
      {/* jersey (torso) */}
      <path
        d={`M ${X(0.3)} ${Y(1.6)} L ${X(-0.3)} ${Y(1.6)} L ${X(-0.26)} ${Y(0.85)} L ${X(0.26)} ${Y(0.85)} Z`}
        fill={jersey.color} stroke={dark} strokeWidth="1.2"
      />
      {/* shoulder pads */}
      <path
        d={`M ${X(0.47)} ${Y(1.5)} Q ${X(0.45)} ${Y(1.74)} ${X(0.16)} ${Y(1.73)} L ${X(-0.16)} ${Y(1.73)} Q ${X(-0.45)} ${Y(1.74)} ${X(-0.47)} ${Y(1.5)} Z`}
        fill={jersey.color} stroke={dark} strokeWidth="1.2"
      />
      {/* number */}
      <text x={X(0)} y={Y(1.2)} textAnchor="middle" dominantBaseline="middle" fontSize={0.36 * sc} fontWeight="900" fill="#fff" stroke={dark} strokeWidth="0.8" paintOrder="stroke" fontFamily="'Arial Black', Arial, sans-serif">
        {jersey.number}
      </text>
      {/* helmet + facemask */}
      <ellipse cx={X(0)} cy={Y(1.9)} rx={0.15 * sc} ry={0.17 * sc} fill={jersey.color} stroke={dark} strokeWidth="1.2" />
      <rect x={X(0.1)} y={Y(1.86)} width={0.2 * sc} height={0.13 * sc} rx="2" fill={skin} />
      <path d={`M ${X(0.11)} ${Y(1.84)} L ${X(-0.11)} ${Y(1.84)} M ${X(0.11)} ${Y(1.78)} L ${X(-0.11)} ${Y(1.78)} M ${X(0)} ${Y(1.86)} L ${X(0)} ${Y(1.73)}`} stroke="#e5e7eb" strokeWidth="1.4" />
      {/* the ball */}
      {pl && <ellipse cx={bx} cy={by} rx="7" ry="4.5" transform={`rotate(-30 ${bx} ${by})`} fill={out ? "#f87171" : "#8b4a1c"} stroke={out ? "#7f1d1d" : ORANGE} strokeWidth="1.5" />}
    </svg>
  );
}

export default function SimRecap({ call, recap, driveEnd }) {
  return (
    <div style={{ marginTop: "10px", maxWidth: "680px", background: "#0b1224", border: "1px solid #334155", borderRadius: "8px", overflow: "hidden", color: "#e2e8f0" }}>
      {/* Result banner */}
      <div style={{ background: recap.badge.color, color: "#0b1224", padding: "6px 12px", display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", opacity: 0.75 }}>LAST PLAY</div>
        <div style={{ fontWeight: 900, fontSize: "18px", letterSpacing: "0.04em" }}>{recap.badge.text}</div>
        <div style={{ fontWeight: 700, fontSize: "13px" }}>{recap.result}</div>
      </div>

      <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "minmax(180px, 0.9fr) minmax(200px, 1.1fr)", gap: "10px" }}>
        {/* The calls + yardage */}
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div style={{ background: "#0f172a", borderRadius: "6px", padding: "6px 8px", borderLeft: "3px solid #60a5fa" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", color: "#60a5fa" }}>OFFENSE{call.offTeam ? ` · ${call.offTeam}` : ""}</div>
              <div style={{ fontWeight: 900, fontSize: "13px", marginTop: "2px" }}>{call.name}</div>
              {call.formation && <div style={{ fontSize: "11px", color: "#94a3b8" }}>{call.formation}</div>}
            </div>
            <div style={{ background: "#0f172a", borderRadius: "6px", padding: "6px 8px", borderLeft: `3px solid ${ORANGE}` }}>
              <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", color: ORANGE }}>DEFENSE{call.defTeam ? ` · ${call.defTeam}` : ""}</div>
              <div style={{ fontWeight: 900, fontSize: "13px", marginTop: "2px" }}>{call.coverage || call.defense}</div>
              {call.front && <div style={{ fontSize: "11px", color: "#94a3b8" }}>{call.front} front</div>}
            </div>
          </div>
          {recap.bar && <YardBar bar={recap.bar} />}
        </div>

        {/* The story of the snap */}
        <div>
          {recap.lines.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "5px" }}>
              {recap.lines.map((l, i) => (
                <li key={i} style={{ display: "flex", gap: "8px", alignItems: "baseline", fontSize: "13px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: TONE[l.tone], flex: "none", transform: "translateY(-1px)" }} />
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: "13px", color: "#94a3b8" }}>{recap.result}</div>
          )}
          {driveEnd && (
            <div
              style={{
                marginTop: "8px", padding: "6px 8px", borderRadius: "6px", fontSize: "12px",
                background: driveEnd.kind === "td" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.12)",
                border: `1px solid ${driveEnd.kind === "td" ? "#4ade80" : "#f87171"}`,
              }}
            >
              <b>Drive {driveEnd.n} over</b> — {driveEnd.text} ({driveEnd.summary}). New drive from your own 25.
            </div>
          )}
        </div>
      </div>
      {recap.throw && (
        <div style={{ padding: "0 12px 12px" }}>
          <ThrowCard t={recap.throw} />
        </div>
      )}
    </div>
  );
}
