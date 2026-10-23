// src/components/draftSim/SimFeed.jsx
//
// Draft Sim's live feed — the analyst desk's posts (utils/draftSim/
// analysts.js) as a social timeline, newest on top, plus the desk lineup
// with anyone not live yet marked "coming soon".
import { useState } from "react";
import { ANALYSTS } from "../../utils/draftSim/analysts";

const FILTERS = [["all", "All"], ["mine", "My Picks"], ["trade", "Trades"]];

export function Avatar({ analyst, size = 38 }) {
  if (analyst.avatar) {
    return <img src={analyst.avatar} alt="" style={{ flexShrink: 0, width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />;
  }
  return (
    <span style={{
      flexShrink: 0, width: size, height: size, borderRadius: "50%", background: `linear-gradient(140deg, ${analyst.color}, #111a2e)`,
      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: size * 0.36, letterSpacing: "0.02em",
    }}>{analyst.initials}</span>
  );
}

const Verified = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-label="Verified" style={{ flexShrink: 0 }}>
    <path fill="#1d9bf0" d="M12 1.5l2.6 2.1 3.3-.4 1.1 3.1 3 1.6-.9 3.2.9 3.2-3 1.6-1.1 3.1-3.3-.4L12 22.5l-2.6-2.1-3.3.4-1.1-3.1-3-1.6.9-3.2-.9-3.2 3-1.6 1.1-3.1 3.3.4z" />
    <path fill="#fff" d="M10.6 15.6l-3.2-3.2 1.3-1.3 1.9 1.9 4.7-4.7 1.3 1.3z" />
  </svg>
);

export default function SimFeed({ feed, height, isMobile }) {
  const [filter, setFilter] = useState("all");
  const shown = feed.filter((p) => filter === "all" || (filter === "mine" ? p.userInvolved : p.kind === "trade"));

  return (
    <div style={{ display: "flex", flexDirection: "column", height, minHeight: 0, background: "#0e1626", borderRadius: 16, border: "1px solid #1f2b42", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid #1f2b42" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span className="wd-sim-live-dot" />
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.12em" }}>THE DESK</span>
          <span style={{ marginLeft: "auto", display: "flex" }}>
            {ANALYSTS.map((a, i) => (
              <span key={a.id} title={a.enabled ? `${a.name} — ${a.role}` : `${a.name} — coming soon`} style={{ marginLeft: i ? -8 : 0, opacity: a.enabled ? 1 : 0.35, filter: a.enabled ? "none" : "grayscale(1)" }}>
                <Avatar analyst={a} size={24} />
              </span>
            ))}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {FILTERS.map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} style={{
              border: "none", borderRadius: 999, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em",
              background: filter === k ? "#f6a21d" : "#1a2438", color: filter === k ? "#111" : "#9fb0c8",
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="wd-sim-scroll" style={{ flex: 1, overflowY: "auto", minHeight: isMobile ? 260 : 0 }}>
        {shown.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#6f7f99", fontSize: 13, fontFamily: "Arial, sans-serif" }}>Nothing here yet.</div>
        )}
        {shown.map((p) => (
          <article key={p.id} className="wd-sim-post" style={{
            display: "flex", gap: 10, padding: "12px 14px", borderBottom: "1px solid #18233a",
            background: p.userInvolved ? "rgba(246,162,29,0.07)" : "transparent",
          }}>
            <Avatar analyst={p.analyst} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", lineHeight: 1.2 }}>
                <span style={{ color: "#fff", fontWeight: 900, fontSize: 13 }}>{p.analyst.name}</span>
                {p.analyst.verified && <Verified />}
                <span style={{ color: "#6f7f99", fontSize: 12, fontFamily: "Arial, sans-serif" }}>{p.analyst.handle}</span>
                {p.overall && <span style={{ color: "#6f7f99", fontSize: 12, fontFamily: "Arial, sans-serif" }}>· Pick {p.overall}</span>}
              </div>
              <div style={{ marginTop: 4, color: p.lines ? "#fff" : "#dbe4f0", fontSize: 13.5, fontWeight: p.lines ? 800 : 400, lineHeight: 1.5, fontFamily: "Arial, sans-serif", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
                {p.text}
              </div>
              {/* We-Draft.com's facts under the pick. */}
              {p.lines?.length > 0 && (
                <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
                  {p.lines.map((l, i) => (
                    <li key={i} style={{ display: "flex", gap: 7, color: "#c9d4e5", fontSize: 13, lineHeight: 1.45, fontFamily: "Arial, sans-serif" }}>
                      <span aria-hidden="true" style={{ color: p.analyst.id === "wedraft" ? "#f6a21d" : p.analyst.color, fontWeight: 900 }}>›</span>
                      <span style={{ overflowWrap: "anywhere" }}>{l}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
