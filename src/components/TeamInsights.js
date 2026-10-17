// src/components/TeamInsights.js
//
// The CFB team page's Insights tab (TeamPage.js): up-to-date facts about
// the team's current season, all from data the site already keeps —
//   • Season Snapshot: record, Top 25 rank, conference record, record vs.
//     ranked teams, streak, scoring (the schedule26 games TeamPage.js
//     already loaded + the current poll it already built)
//   • Quick Hits: generated one-liners (streaks, best win, conference
//     leads, top-10 units, national leaders, next game)
//   • National Leaders: the team's players in cfbLeaders/current (top 50
//     FBS players per stat, scripts/syncCfbdRosters.js)
//   • Where the team ranks: every cfbLeaders/teams stat (scripts/
//     syncCfbdTeamStats.js) as an FBS rank bar, plus its conference rank
// Both cfbLeaders docs are read once per visit, only once the tab opens.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import LoadingSpinner from "./LoadingSpinner";
import { ranksForGame } from "../utils/rankings";
import { scheduleGameHref } from "../utils/live";
import { fmtTeamStat } from "../utils/fbsTeamStats";

const INK = "#0f1b2d";
const INK_2 = "#33415a";
const INK_3 = "#5b6b84";
const INK_4 = "#8a97ab";
const LINE = "#e3e8ef";
const LINE_2 = "#eef1f5";
const SOFT = "#f7f9fc";
const WIN = "#2e7d32";
const LOSS = "#c0392b";
const LEADERS_SHOWN = 8;

let leadersDoc = null;
let teamsDoc = null;
const readOnce = (id) => getDoc(doc(db, "cfbLeaders", id)).then((d) => (d.exists() ? d.data() : {}));
function useInsightsData() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    leadersDoc ||= readOnce("current").catch(() => { leadersDoc = null; return {}; });
    teamsDoc ||= readOnce("teams").catch(() => { teamsDoc = null; return {}; });
    Promise.all([leadersDoc, teamsDoc]).then(([leaders, teams]) => { if (alive) setData({ leaders, teams }); });
    return () => { alive = false; };
  }, []);
  return data;
}

const rankNum = (r) => (r == null ? null : parseInt(String(r).replace(/^T-?/, ""), 10) || null);
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const fmtDate = (g) => {
  const d = g.Date?.toDate?.() || (g.Date ? new Date(g.Date) : null);
  return d && !isNaN(d) ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";
};
const hasScore = (g) => g.HomeScore != null && g.AwayScore != null;
const recStr = (w, l, t = 0) => (t ? `${w}-${l}-${t}` : `${w}-${l}`);

// "Points Allowed / Game" → "Points Allowed/G" on narrow screens.
const shortTitle = (t) => t.replace(" / Game", "/G");

