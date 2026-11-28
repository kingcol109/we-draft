// src/components/film/DisplayBoard.jsx
//
// The Viewer's DISPLAYS (user, 2026-11-27): besides Film, the middle of the
// YouTube frame (or the Big screen) can show the college football slate —
//   Live      the games on now (live scores); tap one → its live box score.
//   Upcoming  the week's games still to kick off; tap one → its preview (the
//             /live Preview's tale of the tape + each team's season leaders).
//   Past      finals, week by week; tap one → its final box score.
// Picked from the Viewer or the iPad / iPhone remote (/film/remote).
//
// Data: the same docs /live reads — liveSlate/current (one listener: every
// game on this week's slate), liveSlate/week-{season}-regular-{n} for past
// weeks, and for a zoomed game liveGames/{id} + its box/live stats doc (and
// box/players, CFBD's official box score once final). Upcoming adds
// cfbLeaders/teams (FBS team stats + ranks) and the two cfbRosters docs.
// Nothing here calls CFBD.
//
// Drawn at 1440×810 (the frame's film window); <Scaled> fits it to any box.
import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { useLiveGame, useLiveStats } from "../../hooks/useLiveGame";
import { boxPlayers, computeGameStats, statLine } from "../../utils/liveStats";
import { darkLogo, kickoffLabel, statusLabel, teamShort } from "../../utils/live";
import { fmtTeamStat, useFbsTeamStats } from "../../utils/fbsTeamStats";

export const DISPLAYS = [["film", "Film"], ["live", "Live"], ["upcoming", "Upcoming"], ["past", "Past"]];
export const BOARD_W = 1440;
export const BOARD_H = 810;

const NAVY = "#00264d";
const DEEP = "#001833";
const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const RED = "#ff4d4d";
const DISP = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';
const BODY = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
const FONTS_CSS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Bebas+Neue&display=block";
const F = (size, family, weight = 400) => ({ fontSize: size, fontFamily: family, fontWeight: weight });
const ellipsis = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
const STRIPES = "repeating-linear-gradient(-45deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 34px, transparent 34px, transparent 124px)";
const CSS = `
@keyframes dbFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dbRise { from { transform: translateY(22px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dbDrop { from { transform: translateY(-30px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dbBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
`;
const anim = (name, ms, delay = 0) => ({ animation: `${name} ${ms}ms cubic-bezier(.2,.8,.2,1) ${delay}ms both` });

function useFonts() {
  useEffect(() => {
    if (document.querySelector("link[data-wd-frame-fonts]")) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONTS_CSS;
    l.setAttribute("data-wd-frame-fonts", "");
    document.head.appendChild(l);
  }, []);
}

// ── Data ──

/** liveSlate/current, live. undefined while loading, null when missing. */
export function useSlate(on = true) {
  const [slate, setSlate] = useState(undefined);
  useEffect(() => {
    if (!on) return undefined;
    return onSnapshot(doc(db, "liveSlate", "current"), (s) => setSlate(s.exists() ? s.data() : null), () => setSlate(null));
  }, [on]);
  return slate;
}

