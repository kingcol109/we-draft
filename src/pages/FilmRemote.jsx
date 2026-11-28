// src/pages/FilmRemote.jsx
//
// /film/remote — the Film Manager Viewer's remote, for the iPad (user,
// 2026-11-27: "control the screen from there"). The film plays on the PC
// (Admin → Film Manager → Viewer); this picks what's playing and moves around
// in it, live both ways (utils/film/remote.js):
//   Players  his plays back to back — last / next play, jump to any play, labels.
//   Games    the whole game — back / ahead 5 · 10 · 30 s, scrub, speed.
//   Both     play / pause, restart, speed, YouTube / Full screen view; washed /
//            original and marks (players); the side bar's player (games);
//            YouTube mode's side panel and center (film / background / logo,
//            the background's action shot).
// Taps show at once here, then settle to what the PC reports.
// ✏️ Draw (user, 2026-11-27): pops into the film — the PC's film live on the
// iPad, draw on it with a finger or the Pencil, and it shows on the PC's
// screen too. A small see-through bar at the bottom: clear / undo, pen ·
// arrow · circle, colors, and slow-mo / play / fast-forward. Nothing is
// configured or saved; ✕ pops back out and wipes it.
// Displays (user, 2026-11-27): Film · Live · Upcoming · Past — the PC's
// middle shows the slate instead of film (components/film/DisplayBoard.jsx);
// the games list here, tap one to blow it up on the PC (its live box score, its
// preview, its final box), ◂ All games to go back; Past steps week by week.
// Hiding the film list puts the remote full screen (user, 2026-11-27).
// Later (user): YouTube live chat on the iPad, picked comments shown on screen.
import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { filmPeople, forSide, LABEL_COLORS, LABELS, listGames, roster } from "../utils/film/data";
import { filmName, weekLabel } from "../utils/film/schedule";
import { seasonOf } from "../utils/film/library";
import { drawInk, INK_COLORS } from "../utils/film/ink";
import { joinDraw, newSid, sendCmd, watchPlay, watchState } from "../utils/film/remote";
import { useSchools } from "../components/DraftArchiveList";
import { DISPLAYS, DISPLAY_TITLES, boardList, pastWeekOf, useSlate, useWeekGames } from "../components/film/DisplayBoard";
import { darkLogo, kickoffLabel, statusLabel, teamShort } from "../utils/live";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const BG = "#0b1220";
const CARD = "#141c2b";
const LINE = "#263247";
const MUTED = "#8494ad";
const clock = (s) => { const t = Math.max(0, s || 0); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const x = Math.floor(t % 60).toString().padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
const seasonFor = (g) => String(g?.season || seasonOf(g?.folder) || (String(g?.file || "").match(/\b(20\d\d)\b/) || [])[1] || "");
const ellipsis = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
// '25 / '26
const yy = (y) => (y ? `'${String(y).slice(-2)}` : "");
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : "");
// A game for the picker: away @ home (vs at a neutral site; an unmatched file:
// offense vs defense), and "Final 24–21 · Nov 1, 2025 · Week 9".
const gameSides = (g) => (g.home && g.away ? { a: g.away, b: g.home, sep: g.neutral ? "vs" : "@" } : { a: g.offense, b: g.defense, sep: "vs" });
const gameSub = (g) => [
  g.ap != null && g.hp != null ? `Final ${g.ap}–${g.hp}` : "",
  fmtDate(g.date) || seasonFor(g),
  g.week || g.seasonType === "postseason" ? weekLabel({ week: g.week, type: g.seasonType }) : "",
].filter(Boolean).join(" · ");
// A school's logo on the remote's dark cards (the dark version), else its initials.
function TeamLogo({ name, brands, size = 40 }) {
  const b = brands[name];
  const src = b?.LogoDark || b?.Logo1 || "";
  return src
    ? <img src={src} alt={name} title={name} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
    : <span title={name} style={{ width: size, height: size, borderRadius: "50%", background: "#26324a", display: "inline-grid", placeItems: "center", fontSize: size * 0.32, fontWeight: 900, color: "#9fb0c8", flexShrink: 0 }}>{String(name || "?").slice(0, 3).toUpperCase()}</span>;
}

const CSS = `
.fr { min-height: 100vh; background: ${BG}; color: #e8edf5; font-family: Arial, sans-serif; color-scheme: dark; -webkit-tap-highlight-color: transparent; }
.fr button { touch-action: manipulation; font-family: inherit; }
.fr-grid { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 14px; padding: 14px; align-items: start; }
.fr-tabs { display: none; }
.fr-pick { position: sticky; top: 14px; max-height: calc(100vh - 28px); }
.fr-grid[data-pick="closed"] { grid-template-columns: minmax(0, 1fr); }
.fr-grid[data-pick="closed"] .fr-pick { display: none; }
/* Narrow (a phone, any way up, or a small window): one column, two tabs. */
.fr[data-narrow="1"] .fr-collapse { display: none !important; }
.fr[data-narrow="1"] .fr-grid[data-pick="closed"][data-tab="pick"] .fr-pick { display: grid; }
.fr[data-narrow="1"] .fr-grid { grid-template-columns: minmax(0, 1fr); }
.fr[data-narrow="1"] .fr-tabs { display: flex; }
.fr[data-narrow="1"] .fr-grid[data-tab="now"] .fr-pick { display: none !important; }
.fr[data-narrow="1"] .fr-grid[data-tab="pick"] .fr-now { display: none !important; }
.fr[data-narrow="1"] .fr-pick { position: static; max-height: none; }
/* A phone (held sideways): a controller — slim bar on top, one tab at a time. */
.frp-bar { position: sticky; top: 0; z-index: 20; background: ${BG}; display: flex; align-items: center; gap: 6px;
  padding: 6px max(8px, env(safe-area-inset-right)) 6px max(8px, env(safe-area-inset-left)); border-bottom: 1px solid ${LINE}; }
.fr[data-device="phone"] .fr-pick { position: static; max-height: none; }
.frp-body { padding: 8px max(8px, env(safe-area-inset-right)) 16px max(8px, env(safe-area-inset-left)); display: grid; gap: 8px; }
`;

// Which device the remote is on (user, 2026-11-27: "detect what device it is
// on and use the best layout"): phone · tablet · desktop, and which way up.
// A phone by its user agent, else a touch screen whose short side is under
// 600 px; an iPad asks for the desktop site (MacIntel + touch) — still a tablet.
function useDevice() {
  const read = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ua = navigator.userAgent || "";
    const touch = !!window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
    const short = Math.min(window.screen?.width || w, window.screen?.height || h);
    const phone = /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(ua) || (touch && short < 600);
    const tablet = !phone && (/iPad|Android|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || touch);
    const kind = phone ? "phone" : tablet ? "tablet" : "desktop";
    return { kind, phone, portrait: h >= w, narrow: !phone && w <= 900 };
  };
  const [d, setD] = useState(read);
  useEffect(() => {
    const on = () => setD((o) => { const n = read(); return JSON.stringify(n) === JSON.stringify(o) ? o : n; });
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, []);
  return d;
}
const card = { background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: 14, display: "grid", gap: 12, minWidth: 0 };
const big = (on = false, color = BLUE) => ({ minHeight: 64, borderRadius: 14, border: `1px solid ${on ? color : "#334058"}`, background: on ? color : "#1b2538", color: "#fff", fontSize: 18, fontWeight: 900, cursor: "pointer", padding: "0 14px" });
const pill = (on = false, color = BLUE) => ({ minHeight: 44, borderRadius: 999, border: `1px solid ${on ? color : "#334058"}`, background: on ? color : "#1b2538", color: on ? "#fff" : "#e8edf5", fontSize: 15, fontWeight: 800, cursor: "pointer", padding: "0 16px" });
const head = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.6, color: "#9fb0c8" };

