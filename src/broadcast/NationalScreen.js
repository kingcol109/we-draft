// src/broadcast/NationalScreen.js
//
// The national broadcast — one 1920×1080 frame with no one game on it: the
// big plays and storylines from every game across the country, rendered
// entirely from useNationalState (no data reads in here). Laid out on the
// game broadcast's grid (BroadcastScreen.js), so the two feel like one
// show and the event graphics (BroadcastEvents.js) morph over the same
// columns:
//
//   top bar      We-Draft Live · National Coverage, the week, games live
//   rail         where the scorebug sits: four games' scorebugs (eight
//                narrow ones once more than eight are live), live games
//                first, paging when there are more; each with its channel
//   strip        where the situation strip sits: the storyline of the moment
//                (an upset brewing, crunch time, overtime, a big day by a
//                We-Draft prospect or anyone) — or what's next
//   left column  Around the Nation: the big play of the moment, with its
//                players' numbers and its game; the ones before it under it
//   right column Storylines: the newest insight cards from the live games —
//                and now and then the prospect spotlight, which expands the
//                column up over the strip: a prospect's day, grade,
//                strengths and weaknesses
//   ticker       finals, upcoming kickoffs, calls to action
//
// Graphics run in two lanes (useNationalState): big plays on the left, a
// prospect's moment on the right.
//
// Same canvas, fonts and rules as the game broadcast: fixed footprints,
// transform / opacity motion only, nothing animating while idle.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import BroadcastEvent from "./BroadcastEvents";
import { Logo } from "./TeamLogo";
import { panelColor, playerUrl } from "../utils/broadcast";
import { teamName, teamShort, statusLabel } from "../utils/live";
import { playSummary } from "../components/LivePlayCard";
import { GRADE_BADGE } from "../components/LiveInsightCard";
import { scoreLine, playClock, isScore, isFinalEntry, upcomingGames, NATIONAL_PER_PAGE, UP_NEXT_PER_PAGE, UP_NEXT_PAGE_MS } from "../utils/broadcastNational";

const WD_ICON = "/wd-icon.png";
const ET = "America/New_York";
const TICK_ROTATE_MS = 7 * 1000;
const IDLE_TICK_ROTATE_MS = 14 * 1000;

