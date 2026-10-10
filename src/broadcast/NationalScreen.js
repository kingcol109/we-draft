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
//   ticker       We-Draft promos only (NATIONAL_PROMOS) — never scores
//
// We-Draft Gameday (Saturday morning until the first kickoff — s.gameday):
// the top bar says so and counts down to the first kickoff; the rail and
// strip preview the day's games; the left column is the matchup of the
// moment (both teams, kickoff, a prospect to watch from each school) over
// its tale of the tape and both teams' season leaders; the right column the
// day's kickoffs.
//
// Graphics run in two lanes (useNationalState): big plays on the left, a
// prospect's moment on the right.
//
// Same canvas, fonts and rules as the game broadcast: fixed footprints,
// transform / opacity motion only, nothing animating while idle.
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BroadcastEvent from "./BroadcastEvents";
import { Logo } from "./TeamLogo";
import FitText from "./FitText";
import { panelColor, playerUrl } from "../utils/broadcast";
import { teamName, teamShort, statusLabel } from "../utils/live";
import { playSummary } from "../components/LivePlayCard";
import { GRADE_BADGE } from "../components/LiveInsightCard";
import { scoreLine, playClock, isScore, isFinalEntry, upcomingGames, untilText, LEADER_CATS, NATIONAL_PER_PAGE, UP_NEXT_PER_PAGE, UP_NEXT_PAGE_MS, PREVIEW_ROTATE_MS } from "../utils/broadcastNational";
import { fmtTeamStat } from "../utils/fbsTeamStats";

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
        <span className="tag">{s.gameday ? "We-Draft Gameday" : "National Coverage"}</span>
      </div>
      <div className="bc-pills">
        {s.health.stale && <span className="bc-pill stale">{s.health.offline ? "Connection lost" : "Live data delayed"} · last update {lastAt} ET</span>}
        {s.gameday && s.firstKick ? <span className="bc-pill pre">First kickoff {kickTime(s.firstKick, s.now)}</span>
          : s.liveCount > 0
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

// pc: one color for both rows (gameday previews: the home team's) — then
// the away logo is on another team's color and takes its dark-background
// version, the home logo its own-color one.
function BugTeam({ g, side, live, lose, win, scored, pc = null }) {
  const t = g[side] || {};
  return (
    <div className={`nr-team${lose ? " lose" : ""}${win ? " win" : ""}${scored ? " hot" : ""}`} style={{ "--pc": pc || panelColor(t) }}>
      <Logo team={t} className="nr-logo" onColor={!pc || side === "home"} />
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

function Bug({ card, hot, now, roll = "", gameday = false }) {
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
  // Gameday previews: the whole chip in the home team's color.
  const pc = gameday && kind === "upcoming" ? panelColor(g.home) : null;
  return (
    <div className={`nr-bug ${kind}${card.close ? " close" : ""}${hot ? " hot" : ""}${roll}`}>
      <BugTeam g={g} side="away" live={live} lose={lose === "away"} win={lose === "home"} scored={hot?.side === "away"} pc={pc} />
      <BugTeam g={g} side="home" live={live} lose={lose === "home"} win={lose === "away"} scored={hot?.side === "home"} pc={pc} />
      <div className="nr-foot">
        <span className={`st${live ? " on" : ""}`}>{status}</span>
        {tv && <span className="ch">{tv}</span>}
        {hot ? <span className="nr-flag bc-disp">{teamShort(g[hot.side])} +{hot.pts}</span>
          : down ? <span className="dd bc-ell">{teamShort(off)} · {down.replace(/\s+at\s+.*$/i, "")}</span> : null}
      </div>
    </div>
  );
}

// Each slot rolls when its game changes: the old scorebug rolls up and
// out as the next rolls up into place, slot by slot left to right — a
// scoreboard drum turning over. Close games hold their slots, so they
// never move.
const ROLL_MS = 1400; // the last slot's roll, its stagger included
function Slot({ card, hot, now, i, gameday }) {
  const key = card ? String(card.game.id) : "empty";
  // out: the face rolling away ({ card } — card null for an empty slot)
  const [roll, setRoll] = useState({ key, out: null, n: 0 });
  const last = useRef(card);
  if (roll.key !== key) setRoll({ key, out: { card: last.current }, n: roll.n + 1 });
  last.current = card;
  useEffect(() => {
    if (!roll.out) return undefined;
    const t = setTimeout(() => setRoll((r) => ({ ...r, out: null })), ROLL_MS);
    return () => clearTimeout(t);
  }, [roll.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const face = (c, cls, h) => (c ? <Bug card={c} hot={h} now={now} roll={cls} gameday={gameday} />
    : <div className={`nr-bug empty${cls}`}><img src={WD_ICON} alt="" /></div>);
  return (
    <div className="nr-slot" style={{ "--i": i }}>
      {roll.out && face(roll.out.card, " roll-out", null)}
      {/* keyed by turn, so the incoming face rolls in each time */}
      <Fragment key={`${key}-${roll.n}`}>{face(card, " roll-in", hot)}</Fragment>
    </div>
  );
}

function Rail({ s }) {
  const cards = s.page;
  return (
    <div className={`nr-rail${s.gameday ? " gd" : ""}`}>
      {Array.from({ length: NATIONAL_PER_PAGE }, (_, k) => {
        const c = cards[k] || null;
        return <Slot key={k} card={c} hot={c ? s.hot.get(String(c.game.id)) : null} now={s.now} i={k} gameday={s.gameday} />;
      })}
    </div>
  );
}

// ── The storyline strip ──
const TONE = { red: "#d92b2b", gold: "#f6a21d", blue: "#0055a5" };
// Gameday: the strip promotes We-Draft Live instead of the day's storylines.
const LIVE_PROMO = "Follow the action around the country here live";
function StoryStrip({ s }) {
  const narrow = !!s.spotlight; // the spotlight takes the strip's right end
  if (s.gameday) {
    return (
      <div className={`bc-sit nr-story nr-promo${narrow ? " nr-narrow" : ""}`}>
        <div className="bc-dd bc-disp nr-chip nr-live-chip" style={{ "--oc": "#d92b2b" }}><i />Live</div>
        <div className="nr-story-txt bc-ell">{LIVE_PROMO}</div>
        <div className="nr-promo-url bc-disp">we-draft.com/live</div>
      </div>
    );
  }
  const st = s.story;
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
                  <FitText as="span" className="l" text={x.line} />
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

// ── Gameday: the matchup of the moment ──
function MatchupPanel({ s }) {
  const pv = s.preview;
  if (!pv) return <LatestPanel s={{ ...s, latest: null }} />;
  const g = pv.game;
  const tv = channel(g);
  const ms = Date.parse(g.startDate || "") - s.now;
  const tags = [
    g.gameOfWeek ? "Game of the week" : g.featured ? "Featured" : null,
    g.home?.rank && g.away?.rank ? "Top 25 clash" : null,
  ].filter(Boolean);
  const team = (side) => {
    const t = g[side] || {};
    return (
      <div className="tm">
        <Logo team={t} />
        {side === "home" && <i>at</i>}
        {t.rank ? <span className="rk bc-disp">#{t.rank}</span> : null}
        <span className="nm bc-disp bc-ell">{fitName(t, 18)}</span>
        {t.record && <span className="rec">{t.record}</span>}
      </div>
    );
  };
  return (
    <div className="bc-panel bc-play nr-pre" style={{ "--ac": panelColor(g.away), "--hc": panelColor(g.home) }}>
      <div className="bc-ph"><span className="gold">Gameday preview</span><span className="right">Kickoff {kickTime(g, s.now)}{tv ? ` · ${tv}` : ""}</span></div>
      <div key={g.id} className="nr-final-body nr-pre-body">
        <div className="wash" />
        <div className="mid">
          <div className="tags">
            {tags.map((t) => <span key={t} className={t === "Top 25 clash" ? "up" : "wd"}>{t}</span>)}
            {ms > 0 && <span>{g.startTimeTBD ? "Time TBA" : `Kickoff in ${untilText(ms)}`}</span>}
          </div>
          {team("away")}
          {team("home")}
        </div>
        <CardBox g={g} pv={pv} />
      </div>
    </div>
  );
}

// The card on the right of the preview, turning over while the matchup is
// up: the prospects to watch (a top-graded We-Draft player from each
// school), then players' big games last time out, the teams taking turns.
const CARD_MS = 15 * 1000;
function CardBox({ g, pv }) {
  const cards = useMemo(() => {
    const out = [];
    const watch = ["away", "home"].map((side) => ({ side, p: pv[side].prospect })).filter((x) => x.p);
    if (watch.length) out.push({ key: "watch", watch });
    const a = pv.away.stories || [];
    const h = pv.home.stories || [];
    for (let i = 0; i < Math.max(a.length, h.length); i++) {
      if (a[i]) out.push({ key: a[i].key, story: a[i], side: "away" });
      if (h[i]) out.push({ key: h[i].key, story: h[i], side: "home" });
    }
    return out;
  }, [pv]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    const t = setInterval(() => setTick((x) => x + 1), CARD_MS);
    return () => clearInterval(t);
  }, [g.id]);
  const c = cards.length ? cards[tick % cards.length] : null;
  // The box pops in with the matchup and stays put; when its card changes
  // the old one dissolves up and away as the next settles in through it.
  const [morph, setMorph] = useState({ key: c?.key, out: null, n: 0 });
  const last = useRef(c);
  if (c && morph.key !== c.key) setMorph({ key: c.key, out: last.current, n: morph.n + 1 });
  last.current = c;
  useEffect(() => {
    if (!morph.out) return undefined;
    const t = setTimeout(() => setMorph((m) => ({ ...m, out: null })), MORPH_MS);
    return () => clearTimeout(t);
  }, [morph.n]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  return (
    <div className="star nr-watch nr-cards">
      {morph.out && morph.out.key !== c.key && <div className="nr-card out">{cardFace(morph.out, g)}</div>}
      <div key={c.key} className={`nr-card${morph.n ? " in" : ""}`}>{cardFace(c, g)}</div>
    </div>
  );
}
const MORPH_MS = 900;
// The exact width of an element's text (scrollWidth rounds, so a name a
// fraction of a pixel too wide would pass and get an ellipsis).
// Both on screen, so a transform on the way (the stage's scale, a card
// mid-animation) can't make the text look narrower than its box.
const overflows = (el) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  const box = el.getBoundingClientRect().width;
  const k = el.offsetWidth ? box / el.offsetWidth : 1;
  return r.getBoundingClientRect().width > el.clientWidth * k + 0.5;
};
// Text that's shortened only when it wouldn't fit: the first of `ways`
// ([{ text, cls }], longest first) that fits its box, measured once laid
// out, before it paints (the last one if none does).
function Fit({ ways, className, style }) {
  const ref = useRef(null);
  const sig = ways.map((w) => w.text + w.cls).join("|");
  const [step, setStep] = useState(0);
  // measured again once the broadcast fonts are in (wider than the fallback)
  const [fontsIn, setFontsIn] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => { if (alive) setFontsIn(true); });
    return () => { alive = false; };
  }, []);
  useLayoutEffect(() => setStep(0), [sig, fontsIn]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && step < ways.length - 1 && overflows(el)) setStep(step + 1);
  }, [step, sig, fontsIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = ways[Math.min(step, ways.length - 1)];
  return <div ref={ref} className={`${className}${w.cls}`} style={style}>{w.text}</div>;
}
// A storyline's headline: as written ("117 receiving yards"), else
// "yards" → "yds", else that a size smaller.
const headlineWays = (t) => {
  const s = t.replace(/\byards\b/i, "yds");
  const r = s.replace(/\breceiving\b/i, "rec").replace(/\brushing\b/i, "rush").replace(/\bpassing\b/i, "pass");
  return [{ text: t, cls: "" }, { text: s, cls: "" }, { text: r, cls: "" }, { text: r, cls: " long" }];
};
// A player's name: as is, else a size smaller, else his first initial
// ("D. Williams Jr.").
const nameWays = (n) => [{ text: n, cls: "" }, { text: n, cls: " long" }, { text: shortName(n), cls: " long" }];
function cardFace(c, g) {
  if (c.watch) {
    return (
      <>
        <div className="k">Prospects to watch</div>
        {c.watch.map(({ side, p }) => {
          const badge = GRADE_BADGE[p.grade] || GRADE_BADGE.Watchlist;
          return (
            <div key={side} className="pw">
              <Logo team={g[side]} />
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <Fit className="bc-disp bc-ell nm" ways={nameWays(p.name)} />
                <div className="meta bc-ell">{[p.pos, `Class of ${p.cls}`].filter(Boolean).join(" • ")}</div>
              </div>
              {p.grade && <span className="pill" style={{ background: badge.bg, borderColor: badge.border }}>{badge.short}</span>}
            </div>
          );
        })}
      </>
    );
  }
  // A player's big game LAST time out — the card says so up top and names
  // the game: the opponent (logo), the result and the date.
  const st = c.story;
  const L = st.last;
  const opp = L ? teamShort(L.opp) || teamName(L.opp) : null;
  return (
    <div className="nr-pstory">
      <div className="k bc-ell">{L?.date ? `Last game · ${L.date}` : "Last game"}</div>
      <div className="pw">
        <Logo team={g[c.side]} />
        <Fit className="bc-disp bc-ell nm" ways={nameWays(st.name)} style={{ minWidth: 0, flex: "1 1 auto" }} />
        {st.prospect && <img className="wdp" src={WD_ICON} alt="We-Draft prospect" title="We-Draft prospect" />}
      </div>
      <Fit className="hl bc-disp bc-ell" ways={headlineWays(st.headline)} />
      <div className="ln bc-ell"><span className="tag">Last game</span>{st.line}</div>
      {L ? (
        <div className="lg bc-ell">
          <span className={`res ${L.result[0]}`}>{L.result}</span>
          <span>{L.where}</span>
          <Logo team={L.opp} />
          <b>{opp}</b>
        </div>
      ) : <div className="meta bc-ell">{st.ctx}</div>}
    </div>
  );
}

// Under it, turning over while the matchup is up: both teams' season
// numbers with their FBS ranks (two pages), then their season leaders —
// offense, then defense — gold on the better one. A team without a roster
// on file skips the leaders (the tape gets the time).
const TAPE_PAGES = [
  { kind: "tape", title: "Tale of the tape", right: "Season averages · FBS rank", rows: [["Points / game", "ppg"], ["Points allowed", "papg", true], ["Total yards / game", "ypg"]] },
  { kind: "tape", title: "Tale of the tape", right: "Season averages · FBS rank", rows: [["Yards allowed / game", "yapg", true], ["Turnover margin / game", "toMargin"], ["3rd down %", "thirdPct"]] },
  { kind: "lead", title: "Season leaders", right: "Offense", rows: ["passing", "rushing", "receiving"] },
  { kind: "lead", title: "Season leaders", right: "Defense", rows: ["tackles", "sacks", "interceptions"] },
];
const TAPE_STEPS = TAPE_PAGES.length;
// "Mandrell Desir" → "M. Desir"
const shortName = (n) => { const p = String(n || "").split(" "); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(" ")}` : n; };
function TapePanel({ s }) {
  const pv = s.preview;
  const id = pv?.game.id;
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    const t = setInterval(() => setStep((x) => x + 1), PREVIEW_ROTATE_MS / TAPE_STEPS);
    return () => clearInterval(t);
  }, [id]);
  if (!pv) return <PerfRows s={s} />;
  const g = pv.game;
  const pages = TAPE_PAGES.filter((p) => p.kind === "tape" || pv.away.leaders || pv.home.leaders);
  const page = pages[Math.min(pages.length - 1, Math.floor((step * pages.length) / TAPE_STEPS))];
  const pageNo = pages.indexOf(page);
  const a = pv.away.stats;
  const h = pv.home.stats;
  // (the FBS rank always on the inside, toward the label)
  const cell = (t, k, better, home = false) => {
    if (t?.v?.[k] == null) return <b className="na">—</b>;
    const v = <b className={better ? "edge" : ""}>{fmtTeamStat(k, t.v[k])}</b>;
    const r = t.r?.[k] && <small>{t.r[k].replace(/^(T-)?/, "$1#")}</small>;
    return home ? <>{r}{v}</> : <>{v}{r}</>;
  };
  const lead = (x, home = false) => (!x ? <b className="na">—</b>
    : home ? <><small className="bc-ell">{x.line}</small><b className="ld bc-ell">{shortName(x.name)}</b></>
      : <><b className="ld bc-ell">{shortName(x.name)}</b><small className="bc-ell">{x.line}</small></>);
  return (
    <div className="bc-panel bc-recent nr-tape">
      <div className="bc-ph"><span>{page.title}</span><span className="right">{page.right}</span></div>
      {page.rows.map((r) => {
        if (page.kind === "lead") {
          return (
            <div key={`${g.id}-${pageNo}-${r}`} className="row">
              <div className="sd"><Logo team={g.away} />{lead(pv.away.leaders?.[r])}</div>
              <div className="lb">{LEADER_CATS[r].label}</div>
              <div className="sd hm">{lead(pv.home.leaders?.[r], true)}<Logo team={g.home} /></div>
            </div>
          );
        }
        const [label, k, low] = r;
        const av = a?.v?.[k];
        const hv = h?.v?.[k];
        const both = av != null && hv != null && av !== hv;
        const aBetter = both && (low ? av < hv : av > hv);
        return (
          <div key={`${g.id}-${pageNo}-${k}`} className="row">
            <div className="sd"><Logo team={g.away} />{cell(a, k, aBetter)}</div>
            <div className="lb">{label}</div>
            <div className="sd hm">{cell(h, k, both && !aBetter, true)}<Logo team={g.home} /></div>
          </div>
        );
      })}
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
  return b.teamLogo && g ? [g.home, g.away].find((t) => t && (t.logo === b.teamLogo || t.logoDark === b.teamLogo || t.logoBlack === b.teamLogo)) || null : null;
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
  const g = s.gameday ? s.preview?.game : s.latest ? s.gamesById.get(String(s.latest.gameId)) : null;
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
        {s.gameday ? <MatchupPanel s={s} /> : s.idle ? <PerformancePanel s={s} /> : <LatestPanel s={s} />}
        {s.gameday ? <TapePanel s={s} /> : s.idle ? <PerfRows s={s} /> : <RecentBig s={s} />}
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