// One rank (FBS or conference) as a big number over its standing bar —
// highlighted in the team color when it's the top 10% of the field.
function RankBlock({ label, rank, tied, of, color1, isMobile, conf }) {
  const pct = rank ? (of > 1 ? (of - rank) / (of - 1) : 1) : 0;
  const elite = !!rank && (rank === 1 || rank / of <= 0.1);
  const display = !rank ? "—" : conf ? `${tied ? "T-" : ""}${ordinal(rank)}` : `${tied ? "T-" : "#"}${rank}`;
  return (
    <div style={{
      flex: 1, minWidth: 0, borderRadius: "10px", padding: isMobile ? "8px 10px" : "10px 12px",
      background: elite ? `color-mix(in srgb, ${color1} 9%, #fff)` : SOFT,
      border: `1px solid ${elite ? `color-mix(in srgb, ${color1} 40%, #fff)` : LINE}`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "6px" }}>
        <span style={{ fontSize: "10px", fontWeight: 900, color: elite ? color1 : INK_4, textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {rank === 1 ? "🥇 " : ""}{label}
        </span>
        {rank && <span style={{ fontSize: "11px", fontWeight: 800, color: INK_4, whiteSpace: "nowrap" }}>of {of}</span>}
      </div>
      <div style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 900, color: rank ? INK : INK_4, lineHeight: 1.1, margin: "2px 0 6px", fontVariantNumeric: "tabular-nums" }}>
        {display}
      </div>
      <div style={{ height: "6px", borderRadius: "3px", background: LINE_2, overflow: "hidden" }}>
        {rank && <div style={{ width: `${Math.max(4, pct * 100)}%`, height: "100%", borderRadius: "3px", background: color1 }} />}
      </div>
    </div>
  );
}

export default function TeamInsights({ school, canonicalSchool, color1, color2, isMobile, schedule, currentTop25, schoolsMap }) {
  const data = useInsightsData();
  const [showAllLeaders, setShowAllLeaders] = useState(false);
  const shortName = school?.Short || canonicalSchool;

  // ── Season from the schedule ──
  const season = useMemo(() => {
    const games = (schedule || []).map((g) => {
      const isHome = g.Home === canonicalSchool;
      const opp = isHome ? g.Away : g.Home;
      const { homeRank, awayRank } = ranksForGame(g, currentTop25);
      const oppRank = isHome ? awayRank : homeRank;
      const played = hasScore(g);
      const us = played ? (isHome ? g.HomeScore : g.AwayScore) : null;
      const them = played ? (isHome ? g.AwayScore : g.HomeScore) : null;
      const res = !played ? null : us > them ? "W" : us < them ? "L" : "T";
      const oppConf = schoolsMap?.[opp]?.Conference;
      return { g, isHome, opp, oppRank, played, us, them, res, conf: !!oppConf && oppConf === school?.Conference && oppConf !== "Independent" };
    });
    const played = games.filter((x) => x.played);
    const count = (list, r) => list.filter((x) => x.res === r).length;
    const rec = (list) => ({ w: count(list, "W"), l: count(list, "L"), t: count(list, "T"), n: list.length });
    let streak = null;
    for (let i = played.length - 1; i >= 0; i--) {
      if (!streak) streak = { res: played[i].res, n: 1 };
      else if (played[i].res === streak.res) streak.n++;
      else break;
    }
    const wins = played.filter((x) => x.res === "W");
    const rankedWins = wins.filter((x) => x.oppRank).sort((a, b) => a.oppRank - b.oppRank);
    const biggest = [...wins].sort((a, b) => (b.us - b.them) - (a.us - a.them))[0] || null;
    const pf = played.reduce((s, x) => s + x.us, 0);
    const pa = played.reduce((s, x) => s + x.them, 0);
    return {
      games, played,
      all: rec(played),
      conf: rec(played.filter((x) => x.conf)),
      ranked: rec(played.filter((x) => x.oppRank)),
      home: rec(played.filter((x) => x.isHome && !x.g.Neutral)),
      road: rec(played.filter((x) => !x.isHome && !x.g.Neutral)),
      streak, rankedWins, biggest,
      ppg: played.length ? pf / played.length : null,
      papg: played.length ? pa / played.length : null,
      next: games.find((x) => !x.played) || null,
    };
  }, [schedule, canonicalSchool, currentTop25, schoolsMap, school?.Conference]);

  // ── National leaders: this team's players in the top-50 lists ──
  const leaders = useMemo(() => {
    const cats = data?.leaders?.categories || [];
    const out = [];
    cats.forEach((c) => {
      const rows = c.rows || [];
      rows.forEach((r, i) => {
        if (r.school !== canonicalSchool) return;
        const first = rows.findIndex((x) => x.v === r.v);
        const tied = rows.filter((x) => x.v === r.v).length > 1;
        out.push({ ...r, cat: c.title, catKey: c.key, rank: first + 1, tied, idx: i });
      });
    });
    return out.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  }, [data, canonicalSchool]);

  // ── Team stat ranks: FBS + conference ──
  const teamRanks = useMemo(() => {
    const teams = data?.teams?.teams || [];
    const cats = data?.teams?.cats || [];
    const me = teams.find((t) => (school?.CFBDTeamId != null && Number(t.id) === Number(school.CFBDTeamId)) || t.school === canonicalSchool);
    if (!me) return null;
    const confTeams = me.conf ? teams.filter((t) => t.conf === me.conf) : [];
    const rows = cats.map((c) => {
      const v = me.v?.[c.key];
      const rank = rankNum(me.r?.[c.key]);
      if (v == null || !rank) return null;
      const field = teams.filter((t) => t.v?.[c.key] != null).length;
      const confField = confTeams.filter((t) => t.v?.[c.key] != null);
      const confRank = confField.length > 1
        ? 1 + confField.filter((t) => (c.low ? t.v[c.key] < v : t.v[c.key] > v)).length
        : null;
      const confTied = confRank != null && confField.filter((t) => t.v[c.key] === v).length > 1;
      return { ...c, v, rank, tied: String(me.r[c.key]).startsWith("T"), field, confRank, confTied, confSize: confField.length };
    }).filter(Boolean);
    return { rows: rows.sort((a, b) => a.rank / a.field - b.rank / b.field), games: me.g };
  }, [data, school?.CFBDTeamId, canonicalSchool]);

  // ── Quick Hits ──
  const facts = useMemo(() => {
    const f = [];
    const add = (score, icon, text, to) => f.push({ score, icon, text, to });
    const { all, streak, rankedWins, ranked, biggest, home, road, next, conf } = season;
    const ownRank = currentTop25?.[canonicalSchool];
    if (ownRank) add(90, "🏆", <>Ranked <b>#{ownRank}</b> in the latest Top 25.</>);
    if (all.n >= 3 && all.l === 0 && all.t === 0) add(95, "💯", <>Still unbeaten at <b>{recStr(all.w, 0)}</b>.</>);
    else if (streak && streak.n >= 3 && streak.res === "W") add(85, "🔥", <>Riding a <b>{streak.n}-game win streak</b>.</>);
    else if (streak && streak.n >= 3 && streak.res === "L") add(60, "📉", <>Have dropped <b>{streak.n} straight</b>.</>);
    if (conf.n >= 2 && conf.l === 0) add(75, "🛡️", <>Unbeaten in {school?.Conference} play (<b>{recStr(conf.w, 0, conf.t)}</b>).</>);
    if (rankedWins[0]) {
      const x = rankedWins[0];
      add(80, "⭐", <>Best win: <b>{x.us}-{x.them}</b> over <b>#{x.oppRank} {x.opp}</b>{x.g.Week ? ` (${x.g.Week})` : ""}.</>, scheduleGameHref(x.g));
    }
    if (ranked.n >= 2) add(55, "🎯", <><b>{recStr(ranked.w, ranked.l, ranked.t)}</b> against ranked opponents.</>);
    if (biggest && biggest.us - biggest.them >= 21) add(50, "💥", <>Biggest win: <b>{biggest.us}-{biggest.them}</b> {biggest.isHome ? "vs." : "at"} {biggest.opp} (+{biggest.us - biggest.them}).</>, scheduleGameHref(biggest.g));
    if (home.n >= 3 && home.l === 0) add(45, "🏟️", <>Perfect at home: <b>{recStr(home.w, 0)}</b>.</>);
    if (road.n >= 2 && road.l === 0) add(48, "✈️", <>Unbeaten on the road: <b>{recStr(road.w, 0)}</b>.</>);

    const no1 = leaders.filter((l) => l.rank === 1);
    no1.forEach((l) => add(92, "👑", <><b>{l.first} {l.last}</b> {l.tied ? "is tied for the" : "leads the"} nation in {l.cat.toLowerCase()} ({l.v}).</>, l.slug ? `/player/${l.slug}` : null));

    (teamRanks?.rows || []).forEach((r) => {
      if (r.rank <= 10) add(70 + (11 - r.rank), "📈", <><b>{r.tied ? "T-" : "#"}{r.rank}</b> in FBS in {r.title.toLowerCase()} ({fmtTeamStat(r.key, r.v)}).</>);
      else if (r.confRank === 1) add(62, "🥇", <>Lead the {school?.Conference} in {r.title.toLowerCase()} ({fmtTeamStat(r.key, r.v)}).</>);
    });

    if (next) {
      const where = next.g.Neutral ? "vs." : next.isHome ? "vs." : "at";
      add(40, "🗓️", <>Up next: {where} <b>{next.oppRank ? `#${next.oppRank} ` : ""}{next.opp}</b>{fmtDate(next.g) ? ` · ${fmtDate(next.g)}` : ""}.</>, scheduleGameHref(next.g));
    }
    return f.sort((a, b) => b.score - a.score).slice(0, isMobile ? 6 : 8);
  }, [season, leaders, teamRanks, currentTop25, canonicalSchool, school?.Conference, isMobile]);

  if (!data) return <LoadingSpinner label="Loading insights" size={36} minHeight="240px" />;

  const updated = [data.leaders?.updatedAt, data.teams?.updatedAt].map((t) => t?.toDate?.()).filter(Boolean).sort((a, b) => b - a)[0];
  const ownRank = currentTop25?.[canonicalSchool];
  const { all, conf, ranked, streak } = season;
  const ppgRow = teamRanks?.rows.find((r) => r.key === "ppg");
  const papgRow = teamRanks?.rows.find((r) => r.key === "papg");
  const nothing = all.n === 0 && leaders.length === 0 && !teamRanks;

  const tiles = [
    { label: "Record", value: all.n ? recStr(all.w, all.l, all.t) : "0-0" },
    { label: "Top 25", value: ownRank ? `#${ownRank}` : "NR", sub: ownRank ? "Latest poll" : "Unranked" },
    school?.Conference && school.Conference !== "Independent" && { label: `${school.Conference}`, value: recStr(conf.w, conf.l, conf.t), sub: "Conference" },
    { label: "Vs. Ranked", value: recStr(ranked.w, ranked.l, ranked.t) },
    streak && { label: "Streak", value: `${streak.res}${streak.n}`, color: streak.res === "W" ? WIN : streak.res === "L" ? LOSS : INK },
    (ppgRow || season.ppg != null) && { label: "Points / G", value: (ppgRow?.v ?? season.ppg).toFixed(1), sub: ppgRow ? `#${ppgRow.rank} FBS` : null },
    (papgRow || season.papg != null) && { label: "Allowed / G", value: (papgRow?.v ?? season.papg).toFixed(1), sub: papgRow ? `#${papgRow.rank} FBS` : null },
  ].filter(Boolean);

  const card = { border: `1px solid ${LINE}`, borderRadius: "14px", overflow: "hidden", background: "#fff", marginBottom: "18px" };
  const head = (title, right) => (
    <div style={{ background: color1, padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
      <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "14px", letterSpacing: "0.12em", textTransform: "uppercase" }}>{title}</div>
      {right}
    </div>
  );
  const stripe = <div style={{ height: "3px", background: color2 }} />;

  if (nothing) {
    return (
      <div style={card}>
        {head("Insights")}
        {stripe}
        <div style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "10px" }}>📊</div>
          <div style={{ fontSize: "15px", fontWeight: 900, color: INK }}>No season insights yet</div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: INK_4, marginTop: "6px" }}>They show up once {canonicalSchool} has played and the weekly stats have synced.</div>
        </div>
      </div>
    );
  }

  const leadersShown = showAllLeaders ? leaders : leaders.slice(0, LEADERS_SHOWN);

  return (
    <div>
      <style>{`
        .wd-ins-row { transition: background 0.12s ease; }
        a.wd-ins-row:hover { background: color-mix(in srgb, ${color1} 6%, #fff) !important; }
      `}</style>

      {/* ── Season Snapshot ── */}
      <div style={card}>
        {head(`${data.teams?.season || data.leaders?.season || ""} Season Snapshot`.trim(), updated && (
          <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 800, whiteSpace: "nowrap" }}>
            Stats updated {updated.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        ))}
        {stripe}
        <div style={{
          display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? "96px" : "118px"}, 1fr))`,
          gap: "1px", background: LINE_2,
        }}>
          {tiles.map((t) => (
            <div key={t.label} style={{ background: "#fff", padding: isMobile ? "12px 8px" : "16px 12px", textAlign: "center" }}>
              <div style={{ fontSize: "11px", fontWeight: 900, color: INK_4, textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</div>
              <div style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 900, color: t.color || INK, lineHeight: 1.15, marginTop: "4px", fontVariantNumeric: "tabular-nums" }}>{t.value}</div>
              {t.sub && <div style={{ fontSize: "11px", fontWeight: 800, color: color1, marginTop: "3px" }}>{t.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Quick Hits ── */}
      {facts.length > 0 && (
        <div style={card}>
          {head("Quick Hits")}
          {stripe}
          {facts.map((f, i) => {
            const body = (
              <>
                <span style={{ fontSize: "18px", width: "26px", textAlign: "center", flexShrink: 0 }}>{f.icon}</span>
                <span style={{ flex: 1, fontSize: "14px", fontWeight: 600, color: INK_2, lineHeight: 1.4, fontFamily: "Arial, sans-serif" }}>{f.text}</span>
                {f.to && <span style={{ color: INK_4, fontWeight: 900, fontSize: "14px" }}>›</span>}
              </>
            );
            const style = { display: "flex", alignItems: "center", gap: "10px", padding: "11px 16px", textDecoration: "none", background: "#fff", borderBottom: i < facts.length - 1 ? `1px solid ${LINE_2}` : "none" };
            return f.to
              ? <Link key={i} to={f.to} className="wd-ins-row" style={style}>{body}</Link>
              : <div key={i} style={style}>{body}</div>;
          })}
        </div>
      )}

      {/* ── National Leaders ── */}
      {leaders.length > 0 && (
        <div style={card}>
          {head("National Leaders", <Link to="/cfb/stats" style={{ color: "rgba(255,255,255,0.85)", fontSize: "11px", fontWeight: 900, textDecoration: "underline", textUnderlineOffset: "3px", whiteSpace: "nowrap" }}>All FBS Leaders</Link>)}
          {stripe}
          {leadersShown.map((l, i) => {
            const top10 = l.rank <= 10;
            const body = (
              <>
                <div style={{
                  width: isMobile ? "44px" : "52px", flexShrink: 0, textAlign: "center", borderRadius: "10px", padding: "6px 0",
                  background: l.rank === 1 ? color1 : top10 ? `color-mix(in srgb, ${color1} 12%, #fff)` : SOFT,
                  border: `1px solid ${l.rank === 1 ? color1 : top10 ? `color-mix(in srgb, ${color1} 35%, #fff)` : LINE}`,
                }}>
                  <div style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 900, lineHeight: 1, color: l.rank === 1 ? "#fff" : INK, fontVariantNumeric: "tabular-nums" }}>
                    {l.tied ? "T" : "#"}{l.rank}
                  </div>
                  <div style={{ fontSize: "10px", fontWeight: 800, marginTop: "2px", color: l.rank === 1 ? "rgba(255,255,255,0.85)" : INK_4, textTransform: "uppercase" }}>FBS</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "11px", fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.08em" }}>{l.cat}</div>
                  <div style={{ fontSize: "15px", fontWeight: 900, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {l.first} {l.last}{l.pos && <span style={{ color: INK_4, fontWeight: 800, fontSize: "12px" }}> · {l.pos}</span>}
                  </div>
                  {l.x && <div style={{ fontSize: "12px", fontWeight: 700, color: INK_3, fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.x}</div>}
                </div>
                <div style={{ fontSize: isMobile ? "22px" : "26px", fontWeight: 900, color: INK, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{l.v}</div>
              </>
            );
            const style = { display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", textDecoration: "none", background: "#fff", borderBottom: i < leadersShown.length - 1 ? `1px solid ${LINE_2}` : "none" };
            return l.slug
              ? <Link key={`${l.catKey}-${l.id}`} to={`/player/${l.slug}`} className="wd-ins-row" style={style}>{body}</Link>
              : <div key={`${l.catKey}-${l.id}`} style={style}>{body}</div>;
          })}
          {leaders.length > LEADERS_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAllLeaders((v) => !v)}
              style={{ display: "block", width: "100%", padding: "10px", border: "none", borderTop: `1px solid ${LINE_2}`, background: SOFT, color: color1, fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer" }}
            >
              {showAllLeaders ? "Show Less ▴" : `Show All ${leaders.length} ▾`}
            </button>
          )}
        </div>
      )}

      {/* ── Team stat ranks ── */}
      {teamRanks && teamRanks.rows.length > 0 && (
        <div style={card}>
          {head(`Where ${shortName} Ranks`, <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 800, whiteSpace: "nowrap" }}>Among {teamRanks.rows[0].field} FBS teams</span>)}
          {stripe}
          <div style={{ padding: isMobile ? "4px 12px 8px" : "6px 16px 10px" }}>
            {teamRanks.rows.map((r, i) => {
              const confName = school?.Conference && school.Conference !== "Independent" ? school.Conference : null;
              return (
                <div
                  key={r.key}
                  title={`${r.title}: ${fmtTeamStat(r.key, r.v)} — ${r.tied ? "T-" : "#"}${r.rank} of ${r.field} FBS${r.confRank ? ` · ${ordinal(r.confRank)} of ${r.confSize} in the ${school?.Conference}` : ""}`}
                  style={{
                    display: isMobile ? "block" : "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr)",
                    gap: "12px", alignItems: "center", padding: "12px 0",
                    borderBottom: i < teamRanks.rows.length - 1 ? `1px solid ${LINE_2}` : "none",
                  }}
                >
                  <div style={{ display: isMobile ? "flex" : "block", alignItems: "baseline", justifyContent: "space-between", gap: "8px", marginBottom: isMobile ? "8px" : 0, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 900, color: INK_2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isMobile ? shortTitle(r.title) : r.title}
                    </div>
                    <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: INK, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                      {fmtTeamStat(r.key, r.v)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: isMobile ? "8px" : "12px", gridColumn: isMobile ? undefined : "2 / 4" }}>
                    <RankBlock label="FBS" rank={r.rank} tied={r.tied} of={r.field} color1={color1} isMobile={isMobile} />
                    <RankBlock label={confName || "Conference"} rank={confName ? r.confRank : null} tied={r.confTied} of={r.confSize} color1={color1} isMobile={isMobile} conf />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: "8px 16px", borderTop: `1px solid ${LINE_2}`, background: SOFT, fontSize: "11px", fontWeight: 700, color: INK_4, fontFamily: "Arial, sans-serif" }}>
            Fuller bar = higher rank (for "allowed" stats, fewer is better). Highlighted: top 10% of the field. Through {teamRanks.games} game{teamRanks.games !== 1 ? "s" : ""}.
          </div>
        </div>
      )}
    </div>
  );
}
