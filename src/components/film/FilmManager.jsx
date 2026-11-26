// src/components/film/FilmManager.jsx
//
// Admin → Film Manager (user, 2026-11-25): the admin's game film, on their
// own disk, cut into plays and tagged to players. Three tabs:
//
//   Cut plays  pick a game, choose the players to focus on, then watch:
//              I marks a play's start, O its end — the play is cut and
//              "hot": 1–9 toggle the focus players on it, or tag anyone on
//              the two CFBD rosters.
//   Players    any player on demand: every play he's tagged on, filtered by
//              label / circle / game. Circle him (click), label the play
//              (Great · Good · Okay · Neutral · Bad · Very bad — labels only,
//              to find plays later), add a note, or WASH it: zoom in on him
//              with keyframes. The original stays; the washed version is
//              what the Breakdown Studio will use. Untagged plays can wait.
//   Import     a legacy Premiere project (one per player): each cut becomes
//              a play tagged to him; a circle / circle2 / arrow over a cut
//              becomes its spot (utils/film/legacy.js).
//
// Video never leaves the computer: the library folder is remembered in this
// browser (utils/film/library.js); only metadata is saved (utils/film/data.js,
// admin-only). The Breakdown Studio will pull a player's plays from here.
// Dark themed (user, 2026-11-25).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FilmPlayer, { MARK_SIZES } from "./FilmPlayer";
import Timeline from "./Timeline";
import ScrubRow, { useFastMotion } from "./Scrub";
import { answerAsk, loadAliases, parseVoice, teach } from "../../utils/film/voice";
import useSpeech from "./useSpeech";
import { gameFile, gameIdOf, pathUnder, pickFilmFile, saveFileHandle, parseGameName, pickRoot, rootAccess, savedRoot, scanGames, seasonOf } from "../../utils/film/library";
import { addGames, cutPlay, deletePlay, editTag, updatePlay, filmPeople, importPlay, LABEL_COLORS, LABELS, listGames, person, traitsFor, playsForGame, playsForGames, playsForPlayer, roster, saveGame, tagPlayer, untagPlayer } from "../../utils/film/data";
import { legacyCuts, sameCut } from "../../utils/film/legacy";
import { parsePrproj, prprojText } from "../../utils/studio/prproj";
import { getSiteSnapshot } from "../../utils/siteSnapshots";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { cfbdTeam, gameMatches, filmName, filmWeeks, FILM_SEASONS, matchFields, matchGame, matchup, scoreLine, teamKey, weekLabel } from "../../utils/film/schedule";

const UI_BLUE = "#0055a5";
const UI_GOLD = "#f6a21d";
const clock = (s) => { const t = Math.max(0, s || 0); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const x = (t % 60).toFixed(1).padStart(4, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
const btn = (primary) => ({ border: `1px solid ${primary ? UI_BLUE : "#334058"}`, background: primary ? UI_BLUE : "#1b2538", color: primary ? "#fff" : "#e8edf5", borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: 13, cursor: "pointer" });
const mini = { ...btn(false), padding: "2px 8px", fontSize: 11 };
const field = { minWidth: 0, border: "1px solid #334058", borderRadius: 8, padding: "6px 9px", fontSize: 13, boxSizing: "border-box", background: "#0f1726", color: "#e8edf5", colorScheme: "dark" };
const head = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.5, color: "#9fb0c8" };
const box = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", minWidth: 0, gap: 8, padding: 12, border: "1px solid #263247", borderRadius: 10, background: "#141c2b" };
const chip = (on, color = UI_BLUE) => ({ border: `1px solid ${on ? color : "#334058"}`, background: on ? color : "#1b2538", color: on ? "#fff" : "#e8edf5", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer" });
const ellipsis = (x = {}) => ({ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, ...x });
// Full screen (user, 2026-11-25: "should feel like full screen, not a zoom on
// the film"): the tab fills the screen with no page around it — the list on
// the left, the film as big as it fits in black, the scrub + controls docked
// under it, the editing panels down the right. Same elements, laid out by
// these classes only (so the film never reloads going in or out).
const FS_CSS = `
.wd-film-stage:fullscreen { padding: 0 !important; width: 100vw; height: 100vh; overflow: hidden; background: #000 !important; display: flex !important; flex-direction: column; gap: 0 !important; }
.wd-film-stage:fullscreen.wd-fs-grid, .wd-film-stage:fullscreen .wd-fs-grid { flex: 1; min-height: 0; height: 100%; display: grid !important; grid-template-columns: 300px minmax(0, 1fr) !important; gap: 0 !important; align-items: stretch !important; }
.wd-film-stage:fullscreen .wd-fs-list { height: 100%; max-height: 100vh; overflow-y: auto; border-radius: 0 !important; border-width: 0 1px 0 0 !important; box-sizing: border-box; }
.wd-film-stage:fullscreen .wd-fs-list .wd-fs-scroll { max-height: none !important; }
.wd-film-stage:fullscreen .wd-fs-main { display: grid !important; grid-template-columns: minmax(0, 1fr) 340px !important; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; min-height: 0; gap: 0 !important; position: static !important; }
.wd-film-stage:fullscreen .wd-fs-video { grid-column: 1; grid-row: 1 / 3; min-height: 0; }
.wd-film-stage:fullscreen .wd-fs-dock { grid-column: 1; grid-row: 3; display: grid; gap: 6px; padding: 8px 12px; background: #0b1220; border-top: 1px solid #263247; }
.wd-film-stage:fullscreen .wd-fs-top { grid-column: 2; grid-row: 1; max-height: 38vh; overflow-y: auto; border-radius: 0 !important; border-width: 0 0 1px 1px !important; }
.wd-film-stage:fullscreen .wd-fs-side { grid-column: 2; grid-row: 2 / 4; min-height: 0; overflow-y: auto; display: grid; align-content: start; gap: 10px; padding: 10px; background: #0b1220; border-left: 1px solid #263247; }
.wd-film-stage:fullscreen .wd-fs-side.wd-fs-tall { grid-row: 1 / 4; }
.wd-film-stage:fullscreen .wd-fs-hide { display: none !important; }
.wd-film-stage:fullscreen .wd-fs-only-film { display: none !important; }
.wd-film-stage:fullscreen.wd-fs-cut { display: grid !important; grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: minmax(0, 1fr) !important; }
.wd-film-stage:fullscreen.wd-fs-cut .wd-fs-list { display: none !important; }
.wd-film-stage:fullscreen.wd-fs-cut .wd-fs-main { grid-template-columns: minmax(0, 1fr) !important; grid-template-rows: minmax(0, 1fr) auto !important; }
.wd-film-stage:fullscreen.wd-fs-cut .wd-fs-video { grid-row: 1 !important; }
.wd-film-stage:fullscreen.wd-fs-cut .wd-fs-dock { grid-row: 2 !important; }
`;
// A tab's full-screen stage: dark, scrolls on its own, the film sticks.
const stageStyle = { background: "#0b1220", color: "#e8edf5", colorScheme: "dark", boxSizing: "border-box" };
// The snip key's name, for the buttons.
const snipName = (k) => (k === "c" ? "C / Ctrl+K" : k === "mouse4" ? "mouse back button" : k === "mouse5" ? "mouse forward button" : k.startsWith("btn:") ? `mouse button ${Number(k.slice(4)) + 1}` : k.startsWith("code:") ? k.slice(5).replace(/^Key/, "").replace(/^Numpad/, "Numpad ") : k);
const isTyping = (e) => ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
// A film file's standard name (its season, week, date, matchup and side — utils/film/schedule.js).
const gameTitle = (g) => filmName(g);
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }) : "");
// A film file's season: its doc's, else its folder's, else a year in its name.
const seasonFor = (g) => g.season || seasonOf(g.folder) || (String(g.file).match(/\b(20\d\d)\b/) || [])[1] || "";

// ── The games, week by week (user, 2026-11-25): every game of the teams with
// film that season, each with its two sides — the offense film of each team —
// connected or missing; and an inbox for film that isn't on a game yet. ──
function GameList({ games, schedules, gameId, onPick, onConnect, onLink }) {
  const [linking, setLinking] = useState(null); // "gameId:team" — the side being given film
  const [season, setSeason] = useState(FILM_SEASONS.find((s) => games.some((g) => g.season === s)) || FILM_SEASONS[0]);
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const [inbox, setInbox] = useState(false);
  const sched = useMemo(() => schedules[season] || [], [schedules, season]);
  const films = useMemo(() => games.filter((g) => g.season === season), [games, season]);
  const teams = useMemo(() => new Set(films.map((f) => f.offense).filter(Boolean)), [films]);
  const weeks = useMemo(() => filmWeeks(sched, films, q.trim() ? null : teams).map((w) => ({
    ...w, rows: w.rows.filter((r) => (all || q.trim() || r.away || r.home) && gameMatches(q, r.game)),
  })).filter((w) => w.rows.length), [sched, films, teams, all, q]);
  // The same search in the other seasons — a jump when the game is there.
  const elsewhere = useMemo(() => (!q.trim() ? [] : FILM_SEASONS.filter((s2) => s2 !== season).map((s2) => {
    const fs = games.filter((g) => g.season === s2);
    const n = filmWeeks(schedules[s2] || [], fs, null).reduce((k, w) => k + w.rows.filter((r) => gameMatches(q, r.game)).length, 0);
    return [s2, n];
  }).filter(([, n]) => n)), [q, season, games, schedules]);
  const loose = games.filter((g) => !g.cfbdGameId);
  const both = weeks.reduce((n, w) => n + w.rows.filter((r) => r.away && r.home).length, 0);
  // A side with film opens it; a side without: add its film — film already
  // in the library that isn't on a game (that team's offense), or a file on
  // this computer (user, 2026-11-25).
  const candidatesFor = (team) => loose.filter((g) => teamKey(g.offense) === teamKey(team) && (!g.season || g.season === season));
  const side = (g2, team, film) => film ? (
    <button type="button" onClick={() => onPick(film.id)} title={film.file}
      style={{ ...chip(film.id === gameId), padding: "2px 8px", fontSize: 11, borderColor: film.id === gameId ? UI_BLUE : "#3d6fa8" }}>
      {cfbdTeam(team)} O ✓{film.plays ? ` · ${film.plays}` : ""}
    </button>
  ) : (
    <button type="button" title={`Add ${cfbdTeam(team)}'s offense film`}
      onClick={() => { if (candidatesFor(team).length) setLinking((x) => (x === `${g2.id}:${team}` ? null : `${g2.id}:${team}`)); else onLink(g2, team, season); }}
      style={{ ...chip(false), padding: "2px 8px", fontSize: 11, borderStyle: "dashed", color: "#9fb0c8", background: "transparent" }}>
      + {cfbdTeam(team)} O film
    </button>
  );
  const linkBox = (g2) => {
    if (!linking || !linking.startsWith(`${g2.id}:`)) return null;
    const team = linking.slice(String(g2.id).length + 1);
    return (
      <div style={{ display: "grid", gap: 4, padding: 6, borderRadius: 6, border: "1px dashed #3d6fa8", background: "#0f1726" }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: "#9fb0c8" }}>{cfbdTeam(team)} offense film:</div>
        {candidatesFor(team).map((f) => (
          <button key={f.id} type="button" style={{ ...mini, textAlign: "left", ...ellipsis() }} title={f.file} onClick={() => { setLinking(null); onConnect(f, g2); onPick(f.id); }}>Use {f.file}</button>
        ))}
        <button type="button" style={{ ...btn(true), fontSize: 12, padding: "4px 10px", justifySelf: "start" }} onClick={() => { setLinking(null); onLink(g2, team, season); }}>Choose a file on this computer…</button>
      </div>
    );
  };
  return (
    <div className="wd-fs-list" style={box}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {FILM_SEASONS.map((s2) => <button key={s2} type="button" style={chip(season === s2)} onClick={() => setSeason(s2)}>{s2} · {games.filter((g) => g.season === s2).length}</button>)}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a game — “oklahoma texas”" style={{ ...field, flex: 1 }} />
        <select value={all ? "all" : "film"} onChange={(e) => setAll(e.target.value === "all")} style={{ ...field, padding: "4px 6px", fontSize: 11 }}>
          <option value="film">Games with film</option>
          <option value="all">Every game, every week</option>
        </select>
      </div>
      {elsewhere.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 11, fontWeight: 800, color: "#9fb0c8" }}>
          Also in {elsewhere.map(([s2, n]) => <button key={s2} type="button" style={{ ...chip(false), padding: "2px 8px", fontSize: 11 }} onClick={() => setSeason(s2)}>{s2} · {n} →</button>)}
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>{films.length} film files · {both} games with both sides · {teams.size} teams</div>
      {loose.length > 0 && (
        <div style={{ border: "1px solid #6b5520", borderRadius: 8, padding: 8, background: "#2a2312" }}>
          <button type="button" onClick={() => setInbox((x) => !x)} style={{ border: "none", background: "none", color: "#f6c66b", fontWeight: 900, fontSize: 12, cursor: "pointer", padding: 0 }}>
            {inbox ? "▾" : "▸"} {loose.length} film file{loose.length === 1 ? "" : "s"} not on a game yet
          </button>
          {inbox && loose.map((g) => {
            const ss = schedules[seasonFor(g)] || [];
            const cands = ss.filter((x) => [teamKey(g.offense), teamKey(g.defense)].some((k) => k && (teamKey(x.home) === k || teamKey(x.away) === k)));
            return (
              <div key={g.id} style={{ display: "grid", gap: 3, padding: "6px 0", borderTop: "1px solid #3a2f14" }}>
                <div style={{ fontSize: 11, fontWeight: 800 }}>{g.file}</div>
                <select value="" onChange={(e) => { const x = ss.find((y) => String(y.id) === e.target.value); if (x) onConnect(g, x); }} style={{ ...field, padding: "3px 6px", fontSize: 11 }}>
                  <option value="">{ss.length ? `Put it on a ${seasonFor(g)} game…` : "Set its season first (open it)"}</option>
                  {(cands.length ? cands : ss).map((x) => <option key={x.id} value={x.id}>{weekLabel(x)} · {matchup(x)}</option>)}
                </select>
                <button type="button" style={{ ...mini, justifySelf: "start" }} onClick={() => onPick(g.id)}>Open it anyway</button>
              </div>
            );
          })}
        </div>
      )}
      <div className="wd-fs-scroll" style={{ display: "grid", gap: 8, maxHeight: "calc(100vh - 300px)", minHeight: 240, overflowY: "auto" }}>
        {weeks.map((w) => (
          <div key={w.label} style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: UI_GOLD, textTransform: "uppercase", letterSpacing: 0.5, position: "sticky", top: 0, background: "#141c2b", padding: "2px 0" }}>{w.label}</div>
            {w.rows.map(({ game: g2, away, home }) => (
              <div key={g2.id} style={{ display: "grid", gap: 3, padding: "5px 6px", borderRadius: 6, background: [away?.id, home?.id].includes(gameId) ? "#1c3355" : away || home ? "#172133" : "transparent" }}>
                <div style={{ fontSize: 12, fontWeight: 900 }}>{matchup(g2)}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#8494ad" }}>{dateOf(g2.date)}{scoreLine(g2) ? ` · ${scoreLine(g2)}` : ""}</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{side(g2, g2.away, away)}{side(g2, g2.home, home)}</div>
                {linkBox(g2)}
              </div>
            ))}
          </div>
        ))}
        {!weeks.length && <div style={{ fontSize: 12, color: "#8494ad", fontWeight: 700 }}>{!(season in schedules) ? "Loading the schedule…" : schedules[season] === null ? `No ${season} schedule saved yet.` : "No games match."}</div>}
      </div>
    </div>
  );
}

// ── A second browser window (user, 2026-11-25): rendered through a portal, so
// it shares this tab's state — nothing to sync. Keys pressed there (razor,
// 1–9, Space…) are passed back to the main window, except while typing. ──
// The window is opened by the button's click (so it's never blocked) and
// handed in; this only fills it. It never closes it itself — React's dev
// double-run would otherwise close it the moment it opened.
function Popout({ win, title, onClosed, children }) {
  const [el, setEl] = useState(null);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  useEffect(() => {
    if (!win || win.closed) return undefined;
    const d = win.document;
    d.head.querySelectorAll("[data-wd-pop]").forEach((n) => n.remove());
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => { const c = n.cloneNode(true); c.setAttribute("data-wd-pop", ""); d.head.appendChild(c); });
    d.body.innerHTML = "";
    Object.assign(d.body.style, { margin: "0", background: "#0b1220", color: "#e8edf5", colorScheme: "dark", fontFamily: getComputedStyle(document.body).fontFamily });
    const div = d.createElement("div");
    d.body.appendChild(div);
    setEl(div);
    const pass = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      const ev = new KeyboardEvent(e.type, { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat, bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      if (ev.defaultPrevented || e.key === " ") e.preventDefault();
    };
    win.addEventListener("keydown", pass);
    win.addEventListener("keyup", pass);
    const watch = setInterval(() => { if (win.closed) { clearInterval(watch); closedRef.current(); } }, 500);
    return () => { clearInterval(watch); win.removeEventListener("keydown", pass); win.removeEventListener("keyup", pass); setEl(null); };
  }, [win]);
  useEffect(() => { if (el && !win.closed) win.document.title = title; }, [el, win, title]);
  return el ? createPortal(children, el) : null;
}

