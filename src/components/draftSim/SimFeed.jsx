// src/components/draftSim/SimFeed.jsx
//
// Draft Sim's live feed — the analyst desk's posts (utils/draftSim/
// analysts.js) as a social timeline, newest on top, plus the desk lineup
// with anyone not live yet marked "coming soon". We-Draft.com's pick posts
// carry the pick as a graphic in the picking team's colors (ProfileShot).
import { useState } from "react";
import { ANALYSTS } from "../../utils/draftSim/analysts";
import { gradeLook } from "../../utils/communityGrades";
import { useHeadshot } from "./simHeadshots";
import { isReadable, textOn } from "../../utils/teamColors";

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

// A rank as a small tile under the grade: label left, big number right, in
// the picking team's colors.
function RankTile({ label, value, edge }) {
  return (
    <span style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, borderRadius: 6, padding: "3px 7px", background: "rgba(0,0,0,0.32)", borderBottom: `2px solid ${edge}` }}>
      <span style={{ fontSize: 7.5, fontWeight: 900, letterSpacing: "0.1em", color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 14, lineHeight: 1, color: "#fff" }}>
        <span style={{ fontSize: 9, color: edge, marginRight: 1 }}>#</span>{value}
      </span>
    </span>
  );
}

// The pick as the team's own "the pick is in" graphic, in its colors: a
// strip in its second color (round · pick, "{Nickname} select"), then the
// hero on its primary — the team's logo big behind, the player's headshot,
// name, position, college logo and school — and the scouting
// report under it (community grade, board and position rank tiles, top
// strengths, measurements) on the team's color, darkened. brand: the
// team's (data.branding[team]); without one, the site's colors.
function ProfileShot({ card, brand = {} }) {
  const headshot = useHeadshot(card.id);
  const look = card.grade ? gradeLook(card.grade) : null;
  const c1 = brand.Color1 || SITE_BLUE;
  const c2 = brand.Color2 || GOLD;
  const teamLogo = brand.LogoDark || brand.Logo1 || "";
  // The strip: the second color when it shows against the first, else white.
  const strip = isReadable(c2, c1, 1.6) ? c2 : "#ffffff";
  const stripInk = textOn(strip, c1);
  // Accents on the dark panel: whichever team color reads there.
  const edge = [c2, c1].find((c) => isReadable(c, "#0b1220", 3)) || "#ffffff";
  const label = { ...LABEL, color: "rgba(255,255,255,0.7)" };
  // The name, first over last — a hyphenated last name breaks after its
  // hyphen ("COLEMAN-" / "WILLIAMS") — as big as its longest line allows, up
  // to 32px, running over the team's logo behind it (Arial Black capitals
  // run ~0.86em; ~210px beside the headshot).
  const nameLines = [String(card.first || ""), ...String(card.last || "").split(/(?<=-)/)].filter(Boolean);
  const nameSize = Math.max(12, Math.min(32, Math.floor((headshot ? 210 : 290) / (Math.max(...nameLines.map((l) => l.length), 4) * 0.86))));
  return (
    <div style={{ marginTop: 8, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", background: `linear-gradient(180deg, ${c1}, ${c1})`, fontFamily: "Arial, sans-serif", boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: strip, color: stripInk, fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{card.round ? `Rd ${card.round} · ` : ""}Pick {card.pick}{card.via ? ` · via ${card.via}` : ""}</span>
        <span style={{ marginLeft: "auto", minWidth: 0, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.nick ? `${card.nick} select` : "The pick is in"}</span>
      </div>

      <div style={{ position: "relative", height: 122, overflow: "hidden", background: `radial-gradient(160px 120px at 85% 40%, ${c2}55, transparent 70%), linear-gradient(115deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.38) 100%)` }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(115deg, transparent 0 22px, ${edge} 22px 28px)`, opacity: 0.1, WebkitMaskImage: "linear-gradient(90deg, transparent 35%, #000)", maskImage: "linear-gradient(90deg, transparent 35%, #000)" }} />
        {teamLogo && <img src={teamLogo} alt="" aria-hidden="true" style={{ position: "absolute", right: -10, top: "50%", transform: "translateY(-50%)", height: 128, maxWidth: 170, objectFit: "contain", opacity: 0.28, pointerEvents: "none" }} />}
        {headshot && <img src={headshot} alt="" style={{ position: "absolute", left: -6, bottom: 0, height: 116, maxWidth: "none", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.4))" }} />}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: headshot ? 112 : 12, right: 10, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: headshot ? "flex-start" : "center", gap: 5 }}>
          <div style={{ position: "relative", zIndex: 1, color: "#fff", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: nameSize, lineHeight: 0.95, letterSpacing: "-0.01em", whiteSpace: "nowrap", textTransform: "uppercase", textShadow: "2px 2px 0 rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.35)" }}>
            {nameLines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, maxWidth: "100%", color: "#fff", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>
            <span style={{ background: strip, color: stripInk, borderRadius: 999, padding: "0 6px", fontWeight: 900, flexShrink: 0 }}>{card.pos}</span>
            {card.logo && <img src={card.logo} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
            {/* The whole school name, smaller when it's long (the class is
                implied — it's this draft). */}
            {card.school && <span style={{ fontSize: card.school.length > 18 ? 8.5 : card.school.length > 14 ? 9.5 : 10 }}>{card.school}</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, padding: "8px 10px 10px", alignItems: "start", background: "rgba(5,10,20,0.62)", borderTop: `3px solid ${strip}` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 66 }}>
          <span style={label}>Comm Grade</span>
          {look ? (
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 48, height: 40, borderRadius: 6, background: look.bg, border: `2px solid ${look.border}`, color: "#fff", lineHeight: 1 }}>
              <b style={{ fontSize: 16, fontFamily: "'Arial Black', Arial, sans-serif" }}>{look.short}</b>
              {look.qualifier && <span style={{ fontSize: 6.5, fontWeight: 900, marginTop: 2 }}>{look.qualifier}</span>}
            </span>
          ) : <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontStyle: "italic", height: 40, display: "flex", alignItems: "center" }}>No grades</span>}
          {card.rank && <RankTile label="Board" value={card.rank} edge={edge} />}
          {card.posRank && <RankTile label={card.pos} value={card.posRank} edge={edge} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={label}>Top Strengths</span>
          {card.strengths?.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {card.strengths.map((t) => (
                <div key={t}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t}</div>
                  <div style={{ height: 2, marginTop: 2, borderRadius: 2, background: "rgba(255,255,255,0.15)" }}><div style={{ width: "82%", height: "100%", borderRadius: 2, background: edge }} /></div>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontStyle: "italic", marginTop: 4 }}>No strengths yet</div>}
          {(card.height || card.weight) && (
            <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
              {card.height && <span style={{ ...CHIP, borderColor: edge, color: "#fff" }}>{inchesText(card.height)}</span>}
              {card.weight && <span style={{ ...CHIP, borderColor: edge, color: "#fff" }}>{card.weight} lbs</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// branding: the teams' (data.branding) — each pick card is in its team's colors.
export default function SimFeed({ feed, height, isMobile, branding = {} }) {
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
                  <ProfileShot card={p.card} brand={branding[p.card.team]} />
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
