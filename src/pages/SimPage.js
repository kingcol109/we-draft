// src/pages/SimPage.js
// ── /sim — Football Simulation Lab (admin + beta-tester prototype, V2).
//
// Routed behind SimRoute (App.js): admins, reached from the Admin panel's
// "Football Sim" section, and users granted simBeta, reached from their
// profile. Noindexed here and disallowed in robots.txt.
// Runs entirely in the browser. Nothing is written to Firestore; Dynasty
// mode reads team branding from the `nfl` collection (rosters are the
// bundled league defaults, src/sim/dynasty/defaultRosters.json).
//
// This component is only the shell: controls, input wiring, the
// requestAnimationFrame loop and the debug panel. The simulation itself is
// src/sim/ (engine.js → systems/ + ai/), and drawing is src/sim/render.js. ──

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { SimEngine } from "../sim/engine";
import { OFFENSE_PLAYS, COVERAGES, FORMATIONS, FRONTS, coveragesFor } from "../sim/playbook";
import { TUNING } from "../sim/config";
import { createCamera, updateCamera, renderFrame, toField, demoLength } from "../sim/render";
import { newDrive, applyResult, downLabel, spotLabel, driveSummary } from "../sim/drive";
import SimPlayCall from "../components/SimPlayCall";
import { buildRecap } from "../sim/recap";
import DynastyHub from "../components/DynastyHub";
import SimHelp from "../components/SimHelp";
import { LessonList, LessonArticle } from "../components/SimLearn";
import { LESSONS } from "../sim/lessons";
import { offenseLineup, defenseLineup } from "../sim/dynasty/lineup";
import { collection, getDocs, query, where } from "firebase/firestore";
import { generateLeague, namePools } from "../sim/dynasty/generate";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

const DYNASTY_KEY = "simDynasty"; // this browser's franchise + opponent pick
const COLLEGE_KEY = "simCollege"; // …and in College mode
// College mode: the Power 4 conferences (as the schools collection names
// them) and Notre Dame (an independent).
const COLLEGE_CONFERENCES = ["ACC", "Big 10", "Big 12", "SEC"];
const COLLEGE_SEED = 2027;
// A logo / wordmark field as a usable URL (some are stored without https://).
const assetUrl = (u) => {
  const t = String(u || "").trim();
  return !t ? "" : /^https?:\/\//i.test(t) ? t : `https://${t}`;
};
// The home team's field: its logo at midfield, its end zones in its primary
// color with its dark wordmark (render.js drawField).
const homeFieldOf = (b) => (b ? { logo: assetUrl(b.Logo1 || b.Logo2), wordmark: assetUrl(b.WordmarkDark || b.Wordmark), color: b.Color1 || null } : undefined);
const HELP_SEEN_KEY = "simHelpSeen"; // help overlay already shown once here
const LEARN_SPOT = 85; // Learn mode snaps from the far 25 (absolute field y: opponent's goal line is 110)
function loadDynastyPick(key = DYNASTY_KEY) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}
function saveDynastyPick(v, key = DYNASTY_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode etc. - the pick just isn't remembered */
  }
}

const pick = (arr, r = Math.random()) => arr[Math.floor(r * arr.length)];

const BLUE = "#0055A5";
const ORANGE = "#F6A21D";
const MAX_STEPS_PER_FRAME = 8;

const btn = (active) => ({
  padding: "6px 12px",
  borderRadius: "6px",
  border: `1px solid ${active ? ORANGE : "#475569"}`,
  background: active ? "rgba(246,162,29,0.18)" : "#1e293b",
  color: active ? ORANGE : "#e2e8f0",
  fontWeight: 700,
  fontSize: "12px",
  cursor: "pointer",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
});
const sel = {
  padding: "5px 8px",
  borderRadius: "6px",
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#e2e8f0",
  fontWeight: 700,
  fontSize: "12px",
};

// Form (variance on): green = sharp today, red = off.
const formColor = (z) => (z > 0.8 ? "#4ade80" : z < -0.8 ? "#f87171" : "#94a3b8");

function Bar({ value, color }) {
  return (
    <div style={{ width: "60px", height: "6px", background: "#334155", borderRadius: "3px", display: "inline-block" }}>
      <div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height: "100%", background: color, borderRadius: "3px" }} />
    </div>
  );
}