// ── A game's box score (compSnapshots/_filmBox_{cfbdGameId}, CFBD /games/players
// saved by a backfill) → one short line per player. ──
const boxCache = {};
const loadBox = (gid) => {
  if (!gid) return Promise.resolve(null);
  if (!boxCache[gid]) boxCache[gid] = getDoc(doc(db, "compSnapshots", `_filmBox_${gid}`)).then((d) => (d.exists() ? d.data() : null)).catch(() => null);
  return boxCache[gid];
};
const STAT_LINES = [
  ["passing", (x) => `${x["C/ATT"] || "?"} · ${x.YDS || 0} yds${Number(x.TD) ? ` · ${x.TD} TD` : ""}${Number(x.INT) ? ` · ${x.INT} INT` : ""}`],
  ["rushing", (x) => `${x.CAR || 0} car · ${x.YDS || 0} yds${Number(x.TD) ? ` · ${x.TD} TD` : ""}`],
  ["receiving", (x) => `${x.REC || 0} rec · ${x.YDS || 0} yds${Number(x.TD) ? ` · ${x.TD} TD` : ""}`],
  ["defensive", (x) => [Number(x.TOT) ? `${x.TOT} tkl` : "", Number(x.TFL) ? `${x.TFL} TFL` : "", Number(x.SACKS) ? `${x.SACKS} sk` : "", Number(x["QB HUR"]) ? `${x["QB HUR"]} hur` : "", Number(x.PD) ? `${x.PD} PD` : ""].filter(Boolean).join(" · ")],
  ["interceptions", (x) => (Number(x.INT) ? `${x.INT} INT` : "")],
  ["fumbles", (x) => [Number(x.FUM) ? `${x.FUM} fum` : "", Number(x.LOST) ? `${x.LOST} lost` : "", Number(x.REC) ? `${x.REC} FR` : ""].filter(Boolean).join(" · ")],
  ["kicking", (x) => `FG ${x.FG || "0/0"} · XP ${x.XP || "0/0"}`],
  ["punting", (x) => `${x.NO || 0} punts · ${x.AVG || 0} avg`],
  ["kickReturns", (x) => (Number(x.NO) ? `${x.NO} KR · ${x.YDS || 0} yds` : "")],
  ["puntReturns", (x) => (Number(x.NO) ? `${x.NO} PR · ${x.YDS || 0} yds` : "")],
];
const statLine = (stats) => STAT_LINES.map(([k, f]) => (stats?.[k] ? f(stats[k]) : "")).filter(Boolean).join("  |  ");
// A big day in the box score (user, 2026-11-25: "good stats" → watch him): the reasons, short.
const bigGame = (st = {}) => {
  const n = (x) => Number(x) || 0;
  const out = [];
  const { passing: p, rushing: ru, receiving: re, defensive: d, interceptions: it, fumbles: fu } = st;
  if (p && (n(p.YDS) >= 200 || n(p.TD) >= 2)) out.push(`${n(p.YDS)} pass yds${n(p.TD) ? ` · ${n(p.TD)} TD` : ""}`);
  if (ru && (n(ru.YDS) >= 60 || n(ru.TD) >= 1)) out.push(`${n(ru.YDS)} rush yds${n(ru.TD) ? ` · ${n(ru.TD)} TD` : ""}`);
  if (re && (n(re.YDS) >= 60 || n(re.TD) >= 1 || n(re.REC) >= 5)) out.push(`${n(re.REC)} rec · ${n(re.YDS)} yds${n(re.TD) ? ` · ${n(re.TD)} TD` : ""}`);
  if (d && (n(d.TOT) >= 6 || n(d.TFL) >= 1 || n(d.SACKS) >= 1 || n(d.PD) >= 2 || n(d["QB HUR"]) >= 2)) out.push([n(d.TOT) ? `${n(d.TOT)} tkl` : "", n(d.TFL) ? `${n(d.TFL)} TFL` : "", n(d.SACKS) ? `${n(d.SACKS)} sk` : "", n(d.PD) ? `${n(d.PD)} PD` : "", n(d["QB HUR"]) ? `${n(d["QB HUR"])} hur` : ""].filter(Boolean).join(" · "));
  if (it && n(it.INT) >= 1) out.push(`${n(it.INT)} INT`);
  if (fu && n(fu.REC) >= 1) out.push(`${n(fu.REC)} FR`);
  return out;
};
const boxNameKey = (n) => String(n || "").toLowerCase().replace(/[^a-z]/g, "");