// The site pads the body for its navbar (index.css) — the remote has no navbar:
// no padding, and the remote's own dark color behind it (no white edges).
function useBareBody() {
  useEffect(() => {
    const b = document.body.style;
    const was = { paddingTop: b.paddingTop, background: b.background };
    b.paddingTop = "0";
    b.background = BG;
    return () => { b.paddingTop = was.paddingTop; b.background = was.background; };
  }, []);
}

// Keep the iPad awake while the remote is open.
function useWakeLock() {
  useEffect(() => {
    let lock = null;
    const ask = () => { if (document.visibilityState === "visible" && navigator.wakeLock) navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {}); };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => { document.removeEventListener("visibilitychange", ask); lock?.release?.().catch(() => {}); };
  }, []);
}

// A bar you drag to scrub (a game) — the time follows the finger, the seek goes on release.
function Scrub({ t, dur, ticks = [], onSeek }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const at = (e) => { const b = ref.current.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * (dur || 0); };
  const v = drag ?? t;
  const pct = dur ? Math.min(100, (v / dur) * 100) : 0;
  return (
    <div>
      <div ref={ref} style={{ position: "relative", height: 44, touchAction: "none", cursor: "pointer" }}
        onPointerDown={(e) => { if (!dur) return; ref.current.setPointerCapture?.(e.pointerId); setDrag(at(e)); }}
        onPointerMove={(e) => { if (drag != null) setDrag(at(e)); }}
        onPointerUp={(e) => { if (drag == null) return; const x = at(e); setDrag(null); onSeek(x); }}
        onPointerCancel={() => setDrag(null)}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 18, height: 8, borderRadius: 4, background: "#26324a" }} />
        {dur > 0 && ticks.map(({ a, b }, i) => <div key={i} style={{ position: "absolute", top: 15, height: 14, left: `${(a / dur) * 100}%`, width: `max(3px, ${((b - a) / dur) * 100}%)`, borderRadius: 2, background: "#4b6a96" }} />)}
        <div style={{ position: "absolute", left: 0, top: 18, height: 8, width: `${pct}%`, borderRadius: 4, background: GOLD, opacity: 0.6 }} />
        <div style={{ position: "absolute", top: 8, left: `calc(${pct}% - 14px)`, width: 28, height: 28, borderRadius: "50%", background: GOLD, boxShadow: drag != null ? `0 0 0 8px ${GOLD}44` : "0 1px 4px rgba(0,0,0,0.5)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 900, color: "#9fb0c8", fontVariantNumeric: "tabular-nums" }}>
        <span style={{ color: drag != null ? GOLD : "#e8edf5" }}>{clock(v)}</span><span>{clock(dur)}</span>
      </div>
    </div>
  );
}

// A button that works while it's held: down starts it, up (or a lost touch) stops it.
function HoldBtn({ onStart, onEnd, style, title, children }) {
  const on = useRef(false);
  const end = () => { if (!on.current) return; on.current = false; onEnd(); };
  return (
    <button type="button" title={title}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); if (on.current) return; on.current = true; onStart(); }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onContextMenu={(e) => e.preventDefault()}
      style={{ ...style, touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      {children}
    </button>
  );
}