const weekCache = new Map();
/** A past week's games (liveSlate/week-{season}-regular-{week}) — null while loading. */
export function useWeekGames(slate, week) {
  const current = slate && week === slate.week;
  const key = slate && week && !current ? `${slate.season}-${week}` : null;
  const [games, setGames] = useState(null);
  useEffect(() => {
    if (!key) { setGames(null); return undefined; }
    if (weekCache.has(key)) { setGames(weekCache.get(key)); return undefined; }
    let alive = true;
    setGames(null);
    getDoc(doc(db, "liveSlate", `week-${slate.season}-regular-${week}`))
      .then((d) => { const list = d.exists() ? d.data().games || [] : []; weekCache.set(key, list); if (alive) setGames(list); })
      .catch(() => { if (alive) setGames([]); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return current ? slate.games || [] : games;
}

/** Past's week: the one asked for, else this week once it has a final (else last week). */
export function pastWeekOf(slate, asked) {
  if (!slate?.week) return null;
  const top = slate.week;
  if (asked) return Math.max(1, Math.min(top, Number(asked) || top));
  return (slate.games || []).some((g) => g.status === "final") ? top : Math.max(1, top - 1);
}

const ms = (g) => Date.parse(g?.startDate) || 0;
const ranked = (g) => Math.min(g.home?.rank || 99, g.away?.rank || 99);
/** A display's games, in board order. */
export function boardList(display, slateGames, pastGames) {
  const all = slateGames || [];
  if (display === "live") return all.filter((g) => g.status === "in_progress").sort((a, b) => ranked(a) - ranked(b) || ms(a) - ms(b));
  if (display === "upcoming") return all.filter((g) => g.status === "scheduled").sort((a, b) => ms(a) - ms(b) || ranked(a) - ranked(b));
  if (display === "past") return (pastGames || []).filter((g) => g.status === "final").sort((a, b) => ms(b) - ms(a) || ranked(a) - ranked(b));
  return [];
}

export const DISPLAY_TITLES = { live: "Live scores", upcoming: "Upcoming games", past: "Final scores" };
/** The frame's header for a display: { name, sub }. */
export function boardHead(display, g, week) {
  if (g) {
    const a = g.away || {};
    const h = g.home || {};
    const rk = (t) => (t.rank ? `#${t.rank} ` : "");
    const nm = (t) => t.school || teamShort(t);
    return {
      name: `${rk(a)}${nm(a)} ${g.neutralSite ? "vs" : "at"} ${rk(h)}${nm(h)}`,
      sub: g.status === "scheduled" ? ["Preview", kickoffLabel(g.startDate, g.startTimeTBD), g.tv].filter(Boolean).join("  ·  ")
        : g.status === "final" ? ["Final", week && `Week ${week}`].filter(Boolean).join("  ·  ") : `Live  ·  ${statusLabel(g)}`,
    };
  }
  return { name: DISPLAY_TITLES[display] || "We-Draft.com", sub: [week && `Week ${week}`, "College football"].filter(Boolean).join("  ·  ") };
}

// ── Pieces ──

/** Fits a 1440×810 board into its box. */
export function Scaled({ children, w = BOARD_W, h = BOARD_H }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => { const r = el.getBoundingClientRect(); setScale(Math.min(r.width / w, r.height / h) || 0.5); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: w, height: h, transform: `translate(-50%, -50%) scale(${scale})` }}>{children}</div>
    </div>
  );
}

const Logo = ({ t, size }) => {
  const src = darkLogo(t);
  return src
    ? <img src={src} alt="" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
    : <span style={{ width: size, height: size, borderRadius: "50%", background: "rgba(255,255,255,0.12)", display: "grid", placeItems: "center", flexShrink: 0, ...F(size * 0.4, DISP), color: "#fff" }}>{teamShort(t).slice(0, 3)}</span>;
};

// One game on the grid: away over home, scores right, the status under.
function Tile({ g, h, delay, onOpen }) {
  const live = g.status === "in_progress";
  const final = g.status === "final";
  const sched = g.status === "scheduled";
  const hp = Number(g.home?.points);
  const ap = Number(g.away?.points);
  const won = (side) => final && (side === "home" ? hp > ap : ap > hp);
  const lost = (side) => final && (side === "home" ? hp < ap : ap < hp);
  const row = Math.round(h * 0.33);
  const line = (side) => {
    const t = g[side] || {};
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 14, height: row, opacity: lost(side) ? 0.55 : 1 }}>
        <Logo t={t} size={Math.round(row * 0.8)} />
        {t.rank ? <span style={{ ...F(row * 0.42, DISP), color: GOLD, flexShrink: 0, paddingTop: 2 }}>{t.rank}</span> : null}
        <span style={{ ...F(row * 0.66, DISP), lineHeight: 1, color: "#fff", paddingTop: 3, ...ellipsis }}>{teamShort(t)}</span>
        {live && g.possession === side && <span style={{ width: 12, height: 12, borderRadius: 6, background: GOLD, flexShrink: 0 }} />}
        <span style={{ flex: 1 }} />
        {sched
          ? <span style={{ ...F(row * 0.42, BODY, 700), color: "rgba(255,255,255,0.6)", flexShrink: 0 }}>{t.record || ""}</span>
          : <span style={{ ...F(row * 0.9, DISP), lineHeight: 1, paddingTop: 4, color: won(side) ? GOLD : "#fff", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{t.points ?? 0}</span>}
      </div>
    );
  };
  const foot = sched ? [kickoffLabel(g.startDate, g.startTimeTBD), g.tv].filter(Boolean).join("  ·  ")
    : live ? [statusLabel(g), g.situation].filter(Boolean).join("  ·  ") : statusLabel(g);
  return (
    <button type="button" onClick={onOpen ? () => onOpen(g.id) : undefined}
      style={{ all: "unset", cursor: onOpen ? "pointer" : "default", boxSizing: "border-box", height: h, borderRadius: 18, padding: "10px 20px 8px", minWidth: 0,
        background: "rgba(255,255,255,0.07)", boxShadow: `inset 0 0 0 2px ${live ? "rgba(255,77,77,0.55)" : "rgba(255,255,255,0.08)"}`,
        display: "grid", alignContent: "center", ...anim("dbRise", 420, delay) }}>
      {line("away")}
      {line("home")}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, ...F(Math.round(h * 0.13), BODY, 800), letterSpacing: 1, color: live ? "#ffb3b3" : "rgba(255,255,255,0.65)", textTransform: "uppercase", ...ellipsis }}>
        {live && <span style={{ width: 10, height: 10, borderRadius: 5, background: RED, flexShrink: 0, animation: "dbBlink 1.4s ease-in-out infinite" }} />}
        <span style={ellipsis}>{foot}</span>
      </div>
    </button>
  );
}