// The rosters window for cutting: both teams by number, set the featured
// (focus) players — their 1–9 keys — and tag the hot play.
function RosterWindow({ game, rosters, focus, hot, onFocus, onDrop, onTag }) {
  const [q, setQ] = useState("");
  const [box, setBox] = useState(undefined);
  const [order, setOrder] = useState(() => { try { return localStorage.getItem("wd.film.rosterOrder") || "number"; } catch { return "number"; } });
  useEffect(() => { try { localStorage.setItem("wd.film.rosterOrder", order); } catch { /* private window */ } }, [order]);
  useEffect(() => { setBox(undefined); loadBox(game.cfbdGameId).then(setBox); }, [game.cfbdGameId]);
  // Each box line, by CFBD id (roster keys carry it) or by name + team.
  const statsOf = useMemo(() => {
    const byId = new Map();
    const byName = new Map();
    (box?.teams || []).forEach((t) => t.players.forEach((pl) => { byId.set(String(pl.id), pl); byName.set(`${teamKey(t.name)}|${boxNameKey(pl.name)}`, pl); }));
    return (p) => byId.get(String(p.cfbd || "")) || byName.get(`${teamKey(p.team)}|${boxNameKey(p.name)}`) || null;
  }, [box]);
  // Box players missing from the rosters (walk-ons, other roster season) still show.
  const extra = useMemo(() => {
    if (!box) return [];
    const have = new Set(rosters.map((p) => String(p.cfbd || "")));
    const names = new Set(rosters.map((p) => `${teamKey(p.team)}|${boxNameKey(p.name)}`));
    return box.teams.flatMap((t) => t.players.filter((pl) => !have.has(String(pl.id)) && !names.has(`${teamKey(t.name)}|${boxNameKey(pl.name)}`))
      .map((pl) => ({ ...person({ name: pl.name, pos: "", team: [game.offense, game.defense].find((x) => teamKey(x) === teamKey(t.name)) || t.name, cfbd: pl.id }), jersey: null })));
  }, [box, rosters, game.offense, game.defense]);
  const everyone = useMemo(() => [...rosters, ...extra], [rosters, extra]);
  const s = q.trim().toLowerCase();
  const match = (p) => !s || `${p.jersey ?? ""} ${p.name} ${p.pos}`.toLowerCase().includes(s) || String(p.jersey) === s;
  const teams = [game.offense, game.defense].filter(Boolean);
  const rest = everyone.filter((p) => !teams.some((tm) => teamKey(tm) === teamKey(p.team)));
  const sorted = (list) => (order === "played" ? [...list].sort((a, b) => (statsOf(b) ? 1 : 0) - (statsOf(a) ? 1 : 0) || (a.jersey ?? 999) - (b.jersey ?? 999)) : list);
  // Who to watch (user, 2026-11-25), at the top of each team: draft prospects
  // (on We-Draft) and anyone with a big day in this game's box score.
  const whyOf = (p) => { const st = statsOf(p); return [...(p.wd ? ["Draft prospect"] : []), ...(st ? bigGame(st.stats) : [])]; };
  const watchOf = (list) => list.map((p) => ({ p, why: whyOf(p) })).filter((x) => x.why.length)
    .sort((a, b) => (b.why.length - (b.p.wd ? 0.5 : 0)) - (a.why.length - (a.p.wd ? 0.5 : 0)) || (a.p.jersey ?? 999) - (b.p.jersey ?? 999)).slice(0, 12);
  const groups = [...teams.map((tm, i) => ({ team: tm, side: i === 0 ? "Offense" : "Defense", list: sorted(everyone.filter((p) => teamKey(p.team) === teamKey(tm))) })), ...(rest.length ? [{ team: "Other", side: "", list: sorted(rest) }] : [])]
    .map((g) => { const watch = g.team === "Other" ? [] : watchOf(g.list); const w = new Set(watch.map((x) => x.p.key)); return { ...g, watch, list: g.list.filter((p) => !w.has(p.key)) }; });
  const score = box?.teams?.length === 2 ? box.teams.map((t) => `${t.name} ${t.points ?? ""}`).join(" · ") : "";
  const jerseyOf = (key) => rosters.find((p) => p.key === key)?.jersey;
  const row = (p, why = null) => {
    const fi = focus.findIndex((f) => f.key === p.key);
    const onHot = hot?.playerIds?.includes(p.key);
    const st = statsOf(p);
    const line = st ? statLine(st.stats) : "";
    return (
      <div key={p.key} style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto auto", gap: 8, alignItems: "center", padding: "5px 8px", borderRadius: 8, background: fi >= 0 ? "#1c3355" : "#141c2b", border: `1px solid ${fi >= 0 ? UI_BLUE : "#263247"}`, opacity: box && !st && order === "played" ? 0.6 : 1 }}>
        <span style={{ fontSize: 18, fontWeight: 900, color: UI_GOLD, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.jersey != null ? `#${p.jersey}` : "—"}</span>
        <span style={{ display: "grid", minWidth: 0 }}>
          <span style={ellipsis({ fontSize: 14, fontWeight: 800 })}>{p.name} <span style={{ fontSize: 12, color: "#8494ad" }}>{p.pos}</span></span>
          {why && <span style={ellipsis({ fontSize: 11, fontWeight: 900, color: UI_GOLD })} title={why.join(" · ")}>👀 {why.join(" · ")}</span>}
          {line && <span style={ellipsis({ fontSize: 11, fontWeight: 800, color: "#7fd1a0" })} title={line}>{line}</span>}
        </span>
        <button type="button" onClick={() => (fi >= 0 ? onDrop(p.key) : onFocus(p))} title={fi >= 0 ? "Featured — click to remove" : "Feature him (gets a 1–9 key)"}
          style={{ ...chip(fi >= 0, UI_GOLD), color: fi >= 0 ? "#0b1220" : "#e8edf5", minWidth: 84 }}>{fi >= 0 ? `★ ${fi + 1}` : "☆ Feature"}</button>
        <button type="button" disabled={!hot} onClick={() => onTag(p)} title={hot ? "Tag him on the hot play" : "Cut a play first"}
          style={{ ...chip(onHot, "#15803d"), opacity: hot ? 1 : 0.4, cursor: hot ? "pointer" : "default", minWidth: 70 }}>{onHot ? "✓ On play" : "+ Play"}</button>
      </div>
    );
  };
  return (
    <div style={{ display: "grid", gap: 12, padding: 16 }}>
      <div style={{ display: "grid", gap: 2 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{gameTitle(game)}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#9fb0c8" }}>{box === undefined ? "Loading the box score…" : box ? `Box score${score ? ` · ${score}` : ""} — stat lines under each player` : game.cfbdGameId ? "No box score saved for this game yet." : "Put this film on a game to see its box score."}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: hot ? "#4ade80" : "#8494ad" }}>{hot ? `Hot play ${clock(hot.in)}–${clock(hot.out)} · ${hot.playerIds?.length || 0} tagged` : "No hot play — cut one in the main window."}</div>
      </div>
      <div style={box}>
        <div style={head}>Featured · Shift+1–9 on a hot play</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {focus.map((p, i) => <span key={p.key} style={{ ...chip(false), display: "inline-flex", gap: 6 }}><b style={{ color: UI_GOLD }}>{i + 1}</b>{jerseyOf(p.key) != null ? `#${jerseyOf(p.key)} ` : ""}{p.name}<button type="button" onClick={() => onDrop(p.key)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ff7a6b", padding: 0 }}>✕</button></span>)}
          {!focus.length && <span style={{ fontSize: 12, color: "#8494ad", fontWeight: 700 }}>Click ☆ Feature on the players you&apos;re watching.</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a number or name…" style={{ ...field, fontSize: 15, padding: "8px 12px", flex: 1 }} />
        <button type="button" style={chip(order === "number")} onClick={() => setOrder("number")}>By number</button>
        <button type="button" style={chip(order === "played")} onClick={() => setOrder("played")}>Played first</button>
      </div>
      {!rosters.length && <div style={{ fontSize: 13, color: "#8494ad", fontWeight: 700 }}>Loading the rosters… (set the game&apos;s teams if this stays empty)</div>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(2, groups.length || 1)}, minmax(0, 1fr))`, gap: 12, alignItems: "start" }}>
        {groups.map((g) => (
          <div key={g.team} style={{ display: "grid", gap: 4 }}>
            <div style={{ ...head, color: UI_GOLD }}>{g.team}{g.side ? ` · ${g.side}` : ""} · {g.list.length + g.watch.length}</div>
            {g.watch.filter((x) => match(x.p)).length > 0 && (
              <div style={{ display: "grid", gap: 4, padding: 6, borderRadius: 10, border: `1px solid ${UI_GOLD}`, background: "#1d1a10" }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: UI_GOLD, letterSpacing: 0.5 }}>👀 WATCH</div>
                {g.watch.filter((x) => match(x.p)).map((x) => row(x.p, x.why))}
              </div>
            )}
            {g.list.filter(match).map((p) => row(p))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Someone to tag: a search over a pool of people (rosters, We-Draft players).
function PersonPicker({ pool, onPick, placeholder = "Tag anyone…", exclude = [] }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return pool.filter((p) => !exclude.includes(p.key) && `${p.name} ${p.team} ${p.jersey ?? ""}`.toLowerCase().includes(s)).slice(0, 10);
  }, [q, pool, exclude]);
  return (
    <div style={{ position: "relative" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} style={{ ...field, width: "100%" }} />
      {hits.length > 0 && (
        <div style={{ position: "absolute", zIndex: 10, top: "100%", left: 0, right: 0, background: "#141c2b", border: "1px solid #334058", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,0.12)", maxHeight: 280, overflowY: "auto" }}>
          {hits.map((p) => (
            <button key={p.key} type="button" onClick={() => { onPick(p); setQ(""); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 800 }}>
              {p.jersey != null ? `#${p.jersey} ` : ""}{p.name} <span style={{ color: "#8494ad", fontWeight: 700 }}>· {p.pos} · {p.team}{p.wd ? " · We-Draft" : " · CFBD"}{p.film ? " · 🎞️ film" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cut plays ──
function CutTab({ games, setGames, fileFor, gate, wdPeople, schools, openPlayer, schedules, onConnect, onLink, onReview }) {
  const [gameId, setGameId] = useState("");
  const [file, setFile] = useState(null);
  const [plays, setPlays] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [hot, setHot] = useState(null);
  const [inPt, setInPt] = useState(null);
  const [t, setT] = useState(0);
  const [msg, setMsg] = useState("");
  const api = useRef(null);
  const stageRef = useRef(null);
  // The rosters pop-out window — opened right in the click, closed by the
  // button, by leaving Cut plays, or by closing it.
  const [popWin, setPopWin] = useState(null);
  const popRef = useRef(null);
  popRef.current = popWin;
  useEffect(() => () => { try { popRef.current?.close(); } catch { /* gone */ } }, []);
  useEffect(() => { const bye = () => popRef.current?.close(); window.addEventListener("beforeunload", bye); return () => window.removeEventListener("beforeunload", bye); }, []);
  const togglePop = () => {
    if (popWin && !popWin.closed) { popWin.close(); setPopWin(null); return; }
    const w = window.open("", "wd-film-rosters", "width=900,height=960");
    if (!w) { setMsg("The browser blocked the pop-up — allow pop-ups for this site."); return; }
    setPopWin(w);
  };
  const game = games.find((g) => g.id === gameId) || null;
  const focus = game?.focus || [];
  // The scrub row (same as Players): hold ◀ / ▶ = fast motion; in the game view a double-click is 5s that way.
  const motion = useFastMotion(api);
  const taps = useRef(null); // A/D/←/→ taps — double = 5s, triple = 10s
  const dur = api.current?.duration?.() || 0;


  useEffect(() => {
    if (!game) return;
    setFile(null); setHot(null); setInPt(null); setPlays([]);
    fileFor(game).then((f) => { setFile(f); if (!f) setMsg("Can't find this game's file — check the library folder."); }).catch((e) => setMsg(e.message));
    playsForGame(game.id).then(setPlays).catch((e) => setMsg(e.message));
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!game) return;
    Promise.all([roster(game.offense), roster(game.defense)]).then(([a, b]) => setRosters([...a, ...b]));
  }, [game?.offense, game?.defense]); // eslint-disable-line react-hooks/exhaustive-deps
  const pool = useMemo(() => { const m = new Map(); [...rosters, ...wdPeople].forEach((p) => { if (!m.has(p.key)) m.set(p.key, p); }); return [...m.values()]; }, [rosters, wdPeople]);

  const editGame = (patch) => { setGames((gs) => gs.map((g) => (g.id === game.id ? { ...g, ...patch } : g))); saveGame(game.id, patch).catch((e) => setMsg(e.message)); };
  const addFocus = (p) => { if (!focus.some((f) => f.key === p.key)) editGame({ focus: [...focus, person(p)] }); };
  const dropFocus = (key) => editGame({ focus: focus.filter((f) => f.key !== key) });

  const cut = async (outPt) => {
    if (inPt == null) { setMsg("Mark the start first (C)."); return; }
    // Scrubbed back past the start: the two cuts still make the play.
    const a = Math.min(inPt, outPt);
    const b = Math.max(inPt, outPt);
    if (b - a < 0.3) { setMsg("That's under a third of a second — move on and cut again."); return; }
    try {
      const p = await cutPlay(game, Math.round(a * 100) / 100, Math.round(b * 100) / 100);
      setPlays((ps) => [...ps, p].sort((a, b) => a.in - b.in));
      setHot(p);
      setInPt(null);
      setGames((gs) => gs.map((g) => (g.id === game.id ? { ...g, plays: (g.plays || 0) + 1 } : g)));
      setMsg(`Cut ${clock(p.in)}–${clock(p.out)}. It's hot — tag players (1–9).`);
    } catch (e) { setMsg(`Couldn't save: ${e.message}`); }
  };
  // One key: the first cut starts a play, the next snips its end.
  const razor = () => {
    const tm = api.current?.time() ?? 0;
    if (inPt == null) { setInPt(tm); setMsg(`Play starts at ${clock(tm)} — play or scroll ahead, then C again to snip the end.`); } else cut(tm);
  };
  // Starting / ending a play sooner or later: the play itself (every player on it).
  const trimPlay = async (p, r) => {
    const next = { ...p, in: Math.round(Math.max(0, r.in) * 100) / 100, out: Math.round(r.out * 100) / 100 };
    if (next.out - next.in < 0.3) return;
    setPlays((ps) => ps.map((x) => (x.id === p.id ? next : x)).sort((x, y) => x.in - y.in));
    if (hot?.id === p.id) setHot(next);
    try { await updatePlay(p.id, { in: next.in, out: next.out }); } catch (e) { setMsg(`Couldn't save the trim: ${e.message}`); }
  };
  // ── Voice (user, 2026-11-25): the moment a play goes hot, the mic listens and
  // the names said are tagged on it (utils/film/voice.js matches them against
  // this game's focus players and both rosters). Chrome's speech recognition. ──
  // The snip (razor) key: C by default; 1 / F13–F15 for macro keys, or a mouse
  // side button. With 1, tagging focus players moves to Shift+1–9.
  const [snipKey, setSnipKey] = useState(() => { try { return localStorage.getItem("wd.film.snipKey") || "c"; } catch { return "c"; } });
  useEffect(() => { try { localStorage.setItem("wd.film.snipKey", snipKey); } catch { /* private window */ } }, [snipKey]);
  const razorRef = useRef(null);
  // "Press it": the next key or mouse button pressed becomes the snip key —
  // whatever a mouse's macro key sends (user, 2026-11-25: the 1 key on his mouse).
  const [learning, setLearning] = useState(false);
  useEffect(() => {
    if (!learning) return undefined;
    const done = (v, e) => { e.preventDefault(); e.stopPropagation(); setSnipKey(v); setLearning(false); setMsg(`Snip key set: ${snipName(v)}.`); };
    const key = (e) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (e.key === "Escape") { e.preventDefault(); setLearning(false); return; }
      done(/^Digit[1-9]$/.test(e.code) ? e.code.slice(5) : /^Key[A-Z]$/.test(e.code) && e.code === "KeyC" ? "c" : `code:${e.code}`, e);
    };
    const mouse = (e) => { if (e.button >= 1) done(e.button === 3 ? "mouse4" : e.button === 4 ? "mouse5" : `btn:${e.button}`, e); };
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", mouse, true);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("mousedown", mouse, true); };
  }, [learning]);
  useEffect(() => {
    const side = snipKey === "mouse4" ? 3 : snipKey === "mouse5" ? 4 : snipKey.startsWith("btn:") ? Number(snipKey.slice(4)) : null;
    if (side == null) return undefined;
    // Side buttons: snip — and keep the browser from going back / forward.
    const down = (e) => { if (e.button === side) { e.preventDefault(); if (!isTyping(e)) razorRef.current?.(); } };
    const block = (e) => { if (e.button === side) e.preventDefault(); };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("mouseup", block, true);
    window.addEventListener("auxclick", block, true);
    return () => { window.removeEventListener("mousedown", down, true); window.removeEventListener("mouseup", block, true); window.removeEventListener("auxclick", block, true); };
  }, [snipKey]);
  razorRef.current = game ? razor : null;
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem("wd.film.voice") !== "off"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("wd.film.voice", voiceOn ? "on" : "off"); } catch { /* private window */ } }, [voiceOn]);
  const [interim, setInterim] = useState("");
  const [heard, setHeard] = useState([]);
  // Live feedback (user, 2026-11-25): who it's hearing while you talk, and who it added —
  // in the middle of the film.
  const [hearing, setHearing] = useState([]); // [name] — a preview, from the words so far
  const [feed, setFeed] = useState([]); // [{ id, kind: "add" | "set" | "remove" | "already" | "note", name, extra, text, at }]
  // Words it couldn't place (or a tie): "Did you mean …?" — answered out loud
  // (user, 2026-11-25: never "pick below"), and it learns.
  const [asks, setAsks] = useState([]); // [{ id, phrase, how, options: [key] }]
  const [flash, setFlash] = useState({}); // key → until (ms) — a chip just added by voice
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); }, []);
  const nameOf = (key) => (voiceLive.current.gamePeople.find((p) => p.key === key) || voiceLive.current.focus.find((p) => p.key === key) || voiceLive.current.hot?.players?.[key])?.name || key;
  const note = (text) => setFeed((fd) => [{ id: `${Date.now()}-n`, kind: "note", text, at: Date.now() }, ...fd].slice(0, 8));
  const [aliases, setAliases] = useState(loadAliases);
  // The last player named — "Kromah…" then "great" (two phrases) still goes to him.
  const lastNamed = useRef(null);
  // Each position's traits (position + generic) — for "Kromah good vision".
  const [traitLists, setTraitLists] = useState({});
  useEffect(() => {
    const posList = [...new Set([...focus, ...pool].map((p) => p.pos).filter(Boolean))].filter((p) => !traitLists[p]);
    posList.forEach((pos) => traitsFor(pos).then((t) => setTraitLists((m) => ({ ...m, [pos]: [...t.position, ...t.generic] }))));
  }, [pool, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only the people in this game — the featured players and the two rosters —
  // never anyone who isn't in it (user, 2026-11-25).
  const gamePeople = useMemo(() => { const m = new Map(); [...focus, ...rosters].forEach((p) => { if (p?.key && !m.has(p.key)) m.set(p.key, p); }); return [...m.values()]; }, [focus, rosters]);
  const voiceLive = useRef({});
  voiceLive.current = { hot, pool, focus, aliases, traitLists, asks, gamePeople };
  const personOf = (key) => voiceLive.current.gamePeople.find((p) => p.key === key) || voiceLive.current.focus.find((p) => p.key === key) || voiceLive.current.hot?.players?.[key] || null;
  // Tag / untag several at once on the hot play (one state update — no lost tags).
  // A label or trait for someone not on the play yet puts him on it.
  const applyVoice = async (addKeys0, removeKeys, heardList = [], labels = {}, traitsBy = {}) => {
    let next = voiceLive.current.hot;
    if (!next) return;
    const addKeys = [...new Set([...addKeys0, ...Object.keys(labels), ...Object.keys(traitsBy)])];
    const phraseOf = (key) => heardList.find((h) => h.key === key && !["label", "trait"].includes(h.how))?.phrase || "";
    const extraOf = (key) => [labels[key], (traitsBy[key] || []).join(", ")].filter(Boolean).join(" · ");
    const report = (kind, key) => {
      setFeed((fd) => [{ id: `${Date.now()}-${key}-${kind}`, kind, key, name: nameOf(key), phrase: phraseOf(key), extra: kind === "remove" ? "" : extraOf(key), at: Date.now() }, ...fd].slice(0, 8));
      if (kind === "add" || kind === "set") setFlash((fl) => ({ ...fl, [key]: Date.now() + 2500 }));
    };
    const reported = new Set();
    for (const key of addKeys) {
      if (next.playerIds.includes(key)) { if (!labels[key] && !traitsBy[key]) { report("already", key); reported.add(key); } continue; }
      const p = personOf(key);
      if (!p) continue;
      try { await tagPlayer(next, p); next = { ...next, playerIds: [...next.playerIds, key], players: { ...next.players, [key]: { ...person(p), label: "" } } }; if (!labels[key] && !traitsBy[key]) { report("add", key); reported.add(key); } } catch (e) { setMsg(`Couldn't tag: ${e.message}`); } // eslint-disable-line no-await-in-loop
    }
    for (const key of removeKeys) {
      if (!next.playerIds.includes(key)) continue;
      try { await untagPlayer(next, key); const players = { ...next.players }; delete players[key]; next = { ...next, playerIds: next.playerIds.filter((k) => k !== key), players }; report("remove", key); } catch (e) { setMsg(`Couldn't untag: ${e.message}`); } // eslint-disable-line no-await-in-loop
    }
    // The labels and traits said for players on the play (a label replaces the old one).
    for (const key of new Set([...Object.keys(labels), ...Object.keys(traitsBy)])) {
      if (!next.playerIds.includes(key)) continue;
      const tag = next.players[key] || {};
      const patch = {};
      if (labels[key]) patch.label = labels[key];
      if (traitsBy[key]?.length) patch.traits = [...new Set([...(tag.traits || []), ...traitsBy[key]])];
      try { await editTag(next, key, patch); next = { ...next, players: { ...next.players, [key]: { ...tag, ...patch } } }; if (!reported.has(key)) report("set", key); } catch (e) { setMsg(`Couldn't save: ${e.message}`); } // eslint-disable-line no-await-in-loop
    }
    voiceLive.current.hot = next;
    setHot(next);
    setPlays((ps) => ps.map((x) => (x.id === next.id ? next : x)));
  };
  // Who's in the running: the featured players first, then the two rosters, and anyone already on the play.
  const peopleNow = () => {
    const L = voiceLive.current;
    const m = new Map();
    [...L.focus.map((p) => ({ ...L.gamePeople.find((x) => x.key === p.key), ...p, focus: true })), ...L.gamePeople, ...Object.values(L.hot?.players || {})].forEach((p) => { if (p?.key && !m.has(p.key)) m.set(p.key, p); });
    return [...m.values()];
  };
  // His traits for a key; who a label with no name goes to: the one featured
  // player when there's only one (user, 2026-11-25), else the play's only player.
  const voiceOpts = () => {
    const L = voiceLive.current;
    const ids = L.hot?.playerIds || [];
    return { traitsOf: (key) => L.traitLists[personOf(key)?.pos] || [], sole: L.focus.length === 1 ? L.focus[0].key : ids.length === 1 ? ids[0] : null, current: lastNamed.current };
  };
  const heardFinal = (text) => {
    const L = voiceLive.current;
    // A question waiting: is this its answer? ("Patrick", "the second one", "number 12", "skip")
    const ask = L.asks[0];
    if (ask) {
      const ans = answerAsk(text, ask.options, peopleNow());
      if (ans === "skip") { setAsks((a) => a.filter((x) => x.id !== ask.id)); note(`Skipped “${ask.phrase}”`); return; }
      if (ans) { teachHeard(ask.phrase, ans); return; }
    }
    if (!L.hot) return;
    const out = parseVoice(text, peopleNow(), L.aliases, voiceOpts());
    lastNamed.current = out.last;
    setHeard((h) => [...h, ...out.heard].slice(-12));
    setHearing([]);
    const open = out.heard.filter((h) => !h.key && h.options?.length);
    if (open.length) setAsks((a) => [...a, ...open.map((h, k) => ({ id: `${Date.now()}-${k}`, phrase: h.phrase, how: h.how, options: h.options.slice(0, 3) }))].slice(-4));
    if (out.add.length || out.remove.length || Object.keys(out.labels).length || Object.keys(out.traits).length) applyVoice(out.add, out.remove, out.heard, out.labels, out.traits);
    else if (!open.length) {
      const lost = out.heard.find((h) => !h.key);
      if (lost) note(lost.how.startsWith("label") ? `“${lost.phrase}” — who? Say his name first` : `“${text.trim()}” — no one in this game`);
    }
  };
  const heardInterim = (live) => {
    setInterim(live);
    // While you talk: who those words would tag.
    if (live && voiceLive.current.hot) {
      const pre = parseVoice(live, peopleNow(), voiceLive.current.aliases, voiceOpts());
      const keys = [...new Set([...pre.add, ...Object.keys(pre.labels), ...Object.keys(pre.traits)])];
      setHearing(keys.map((k) => [nameOf(k), pre.labels[k], ...(pre.traits[k] || [])].filter(Boolean).join(" · ")));
    } else setHearing([]);
  };
  // The mic (user, 2026-11-25): live once a play goes hot (when "Mic on hot
  // plays" is on) and off when there's no hot play; the Mic button (V) turns
  // it on or off whenever. While live it keeps hearing (useSpeech restarts it).
  const [mic, setMic] = useState(false);
  useEffect(() => { setMic(!!hot?.id && voiceOn); }, [hot?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { listening } = useSpeech(mic && !!game, { onFinal: heardFinal, onInterim: heardInterim, onBlocked: (m) => { setMsg(m); setMic(false); } });
  // A new hot play: a fresh slate (the mic stays on).
  useEffect(() => { setFeed([]); setAsks([]); setHeard([]); lastNamed.current = null; }, [hot?.id]);
  // A heard word it didn't place: who it was — tag him, and learn the word (not a jersey number).
  const teachHeard = (phrase, key) => {
    if (!phrase.startsWith("#")) setAliases(teach(phrase, key));
    setHeard((h) => h.map((x) => (x.phrase === phrase && !x.key ? { ...x, key, how: phrase.startsWith("#") ? "picked" : "taught" } : x)));
    setAsks((a) => a.filter((x) => x.phrase !== phrase));
    lastNamed.current = key;
    applyVoice([key], [], [{ phrase, key, how: "taught" }]);
  };
  // Wipe (X, user 2026-11-25): clear what's going on — the hot play, a started
  // cut, what voice heard and asked — to start fresh. Saved plays stay.
  const qHold = useRef(null);
  const wipe = () => {
    setHot(null); setInPt(null); qHold.current = null;
    setFeed([]); setAsks([]); setHeard([]); setHearing([]); setInterim(""); lastNamed.current = null;
    setArmed(null); setEndPrompt(false);
    setMsg("Wiped — your saved plays are untouched. Start fresh.");
  };
  // Hot (Z): the play under the playhead (else the last one before it) goes hot; Z again: done with it.
  const hotHere = () => {
    if (hot) { setHot(null); setMsg("Done with that play — Z makes the one here hot again."); return; }
    const now = api.current?.time() ?? t;
    const p = plays.find((x) => now >= x.in - 0.1 && now <= x.out + 0.1) || [...plays].sort((x, y) => y.in - x.in).find((x) => x.in <= now) || null;
    if (p) { setHot(p); setMsg(`Hot: ${clock(p.in)}–${clock(p.out)}`); } else setMsg("No play here yet — cut one first.");
  };
  // The end of the game (user, 2026-11-25): "Start tagging?" — each player
  // clipped in it, one by one, in the Players view.
  const [endPrompt, setEndPrompt] = useState(false);
  const endSeen = useRef({});
  useEffect(() => {
    if (game && dur && t >= dur - 0.75 && !endSeen.current[game.id] && plays.some((p) => p.playerIds?.length)) { endSeen.current[game.id] = true; setEndPrompt(true); }
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const startTagging = () => { setEndPrompt(false); onReview(game, plays); };

  const nudgeHot = (edge, d) => hot && trimPlay(hot, { in: hot.in + (edge === "in" ? d : 0), out: hot.out + (edge === "out" ? d : 0) });
  const hotEdgeHere = (edge) => hot && api.current && trimPlay(hot, { in: edge === "in" ? api.current.time() : hot.in, out: edge === "out" ? api.current.time() : hot.out });
  const toggleTag = async (p) => {
    if (!hot) return;
    const on = hot.playerIds.includes(p.key);
    try {
      if (on) await untagPlayer(hot, p.key); else await tagPlayer(hot, p);
      const next = { ...hot, playerIds: on ? hot.playerIds.filter((k) => k !== p.key) : [...hot.playerIds, p.key], players: { ...hot.players } };
      if (on) delete next.players[p.key]; else next.players[p.key] = { ...person(p), label: "" };
      setHot(next);
      setPlays((ps) => ps.map((x) => (x.id === next.id ? next : x)));
    } catch (e) { setMsg(`Couldn't tag: ${e.message}`); }
  };
  // Delete: click ✕ twice (a browser confirm box knocked Chrome out of full screen).
  const [armed, setArmed] = useState(null);
  const armedTimer = useRef(null);
  const remove = async (p) => {
    if (armed !== p.id) {
      setArmed(p.id);
      clearTimeout(armedTimer.current);
      armedTimer.current = setTimeout(() => setArmed(null), 3000);
      setMsg(`Delete the play at ${clock(p.in)}? Press ✕ / Delete again.`);
      return;
    }
    setArmed(null);
    setMsg(`Deleted the play at ${clock(p.in)}.`);
    await deletePlay(p).catch((e) => setMsg(e.message));
    setPlays((ps) => ps.filter((x) => x.id !== p.id));
    if (hot?.id === p.id) setHot(null);
  };

  // Keys: Space play/pause · J back 3s · K pause · L play (again: faster) · ←/→ 1s (Shift 5s) · , / . a frame
  // · C (or Ctrl+K) the razor · I start · O end · [ / ] the hot play starts / ends here · 1–9 tag focus · Esc.
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || !api.current || !game) return;
      const a = api.current;
      const k = e.key;
      if (endPrompt && (k === "Enter" || k === "Escape")) { e.preventDefault(); if (k === "Enter") startTagging(); else setEndPrompt(false); return; }
      if ((e.ctrlKey || e.metaKey) && (k === "k" || k === "K")) { e.preventDefault(); razor(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // The number keys (user, 2026-11-25 — his mouse's keypad): 1 is ALWAYS
      // the razor, 4 plays / pauses; focus players are Shift+1–9.
      const digit = (/^(Digit|Numpad)([1-9])$/.exec(e.code) || [])[2];
      if (digit) {
        e.preventDefault();
        if (e.shiftKey) { if (hot) { const p = focus[Number(digit) - 1]; if (p) toggleTag(p); } return; }
        if (digit === "1") razor(); else if (digit === "4") a.toggle();
        return;
      }
      // The chosen snip key (besides 1).
      if (snipKey.startsWith("code:") ? e.code === snipKey.slice(5) : snipKey !== "c" && !/^[1-9]$/.test(snipKey) && !snipKey.startsWith("mouse") && !snipKey.startsWith("btn:") && k === snipKey) { e.preventDefault(); razor(); return; }
      // Q (user, 2026-11-25): press = the play starts, let go = it ends (a paused
      // film plays while it's held). A quick tap works like the razor.
      if (k === "q" || k === "Q") {
        e.preventDefault();
        if (e.repeat) return;
        if (inPt == null) {
          const tm = a.time();
          qHold.current = { at: performance.now(), paused: a.paused() };
          setInPt(tm);
          if (a.paused()) a.play();
          setMsg(`Play starts at ${clock(tm)} — let go of Q to end it (or tap Q again).`);
        } else { qHold.current = null; cut(a.time()); }
        return;
      }
      if (k === " ") { e.preventDefault(); a.toggle(); } else if (k === "j" || k === "J") a.nudge(-3);
      else if ((k === "c" || k === "C") && snipKey === "c") razor();
      else if (k === "v" || k === "V") setMic((x) => !x);
      else if (k === "x" || k === "X") wipe();
      else if (k === "z" || k === "Z") hotHere();
      else if (k === "[") hotEdgeHere("in"); else if (k === "]") hotEdgeHere("out");
      else if (k === "k" || k === "K") { a.pause(); a.setRate(1); } else if (k === "l" || k === "L") { if (a.paused()) { a.setRate(1); a.play(); } else a.setRate(a.rate() >= 4 ? 1 : a.rate() * 2); }
      // ←/→ and A/D: hold = fast motion · ↑/↓ and W/S: 5s ahead / back.
      // Double tap = 5s that way, triple = 10s (each extra tap adds 5s).
      else if (k === "ArrowLeft" || k === "ArrowRight" || /^[aAdD]$/.test(k)) {
        e.preventDefault();
        if (e.repeat) return;
        const dir = k === "ArrowLeft" || k === "a" || k === "A" ? -1 : 1;
        const now = performance.now();
        const tp = taps.current;
        taps.current = tp && tp.dir === dir && now - tp.at < 320 ? { dir, at: now, n: tp.n + 1 } : { dir, at: now, n: 1 };
        if (taps.current.n === 2 || taps.current.n === 3) a.nudge(5 * dir);
        motion.start(dir);
      }
      else if (k === "ArrowUp" || k === "w" || k === "W") { e.preventDefault(); a.nudge(5); } else if (k === "ArrowDown" || k === "s" || k === "S") { e.preventDefault(); a.nudge(-5); }
      else if (k === ",") a.step(-1); else if (k === ".") a.step(1);
      else if (k === "i" || k === "I") { setInPt(a.time()); setMsg(`Start at ${clock(a.time())} — O to cut.`); }
      else if (k === "o" || k === "O") cut(a.time());
      else if (/^[1-9]$/.test(k) && hot) { const p = focus[Number(k) - 1]; if (p) toggleTag(p); }
      else if ((k === "Delete" || k === "Backspace") && hot) { e.preventDefault(); remove(hot); }
      else if (k === "Escape") { setHot(null); setInPt(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const up = (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || /^[aAdD]$/.test(e.key)) motion.end();
      // Q let go after a hold: the play ends here.
      if ((e.key === "q" || e.key === "Q") && qHold.current) {
        const h = qHold.current;
        qHold.current = null;
        if (performance.now() - h.at >= 350 && api.current) { cut(api.current.time()); if (h.paused) api.current.pause(); }
      }
    };
    window.addEventListener("keyup", up);
    return () => window.removeEventListener("keyup", up);
  });

  // The games this film could be (its teams, its season) — to fix a match.
  const choices = game ? (schedules[seasonFor(game)] || []).filter((x) => [teamKey(game.offense), teamKey(game.defense)].some((k) => k && (teamKey(x.home) === k || teamKey(x.away) === k))) : [];
  const other = game?.cfbdGameId ? games.find((g) => g.id !== game.id && g.cfbdGameId === game.cfbdGameId) : null;

  return (
    <div ref={stageRef} className="wd-film-stage wd-fs-cut" style={{ ...stageStyle, display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <GameList games={games} schedules={schedules} gameId={gameId} onPick={setGameId} onConnect={onConnect} onLink={async (...a) => { const id = await onLink(...a); if (id) setGameId(id); }} />

      {!game ? <div style={{ ...box, color: "#8494ad", fontWeight: 700, padding: 40, textAlign: "center" }}>Pick a game on the left.</div> : (
        <div className="wd-fs-main" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, minWidth: 0 }}>
          <div className="wd-fs-hide" style={box}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{gameTitle(game)}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, fontWeight: 700, color: "#8494ad" }}>
              <span>{game.file}</span>
              {scoreLine(game) && <span>· {scoreLine(game)}</span>}
              {other ? <button type="button" style={mini} onClick={() => setGameId(other.id)}>Other side: {cfbdTeam(other.offense)} offense →</button> : game.cfbdGameId ? <span>· no {cfbdTeam(game.defense)} offense film yet</span> : null}
            </div>
            <select value={game.cfbdGameId || ""} onChange={(e) => { const x = choices.find((y) => String(y.id) === e.target.value); if (x) onConnect(game, x); }} style={{ ...field, fontSize: 12 }}>
              <option value="">{game.cfbdGameId ? "" : "Not on a game — pick it…"}</option>
              {choices.map((x) => <option key={x.id} value={x.id}>{weekLabel(x)} · {dateOf(x.date)} · {matchup(x)}</option>)}
            </select>
          </div>
          <div className="wd-fs-hide" style={{ ...box, gridTemplateColumns: "1fr 1fr 110px", alignItems: "end" }}>
            <label style={{ fontSize: 11, fontWeight: 800 }}>Offense<input list="film-teams" defaultValue={game.offense} key={`o${game.id}`} onBlur={(e) => e.target.value !== game.offense && editGame({ offense: e.target.value.trim() })} style={{ ...field, width: "100%" }} /></label>
            <label style={{ fontSize: 11, fontWeight: 800 }}>Defense<input list="film-teams" defaultValue={game.defense} key={`d${game.id}`} onBlur={(e) => e.target.value !== game.defense && editGame({ defense: e.target.value.trim() })} style={{ ...field, width: "100%" }} /></label>
            <label style={{ fontSize: 11, fontWeight: 800 }}>Season<input defaultValue={game.season} key={`s${game.id}`} onBlur={(e) => e.target.value !== game.season && editGame({ season: e.target.value.trim() })} style={{ ...field, width: "100%" }} /></label>
            <datalist id="film-teams">{schools.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="wd-fs-hide" style={box}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={head}>Focus players (Shift+1–9 on a hot play)</div>
              <button type="button" style={btn(!!popWin)} onClick={togglePop} title="Both rosters with numbers and this game's stats in their own window — feature players and tag the hot play there">{popWin ? "Close rosters window" : "⧉ Rosters window"}</button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {focus.map((p, i) => <span key={p.key} style={{ ...chip(false), display: "inline-flex", gap: 6 }}><b>{i + 1}</b>{p.name} <span style={{ color: "#8494ad" }}>{p.pos}</span><button type="button" onClick={() => dropFocus(p.key)} style={{ border: "none", background: "none", cursor: "pointer", color: "#ff7a6b", padding: 0 }}>✕</button></span>)}
              {!focus.length && <span style={{ fontSize: 12, color: "#8494ad", fontWeight: 700 }}>Add the players you&apos;re watching this game for.</span>}
            </div>
            <PersonPicker pool={pool} onPick={addFocus} exclude={focus.map((f) => f.key)} placeholder={rosters.length ? `Add from the ${game.offense} / ${game.defense} rosters…` : "Add a player… (set the teams to load their rosters)"} />
          </div>

          {popWin && (
            <Popout win={popWin} title={`Rosters · ${gameTitle(game)}`} onClosed={() => setPopWin(null)}>
              <RosterWindow game={game} rosters={rosters} focus={focus} hot={hot} onFocus={addFocus} onDrop={dropFocus} onTag={toggleTag} />
            </Popout>
          )}
          <FilmPlayer file={file} gate={gate} stageRef={stageRef} apiRef={api} onTime={(x) => setT(x)} spots={[]}
            overlay={listening ? (
              <div style={{ display: "grid", gap: 4, padding: "6px 10px", borderRadius: 10, background: "rgba(8,12,22,0.78)", border: "2px solid #ff6b5b", fontFamily: "Arial, sans-serif" }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#ff6b5b" }}>● Listening</div>
                {interim && <div style={{ fontSize: 13, fontStyle: "italic", color: "#e8edf5" }}>“{interim}”</div>}
                {hearing.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{hearing.map((n) => <span key={n} style={{ border: "1px dashed #9fb0c8", color: "#d7e1ef", borderRadius: 999, padding: "1px 8px", fontSize: 12, fontWeight: 800 }}>{n}?</span>)}</div>}
              </div>
            ) : null}
            center={endPrompt ? (
              <div style={{ display: "grid", gap: 10, justifyItems: "center", padding: "18px 26px", borderRadius: 14, background: "rgba(8,12,22,0.92)", border: `2px solid ${UI_GOLD}`, textAlign: "center", fontFamily: "Arial, sans-serif" }}>
                <div style={{ fontSize: 24, fontWeight: 900, color: UI_GOLD }}>End of the game</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#e8edf5" }}>Start tagging? Each player you clipped, one by one — labels, traits, circles.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={{ ...btn(true), background: UI_GOLD, borderColor: UI_GOLD, color: "#00264d" }} onClick={startTagging}>Start tagging (Enter)</button>
                  <button type="button" style={btn(false)} onClick={() => setEndPrompt(false)}>Later (Esc)</button>
                </div>
              </div>
            ) : (asks.length > 0 || feed.some((x) => Date.now() - x.at < 3000)) ? (
              <div style={{ display: "grid", gap: 6, justifyItems: "center", padding: "14px 22px", borderRadius: 14, background: "rgba(8,12,22,0.86)", border: `2px solid ${asks.length ? "#fbbf24" : "#4ade80"}`, textAlign: "center", fontFamily: "Arial, sans-serif", pointerEvents: "none" }}>
                {feed.filter((x) => Date.now() - x.at < 3000).slice(0, 3).map((x) => (
                  <div key={x.id} style={{ fontSize: x.kind === "note" ? 18 : 26, fontWeight: 900, color: x.kind === "note" ? "#f6c66b" : x.kind === "remove" ? "#ff8a80" : x.kind === "already" ? "#9fb0c8" : "#4ade80" }}>
                    {x.kind === "note" ? x.text : <>{x.kind === "remove" ? "✕ " : "✓ "}{x.name}{x.kind === "already" ? " (already on)" : x.kind === "remove" ? " removed" : ""}{x.extra && <span style={{ color: "#fbbf24" }}> · {x.extra}</span>}</>}
                  </div>
                ))}
                {asks[0] && (
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: "#fbbf24" }}>Who&apos;s “{asks[0].phrase}”?</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: "#e8edf5" }}>
                      {asks[0].options.map((key, i) => { const p = personOf(key) || {}; return `${["First", "Second", "Third"][i]}: ${p.name || key}${p.jersey != null ? ` #${p.jersey}` : ""}`; }).join(" · ")}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#9fb0c8" }}>Say the name, “first” / “second”, his number — or “skip”</div>
                  </div>
                )}
              </div>
            ) : null}
            fsBar={(
              <>
                <button type="button" style={btn(true)} onClick={() => api.current?.toggle()}>▶ / ❚❚</button>
                <button type="button" style={{ ...btn(inPt != null), ...(inPt != null ? { background: UI_GOLD, borderColor: UI_GOLD, color: "#1d1405" } : {}) }} onClick={razor}>✂ {inPt != null ? `Snip the end (from ${clock(inPt)})` : "Razor"} · C</button>
                <span style={{ fontSize: 13, fontWeight: 900, color: "#e8edf5", fontVariantNumeric: "tabular-nums" }}>{clock(t)}</span>
                {hot && <span style={{ fontSize: 12, fontWeight: 900, color: UI_GOLD }}>🔥 {clock(hot.in)}–{clock(hot.out)}</span>}
                {hot && focus.map((p, i) => <button key={p.key} type="button" style={chip(hot.playerIds.includes(p.key))} onClick={() => toggleTag(p)}>{i + 1} · {p.name}</button>)}
              </>
            )} />
          <div className="wd-fs-dock" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
          <ScrubRow apiRef={api} min={0} max={dur || Math.max(t, 1)} t={t} motion={motion} ticks={plays.map((p) => ({ id: p.id, in: p.in, out: p.out, hot: p.id === hot?.id }))}
            onClicks={(dir, n) => { if (n === 2 || n === 3) api.current?.nudge(5 * dir); }} prevTitle="Hold: play backwards fast · double-click: back 5s · triple: 10s" nextTitle="Hold: fast forward · double-click: ahead 5s · triple: 10s" label={`${clock(t)} / ${clock(dur)}`} />
          <Timeline apiRef={api} plays={plays} hotId={hot?.id} pendingIn={inPt} onTrim={trimPlay} onSelect={(p) => setHot(p)} />
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={btn(true)} onClick={() => api.current?.toggle()}>▶ / ❚❚</button>
            <button type="button" onClick={razor} style={{ ...btn(inPt != null), ...(inPt != null ? { background: UI_GOLD, borderColor: UI_GOLD, color: "#1d1405" } : {}), width: 300, ...ellipsis(), textAlign: "left" }}>
              ✂ {inPt != null ? `Snip the end · started ${clock(inPt)}` : "Razor · start a play"} <span style={{ opacity: 0.7 }}>({snipName(snipKey)})</span>
            </button>
            <button type="button" style={{ ...mini, visibility: inPt != null ? "visible" : "hidden" }} onClick={() => { setInPt(null); setMsg(""); }}>Cancel</button>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, fontWeight: 800, color: "#8494ad" }}>Snip key
              <select value={["c", "1", "F13", "F14", "F15", "mouse4", "mouse5"].includes(snipKey) ? snipKey : "custom"} onChange={(e) => { if (e.target.value !== "custom") setSnipKey(e.target.value); e.target.blur(); }} style={{ ...field, padding: "3px 6px", fontSize: 11 }}>
                {!["c", "1", "F13", "F14", "F15", "mouse4", "mouse5"].includes(snipKey) && <option value="custom">{snipName(snipKey)}</option>}
                <option value="c">C (and Ctrl+K)</option>
                <option value="1">1 (focus → Shift+1–9)</option>
                <option value="F13">F13</option>
                <option value="F14">F14</option>
                <option value="F15">F15</option>
                <option value="mouse4">Mouse side button (back)</option>
                <option value="mouse5">Mouse side button (forward)</option>
              </select>
              <button type="button" style={{ ...mini, ...(learning ? { background: UI_GOLD, borderColor: UI_GOLD, color: "#1d1405" } : {}) }} onClick={(e) => { e.currentTarget.blur(); setLearning((x) => !x); }}>{learning ? "Press the key / button now… (Esc)" : "Set by pressing it"}</button>
            </label>
            <button type="button" style={{ ...btn(mic), ...(listening ? { background: "#b42318", borderColor: "#ff6b5b" } : {}) }} onClick={() => setMic((x) => !x)} title="Turn the mic on or off whenever — names, labels, traits go on the hot play (V)">🎙 Mic {mic ? (listening ? "● live" : "on") : "off"} (V)</button>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, fontWeight: 800, color: "#8494ad", cursor: "pointer" }} title="The mic goes live by itself each time a play goes hot"><input type="checkbox" checked={voiceOn} onChange={(e) => { setVoiceOn(e.target.checked); e.target.blur(); }} />Mic on hot plays</label>
            <button type="button" style={btn(!!hot)} onClick={hotHere} title="The play here goes hot — again: done with it">🔥 Hot (Z)</button>
            <button type="button" style={btn(false)} onClick={wipe} title="Clear the hot play, a started cut, and what voice heard — saved plays stay">Wipe (X)</button>
            <span style={{ fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{clock(t)}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>1 razor · Q hold = cut while held (tap = razor) · Z hot · X wipe · 4 or Space play · hold ←/→ or A/D fast motion (double tap 5s, triple 10s) · ↑/↓ or W/S 5s · , . frame{snipKey !== "1" ? ` · ${snipName(snipKey)} razor` : ""} · [ ] hot play starts / ends here · Shift+1–9 tag · V mic on / off · Delete twice: delete the hot play · F full screen · Esc</span>
          </div>
          <div style={ellipsis({ fontSize: 13, fontWeight: 800, height: 18, lineHeight: "18px" })} title={msg}>{msg || "\u00a0"}</div>
          </div>
          <div className="wd-fs-hide" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>

          {hot && (
            <div style={{ ...box, borderColor: UI_GOLD, background: "#2a2312" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ ...head, color: "#f6c66b", flex: 1 }}>🔥 Hot play · {clock(hot.in)}–{clock(hot.out)} ({(hot.out - hot.in).toFixed(1)}s)</div>
                <button type="button" style={mini} onClick={() => api.current?.seek(hot.in)}>Replay</button>
                <button type="button" style={mini} onClick={() => setHot(null)}>Done (Z)</button>
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                {[["in", "Starts"], ["out", "Ends"]].map(([edge, label]) => (
                  <div key={edge} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: "#f6c66b", minWidth: 44 }}>{label}</span>
                    <button type="button" style={mini} onClick={() => nudgeHot(edge, -1)}>−1s</button>
                    <button type="button" style={mini} onClick={() => nudgeHot(edge, -1 / 30)}>−1f</button>
                    <button type="button" style={{ ...mini, minWidth: 64, fontVariantNumeric: "tabular-nums" }} onClick={() => api.current?.seek(hot[edge])} title="Jump there">{clock(hot[edge])}</button>
                    <button type="button" style={mini} onClick={() => nudgeHot(edge, 1 / 30)}>+1f</button>
                    <button type="button" style={mini} onClick={() => nudgeHot(edge, 1)}>+1s</button>
                    <button type="button" style={mini} onClick={() => hotEdgeHere(edge)} title={edge === "in" ? "Start at the playhead ( [ )" : "End at the playhead ( ] )"}>{edge === "in" ? "[ here" : "] here"}</button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {focus.map((p, i) => <button key={p.key} type="button" style={{ ...chip(hot.playerIds.includes(p.key)), ...((flash[p.key] || 0) > Date.now() ? { background: "#15803d", borderColor: "#4ade80", boxShadow: "0 0 0 3px rgba(74,222,128,0.35)" } : {}) }} onClick={() => toggleTag(p)}>{i + 1} · {p.name}{hot.players?.[p.key]?.label ? ` · ${hot.players[p.key].label}` : ""}{hot.players?.[p.key]?.traits?.length ? ` · ${hot.players[p.key].traits.length} trait${hot.players[p.key].traits.length === 1 ? "" : "s"}` : ""}{(flash[p.key] || 0) > Date.now() ? " 🎙" : ""}</button>)}
                {hot.playerIds.filter((k) => !focus.some((f) => f.key === k)).map((k) => <button key={k} type="button" style={{ ...chip(true, "#9fb0c8"), ...((flash[k] || 0) > Date.now() ? { background: "#15803d", borderColor: "#4ade80", boxShadow: "0 0 0 3px rgba(74,222,128,0.35)" } : {}) }} onClick={() => toggleTag({ key: k })}>{hot.players[k]?.name}{(flash[k] || 0) > Date.now() ? " 🎙" : ""} ✕</button>)}
              </div>
              {voiceOn && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "6px 8px", borderRadius: 8, background: listening ? "#3a2a0c" : "#1b2538" }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: listening ? "#ff6b5b" : "#8494ad" }}>{listening ? `● Listening — names, then a label and traits (“Kromah great vision”)${focus.length === 1 ? ` · just “good” = ${focus[0].name}` : ""}` : mic ? "🎙 Mic starting…" : "🎙 Mic off"}</span>
                  <button type="button" style={mini} onClick={() => setMic((x) => !x)}>{mic ? "Mic off (V)" : "Mic on (V)"}</button>
                  {interim && <span style={{ fontSize: 12, fontStyle: "italic", color: "#e8edf5" }}>“{interim}”</span>}
                  {hearing.map((n) => <span key={n} style={{ border: "1px dashed #9fb0c8", color: "#d7e1ef", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>{n}?</span>)}
                  {feed.length > 0 && (
                    <div style={{ flexBasis: "100%", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: "#8494ad" }}>VOICE ADDED</span>
                      {feed.map((x, i) => (
                        <span key={x.id} style={{ fontSize: 12, fontWeight: 900, opacity: i === 0 ? 1 : 0.7, color: x.kind === "add" || x.kind === "set" ? "#4ade80" : x.kind === "remove" ? "#ff8a80" : "#9fb0c8" }}>
                          {x.kind === "add" || x.kind === "set" ? "✓ " : x.kind === "remove" ? "✕ " : "· "}{x.name}{x.kind === "already" ? " (already on)" : x.kind === "remove" ? " removed" : ""}{x.extra ? ` · ${x.extra}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {heard.map((h, i) => (h.key ? (
                    <span key={i} style={{ ...chip(true, h.how.startsWith("name") || h.how.includes("watching") ? "#15803d" : "#2f86d6"), padding: "1px 8px", fontSize: 11 }} title={`heard “${h.phrase}” (${h.how})`}>“{h.phrase}” → {(pool.find((p) => p.key === h.key) || focus.find((p) => p.key === h.key))?.name || h.key}{h.value ? `: ${h.value}` : ""}</span>
                  ) : (
                    <span key={i} style={{ ...chip(false), padding: "1px 8px", fontSize: 11, borderColor: "#b7791f", color: "#f6c66b" }}>“{h.phrase}” · {h.how}</span>
                  )))}
                </div>
              )}
              {asks.map((a, ai) => (
                <div key={a.id} style={{ display: "grid", gap: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid #b7791f", background: ai === 0 ? "#3a2a0c" : "#241c0c" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 900, color: "#fbbf24", flex: 1 }}>Who&apos;s “{a.phrase}”? Say it — the name, “first” / “second”, or “skip”{a.how === "which one?" ? " (more than one fits)" : a.how === "several wear it" ? " (more than one wears it)" : ""}</span>
                    <button type="button" style={mini} onClick={() => setAsks((x) => x.filter((y) => y.id !== a.id))}>Skip</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {a.options.map((key) => {
                      const p = personOf(key) || {};
                      const watching = focus.some((x) => x.key === key);
                      return (
                        <button key={key} type="button" onClick={() => teachHeard(a.phrase, key)} style={{ ...chip(false), borderColor: watching ? UI_GOLD : "#334058", padding: "3px 10px" }}>
                          {watching ? "★ " : ""}{p.name || key}{p.jersey != null ? ` #${p.jersey}` : ""} <span style={{ color: "#8494ad", fontWeight: 700 }}>{p.pos} · {p.team}</span>
                        </button>
                      );
                    })}
                  </div>
                  <PersonPicker pool={gamePeople} onPick={(p) => teachHeard(a.phrase, p.key)} placeholder="Someone else in this game…" />
                  {!a.phrase.startsWith("#") && <div style={{ fontSize: 10, fontWeight: 700, color: "#8494ad" }}>Picking teaches it: next time “{a.phrase}” means him.</div>}
                </div>
              ))}
              <PersonPicker pool={gamePeople} onPick={(p) => toggleTag(p)} exclude={hot.playerIds} placeholder="Tag anyone else on the two rosters…" />
            </div>
          )}

          <div style={box}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...head, flex: 1 }}>Plays in this game · {plays.length}</div>
              {plays.some((p) => p.playerIds?.length) && <button type="button" style={{ ...btn(true), background: UI_GOLD, borderColor: UI_GOLD, color: "#00264d" }} onClick={() => onReview(game, plays)}>✓ Finish game · review players</button>}
            </div>
            {plays.map((p) => (
              <div key={p.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 800, padding: "3px 4px", borderRadius: 6, background: hot?.id === p.id ? "#2a2312" : "transparent" }}>
                <button type="button" style={{ ...mini, border: "none", color: "#6fb1ff" }} onClick={() => { setHot(p); api.current?.seek(p.in); }}>▶ {clock(p.in)}</button>
                <span style={{ color: "#8494ad" }}>{(p.out - p.in).toFixed(1)}s{p.source === "premiere" ? " · Premiere" : ""}</span>
                <span style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {Object.values(p.players || {}).map((x) => <button key={x.key} type="button" onClick={() => openPlayer(x)} title="Open his plays" style={{ ...chip(false), padding: "1px 7px", fontSize: 11, borderColor: x.label ? LABEL_COLORS[x.label] : "#334058" }}>{x.name}{x.label ? ` · ${x.label}` : ""}</button>)}
                </span>
                <button type="button" style={{ ...mini, color: armed === p.id ? "#fff" : "#ff7a6b", ...(armed === p.id ? { background: "#b42318", borderColor: "#b42318" } : {}) }} onClick={() => remove(p)} title="Delete this play (click twice)">{armed === p.id ? "Delete? ✕" : "✕"}</button>
              </div>
            ))}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Players ──
// A tag's progress on the review checklist: marked, labeled, traits, washed.
const doneOf = (tg) => ({ mark: !!tg.spot, label: !!tg.label, traits: !!tg.traits?.length, wash: !!tg.wash?.keys?.length });

// ── After a game (user, 2026-11-25): every player clipped in it, his plays
// from that game one by one — mark, label, traits, wash. Optional; anything
// left can be done later from the Players tab. ──
function ReviewStrip({ review, who, setWho, gamePlays }) {
  if (!review) return null;
  return (
    <div style={{ ...box, borderColor: UI_GOLD, background: "#1d1a10" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...head, color: UI_GOLD, flex: 1 }}>Tagging · {gameTitle(review.game)} · player {Math.max(1, review.people.findIndex((p) => p.key === who?.key) + 1)} of {review.people.length} · past his last play, the next player opens</div>
        {review.people.findIndex((p) => p.key === who?.key) < review.people.length - 1 && <button type="button" style={btn(true)} onClick={() => setWho(review.people[review.people.findIndex((p) => p.key === who?.key) + 1])}>Next player →</button>}
        <button type="button" style={mini} onClick={review.close}>Done reviewing</button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {review.people.map((p) => {
          const mine = (gamePlays || []).filter((x) => x.playerIds?.includes(p.key));
          const n = mine.length;
          const c = { mark: 0, label: 0, traits: 0, wash: 0 };
          mine.forEach((x) => { const d = doneOf(x.players[p.key] || {}); Object.keys(c).forEach((k) => { if (d[k]) c[k] += 1; }); });
          const all = n && c.mark === n && c.label === n && c.traits === n && c.wash === n;
          return (
            <button key={p.key} type="button" onClick={() => setWho(p)} title={`marked ${c.mark}/${n} · labeled ${c.label}/${n} · traits ${c.traits}/${n} · washed ${c.wash}/${n}`}
              style={{ ...chip(who?.key === p.key), display: "grid", gap: 1, textAlign: "left", borderRadius: 8, padding: "4px 9px" }}>
              <span>{all ? "✓ " : ""}{p.name} <span style={{ opacity: 0.7 }}>{p.pos}</span></span>
              <span style={{ fontSize: 10, opacity: 0.85 }}>{n} plays · marked {c.mark} · labeled {c.label} · traits {c.traits} · washed {c.wash}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlayersTab({ games, fileFor, gate, wdPeople, filmPool, who, setWho, review }) {
  const [plays, setPlays] = useState(null);
  const [labelF, setLabelF] = useState("all");
  const [circleF, setCircleF] = useState("any");
  const [gameF, setGameF] = useState("");
  const [cur, setCur] = useState(null);
  const [file, setFile] = useState(null);
  // Watching: the original plays or their washed versions (a play without one shows the original).
  const [view, setView] = useState(() => { try { return localStorage.getItem("wd.film.view") || "original"; } catch { return "original"; } });
  useEffect(() => { try { localStorage.setItem("wd.film.view", view); } catch { /* private window */ } }, [view]);
  // The wash editor (zoom / pan / keyframes) — the wash is a version, never the play itself.
  const [washing, setWashing] = useState(false);
  const [traitF, setTraitF] = useState("");
  const [washF, setWashF] = useState("any");
  const [traits, setTraits] = useState({ position: [], generic: [] });
  const [gamePlays, setGamePlays] = useState(null);
  // The mark tool: click places (a circle's middle / an arrow's tip), scroll sizes (user, 2026-11-25).
  const [tool, setTool] = useState(null);
  const sizeSave = useRef(null);
  // Watch all (user, 2026-11-25): every play in the list, one after another,
  // full screen — just the film (washed where there's a wash), no controls.
  const [watchAll, setWatchAll] = useState(false);
  const autoOpen = useRef(false);
  const [t, setT] = useState(0);
  const [msg, setMsg] = useState("");
  const api = useRef(null);
  const stageRef = useRef(null);
  const recent = useMemo(() => { try { return JSON.parse(localStorage.getItem("wd.film.recent") || "[]"); } catch { return []; } }, [who]); // eslint-disable-line react-hooks/exhaustive-deps
  const pool = useMemo(() => { const m = new Map(); [...recent, ...filmPool.map((p) => ({ ...p, film: true })), ...games.flatMap((g) => g.focus || []), ...wdPeople].forEach((p) => { if (p?.key && !m.has(p.key)) m.set(p.key, p); }); return [...m.values()]; }, [recent, games, wdPeople, filmPool]);

  useEffect(() => {
    if (!who) return;
    try { localStorage.setItem("wd.film.recent", JSON.stringify([who, ...recent.filter((r) => r.key !== who.key)].slice(0, 20))); } catch { /* private window */ }
    setPlays(null); setCur(null);
    // Clicking a player opens his first play (user, 2026-11-25).
    playsForPlayer(who.key).then((ps) => { autoOpen.current = true; setPlays(ps); }).catch((e) => setMsg(e.message));
    traitsFor(who.pos).then(setTraits);
  }, [who?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reviewing a game: its plays (for everyone's progress), and his list on that game.
  useEffect(() => {
    if (!review) { setGamePlays(null); return; }
    setGameF(review.game.id);
    playsForGame(review.game.id).then(setGamePlays).catch(() => {});
  }, [review?.game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagOf = (p) => p?.players?.[who?.key] || {};
  const list = (plays || []).filter((p) => {
    const tg = tagOf(p);
    if (labelF === "untagged" && tg.label) return false;
    if (labelF !== "all" && labelF !== "untagged" && tg.label !== labelF) return false;
    if (circleF === "yes" && !tg.spot) return false;
    if (circleF === "no" && tg.spot) return false;
    if (washF === "yes" && !tg.wash?.keys?.length) return false;
    if (washF === "no" && tg.wash?.keys?.length) return false;
    if (traitF && !(tg.traits || []).includes(traitF)) return false;
    return !gameF || p.gameId === gameF;
  }).sort((a, b) => { const ga = games.find((g) => g.id === a.gameId); const gb = games.find((g) => g.id === b.gameId); return String(ga?.date || ga?.season || "").localeCompare(String(gb?.date || gb?.season || "")) || a.in - b.in; });
  const open = async (p) => {
    setCur(p); setWashing(false); setTool(null);
    const g = games.find((x) => x.id === p.gameId) || { id: p.gameId, file: p.file };
    if (file?.name !== p.file) setFile(await fileFor(g).catch(() => null));
  };
  const curTag = tagOf(cur);
  // Shown at once, saved behind it (a mark or label shouldn't wait on the network).
  const setTag = async (patch) => {
    if (!cur) return;
    editTag(cur, who.key, patch).catch((e) => setMsg(e.message));
    const next = { ...cur, players: { ...cur.players, [who.key]: { ...curTag, ...patch } } };
    setCur(next);
    setPlays((ps) => ps.map((x) => (x.id === next.id ? next : x)));
    setGamePlays((gp) => (gp ? gp.map((x) => (x.id === next.id ? { ...x, players: { ...x.players, [who.key]: next.players[who.key] } } : x)) : gp));
  };
  // ── Voice (user, 2026-11-25): while his clips play, say the label and
  // traits — "great", "good vision", "bad tackling" — and they go on the clip
  // that's open right then. The mic stays on until you turn it off. Only his
  // position + generic traits are matched (utils/film/voice.js parseVoice). ──
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem("wd.film.voicePlayers") === "on"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("wd.film.voicePlayers", voiceOn ? "on" : "off"); } catch { /* private window */ } }, [voiceOn]);
  const [interim, setInterim] = useState("");
  const [washHeld, setWashHeld] = useState(false); // the mouse held on the film, setting the wash
  const [said, setSaid] = useState(null); // { text, who, at } — the last thing put on a clip
  const vLive = useRef({});
  vLive.current = { setTag, cur, curTag, who, traitList: [...traits.position, ...traits.generic], voiceOn };
  // What he said → this clip (user, 2026-11-25): "good instincts" = label Good
  // (replacing the one there — Neutral → Good) + the trait added to the ones
  // there; "remove vision" / "not patience" takes a trait off; "no label" clears it.
  const heardOn = (text) => {
    const L = vLive.current;
    if (!L.cur || !L.who) return;
    const me = { ...L.who, focus: true };
    const opts = { traitsOf: () => L.traitList, sole: me.key, current: me.key };
    const clear = /\b(no label|clear label|unlabel)\b/i.test(text);
    const rm = clear ? null : /\b(remove|not|take off|minus|delete)\b/i.exec(text);
    const out = parseVoice(rm ? text.slice(0, rm.index) : text, [me], {}, opts);
    const drop = rm ? parseVoice(text.slice(rm.index + rm[0].length), [me], {}, opts).traits[me.key] || [] : [];
    const label = out.labels[me.key];
    const add = (out.traits[me.key] || []).filter((x) => !drop.includes(x));
    if (!label && !add.length && !drop.length && !clear) { setSaid({ text: `“${text.trim()}” — no label or trait heard`, miss: true, at: Date.now() }); return; }
    const was = L.curTag.label || "";
    const patch = {};
    if (label) patch.label = label; else if (clear) patch.label = "";
    if (add.length || drop.length) patch.traits = [...new Set([...(L.curTag.traits || []).filter((x) => !drop.includes(x)), ...add])];
    L.setTag(patch);
    setSaid({ text: [label ? (was && was !== label ? `${was} → ${label}` : label) : clear ? "No label" : "", ...add.map((x) => `+ ${x}`), ...drop.map((x) => `− ${x}`)].filter(Boolean).join(" · "), who: L.who.name, at: Date.now() });
  };
  const { listening } = useSpeech(voiceOn && !!who && !watchAll, { onFinal: heardOn, onInterim: setInterim, onBlocked: (m) => { setMsg(m); setVoiceOn(false); } });
  const saidFresh = said && Date.now() - said.at < 3000;
  useEffect(() => { if (!said) return undefined; const id = setTimeout(() => setSaid((x) => (x === said ? { ...x } : x)), 3100); return () => clearTimeout(id); }, [said]);
  // On the film, always: what this play is tagged with — or that it has none.
  const voiceOverlay = watchAll ? null : washHeld ? (
    <div style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(8,12,22,0.85)", border: "2px solid #ff3b30", color: "#ff6b5b", fontWeight: 900, fontSize: 14, fontFamily: "Arial, sans-serif" }}>● SETTING THE WASH — drag to pan · scroll to zoom · let go to save</div>
  ) : (
    <div style={{ display: "grid", gap: 3, padding: "7px 11px", borderRadius: 10, background: "rgba(8,12,22,0.78)", border: `2px solid ${listening ? "#ff6b5b" : "#334058"}`, fontFamily: "Arial, sans-serif" }}>
      <div style={{ fontSize: 15, fontWeight: 900, color: curTag.label ? LABEL_COLORS[curTag.label] : "#9fb0c8" }}>{curTag.label || "No label"}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: curTag.traits?.length ? "#d7e1ef" : "#8494ad" }}>{curTag.traits?.length ? curTag.traits.join(" · ") : "No traits"}</div>
      {listening && <div style={{ fontSize: 12, fontWeight: 900, color: "#ff6b5b" }}>● Listening{interim ? ` — “${interim}”` : " — say a label and traits (Q stops)"}</div>}
    </div>
  );
  const voiceCenter = saidFresh && !watchAll ? (
    <div style={{ display: "grid", gap: 2, justifyItems: "center", padding: "14px 22px", borderRadius: 14, background: "rgba(8,12,22,0.86)", border: `2px solid ${said.miss ? "#f6c66b" : "#4ade80"}`, textAlign: "center", fontFamily: "Arial, sans-serif", pointerEvents: "none" }}>
      <div style={{ fontSize: said.miss ? 18 : 26, fontWeight: 900, color: said.miss ? "#f6c66b" : "#4ade80" }}>{said.miss ? said.text : `✓ ${said.text}`}</div>
      {!said.miss && <div style={{ fontSize: 13, fontWeight: 800, color: "#9fb0c8" }}>{said.who}</div>}
    </div>
  ) : null;

  // ◀ / ▶ held = fast motion through the play; double-click = last / next play (Scrub.jsx).
  // Slower than Cut's (user, 2026-11-25: cover less ground in a play).
  const motion = useFastMotion(api, 2);
  const taps = useRef(null); // A/D/←/→ — a double tap is the last / next play
  useEffect(() => {
    const up = (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight" || /^[aAdD]$/.test(e.key)) motion.end(); };
    window.addEventListener("keyup", up);
    const lost = () => { motion.end(); if (holdRef.current) washHold(false); };
    window.addEventListener("blur", lost);
    return () => { window.removeEventListener("keyup", up); window.removeEventListener("blur", lost); };
  });

  // His cut of the play (user, 2026-11-25): the same play can start sooner or
  // end later for one player — tag.trim { in, out }; the play itself is unchanged.
  const rangeOf = (p, tg = tagOf(p)) => ({ in: tg.trim?.in ?? p.in, out: tg.trim?.out ?? p.out });
  const curRange = cur ? rangeOf(cur, curTag) : null;
  const trimMine = (edge, value) => {
    const r = { ...curRange, [edge]: Math.round(Math.max(0, value) * 100) / 100 };
    if (r.out - r.in < 0.3) return;
    setTag({ trim: Math.abs(r.in - cur.in) < 0.01 && Math.abs(r.out - cur.out) < 0.01 ? null : r });
  };
  const toggleTrait = (name) => {
    const has = (curTag.traits || []).includes(name);
    setTag({ traits: has ? curTag.traits.filter((x) => x !== name) : [...(curTag.traits || []), name] });
  };
  // A mark's kind: its own, else the Premiere mark it came from.
  const markOf = (tg) => (tg.spot ? { ...tg.spot, kind: tg.spot.kind || (tg.legacy?.mark === "arrow" ? "arrow" : "circle") } : null);
  const placeMark = (x, y, tm) => {
    const old = markOf(curTag);
    const size = old && old.kind === tool ? old.size || MARK_SIZES[tool] : MARK_SIZES[tool];
    setTag({ spot: { t: Math.round(tm * 100) / 100, x, y, kind: tool, size } });
  };
  // Marks without picking a tool (user, 2026-11-25): double-click = circle, triple = arrow, at that moment.
  const quickMark = (kind, x, y, tm) => {
    const old = markOf(curTag);
    const size = old && old.kind === kind ? old.size || MARK_SIZES[kind] : MARK_SIZES[kind];
    setTag({ spot: { t: Math.round(tm * 100) / 100, x, y, kind, size } });
  };
  // Dragged somewhere new: same moment, same size.
  const moveMark = (x, y) => { const m = markOf(curTag); if (m) setTag({ spot: { ...m, x, y } }); };
  // Scroll: the size, shown at once and saved when the wheel stops.
  const sizeMark = (factor) => {
    const m = markOf(curTag);
    if (!m || !cur) return;
    const spot = { ...m, size: Math.max(0.015, Math.min(0.35, (m.size || MARK_SIZES[m.kind]) * factor)) };
    const next = { ...cur, players: { ...cur.players, [who.key]: { ...curTag, spot } } };
    setCur(next);
    setPlays((ps) => ps.map((x) => (x.id === next.id ? next : x)));
    clearTimeout(sizeSave.current);
    sizeSave.current = setTimeout(() => editTag(next, who.key, { spot }).catch((e) => setMsg(e.message)), 400);
  };
  const pickTool = (k) => { setWashing(false); setTool((x) => (x === k ? null : k)); };
  // The next / last play; past his last: Watch all ends, a review moves on to the next player.
  const go = (d) => {
    const i = list.findIndex((x) => x.id === cur?.id);
    const n = list[i + d];
    if (n) { open(n); return; }
    if (d < 0) return;
    if (watchAll) { endWatch(); return; }
    if (review) {
      const j = review.people.findIndex((x) => x.key === who?.key);
      const nx = review.people[j + 1];
      if (nx) { setWho(nx); setMsg(`Next up: ${nx.name}`); } else setMsg("That's everyone in this game — Done reviewing when you're set.");
    }
  };
  const startWatch = () => {
    if (!list.length) return;
    setWatchAll(true); setTool(null); setWashing(false);
    api.current?.fullscreen(true); // in the click: Chrome only goes full screen on a gesture
    if (cur?.id !== list[0].id) open(list[0]); else api.current?.seek(curRange.in);
  };
  const endWatch = () => { setWatchAll(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  useEffect(() => { const on = () => { if (!document.fullscreenElement) setWatchAll(false); }; document.addEventListener("fullscreenchange", on); return () => document.removeEventListener("fullscreenchange", on); }, []);
  // A player just picked: his first play opens.
  useEffect(() => { if (autoOpen.current && plays && who) { autoOpen.current = false; if (list.length) open(list[0]); } }, [plays]); // eslint-disable-line react-hooks/exhaustive-deps
  // Setting the wash with the mouse (user, 2026-11-25) — no editor needed:
  // HOLD the click on the film and drag = pan, scroll = zoom. Paused: one
  // keyframe there. Playing: keyed as it goes (every ~0.1s it moves, every
  // 0.5s it holds still). Let go and it's saved — in place of the old keys over
  // that stretch — and the washed version shows. A plain click saves nothing.
  const holdRef = useRef(null);
  const sameView = (a, b) => Math.abs(a.x - b.x) <= 0.002 && Math.abs(a.y - b.y) <= 0.002 && Math.abs(a.z - b.z) <= 0.01;
  const washHold = (down) => {
    const a = api.current;
    if (down) {
      if (!a || holdRef.current || !cur) return;
      const v0 = a.view();
      const rec = { keys: [], v0, moved: false };
      rec.timer = setInterval(() => {
        const v = a.view();
        if (!v) return;
        if (!rec.moved && !sameView(v, v0)) { rec.moved = true; setWashHeld(true); }
        if (!rec.moved || a.paused()) return;
        const tm = Math.round(a.time() * 100) / 100;
        const last = rec.keys[rec.keys.length - 1];
        if (last && Math.abs(tm - last.t) < 0.08) { if (!sameView(v, last)) Object.assign(last, { x: v.x, y: v.y, z: v.z }); return; }
        if (!last || !sameView(v, last) || tm - last.t >= 0.5 || tm < last.t) rec.keys.push({ t: tm, x: v.x, y: v.y, z: v.z });
      }, 100);
      holdRef.current = rec;
      return;
    }
    const rec = holdRef.current;
    holdRef.current = null;
    setWashHeld(false);
    if (!rec || !a) return;
    clearInterval(rec.timer);
    const v = a.view();
    if (!v || (!rec.moved && sameView(v, rec.v0))) return; // just a click
    const tEnd = Math.round(a.time() * 100) / 100;
    if (!rec.keys.some((k) => Math.abs(k.t - tEnd) < 0.08)) rec.keys.push({ t: tEnd, x: v.x, y: v.y, z: v.z });
    const lo = Math.min(...rec.keys.map((k) => k.t)) - 0.05;
    const hi = Math.max(...rec.keys.map((k) => k.t)) + 0.05;
    const keys = [...(vLive.current.curTag.wash?.keys || []).filter((k) => k.t < lo || k.t > hi), ...rec.keys].sort((x, y) => x.t - y.t);
    a.setDraft(null);
    vLive.current.setTag({ wash: { keys } });
    setView("washed");
  };
  useEffect(() => () => clearInterval(holdRef.current?.timer), []);

  // A keyframe here from what's on screen — saved at once (washes save themselves, user 2026-11-25).
  const addKey = () => {
    const a = api.current;
    const v = a?.view();
    if (!v) return;
    const tm = a.time();
    const keys = (vLive.current.curTag.wash?.keys || []).filter((k) => Math.abs(k.t - tm) > 0.1);
    keys.push({ t: Math.round(tm * 100) / 100, x: v.x, y: v.y, z: v.z });
    keys.sort((x, y) => x.t - y.t);
    a.setDraft(null);
    vLive.current.setTag({ wash: { keys } });
  };
  // The wash editor's scroll (no click held): saved a moment after the wheel stops.
  const editSave = useRef(null);
  // Scrolling anywhere on the film (user, 2026-11-25): straight into the wash —
  // it zooms, the washed version shows, and a keyframe is saved here.
  const washEdited = () => {
    if (view !== "washed") setView("washed");
    clearTimeout(editSave.current);
    editSave.current = setTimeout(() => { if (api.current?.draft()) addKey(); }, 450);
  };
  useEffect(() => () => clearTimeout(editSave.current), []);

  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || !cur || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const a = api.current;
      if (k === " ") { e.preventDefault(); a?.toggle(); } else if (/^[1-6]$/.test(k)) setTag({ label: LABELS[Number(k) - 1] });
      else if (k === "0") setTag({ label: "" });
      else if (k === "n" || k === "N") go(1); else if (k === "p" || k === "P") go(-1);
      // ←/→ and A/D (user, 2026-11-25: WASD like the arrows): hold = fast
      // motion; a double tap = the last / next play. ↑/↓ and W/S: next / last play.
      else if (k === "ArrowLeft" || k === "ArrowRight" || /^[aAdD]$/.test(k)) {
        e.preventDefault();
        if (e.repeat) return;
        const dir = k === "ArrowLeft" || k === "a" || k === "A" ? -1 : 1;
        const now = performance.now();
        const tp = taps.current;
        taps.current = tp && tp.dir === dir && now - tp.at < 320 ? { dir, at: now, n: tp.n + 1 } : { dir, at: now, n: 1 };
        if (taps.current.n === 2) { motion.end(); go(dir); } else motion.start(dir);
      }
      // ↑ / ↓: the circle / arrow bigger / smaller (user, 2026-11-25 — the wheel washes now).
      else if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); if (curTag.spot) sizeMark(k === "ArrowUp" ? 1.08 : 1 / 1.08); }
      else if (k === "w" || k === "W") go(1); else if (k === "s" || k === "S") go(-1);
      // Q: voice on / off (user, 2026-11-25) — say a label and traits for this clip.
      else if (k === "q" || k === "Q" || k === "m" || k === "M") { if (!e.repeat) setVoiceOn((x) => !x); }
      else if (k === "c" || k === "C") pickTool("circle"); else if (k === "r" || k === "R") pickTool("arrow");
      else if (k === "e" || k === "E") { setTool(null); setWashing((x) => !x); }
      else if (k === "v" || k === "V") setView((x) => (x === "washed" ? "original" : "washed"));
      else if (k === ",") a?.step(-1); else if (k === ".") a?.step(1);
      else if (k === "Escape") { setTool(null); if (watchAll) endWatch(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const gameName = (id) => { const g = games.find((x) => x.id === id); return g ? gameTitle(g) : id; };
  // His play's row (user, 2026-11-25): just the opponent and season — "vs West Virginia 2026" / "at Texas 2025".
  const oppName = (id) => {
    const g = games.find((x) => x.id === id);
    if (!g) return id;
    const me = teamKey(who?.team);
    const home = g.home || g.offense;
    const away = g.away || g.defense;
    const atHome = teamKey(home) === me;
    const opp = atHome ? away : teamKey(away) === me ? home : teamKey(g.offense) === me ? g.defense : g.offense;
    return `${atHome || g.neutral || !g.home ? "vs" : "at"} ${cfbdTeam(opp) || "?"} ${g.season || ""}`.trim();
  };
  const counts = useMemo(() => { const c = { untagged: 0 }; (plays || []).forEach((p) => { const l = tagOf(p).label; if (l) c[l] = (c[l] || 0) + 1; else c.untagged += 1; }); return c; }, [plays, who?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const usedTraits = useMemo(() => [...new Set((plays || []).flatMap((p) => tagOf(p).traits || []))].sort(), [plays, who?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // What plays: the wash editor; or the washed version when watching washed and there is one.
  const washKeys = curTag.wash?.keys || [];
  const showWash = washing || (view === "washed" && washKeys.length > 0);

  return (
    <div ref={stageRef} className="wd-film-stage" style={{ ...stageStyle, display: "grid", gap: 12 }}>
    <ReviewStrip review={review} who={who} setWho={setWho} gamePlays={gamePlays} />
    <div className="wd-fs-grid" style={{ display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <div className="wd-fs-list" style={box}>
        <div style={head}>Player</div>
        <PersonPicker pool={pool} onPick={setWho} placeholder="Find a player…" />
        {who && <div style={{ fontSize: 15, fontWeight: 900 }}>{who.name} <span style={{ fontSize: 12, color: "#8494ad" }}>{who.pos} · {who.team}</span></div>}
        {who && plays && (
          <>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[["all", `All ${plays.length}`], ["untagged", `No label ${counts.untagged}`], ...LABELS.map((l) => [l, `${l} ${counts[l] || 0}`])].map(([k, l]) => (
                <button key={k} type="button" style={{ ...chip(labelF === k, LABEL_COLORS[k] || UI_BLUE), padding: "2px 8px", fontSize: 11 }} onClick={() => setLabelF(k)}>{l}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={washF} onChange={(e) => setWashF(e.target.value)} style={{ ...field, fontSize: 11, padding: "3px 6px", flex: 1 }}>
                <option value="any">Wash: any</option><option value="yes">Washed</option><option value="no">Not washed</option>
              </select>
              <select value={traitF} onChange={(e) => setTraitF(e.target.value)} style={{ ...field, fontSize: 11, padding: "3px 6px", flex: 1 }}>
                <option value="">Trait: any</option>
                {usedTraits.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={circleF} onChange={(e) => setCircleF(e.target.value)} style={{ ...field, fontSize: 11, padding: "3px 6px", flex: 1 }}>
                <option value="any">Mark: any</option><option value="yes">Marked</option><option value="no">Not marked</option>
              </select>
              <select value={gameF} onChange={(e) => setGameF(e.target.value)} style={{ ...field, fontSize: 11, padding: "3px 6px", flex: 1 }}>
                <option value="">Every game</option>
                {[...new Set(plays.map((p) => p.gameId))].map((id) => <option key={id} value={id}>{gameName(id)}</option>)}
              </select>
            </div>
            <div className="wd-fs-scroll" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 3, maxHeight: "calc(100vh - 320px)", minHeight: 240, overflowY: "auto", paddingRight: 2 }}>
              {list.map((p) => {
                const tg = tagOf(p);
                return (
                  <button key={p.id} type="button" onClick={() => open(p)} title={gameName(p.gameId)} style={{ display: "grid", gap: 2, minWidth: 0, textAlign: "left", color: "#e8edf5", border: "none", borderLeft: `4px solid ${tg.label ? LABEL_COLORS[tg.label] : "#334058"}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer", background: cur?.id === p.id ? "#1c3355" : "#172133", outline: cur?.id === p.id ? `1px solid ${UI_BLUE}` : "none" }}>
                    <div style={ellipsis({ fontSize: 12, fontWeight: 900 })}>{oppName(p.gameId)}</div>
                    <div style={ellipsis({ fontSize: 11, fontWeight: 700, color: "#8494ad" })}>{clock(rangeOf(p, tg).in)} · {(rangeOf(p, tg).out - rangeOf(p, tg).in).toFixed(1)}s{tg.trim ? " (his cut)" : ""} · {tg.label || "no label"}{tg.spot ? " · ◯" : ""}{tg.traits?.length ? ` · ${tg.traits.length} trait${tg.traits.length === 1 ? "" : "s"}` : ""}{tg.wash?.keys?.length ? " · washed" : ""}{tg.legacy?.animated || tg.legacy?.offFrame ? " · check mark" : ""}</div>
                  </button>
                );
              })}
              {!list.length && <div style={{ fontSize: 12, color: "#8494ad", fontWeight: 700 }}>No plays match.</div>}
            </div>
          </>
        )}
        {who && !plays && <div style={{ fontSize: 12, color: "#8494ad" }}>Loading…</div>}
      </div>

      {!cur ? <div style={{ ...box, color: "#8494ad", fontWeight: 700, padding: 40, textAlign: "center" }}>{who ? "Pick one of his plays on the left." : "Find a player to see his plays."}</div> : (
        <div className="wd-fs-main" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, minWidth: 0, position: "sticky", top: 12 }}>
          <FilmPlayer file={file} gate={gate} stageRef={stageRef} overlay={voiceOverlay} center={voiceCenter} autoPlay={watchAll || (!washing && !tool)} range={curRange} apiRef={api} mode={showWash ? "wash" : "original"} editWash={washing} washKeys={washKeys} onTime={(x) => setT(x)}
            spots={curTag.spot ? [{ ...markOf(curTag), color: UI_GOLD }] : []}
            markTool={watchAll ? null : tool} onMark={placeMark} onMarkSize={sizeMark} quickMarks={!watchAll} onQuickMark={quickMark} onMarkMove={moveMark}
            liveWash={!tool && !watchAll} wheelWash={!watchAll} onWashHold={washHold} onWashEdit={washEdited} onEnd={watchAll ? () => go(1) : undefined}
            fsBar={watchAll ? null : (
              <>
                <button type="button" style={mini} onClick={() => go(-1)}>← P</button>
                <button type="button" style={btn(true)} onClick={() => api.current?.toggle()}>▶ / ❚❚</button>
                <button type="button" style={mini} onClick={() => go(1)}>N →</button>
                <span style={{ fontSize: 13, fontWeight: 900, color: "#e8edf5", fontVariantNumeric: "tabular-nums" }}>{clock(t - cur.in)} / {clock(cur.out - cur.in)}</span>
                {LABELS.map((l, i) => <button key={l} type="button" style={chip(curTag.label === l, LABEL_COLORS[l])} onClick={() => setTag({ label: curTag.label === l ? "" : l })}>{i + 1} · {l}</button>)}
                <button type="button" style={btn(tool === "circle")} onClick={() => pickTool("circle")}>◯ C</button>
                <button type="button" style={btn(tool === "arrow")} onClick={() => pickTool("arrow")}>↓ R</button>
                <button type="button" style={btn(view === "washed")} onClick={() => setView((x) => (x === "washed" ? "original" : "washed"))}>{view === "washed" ? "Washed" : "Original"} V</button>
                <button type="button" style={btn(washing)} onClick={() => { setTool(null); setWashing((x) => !x); }}>Wash editor E</button>
                <button type="button" style={btn(voiceOn)} onClick={() => setVoiceOn((x) => !x)}>🎙 Q</button>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#8494ad" }}>{who.name}</span>
              </>
            )} />
          <div className="wd-fs-dock" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
          <ScrubRow apiRef={api} min={curRange.in} max={curRange.out} t={t} motion={motion} fine={0.5} onClicks={(dir, n) => { if (n === 2) go(dir); }} />
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={btn(true)} onClick={() => api.current?.toggle()}>▶ / ❚❚</button>
            <span style={{ fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{clock(t - curRange.in)} / {clock(curRange.out - curRange.in)}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: "#8494ad" }}>Watch</span>
            <button type="button" style={btn(view === "original")} onClick={() => setView("original")}>Original</button>
            <button type="button" style={btn(view === "washed")} onClick={() => setView("washed")} title={washKeys.length ? "" : "No washed version yet — shows the original"}>Washed{washKeys.length ? "" : " (none yet)"}</button>
            <button type="button" style={btn(washing)} onClick={() => { setWashing((x) => !x); setTool(null); }}>Wash editor (E)</button>
            <button type="button" style={{ ...btn(true), background: UI_GOLD, borderColor: UI_GOLD, color: "#00264d" }} onClick={startWatch} disabled={!list.length} title="Every play in the list, back to back, full screen — just the film (Esc to stop)">▶ Watch all {list.length}</button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 10px", borderRadius: 8, background: listening ? "#3a2a0c" : "#141c2b", border: "1px solid #263247" }}>
            <button type="button" style={btn(voiceOn)} onClick={() => setVoiceOn((x) => !x)} title="Say a label and traits while his clips play (Q)">🎙 Voice {voiceOn ? "on" : "off"} (Q)</button>
            <span style={{ fontSize: 12, fontWeight: 800, color: listening ? "#ff9b8f" : "#8494ad" }}>
              {listening ? "Listening — “good instincts” (a label replaces the old one, traits add on), “remove vision”, “no label”" : "Q: say a label and traits for this clip while it plays."}
            </span>
            {interim && <span style={{ fontSize: 12, fontStyle: "italic", color: "#e8edf5" }}>“{interim}”</span>}
            {saidFresh && <span style={{ fontSize: 12, fontWeight: 900, color: said.miss ? "#f6c66b" : "#4ade80" }}>{said.miss ? said.text : `✓ ${said.text}`}</span>}
          </div>
          </div>
          <div className="wd-fs-side wd-fs-tall" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
          <div style={box}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={head}>His cut</span>
              {[["in", "Starts"], ["out", "Ends"]].map(([edge, label]) => (
                <div key={edge} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 900, color: "#9fb0c8" }}>{label}</span>
                  <button type="button" style={mini} onClick={() => trimMine(edge, curRange[edge] - 1)}>−1s</button>
                  <button type="button" style={mini} onClick={() => trimMine(edge, curRange[edge] - 1 / 30)}>−1f</button>
                  <button type="button" style={{ ...mini, minWidth: 60, fontVariantNumeric: "tabular-nums" }} onClick={() => api.current?.seek(curRange[edge])} title="Jump there">{clock(curRange[edge])}</button>
                  <button type="button" style={mini} onClick={() => trimMine(edge, curRange[edge] + 1 / 30)}>+1f</button>
                  <button type="button" style={mini} onClick={() => trimMine(edge, curRange[edge] + 1)}>+1s</button>
                  <button type="button" style={mini} onClick={() => api.current && trimMine(edge, api.current.time())}>here</button>
                </div>
              ))}
              {curTag.trim ? <><span style={{ fontSize: 11, fontWeight: 800, color: "#f6c66b" }}>Trimmed for him (the play is {clock(cur.in)}–{clock(cur.out)})</span><button type="button" style={mini} onClick={() => setTag({ trim: null })}>Back to the play</button></> : <span style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>the play as cut</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={head}>Label</span>
              {LABELS.map((l, i) => <button key={l} type="button" style={chip(curTag.label === l, LABEL_COLORS[l])} onClick={() => setTag({ label: curTag.label === l ? "" : l })}>{i + 1} · {l}</button>)}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={head}>Mark</span>
              <button type="button" style={btn(tool === "circle")} onClick={() => pickTool("circle")}>◯ Circle (C)</button>
              <button type="button" style={btn(tool === "arrow")} onClick={() => pickTool("arrow")}>↓ Arrow (R)</button>
              {tool ? <span style={{ fontSize: 12, fontWeight: 800, color: "#f6c66b" }}>Click {tool === "arrow" ? "where the tip goes" : "his middle"} · ↑/↓ to size · Esc when done</span> : <span style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>or double-click the film = circle · triple = arrow · ↑/↓ size</span>}
              {curTag.spot && <button type="button" style={mini} onClick={() => api.current?.seek(curTag.spot.t)}>Jump to it</button>}
              {curTag.spot && <button type="button" style={{ ...mini, color: "#ff7a6b" }} onClick={() => setTag({ spot: null })}>Remove</button>}
              {(curTag.legacy?.animated || curTag.legacy?.offFrame) && <span style={{ fontSize: 11, fontWeight: 700, color: "#f6c66b" }}>{curTag.legacy.animated ? "The Premiere cut was animated (keyframed motion) — check the mark." : "The Premiere mark sat outside the film — check it."}</span>}
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                <span style={head}>Traits</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>click to tag what this play shows · {who.pos}{traits.position.length ? "" : " (no position list)"} + generic</span>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {traits.position.map((x) => <button key={x} type="button" style={{ ...chip((curTag.traits || []).includes(x), "#2f86d6"), padding: "2px 9px", fontSize: 11 }} onClick={() => toggleTrait(x)}>{x}</button>)}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {traits.generic.map((x) => <button key={x} type="button" style={{ ...chip((curTag.traits || []).includes(x), "#6d28d9"), padding: "2px 9px", fontSize: 11 }} onClick={() => toggleTrait(x)}>{x}</button>)}
              </div>
            </div>
            <input key={`${cur.id}-note`} defaultValue={curTag.note || ""} onBlur={(e) => e.target.value !== (curTag.note || "") && setTag({ note: e.target.value })} placeholder="Note (optional)…" style={{ ...field, width: "100%" }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>Keys: 1–6 label · 0 clear · Q voice · hold A/D or ←/→ fast motion (double tap: last / next play) · W/S next / last play · ↑/↓ mark size · C circle · R arrow · scroll = zoom (wash, saves itself) · hold the click + drag = pan · E wash editor · V original / washed · F full screen · , . frame · Space play · Esc</div>
          </div>
          {washing && (
            <div style={{ ...box, borderColor: UI_BLUE }}>
              <div style={head}>Wash editor · a zoomed-in version of this play</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#9fb0c8" }}>Scroll to zoom, drag to pan — it saves itself (a keyframe where you are). While the play runs, hold the click and move: every camera move is keyframed as it goes. Between keyframes it moves smoothly. This is a washed VERSION — the play itself stays full size and is never changed. Watch it with Washed; the Studio uses it.</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={btn(true)} onClick={addKey}>+ Keyframe at {clock(t - cur.in)}</button>
                <span style={{ fontSize: 12, fontWeight: 900, color: washHeld ? "#ff6b5b" : "#8494ad", alignSelf: "center" }}>{washHeld ? "● Keying…" : "Saves itself"}</span>
                <button type="button" style={mini} onClick={() => api.current?.setDraft(null)}>Discard changes</button>
                {curTag.wash?.keys?.length > 0 && <button type="button" style={{ ...mini, color: "#ff7a6b" }} onClick={() => setTag({ wash: null })}>Clear the wash</button>}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(curTag.wash?.keys || []).map((k, i) => (
                  <span key={i} style={{ ...chip(false), display: "inline-flex", gap: 6 }}>
                    <button type="button" style={{ border: "none", background: "none", cursor: "pointer", fontWeight: 800 }} onClick={() => api.current?.seek(k.t)}>{clock(k.t - cur.in)} · {k.z.toFixed(2)}×</button>
                    <button type="button" style={{ border: "none", background: "none", cursor: "pointer", color: "#ff7a6b" }} onClick={() => setTag({ wash: { keys: curTag.wash.keys.filter((_, j) => j !== i) } })}>✕</button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {msg && <div style={{ fontSize: 13, fontWeight: 800 }}>{msg}</div>}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// ── Import from Premiere ──
function ImportTab({ games, setGames, wdPeople, gamePaths }) {
  const [proj, setProj] = useState(null); // { name, parsed }
  const [seqIds, setSeqIds] = useState([]);
  const [who, setWho] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const open = async (f) => {
    if (!f) return;
    try {
      const parsed = parsePrproj(await prprojText(await f.arrayBuffer()));
      const withFilm = parsed.sequences.filter((s) => s.plays.some((p) => /\.(mp4|m4v|mov)$/i.test(p.file)));
      setProj({ name: f.name, parsed });
      setSeqIds(withFilm.map((s) => s.id));
      // His name from the project's ("kromah real" → Kromah).
      const words = f.name.replace(/\.prproj$/i, "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
      const guess = wdPeople.filter((p) => words.some((w) => p.name.toLowerCase().split(" ").includes(w)));
      setWho(guess.length === 1 ? guess[0] : null);
      setMsg(`${f.name}: ${withFilm.length} sequence${withFilm.length === 1 ? "" : "s"} with film.`);
    } catch (e) { setMsg(`Couldn't read it: ${e.message}`); }
  };
  const cuts = useMemo(() => (proj ? legacyCuts(proj.parsed, seqIds) : []), [proj, seqIds]);
  const known = new Set(games.map((g) => g.id));
  const run = async () => {
    if (!who || !cuts.length) return;
    setBusy(true);
    try {
      // Games not in the library yet: added from their paths.
      const fresh = [];
      cuts.forEach((c) => {
        if (known.has(c.gameId) || fresh.some((g) => g.id === c.gameId)) return;
        const folder = (c.path.split(/[\\/]/).slice(-2, -1)[0]) || "";
        fresh.push({ id: c.gameId, file: c.file, folder, season: seasonOf(folder), ...parseGameName(c.file) });
      });
      if (fresh.length) { await addGames(fresh); setGames((gs) => [...gs, ...fresh.map((g) => ({ ...g, plays: 0, focus: [] }))]); }
      const existing = await playsForGames([...new Set(cuts.map((c) => c.gameId))]);
      let made = 0; let tagged = 0; let had = 0;
      for (const c of cuts) {
        const game = games.find((g) => g.id === c.gameId) || fresh.find((g) => g.id === c.gameId);
        const extra = { spot: c.spot, legacy: { project: proj.name, sequence: c.seq, scale: c.scale, animated: c.animated, offFrame: c.offFrame, mark: c.mark || "" } };
        const same = sameCut(existing, c);
        if (!same) { await importPlay(game, Math.round(c.in * 100) / 100, Math.round(c.out * 100) / 100, who, extra); made += 1; } // eslint-disable-line no-await-in-loop
        else if (!same.playerIds?.includes(who.key)) { await tagPlayer(same, who, extra); tagged += 1; } // eslint-disable-line no-await-in-loop
        else had += 1;
      }
      setGames((gs) => gs.map((g) => ({ ...g, plays: (g.plays || 0) + cuts.filter((c) => c.gameId === g.id && !sameCut(existing, c)).length })));
      setMsg(`Imported for ${who.name}: ${made} new plays, ${tagged} existing plays tagged, ${had} already his.`);
    } catch (e) { setMsg(`Import stopped: ${e.message}`); }
    setBusy(false);
  };
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <div style={box}>
        <div style={head}>1 · A player&apos;s Premiere project</div>
        <label style={{ ...btn(!proj), justifySelf: "start" }}>{proj ? `Change (${proj.name})` : "Open .prproj"}<input type="file" accept=".prproj" style={{ display: "none" }} onChange={(e) => open(e.target.files?.[0])} /></label>
        {proj && proj.parsed.sequences.filter((s) => s.plays.some((p) => /\.(mp4|m4v|mov)$/i.test(p.file))).map((s) => (
          <label key={s.id} style={{ display: "flex", gap: 8, fontSize: 13, fontWeight: 800 }}>
            <input type="checkbox" checked={seqIds.includes(s.id)} onChange={(e) => setSeqIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))} />
            {s.name} <span style={{ color: "#8494ad" }}>· {s.plays.filter((p) => /\.(mp4|m4v|mov)$/i.test(p.file)).length} cuts</span>
          </label>
        ))}
      </div>
      {proj && (
        <div style={box}>
          <div style={head}>2 · Whose plays</div>
          {who ? <div style={{ fontSize: 14, fontWeight: 900 }}>{who.name} <span style={{ color: "#8494ad", fontSize: 12 }}>{who.pos} · {who.team}</span> <button type="button" style={mini} onClick={() => setWho(null)}>Change</button></div>
            : <PersonPicker pool={wdPeople} onPick={setWho} placeholder="Find the player…" />}
        </div>
      )}
      {proj && (
        <div style={box}>
          <div style={head}>3 · Import</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5", lineHeight: 1.6 }}>
            {cuts.length} cuts from {new Set(cuts.map((c) => c.gameId)).size} games ({[...new Set(cuts.map((c) => c.gameId))].filter((id) => !known.has(id)).length} new to the library)<br />
            {cuts.filter((c) => c.spot).length} with a circle / arrow → moved onto the full-size film · {cuts.filter((c) => c.animated).length} animated in Premiere (flagged to check)<br />
            {cuts.filter((c) => !gamePaths.has(c.gameId) && !known.has(c.gameId)).length > 0 && <span style={{ color: "#f6c66b" }}>Some games aren&apos;t in the scanned folders — they&apos;re added anyway; check the library folder.</span>}
          </div>
          <button type="button" style={{ ...btn(true), justifySelf: "start" }} onClick={run} disabled={!who || !cuts.length || busy}>{busy ? "Importing…" : `Import ${cuts.length} plays${who ? ` for ${who.name}` : ""}`}</button>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>Safe to re-run: a cut already in the library is only tagged, never duplicated.</div>
        </div>
      )}
      {msg && <div style={{ fontSize: 13, fontWeight: 800 }}>{msg}</div>}
    </div>
  );
}

export default function FilmManager() {
  const [tab, setTab] = useState("cut");
  const [root, setRoot] = useState(null);
  const [access, setAccess] = useState("none");
  const [handles, setHandles] = useState({}); // gameId → file handle (from the scan)
  const [games, setGames] = useState([]);
  const [schools, setSchools] = useState([]);
  const [wdPeople, setWdPeople] = useState([]);
  const [who, setWho] = useState(null);
  const [msg, setMsg] = useState("");
  const [schedules, setSchedules] = useState({});
  // Everyone with film (filmGames/_players) — the Players search's first list.
  const [filmPool, setFilmPool] = useState([]);

  useEffect(() => {
    filmPeople().then(setFilmPool).catch(() => {});
    listGames().then(setGames).catch((e) => setMsg(`Couldn't load the games: ${e.message}`));
    // The seasons' schedules (compSnapshots/_filmSchedule_{season}) — one read a season.
    // Read straight from Firestore: these docs aren't versioned like the site
    // snapshots, so getSiteSnapshot (v2 only) would drop them — "Loading the schedule…" forever.
    Promise.all(FILM_SEASONS.map((s2) => getDoc(doc(db, "compSnapshots", `_filmSchedule_${s2}`)).then((d) => (d.exists() ? d.data() : null)).catch(() => null)))
      .then((docs) => setSchedules(Object.fromEntries(FILM_SEASONS.map((s2, i) => [s2, docs[i]?.games || null]))));
    getSiteSnapshot("_cfbTeams").then((d) => setSchools(Object.values(d?.teams || {}).map((x) => x.School).filter(Boolean).sort())).catch(() => {});
    getSiteSnapshot("_search").then((d) => setWdPeople((d?.rows || []).map((r) => person({ name: `${r.F} ${r.L}`, pos: r.P, team: r.S, wd: r.i })))).catch(() => {});
    savedRoot().then(async (h) => { if (h) { setRoot(h); setAccess(await rootAccess(h)); } });
  }, []);

  const scan = async (h = root) => {
    if (!h) return;
    setMsg("Scanning the film folders…");
    try {
      const found = await scanGames(h);
      setHandles(Object.fromEntries(found.map((g) => [g.id, g.handle])));
      const known = new Set(games.map((g) => g.id));
      // New film: its teams from its name, its season from its folder (or name), and its game — matched on the schedule when there's one clear game.
      const fresh = found.filter((g) => !known.has(g.id)).map((g) => {
        const base = { id: g.id, file: g.file, folder: g.folder, ...parseGameName(g.file) };
        base.season = seasonFor(base);
        const m = matchGame(base, schedules[base.season] || []).game;
        const out = m ? { ...base, ...matchFields(m) } : base;
        return { ...out, name: filmName(out) };
      });
      if (fresh.length) { await addGames(fresh); setGames((gs) => [...gs, ...fresh.map((g) => ({ ...g, plays: 0, focus: [] }))]); }
      const auto = fresh.filter((g) => g.cfbdGameId).length;
      setMsg(`${found.length} film files in the folders${fresh.length ? ` · ${fresh.length} new: ${auto} put on their game${fresh.length - auto ? `, ${fresh.length - auto} in the inbox to place` : ""}` : " · nothing new"}.`);
    } catch (e) { setMsg(`Scan failed: ${e.message}`); }
  };
  const choose = async () => {
    try { const h = await pickRoot(); setRoot(h); setAccess("granted"); await scan(h); } catch (e) { if (e.name !== "AbortError") setMsg(e.message); }
  };
  const allow = async () => { const a = await rootAccess(root, true); setAccess(a); if (a === "granted") await scan(root); };
  // A game's film, straight from a click on a play / game (the click is the
  // gesture Chrome needs): no folder yet -> open the folder picker; folder
  // reset to "ask" after a reload -> ask again. Never a silent "No film".
  const fileFor = async (g) => {
    let h = root;
    let a = access;
    if (!h) {
      try { h = await pickRoot(); } catch (e) { if (e.name !== "AbortError") setMsg(e.message); return null; }
      a = "granted"; setRoot(h); setAccess(a); scan(h);
    } else if (a !== "granted") {
      a = await rootAccess(h, true).catch(() => "denied"); setAccess(a);
      if (a === "granted" && !Object.keys(handles).length) scan(h);
    }
    if (a !== "granted") { setMsg("Chrome didn't allow the film folder — click Allow film folder."); return null; }
    const f = await gameFile(h, g, handles).catch(() => null);
    if (!f) setMsg(`Can't find ${g.file || g.id} in ${g.folder || h.name} — Rescan, or check it's in the film folder.`);
    return f;
  };
  // What the film window shows when there's no film: the way to connect it.
  const gate = !root ? { label: "Connect film folder", hint: "Pick C:\\KC Holdings\\KC Entertainment — it's remembered in this browser.", go: choose }
    : access !== "granted" ? { label: "Allow film folder", hint: `${root.name} — Chrome asks again after a reload.`, go: allow } : null;
  const openPlayer = (p) => { setReview(null); setWho(p); setTab("players"); };
  // Finishing a game: everyone clipped in it, reviewed one by one in the Players tab.
  const [review, setReview] = useState(null);
  const startReview = (game, plays) => {
    const people = [];
    plays.forEach((p) => Object.values(p.players || {}).forEach((x) => { if (!people.some((y) => y.key === x.key)) people.push(person(x)); }));
    if (!people.length) return;
    setReview({ game, people, close: () => { setReview(null); setTab("cut"); } });
    setWho(people[0]);
    setTab("players");
  };
  // Add film to a game side from Cut plays (user, 2026-11-25): pick the file
  // on this computer; the film stays where it is (nothing is uploaded) — its
  // place in the film folders, or its handle kept in this browser — and it's
  // put on that game as that team's offense. → the film's game id.
  const linkFilm = async (x, team, season) => {
    let fh;
    try { fh = await pickFilmFile(); } catch (e) { if (e.name !== "AbortError") setMsg(e.message); return null; }
    try {
      const f = await fh.getFile();
      const id = gameIdOf(f.name);
      const path = await pathUnder(root, fh);
      await saveFileHandle(id, fh);
      setHandles((h) => ({ ...h, [id]: fh }));
      const defense = teamKey(x.home) === teamKey(team) ? x.away : x.home;
      const doc0 = { id, file: f.name, folder: path && path.length > 1 ? path[0] : "", offense: team, defense, season: String(season || x.season || seasonOf(path?.[0]) || "") };
      const patch = { ...doc0, ...matchFields(x, "manual") };
      patch.name = filmName(patch);
      const had = games.find((g) => g.id === id);
      if (had) {
        await saveGame(id, patch);
        setGames((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
      } else {
        await addGames([patch]);
        setGames((gs) => [...gs, { ...patch, plays: 0, focus: [] }]);
      }
      setMsg(`${f.name} → ${patch.name}${path ? "" : " · linked from outside the film folder (remembered in this browser)"}`);
      return id;
    } catch (e) { setMsg(`Couldn't add the film: ${e.message}`); return null; }
  };
  // Put a film file on a game by hand.
  const connect = async (g, x) => {
    const patch = { ...matchFields(x, "manual"), season: seasonFor(g) };
    const next = { ...g, ...patch };
    patch.name = filmName(next);
    setGames((gs) => gs.map((y) => (y.id === g.id ? { ...y, ...patch } : y)));
    await saveGame(g.id, patch).catch((e) => setMsg(e.message));
    setMsg(`${g.file} → ${filmName(next)}`);
  };

  return (
    <div style={{ display: "grid", gap: 12, background: "#0b1220", color: "#e8edf5", padding: 16, borderRadius: 14, colorScheme: "dark" }}>
      <style>{FS_CSS}</style>
      <div style={{ ...box, gridTemplateColumns: "1fr auto", alignItems: "center" }}>
        <div>
          <div style={head}>Film library</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#e8edf5" }}>
            {!root ? "Choose the folder your film lives in (KC Entertainment) — it's remembered in this browser." : `${root.name} · ${games.length} games${access !== "granted" ? " · needs permission" : ""}`}
          </div>
          {msg && <div style={{ fontSize: 12, fontWeight: 700, color: "#9fb0c8" }}>{msg}</div>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {root && access !== "granted" && <button type="button" style={btn(true)} onClick={allow}>Allow film folder</button>}
          {root && access === "granted" && <button type="button" style={btn(false)} onClick={() => scan()}>Rescan</button>}
          <button type="button" style={btn(!root)} onClick={choose}>{root ? "Change folder" : "Choose folder"}</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #263247" }}>
        {[["cut", "Cut plays"], ["players", "Players"], ["import", "Import from Premiere"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} style={{ border: "none", background: "none", padding: "8px 16px", marginBottom: -2, cursor: "pointer", fontWeight: 900, fontSize: 13, color: tab === k ? "#6fb1ff" : "#8494ad", borderBottom: `3px solid ${tab === k ? UI_BLUE : "transparent"}` }}>{l}</button>
        ))}
      </div>
      {tab === "cut" && <CutTab games={games} setGames={setGames} fileFor={fileFor} gate={gate} wdPeople={wdPeople} schools={schools} openPlayer={openPlayer} schedules={schedules} onConnect={connect} onLink={linkFilm} onReview={startReview} />}
      {tab === "players" && <PlayersTab games={games} fileFor={fileFor} gate={gate} wdPeople={wdPeople} filmPool={filmPool} who={who} setWho={setWho} review={review} />}
      {tab === "import" && <ImportTab games={games} setGames={setGames} wdPeople={wdPeople} gamePaths={new Set(Object.keys(handles))} />}
    </div>
  );
}

