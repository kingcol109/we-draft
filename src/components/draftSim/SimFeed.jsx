// src/components/draftSim/SimFeed.jsx
//
// Draft Sim's live feed — the analyst desk's posts (utils/draftSim/
// analysts.js) as a social timeline, newest on top, plus the desk lineup
// with anyone not live yet marked "coming soon". We-Draft.com's pick posts
// carry a player-profile graphic (ProfileShot) instead of a headline.
import { useState } from "react";
import { ANALYSTS } from "../../utils/draftSim/analysts";
import { gradeLook } from "../../utils/communityGrades";
import { useHeadshot } from "./simHeadshots";

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

export const Verified = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-label="Verified" style={{ flexShrink: 0 }}>
    <path fill="#1d9bf0" d="M12 1.5l2.6 2.1 3.3-.4 1.1 3.1 3 1.6-.9 3.2.9 3.2-3 1.6-1.1 3.1-3.3-.4L12 22.5l-2.6-2.1-3.3.4-1.1-3.1-3-1.6.9-3.2-.9-3.2 3-1.6 1.1-3.1 3.3.4z" />
    <path fill="#fff" d="M10.6 15.6l-3.2-3.2 1.3-1.3 1.9 1.9 4.7-4.7 1.3 1.3z" />
  </svg>
);

const SITE_BLUE = "#0055a5";
const GOLD = "#f6a21d";
const inchesText = (h) => (typeof h === "number" ? `${Math.floor(h / 12)}'${h % 12}"` : h || "");
const LABEL = { fontSize: 8, fontWeight: 900, letterSpacing: "0.12em", color: SITE_BLUE, textTransform: "uppercase" };
const CHIP = { border: "1.5px solid #c8102e", borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 900, color: "#c8102e" };

// A rank as a small tile under the grade: label left, big number right.
function RankTile({ label, value }) {
  return (
    <span style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, borderRadius: 6, padding: "3px 7px", background: "#0a2a55", borderBottom: `2px solid ${GOLD}` }}>
      <span style={{ fontSize: 7.5, fontWeight: 900, letterSpacing: "0.1em", color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 14, lineHeight: 1, color: "#fff" }}>
        <span style={{ fontSize: 9, color: GOLD, marginRight: 1 }}>#</span>{value}
      </span>
    </span>
  );
}