function Ball() {
  return (
    <svg className="ball" viewBox="0 0 38 24" aria-hidden="true">
      <ellipse cx="19" cy="12" rx="18" ry="11" fill="currentColor" />
      <path d="M11 12h16M15 9v6M19 9v6M23 9v6" stroke="#0b1426" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Top bar ──
function TopBar({ s }) {
  const lastAt = new Date(s.health.lastDataAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
  const wk = s.week != null ? (s.seasonType === "postseason" ? "Bowl Season" : `Week ${s.week}`) : null;
  return (
    <div className="bc-top">
      <div className="bc-brand"><img src={WD_ICON} alt="" /><span className="bc-disp">We-Draft<span className="live">Live</span></span></div>
      <div className="bc-ctx">
        {wk && <span>{wk}</span>}
        <span className="tag">National Coverage</span>
      </div>
      <div className="bc-pills">
        {s.health.stale && <span className="bc-pill stale">{s.health.offline ? "Connection lost" : "Live data delayed"} · last update {lastAt} ET</span>}
        {s.liveCount > 0
          ? <span className="bc-pill live"><i />{s.liveCount} {s.liveCount === 1 ? "game" : "games"} live</span>
          : <span className="bc-pill pre">No games live</span>}
      </div>
    </div>
  );
}

// ── The rail ──
const kickTime = (g, now) => {
  const d = new Date(g.startDate || "");
  const day = (x) => x.toLocaleDateString("en-US", { weekday: "short", timeZone: ET });
  const pre = isNaN(d) || day(d) === day(new Date(now)) ? "" : `${day(d)} `;
  if (isNaN(d) || g.startTimeTBD) return `${pre}TBA`;
  return `${pre}${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })} ET`;
};
// The channel, short enough for a scorebug ("CW | The CW Network" → "CW").
const channel = (g) => (g?.tv ? String(g.tv).split("|")[0].trim() : null);
// A team's name where room is short: its short name when the full one
// wouldn't fit.
// A team's short name with its rank ahead of it ("#12 IOWA"), in text; Rk
// is the same in a gold tag, for rows.
const rs = (t) => `${t?.rank ? `#${t.rank} ` : ""}${teamShort(t)}`;
const Rk = ({ t }) => (t?.rank ? <span className="nr-rk">#{t.rank}</span> : null);
const fitName = (t, max = 18) => { const n = teamName(t); return n.length > max ? teamShort(t) || n : n; };
// A headline that would run long: the teams' short names in it ("South
// Alabama has taken control" → "USA has taken control"), and a size class
// that steps down before anything gets cut off.
function fitHeadline(text, g) {
  let t = String(text || "");
  if (t.length > 24 && g) {
    for (const side of ["home", "away"]) {
      const full = teamName(g[side]);
      const short = teamShort(g[side]);
      if (full && short && full !== short) t = t.replace(new RegExp(full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), short);
    }
  }
  return { text: t, size: t.length > 30 ? " xs" : t.length > 22 ? " sm" : "" };
}

function BugTeam({ g, side, live, lose, win, scored }) {
  const t = g[side] || {};
  return (
    <div className={`nr-team${lose ? " lose" : ""}${win ? " win" : ""}${scored ? " hot" : ""}`} style={{ "--pc": panelColor(t) }}>
      <Logo team={t} className="nr-logo" />
      <div className="nr-name">
        {t.rank ? <span className="rank bc-disp">#{t.rank}</span> : null}
        <span className="school bc-disp bc-ell">{teamShort(t) || teamName(t)}</span>
        {t.record && <span className="rec">{t.record}</span>}
        {live && g.possession === side && <Ball />}
      </div>
      <div className="nr-pts">
        <b key={t.points} className={`bc-disp${scored ? " pop" : ""}`}>{live || g.status === "final" ? t.points ?? 0 : ""}</b>
      </div>
    </div>
  );
}

function Bug({ card, hot, now, i }) {
  const { game: g, kind } = card;
  const live = kind === "live";
  const hp = g.home?.points ?? 0;
  const ap = g.away?.points ?? 0;
  const lose = kind === "final" && hp !== ap ? (hp > ap ? "away" : "home") : null;
  const label = live ? statusLabel(g) : kind === "upcoming" ? kickTime(g, now) : g.period > 4 ? "Final/OT" : "Final";
  const off = live && g.possession ? g[g.possession] : null;
  // (between a score and the kickoff the provider's situation is junk like
  // "& -1" — only a real down is shown)
  const down = off && /^[1-4](st|nd|rd|th) & ([1-9]\d?|goal)\b/i.test(g.situation || "") ? g.situation : null;
  const tv = channel(g);
  const status = kind === "upcoming" ? `Kickoff ${label}` : label;
  return (
    <div className={`nr-bug ${kind}${card.close ? " close" : ""}${hot ? " hot" : ""}`} style={{ "--i": i }}>
      <BugTeam g={g} side="away" live={live} lose={lose === "away"} win={lose === "home"} scored={hot?.side === "away"} />
      <BugTeam g={g} side="home" live={live} lose={lose === "home"} win={lose === "away"} scored={hot?.side === "home"} />
      <div className="nr-foot">
        <span className={`st${live ? " on" : ""}`}>{status}</span>
        {tv && <span className="ch">{tv}</span>}
        {hot ? <span className="nr-flag bc-disp">{teamShort(g[hot.side])} +{hot.pts}</span>
          : down ? <span className="dd bc-ell">{teamShort(off)} · {down.replace(/\s+at\s+.*$/i, "")}</span> : null}
      </div>
    </div>
  );
}

// Close games hold their slots (keyed by game, so they never re-animate
// when the others turn over); the rest come and go.
function Rail({ s }) {
  const cards = s.page;
  return (
    <div className="nr-rail">
      {cards.map((c, i) => <Bug key={c.game.id} card={c} hot={s.hot.get(String(c.game.id))} now={s.now} i={i} />)}
      {Array.from({ length: Math.max(0, NATIONAL_PER_PAGE - cards.length) }, (_, k) => (
        <div key={`empty-${k}`} className="nr-bug empty"><img src={WD_ICON} alt="" /></div>
      ))}
    </div>
  );
}

// ── The storyline strip ──
const TONE = { red: "#d92b2b", gold: "#f6a21d", blue: "#0055a5" };
function StoryStrip({ s }) {
  const st = s.story;
  const narrow = !!s.spotlight; // the spotlight takes the strip's right end
  if (!st) return <div className={`bc-sit${narrow ? " nr-narrow" : ""}`} />;
  const g = st.game;
  const tv = channel(g);
  return (
    <div className={`bc-sit nr-story${narrow ? " nr-narrow" : ""}`}>
      <div key={`c-${st.key}`} className={`bc-dd bc-disp nr-chip ${st.tone}`} style={{ "--oc": TONE[st.tone] }}>{st.chip}</div>
      <div key={`t-${st.key}`} className="nr-story-txt bc-ell">{st.text}</div>
      {g && (
        <div key={`g-${st.key}`} className="nr-story-teams">
          <Logo team={g.away} /><span>vs</span><Logo team={g.home} />
          {tv && <em>{tv}</em>}
        </div>
      )}
    </div>
  );
}

// ── Around the Nation: the big play of the moment ──
const TONES = { td: "#f6a21d", turnover: "#ff5a5a", big: "#4d9fff" };
const toneOf = (b) => {
  const pr = b.presentation || {};
  const k = b.kinds || [];
  return pr.touchdown || k.includes("score") ? "td" : pr.turnover || k.includes("turnover") ? "turnover" : "big";
};
const agoText = (at, now) => {
  const m = Math.round((now - (at || now)) / 60e3);
  return m < 2 ? "Just now" : m < 60 ? `${m} min ago` : "Earlier";
};

// The play's game, as a little scoreboard: both teams, the score now, the
// clock and the channel.
function MiniBoard({ g, b }) {
  const row = (side) => {
    const t = g ? g[side] : null;
    return (
      <div className="r">
        {t ? <Logo team={t} /> : <span />}
        <span className="n bc-ell">{t ? <><Rk t={t} />{teamShort(t)}</> : side === "away" ? b.awayShort : b.homeShort}</span>
        <b className="bc-disp">{t ? t.points ?? 0 : side === "away" ? b.awayScore ?? 0 : b.homeScore ?? 0}</b>
      </div>
    );
  };
  const tv = channel(g);
  return (
    <div className="nr-mini">
      {row("away")}
      {row("home")}
      <div className="s">
        <span>{g?.status === "in_progress" ? statusLabel(g) : g?.status === "final" ? "Final" : playClock(b)}</span>
        {tv && <em>{tv}</em>}
      </div>
    </div>
  );
}

function LatestPanel({ s }) {
  const b = s.latest;
  if (!b) {
    const next = s.page.find((c) => c.kind === "upcoming")?.game;
    return (
      <div className="bc-panel bc-play">
        <div className="bc-ph"><span className="gold">Around the nation</span></div>
        <div className="bc-next">
          {next ? <Logo team={next.home} /> : <img src={WD_ICON} alt="" style={{ width: 120, height: 120 }} />}
          <div style={{ minWidth: 0 }}>
            <div className="lbl">{next ? "Up next" : "We-Draft Live"}</div>
            <div className="big bc-disp bc-ell" style={{ fontSize: 88 }}>{next ? `${rs(next.away)} at ${rs(next.home)}` : "Big plays from every game"}</div>
            <div className="sm">{next ? `Kickoff ${kickTime(next, s.now)}${next.tv ? ` · ${channel(next)}` : ""}` : "Touchdowns, takeaways and big gains show here as they happen"}</div>
          </div>
        </div>
      </div>
    );
  }
  if (isFinalEntry(b)) return <FinalPanel s={s} b={b} />;
  const pr = b.presentation || {};
  const g = s.gamesById.get(String(b.gameId)) || null;
  const line = pr.line?.length ? pr.line.map((t) => ({ text: t.player ? t.player.name : t.text, player: !!t.player, sub: !!t.sub })) : null;
  // The game's scoreboard only when the play changed the score; otherwise
  // just which game it was, up in the header.
  const scored = isScore(b);
  const where = g ? `${rs(g.away)} vs ${rs(g.home)}${channel(g) ? ` · ${channel(g)}` : ""}` : `${b.awayShort} vs ${b.homeShort}`;
  return (
    <div className="bc-panel bc-play">
      <div className="bc-ph"><span className="gold">Around the nation</span><span className="right">{scored ? "" : `${where} · `}{playClock(b)} · {agoText(b.at, s.now)}</span></div>
      <div key={b.key} className="bc-play-body" style={{ "--tone": TONES[toneOf(b)] }}>
        <div className="bc-play-main">
          <span className="bc-badge">{b.label || pr.headline || "Big play"}</span>
          <div className="bc-line">
            {line ? line.map((t, i) => <span key={i} className={t.player ? "pl" : t.sub ? "sub" : undefined}>{i ? " " : ""}{t.text}</span>)
              : (pr.fallbackText || b.text || "").replace(/^\(\d{1,2}:\d{2}\)\s*/, "")}
          </div>
          {pr.detail && <div className="bc-detail bc-ell">{pr.detail}</div>}
          {s.latestStats.length > 0 && (
            <div className="bc-pstats nr-pstats">
              {s.latestStats.map((x) => (
                <div key={x.name} className="bc-pstat" style={{ "--pc": panelColor(g?.[x.side]) }}>
                  <Logo team={g?.[x.side]} />
                  <span className="n">{x.name.split(" ").slice(-1)[0]}</span>
                  <span className="l">{x.line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {scored && (
          <div className="bc-play-side nr-side">
            <MiniBoard g={g} b={b} />
          </div>
        )}
      </div>
    </div>
  );
}

// A game that just ended: the winner's moment — their color across the
// panel, the logo, "X WINS", the final, and the player of the game.
function FinalPanel({ s, b }) {
  // the slate's game; else the teams and score the entry itself carries
  const g = s.gamesById.get(String(b.gameId)) || { id: b.gameId, period: b.period, home: { short: b.homeShort, school: b.homeShort, points: b.homeScore, logo: b.homeLogo }, away: { short: b.awayShort, school: b.awayShort, points: b.awayScore, logo: b.awayLogo } };
  const hp = g.home?.points ?? 0;
  const ap = g.away?.points ?? 0;
  const ws = hp >= ap ? "home" : "away";
  const win = g[ws] || {};
  const lose = g[ws === "home" ? "away" : "home"] || {};
  const star = s.latestStar;
  const tags = ["Final", (g.period || 0) > 4 && "Overtime", b.presentation?.upset && "Upset"].filter(Boolean);
  return (
    <div className="bc-panel bc-play nr-final" style={{ "--wc": panelColor(win) }}>
      <div className="bc-ph"><span className="gold">Around the nation</span><span className="right">{`${rs(g.away)} vs ${rs(g.home)}`}{channel(g) ? ` · ${channel(g)}` : ""} · {agoText(b.at, s.now)}</span></div>
      <div key={b.key} className="nr-final-body">
        <div className="wash" />
        <Logo team={win} className="wl" />
        <div className="mid">
          <div className="tags">{tags.map((t) => <span key={t} className={t === "Upset" ? "up" : ""}>{t}</span>)}</div>
          <div className={`wins bc-disp${fitName(win, 14).length > 11 ? " long" : ""}`}>{win?.rank ? `#${win.rank} ` : ""}{fitName(win, 14)} wins</div>
          <div className="sc bc-disp"><b>{Math.max(hp, ap)}</b><i>–</i>{Math.min(hp, ap)}<small>{lose?.rank ? `#${lose.rank} ` : ""}{fitName(lose, 14)}</small></div>
        </div>
        {star && (
          <div className="star" style={{ "--pc": panelColor(g[star.side]) }}>
            <div className="k">Player of the game</div>
            <div className="who"><Logo team={g[star.side]} /><span className={`bc-disp${star.name.length > 16 ? " long" : ""}`}>{star.name}</span></div>
            {star.lines.map((l) => <div key={l} className="l">{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Nothing on: the week's top performances ──
function PerformancePanel({ s }) {
  const p = s.perfList[s.perfIndex];
  if (!p) return <LatestPanel s={{ ...s, latest: null }} />;
  const g = p.game;
  const team = g?.[p.side] || null;
  return (
    <div className="bc-panel bc-play nr-perf" style={{ "--wc": panelColor(team) }}>
      <div className="bc-ph"><span className="gold">Top performances</span><span className="right">Around the country this week</span></div>
      <div key={p.key} className="nr-final-body">
        <div className="wash" />
        {team ? <Logo team={team} className="wl" /> : <img className="wl" src={WD_ICON} alt="" />}
        <div className="mid">
          <div className="tags"><span>{p.catLabel}</span>{p.prospect && <span className="wd">We-Draft prospect</span>}</div>
          <div className={`wins bc-disp${p.name.length > 16 ? " long" : ""}`}>{p.name}</div>
          <div className="pl">{p.line}</div>
          {g && <div className="gm">{rs(g.away)} {g.away?.points ?? 0} – {rs(g.home)} {g.home?.points ?? 0} · {g.status === "final" ? (g.period > 4 ? "Final/OT" : "Final") : statusLabel(g)}</div>}
        </div>
      </div>
    </div>
  );
}

function PerfRows({ s }) {
  const n = s.perfList.length;
  const rows = n > 1 ? [1, 2, 3].map((k) => s.perfList[(s.perfIndex + k) % n]).filter((p, i, a) => p && a.indexOf(p) === i && p !== s.perfList[s.perfIndex]) : [];
  return (
    <div className="bc-panel bc-recent">
      <div className="bc-ph"><span>More of the week's best</span></div>
      {rows.map((p) => (
        <div key={p.key} className="bc-rrow normal">
          <span className="t">{p.catLabel}</span>
          {p.game?.[p.side] ? <Logo team={p.game[p.side]} /> : <span style={{ width: 30 }} />}
          <span className="x bc-ell"><b>{p.name}</b> · {p.line}</span>
          {p.game && <span className="st">{rs(p.game.away)} {p.game.away?.points ?? 0} – {rs(p.game.home)} {p.game.home?.points ?? 0}</span>}
        </div>
      ))}
      {!rows.length && <div className="bc-rrow"><span className="x" style={{ color: "#7f90aa" }}>The week's top lines show here once games are played.</span></div>}
    </div>
  );
}

// The right column with nothing on: the upcoming schedule, a page of
// kickoffs at a time under a row naming their day (a day with more games
// than fit runs over several pages; a page never mixes days). We-Draft
// prospects' best lines this week are in the storyline strip.
const etDay = (d) => d.toLocaleDateString("en-CA", { timeZone: ET }); // 2026-10-09
function dayLabel(g, now) {
  const d = new Date(g.startDate || "");
  if (isNaN(d)) return "Date TBA";
  const full = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: ET });
  if (etDay(d) === etDay(new Date(now))) return `Today · ${full}`;
  if (etDay(d) === etDay(new Date(now + 86400e3))) return `Tomorrow · ${full}`;
  return full;
}
const kickClock = (g) => {
  const d = new Date(g.startDate || "");
  return isNaN(d) || g.startTimeTBD ? "TBA" : `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })} ET`;
};
function upNextPages(games, now) {
  const pages = [];
  let last = null;
  for (const g of upcomingGames(games, now)) {
    const day = dayLabel(g, now);
    const cur = pages[pages.length - 1];
    if (!cur || day !== last || cur.games.length >= UP_NEXT_PER_PAGE) pages.push({ day, games: [g] });
    else cur.games.push(g);
    last = day;
  }
  return pages;
}
function UpNext({ s }) {
  const pages = useMemo(() => upNextPages(s.games, s.now), [s.games, s.now]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (pages.length < 2) return undefined;
    const t = setInterval(() => setTick((x) => x + 1), UP_NEXT_PAGE_MS);
    return () => clearInterval(t);
  }, [pages.length]);
  const i = pages.length ? tick % pages.length : 0;
  const page = pages[i];
  return (
    <div className="bc-panel bc-tstats nr-stories">
      <div className="bc-ph"><img src={WD_ICON} alt="" /><span className="gold">Up next</span><span className="right">Kickoffs</span></div>
      {page && <div key={`d-${i}-${page.day}`} className="nr-up-day">{page.day}</div>}
      {page?.games.map((g, j) => (
        <div key={`${i}-${g.id}`} className="nr-close nr-up" style={{ "--i": j }}>
          <Logo team={g.away} /><b className="bc-ell"><Rk t={g.away} />{teamShort(g.away)}</b>
          <Logo team={g.home} /><b className="bc-ell"><Rk t={g.home} />{teamShort(g.home)}</b>
          <span>{kickClock(g)}</span>
        </div>
      ))}
    </div>
  );
}

// The team a play is credited to, from its game (the play carries only that
// team's logo), so its dark-background logo can be used.
const creditTeam = (b, s) => {
  const g = s.gamesById.get(String(b.gameId));
  return b.teamLogo && g ? [g.home, g.away].find((t) => t && (t.logo === b.teamLogo || t.logoDark === b.teamLogo)) || null : null;
};

function RecentBig({ s }) {
  const rows = s.recent;
  const firstTop = useRef(rows[0]?.key);
  return (
    <div className="bc-panel bc-recent">
      <div className="bc-ph"><span>Earlier around the country</span></div>
      {rows.map((b, i) => {
        const pr = b.presentation || {};
        const tone = toneOf(b);
        // "Big run · Mekhi Anderson · 30-yard run" — the play's distance
        // (its detail line, else its yards), not just what kind of play it was.
        // (only a distance — "Stopped on 4th down" just repeats the label)
        const yards = /\d+[- ]yard/i.test(pr.detail || "") ? pr.detail : pr.yards != null ? `${pr.yards} yards` : null;
        const text = pr.line?.length ? [b.label, pr.line.map((t) => (t.player ? t.player.name : t.text)).join(" "), yards].filter(Boolean).join(" · ") : playSummary(pr) || b.text;
        return (
          <div key={b.key} className={`bc-rrow ${tone === "big" ? "normal" : tone}${i === 0 && b.key !== firstTop.current ? " fresh" : ""}`}>
            <span className="t">{playClock(b)}</span>
            {creditTeam(b, s) ? <Logo team={creditTeam(b, s)} /> : b.teamLogo ? <img src={b.teamLogo} alt="" /> : <span style={{ width: 30 }} />}
            <span className="x bc-ell">{text}</span>
            <span className="st">{b.awayShort} {b.awayScore ?? 0} – {b.homeShort} {b.homeScore ?? 0}</span>
          </div>
        );
      })}
      {!rows.length && <div className="bc-rrow"><span className="x" style={{ color: "#7f90aa" }}>Big plays from every game will appear here.</span></div>}
    </div>
  );
}

// ── Storylines: the newest insight cards across the live games ──
function Storylines({ s }) {
  const list = s.insights;
  return (
    <div className="bc-panel bc-tstats nr-stories">
      <div className="bc-ph"><img src={WD_ICON} alt="" /><span className="gold">Storylines</span><span className="right">Across the nation</span></div>
      {list.map(({ insight: ins, game: g }, i) => {
        const side = ins.side ? g[ins.side] : null;
        const kick = ins.wd ? "We-Draft Player Watch" : ins.kind === "player" ? (ins.milestone ? "Milestone" : "Player") : ins.category === "game_trend" ? "Game trend" : "Team trend";
        const player = ins.kind === "player";
        const head = fitHeadline(player ? ins.title || ins.player?.name : ins.headline || ins.title, g);
        const more = player ? ins.statLine || ins.context : ins.context || ins.statLine;
        return (
          <div key={`${g.id}-${ins.id}`} className="nr-ins" style={{ "--pc": panelColor(side), "--i": i }}>
            <div className="k"><Logo team={side || { logo: ins.teamLogo }} /><span className="bc-ell">{kick}</span><em>{scoreLine(g)}</em></div>
            <div className={`h bc-disp bc-ell${head.size}`}>{head.text}</div>
            {more && <div className="c">{more}</div>}
          </div>
        );
      })}
      {!list.length && <ClosestGames s={s} />}
    </div>
  );
}

// No insight cards yet: the closest games on now.
function ClosestGames({ s }) {
  const live = s.games.filter((g) => g.status === "in_progress")
    .map((g) => ({ g, m: Math.abs((g.home?.points ?? 0) - (g.away?.points ?? 0)) }))
    .sort((a, b) => a.m - b.m || (b.g.period || 0) - (a.g.period || 0)).slice(0, 5);
  if (!live.length) return <div className="bc-quiet" style={{ padding: "0 26px" }}>Storylines from every game show here once kickoffs roll in.</div>;
  return (
    <>
      <div className="nr-sub">Closest games right now</div>
      {live.map(({ g }) => (
        <div key={g.id} className="nr-close">
          <Logo team={g.away} /><b className="bc-ell"><Rk t={g.away} />{teamShort(g.away)} {g.away?.points ?? 0}</b>
          <Logo team={g.home} /><b className="bc-ell"><Rk t={g.home} />{teamShort(g.home)} {g.home?.points ?? 0}</b>
          <span>{statusLabel(g)}</span>
        </div>
      ))}
    </>
  );
}

// ── Prospect spotlight: the storyline column, expanded ──
const CAT_LABEL = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defense: "Defense" };
function Spotlight({ sp }) {
  const c = sp.cand;
  const g = sp.game || c.game;
  const team = g?.[c.side] || null;
  const p = c.prospect || {};
  const card = sp.card || {};
  const grade = card.grade || p.grade || "Watchlist";
  const badge = GRADE_BADGE[grade] || GRADE_BADGE.Watchlist;
  const strengths = card.strengths?.length ? card.strengths : p.strengths || [];
  const weaknesses = card.weaknesses || [];
  const meta = [card.pos || p.pos, fitName(team, 20), (card.cls || p.cls) ? `Class of ${card.cls || p.cls}` : null].filter(Boolean).join(" • ");
  const tv = channel(g);
  return (
    <div key={sp.key} className="bc-panel nr-spot" style={{ "--pc": panelColor(team) }}>
      <div className="bc-ph"><img src={WD_ICON} alt="" /><span className="gold">Prospect spotlight</span><span className="right">{g ? `${statusLabel(g)}${tv ? ` · ${tv}` : ""}` : ""}</span></div>
      <div className="nr-spot-body">
        <div className="who">
          <Logo team={team} />
          <div style={{ minWidth: 0 }}>
            <div className={`nm bc-disp${c.name.length > 16 ? " long" : ""}`}>{c.name}</div>
            {meta && <div className="meta bc-ell">{meta}</div>}
          </div>
        </div>
        <div className="today">
          <div className="h">Today{g ? ` · ${scoreLine(g)}` : ""}</div>
          {c.lines.slice(0, 2).map((l) => (
            <div key={l.cat} className="ln"><span>{CAT_LABEL[l.cat]}</span><b className="bc-ell">{l.line}</b></div>
          ))}
        </div>
        <div className="grade">
          <span className="pill" style={{ background: badge.bg, borderColor: badge.border }}>{badge.short}</span>
          <span className="gl">{grade}</span>
          {p.classRank && (card.cls || p.cls) && <span className="rk">No. {p.classRank} in {card.cls || p.cls}</span>}
        </div>
        {strengths.length > 0 && (
          <div className="tags good"><span className="h">Strengths</span>{strengths.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}</div>
        )}
        {weaknesses.length > 0 && (
          <div className="tags bad"><span className="h">Weaknesses</span>{weaknesses.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}</div>
        )}
        {!strengths.length && !weaknesses.length && (
          <div className="none">No community evaluations yet — be the first to grade him on We-Draft.</div>
        )}
        {playerUrl(c.slug) && <div className="url">Full scouting report<b>{playerUrl(c.slug)}</b></div>}
      </div>
    </div>
  );
}

// ── Ticker: finals, next kickoffs, calls to action ──
function Ticker({ items, idle }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), idle ? IDLE_TICK_ROTATE_MS : TICK_ROTATE_MS);
    return () => clearInterval(t);
  }, [idle]);
  const c = items.length ? items[i % items.length] : null;
  return (
    <div className="bc-tick">
      <div className="site bc-disp"><img src={WD_ICON} alt="" />We-Draft.com</div>
      {c && (
        <div key={`${c.key}-${i}`} className="msg">
          {c.tag && <span className="nr-ttag">{c.tag}</span>}
          <span className="l bc-ell">{c.text}</span>
          {c.url && <><span className="arrow" /><span className="u">{c.url}</span></>}
        </div>
      )}
    </div>
  );
}

function NationalScreen({ s }) {
  // The backdrop glows in the colors of the game with the big play on screen.
  const g = s.latest ? s.gamesById.get(String(s.latest.gameId)) : null;
  const vars = { "--away": g?.away?.color || "#0055a5", "--home": g?.home?.color || "#f6a21d" };
  let body;
  if (s.phase === "loading") {
    body = (
      <div className="bc-slate">
        <img src={WD_ICON} alt="" />
        <div className="t bc-disp">We-Draft<span className="live">Live</span></div>
        <div className="s">National coverage starting soon</div>
      </div>
    );
  } else {
    body = (
      <>
        <TopBar s={s} />
        <Rail s={s} />
        <StoryStrip s={s} />
        {s.idle ? <PerformancePanel s={s} /> : <LatestPanel s={s} />}
        {s.idle ? <PerfRows s={s} /> : <RecentBig s={s} />}
        {s.spotlight ? <Spotlight sp={s.spotlight} /> : s.idle ? <UpNext s={s} /> : <Storylines s={s} />}
        <Ticker items={s.ticker} idle={s.idle} />
        <BroadcastEvent event={s.leftEvent} game={s.leftGame} tall={false} />
        <BroadcastEvent event={s.rightEvent} game={s.rightGame} tall={false} />
      </>
    );
  }
  return (
    <>
      <div className="bc-bg" style={vars} />
      <div style={{ ...vars, position: "absolute", inset: 0 }}>{body}</div>
    </>
  );
}

export default memo(NationalScreen);
