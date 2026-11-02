// src/components/profileHub/FollowingTab.jsx
//
// The profile hub's Following tab: followed players (headshot, school, his
// 2026 line from ESPN, his next game — or the score while he's playing),
// then followed teams, college and NFL (record, next game; an NFL team
// also links to its weekly mock). Empty states point to where you follow.
import { Link } from "react-router-dom";
import LoadingSpinner from "../LoadingSpinner";
import useHubFollowing from "./useHubFollowing";
import { seasonHeadline, kickoff } from "../../utils/profileHub";
import { weeklyMockHref } from "../../utils/weeklyMockNews";

const BLUE = "#0055a5";
const MUTED = "#5b6b84";
const CARD = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)", overflow: "hidden" };
const SUB = { font: "900 11px Arial, sans-serif", letterSpacing: ".12em", textTransform: "uppercase", color: "#8a95a5", margin: "0 2px 8px" };

export const gameText = (g) => {
  if (!g) return "";
  const opp = `${g.oppRank ? `No. ${g.oppRank} ` : ""}${g.opp}`;
  return `${g.at} ${opp}`;
};

function NextGame({ team, size = 16 }) {
  if (!team) return null;
  if (team.live) {
    const g = team.live;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#d62828" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#d62828" }} />
        LIVE · {team.abbr} {g.myScore}, {g.opp} {g.oppScore} · {g.status}
      </span>
    );
  }
  const g = team.next;
  if (!g) return <span>Season over</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      Next: {kickoff(g.date)} {g.at}
      {g.oppLogo && <img src={g.oppLogo} alt="" style={{ width: size, height: size, maxWidth: "none", objectFit: "contain" }} />}
      {g.oppRank ? `No. ${g.oppRank} ` : ""}{g.opp}
    </span>
  );
}

function PlayerCard({ p }) {
  const f = p.follow;
  const t = p.snap?.team;
  const c1 = t?.color || BLUE;
  const c2 = t?.alt || "#f6a21d";
  const line = seasonHeadline(p.snap?.position || f.playerPosition, p.snap?.season);
  return (
    <Link to={f.playerSlug ? `/player/${f.playerSlug}` : "#"} style={{ ...CARD, display: "block", textDecoration: "none", color: "inherit" }}>
      <div style={{ position: "relative", height: 128, background: `linear-gradient(160deg, ${c1} 0%, ${c1} 55%, ${c2} 140%)` }}>
        {t?.logo && <img src={t.logo} alt="" style={{ position: "absolute", left: 10, top: 10, width: 30, height: 30, maxWidth: "none", background: "#fff", borderRadius: "50%", padding: 3, boxSizing: "border-box", objectFit: "contain" }} />}
        {t?.live && <span style={{ position: "absolute", right: 10, top: 10, background: "#d62828", color: "#fff", font: "900 10px Arial", letterSpacing: ".12em", borderRadius: 999, padding: "3px 8px" }}>● LIVE</span>}
        {p.photo.headshot && <img src={p.photo.headshot} alt="" style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", height: 120, maxWidth: "none" }} />}
      </div>
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ font: "900 16px/1.1 Arial, sans-serif", color: BLUE, textTransform: "uppercase" }}>{f.playerName}</div>
        <div style={{ font: "700 12px Arial, sans-serif", color: MUTED, marginTop: 2 }}>{[f.playerPosition, f.playerSchool, f.playerEligible].filter(Boolean).join(" · ")}</div>
        {line.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
            {line.map(([k, v]) => (
              <div key={k} style={{ flex: 1, background: "#f3f6fa", borderRadius: 8, padding: "5px 0", textAlign: "center" }}>
                <b style={{ display: "block", font: "900 16px Arial, sans-serif", color: "#0f1b2d" }}>{v}</b>
                <i style={{ font: "normal 800 9px Arial, sans-serif", letterSpacing: ".08em", color: "#7a8597", textTransform: "uppercase" }}>{k}</i>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 9, font: "800 11px Arial, sans-serif", color: MUTED }}><NextGame team={t} /></div>
      </div>
    </Link>
  );
}

function TeamCard({ t, nfl }) {
  const to = nfl ? `/nfl/${t.abbr.toLowerCase()}` : t.slug ? `/team/${t.slug}` : "/cfb";
  return (
    <div style={{ ...CARD, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderLeft: `5px solid ${t.color}` }}>
      <Link to={to} style={{ lineHeight: 0, flexShrink: 0 }}>{t.logo && <img src={t.logo} alt={t.name} style={{ width: 44, height: 44, maxWidth: "none", objectFit: "contain" }} />}</Link>
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "900 15px Arial, sans-serif", color: "#0f1b2d" }}>
          <Link to={to} style={{ color: "inherit", textDecoration: "none" }}>{nfl ? t.nick : t.name}</Link>
          <span style={{ marginLeft: 6, verticalAlign: 2, font: "900 9px Arial, sans-serif", letterSpacing: ".1em", borderRadius: 4, padding: "1px 5px", color: "#fff", background: nfl ? "#013369" : "#8a95a5" }}>{nfl ? "NFL" : "CFB"}</span>
        </div>
        <div style={{ font: "800 11px Arial, sans-serif", color: "#7a8597", marginTop: 2 }}>
          {[t.record, t.standing].filter(Boolean).join(" · ")}
          {nfl && <> · <Link to={weeklyMockHref(t.abbr)} style={{ color: BLUE, textDecoration: "none" }}>Weekly mock →</Link></>}
        </div>
        <div style={{ font: "800 11px Arial, sans-serif", color: MUTED, marginTop: 5 }}><NextGame team={t} /></div>
      </div>
    </div>
  );
}

export default function FollowingTab({ uid, isMobile }) {
  const data = useHubFollowing(uid);
  if (!data) return <LoadingSpinner label="Loading who you follow" size={32} minHeight="30vh" />;
  const teams = [...data.nfl.map((t) => ({ t, nfl: true })), ...data.college.map((t) => ({ t, nfl: false }))];
  const empty = (text, to, cta) => (
    <div style={{ ...CARD, padding: "18px 16px", font: "700 13px Arial, sans-serif", color: MUTED }}>
      {text} {to && <Link to={to} style={{ color: BLUE, fontWeight: 900 }}>{cta}</Link>}
    </div>
  );
  return (
    <div>
      <div style={SUB}>Players</div>
      {data.players.length ? (
        <div style={isMobile
          ? { display: "grid", gridAutoFlow: "column", gridAutoColumns: "72%", gap: 12, overflowX: "auto", paddingBottom: 4 }
          : { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {data.players.map((p) => <PlayerCard key={p.follow.id} p={p} />)}
        </div>
      ) : empty("You're not following any players yet. Hit Follow on a player's page.", "/community", "Find players →")}
      <div style={{ ...SUB, marginTop: 22 }}>Teams</div>
      {teams.length ? (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: isMobile ? 8 : 12 }}>
          {teams.map(({ t, nfl }) => <TeamCard key={`${nfl}-${t.id}`} t={t} nfl={nfl} />)}
        </div>
      ) : empty("You're not following any teams yet. Follow college teams from their pages, NFL teams from theirs.", "/nfl", "NFL teams →")}
    </div>
  );
}
