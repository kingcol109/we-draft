// src/components/LiveInsightCard.js
//
// One insight in a live game's feed — "here's why that play matters" —
// rendered straight from the precomputed object the ingester puts on the
// game doc (server/live/insights.js). No lookups or math here: rendering one
// costs about what a play card does.
//
// It sits just above the play that caused it (the feed is newest first),
// tied to it by a thread in the team's color, and reads differently from a
// play card on purpose: what kind of insight it is up top, then the player
// or team, the line, and the sentence that matters.
//
//   wedraft       a player with a We-Draft profile — his grade / class rank panel
//   milestone     a game or season threshold, a streak, a new season high
//   player_trend  a player's night building (explosive plays, multi-TD...)
//   team_trend    third downs, sacks, takeaways, explosive plays
//   game_trend    a run of unanswered points, one team taking over a half
import { memo } from "react";
import WdWordmark from "../assets/Logo2.png";

const GOLD = "#f6a21d";
const SITE_BLUE = "#0055a5";

// The site's round-grade badge colors (same map as DraftFeed.js /
// PlayerProfile.js). No graded evaluations yet reads as Watchlist, as on
// the profile.
export const GRADE_BADGE = {
  "Watchlist":          { short: "W",   bg: "#5F5E5A", border: "#444441" },
  "Early First Round":  { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Late First Round":   { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Second Round":       { short: "2nd", bg: "#0F6E56", border: "#085041" },
  "Third Round":        { short: "3rd", bg: "#185FA5", border: "#0C447C" },
  "Fourth Round":       { short: "4th", bg: "#BA7517", border: "#854F0B" },
  "Fifth Round":        { short: "5th", bg: "#BA7517", border: "#854F0B" },
  "Sixth Round":        { short: "6th", bg: "#993C1D", border: "#712B13" },
  "Seventh Round":      { short: "7th", bg: "#993C1D", border: "#712B13" },
  "UDFA":               { short: "U",   bg: "#A32D2D", border: "#791F1F" },
};

const LABELS = {
  wedraft: "We-Draft Player",
  milestone: "Milestone",
  player_trend: "Player Trend",
  team_trend: "Team Trend",
  game_trend: "Game Trend",
};

export const INSIGHT_CARD_STYLE = `
.lic { --tc: #4d9fff; position: relative; margin: 0 0 10px 26px; border-radius: 14px; padding: 12px 16px 13px; color: #eef2f8;
  background: linear-gradient(105deg, color-mix(in srgb, var(--tc) 22%, #0c1322), #0c1322 70%);
  border: 1px solid color-mix(in srgb, var(--tc) 45%, #1d2840); }
/* the thread down to the play it's about */
.lic::before { content: ""; position: absolute; left: -16px; top: -10px; bottom: -10px; width: 3px; border-radius: 3px;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--tc) 80%, #fff) 30%, color-mix(in srgb, var(--tc) 80%, #fff) 70%, transparent); }
.lic::after { content: ""; position: absolute; left: -19px; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%;
  background: color-mix(in srgb, var(--tc) 80%, #fff); box-shadow: 0 0 0 3px #0a0f1a; }
.lic.fresh { animation: lic-in 0.7s cubic-bezier(.2,.9,.3,1.1); }
@keyframes lic-in { 0% { opacity: 0; transform: translateY(-10px) scale(0.98); } 100% { opacity: 1; transform: none; } }
.lic-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.lic-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase;
  color: #0a0f1a; background: #eef2f8; border-radius: 999px; padding: 3px 10px 3px 8px; white-space: nowrap; }
.lic-tag img { width: 15px; height: 15px; object-fit: contain; }
.lic-tag i { width: 7px; height: 7px; border-radius: 50%; background: var(--tc); }
.lic.milestone .lic-tag { background: ${GOLD}; }
.lic.wedraft .lic-tag { background: ${SITE_BLUE}; color: #fff; }
.lic.milestone .lic-tag i, .lic.wedraft.ms .lic-tag i { background: #0a0f1a; }
.lic-ms { font-size: 10px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: ${GOLD}; }
.lic-body { display: flex; gap: 16px; align-items: stretch; }
.lic-main { flex: 1; min-width: 0; }
.lic-name { font-family: "Bebas Neue", system-ui, sans-serif; font-size: clamp(26px, 2.1vw, 34px); line-height: 0.95; letter-spacing: 0.02em; color: #fff; text-transform: uppercase; }
.lic-name a { color: inherit; text-decoration: none; }
.lic-name a:hover { text-decoration: underline; text-decoration-thickness: 2px; }
.lic-sub { margin-top: 2px; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb0c8; }
.lic-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.lic-chip { display: inline-flex; align-items: baseline; gap: 4px; background: rgba(6,10,18,0.55); border: 1px solid #26324a; border-radius: 8px; padding: 3px 9px;
  font-size: 15px; font-weight: 900; color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lic-chip small { font-size: 10px; font-weight: 900; letter-spacing: 0.06em; color: #9fb0c8; }
.lic-why { margin-top: 9px; font-size: clamp(16px, 1.25vw, 19px); font-weight: 900; line-height: 1.25; color: #fff; }
.lic-extra { margin-top: 5px; display: flex; flex-direction: column; gap: 2px; font-size: 13px; font-weight: 700; color: #9fb0c8; }
/* We-Draft panel — the player's scouting snapshot, in site branding */
.lic-wd { flex: 0 0 clamp(270px, 27vw, 360px); display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: 12px;
  background: linear-gradient(155deg, ${SITE_BLUE}, #003b78 75%); border: 1px solid rgba(255,255,255,0.16);
  box-shadow: 0 8px 22px -12px rgba(0,85,165,0.9); color: #fff; text-decoration: none; }
.lic-wd:hover { border-color: rgba(255,255,255,0.4); }
.lic-wd-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.18); }
.lic-wd-brand img { height: 15px; width: auto; display: block; }
.lic-wd-brand span { font-size: 10px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.75); white-space: nowrap; }
.lic-wd-row { display: flex; align-items: center; gap: 12px; }
.lic-wd-badge { flex-shrink: 0; width: 66px; padding: 10px 4px; border-radius: 6px; text-align: center; border: 3px solid; }
.lic-wd-badge b { display: block; font-size: 28px; font-weight: 900; line-height: 1; letter-spacing: -0.02em; color: #fff; }
.lic-wd-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.lic-wd-k { font-size: 10px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.7); }
.lic-wd-grade { font-family: "Bebas Neue", system-ui, sans-serif; font-size: 26px; line-height: 1; letter-spacing: 0.03em; text-transform: uppercase; color: #fff; }
.lic-wd-rank { font-size: 13px; font-weight: 900; color: ${GOLD}; letter-spacing: 0.03em; }
.lic-wd-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.lic-wd-tags span { font-size: 11px; font-weight: 800; color: #fff; background: #16a34a; border: 1px solid #15803d; border-radius: 999px; padding: 2px 9px; }
/* a We-Draft card's left side fills its half — bigger name, line and story */
.lic.wedraft .lic-main { display: flex; flex-direction: column; }
.lic.wedraft .lic-name { font-size: clamp(36px, 3.2vw, 52px); }
.lic.wedraft .lic-sub { font-size: 14px; margin-top: 4px; }
.lic.wedraft .lic-chips { gap: 8px; margin-top: 12px; }
.lic.wedraft .lic-chip { font-size: 21px; padding: 5px 12px; border-radius: 10px; }
.lic.wedraft .lic-chip small { font-size: 12px; }
.lic.wedraft .lic-why { font-size: clamp(19px, 1.5vw, 23px); margin-top: 12px; }
.lic.wedraft .lic-extra { font-size: 15px; margin-top: 8px; gap: 3px; }
.lic-wd-cta { margin-top: auto; font-size: 11px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.85); }
.lic-wd:hover .lic-wd-cta { color: #fff; }
/* team & game trends: the sentence is the card */
.lic.team_trend { padding: 10px 16px; }
.lic.team_trend .lic-why { margin-top: 0; }
.lic-head { font-family: "Bebas Neue", system-ui, sans-serif; font-size: clamp(28px, 2.4vw, 40px); line-height: 0.95; letter-spacing: 0.02em; color: #fff; text-transform: uppercase; }
.lic.game_trend { background: linear-gradient(105deg, color-mix(in srgb, var(--tc) 42%, #0c1322), #0c1322 80%); }
.lic.game_trend .lic-why { margin-top: 6px; }
@media (max-width: 640px) {
  .lic { margin-left: 18px; padding: 11px 13px; }
  .lic::before { left: -12px; } .lic::after { left: -15px; }
  .lic-body { flex-direction: column; gap: 10px; }
  .lic-wd { flex-basis: auto; }
}
@media (prefers-reduced-motion: reduce) { .lic.fresh { animation: none; } }
`;

// "6 REC · 121 YDS · 1 TD" → chips with the number big and the unit small.
function Chips({ line }) {
  if (!line) return null;
  return (
    <div className="lic-chips">
      {line.split(" · ").map((part, i) => {
        const m = /^(-?[\d/.,]+)\s+(.+)$/.exec(part);
        return <span key={i} className="lic-chip">{m ? <>{m[1]}<small>{m[2]}</small></> : part}</span>;
      })}
    </div>
  );
}

// The right side of a We-Draft player's card: community grade badge, class
// rank, top strengths — a link to the full profile.
function WdPanel({ wd, slug, name }) {
  const label = wd.grade || "Watchlist";
  const badge = GRADE_BADGE[label] || GRADE_BADGE.Watchlist;
  const Tag = slug ? "a" : "div";
  const link = slug ? { href: `/player/${slug}`, target: "_blank", rel: "noopener noreferrer", title: `${name} — We-Draft profile (opens in a new tab)` } : {};
  return (
    <Tag className="lic-wd" {...link}>
      <div className="lic-wd-brand"><img src={WdWordmark} alt="We-Draft.com" /><span>Scouting snapshot</span></div>
      <div className="lic-wd-row">
        <div className="lic-wd-badge" style={{ background: badge.bg, borderColor: badge.border }}><b>{badge.short}</b></div>
        <div className="lic-wd-info">
          <span className="lic-wd-k">Community grade</span>
          <span className="lic-wd-grade">{label}</span>
          {(wd.classRank || wd.cls) && (
            <span className="lic-wd-rank">{wd.classRank ? `No. ${wd.classRank} in the ` : ""}{wd.cls ? `${wd.cls} class` : ""}</span>
          )}
        </div>
      </div>
      {wd.strengths?.length > 0 && <div className="lic-wd-tags">{wd.strengths.map((t) => <span key={t}>{t}</span>)}</div>}
      {slug && <span className="lic-wd-cta">View profile →</span>}
    </Tag>
  );
}

function LiveInsightCard({ insight: x, team, fresh }) {
  const color = team?.color || x.teamColor || "#4d9fff";
  const cat = x.category || "player_trend";
  const slug = x.player?.slug;
  const name = slug
    ? <a href={`/player/${slug}`} target="_blank" rel="noopener noreferrer" title={`${x.title} — We-Draft profile (opens in a new tab)`}>{x.title}</a>
    : x.title;
  const top = (
    <div className="lic-top">
      <span className="lic-tag">
        {cat === "wedraft" ? <img src="/wd-icon.png" alt="" /> : <i />}
        {LABELS[cat] || "Insight"}
      </span>
      {cat === "wedraft" && x.milestone && <span className="lic-ms">Milestone</span>}
    </div>
  );
  return (
    <div className={`lic ${cat}${x.milestone ? " ms" : ""}${fresh ? " fresh" : ""}`} style={{ "--tc": color }}>
      {x.kind === "player" ? (
        // The tag rides in the left column, so a We-Draft panel can run the
        // card's full height.
        <div className="lic-body">
          <div className="lic-main">
            {top}
            <div className="lic-name">{name}</div>
            {x.subtitle && <div className="lic-sub">{x.subtitle}</div>}
            <Chips line={x.statLine} />
            {x.context && <div className="lic-why">{x.context}</div>}
            {x.extra?.length > 0 && <div className="lic-extra">{x.extra.map((e, i) => <span key={i}>{e}</span>)}</div>}
          </div>
          {x.wd && <WdPanel wd={x.wd} slug={slug} name={x.title} />}
        </div>
      ) : (
        <div className="lic-main">
          {top}
          {x.headline && <div className="lic-head">{x.headline}</div>}
          <div className="lic-why">{x.context}</div>
          <Chips line={x.statLine} />
          {x.extra?.length > 0 && <div className="lic-extra">{x.extra.map((e, i) => <span key={i}>{e}</span>)}</div>}
        </div>
      )}
    </div>
  );
}

// An insight never changes once made (a new development is a new insight),
// so it re-renders only when it first animates in or its team color loads.
export default memo(LiveInsightCard, (a, b) => a.insight.id === b.insight.id && a.fresh === b.fresh
  && a.team?.color === b.team?.color);