// ✂ Cut (user, 2026-11-27): watching a game live, cut a play (start / end) or
// make the play under the playhead hot, then tap the players it's for. The
// PC does the saving (the Film Manager's plays); no labels, no marks.
const slimPerson = (p) => ({ key: p.key, name: p.name || "", pos: p.pos || "", team: p.team || "", wd: p.wd || null, cfbd: p.cfbd || null });
function CutPanel({ s, t, cmd }) {
  const g = s.game || {};
  const c = s.cut || {};
  const hot = c.hot;
  const [teams, setTeams] = useState(null);
  useEffect(() => {
    let x = false;
    setTeams(null);
    Promise.all([roster(g.offense), roster(g.defense)]).then(([a, b]) => { if (!x) setTeams({ off: forSide(a, "offense"), def: forSide(b, "defense") }); });
    return () => { x = true; };
  }, [g.offense, g.defense]);
  const [q, setQ] = useState("");
  // Taps show at once; the PC's state settles them.
  const ids = hot?.ids || [];
  const [pend, setPend] = useState({});
  useEffect(() => { setPend({}); }, [hot?.id, ids.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(""); }, [hot?.id]);
  const [delArm, setDelArm] = useState(null); // the play armed to delete
  useEffect(() => { if (!delArm) return undefined; const t0 = setTimeout(() => setDelArm(null), 4000); return () => clearTimeout(t0); }, [delArm]);
  const isOn = (k) => (k in pend ? pend[k] : ids.includes(k));
  // Suggestions (user, 2026-11-27): everyone dropped into a play this game
  // (newest first) — one tap on the next cut. Starts with the game's featured players.
  const SK = `wd.film.remote.sugg.${g.id || ""}`;
  const [picked, setPicked] = useState([]);
  useEffect(() => { try { setPicked(JSON.parse(localStorage.getItem(SK) || "[]")); } catch { setPicked([]); } }, [SK]);
  const remember = (p) => setPicked((list) => {
    const next = [{ ...slimPerson(p), jersey: p.jersey ?? null }, ...list.filter((x) => x.key !== p.key)].slice(0, 16);
    try { localStorage.setItem(SK, JSON.stringify(next)); } catch { /* private window */ }
    return next;
  });
  const suggest = useMemo(() => {
    const m = new Map();
    [...picked, ...(g.focus || [])].forEach((p) => { if (p?.key && !m.has(p.key)) m.set(p.key, p); });
    return [...m.values()];
  }, [picked, g.focus]);
  const tap = (p) => {
    if (!hot) return;
    const on = !isOn(p.key);
    setPend((m) => ({ ...m, [p.key]: on }));
    if (on) remember(p);
    cmd("tag", { person: slimPerson(p) });
  };
  // The search: both sides' rosters, by name or number — only while typing.
  const ql = q.trim().toLowerCase().replace(/^#/, "");
  const found = !ql ? [] : [...(teams?.off || []), ...(teams?.def || [])]
    .filter((p) => String(p.jersey ?? "") === ql || String(p.name).toLowerCase().includes(ql))
    .sort((a, b) => (String(b.jersey ?? "") === ql) - (String(a.jersey ?? "") === ql))
    .slice(0, 8);
  const cutting = c.inPt != null;
  const Chip = ({ p }) => {
    const on = isOn(p.key);
    return (
      <button type="button" onClick={() => tap(p)}
        style={{ minHeight: 48, borderRadius: 999, border: `2px solid ${on ? "#4ade80" : LINE}`, background: on ? "#0f3a24" : "#0f1726", color: "#e8edf5", padding: "0 16px", cursor: "pointer", display: "inline-flex", gap: 8, alignItems: "center", fontSize: 15, fontWeight: 900, maxWidth: "100%" }}>
        {on && <span style={{ color: "#4ade80" }}>✓</span>}
        {p.jersey != null && <span style={{ color: on ? "#4ade80" : GOLD, fontVariantNumeric: "tabular-nums" }}>#{p.jersey}</span>}
        <span style={ellipsis}>{p.name}</span>
      </button>
    );
  };
  return (
    <div style={{ ...card, borderColor: hot ? "#15803d" : cutting ? GOLD : LINE }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10 }}>
        {cutting
          ? <button type="button" style={{ ...big(true, GOLD), color: "#00264d", fontSize: 22 }} onClick={() => cmd("cutEnd")}>✂ End play · {clock(Math.max(0, t - c.inPt))}</button>
          : <button type="button" style={{ ...big(true, "#15803d"), fontSize: 22 }} onClick={() => cmd("cutStart")}>✂ Start play</button>}
        {cutting
          ? <button type="button" style={big()} onClick={() => cmd("cutCancel")}>Cancel</button>
          : <button type="button" style={big()} onClick={() => cmd("hotHere")}>🔥 Play here</button>}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", minHeight: 44 }}>
        {hot ? (
          <>
            <span style={{ fontSize: 17, fontWeight: 900, color: "#4ade80" }}>🔥 Hot {clock(hot.in)}–{clock(hot.out)}</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#9fb0c8" }}>{ids.length ? `${ids.length} player${ids.length === 1 ? "" : "s"}` : "tap the players it's for"}</span>
            <span style={{ flex: 1 }} />
            {/* Delete: tap, then tap again to confirm (it's gone for every player on it). */}
            <button type="button" style={pill(delArm === hot.id, "#a52a1e")} onClick={() => { if (delArm === hot.id) { cmd("hotDelete", { id: hot.id }); setDelArm(null); } else setDelArm(hot.id); }}>
              {delArm === hot.id ? "Tap again to delete" : "🗑 Delete play"}
            </button>
            <button type="button" style={pill()} onClick={() => cmd("hotDone")}>✓ Done</button>
          </>
        ) : <span style={{ fontSize: 14, fontWeight: 800, color: MUTED }}>{cutting ? `Play started at ${clock(c.inPt)} — tap End when it's over.` : "Cut a play (or make the one on screen hot), then tap the players it's for."}</span>}
      </div>
      {/* The players — only once a play is hot: this game's suggestions, and a search for anyone else. */}
      {hot && (
        <>
          {suggest.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {suggest.map((p) => <Chip key={p.key} p={p} />)}
            </div>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={teams ? "Add a player — name or #…" : "Loading the rosters…"} type="search"
            style={{ minHeight: 48, borderRadius: 12, border: "1px solid #334058", background: "#0f1726", color: "#e8edf5", fontSize: 17, padding: "0 14px", width: "100%", boxSizing: "border-box" }} />
          {ql && (
            <div style={{ display: "grid", gap: 6 }}>
              {found.map((p) => {
                const on = isOn(p.key);
                return (
                  <button key={p.key} type="button" onClick={() => { tap(p); setQ(""); }}
                    style={{ minHeight: 50, borderRadius: 12, border: `2px solid ${on ? "#4ade80" : LINE}`, background: on ? "#0f3a24" : "#0f1726", color: "#e8edf5", padding: "4px 14px", cursor: "pointer", display: "flex", gap: 12, alignItems: "center", textAlign: "left", minWidth: 0 }}>
                    <span style={{ fontSize: 20, fontWeight: 900, color: on ? "#4ade80" : GOLD, width: 46, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{p.jersey != null ? `#${p.jersey}` : ""}</span>
                    <span style={{ ...ellipsis, fontSize: 16, fontWeight: 900, flex: 1 }}>{p.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: MUTED }}>{[p.pos, p.team].filter(Boolean).join(" · ")}</span>
                  </button>
                );
              })}
              {teams && !found.length && <div style={{ color: MUTED, fontWeight: 700 }}>No one on either roster matches.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ✏️ Draw — the pop-in film + drawing layer.
const TOOLS = [["pen", "✏️"], ["arrow", "↗"], ["circle", "◯"]];
const r4 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;
function DrawMode({ s, dev, playing, rate, onToggle, onRate, cmd, linkRef, onClose }) {
  const isPlayer = s.mode === "player";
  const videoRef = useRef(null);
  const inkRef = useRef(null);
  const boxRef = useRef(null);
  const [st, setSt] = useState("connecting");
  const [stream, setStream] = useState(null);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(INK_COLORS[0]);
  const [strokes, setStrokes] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [sid, setSid] = useState(newSid);
  const cur = useRef(null);
  const ptr = useRef(null);
  const sent = useRef(0);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  // The page under it never scrolls (iOS drags the page with the finger otherwise).
  useEffect(() => { const was = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = was; }; }, []);

  // In: ask the PC for a session and join it. Out: tell it to stop (it clears).
  useEffect(() => {
    sendCmd("draw", { on: true, sid }).catch(() => setSt("failed"));
    const L = joinDraw(sid, { onStream: setStream, onStatus: setSt });
    linkRef.current = L;
    const bye = () => { sendCmd("draw", { on: false }).catch(() => {}); };
    window.addEventListener("pagehide", bye);
    return () => { window.removeEventListener("pagehide", bye); linkRef.current = null; L.stop(); bye(); };
  }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = videoRef.current;
    if (v && stream) { v.srcObject = stream; v.play().catch(() => {}); }
  }, [stream]);

  // The ink layer, at the screen's real pixels.
  const paint = () => {
    const c = inkRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    drawInk(ctx, cur.current ? [...strokesRef.current, cur.current] : strokesRef.current, c.width, c.height);
  };
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const fit = () => {
      const c = inkRef.current;
      const b = box.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(b.width * dpr);
      c.height = Math.round(b.height * dpr);
      paint();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    fit();
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(paint, [strokes]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAll = (next) => { setStrokes(next); linkRef.current?.send({ t: "all", strokes: next }); };
  // A new play / game: a clean slate (the PC clears its copy too).
  const playKey = s.curId || s.game?.id || "";
  const firstKey = useRef(playKey);
  useEffect(() => { if (playKey !== firstKey.current) { firstKey.current = playKey; cur.current = null; setStrokes([]); } }, [playKey]);

  const at = (e) => { const b = inkRef.current.getBoundingClientRect(); return [r4((e.clientX - b.left) / b.width), r4((e.clientY - b.top) / b.height)]; };
  const down = (e) => {
    if (ptr.current != null) return; // one finger draws; a second is ignored
    ptr.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const [x, y] = at(e);
    cur.current = { id: `${Date.now()}`, tool, color, p: tool === "pen" ? [x, y] : [x, y, x, y] };
    setDrawing(true);
    paint();
  };
  const move = (e) => {
    if (e.pointerId !== ptr.current || !cur.current) return;
    const evs = e.nativeEvent.getCoalescedEvents?.() || [e];
    const c = cur.current;
    (evs.length ? evs : [e]).forEach((ev) => {
      const [x, y] = at(ev);
      if (c.tool === "pen") {
        const n = c.p.length;
        if (Math.hypot(x - c.p[n - 2], y - c.p[n - 1]) > 0.002) c.p.push(x, y);
      } else c.p = [c.p[0], c.p[1], x, y];
    });
    paint();
    const now = performance.now();
    if (now - sent.current > 33) { sent.current = now; linkRef.current?.send({ t: "cur", s: { ...c, p: [...c.p] } }); }
  };
  const up = (e) => {
    if (e.pointerId !== ptr.current) return;
    ptr.current = null;
    setDrawing(false);
    const c = cur.current;
    cur.current = null;
    if (c) setAll([...strokesRef.current, { ...c, p: [...c.p] }]);
  };

  const live = st === "live" && stream;
  // The layout by device (user, 2026-11-27): upright (phone or iPad) — the
  // film across the top, the bar under it (wrapping), clear of the film;
  // sideways — the film fills the screen and the bar floats over it,
  // see-through, fading while you draw. A sideways phone: smaller buttons, one
  // color dot that cycles, so the bar fits in one row.
  const docked = dev.portrait;
  const tight = dev.phone && !dev.portrait;
  const oneDot = dev.phone; // a phone: one color dot that cycles
  const sz = tight ? 40 : dev.phone ? 42 : 46;
  const btn = (on = false) => ({ minWidth: sz, height: sz, borderRadius: 12, border: "none", background: on ? "rgba(246,162,29,0.9)" : "rgba(255,255,255,0.12)", color: on ? "#00264d" : "#fff", fontSize: 19, fontWeight: 900, cursor: "pointer", padding: "0 10px", touchAction: "manipulation", flexShrink: 0 });
  // Dividers between groups — not on an upright phone, where every pixel of the row counts.
  const sep = dev.phone && docked ? null : <span style={{ width: 1, height: 28, background: "rgba(255,255,255,0.2)", margin: "0 2px", flexShrink: 0 }} />;
  const slow = playing && Math.abs(rate - 0.5) < 0.01;
  const fast = playing && rate >= 1.9;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: docked ? 14 : 0, overflow: "hidden", touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}>
      <div ref={boxRef} style={{ position: "relative", width: docked ? "100vw" : "min(100vw, calc(100dvh * 16 / 9))", aspectRatio: "16 / 9", background: "#0b1426", flexShrink: 0 }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", opacity: live ? 1 : 0 }} />
        {!live && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", alignContent: "center", gap: 10, color: "#8494ad", fontWeight: 800, textAlign: "center", padding: 20 }}>
            <div style={{ fontSize: 18 }}>{st === "failed" ? "The film couldn't stream to this screen." : "Bringing the film over from the PC…"}</div>
            <div style={{ fontSize: 14 }}>{st === "failed" ? "You can still draw — it shows on the PC's screen." : "Same Wi-Fi as the PC works best."}</div>
          </div>
        )}
        <canvas ref={inkRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: "crosshair" }} />
        {st === "failed" && (
          <button type="button" style={{ ...btn(), position: "absolute", top: 12, right: 12 }} onClick={() => { setStream(null); setSid(newSid()); }}>⟳ Reconnect</button>
        )}
      </div>

      {/* The bar: small, see-through. Sideways it floats over the film in one row
          and fades while you draw; upright it sits under the film, tools on
          one row, playback on the next. */}
      {(() => {
        const tools = (
          <>
            <button type="button" style={{ ...btn(), background: "rgba(255,90,90,0.3)" }} onClick={onClose} title="Pop out (clears the drawing)">✕</button>
            {sep}
            {TOOLS.map(([k, ic]) => <button key={k} type="button" style={btn(tool === k)} onClick={() => setTool(k)} title={k}>{ic}</button>)}
            {oneDot ? (
              <button type="button" onClick={() => setColor((c) => INK_COLORS[(INK_COLORS.indexOf(c) + 1) % INK_COLORS.length])} title="Color (tap for the next)"
                style={{ width: 30, height: 30, borderRadius: 15, border: "3px solid #fff", background: color, cursor: "pointer", flexShrink: 0, padding: 0 }} />
            ) : INK_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} title="Color"
                style={{ width: 30, height: 30, borderRadius: 15, border: color === c ? "3px solid #fff" : "2px solid rgba(255,255,255,0.3)", background: c, cursor: "pointer", flexShrink: 0, padding: 0 }} />
            ))}
            {sep}
            <button type="button" style={{ ...btn(), opacity: strokes.length ? 1 : 0.4 }} onClick={() => setAll(strokes.slice(0, -1))} title="Undo">↶</button>
            <button type="button" style={{ ...btn(), fontSize: 15, opacity: strokes.length ? 1 : 0.4 }} onClick={() => setAll([])} title="Clear">Clear</button>
          </>
        );
        const playback = (
          <>
            {isPlayer ? <button type="button" style={btn()} onClick={() => cmd("prev")} title="Last play">⏮</button>
              : <button type="button" style={{ ...btn(), fontSize: 15 }} onClick={() => cmd("skip", { s: -5 })} title="Back 5 s">-5s</button>}
            <button type="button" style={btn(slow)} onClick={() => onRate(slow ? 1 : 0.5)} title="Slow motion (½×)">🐢</button>
            <button type="button" style={{ ...btn(true), minWidth: sz + 12 }} onClick={onToggle} title="Play / pause">{playing ? "❚❚" : "▶"}</button>
            <button type="button" style={btn(fast)} onClick={() => onRate(fast ? 1 : 2)} title="Fast forward (2×)">⏩</button>
            {isPlayer ? <button type="button" style={btn()} onClick={() => cmd("next")} title="Next play">⏭</button>
              : <button type="button" style={{ ...btn(), fontSize: 15 }} onClick={() => cmd("skip", { s: 5 })} title="Ahead 5 s">+5s</button>}
          </>
        );
        const glass = { background: "rgba(11,18,32,0.55)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 6 };
        const row = { display: "flex", alignItems: "center", justifyContent: "center", gap: tight ? 4 : dev.phone ? 5 : 6 };
        return docked ? (
          <div style={{ ...glass, display: "grid", gap: 8, maxWidth: "calc(100vw - 20px)", boxSizing: "border-box" }}>
            <div style={row}>{tools}</div>
            <div style={row}>{playback}</div>
          </div>
        ) : (
          <div style={{ ...glass, ...row, position: "fixed", left: "50%", bottom: "max(10px, env(safe-area-inset-bottom))", transform: "translateX(-50%)", maxWidth: "calc(100vw - 16px)", overflowX: "auto",
            opacity: drawing ? 0.2 : 1, transition: "opacity 0.2s", pointerEvents: drawing ? "none" : "auto" }}>
            {tools}{sep}{playback}
          </div>
        );
      })()}
    </div>
  );
}

// The Display switch + (off Film) the games on the PC's board: tap one to blow it up.
function DisplayPanel({ s, cmd, dev }) {
  const display = s.display || "film";
  const on = display !== "film";
  const slate = useSlate(on);
  const week = display === "past" ? s.dWeek || pastWeekOf(slate, null) : null;
  const pastGames = useWeekGames(display === "past" ? slate : null, week);
  const list = on ? boardList(display, slate?.games, pastGames) : [];
  const team = (t, side, g) => {
    const final = g.status === "final";
    const hp = Number(g.home?.points);
    const ap = Number(g.away?.points);
    const lost = final && (side === "home" ? hp < ap : ap < hp);
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, opacity: lost ? 0.55 : 1 }}>
        {darkLogo(t) ? <img src={darkLogo(t)} alt="" style={{ width: 30, height: 30, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 30, flexShrink: 0 }} />}
        {t.rank ? <span style={{ fontSize: 13, fontWeight: 900, color: GOLD }}>{t.rank}</span> : null}
        <span style={{ ...ellipsis, fontSize: 17, fontWeight: 900 }}>{teamShort(t)}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: g.status === "scheduled" ? 13 : 20, fontWeight: 900, color: g.status === "scheduled" ? MUTED : "#fff", fontVariantNumeric: "tabular-nums" }}>{g.status === "scheduled" ? t.record || "" : t.points ?? 0}</span>
      </span>
    );
  };
  return (
    <div style={{ ...card, gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...head, minWidth: 70 }}>Display</span>
        {DISPLAYS.map(([k, l]) => <button key={k} type="button" style={pill(display === k, k === "live" ? "#c0262d" : BLUE)} onClick={() => cmd("display", { v: k })}>{k === "live" ? "● " : ""}{l}</button>)}
      </div>
      {on && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {s.dGame ? <button type="button" style={pill(true, GOLD)} onClick={() => cmd("dgame", { id: null })}>◂ All games</button>
              : <span style={{ fontSize: 15, fontWeight: 900 }}>{DISPLAY_TITLES[display]}</span>}
            {display === "past" && week && (
              <>
                <span style={{ flex: 1 }} />
                <button type="button" style={pill()} disabled={week <= 1} onClick={() => cmd("dweek", { w: week - 1 })}>‹</button>
                <span style={{ fontSize: 16, fontWeight: 900 }}>Week {week}</span>
                <button type="button" style={pill()} disabled={week >= (slate?.week || 0)} onClick={() => cmd("dweek", { w: week + 1 })}>›</button>
              </>
            )}
            {display !== "past" && <span style={{ fontSize: 13, fontWeight: 800, color: MUTED }}>{slate === undefined ? "Loading…" : `${list.length} game${list.length === 1 ? "" : "s"}`}</span>}
          </div>
          <div style={{ display: "grid", gap: 8, alignContent: "start", ...(dev.phone ? null : { maxHeight: "62vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }) }}>
            {list.map((g) => {
              const sel = String(s.dGame || "") === String(g.id);
              const foot = g.status === "scheduled" ? [kickoffLabel(g.startDate, g.startTimeTBD), g.tv].filter(Boolean).join(" · ")
                : g.status === "in_progress" ? [statusLabel(g), g.situation].filter(Boolean).join(" · ") : statusLabel(g);
              return (
                <button key={g.id} type="button" onClick={() => cmd("dgame", { id: sel ? null : String(g.id) })}
                  style={{ textAlign: "left", borderRadius: 12, border: `2px solid ${sel ? GOLD : LINE}`, background: sel ? "#2a2410" : "#0f1726", color: "#e8edf5", padding: "8px 14px", cursor: "pointer", display: "grid", gap: 4, minWidth: 0 }}>
                  {team(g.away || {}, "away", g)}
                  {team(g.home || {}, "home", g)}
                  <span style={{ ...ellipsis, fontSize: 12, fontWeight: 800, color: g.status === "in_progress" ? "#ff9b8f" : MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>{foot}</span>
                </button>
              );
            })}
            {slate !== undefined && !list.length && (display !== "past" || pastGames !== null) && (
              <div style={{ color: MUTED, fontWeight: 700 }}>{display === "live" ? "No games live right now." : display === "upcoming" ? "No games left to kick off this week." : `No finals in Week ${week}.`}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Full screen (user, 2026-11-27: hiding the film list puts the remote full screen).
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function goFull(on) {
  try {
    const el = document.documentElement;
    if (on && !fsEl()) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
    else if (!on && fsEl()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
  } catch { /* not allowed here (an iPhone) */ }
}

export default function FilmRemote() {
  useWakeLock();
  useBareBody();
  const dev = useDevice();
  const [state, setState] = useState(undefined);
  const [play, setPlay] = useState(null);
  const recv = useRef(0); // when the last playback came in (this device's clock)
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("now");
  const [by, setBy] = useState("player");
  const [q, setQ] = useState("");
  const [yr, setYr] = useState("");
  const [people, setPeople] = useState([]);
  const [games, setGames] = useState([]);
  const [, tick] = useState(0);
  // Taps show at once; the PC's next report settles them.
  const [opt, setOpt] = useState(null); // { playing?, t?, rate?, ms }
  // The film list on the left folds away (remembered on this iPad).
  const [pickOpen, setPickOpen] = useState(() => { try { return localStorage.getItem("wd.film.remote.pick") !== "closed"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("wd.film.remote.pick", pickOpen ? "open" : "closed"); } catch { /* private window */ } }, [pickOpen]);

  useEffect(() => watchState(setState, (e) => setErr(e.message)), []);
  useEffect(() => watchPlay((p) => { recv.current = performance.now(); setPlay(p); setOpt(null); }), []);
  useEffect(() => {
    filmPeople().then((ps) => setPeople(ps.sort((a, b) => String(a.name).localeCompare(String(b.name))))).catch((e) => setErr(e.message));
    listGames().then(setGames).catch(() => {});
  }, []);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(id); }, []);

  // The PC is live when its heartbeat is recent.
  const live = !!play && Date.now() - (play.ms || 0) < 15000;
  const playing = opt?.playing ?? !!play?.playing;
  const rate = opt?.rate ?? play?.rate ?? 1;
  const base = opt?.t ?? play?.t ?? 0;
  const since = opt?.t != null ? (performance.now() - opt.ms) / 1000 : (performance.now() - recv.current) / 1000;
  const tNow = Math.max(0, Math.min(play?.dur || Infinity, base + (playing ? since * rate : 0)));
  // ✏️ Draw: while it's up, the controls go straight over its link to the PC.
  const [drawUp, setDrawUp] = useState(false);
  const drawLink = useRef(null);
  const cmd = (type, args) => {
    if (drawLink.current) { drawLink.current.send({ t: "cmd", type, args: args || {} }); return; }
    sendCmd(type, args).catch((e) => setErr(e.message));
  };
  const toggle = () => { setOpt((o) => ({ ...o, playing: !playing, t: tNow, ms: performance.now() })); cmd("toggle"); };
  const skip = (s) => { setOpt((o) => ({ ...o, t: Math.max(0, tNow + s), ms: performance.now() })); cmd("skip", { s }); };
  const seek = (t) => { setOpt((o) => ({ ...o, t, ms: performance.now() })); cmd("seek", { t }); };
  const setRate = (r) => { setOpt((o) => ({ ...o, rate: r, playing: true, t: tNow, ms: performance.now() })); cmd("rate", { r }); };
  // Slow motion (user, 2026-11-27): HOLD 🐢 ▶ / ◀ = ½× forward / backward;
  // let go and the film pauses (at normal speed for the next ▶).
  const slowStart = (dir) => { setOpt({ playing: true, rate: dir * 0.5, t: tNow, ms: performance.now() }); cmd("slow", { dir }); };
  const slowEnd = () => { setOpt({ playing: false, rate: 1, t: tNow, ms: performance.now() }); cmd("slowEnd"); };
  // Hold the double arrows = fast motion (3x, backwards too), as the Film Manager's arrows; let go and it's back.
  const fastWas = useRef(null);
  const fastStart = (dir) => { fastWas.current = { playing, rate }; setOpt({ playing: true, rate: dir * 3, t: tNow, ms: performance.now() }); cmd("fast", { dir }); };
  const fastEnd = () => { const w = fastWas.current || { playing, rate: 1 }; setOpt({ playing: w.playing, rate: w.rate, t: tNow, ms: performance.now() }); cmd("fastEnd"); };
  const [cutOn, setCutOn] = useState(() => { try { return localStorage.getItem("wd.film.remote.cut") === "on"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("wd.film.remote.cut", cutOn ? "on" : "off"); } catch { /* private window */ } }, [cutOn]);

  const s = state || {};
  // The remote is always YouTube mode, with marks on (user, 2026-11-27): the
  // PC is put there whenever it reports otherwise.
  const fixing = useRef(0);
  useEffect(() => {
    if (!state || Date.now() - fixing.current < 3000) return;
    if (state.layout !== "youtube" || state.marks === false) {
      fixing.current = Date.now();
      if (state.layout !== "youtube") cmd("layout", { v: "youtube" });
      if (state.marks === false) cmd("marks", { on: true });
    }
  }, [state?.layout, state?.marks]); // eslint-disable-line react-hooks/exhaustive-deps
  const isPlayer = s.mode === "player";
  const isGame = s.mode === "game";
  const cur = isPlayer ? (s.list || []).find((p) => p.id === s.curId) : null;
  const curRef = useRef(null);
  useEffect(() => {
    const el = curRef.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const d = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (d < 0 || d + el.offsetHeight > box.clientHeight) box.scrollTo({ top: box.scrollTop + d - 8, behavior: "smooth" });
  }, [s.curId]);

  // The picker.
  const ql = q.trim().toLowerCase();
  const seasons = useMemo(() => [...new Set(games.map(seasonFor).filter(Boolean))].sort((a, b) => b.localeCompare(a)), [games]);
  const gameRows = useMemo(() => games.filter((g) => g.file).map((g) => ({ g, name: filmName(g), season: seasonFor(g), hay: `${filmName(g)} ${g.offense} ${g.defense} ${g.home || ""} ${g.away || ""}`.toLowerCase() }))
    .sort((a, b) => String(b.g.date || b.season).localeCompare(String(a.g.date || a.season)) || a.name.localeCompare(b.name)), [games]);
  const foundGames = gameRows.filter((r) => (!yr || r.season === yr) && (!ql || r.hay.includes(ql))).slice(0, 150);
  // Logos: the games' teams, and the opponents in his play list.
  const brands = useSchools([...foundGames.flatMap(({ g }) => { const x = gameSides(g); return [x.a, x.b]; }), ...(s.list || []).map((p) => p.o)]);
  const foundPeople = people.filter((p) => !ql || `${p.name} ${p.team} ${p.pos}`.toLowerCase().includes(ql)).slice(0, 150);
  const pickPlayer = (p) => { cmd("pickPlayer", { person: { key: p.key, name: p.name, pos: p.pos || "", team: p.team || "", wd: p.wd || null, cfbd: p.cfbd || null } }); setTab("now"); };
  const pickGame = (g) => { cmd("pickGame", { id: g.id }); setTab("now"); };

  // The play's progress (a player's play: inside its range).
  const rin = play?.rin ?? 0;
  const rout = play?.rout ?? (play?.dur || 0);
  const playPct = rout > rin ? Math.max(0, Math.min(100, ((tNow - rin) / (rout - rin)) * 100)) : 0;
  const speeds = isGame ? [1, 2, 4] : [1, 2];

  // The screen: view, side panel, film, the game's side bar — set up even with nothing playing (YouTube mode stays on air).
  const screenCard = (
    <div style={{ ...card, gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...head, minWidth: 70 }}>Face cam</span>
        <button type="button" style={pill(s.cam !== false, GOLD)} onClick={() => cmd("cam", { on: true })}>📷 Show</button>
        <button type="button" style={pill(s.cam === false, GOLD)} onClick={() => cmd("cam", { on: false })}>Hide</button>
      </div>
      {(
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...head, minWidth: 70 }}>Side</span>
          {[["stats", "Stats"], ["info", "Info"], ["site", "We-Draft.com"], ["subscribe", "Subscribe"]].map(([k, l]) => (
            <button key={k} type="button" style={pill((s.side || "stats") === k, GOLD)} onClick={() => cmd("side", { v: k })}>{l}</button>
          ))}
        </div>
      )}
      {(
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...head, minWidth: 70 }}>Center</span>
          {[["film", "Film"], ["background", "Background"], ["community", "Community"], ["logo", "We-Draft.com"], ["screen", "Screen share"]].map(([k, l]) => {
            const off = (k === "background" || k === "community") && !s.canBg;
            return <button key={k} type="button" disabled={off} style={{ ...pill((s.center || "film") === k, BLUE), opacity: off ? 0.4 : 1 }} onClick={() => cmd("center", { v: k })}>{l}</button>;
          })}
          {s.center === "background" && s.canBg && s.shots > 1 && (
            <button type="button" style={pill()} onClick={() => cmd("photo", { d: 1 })}>Photo {(s.shot || 0) + 1} / {s.shots} ›</button>
          )}
          {(s.center === "background" || s.center === "community") && !s.canBg && <span style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>Feature a player first</span>}
        </div>
      )}
      {isPlayer && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...head, minWidth: 70 }}>Film</span>
          <button type="button" style={pill(s.washed)} onClick={() => cmd("washed", { on: true })}>Washed</button>
          <button type="button" style={pill(!s.washed)} onClick={() => cmd("washed", { on: false })}>Original</button>
        </div>
      )}
      {isGame && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...head, minWidth: 70 }}>Side bar</span>
          <select value={s.feat || ""} onChange={(e) => cmd("feature", { id: e.target.value || null })}
            style={{ minHeight: 44, borderRadius: 12, border: "1px solid #334058", background: "#0f1726", color: "#e8edf5", fontSize: 16, padding: "0 12px", flex: 1, minWidth: 0 }}>
            <option value="">The game — final + leaders</option>
            {(s.featOptions || []).map((tm) => <optgroup key={tm.team} label={tm.team}>{tm.players.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}</optgroup>)}
          </select>
        </div>
      )}
    </div>
  );

  // ── The pieces (laid out below for a phone, or for the iPad / PC). ──
  const pickCard = (
    <div className="fr-pick" style={{ ...card, gridTemplateRows: "auto auto auto minmax(0, 1fr)", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={{ ...pill(by === "player", GOLD), flex: 1 }} onClick={() => { setBy("player"); setQ(""); }}>Players</button>
        <button type="button" style={{ ...pill(by === "game", GOLD), flex: 1 }} onClick={() => { setBy("game"); setQ(""); }}>Games</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={by === "player" ? "Search players…" : "Search teams or games…"} type="search"
        style={{ minHeight: 48, borderRadius: 12, border: "1px solid #334058", background: "#0f1726", color: "#e8edf5", fontSize: 17, padding: "0 14px", width: "100%", boxSizing: "border-box" }} />
      {by === "game" ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={pill(!yr)} onClick={() => setYr("")}>All</button>
          {seasons.map((y) => <button key={y} type="button" style={pill(yr === y)} onClick={() => setYr(y)}>{y}</button>)}
        </div>
      ) : <div />}
      <div style={{ display: "grid", gap: 6, overflowY: "auto", alignContent: "start", WebkitOverflowScrolling: "touch", ...(dev.phone ? { gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" } : null) }}>
        {by === "player" ? foundPeople.map((p) => {
          const on = s.who?.key === p.key;
          return (
            <button key={p.key} type="button" onClick={() => pickPlayer(p)} style={{ textAlign: "left", minHeight: 58, borderRadius: 12, border: `1px solid ${on ? GOLD : LINE}`, background: on ? "#2a2410" : "#0f1726", color: "#e8edf5", padding: "8px 14px", cursor: "pointer", display: "grid", gap: 2, minWidth: 0 }}>
              <span style={{ ...ellipsis, fontSize: 17, fontWeight: 900 }}>{p.name}</span>
              <span style={{ ...ellipsis, fontSize: 13, fontWeight: 800, color: MUTED }}>{[p.pos, p.team].filter(Boolean).join(" · ")}</span>
            </button>
          );
        }) : foundGames.map(({ g, name }) => {
          const on = s.game?.id === g.id;
          const x = gameSides(g);
          return (
            <button key={g.id} type="button" onClick={() => pickGame(g)} title={name} style={{ textAlign: "left", minHeight: 64, borderRadius: 12, border: `1px solid ${on ? GOLD : LINE}`, background: on ? "#2a2410" : "#0f1726", color: "#e8edf5", padding: "8px 14px", cursor: "pointer", display: "grid", gap: 4, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <TeamLogo name={x.a} brands={brands} />
                <span style={{ fontSize: 15, fontWeight: 900, color: MUTED }}>{x.sep}</span>
                <TeamLogo name={x.b} brands={brands} />
              </span>
              <span style={{ ...ellipsis, fontSize: 13, fontWeight: 800, color: MUTED }}>{gameSub(g)}</span>
            </button>
          );
        })}
        {by === "player" && !foundPeople.length && <div style={{ color: MUTED, fontWeight: 700 }}>{people.length ? "No one matches." : "Loading players…"}</div>}
        {by === "game" && !foundGames.length && <div style={{ color: MUTED, fontWeight: 700 }}>{games.length ? "No games match." : "Loading games…"}</div>}
      </div>
    </div>
  );

  // What's up: the name, where it is.
  const nowHead = (
    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <div style={{ ...ellipsis, fontSize: dev.phone ? 22 : 26, fontWeight: 900 }}>{isPlayer ? s.who?.name : s.game?.name}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 15, fontWeight: 800, color: "#9fb0c8" }}>
        <span style={ellipsis}>{isPlayer ? (s.loading ? "Loading plays…" : s.count ? <>Play <b style={{ color: GOLD }}>{s.idx + 1}</b> / {s.count}{cur ? ` · ${cur.g}` : ""}</> : "No plays") : "Full game"}</span>
        {cur?.l && <span style={{ flexShrink: 0, padding: "2px 10px", borderRadius: 999, background: LABEL_COLORS[cur.l] || "#334058", color: "#fff", fontSize: 13 }}>{cur.l}</span>}
      </div>
    </div>
  );
  const progress = isGame ? <Scrub t={tNow} dur={play?.dur || 0} ticks={s.ticks || []} onSeek={seek} /> : (
    <div style={{ height: 8, borderRadius: 4, background: "#26324a", overflow: "hidden" }}><div style={{ height: "100%", width: `${playPct}%`, background: GOLD }} /></div>
  );
  const moreRow = (
    <div style={{ display: "flex", gap: dev.phone ? 6 : 8, flexWrap: dev.phone ? "nowrap" : "wrap", alignItems: "center" }}>
      <button type="button" style={dev.phone ? { ...pill(), padding: "0 12px" } : pill()} onClick={() => cmd("restart")}>↺ {dev.phone ? (isPlayer ? "Restart" : "Top") : isPlayer ? "Restart play" : "From the top"}</button>
      {isGame && !dev.phone && <button type="button" style={pill(cutOn, "#15803d")} onClick={() => setCutOn((x) => !x)}>✂ Cut{cutOn ? " · on" : ""}</button>}
      <span style={{ flex: 1 }} />
      {!dev.phone && <span style={head}>Speed</span>}
      {speeds.map((r) => <button key={r} type="button" style={dev.phone ? { ...pill(Math.abs(rate - r) < 0.01, GOLD), padding: "0 12px" } : pill(Math.abs(rate - r) < 0.01, GOLD)} onClick={() => setRate(r)}>{r === 0.5 ? "½×" : `${r}×`}</button>)}
    </div>
  );
  // The phone's transport: the big three, the held speeds under them.
  const phoneTransport = (
    <div style={{ display: "grid", gap: 8, alignContent: "center" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", gap: 8 }}>
        {isPlayer
          ? <button type="button" style={{ ...big(), minHeight: 76, fontSize: 26 }} onClick={() => cmd("prev")} disabled={!s.count} title="Last play">⏮</button>
          : <button type="button" style={{ ...big(), minHeight: 76 }} onClick={() => skip(-5)}>-5s</button>}
        <button type="button" style={{ ...big(true, GOLD), minHeight: 76, color: "#00264d", fontSize: 28 }} onClick={toggle}>{playing ? "❚❚" : "▶"}</button>
        {isPlayer
          ? <button type="button" style={{ ...big(), minHeight: 76, fontSize: 26 }} onClick={() => cmd("next")} disabled={!s.count} title="Next play">⏭</button>
          : <button type="button" style={{ ...big(), minHeight: 76 }} onClick={() => skip(5)}>+5s</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isPlayer ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 8 }}>
        {isGame && <HoldBtn title="Hold to rewind" onStart={() => fastStart(-1)} onEnd={fastEnd} style={{ ...big(rate <= -2.9, BLUE), minHeight: 60, padding: 0, fontSize: 20 }}>◀◀</HoldBtn>}
        <HoldBtn title="Hold: slow motion backward" onStart={() => slowStart(-1)} onEnd={slowEnd} style={{ ...big(Math.abs(rate + 0.5) < 0.01, BLUE), minHeight: 60, padding: 0, fontSize: 17 }}>🐢 ◀</HoldBtn>
        <HoldBtn title="Hold: slow motion" onStart={() => slowStart(1)} onEnd={slowEnd} style={{ ...big(Math.abs(rate - 0.5) < 0.01, BLUE), minHeight: 60, padding: 0, fontSize: 17 }}>🐢 ▶</HoldBtn>
        {isGame && <HoldBtn title="Hold to fast-forward" onStart={() => fastStart(1)} onEnd={fastEnd} style={{ ...big(rate >= 2.9, BLUE), minHeight: 60, padding: 0, fontSize: 20 }}>▶▶</HoldBtn>}
      </div>
    </div>
  );
  const tabletTransport = isPlayer ? (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 1.3fr 0.8fr 1fr", gap: 10 }}>
      <button type="button" style={{ ...big(), whiteSpace: "nowrap", fontSize: 17, padding: "0 8px" }} onClick={() => cmd("prev")} disabled={!s.count}>⏮ Last play</button>
      <HoldBtn title="Hold: slow motion backward" onStart={() => slowStart(-1)} onEnd={slowEnd} style={big(Math.abs(rate + 0.5) < 0.01, BLUE)}>🐢 ◀</HoldBtn>
      <button type="button" style={{ ...big(true, GOLD), color: "#00264d", fontSize: 24 }} onClick={toggle}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
      <HoldBtn title="Hold: slow motion" onStart={() => slowStart(1)} onEnd={slowEnd} style={big(Math.abs(rate - 0.5) < 0.01, BLUE)}>🐢 ▶</HoldBtn>
      <button type="button" style={{ ...big(), whiteSpace: "nowrap", fontSize: 17, padding: "0 8px" }} onClick={() => cmd("next")} disabled={!s.count}>Next play ⏭</button>
    </div>
  ) : (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.4fr 1fr 1fr 1fr", gap: 8 }}>
      <HoldBtn title="Hold to rewind" onStart={() => fastStart(-1)} onEnd={fastEnd} style={{ ...big(rate <= -2.9, BLUE), fontSize: 22 }}>◀◀</HoldBtn>
      <HoldBtn title="Hold: slow motion backward" onStart={() => slowStart(-1)} onEnd={slowEnd} style={big(Math.abs(rate + 0.5) < 0.01, BLUE)}>🐢 ◀</HoldBtn>
      <button type="button" style={big()} onClick={() => skip(-5)}>-5s</button>
      <button type="button" style={{ ...big(true, GOLD), color: "#00264d", fontSize: 22 }} onClick={toggle}>{playing ? "❚❚" : "▶"}</button>
      <button type="button" style={big()} onClick={() => skip(5)}>+5s</button>
      <HoldBtn title="Hold: slow motion" onStart={() => slowStart(1)} onEnd={slowEnd} style={big(Math.abs(rate - 0.5) < 0.01, BLUE)}>🐢 ▶</HoldBtn>
      <HoldBtn title="Hold to fast-forward" onStart={() => fastStart(1)} onEnd={fastEnd} style={{ ...big(rate >= 2.9, BLUE), fontSize: 22 }}>▶▶</HoldBtn>
    </div>
  );

  // A player's plays: tap one to jump to it.
  const playsCard = isPlayer && (
    <div style={card}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["all", ...LABELS, "untagged"].map((l) => <button key={l} type="button" style={pill(s.labelF === l, LABEL_COLORS[l] || BLUE)} onClick={() => cmd("label", { l })}>{l === "all" ? "All" : l === "untagged" ? "No label" : l}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(124px, 1fr))", gap: 8, ...(dev.phone ? null : { maxHeight: "48vh", overflowY: "auto", WebkitOverflowScrolling: "touch" }) }}>
        {(s.list || []).map((p, i) => {
          const on = p.id === s.curId;
          return (
            <button key={p.id} ref={on ? curRef : null} type="button" onClick={() => cmd("jump", { id: p.id })} title={p.g} style={{ minHeight: 60, borderRadius: 12, border: `2px solid ${on ? GOLD : LINE}`, background: on ? "#2a2410" : "#0f1726", color: "#e8edf5", padding: "6px 10px", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: MUTED, width: 22, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
              {p.o ? <TeamLogo name={p.o} brands={brands} size={38} /> : <span style={{ ...ellipsis, fontSize: 12, fontWeight: 800, flex: 1 }}>{p.g}</span>}
              <span style={{ fontSize: 20, fontWeight: 900, color: on ? GOLD : "#e8edf5", marginLeft: "auto" }}>{yy(p.y)}</span>
            </button>
          );
        })}
        {!s.loading && !(s.list || []).length && <div style={{ color: MUTED, fontWeight: 700 }}>No plays{s.labelF !== "all" ? " with that label" : ""}.</div>}
      </div>
    </div>
  );

  const liveChip = (
    <span title={live ? "The PC's Viewer is up" : "On the PC: Admin → Film Manager → Viewer (keep it open)"} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: dev.phone ? "4px 10px" : "5px 12px", borderRadius: 999, background: live ? "#0f3a24" : "#3a1a14", color: live ? "#4ade80" : "#ff9b8f", fontSize: 13, fontWeight: 900, flexShrink: 0 }}>
      <span style={{ width: 9, height: 9, borderRadius: 5, background: live ? "#4ade80" : "#ff6b5b" }} />{live ? (dev.phone ? "PC" : "PC Viewer live") : dev.phone ? "PC off" : "PC Viewer not open"}
    </span>
  );
  const drawMode = drawUp && s.mode && <DrawMode s={s} dev={dev} playing={playing} rate={rate} onToggle={toggle} onRate={setRate} cmd={cmd} linkRef={drawLink} onClose={() => setDrawUp(false)} />;

  // ── A phone, held sideways (user, 2026-11-27: "it will only be used
  // landscape"): a controller — a slim bar (tabs + ✏️ Draw) and one tab at a
  // time, each fitting the short screen: Now (what's up on the left, the big
  // buttons on the right) · Screen · Plays (a game: Cut) · Pick. ──
  if (dev.phone) {
    const tabs = [["now", "Now"], ["display", s.display && s.display !== "film" ? "● Display" : "Display"], ["screen", "Screen"], ...(isPlayer ? [["plays", "Plays"]] : isGame ? [["cut", "✂ Cut"]] : []), ["pick", "Pick"]];
    const at = tabs.some(([k]) => k === tab) ? tab : "now";
    const tabBtn = (on) => ({ minHeight: 40, borderRadius: 10, border: "none", background: on ? GOLD : "transparent", color: on ? "#00264d" : "#c4cfdf", fontSize: 15, fontWeight: 900, padding: "0 12px", cursor: "pointer", flexShrink: 0 });
    return (
      <div className="fr" data-device="phone">
        <Helmet><title>Film Remote · We-Draft.com</title><meta name="robots" content="noindex" /></Helmet>
        <style>{CSS}</style>
        {drawMode}
        <div className="frp-bar">
          <span style={{ fontSize: 18, flexShrink: 0 }}>🎞️</span>
          {liveChip}
          <div style={{ display: "flex", gap: 2, flex: 1, minWidth: 0, overflowX: "auto", justifyContent: "center" }}>
            {tabs.map(([k, l]) => <button key={k} type="button" style={tabBtn(at === k)} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <button type="button" disabled={!s.mode} onClick={() => setDrawUp(true)} title="Pop into the film and draw on it"
            style={{ minHeight: 40, borderRadius: 10, border: "none", background: GOLD, color: "#00264d", fontSize: 15, fontWeight: 900, padding: "0 14px", cursor: "pointer", flexShrink: 0, opacity: s.mode ? 1 : 0.4 }}>✏️ Draw</button>
        </div>
        {err && <div style={{ padding: "6px 12px 0", fontSize: 12, fontWeight: 700, color: "#ff7a6b" }}>{err}</div>}
        <div className="frp-body">
          {at === "pick" ? pickCard
            : at === "screen" ? screenCard
              : at === "display" || (at === "now" && s.display && s.display !== "film") ? <DisplayPanel s={s} cmd={cmd} dev={dev} />
              : state === undefined ? <div style={{ ...card, color: MUTED, fontWeight: 800 }}>Connecting…</div>
                : !s.mode ? (
                  <div style={{ ...card, color: MUTED, fontWeight: 800, fontSize: 16 }}>
                    Nothing playing.
                    <button type="button" style={{ ...pill(true, GOLD), color: "#00264d", justifySelf: "start" }} onClick={() => setTab("pick")}>Pick a player or a game</button>
                  </div>
                )
                  : at === "plays" ? playsCard
                    : at === "cut" ? <CutPanel s={s} t={tNow} cmd={cmd} />
                      : (
                        <div style={{ ...card, gridTemplateColumns: dev.portrait ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1.15fr)", alignItems: "center", gap: 14 }}>
                          <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
                            {nowHead}
                            {progress}
                            {moreRow}
                          </div>
                          {phoneTransport}
                        </div>
                      )}
        </div>
      </div>
    );
  }

  // ── The iPad (and a PC window): the film list beside what's playing. ──
  return (
    <div className="fr" data-device={dev.kind} data-narrow={dev.narrow ? "1" : "0"}>
      <Helmet><title>Film Remote · We-Draft.com</title><meta name="robots" content="noindex" /></Helmet>
      <style>{CSS}</style>
      {/* Status */}
      <div className="fr-top" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 0", flexWrap: "wrap" }}>
        <span style={{ fontSize: 20, fontWeight: 900 }}>🎞️ Film Remote</span>
        {liveChip}
        {!live && <span style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>On the PC: Admin → Film Manager → Viewer (keep it open).</span>}
        {err && <span style={{ fontSize: 12, fontWeight: 700, color: "#ff7a6b" }}>{err}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="fr-collapse" style={pill(pickOpen)} onClick={() => { const next = !pickOpen; setPickOpen(next); goFull(!next); }}>{pickOpen ? "◂ Hide film list" : "▸ Film list"}</button>
        <div className="fr-tabs" style={{ gap: 6 }}>
          <button type="button" style={pill(tab === "now", GOLD)} onClick={() => setTab("now")}>Now playing</button>
          <button type="button" style={pill(tab === "pick", GOLD)} onClick={() => setTab("pick")}>Pick film</button>
        </div>
      </div>

      {drawMode}
      {!drawUp && s.mode && (
        <button type="button" onClick={() => setDrawUp(true)} title="Pop into the film and draw on it"
          style={{ position: "fixed", right: 18, bottom: "max(18px, env(safe-area-inset-bottom))", zIndex: 50, minHeight: 60, padding: "0 22px", borderRadius: 999, border: "none", background: GOLD, color: "#00264d", fontSize: 19, fontWeight: 900, boxShadow: "0 6px 20px rgba(0,0,0,0.45)", cursor: "pointer" }}>✏️ Draw</button>
      )}

      <div className="fr-grid" data-tab={tab === "pick" ? "pick" : "now"} data-pick={pickOpen ? "open" : "closed"}>
        {/* Pick what's playing */}
        {pickCard}

        {/* What's playing, and moving around in it */}
        <div className="fr-now" style={{ display: "grid", gap: 14, minWidth: 0 }}>
          {state === undefined ? <div style={{ ...card, color: MUTED, fontWeight: 800 }}>Connecting…</div> : s.display && s.display !== "film" ? (
            <>
              <DisplayPanel s={s} cmd={cmd} dev={dev} />
              {screenCard}
            </>
          ) : !s.mode ? (
            <>
              <DisplayPanel s={s} cmd={cmd} dev={dev} />
              <div style={{ ...card, color: MUTED, fontWeight: 800, fontSize: 16 }}>Nothing playing — pick a player or a game.</div>
              {screenCard}
            </>
          ) : (
            <>
              <DisplayPanel s={s} cmd={cmd} dev={dev} />
              <div style={card}>
                {nowHead}
                {progress}
                {tabletTransport}
                {moreRow}
              </div>
              {isGame && cutOn && <CutPanel s={s} t={tNow} cmd={cmd} />}
              {screenCard}
              {playsCard}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