const ROTATE_MS = 12000;
// The grid: bigger tiles when there are only a few; 12 to a page past that,
// the pages turning by themselves.
function Grid({ games, empty, onOpen }) {
  const n = games.length;
  const [cols, rows] = n <= 4 ? [2, 2] : n <= 6 ? [2, 3] : n <= 9 ? [3, 3] : [3, 4];
  const per = cols * rows;
  const pages = Math.max(1, Math.ceil(n / per));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages < 2) { setPage(0); return undefined; }
    const t = setInterval(() => setPage((p) => (p + 1) % pages), ROTATE_MS);
    return () => clearInterval(t);
  }, [pages]);
  const at = page % pages;
  if (!n) return <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", ...F(52, DISP), color: "rgba(255,255,255,0.7)", letterSpacing: 1, ...anim("dbFade", 400) }}>{empty}</div>;
  const pad = 30;
  const gap = 18;
  const dots = pages > 1 ? 34 : 0;
  const h = Math.min(rows === 2 ? 250 : 999, Math.floor((BOARD_H - pad * 2 - dots - gap * (rows - 1)) / rows));
  return (
    <>
      <div key={`p${at}:${cols}`} style={{ position: "absolute", left: pad, right: pad, top: pad, bottom: pad + dots, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: h, gap, alignContent: "center" }}>
        {games.slice(at * per, at * per + per).map((g, i) => <Tile key={g.id} g={g} h={h} delay={i * 40} onOpen={onOpen} />)}
      </div>
      {pages > 1 && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: pad - 4, display: "flex", justifyContent: "center", gap: 10 }}>
          {Array.from({ length: pages }, (_, i) => <span key={i} style={{ width: i === at ? 34 : 12, height: 12, borderRadius: 6, background: i === at ? GOLD : "rgba(255,255,255,0.3)", transition: "width 300ms" }} />)}
        </div>
      )}
    </>
  );
}

