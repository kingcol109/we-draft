// src/components/SimRecap.js
// ── Drive mode's last-play recap (/sim): both calls, the result, and the
// story of the snap (built by sim/recap.js). Shown at the top of the
// play-call screen, so you read it while you pick the next play. ──

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

export default function SimRecap({ call, recap, driveEnd }) {
  return (
    <div style={{ marginTop: "10px", background: "#0b1224", border: "1px solid #334155", borderRadius: "8px", overflow: "hidden", color: "#e2e8f0" }}>
      {/* Result banner */}
      <div style={{ background: recap.badge.color, color: "#0b1224", padding: "6px 12px", display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", opacity: 0.75 }}>LAST PLAY</div>
        <div style={{ fontWeight: 900, fontSize: "18px", letterSpacing: "0.04em" }}>{recap.badge.text}</div>
        <div style={{ fontWeight: 700, fontSize: "13px" }}>{recap.result}</div>
      </div>

      <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "minmax(200px, 1fr) minmax(220px, 1.4fr)", gap: "12px" }}>
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
    </div>
  );
}