// The pick's player page as a graphic: its hero (headshot, name, position ·
// school · class, college logo) and scouting-report row (community grade
// with board and position rank tiles under it, top strengths, measurements).
function ProfileShot({ card }) {
  const headshot = useHeadshot(card.id);
  const look = card.grade ? gradeLook(card.grade) : null;
  return (
    <div style={{ marginTop: 8, borderRadius: 12, overflow: "hidden", border: "1px solid #2a3854", background: "#fff", fontFamily: "Arial, sans-serif" }}>
      <div style={{ position: "relative", height: 96, overflow: "hidden", background: `linear-gradient(110deg, #0a2a55 0%, ${SITE_BLUE} 55%, #0a2a55 100%)` }}>
        {card.logo && <img src={card.logo} alt="" aria-hidden="true" style={{ position: "absolute", right: -14, top: "50%", transform: "translateY(-50%)", height: 120, opacity: 0.16, pointerEvents: "none" }} />}
        {headshot && <img src={headshot} alt="" style={{ position: "absolute", left: -6, bottom: 0, height: 92, maxWidth: "none" }} />}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: headshot ? 112 : 12, right: 10, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: headshot ? "flex-start" : "center", gap: 5 }}>
          <div style={{ color: "#fff", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 19, lineHeight: 0.98, textTransform: "uppercase", textShadow: "0 2px 6px rgba(0,0,0,0.35)" }}>
            {card.first}<br />{card.last}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", color: "#fff", fontSize: 10, fontWeight: 800 }}>
            <span style={{ border: "1.5px solid #fff", borderRadius: 999, padding: "0 6px", fontWeight: 900 }}>{card.pos}</span>
            {card.school && <span>{card.school}</span>}
            {card.year && <span style={{ opacity: 0.75 }}>· {card.year}</span>}
            {card.logo && <img src={card.logo} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} />}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, padding: "8px 10px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 66 }}>
          <span style={LABEL}>Comm Grade</span>
          {look ? (
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 48, height: 40, borderRadius: 6, background: look.bg, border: `2px solid ${look.border}`, color: "#fff", lineHeight: 1 }}>
              <b style={{ fontSize: 16, fontFamily: "'Arial Black', Arial, sans-serif" }}>{look.short}</b>
              {look.qualifier && <span style={{ fontSize: 6.5, fontWeight: 900, marginTop: 2 }}>{look.qualifier}</span>}
            </span>
          ) : <span style={{ fontSize: 10, color: "#98a3b3", fontStyle: "italic", height: 40, display: "flex", alignItems: "center" }}>No grades</span>}
          {card.rank && <RankTile label="Board" value={card.rank} />}
          {card.posRank && <RankTile label={card.pos} value={card.posRank} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={LABEL}>Top Strengths</span>
          {card.strengths?.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {card.strengths.map((t) => (
                <div key={t}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "#1d2433", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t}</div>
                  <div style={{ height: 2, marginTop: 2, borderRadius: 2, background: "#e6eaf0" }}><div style={{ width: "82%", height: "100%", borderRadius: 2, background: "#1f9d55" }} /></div>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 10, color: "#98a3b3", fontStyle: "italic", marginTop: 4 }}>No strengths yet</div>}
          {(card.height || card.weight) && (
            <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
              {card.height && <span style={CHIP}>{inchesText(card.height)}</span>}
              {card.weight && <span style={CHIP}>{card.weight} lbs</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SimFeed({ feed, height, isMobile }) {
  const [filter, setFilter] = useState("all");
  const shown = feed.filter((p) => filter === "all" || (filter === "mine" ? p.userInvolved : p.kind === "trade"));

  // Mobile: it sits under the console's own "The Desk" tab, so just the
  // posts — no title, lineup or filters, and no frame of its own.
  return (
    <div style={{ display: "flex", flexDirection: "column", height, minHeight: 0, background: "#0e1626", ...(isMobile ? {} : { borderRadius: 16, border: "1px solid #1f2b42" }), overflow: "hidden" }}>
      {!isMobile && <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid #1f2b42" }}>
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
      </div>}

      <div className="wd-sim-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
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
              </div>
              {/* A profile card post reads like a tweet with a graphic:
                  the selection as its headline, the facts under it, then
                  the card. */}
              {p.card ? (
                <>
                  <div style={{ marginTop: 4, color: "#fff", fontSize: 13.5, fontWeight: 900, lineHeight: 1.35, textTransform: "uppercase", letterSpacing: "0.02em", overflowWrap: "anywhere" }}>
                    <span style={{ color: GOLD }}>Pick {p.card.pick}</span> {p.card.teamName} — {p.card.first} {p.card.last}
                  </div>
                  {p.lines?.length > 0 && (
                    <div style={{ marginTop: 4, color: "#c9d4e5", fontSize: 13, lineHeight: 1.45, fontFamily: "Arial, sans-serif", overflowWrap: "anywhere" }}>
                      {p.lines.join(" ")}
                    </div>
                  )}
                  <ProfileShot card={p.card} />
                </>
              ) : (
                <div style={{ marginTop: 4, color: p.lines ? "#fff" : "#dbe4f0", fontSize: 13.5, fontWeight: p.lines ? 800 : 400, lineHeight: 1.5, fontFamily: "Arial, sans-serif", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
                  {p.text}
                </div>
              )}
              {/* We-Draft.com's facts under the pick. */}
              {!p.card && p.lines?.length > 0 && (
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
