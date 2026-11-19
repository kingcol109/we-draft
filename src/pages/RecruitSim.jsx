// src/pages/RecruitSim.jsx
//
// /recruitsim — Recruit Sim: run a college football program's recruiting
// season (Winter → Spring → Summer → Fall Weeks 1–12 → Signing Day) against
// every other FBS school. BETA: admins + Sim Beta users (App.js SimRoute).
//
// Layout follows the Portal Sim: a team-colored header pinned to the top
// (window, board, line, NIL, the advance button, the tabs) — Reports (where
// each window lands), Board, Recruits (the full class), Staff, Around the
// Country. Full-screen mode takes over the window. After Signing Day the whole
// game UI gives way to the final report card (ClassParts FinalScreen). Any
// recruit opens the profile popup (components/recruitSim/RecruitProfile.jsx).
//   engine  utils/recruitSim/engine.js   (spec: see its header)
//   flow    components/recruitSim/useRecruitSim.js
// Saves live in this browser (IndexedDB); several can run side by side.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import useRecruitSim, { createSave, saveMeta } from "../components/recruitSim/useRecruitSim";
import RecruitProfile from "../components/recruitSim/RecruitProfile";
import BoardTab from "../components/recruitSim/BoardTab";
import DatabaseTab from "../components/recruitSim/DatabaseTab";
import StaffTab from "../components/recruitSim/StaffTab";
import ReportsTab, { NationalTab } from "../components/recruitSim/ReportsTab";
import { FinalScreen } from "../components/recruitSim/ClassParts";
import { CSS, PANEL, BG, INK, SUB, LINE, GOLD, BLUE, BAD, Logo, pillBtn, smallBtn, useIsMobile } from "../components/recruitSim/ui";
import { loadRecruitSim, defaultTier, money } from "../utils/recruitSim/data";
import { listSaves, readSave, writeSave, deleteSave, listClasses } from "../utils/recruitSim/storage";
import { toStorable, SAVE_VERSION } from "../utils/recruitSim/engine";
import { STAGES, stageDate, mergeConfig } from "../utils/recruitSim/config";
import { boardLimits, phaseOf } from "../utils/recruitSim/model";
import { nilOutstanding, nilAvailable } from "../utils/recruitSim/actions";
import { FBS_CONFERENCES } from "../utils/portalTeams";
import { toCssPx } from "../utils/pageZoom";

const TIER_LABEL = { 1: "Blue Blood", 2: "Power Contender", 3: "Power Program", 4: "Group of 5 Plus", 5: "Group of 5" };

export default function RecruitSim() {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState("");
  const [game, setGame] = useState(null); // { id, state }
  const [creating, setCreating] = useState("");
  useEffect(() => { loadRecruitSim().then(setData).catch((e) => setFailed(e.message || "Couldn't load Recruit Sim.")); }, []);
  useEffect(() => { document.documentElement.classList.add("rs-dark"); return () => document.documentElement.classList.remove("rs-dark"); }, []);

  const start = useCallback(async (slug) => {
    setCreating(slug);
    try {
      const state = await createSave({ source: data.source, teams: data.teams, tiers: data.tiers, factors: data.factors, config: data.config, userSlug: slug, seed: Math.floor(Math.random() * 1e9) });
      const id = `rs-${Date.now()}`;
      await writeSave(id, toStorable(state), saveMeta(state, id)).catch(() => {});
      setGame({ id, state });
    } catch (e) {
      setFailed(e.message || "Couldn't start a season.");
    } finally { setCreating(""); }
  }, [data]);
  const resume = useCallback(async (id) => {
    const st = await readSave(id);
    if (st && st.v !== SAVE_VERSION) { window.alert("This season was saved by an older version of Recruit Sim and can't be loaded. Delete it and start a new one."); return; }
    if (st) setGame({ id, state: st });
  }, []);

  return (
    <div style={{ background: BG, minHeight: "100vh", color: INK, fontFamily: "Arial, sans-serif" }}>
      <style>{CSS}</style>
      <Helmet>
        <title>Recruit Sim | We-Draft.com</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: isMobile ? "10px 10px 60px" : "18px 24px 60px" }}>
        {failed ? <div style={{ ...PANEL, padding: 40, textAlign: "center", color: SUB }}>{failed}</div>
          : !data ? <LoadingSpinner label="Loading programs" size={48} minHeight="60vh" />
            : creating ? <LoadingSpinner label={`Building a class of ${mergeConfig(data.config).classSize.toLocaleString()} recruits`} size={48} minHeight="60vh" />
              : game ? <Game key={game.id} data={data} game={game} isMobile={isMobile} onExit={() => setGame(null)} />
                : <Setup data={data} isMobile={isMobile} onStart={start} onResume={resume} />}
      </div>
    </div>
  );
}