// The zoomed game's scoreboard: each team on its color, the status between.
function Scoreboard({ g, center, showScores }) {
  const hp = Number(g.home?.points);
  const ap = Number(g.away?.points);
  const side = (s) => {
    const t = g[s] || {};
    const won = g.status === "final" && (s === "home" ? hp > ap : ap > hp);
    const lost = g.status === "final" && (s === "home" ? hp < ap : ap < hp);
    const score = <span style={{ ...F(150, DISP), lineHeight: 1, paddingTop: 10, color: won ? GOLD : "#fff", opacity: lost ? 0.6 : 1, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{t.points ?? 0}</span>;
    const name = (
      <div style={{ display: "grid", gap: 2, minWidth: 0, textAlign: s === "home" ? "right" : "left" }}>
        <span style={{ ...F(70, DISP), lineHeight: 1, paddingTop: 6, color: "#fff", ...ellipsis }}>{t.rank ? <span style={{ color: GOLD }}>{t.rank} </span> : null}{teamShort(t)}</span>
        <span style={{ ...F(26, BODY, 700), color: "rgba(255,255,255,0.8)", letterSpacing: 1, textTransform: "uppercase", ...ellipsis }}>{[t.mascot, t.record].filter(Boolean).join("  ·  ")}</span>
      </div>
    );
    return (
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 22, padding: "0 30px", flexDirection: s === "home" ? "row-reverse" : "row",
        background: `linear-gradient(${s === "home" ? 270 : 90}deg, ${t.color || BLUE} 0%, ${t.color || BLUE}cc 60%, transparent 100%)` }}>
        <Logo t={t} size={116} />
        {name}
        <span style={{ flex: 1 }} />
        {showScores && score}
      </div>
    );
  };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: BOARD_W, height: 190, display: "flex", alignItems: "stretch", background: "rgba(0,10,30,0.55)", ...anim("dbDrop", 460) }}>
      {side("away")}
      <div style={{ width: 250, flexShrink: 0, display: "grid", alignContent: "center", justifyItems: "center", gap: 6, textAlign: "center", padding: "0 10px" }}>{center}</div>
      {side("home")}
    </div>
  );
}