export default function SimPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const maskRef = useRef(null);
  const engineRef = useRef(null);
  const camRef = useRef(createCamera());
  const [config, setConfig] = useState({ formation: "spreadWeak", play: "smash", front: "4-3", coverage: "tampa2", readEnd: "random", variance: false });
  const [ui, setUi] = useState({ debug: false, mask: false, paused: false, speed: 1, autoReset: true, zoom: 1, selectedId: null, showArt: false, showDefArt: false });
  const uiRef = useRef(ui);
  const [snap, setSnap] = useState(null);

  // ── Drive mode: pick a play from the play-call screen, the defense is
  // random, and the chains move. The lab (everything else) is untouched.
  const [mode, setMode] = useState("lab");
  const [drive, setDrive] = useState(null);
  const [picking, setPicking] = useState(false);
  const [lastPlay, setLastPlay] = useState(null);
  const [driveEnd, setDriveEnd] = useState(null);
  const [recap, setRecap] = useState(null); // last-play recap on the play-call screen: { call, recap, driveEnd }
  // Dynasty: drive mode with real rosters. `dyn` = { league, branding, team, opponent }.
  const [dyn, setDyn] = useState(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [dynError, setDynError] = useState(null);
  // Learn: a lesson per concept (src/sim/lessons.js) beside the live field.
  // lessonActive = the demo / scenario on the field ("d:2:0", "s:3:1").
  const [lessonId, setLessonId] = useState(null);
  const [lessonActive, setLessonActive] = useState(null);
  const demoRun = useRef(0); // bumped on every ▶ — restarts the demo's clock
  const demoRotate = useRef(null); // { list, i } (a rotating demo) or { next } (Try it) — a new setup each rep
  // Learn's "Try it": the field is playable — the lesson's plays and the
  // fronts, each picked or rotating rep to rep.
  const [tryOn, setTryOn] = useState(false);
  const [trySel, setTrySel] = useState({ play: "rotate", front: "rotate" });
  const tryRef = useRef(false);
  tryRef.current = tryOn;
  const trySelRef = useRef(trySel);
  const tryAt = useRef({ p: 0, f: 0 }); // where each rotation is
  const lessonIdRef = useRef(null);
  lessonIdRef.current = lessonId;
  const applySetupRef = useRef(null);
  const dynRef = useRef(dyn);
  dynRef.current = dyn;
  const hubRef = useRef(hubOpen);
  hubRef.current = hubOpen;
  // "? Help" overlay — opens on its own the first time this browser visits.
  const [helpOpen, setHelpOpen] = useState(() => {
    try { return !localStorage.getItem(HELP_SEEN_KEY); } catch { return false; }
  });
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    try { localStorage.setItem(HELP_SEEN_KEY, "1"); } catch { /* storage blocked */ }
  }, []);
  const helpRef = useRef(helpOpen);
  helpRef.current = helpOpen;
  const modeRef = useRef(mode);
  const driveRef = useRef(drive);
  const pickingRef = useRef(picking);
  const callRef = useRef(null);
  const labVariance = useRef(false);
  modeRef.current = mode;
  driveRef.current = drive;
  pickingRef.current = picking;

  if (!engineRef.current) engineRef.current = new SimEngine(config);
  uiRef.current = ui;

  // Config changes rebuild the play.
  useEffect(() => {
    engineRef.current.setConfig(config);
  }, [config]);
  useEffect(() => {
    // (Learn always resets — its demos loop.)
    engineRef.current.autoReset = mode === "learn" || (mode === "lab" && ui.autoReset);
    camRef.current.zoom = ui.zoom;
  }, [ui.autoReset, ui.zoom, mode]);

  // Put the ball down at the drive's spot (the field shows behind the
  // play-call screen) and point the camera there.
  const spotBall = useCallback((d, patch = {}) => {
    setConfig((c) => ({ ...c, ...patch, ballOn: d.ballOn, lineToGain: d.lineToGain }));
    camRef.current.y = d.ballOn + 8;
  }, []);

  const finishPlay = useCallback(
    (result) => {
      const cur = driveRef.current;
      if (!cur || !callRef.current) return;
      const call = callRef.current;
      const { drive: after, text } = applyResult(cur, result, call.name);
      setLastPlay({ call: call.name, defense: call.defense, text });
      let next = after;
      let ended = null;
      if (after.over) {
        ended = { ...after.over, n: after.n, summary: driveSummary(after) };
        setDriveEnd(ended);
        next = newDrive(after);
      }
      // The recap is read off the engine now, before the next spot resets it.
      setRecap({ call, recap: buildRecap(engineRef.current, result, text), driveEnd: ended });
      callRef.current = null;
      setDrive(next);
      spotBall(next);
      setPicking(true);
    },
    [spotBall]
  );

  const enterDrive = () => {
    const d = newDrive();
    labVariance.current = config.variance;
    setMode("drive");
    setDrive(d);
    setLastPlay(null);
    setDriveEnd(null);
    setRecap(null);
    callRef.current = null;
    engineRef.current.autoReset = false;
    engineRef.current.onFinished = finishPlay;
    spotBall(d, { variance: true }); // drive mode plays with variance on by default
    setPicking(true);
  };
  const exitDrive = () => {
    setMode("lab");
    setLessonId(null);
    setTryOn(false);
    setLessonActive(null);
    update({ demo: null, speed: 1, demoFrontBar: false });
    engineRef.current.autopilot = null;
    demoRotate.current = null;
    setDrive(null);
    setPicking(false);
    setRecap(null);
    setHubOpen(false);
    engineRef.current.onFinished = null;
    setConfig((c) => ({ ...c, ballOn: undefined, lineToGain: undefined, variance: labVariance.current, lineup: undefined, seed: undefined, fits: undefined, juice: undefined, homeField: undefined }));
    camRef.current.y = 68;
  };

  // ── Learn: a concept's lesson (src/sim/lessons.js). Every field change
  // goes through applySetup — a fresh config object, so the play rebuilds
  // back to pre-snap even when nothing in it changed (a "Show me" mid-rep
  // tees it back up). Variance stays off so a rep plays the same way twice. ──
  const applySetup = (setup) => {
    setConfig((c) => {
      const next = { ...c, ballOn: LEARN_SPOT, lineToGain: undefined, lineup: undefined, variance: false, seed: undefined, fits: undefined, juice: undefined, ...setup };
      if (!OFFENSE_PLAYS[next.play].formations.includes(next.formation)) next.formation = OFFENSE_PLAYS[next.play].formations[0];
      const calls = coveragesFor(next.front);
      if (!calls.includes(next.coverage)) next.coverage = calls[0];
      return next;
    });
  };
  applySetupRef.current = applySetup;
  // Run a section's demo ("d:<section>:<i>"): set the field up, and from
  // then on it loops by itself — the overlay plays out pre-snap, the play
  // snaps and runs on autopilot, auto-reset tees it back up (see the frame
  // loop). demoRun restarts the overlay's clock.
  const showDemo = (id, si, i) => {
    const sec = LESSONS[id].sections[si];
    const d = sec.demos[i];
    // A rotating demo (a list of setups — say, one front per rep) starts on
    // the first; the frame loop moves to the next after each rep.
    setTryOn(false);
    // Demos are juiced toward the side of the ball the lesson teaches.
    const juice = LESSONS[id].side === "defense" ? "D" : "O";
    demoRotate.current = d.rotate ? { list: d.rotate, i: 0, run: d.run, juice } : null;
    const { run, ...first } = d.rotate ? d.rotate[0] : d.setup || {};
    applySetup({ ...first, juice });
    engineRef.current.autopilot = { run: run || d.run || "read" };
    demoRun.current += 1;
    setLessonActive(`d:${si}:${i}`);
    // The section's heading and the demo's `watch` line caption the field;
    // the front bar names what the offense is blocking.
    update({ demo: d.demo, demoKicker: sec.heading, demoWatch: d.watch || null, demoFrontBar: true });
  };
  const openLesson = (id) => {
    setLessonId(id);
    lessonIdRef.current = id;
    setTryOn(false);
    const opening = { ...LESSONS[id].setup };
    delete opening.run; // (a rotation rep's run isn't part of the field)
    applySetup({ readEnd: "random", ...opening });
    camRef.current.y = LEARN_SPOT + 8;
    // Open on the first section's demo.
    const si = LESSONS[id].sections.findIndex((s) => s.demos && s.demos.length);
    if (si >= 0) showDemo(id, si, 0);
    else {
      setLessonActive(null);
      update({ demo: null });
    }
  };
  // ── Try it: the next rep's setup — the picked play / front, or the next
  // one in each rotation (advance) — with a fresh coverage and read each
  // rep, and no pinned seed or scripted fits: the real thing. ──
  const nextTrySetup = (advance) => {
    const { plays, front: lockedFront } = LESSONS[lessonIdRef.current].tryIt;
    const fronts = Object.keys(FRONTS);
    const at = tryAt.current;
    const sel = trySelRef.current;
    if (advance) {
      if (sel.play === "rotate") at.p = (at.p + 1) % plays.length;
      if (sel.front === "rotate") at.f = (at.f + 1) % fronts.length;
    }
    const p = plays[sel.play === "rotate" ? at.p : sel.play];
    // (A defense lesson's Try it is always against its own front.)
    const front = lockedFront || (sel.front === "rotate" ? fronts[at.f] : sel.front);
    const calls = coveragesFor(front);
    return { play: p.play, formation: p.formation, front, coverage: calls[Math.floor(Math.random() * calls.length)], readEnd: "random" };
  };
  const startTry = () => {
    setTryOn(true);
    tryAt.current = { p: 0, f: 0 };
    engineRef.current.autopilot = null;
    demoRotate.current = { next: () => nextTrySetup(true) };
    applySetup(nextTrySetup(false));
    setLessonActive("try");
    update({ demo: null, demoWatch: null, demoFrontBar: true, speed: 1, paused: false });
  };
  const pickTry = (patch) => {
    const sel = { ...trySelRef.current, ...patch };
    trySelRef.current = sel;
    setTrySel(sel);
    applySetup(nextTrySetup(false));
  };
  const enterLearn = () => {
    labVariance.current = config.variance;
    setMode("learn");
    setDrive(null);
    setPicking(false);
    setRecap(null);
    engineRef.current.onFinished = null;
    update({ speed: 0.5, paused: false }); // demos at half speed, easier to follow
    openLesson(Object.keys(LESSONS)[0]);
  };

  // ── Dynasty: load the league (bundled rosters) and branding (Firestore),
  // open the front office. ──
  // college: the Power 4 + Notre Dame from `schools`, rosters generated
  // here (seeded, so every visit is the same league) from the NFL rosters'
  // generated name pool — nobody real.
  const enterDynasty = async (college = false) => {
    if (!isAdmin) return;
    setDynError(null);
    try {
      const [mod, snap] = await Promise.all([
        import("../sim/dynasty/defaultRosters.json"),
        college ? getDocs(query(collection(db, "schools"), where("Conference", "in", [...COLLEGE_CONFERENCES, "Independent"]))) : getDocs(collection(db, "nfl")),
      ]);
      const nfl = mod.default || mod;
      const branding = {};
      let league = nfl;
      if (college) {
        for (const d of snap.docs) {
          const s = d.data();
          if (s.Conference === "Independent" && s.School !== "Notre Dame") continue;
          branding[s.Slug || d.id] = s;
        }
        const names = namePools(Object.values(nfl.teams).flatMap((t) => t.players));
        league = generateLeague({ teams: Object.keys(branding), names, seed: COLLEGE_SEED, college: true });
      } else snap.docs.forEach((d) => (branding[d.id] = d.data()));
      const saved = loadDynastyPick(college ? COLLEGE_KEY : DYNASTY_KEY);
      const team = league.teams[saved.team] ? saved.team : null;
      const opponent = league.teams[saved.opponent] && saved.opponent !== team ? saved.opponent : null;
      labVariance.current = config.variance;
      setDyn({ league, branding, team, opponent, college });
      if (team) setConfig((c) => ({ ...c, homeField: homeFieldOf(branding[team]) }));
      setMode("dynasty");
      setDrive(null);
      setPicking(false);
      setRecap(null);
      engineRef.current.autoReset = false;
      engineRef.current.onFinished = null;
      setHubOpen(true);
    } catch (e) {
      console.error(e);
      setDynError(college ? "Couldn't load College (schools from Firestore)." : "Couldn't load Dynasty (team branding from Firestore).");
    }
  };
  const pickDynasty = (patch) => {
    setDyn((d) => {
      const next = { ...d, ...patch };
      // Your opponent can't be you; default to the next club alphabetically.
      if (!next.opponent || next.opponent === next.team) {
        const ks = Object.keys(next.league.teams).sort();
        next.opponent = ks[(ks.indexOf(next.team) + 1) % ks.length];
      }
      saveDynastyPick({ team: next.team, opponent: next.opponent }, next.college ? COLLEGE_KEY : DYNASTY_KEY);
      return next;
    });
    // Your home field: your logo at midfield, your end zones.
    if (patch.team) setConfig((c) => ({ ...c, homeField: homeFieldOf(dyn && dyn.branding[patch.team]) }));
  };
  // A fresh drive for your offense against the opponent's defense.
  const playDynastyDrive = () => {
    const d = newDrive();
    setDrive(d);
    setLastPlay(null);
    setDriveEnd(null);
    setRecap(null);
    callRef.current = null;
    engineRef.current.autoReset = false;
    engineRef.current.onFinished = finishPlay;
    spotBall(d, { variance: true });
    setHubOpen(false);
    setPicking(true);
  };
  // Call a play: the defense's call is random.
  const callPlay = (formation, play) => {
    const front = pick(Object.keys(FRONTS));
    const coverage = pick(coveragesFor(front));
    callRef.current = {
      name: OFFENSE_PLAYS[play].label,
      defense: `${FRONTS[front]} ${COVERAGES[coverage]}`,
      formation: FORMATIONS[formation].label,
      front: FRONTS[front],
      coverage: COVERAGES[coverage],
    };
    // Dynasty: your starters on offense, the opponent's on defense (for the
    // front they're in this snap).
    let lineup;
    const dd = dynRef.current;
    if (modeRef.current === "dynasty" && dd && dd.team && dd.opponent) {
      const B = dd.branding;
      lineup = {
        O: offenseLineup(dd.league.teams[dd.team]),
        D: defenseLineup(dd.league.teams[dd.opponent], front),
        teams: {
          O: { abbr: dd.team, color: (B[dd.team] && B[dd.team].Color1) || null },
          D: { abbr: dd.opponent, color: (B[dd.opponent] && B[dd.opponent].Color1) || null },
        },
      };
      callRef.current.offTeam = dd.team;
      callRef.current.defTeam = dd.opponent;
    }
    spotBall(driveRef.current, { formation, play, front, coverage, readEnd: "random", lineup });
    setDriveEnd(null);
    setPicking(false);
  };

  const update = (patch) => setUi((u) => ({ ...u, ...patch }));

  // ── Canvas sizing ──
  useEffect(() => {
    const wrap = wrapRef.current;
    const fit = () => {
      const w = wrap.clientWidth;
      const h = Math.max(360, Math.min(window.innerHeight - 130, w * 0.78));
      const dpr = window.devicePixelRatio || 1;
      for (const c of [canvasRef.current, maskRef.current]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      canvasRef.current.style.width = `${w}px`;
      canvasRef.current.style.height = `${h}px`;
      camRef.current.W = w;
      camRef.current.H = h;
      camRef.current.dpr = dpr;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // ── Main loop: fixed-step simulation, render every frame ──
  useEffect(() => {
    const engine = engineRef.current;
    const ctx = canvasRef.current.getContext("2d");
    const mctx = maskRef.current.getContext("2d");
    let raf;
    let last = performance.now();
    let acc = 0;
    let lastSnap = 0;
    // Learn demos: seconds this rep has sat pre-snap (the overlay's clock);
    // when the overlay has played out, the play snaps itself.
    let demoT = 0;
    let demoSeen = demoRun.current;
    let lastState = engine.state;
    const frame = (now) => {
      const u = uiRef.current;
      const real = Math.min(0.1, (now - last) / 1000);
      last = now;
      // A rep just ended and teed back up: a rotating demo moves on to its
      // next setup (the next front).
      const rot = demoRotate.current;
      if (rot && lastState === "PLAY_END" && engine.state === "PRE_SNAP") {
        if (rot.next) applySetupRef.current(rot.next());
        else {
          rot.i = (rot.i + 1) % rot.list.length;
          // (A rep can say how the back takes it — `run` — over the demo's.)
          const { run, ...next } = rot.list[rot.i];
          engine.autopilot = { ...engine.autopilot, run: run || rot.run || "read" };
          applySetupRef.current({ ...next, juice: rot.juice });
        }
      }
      lastState = engine.state;
      if (u.demo && engine.autopilot) {
        if (demoSeen !== demoRun.current || engine.state !== "PRE_SNAP") demoT = 0;
        else if (!u.paused) demoT += real;
        demoSeen = demoRun.current;
        // (engine.t ≥ 2: the players' pre-snap read of the defense has
        // settled, so the pinned seed plays the same at any speed.)
        if (engine.state === "PRE_SNAP" && demoT > demoLength(u.demo) + 0.5 && engine.t >= 2) {
          engine.snap();
          demoT = 0;
        }
      }
      if (!u.paused) {
        acc += real * u.speed;
        let n = 0;
        while (acc >= TUNING.dt && n < MAX_STEPS_PER_FRAME) {
          engine.step(TUNING.dt);
          acc -= TUNING.dt;
          n++;
        }
        if (n === MAX_STEPS_PER_FRAME) acc = 0;
      }
      const cam = camRef.current;
      updateCamera(cam, engine, cam.W, cam.H, cam.dpr);
      // Carrying the ball, the cursor is a joystick: it stays put on screen
      // as the camera follows him, so it keeps pointing where you meant.
      if (!engine.autopilot && engine.runnerControlled() && engine.input.screen) engine.input.mouse = toField(cam, engine.input.screen.x, engine.input.screen.y);
      renderFrame(ctx, mctx, cam, engine, u.demo ? { ...u, demoT } : u, now);
      if (now - lastSnap > (u.debug ? 150 : 400)) {
        lastSnap = now;
        setSnap(engine.snapshot());
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Keyboard ──
  useEffect(() => {
    const engine = engineRef.current;
    const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    const down = (e) => {
      if (typing(e)) return;
      if (pickingRef.current || hubRef.current || helpRef.current) return; // the play-call screen / front office / help is up
      const k = e.key.toLowerCase();
      // Learn: the demos run themselves — only the viewing keys work
      // (pause / step, debug, vision mask, play art).
      if (modeRef.current === "learn" && !tryRef.current && !["p", ".", "b", "v", "z", "x"].includes(k)) {
        if (k === " ") e.preventDefault();
        return;
      }
      if (["w", "a", "s", "d"].includes(k)) {
        // Carrying the ball: A / D are hard cuts (left / right), W bursts
        // downhill.
        if ((k === "a" || k === "d" || k === "w") && engine.runnerControlled()) {
          if (!e.repeat) {
            if (k === "w") engine.burst();
            else engine.hardCut(k === "a" ? 1 : -1);
          }
        }
        else engine.input.keys.add(k);
      }
      else if (k === " ") {
        e.preventDefault();
        engine.spaceAction();
      } else if (k === "r" && modeRef.current === "lab") engine.reset(); // no do-overs in a drive
      else if (k === "p") setUi((u) => ({ ...u, paused: !u.paused }));
      else if (k === "b") setUi((u) => ({ ...u, debug: !u.debug }));
      else if (k === "v") setUi((u) => ({ ...u, mask: !u.mask }));
      else if (k === "." && uiRef.current.paused) engine.step(TUNING.dt);
      else if (k === "z" && !uiRef.current.showArt) setUi((u) => ({ ...u, showArt: true }));
      else if (k === "x" && !uiRef.current.showDefArt) setUi((u) => ({ ...u, showDefArt: true }));
    };
    const up = (e) => {
      const k = e.key.toLowerCase();
      engine.input.keys.delete(k);
      if (k === "z") setUi((u) => ({ ...u, showArt: false }));
      if (k === "x") setUi((u) => ({ ...u, showDefArt: false }));
    };
    const blur = () => {
      engine.input.keys.clear();
      setUi((u) => ({ ...u, showArt: false, showDefArt: false }));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // ── Mouse: eyes / intent / throw ──
  const fieldPoint = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return toField(camRef.current, e.clientX - r.left, e.clientY - r.top);
  };
  const onMove = (e) => {
    const input = engineRef.current.input;
    const r = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    // How far the mouse has actually moved (after a catch, moving it is what
    // takes the runner back from "straight upfield").
    if (input.screen) input.moveAccum = (input.moveAccum || 0) + Math.hypot(sx - input.screen.x, sy - input.screen.y);
    input.screen = { x: sx, y: sy };
    input.mouse = fieldPoint(e);
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    const engine = engineRef.current;
    const pt = fieldPoint(e);
    engine.input.mouse = pt;
    // In debug, clicking a player (when you can't be throwing) inspects him.
    if (uiRef.current.debug && !engine.canThrow()) {
      let best = null;
      for (const p of engine.players) {
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d < 1.2 && (!best || d < best.d)) best = { id: p.id, d };
      }
      update({ selectedId: best ? best.id : null });
      return;
    }
    if (modeRef.current === "learn" && !tryRef.current) return; // demos aren't playable (Try it is)
    engine.beginThrow(performance.now());
  };
  const onUp = (e) => {
    if (e.button !== 0 || (modeRef.current === "learn" && !tryRef.current)) return;
    engineRef.current.releaseThrow(performance.now());
  };

  const blurAfter = useCallback((fn) => (e) => {
    fn(e);
    e.target.blur();
  }, []);

  const selected = snap && ui.selectedId ? snap.players.find((p) => p.id === ui.selectedId) : null;

  return (
    <>
      <Helmet>
        <title>Football Sim Lab | We-Draft</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div style={{ minHeight: "100vh", background: "#0b1220", color: "#e2e8f0", fontFamily: "Arial, sans-serif", padding: "10px 14px" }}>
        {/* Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
          <Link to={isAdmin ? "/admin" : "/profile"} style={{ color: "#94a3b8", fontWeight: 700, fontSize: "12px", textDecoration: "none", marginRight: "6px" }}>
            {isAdmin ? "← Admin" : "← Profile"}
          </Link>
          <div style={{ fontWeight: 900, letterSpacing: "0.06em", color: ORANGE, marginRight: "10px" }}>FOOTBALL SIM LAB</div>
          {mode === "lab" && (
            <>
          <select
            style={sel}
            value={config.formation}
            onChange={blurAfter((e) =>
              setConfig((c) => {
                const formation = e.target.value;
                // Keep the play if it runs from here, else the first one that does.
                const ok = OFFENSE_PLAYS[c.play].formations.includes(formation);
                const play = ok ? c.play : Object.keys(OFFENSE_PLAYS).find((k) => OFFENSE_PLAYS[k].formations.includes(formation));
                return { ...c, formation, play };
              })
            )}
          >
            {Object.entries(FORMATIONS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select style={sel} value={config.play} onChange={blurAfter((e) => setConfig((c) => ({ ...c, play: e.target.value })))}>
            {Object.entries(OFFENSE_PLAYS)
              .filter(([, v]) => v.formations.includes(config.formation))
              .map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
          </select>
          <select
            style={sel}
            value={config.front}
            onChange={blurAfter((e) =>
              setConfig((c) => {
                const front = e.target.value;
                // Keep the coverage if this front has it, else its first call.
                const calls = coveragesFor(front);
                return { ...c, front, coverage: calls.includes(c.coverage) ? c.coverage : calls[0] };
              })
            )}
          >
            {Object.entries(FRONTS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select style={sel} value={config.coverage} onChange={blurAfter((e) => setConfig((c) => ({ ...c, coverage: e.target.value })))}>
            {coveragesFor(config.front).map((k) => (
              <option key={k} value={k}>{COVERAGES[k]}</option>
            ))}
          </select>
          {OFFENSE_PLAYS[config.play].read && (
            <select style={sel} value={config.readEnd} onChange={blurAfter((e) => setConfig((c) => ({ ...c, readEnd: e.target.value })))}>
              <option value="random">Read end: random</option>
              <option value="sit">Read end: sit</option>
              <option value="crash">Read end: crash</option>
            </select>
          )}
            </>
          )}
          {mode !== "lab" && drive && (
            <div style={{ display: "flex", gap: "10px", alignItems: "center", background: "#111827", border: `1px solid ${ORANGE}`, borderRadius: "6px", padding: "4px 10px" }}>
              <span style={{ fontWeight: 900, color: ORANGE }}>{downLabel(drive)}</span>
              <span style={{ fontWeight: 700 }}>{spotLabel(drive.ballOn)}</span>
              <span style={{ color: "#94a3b8", fontSize: "12px" }}>
                Drive {drive.n} · TD {drive.score.td} · TO {drive.score.turnovers}
              </span>
              {callRef.current && <span style={{ color: "#cbd5e1", fontSize: "12px" }}>Call: {callRef.current.name}</span>}
            </div>
          )}
          {(mode === "drive" || mode === "dynasty") && !picking && !hubOpen && snap && snap.state === "PRE_SNAP" && (
            <button style={btn(false)} onClick={blurAfter(() => setPicking(true))}>Play call</button>
          )}
          {mode !== "learn" && <button
            style={btn(config.variance)}
            title="Off (vanilla): every player is exactly average, so a play runs the same way every time. On: each rep every player gets his own form — usually around average, sometimes quick or slow, now and then exceptional."
            onClick={blurAfter(() => setConfig((c) => ({ ...c, variance: !c.variance })))}
          >
            {config.variance ? "Variance: on" : "Variance: off (vanilla)"}
          </button>}
          {(mode !== "learn" || tryOn) && <button
            style={{ ...btn(false), background: BLUE, borderColor: BLUE, color: "#fff", opacity: picking ? 0.4 : 1 }}
            disabled={picking}
            onClick={blurAfter(() => engineRef.current.snap())}
          >
            Snap (Space)
          </button>}
          {mode === "lab" && <button style={btn(false)} onClick={blurAfter(() => engineRef.current.reset())}>Reset (R)</button>}
          {mode === "lab" ? (
            <>
              <button style={btn(false)} onClick={blurAfter(() => enterLearn())}>{"\u{1F4D6}"} Learn</button>
              <button style={btn(false)} onClick={blurAfter(() => enterDrive())}>{"\u{1F3C8}"} Drive mode</button>
              {/* Dynasty is admin-only — beta testers (simBeta) get the Lab + Drive mode. */}
              {isAdmin && <button style={btn(false)} onClick={blurAfter(() => enterDynasty())}>{"\u{1F3C6}"} Dynasty</button>}
              {isAdmin && <button style={btn(false)} onClick={blurAfter(() => enterDynasty(true))}>{"\u{1F393}"} College</button>}
            </>
          ) : (
            <>
              {mode === "dynasty" && (
                <button style={btn(hubOpen)} onClick={blurAfter(() => setHubOpen(true))}>Front office</button>
              )}
              <button style={btn(true)} onClick={blurAfter(() => exitDrive())}>
                {mode === "dynasty" ? (dyn && dyn.college ? "Exit college" : "Exit dynasty") : mode === "learn" ? "Exit lessons" : "Exit drive mode"}
              </button>
            </>
          )}
          {dynError && <span style={{ color: "#f87171", fontSize: "12px", fontWeight: 700 }}>{dynError}</span>}
          <span style={{ width: "10px" }} />
          <button style={btn(helpOpen)} onClick={blurAfter(() => setHelpOpen(true))}>? Help</button>
          <button style={btn(ui.debug)} onClick={blurAfter(() => update({ debug: !ui.debug }))}>Debug (B)</button>
          <button style={btn(ui.mask)} onClick={blurAfter(() => update({ mask: !ui.mask }))}>Vision mask (V)</button>
          <button style={btn(ui.paused)} onClick={blurAfter(() => update({ paused: !ui.paused }))}>{ui.paused ? "Resume" : "Pause"} (P)</button>
          <select style={sel} value={ui.speed} onChange={blurAfter((e) => update({ speed: Number(e.target.value) }))}>
            <option value={1}>1× speed</option>
            <option value={0.5}>0.5×</option>
            <option value={0.25}>0.25×</option>
            <option value={0.1}>0.1×</option>
          </select>
          <select style={sel} value={ui.zoom} onChange={blurAfter((e) => update({ zoom: Number(e.target.value) }))}>
            <option value={1}>Zoom 1×</option>
            <option value={1.5}>Zoom 1.5×</option>
            <option value={2}>Zoom 2×</option>
          </select>
          <label style={{ fontSize: "12px", color: "#94a3b8", display: "flex", gap: "4px", alignItems: "center" }}>
            <input type="checkbox" checked={ui.autoReset} onChange={blurAfter((e) => update({ autoReset: e.target.checked }))} />
            auto-reset
          </label>
          {snap && <span style={{ fontSize: "11px", color: "#64748b" }}>seed {snap.seed}</span>}
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
          {mode === "learn" && lessonId && (
            <>
              <LessonList current={lessonId} onPick={openLesson} />
              <LessonArticle
                id={lessonId}
                active={lessonActive}
                onDemo={(si, i) => showDemo(lessonId, si, i)}
                tryIt={{ on: tryOn, sel: trySel, onStart: startTry, onSelect: pickTry }}
              />
            </>
          )}
          {/* In Learn the field stays put while the article scrolls. */}
          <div ref={wrapRef} style={{ flex: 1, minWidth: 0, position: mode === "learn" ? "sticky" : "relative", top: mode === "learn" ? "10px" : undefined }}>
            <canvas
              ref={canvasRef}
              onMouseMove={onMove}
              onMouseDown={onDown}
              onMouseUp={onUp}
              onContextMenu={(e) => e.preventDefault()}
              style={{ display: "block", borderRadius: "6px", cursor: "crosshair" }}
            />
            <canvas ref={maskRef} style={{ display: "none" }} />
            {mode === "dynasty" && hubOpen && dyn && (
              <DynastyHub
                league={dyn.league}
                branding={dyn.branding}
                team={dyn.team}
                opponent={dyn.opponent}
                onPickTeam={(team) => pickDynasty({ team })}
                onPickOpponent={(opponent) => pickDynasty({ opponent })}
                onPlay={playDynastyDrive}
                onClose={drive ? () => setHubOpen(false) : null}
              />
            )}
            {mode !== "lab" && picking && drive && !hubOpen && (
              <SimPlayCall
                drive={drive}
                last={lastPlay}
                driveEnd={driveEnd}
                recap={recap}
                onPick={callPlay}
                onClose={callRef.current && snap && snap.state === "PRE_SNAP" ? () => setPicking(false) : null}
              />
            )}
            {helpOpen && <SimHelp onClose={closeHelp} />}
            {mode !== "learn" && <div style={{ fontSize: "11px", color: "#64748b", marginTop: "6px" }}>
              Hold Z pre-snap for the offense's play art, X for the defense's. Passes: WASD moves the QB, the mouse is his eyes and chest; hold and release click to throw (quick tap = bullet, long hold = lofted).
              Inside Zone (read): the mouse is the RB's intent — direction, and distance for aggression; A / D = hard cut left / right, W = burst downhill; during the ride you see through the QB's eyes — it's a give unless you hit SPACE to pull it. On the RPO, click (hold and release) during the ride to pull it and throw at the cursor; after a give the mouse steers the RB. Speed option: the QB has it from the snap and attacks the pitch key (move the mouse to take him over); SPACE pitches to the back. GT Counter Read: SPACE pulls it on the backside end. QB Draw: he shows pass, then runs — the mouse takes him. Debug: click a player to inspect what he
              perceives; P pauses, “.” steps one frame while paused.
            </div>}
          </div>

          {ui.debug && snap && (
            <div style={{ width: "380px", flexShrink: 0, fontSize: "11px", maxHeight: "calc(100vh - 70px)", overflowY: "auto" }}>
              {selected && (
                <div style={{ background: "#111827", border: "1px solid #334155", borderRadius: "6px", padding: "8px", marginBottom: "8px" }}>
                  <div style={{ fontWeight: 900, fontSize: "13px", color: selected.team === "O" ? "#93c5fd" : ORANGE }}>
                    {selected.id} <span style={{ color: "#94a3b8", fontWeight: 400 }}>{selected.position}</span>
                    {selected.form && <span style={{ color: formColor(selected.formZ), fontWeight: 400, marginLeft: "6px" }}>form: {selected.form}</span>}
                  </div>
                  {selected.ratings && (
                    <div style={{ marginTop: "4px", color: "#94a3b8", display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                      {[["SPD", "speed"], ["ACC", "accel"], ["COD", "agility"], ["STR", "strength"], ["BLK", "block"], ["SHD", "shed"], ["TKL", "tackling"], ["HND", "hands"]].map(([k, f]) => (
                        <span key={k}>
                          {k} <b style={{ color: "#e2e8f0" }}>{Math.round(selected.ratings[f] * 100)}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: "4px" }}>
                    <b>{selected.intent}</b>
                  </div>
                  <div style={{ color: "#cbd5e1" }}>{selected.reason}</div>
                  {selected.pending && <div style={{ color: "#fbbf24" }}>considering: {selected.pending}</div>}
                  {selected.pRun != null && (
                    <div style={{ marginTop: "6px" }}>
                      run <Bar value={selected.pRun} color="#ef4444" /> {Math.round(selected.pRun * 100)}% · ball carrier (as he knows it):{" "}
                      {selected.carrierId || "?"}
                    </div>
                  )}
                  {selected.attention && (
                    <div style={{ marginTop: "6px" }}>
                      <div style={{ color: "#94a3b8" }}>QB-eyes attention · zone threat</div>
                      {Object.entries(selected.attention).map(([id, v]) => (
                        <div key={id} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <span style={{ width: "22px" }}>{id}</span>
                          <Bar value={v} color="#60a5fa" /> <span style={{ width: "32px" }}>{Math.round(v * 100)}%</span>
                          {selected.threat && selected.threat[id] && (
                            <>
                              <Bar value={selected.threat[id].threat} color={ORANGE} /> {Math.round(selected.threat[id].threat * 100)}%
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: "6px", color: "#94a3b8" }}>
                    Field: dashed boxes are where he <i>believes</i> each opponent is (green = seen now, red = estimated); red lines point to
                    where they really are.
                  </div>
                </div>
              )}

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {snap.players.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => update({ selectedId: p.id === ui.selectedId ? null : p.id })}
                      style={{ cursor: "pointer", background: p.id === ui.selectedId ? "#1e293b" : "transparent", borderBottom: "1px solid #1f2937" }}
                    >
                      <td style={{ padding: "3px 4px", fontWeight: 900, color: p.team === "O" ? "#93c5fd" : ORANGE, whiteSpace: "nowrap" }}>
                        {p.id}
                        {p.formZ != null && (
                          <div style={{ fontWeight: 400, fontSize: "10px", color: formColor(p.formZ) }}>
                            {p.formZ >= 0 ? "+" : ""}
                            {p.formZ.toFixed(1)}σ
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "3px 4px" }}>
                        <div>{p.intent}</div>
                        <div style={{ color: "#94a3b8" }}>{p.reason}</div>
                        {p.pending && <div style={{ color: "#fbbf24" }}>→ {p.pending}</div>}
                      </td>
                      <td style={{ padding: "3px 4px", whiteSpace: "nowrap", textAlign: "right" }}>
                        {p.pRun != null && <Bar value={p.pRun} color="#ef4444" />}
                        {p.ball && <div style={{ color: "#f472b6" }}>{p.ball}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: "10px", fontWeight: 900, color: "#94a3b8" }}>WHY — decision log</div>
              <div>
                {snap.events
                  .filter((ev) => !ui.selectedId || ev.id === ui.selectedId)
                  .slice()
                  .reverse()
                  .map((ev, i) => (
                    <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid #1f2937" }}>
                      <span style={{ color: "#64748b" }}>{ev.t.toFixed(2)}s</span>{" "}
                      <b style={{ color: ev.team === "O" ? "#93c5fd" : ORANGE }}>{ev.id}</b> {ev.prev ? <span style={{ color: "#64748b" }}>{ev.prev} → </span> : null}
                      <b>{ev.label}</b>
                      {ev.reason ? <span style={{ color: "#94a3b8" }}> — {ev.reason}</span> : null}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