// ── Setup: saved seasons + pick a program ──
function Setup({ data, isMobile, onStart, onResume }) {
  const [team, setTeam] = useState("");
  const [saves, setSaves] = useState([]);
  const [classes, setClasses] = useState([]);
  useEffect(() => { listSaves().then(setSaves); listClasses().then(setClasses); }, []);
  const cfg = mergeConfig(data.config);
  const tierOf = (t) => Number(data.tiers[t.slug]) || defaultTier(t.school, t.conference);
  const byConf = useMemo(() => {
    const groups = {};
    data.teams.forEach((t) => { (groups[t.conference] = groups[t.conference] || []).push(t); });
    Object.values(groups).forEach((l) => l.sort((a, b) => a.school.localeCompare(b.school)));
    return [...FBS_CONFERENCES.filter((c) => groups[c]), ...Object.keys(groups).filter((c) => !FBS_CONFERENCES.includes(c))].map((c) => [c, groups[c]]);
  }, [data]);
  const pick = data.teams.find((t) => t.slug === team);
  const b = data.branding[team];
  return (
    <>
      <div style={{ ...PANEL, padding: isMobile ? "22px 16px" : "30px 34px", marginBottom: 14, background: "linear-gradient(120deg, #0d2f5c 0%, #0b1630 100%)" }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.2em", color: GOLD }}>BETA · RECRUITING SEASON</div>
        <h1 style={{ margin: "6px 0 6px", fontSize: isMobile ? 30 : 46, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>Recruit Sim</h1>
        <div style={{ color: SUB, fontWeight: 700, fontSize: isMobile ? 13 : 15, maxWidth: 720, lineHeight: 1.5 }}>
          Take over a program and build a recruiting class from {cfg.classSize.toLocaleString()} prospects. Scout past the rankings, send your staff across the country, manage a board and an NIL budget, and beat every other FBS school to the players you want — from Winter to Signing Day.
        </div>
      </div>

      {saves.length > 0 && (
        <div style={{ ...PANEL, marginBottom: 14 }}>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${LINE}`, fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", color: SUB, textTransform: "uppercase" }}>Your seasons</div>
          {saves.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: `1px solid ${LINE}` }}>
              <Logo b={data.branding[s.slug]} size={30} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900 }}>{s.school}</div>
                <div style={{ fontSize: 12, color: SUB, fontWeight: 700 }}>{s.label} · {s.commits} commit{s.commits === 1 ? "" : "s"} · saved {new Date(s.updated).toLocaleDateString()}</div>
              </div>
              <button type="button" style={smallBtn("gold")} onClick={() => onResume(s.id)}>{s.stage >= STAGES.length ? "Review" : "Continue"}</button>
              <button type="button" style={smallBtn("bad")} onClick={() => { if (window.confirm(`Delete the ${s.school} season?`)) deleteSave(s.id).then(() => listSaves().then(setSaves)); }}>Delete</button>
            </div>
          ))}
        </div>
      )}
      {classes.length > 0 && (
        <div style={{ ...PANEL, marginBottom: 14 }}>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${LINE}`, fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", color: SUB, textTransform: "uppercase" }}>Finished classes</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 10 }}>
            {classes.slice(-12).reverse().map((c, i) => (
              <div key={i} title={c.signees.slice(0, 5).map((s) => `${s[0]} (${s[1]}, ${s[2]}★)`).join(", ")} style={{ display: "flex", gap: 8, alignItems: "center", background: "#111a2b", borderRadius: 10, padding: "6px 10px" }}>
                <Logo b={data.branding[c.slug]} size={24} />
                <span style={{ fontWeight: 900, fontSize: 13 }}>{c.school}</span>
                <span style={{ fontWeight: 900, color: GOLD }}>{c.grade}</span>
                <span style={{ fontSize: 12, color: SUB, fontWeight: 800 }}>No. {c.rank} · {c.signees.length} signed</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {byConf.map(([conf, list]) => (
        <div key={conf} style={{ ...PANEL, marginBottom: 10 }}>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${LINE}`, fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", color: SUB, textTransform: "uppercase" }}>{conf}</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 96 : 120}px, 1fr))`, gap: 6, padding: 10 }}>
            {list.map((t) => {
              const tb = data.branding[t.slug];
              const on = team === t.slug;
              return (
                <button key={t.slug} type="button" onClick={() => setTeam(t.slug)} style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 6px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                  border: `2px solid ${on ? GOLD : "transparent"}`, background: on ? `color-mix(in srgb, ${tb?.Color1 || BLUE} 45%, #0e1626)` : "#111a2b", color: INK,
                }}>
                  <Logo b={tb} size={isMobile ? 34 : 40} />
                  <span style={{ fontSize: 12, fontWeight: 900, textAlign: "center", lineHeight: 1.15 }}>{t.school}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: SUB }}>Tier {tierOf(t)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ position: "sticky", bottom: 10, marginTop: 12, ...PANEL, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, background: b ? `linear-gradient(120deg, ${b.Color1 || BLUE}, #0e1626)` : "#0e1626" }}>
        {b ? <Logo onColor b={b} size={40} /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: isMobile ? 14 : 17 }}>{pick ? pick.school : "Pick a program"}</div>
          {pick && <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85 }}>Tier {tierOf(pick)} · {TIER_LABEL[tierOf(pick)]} · {money(cfg.budgets[tierOf(pick)])} NIL budget</div>}
        </div>
        <button type="button" disabled={!team} onClick={() => onStart(team)} style={{
          border: "none", borderRadius: 999, padding: "11px 22px", fontWeight: 900, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
          background: team ? (b?.Color2 || GOLD) : "#1a2438", color: "#fff", cursor: team ? "pointer" : "default",
        }}>Start season →</button>
      </div>
    </>
  );
}

// ── The game ──
function Game({ data, game, isMobile, onExit }) {
  const sim = useRecruitSim(game.state, game.id);
  const { state } = sim;
  const usc = state.schools[state.user];
  const b = data.branding[usc.slug] || {};
  const brand = useCallback((slug) => data.branding[slug], [data]);
  const [tab, setTab] = useState("reports");
  const [open, setOpen] = useState(null);
  const done = state.stage >= STAGES.length;
  const shell = useRef(null);
  const fs = useFullscreen(shell);
  // Each new window lands on Reports.
  useEffect(() => { setTab("reports"); window.scrollTo?.(0, 0); shell.current?.scrollTo?.(0, 0); }, [state.stage]);

  const lim = boardLimits(state);
  const phase = phaseOf(state);
  const tabs = [["reports", "Reports"], ["board", lim.size ? `Board ${usc.board.length}/${lim.size}` : `Board${usc.commits.length ? ` · ${usc.commits.length} in` : ""}`], ["recruits", "Recruits"], ["staff", "Staff"], ["national", "Around the Country"]];
  const props = { sim, onOpen: setOpen, isMobile, brand, goTab: setTab, goDatabase: () => setTab("recruits"), onNew: onExit };
  // The tabs ride in the sticky header (user, 2026-11-17).
  const tabBar = (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: isMobile ? "0 10px 8px" : "0 20px 10px", position: "relative" }} className="rs-scroll">
      {tabs.map(([k, l]) => <button key={k} type="button" style={{ ...pillBtn(tab === k, "#000"), background: tab === k ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.2)", borderColor: tab === k ? GOLD : "transparent" }} onClick={() => setTab(k)}>{l}</button>)}
    </div>
  );
  const profile = open != null && <RecruitProfile key={open} sim={sim} r={open} brand={brand} onClose={() => { setOpen(null); sim.clearError(); }} onOpen={setOpen} isMobile={isMobile} />;
  // Signing Day is over: the report card replaces the game UI (user, 2026-11-17).
  if (done) {
    return (
      <div>
        <FinalScreen sim={sim} brand={brand} isMobile={isMobile} onOpen={setOpen} onNew={onExit} />
        {profile}
      </div>
    );
  }
  return (
    <div ref={shell} className={fs.on ? "rs-scroll" : undefined} style={fs.on ? { position: "fixed", inset: 0, zIndex: 1200, overflowY: "auto", background: BG, padding: isMobile ? "0 8px 40px" : "0 20px 40px" } : undefined}>
      <div style={fs.on ? { maxWidth: 1400, margin: "0 auto" } : undefined}>
      <StickyHead fs={fs.on}>
        <Header sim={sim} b={b} isMobile={isMobile} onExit={onExit} lim={lim} phase={phase} done={done} tabBar={tabBar} fs={fs} />
      </StickyHead>
      {tab === "reports" && <ReportsTab {...props} />}
      {tab === "board" && <BoardTab {...props} />}
      {tab === "recruits" && <DatabaseTab {...props} />}
      {tab === "staff" && <StaffTab {...props} />}
      {tab === "national" && <NationalTab {...props} />}
      {open != null && profile}
      {sim.busy && (
        <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(3,7,14,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ ...PANEL, padding: "22px 28px", textAlign: "center" }}>
            <LoadingSpinner size={40} minHeight="auto" />
            <div style={{ fontWeight: 900, marginTop: 10 }}>Closing {STAGES[state.stage]?.label}…</div>
            <div style={{ fontSize: 12, color: SUB, fontWeight: 700, marginTop: 4 }}>{state.S} programs are making their moves.</div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// Full-screen mode: the game takes over the window (and the browser goes
// full screen where it can). Esc / the button leaves.
function useFullscreen(ref) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const h = () => { if (!document.fullscreenElement) setOn(false); };
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  useEffect(() => {
    if (!on) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [on]);
  const toggle = () => {
    if (on) { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); setOn(false); return; }
    setOn(true);
    setTimeout(() => ref.current?.requestFullscreen?.().catch(() => {}), 0);
  };
  return { on, toggle };
}

// The header is pinned where it first sits — it never slides up under the
// site nav (user, 2026-11-17). Publishes its bottom edge as --rs-head for the
// board's side column.
function StickyHead({ fs, children }) {
  const mark = useRef(null);
  const ref = useRef(null);
  const [top, setTop] = useState(null);
  const [gap, setGap] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (fs || !mark.current) { setTop(0); setGap(0); return; }
      // The site bar pinned at the top of the screen (sticky/fixed), if any:
      // our cover fills the gap between its bottom and the header.
      let bar = document.elementFromPoint(Math.round(window.innerWidth / 2), 2);
      while (bar && bar !== document.body && !/^(sticky|fixed)$/.test(getComputedStyle(bar).position)) bar = bar.parentElement;
      // Measured in screen px; style top is in CSS px (the site's page zoom).
      const navBottom = bar && bar !== document.body && !ref.current?.contains(bar) ? toCssPx(Math.max(0, bar.getBoundingClientRect().bottom)) : 0;
      const natural = toCssPx(mark.current.getBoundingClientRect().top + window.scrollY);
      setTop(Math.max(0, natural));
      setGap(Math.max(0, Math.round(natural - navBottom)));
    };
    // The marker isn't sticky, so it can be measured any time — re-check on
    // scroll / resize in case the site header above settles late.
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("resize", later);
    window.addEventListener("scroll", later, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", later); window.removeEventListener("scroll", later); };
  }, [fs]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => document.documentElement.style.setProperty("--rs-head", `${(top || 0) + el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [top]);
  return (
    <>
      <div ref={mark} />
      <div ref={ref} style={{ position: "sticky", top: top ?? 66, zIndex: 50, background: BG, paddingTop: fs ? 8 : 0, paddingBottom: 12, boxShadow: gap ? `0 -${gap}px 0 0 ${BG}` : "none" }}>
        {children}
      </div>
    </>
  );
}

function Header({ sim, b, isMobile, onExit, lim, phase, done, tabBar, fs }) {
  const { state, check } = sim;
  const usc = state.schools[state.user];
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  const out = nilOutstanding(usc);
  const avail = nilAvailable(usc);
  const pct = (n) => `${Math.min(100, (n / Math.max(1, usc.budget)) * 100)}%`;
  const stage = STAGES[state.stage];
  const next = STAGES[state.stage + 1];
  const [showWarn, setShowWarn] = useState(false);
  const go = () => {
    if (check.warns.length && !showWarn && !check.blocks.length) { setShowWarn(true); return; }
    setShowWarn(false);
    sim.advance();
  };
  const notes = !done && (check.blocks.length > 0 || showWarn || sim.error) && (
    <div style={{ position: "relative", padding: isMobile ? "6px 12px" : "8px 20px", background: "rgba(0,0,0,0.45)", borderBottomLeftRadius: 16, borderBottomRightRadius: 16, fontSize: 12, fontWeight: 800 }}>
      {check.blocks.map((m) => <div key={m} style={{ color: BAD }}>• {m}</div>)}
      {sim.error && !check.blocks.includes(sim.error) && <div style={{ color: BAD }}>• {sim.error}</div>}
      {showWarn && !check.blocks.length && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>{check.warns.join(" ")}</span>
          <button type="button" style={smallBtn("gold")} onClick={() => { setShowWarn(false); sim.advance(); }}>Close it anyway</button>
          <button type="button" style={smallBtn()} onClick={() => setShowWarn(false)}>Keep working</button>
        </div>
      )}
    </div>
  );
  // Phones: two short rows so the sticky header doesn't eat the screen.
  if (isMobile) {
    return (
      <div style={{ ...PANEL, position: "relative", background: `linear-gradient(115deg, ${c1} 0%, ${c1} 60%, color-mix(in srgb, ${c2} 60%, ${c1}) 100%)`, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", overflow: "visible" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.5))", borderRadius: 16 }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 4px" }}>
          <Logo onColor b={b} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.9 }}>{done ? "SEASON COMPLETE" : `${stage.label.toUpperCase()} · ${stageDate(state.stage)}`}</div>
            <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{usc.name}</div>
          </div>
          {!done && <button type="button" onClick={go} disabled={sim.busy} style={{ border: "none", borderRadius: 999, padding: "8px 12px", fontWeight: 900, fontSize: 11, textTransform: "uppercase", fontFamily: "inherit", background: check.blocks.length ? "#3a3f4d" : GOLD, color: check.blocks.length ? "#c9cfdb" : "#111", whiteSpace: "nowrap" }}>{phase === "signing" ? "Sign →" : "Close →"}</button>}
        </div>
        <div style={{ position: "relative", display: "flex", gap: 4, padding: "2px 10px 8px", flexWrap: "wrap", fontSize: 10, fontWeight: 900, alignItems: "center" }}>
          {!done && lim.size > 0 && <Chip>Board {usc.board.length}/{lim.size}</Chip>}
          {!done && lim.line > 0 && <Chip warn={usc.above.length < Math.min(lim.line, usc.board.length)}>Line {usc.above.length}/{lim.line}</Chip>}
          <Chip>{usc.commits.length} in</Chip>
          {!done && <Chip warn={usc.staff.some((a) => !a)}>Staff {usc.staff.filter(Boolean).length}/6</Chip>}
          <Chip>{money(avail)} NIL left</Chip>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={fs.toggle} style={{ ...smallBtn(), background: "rgba(0,0,0,0.3)", borderColor: "transparent", fontSize: 10, padding: "2px 7px" }}>{fs.on ? "Exit full screen" : "⛶ Full screen"}</button>
          <button type="button" onClick={onExit} style={{ ...smallBtn(), background: "rgba(0,0,0,0.3)", borderColor: "transparent", fontSize: 10, padding: "2px 7px" }}>Seasons</button>
        </div>
        {tabBar}
        {notes}
      </div>
    );
  }
  return (
    <div style={{ ...PANEL, position: "relative", background: `linear-gradient(115deg, ${c1} 0%, ${c1} 55%, color-mix(in srgb, ${c2} 60%, ${c1}) 100%)`, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", overflow: "visible" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.5))", borderRadius: 16 }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 10 : 18, padding: isMobile ? "10px 12px" : "12px 20px", flexWrap: isMobile ? "wrap" : "nowrap" }}>
        <Logo onColor b={b} size={isMobile ? 40 : 56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ background: "rgba(0,0,0,0.35)", borderRadius: 6, padding: "2px 8px", fontWeight: 900, fontSize: isMobile ? 10 : 11, letterSpacing: "0.16em" }}>{done ? "SEASON COMPLETE" : `${stage.label.toUpperCase()} · ${stageDate(state.stage)}`}</span>
            <button type="button" onClick={fs.toggle} style={{ ...smallBtn(), background: "rgba(0,0,0,0.3)", borderColor: "transparent", fontSize: 10 }}>{fs.on ? "Exit full screen" : "⛶ Full screen"}</button>
            <button type="button" onClick={onExit} style={{ ...smallBtn(), background: "rgba(0,0,0,0.3)", borderColor: "transparent", fontSize: 10 }}>Seasons</button>
          </div>
          <div style={{ fontSize: isMobile ? 18 : 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{usc.name}</div>
          {/* Calendar pips */}
          <div style={{ display: "flex", gap: 2, marginTop: 5 }} title="Winter · Spring · Summer · Fall Weeks 1–12 · Signing Day">
            {STAGES.map((s, i) => <span key={s.key} title={s.label} style={{ flex: s.phase === "fall" ? 1 : 1.6, height: 5, borderRadius: 2, background: i < state.stage ? "rgba(255,255,255,0.8)" : i === state.stage ? GOLD : "rgba(255,255,255,0.18)", maxWidth: 34 }} />)}
          </div>
          {!done && <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", fontSize: 11, fontWeight: 900 }}>
            <Chip>{lim.size ? `Board ${usc.board.length}/${lim.size}` : "Board opens Spring"}</Chip>
            {lim.line > 0 && <Chip warn={usc.above.length < Math.min(lim.line, usc.board.length)}>Line {usc.above.length}/{lim.line}</Chip>}
            <Chip>{usc.commits.length} committed</Chip>
            <Chip warn={usc.staff.some((a) => !a)}>Staff {usc.staff.filter(Boolean).length}/6</Chip>
          </div>}
        </div>
        <div style={{ width: isMobile ? "100%" : 230, background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "8px 10px", order: isMobile ? 3 : 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 900 }}>
            <span style={{ fontSize: 18 }}>{money(avail)} <span style={{ fontSize: 11, opacity: 0.75 }}>available</span></span>
            <span style={{ fontSize: 11, opacity: 0.75 }}>of {money(usc.budget)}</span>
          </div>
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "rgba(255,255,255,0.15)", marginTop: 4 }}>
            <div style={{ width: pct(usc.spent), background: GOLD }} />
            <div style={{ width: pct(out), background: "rgba(255,255,255,0.6)" }} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 10, fontWeight: 800, opacity: 0.9 }}>
            <span><span style={{ color: GOLD }}>■</span> Spent {money(usc.spent)}</span>
            <span><span style={{ color: "rgba(255,255,255,0.7)" }}>■</span> Offered {money(out)}</span>
          </div>
        </div>
        {!done && (
          <div style={{ position: "relative", order: isMobile ? 2 : 0 }}>
            <button type="button" onClick={go} disabled={sim.busy} style={{ border: "none", borderRadius: 999, padding: isMobile ? "10px 14px" : "12px 20px", fontWeight: 900, fontSize: isMobile ? 12 : 14, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "inherit", background: check.blocks.length ? "#3a3f4d" : GOLD, color: check.blocks.length ? "#c9cfdb" : "#111", cursor: "pointer", whiteSpace: "nowrap" }}>
              {phase === "signing" ? "Sign the class →" : `Close ${stage.label} →`}
            </button>
            {next && !isMobile && <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.8, textAlign: "center", marginTop: 3 }}>Next: {next.label}</div>}
          </div>
        )}
      </div>
      {tabBar}
      {notes}
    </div>
  );
}
function Chip({ children, warn }) {
  return <span style={{ background: warn ? "rgba(246,162,29,0.35)" : "rgba(0,0,0,0.3)", borderRadius: 6, padding: "2px 7px" }}>{children}</span>;
}