// A three-column panel row: away | label | home (gold on the better side).
function Row({ label, a, h, ea, eh, tall }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 170px minmax(0, 1fr)", alignItems: "center", gap: 12, minHeight: tall ? 100 : 56, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ minWidth: 0, color: ea ? GOLD : "#fff" }}>{a}</div>
      <div style={{ ...F(20, BODY, 800), color: "rgba(255,255,255,0.6)", letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center", lineHeight: 1.1 }}>{label}</div>
      <div style={{ minWidth: 0, textAlign: "right", color: eh ? GOLD : "#fff" }}>{h}</div>
    </div>
  );
}
const val = (v) => <span style={{ ...F(40, DISP), lineHeight: 1, paddingTop: 4, display: "inline-block", fontVariantNumeric: "tabular-nums" }}>{v}</span>;
function Panel({ title, children, x, delay }) {
  return (
    <div style={{ position: "absolute", left: x, top: 214, width: 680, height: 572, boxSizing: "border-box", borderRadius: 22, background: "rgba(255,255,255,0.07)", padding: "14px 24px", overflow: "hidden", ...anim("dbRise", 460, delay) }}>
      <div style={{ ...F(34, DISP), color: GOLD, letterSpacing: 1.5, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}
const Note = ({ children }) => <div style={{ ...F(26, BODY, 700), color: "rgba(255,255,255,0.6)", padding: "16px 0" }}>{children}</div>;

// A player cell: name over his line.
const Lead = ({ x, right }) => (!x ? <span style={{ ...F(30, DISP), color: "rgba(255,255,255,0.4)" }}>—</span> : (
  <div style={{ display: "grid", gap: 2, minWidth: 0, justifyItems: right ? "end" : "start" }}>
    <span style={{ ...F(36, DISP), lineHeight: 1, paddingTop: 4, color: "#fff", maxWidth: "100%", ...ellipsis }}>{x.name}</span>
    <span style={{ ...F(21, BODY, 700), color: "rgba(255,255,255,0.75)", maxWidth: "100%", ...ellipsis }}>{x.line}</span>
  </div>
));

// ── A live / final game: the live (or official) box ──

// The team totals and player lines, as /live's Stats tab works them out
// (components/LiveGameStats.js): the ingester's stats doc, else computed from
// the plays; once final with CFBD's box in, its player lines and pass / rush totals.
function useGameStats(id, status) {
  const { stats, ready } = useLiveStats(id);
  const { game: live, plays, box } = useLiveGame(id, { plays: ready && !stats ? "all" : "none", box: status === "final" });
  const computed = useMemo(() => stats || computeGameStats(plays), [stats, plays]);
  const official = status === "final" && !!box?.teams?.length;
  const players = official ? boxPlayers(box) : computed.players;
  const teams = useMemo(() => {
    if (!official) return computed.teams;
    const out = {};
    for (const side of ["home", "away"]) {
      const sum = (cat, f) => players[side].reduce((a, l) => a + (l.stats[cat]?.[f] || 0), 0);
      const T = { ...computed.teams[side] };
      Object.assign(T, { passYds: sum("passing", "yds"), passCmp: sum("passing", "cmp"), passAtt: sum("passing", "att"), rushYds: sum("rushing", "yds"), rushAtt: sum("rushing", "car") });
      T.totalYds = T.passYds + T.rushYds;
      T.ypp = T.plays ? T.totalYds / T.plays : 0;
      out[side] = T;
    }
    return out;
  }, [official, computed, players]);
  return { ready, has: !!stats || plays.length > 0, teams, players, live, official };
}

const LEADS = [
  ["passing", "Passing", (s) => (s.att ? s.yds || 0 : 0)],
  ["rushing", "Rushing", (s) => (s.car ? s.yds || 0 : 0)],
  ["receiving", "Receiving", (s) => (s.rec ? s.yds || 0 : 0)],
  ["defense", "Defense", (s) => (s.tot || 0) + (s.tfl || 0) + (s.sacks || 0) * 2 + (s.int || 0) * 3 + (s.ff || 0) * 2 + (s.fr || 0) * 2],
];
const defLine = (s) => [s.tot && `${s.tot} TKL`, s.tfl && `${s.tfl} TFL`, statLine("defense", s)].filter(Boolean).join(" · ");
function topOf(lines, cat, get) {
  let best = null;
  for (const l of lines || []) {
    const s = l.stats?.[cat];
    const v = s ? get(s) : 0;
    if (v > 0 && (!best || v > best.v)) best = { v, name: l.name, line: cat === "defense" ? defLine(s) : statLine(cat, s) };
  }
  return best;
}

function GameBoard({ g: slateGame }) {
  const id = slateGame.id;
  const { ready, has, teams, players, live, official } = useGameStats(id, slateGame.status);
  // The game doc (live score, clock) over the slate's copy.
  const g = live ? { ...slateGame, ...live, home: { ...slateGame.home, ...live.home }, away: { ...slateGame.away, ...live.away } } : slateGame;
  const isLive = g.status === "in_progress";
  const A = teams?.away;
  const H = teams?.home;
  const edge = (a, b, low = false) => (a == null || b == null || a === b ? [false, false] : low ? [a < b, b < a] : [a > b, b > a]);
  const pct = (x) => (x?.[1] ? `${x[0]}/${x[1]}` : "0/0");
  const rows = A && H ? [
    ["Total yards", A.totalYds, H.totalYds, edge(A.totalYds, H.totalYds)],
    ["Passing", `${A.passYds} (${A.passCmp}/${A.passAtt})`, `${H.passYds} (${H.passCmp}/${H.passAtt})`, edge(A.passYds, H.passYds)],
    ["Rushing", `${A.rushYds} (${A.rushAtt})`, `${H.rushYds} (${H.rushAtt})`, edge(A.rushYds, H.rushYds)],
    ["Yards / play", (A.ypp || 0).toFixed(1), (H.ypp || 0).toFixed(1), edge(A.ypp, H.ypp)],
    ["First downs", A.firstDowns, H.firstDowns, edge(A.firstDowns, H.firstDowns)],
    ["3rd down", pct(A.third), pct(H.third), edge(A.third?.[1] ? A.third[0] / A.third[1] : 0, H.third?.[1] ? H.third[0] / H.third[1] : 0)],
    ["Turnovers", A.turnovers, H.turnovers, edge(A.turnovers, H.turnovers, true)],
    ["Penalties", `${A.penalties}–${A.penaltyYds}`, `${H.penalties}–${H.penaltyYds}`, edge(A.penaltyYds, H.penaltyYds, true)],
  ] : [];
  const center = (
    <>
      {isLive && <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 14px 1px", borderRadius: 8, background: RED, ...F(28, DISP), color: "#fff", letterSpacing: 2 }}><span style={{ width: 10, height: 10, borderRadius: 5, background: "#fff", animation: "dbBlink 1.4s ease-in-out infinite" }} />LIVE</span>}
      <span style={{ ...F(isLive ? 46 : 56, DISP), color: "#fff", lineHeight: 1, paddingTop: 4 }}>{statusLabel(g).split(" · ")[0]}</span>
      {isLive && g.situation && <span style={{ ...F(24, BODY, 800), color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{g.situation}</span>}
      {!isLive && g.tv && <span style={{ ...F(22, BODY, 700), color: "rgba(255,255,255,0.6)" }}>{g.tv}</span>}
    </>
  );
  return (
    <>
      <Scoreboard g={g} center={center} showScores />
      <Panel title="Team stats" x={30} delay={120}>
        {!ready ? <Note>Loading…</Note> : !has ? <Note>Stats show once the game is underway.</Note>
          : rows.map(([k, a, h, [ea, eh]]) => <Row key={k} label={k} a={val(a)} h={val(h)} ea={ea} eh={eh} />)}
      </Panel>
      <Panel title={official ? "Leaders · official box" : "Leaders"} x={730} delay={200}>
        {!ready ? <Note>Loading…</Note> : !has ? <Note>Leaders show once the game is underway.</Note>
          : LEADS.map(([cat, label, get]) => <Row key={cat} tall label={label} a={<Lead x={topOf(players?.away, cat, get)} />} h={<Lead right x={topOf(players?.home, cat, get)} />} />)}
      </Panel>
    </>
  );
}

// ── An upcoming game: the /live Preview ──

const rosterCache = new Map();
const loadRoster = (id) => {
  if (id == null) return Promise.resolve(null);
  if (!rosterCache.has(id)) rosterCache.set(id, getDoc(doc(db, "cfbRosters", String(id))).then((d) => (d.exists() ? d.data() : null)).catch(() => null));
  return rosterCache.get(id);
};
const sN = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const SEASON_LEADS = [
  ["Passing", (st) => sN(st.passing?.YDS), (st) => `${sN(st.passing?.YDS).toLocaleString()} YDS · ${sN(st.passing?.TD)} TD · ${sN(st.passing?.INT)} INT`],
  ["Rushing", (st) => sN(st.rushing?.YDS), (st) => `${sN(st.rushing?.YDS).toLocaleString()} YDS · ${sN(st.rushing?.CAR)} CAR · ${sN(st.rushing?.TD)} TD`],
  ["Receiving", (st) => sN(st.receiving?.YDS), (st) => `${sN(st.receiving?.YDS).toLocaleString()} YDS · ${sN(st.receiving?.REC)} REC · ${sN(st.receiving?.TD)} TD`],
  ["Tackles", (st) => sN(st.defensive?.TOT), (st) => `${sN(st.defensive?.TOT)} TKL · ${sN(st.defensive?.TFL)} TFL`],
  ["Sacks", (st) => sN(st.defensive?.SACKS), (st) => `${sN(st.defensive?.SACKS)} SACKS`],
];
function seasonTop(roster, get, line) {
  let best = null;
  for (const p of roster?.players || []) {
    const v = get(p.s || {});
    if (v > 0 && (!best || v > best.v)) best = { v, name: `${p.first || ""} ${p.last || ""}`.trim(), line: `${p.pos ? `${p.pos} · ` : ""}${line(p.s || {})}` };
  }
  return best;
}
const TAPE = [
  ["Points / game", "ppg"], ["Points allowed", "papg", true], ["Yards / game", "ypg"], ["Yards allowed", "yapg", true],
  ["Pass yds / game", "passYpg"], ["Rush yds / game", "rushYpg"], ["Turnover margin", "toMargin"], ["3rd down %", "thirdPct"],
];

function PreviewBoard({ g }) {
  const teamStats = useFbsTeamStats();
  const [rosters, setRosters] = useState(null);
  useEffect(() => {
    let alive = true;
    setRosters(null);
    Promise.all([loadRoster(g.away?.providerTeamId), loadRoster(g.home?.providerTeamId)]).then(([away, home]) => { if (alive) setRosters({ away, home }); });
    return () => { alive = false; };
  }, [g.away?.providerTeamId, g.home?.providerTeamId]);
  const ts = { away: teamStats?.get(Number(g.away?.providerTeamId)), home: teamStats?.get(Number(g.home?.providerTeamId)) };
  const cell = (t, k) => (t?.v?.[k] == null ? val("—") : (
    <span style={{ display: "inline-grid", gap: 0 }}>
      {val(fmtTeamStat(k, t.v[k]))}
      {t.r?.[k] && <span style={{ ...F(18, BODY, 700), color: "rgba(255,255,255,0.55)" }}>{t.r[k].replace(/^(T-)?/, "$1#")} FBS</span>}
    </span>
  ));
  const center = (
    <>
      <span style={{ ...F(30, DISP), color: GOLD, letterSpacing: 2 }}>Preview</span>
      <span style={{ ...F(44, DISP), color: "#fff", lineHeight: 1, paddingTop: 4 }}>{kickoffLabel(g.startDate, g.startTimeTBD)}</span>
      {g.tv && <span style={{ ...F(24, BODY, 800), color: "rgba(255,255,255,0.8)" }}>{g.tv}</span>}
      {g.venue && <span style={{ ...F(19, BODY, 600), color: "rgba(255,255,255,0.55)", maxWidth: 230, ...ellipsis }}>{g.venue}</span>}
    </>
  );
  return (
    <>
      <Scoreboard g={g} center={center} showScores={false} />
      <Panel title="Tale of the tape" x={30} delay={120}>
        {!teamStats ? <Note>Loading…</Note> : TAPE.map(([label, k, low]) => {
          const a = ts.away?.v?.[k];
          const h = ts.home?.v?.[k];
          const better = a == null || h == null || a === h ? [false, false] : low ? [a < h, h < a] : [a > h, h > a];
          return <Row key={k} label={label} a={cell(ts.away, k)} h={cell(ts.home, k)} ea={better[0]} eh={better[1]} />;
        })}
      </Panel>
      <Panel title="Season leaders" x={730} delay={200}>
        {!rosters ? <Note>Loading…</Note> : SEASON_LEADS.map(([label, get, line]) => (
          <Row key={label} tall label={label} a={<Lead x={seasonTop(rosters.away, get, line)} />} h={<Lead right x={seasonTop(rosters.home, get, line)} />} />
        ))}
      </Panel>
    </>
  );
}

// ── The board ──

/** display: live | upcoming | past · games: that display's list · zoom: the
 *  game to blow up (from anywhere on the slate) · onOpen(id): a tile tapped. */
export default function DisplayBoard({ display, games, zoom, loading, week, onOpen }) {
  useFonts();
  const empty = loading ? "Loading the slate…"
    : display === "live" ? "No games live right now"
      : display === "upcoming" ? "No games left to kick off this week" : `No finals${week ? ` in Week ${week}` : ""}`;
  return (
    <div style={{ position: "relative", width: BOARD_W, height: BOARD_H, overflow: "hidden", fontFamily: BODY, color: "#fff",
      backgroundColor: DEEP, backgroundImage: `linear-gradient(115deg, ${NAVY} 0%, ${DEEP} 100%)` }}>
      <style>{CSS}</style>
      <div style={{ position: "absolute", inset: 0, backgroundImage: STRIPES }} />
      <div key={zoom ? `z:${zoom.id}` : `g:${display}:${week || ""}`} style={{ position: "absolute", inset: 0, ...anim("dbFade", 300) }}>
        {zoom ? (zoom.status === "scheduled" ? <PreviewBoard g={zoom} /> : <GameBoard g={zoom} />)
          : <Grid games={games || []} empty={empty} onOpen={onOpen} />}
      </div>
    </div>
  );
}
