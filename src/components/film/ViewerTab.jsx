// src/components/film/ViewerTab.jsx
//
// Film Manager → Viewer (user, 2026-11-27): just watch — nothing is edited here.
//
//   Players  a player's saved plays, back to back (looping); Washed / Original
//            (a play with no wash shows its original), marks on or off.
//   Games    the WHOLE game film (user: "full games, not just plays we saved"),
//            with a scrub bar (the saved plays are ticks on it); feature any
//            player from the game's box score in the side bar.
//
//   Full screen  the film alone (⛶ / F: the film fills the screen).
//   YouTube      the YouTube draft breakdown look (Admin → Videos → Graphics →
//                Draft Breakdowns: 1920×1080, site blue and gold, Bebas Neue +
//                Barlow Condensed, the film window at 1440×810): the film in the
//                middle; the FACE CAM window kept clear top right (user: "keep
//                room for the face cam"); the player's info and stats in the
//                panel under it; the We-Draft logo bottom right. No badge at the
//                top, no play / game strip at the bottom (user). ⛶ / F puts the
//                whole frame full screen (screen capture / OBS).
//                The CENTER (user, 2026-11-27: "control the middle screen
//                element"): Film, Background (the breakdowns' background card —
//                an action shot tile, measurements, career stats, career path)
//                or the We-Draft.com card. The film pauses under a card and
//                picks back up when the card comes down. The background's photo
//                is a center- or right-facing action shot (right first — he
//                faces into the card); none → a portrait tile (headshot in a
//                gold ring over his number).
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import { careerGroups, careerTable, espnStats } from "../AdminSideGraphics";
import { GRADE_SCALE, gradeLabel, gradeLook } from "../../utils/gradeScale";
import { communityAverage } from "../../utils/gradeWindow";
import WeDraftOutline from "../../assets/LogoOutlineBlue.png";
import FilmPlayer from "./FilmPlayer";
import ScrubRow, { useFastMotion } from "./Scrub";
import { loadBox, usePlayerData } from "./FilmPlayerCard";
import { useSchools } from "../DraftArchiveList";
import { cutPlay, deletePlay, LABEL_COLORS, LABELS, person, playsForGame, playsForPlayer, tagPlayer, untagPlayer } from "../../utils/film/data";
import { filmName } from "../../utils/film/schedule";
import { seasonOf } from "../../utils/film/library";
import { hostDraw, putPlay, putState, watchCmds } from "../../utils/film/remote";
import WeDraftLogo from "../../assets/Logo2.png";
import KingColdLogo from "../../assets/KingColdSports.png";
import { useCareerPath } from "../PlayerEligibilityInfo";

const UI_BLUE = "#0055a5";
const UI_GOLD = "#f6a21d";
// The breakdown frames' palette and type (AdminDraftBreakdowns.jsx).
const BLUE = "#0055a5";
const NAVY = "#00264d";
const DEEP = "#001833";
const GOLD = "#f6a21d";
const DISP = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';
const BODY = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
const FONTS_CSS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Bebas+Neue&display=block";
// Longhand font styles (a shorthand with quoted families is fragile in some engines).
const F = (size, family, weight = 400) => ({ fontSize: size, fontFamily: family, fontWeight: weight });
const W = 1920;
const H = 1080;
// The breakdown frame's windows (AdminDraftBreakdowns.jsx VID / FACE / PANEL).
const VID = { x: 36, y: 150, w: 1440, h: 810 };
const FACE = { x: 1500, y: 36, w: 384, h: 216 };
const PANEL = { x: 1500, y: 276, w: 384, h: 684 };
// The face cam window's key color (user, 2026-11-27: OBS window-captures the
// Viewer, the face cam sits UNDER the capture, and a Color Key filter on the
// capture (this exact magenta, low similarity) lets the cam show through the
// window — inside the gold ring). Magenta, not green: green would key the field.
// Hiding the cam (Viewer or iPad) paints the window over, so it hides on air
// with nothing to touch in OBS.
const CAM_KEY = "#ff00ff";

const btn = (on) => ({ border: `1px solid ${on ? UI_BLUE : "#334058"}`, background: on ? UI_BLUE : "#1b2538", color: on ? "#fff" : "#e8edf5", borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: 13, cursor: "pointer" });
const chip = (on, color = UI_BLUE) => ({ border: `1px solid ${on ? color : "#334058"}`, background: on ? color : "#1b2538", color: on ? "#fff" : "#e8edf5", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer" });
const field = { minWidth: 0, border: "1px solid #334058", borderRadius: 8, padding: "7px 10px", fontSize: 14, boxSizing: "border-box", background: "#0f1726", color: "#e8edf5", colorScheme: "dark", width: "100%" };
const head = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.5, color: "#9fb0c8" };
const panel = { display: "grid", gap: 8, padding: 12, border: "1px solid #263247", borderRadius: 10, background: "#141c2b", minWidth: 0 };
const ellipsis = (x = {}) => ({ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, ...x });
const isTyping = (e) => ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
const seasonFor = (g) => String(g?.season || seasonOf(g?.folder) || (String(g?.file || "").match(/\b(20\d\d)\b/) || [])[1] || "");
const clock = (s) => { const t = Math.max(0, s || 0); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const x = Math.floor(t % 60).toString().padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : "");

// Stat tiles: the stats that matter, his position's group first.
const SEASON_TILES = {
  passing: [["YDS", "Pass Yds"], ["TD", "Pass TD"], ["INT", "INT"], ["PCT", "Cmp %"]],
  rushing: [["YDS", "Rush Yds"], ["TD", "Rush TD"], ["YPC", "YPC"], ["CAR", "Carries"]],
  receiving: [["REC", "Rec"], ["YDS", "Rec Yds"], ["TD", "Rec TD"], ["YPR", "YPR"]],
  defensive: [["TOT", "Tackles"], ["TFL", "TFL"], ["SACKS", "Sacks"], ["PD", "PD"], ["QB HUR", "Hurries"]],
  interceptions: [["INT", "INT"]],
};
const primaryOf = (pos) => {
  const x = String(pos || "").toUpperCase();
  return x === "QB" ? "passing" : /^(RB|HB|FB|TB)$/.test(x) ? "rushing" : /^(WR|TE)$/.test(x) ? "receiving" : "defensive";
};
/** → [{ label, value, rank }] — the primary group's stats always, the rest only when not zero. */
function tilesOf(byCat, map, pos, ranks = {}, max = 6) {
  if (!byCat) return [];
  const first = primaryOf(pos);
  const cats = [first, ...Object.keys(map).filter((k) => k !== first)];
  const out = [];
  cats.forEach((k) => {
    const s = byCat[k];
    if (!s || !map[k]) return;
    map[k].forEach(([stat, label]) => {
      const v = s[stat];
      if (v == null || v === "") return;
      if (k !== first && (Number(v) === 0 || v === "0")) return;
      const r = String(ranks?.[k]?.[stat] || "").replace(/^T-/, "");
      out.push({ label, value: String(v), rank: Number(r) && Number(r) <= 50 ? `#${r}` : "" });
    });
  });
  return out.slice(0, max);
}
// A game's leaders, both teams together (the side bar when no one is featured).
const LEADERS = [
  ["passing", "YDS", "Passing", (x) => `${x["C/ATT"] || ""} · ${x.YDS} YDS${Number(x.TD) ? ` · ${x.TD} TD` : ""}`],
  ["rushing", "YDS", "Rushing", (x) => `${x.CAR} CAR · ${x.YDS} YDS${Number(x.TD) ? ` · ${x.TD} TD` : ""}`],
  ["receiving", "YDS", "Receiving", (x) => `${x.REC} REC · ${x.YDS} YDS${Number(x.TD) ? ` · ${x.TD} TD` : ""}`],
  ["defensive", "TOT", "Tackles", (x) => `${x.TOT} TKL${Number(x.TFL) ? ` · ${x.TFL} TFL` : ""}${Number(x.SACKS) ? ` · ${x.SACKS} SK` : ""}`],
];
const leadersOf = (box) => LEADERS.map(([cat, stat, label, fmt]) => {
  let best = null;
  (box?.teams || []).forEach((t) => t.players.forEach((pl) => { const x = pl.stats?.[cat]; if (x && (!best || (Number(x[stat]) || 0) > (Number(best.x[stat]) || 0))) best = { pl, team: t.name, x }; }));
  return best ? { label, name: best.pl.name, team: best.team, line: fmt(best.x) } : null;
}).filter(Boolean);
// The side panel's choices (the iPad remote shows the same).
export const SIDES = [["stats", "Stats"], ["info", "Info"], ["site", "We-Draft.com"], ["subscribe", "Subscribe"]];
// The center window's choices (the iPad remote shows the same).
export const CENTERS = [["film", "Film"], ["background", "Background"], ["community", "Community"], ["logo", "We-Draft.com"]];
const PLAYER_CENTERS = ["background", "community"]; // need someone featured
const markOf = (tg) => (tg?.spot ? { ...tg.spot, kind: tg.spot.kind || (tg.legacy?.mark === "arrow" ? "arrow" : "circle") } : null);
// A game's away / home (neutral: as filed), for the header.
const sidesOf = (g) => (g?.home && g?.away ? [g.away, g.home] : [g?.offense, g?.defense].filter(Boolean));
// The other team in a player's game (the remote's play list shows its logo).
const teamKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const oppOf = (g, team) => { const s = sidesOf(g); const t = teamKey(team); return t && s.some((x) => teamKey(x) === t) ? s.find((x) => teamKey(x) !== t) || "" : ""; };

// The Google fonts the frames use, once.
function useFrameFonts() {
  useEffect(() => {
    if (document.querySelector("link[data-wd-frame-fonts]")) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONTS_CSS;
    l.setAttribute("data-wd-frame-fonts", "");
    document.head.appendChild(l);
  }, []);
}

// The frame's motion (user, 2026-11-27: "feel more like a transition when
// flipping between players" — then: "not wipe the whole screen… the
// individual elements are changing; the blue background and face cam stay
// static"). Flipping to another player: the header lifts out and the new one
// drops in, a wipe crosses the FILM WINDOW only, the side panel slides out and
// the new one slides in. The plugs pop in like the breakdowns' subscribe card.
// The wipe comes in, HOLDS while the new film loads (so nothing in between —
// the idle We-Draft card, a black frame — ever shows; user, 2026-11-27: "the
// We-Draft logo pops up before the wipe"), then goes out.
const FRAME_CSS = `
@keyframes wdvWipeIn { from { transform: translateX(-130%) skewX(-12deg); } to { transform: translateX(0) skewX(-12deg); } }
@keyframes wdvWipeOut { from { transform: translateX(0) skewX(-12deg); } to { transform: translateX(130%) skewX(-12deg); } }
@keyframes wdvFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes wdvFadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes wdvSlideL { from { transform: translateX(-90px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wdvRiseBig { from { transform: translateY(140px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wdvIn { from { transform: translateX(70px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wdvHead { from { transform: translateY(-26px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wdvHeadOut { from { transform: none; opacity: 1; } to { transform: translateY(-26px); opacity: 0; } }
@keyframes wdvOut { from { transform: none; opacity: 1; } to { transform: translateX(70px); opacity: 0; } }
@keyframes wdvPop { 0% { transform: scale(0.55); opacity: 0; } 70% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes wdvRise { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes wdvLine { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes wdvPulse { 0%, 100% { transform: scale(1); box-shadow: 0 6px 22px rgba(255,0,0,0.35); } 50% { transform: scale(1.07); box-shadow: 0 6px 52px rgba(255,0,0,0.85); } }
@keyframes wdvShine { from { transform: translateX(-140%) skewX(-20deg); } to { transform: translateX(260%) skewX(-20deg); } }
`;
const anim = (name, ms, delay = 0, ease = "cubic-bezier(.2,.8,.2,1)") => ({ animation: `${name} ${ms}ms ${ease} ${delay}ms both` });
const WIPE_IN_MS = 300; // the wipe covers the film window
const WIPE_OUT_MS = 420; // … and uncovers it
const SWAP_MS = 340; // the old header / panel are out (and the film covered) — the new player swaps in
const HOLD_MS = 160; // the cover stays this long once the new film is up (its first frame)
const HOLD_MAX_MS = 2400; // … and never longer than this (a film that won't load)

// ── The panel under the face cam (the breakdowns' PANEL): gold ring, white card. ──
const Shell = ({ box: b, children, fill = "#fff", stripes = false }) => (
  <div style={{ position: "absolute", left: b.x - 5, top: b.y - 5, width: b.w + 10, height: b.h + 10, borderRadius: 20, background: GOLD }}>
    <div style={{ position: "absolute", inset: 5, borderRadius: 15, overflow: "hidden", background: fill, display: "flex", flexDirection: "column" }}>
      {stripes && <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(-45deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 34px, transparent 34px, transparent 124px)", pointerEvents: "none" }} />}
      {children}
    </div>
  </div>
);
const Ribbon = ({ children }) => (
  <div style={{ background: GOLD, color: NAVY, ...F(36, DISP), letterSpacing: 1, textAlign: "center", padding: "9px 10px 3px", lineHeight: 1, flexShrink: 0, ...ellipsis() }}>{children}</div>
);
const Tile = ({ x, big = false }) => (
  <div style={{ background: "#f3f6fb", borderRadius: 10, padding: big ? "10px 6px 6px" : "6px 6px 4px", textAlign: "center", minWidth: 0 }}>
    <div style={{ ...F(big ? 50 : 40, DISP), color: NAVY, lineHeight: 1 }}>{x.value}{x.rank && <span style={{ ...F(18, BODY, 700), color: BLUE, marginLeft: 5 }}>{x.rank}</span>}</div>
    <div style={{ ...F(16, BODY, 800), color: "#5b6b84", textTransform: "uppercase", letterSpacing: 1, ...ellipsis() }}>{x.label}</div>
  </div>
);
const Empty = ({ children }) => <div style={{ gridColumn: "1 / -1", ...F(20, BODY, 700), color: "#8a97ab", textAlign: "center" }}>{children}</div>;

// His headshot over his school's faded logo, his number and position — the top
// of the Stats and Info panels.
function HeadBlock({ who, info }) {
  const logo = info.brand?.LogoDark || info.brand?.Logo1 || "";
  const num = who?.jersey ?? info.jersey;
  return (
    <div style={{ position: "relative", height: 188, flexShrink: 0, overflow: "hidden", backgroundColor: NAVY, backgroundImage: `linear-gradient(160deg, ${BLUE}, ${DEEP})` }}>
      {logo && <img src={logo} alt="" style={{ position: "absolute", right: -20, top: 0, width: 200, height: 200, objectFit: "contain", opacity: info.shot ? 0.18 : 0.9 }} />}
      {info.shot && <img src={info.shot} alt="" onError={info.onShotError} style={{ position: "absolute", right: 10, bottom: 0, height: 178, width: "auto", objectFit: "contain", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.45))" }} />}
      {num != null && <div style={{ position: "absolute", left: 20, top: 12, ...F(84, DISP), color: GOLD, lineHeight: 1, textShadow: "0 4px 14px rgba(0,0,0,0.45)" }}>#{num}</div>}
      {info.pos && <div style={{ position: "absolute", left: 22, top: 104, padding: "4px 12px 0", borderRadius: 6, background: "#fff", color: NAVY, ...F(28, DISP), letterSpacing: 1 }}>{info.pos}</div>}
    </div>
  );
}
const Facts = ({ info }) => (
  <div style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, flexShrink: 0 }}>
    {[["HT", info.height], ["WT", info.weight], ["Class", info.cls], ["Home", info.home]].map(([k, v]) => (
      <div key={k} style={{ background: "#f3f6fb", borderRadius: 10, padding: "5px 10px 3px", minWidth: 0 }}>
        <div style={{ ...F(14, BODY, 800), color: "#5b6b84", letterSpacing: 1, textTransform: "uppercase" }}>{k}</div>
        <div style={{ ...F(30, DISP), color: NAVY, lineHeight: 1, ...ellipsis() }}>{v || "—"}</div>
      </div>
    ))}
  </div>
);

// Season only — no game stats on a player's graphic (user, 2026-11-27).
function PlayerPanel({ who, info }) {
  const cfTiles = info.season ? tilesOf(info.season, SEASON_TILES, info.pos, info.ranks, 6) : [];
  const espnTiles = info.espn?.season ? info.espn.season.stats.slice(0, 6).map(([label, value]) => ({ label, value, rank: "" })) : [];
  const seasonTiles = cfTiles.length ? cfTiles : espnTiles;
  const waiting = info.cf === undefined;
  const seasonLabel = cfTiles.length ? `${info.seasonYr} Season` : espnTiles.length ? String(info.espn.season.label).replace(/ stats$/i, "") : "Season";
  return (
    <Shell box={PANEL}>
      <HeadBlock who={who} info={info} />
      <Facts info={info} />
      <Ribbon>{seasonLabel.toUpperCase()}</Ribbon>
      <div style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1, alignContent: "start" }}>
        {seasonTiles.length ? seasonTiles.map((x) => <Tile key={x.label} x={x} big />) : <Empty>{waiting ? "" : "No season stats"}</Empty>}
      </div>
    </Shell>
  );
}

// Info: who he is — the basics, hometown, recruiting, and his career path.
function InfoPanel({ who, info }) {
  const careerPlayer = useMemo(() => (info.wd === undefined ? null : info.wd || (info.school ? { School: info.school } : null)), [info.wd, info.school]);
  const career = useCareerPath(careerPlayer, info.cfId ? String(info.cfId) : "", null);
  const wd = info.wd || {};
  const recruit = [wd.RecruitStars ? `${wd.RecruitStars}★ recruit` : "", wd.RecruitYear ? `Class of ${wd.RecruitYear}` : ""].filter(Boolean).join(" · ");
  const rows = (career.rows || []).slice(0, 4);
  return (
    <Shell box={PANEL}>
      <HeadBlock who={who} info={info} />
      <Facts info={info} />
      {(career.hometown || wd.HighSchool || recruit) && (
        <div style={{ padding: "0 16px 8px", display: "grid", gap: 1, flexShrink: 0 }}>
          {career.hometown && <div style={{ ...F(20, BODY, 800), color: "#334155", ...ellipsis() }}><span style={{ color: BLUE }}>HOMETOWN </span>{career.hometown}</div>}
          {(wd.HighSchool || recruit) && <div style={{ ...F(20, BODY, 800), color: "#334155", ...ellipsis() }}><span style={{ color: BLUE }}>RECRUIT </span>{[wd.HighSchool, recruit].filter(Boolean).join(" · ")}</div>}
        </div>
      )}
      <Ribbon>CAREER PATH</Ribbon>
      <div style={{ padding: "10px 16px", display: "grid", gap: 8, alignContent: "start", minHeight: 0, overflow: "hidden" }}>
        {rows.length ? rows.map(({ key, name, span, brand, current, label }, i) => {
          const logo = brand?.LogoDark && brand?.Color1 ? brand.LogoDark : brand?.Logo1;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, ...anim("wdvRise", 380, 120 + i * 90) }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", overflow: "hidden", background: brand?.LogoDark && brand?.Color1 ? brand.Color1 : "#f3f6fb", boxShadow: `0 0 0 3px ${current ? GOLD : "#e2e8f0"}` }}>
                {logo ? <img src={logo} alt="" style={{ width: "72%", height: "72%", objectFit: "contain" }} /> : <span style={{ ...F(22, DISP), color: "#8a97ab" }}>{String(name || "").slice(0, 2).toUpperCase()}</span>}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...F(28, DISP), color: NAVY, lineHeight: 1, ...ellipsis() }}>{String(name || "").toUpperCase()}</div>
                <div style={{ ...F(17, BODY, 800), color: "#5b6b84", ...ellipsis() }}>{[label, span].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
          );
        }) : <Empty>{info.wd === undefined ? "" : "No career history on file"}</Empty>}
      </div>
    </Shell>
  );
}

// We-Draft.com: the site plug — grade him yourself.
function SitePanel({ who }) {
  const lines = who ? ["GRADE HIM", "YOURSELF"] : ["GRADE EVERY", "PROSPECT"];
  return (
    <Shell box={PANEL} fill={DEEP} stripes>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 24px", textAlign: "center" }}>
        <div>{lines.map((l, i) => <div key={l} style={{ ...F(92, DISP), color: i ? GOLD : "#fff", lineHeight: 0.92, ...anim("wdvPop", 420, 60 + i * 110) }}>{l}</div>)}</div>
        <img src={WeDraftLogo} alt="We-Draft.com" style={{ width: 300, height: 120, objectFit: "contain", ...anim("wdvPop", 480, 320) }} />
        <div style={{ padding: "10px 26px 4px", borderRadius: 999, background: GOLD, color: NAVY, ...F(42, DISP), letterSpacing: 1, ...anim("wdvPop", 420, 480) }}>WE-DRAFT.COM</div>
        <div style={{ display: "grid", gap: 4, ...anim("wdvRise", 420, 640) }}>
          {["Community grades", "Big boards · Mock drafts", "The Draft Sim"].map((t) => <div key={t} style={{ ...F(22, BODY, 800), color: "rgba(255,255,255,0.8)", letterSpacing: 1, textTransform: "uppercase" }}>{t}</div>)}
        </div>
      </div>
    </Shell>
  );
}

// Subscribe: the Draft Breakdowns' card (AdminDraftBreakdowns.jsx panelSubscribe) —
// MORE DRAFT BREAKDOWNS / ALL WEEK, the red button (pops, pulses twice, a shine
// across it), the King Cold Sports logo, TURN ON NOTIFICATIONS.
function SubscribePanel() {
  return (
    <Shell box={PANEL} fill={DEEP} stripes>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 28px", textAlign: "center" }}>
        {["MORE DRAFT", "BREAKDOWNS"].map((l, i) => <div key={l} style={{ ...F(78, DISP), color: "#fff", lineHeight: 0.92, whiteSpace: "nowrap", ...anim("wdvPop", 420, 40 + i * 90) }}>{l}</div>)}
        <div style={{ position: "relative", marginTop: 14, ...anim("wdvIn", 420, 280) }}>
          <div style={{ ...F(90, DISP), color: GOLD, lineHeight: 0.9, whiteSpace: "nowrap" }}>ALL WEEK</div>
          <div style={{ height: 6, background: GOLD, marginTop: 10, transformOrigin: "left", ...anim("wdvLine", 420, 360) }} />
        </div>
        <div style={{ marginTop: 30, width: "100%", ...anim("wdvPop", 360, 420) }}>
          <div style={{ position: "relative", overflow: "hidden", height: 100, borderRadius: 16, background: "#ff0000", display: "flex", alignItems: "center", gap: 20, padding: "0 26px", boxSizing: "border-box", animation: "wdvPulse 700ms ease-in-out 900ms 2" }}>
            <div style={{ width: 60, height: 44, borderRadius: 12, background: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <div style={{ width: 0, height: 0, borderTop: "12px solid transparent", borderBottom: "12px solid transparent", borderLeft: "21px solid #ff0000", marginLeft: 5 }} />
            </div>
            <div style={{ ...F(66, DISP), color: "#fff", lineHeight: 1, paddingTop: 6 }}>SUBSCRIBE</div>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "35%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)", ...anim("wdvShine", 800, 900, "ease-in-out") }} />
          </div>
        </div>
        <img src={KingColdLogo} alt="King Cold Sports" style={{ marginTop: 24, width: "100%", height: 70, objectFit: "contain", ...anim("wdvRise", 400, 620) }} />
        <div style={{ marginTop: 18, ...F(22, BODY, 800), color: "rgba(255,255,255,0.65)", letterSpacing: 2, ...anim("wdvRise", 400, 760) }}>TURN ON NOTIFICATIONS</div>
      </div>
    </Shell>
  );
}

// No one featured on a game: the final and the game's leaders.
function GamePanel({ box, brands }) {
  const final = box?.teams?.length === 2 ? [...box.teams].sort((a, b) => (a.side === "home") - (b.side === "home")) : null;
  const maxPts = final ? Math.max(...final.map((t) => Number(t.points) || 0)) : 0;
  const leaders = leadersOf(box);
  return (
    <Shell box={PANEL}>
      <Ribbon>FINAL</Ribbon>
      <div style={{ padding: "10px 16px", display: "grid", gap: 8 }}>
        {final ? final.map((t) => {
          const b = brands[t.name];
          const win = Number(t.points) === maxPts;
          return (
            <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderRadius: 12, background: win ? NAVY : "#f3f6fb" }}>
              {(b?.LogoDark || b?.Logo1) && <img src={win ? b.LogoDark || b.Logo1 : b.Logo1 || b.LogoDark} alt="" style={{ width: 58, height: 58, objectFit: "contain" }} />}
              <span style={{ ...F(34, DISP), color: win ? "#fff" : NAVY, flex: 1, ...ellipsis() }}>{String(t.name).toUpperCase()}</span>
              <span style={{ ...F(56, DISP), color: win ? GOLD : "#5b6b84", lineHeight: 1 }}>{t.points ?? "—"}</span>
            </div>
          );
        }) : <Empty>No box score saved</Empty>}
      </div>
      <Ribbon>LEADERS</Ribbon>
      <div style={{ padding: "10px 16px", display: "grid", gap: 8 }}>
        {leaders.length ? leaders.map((l) => (
          <div key={l.label} style={{ background: "#f3f6fb", borderRadius: 10, padding: "6px 12px 4px", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ ...F(15, BODY, 800), color: BLUE, letterSpacing: 1, textTransform: "uppercase", flexShrink: 0 }}>{l.label}</span>
              <span style={{ ...F(15, BODY, 700), color: "#5b6b84", ...ellipsis() }}>{l.team}</span>
            </div>
            <div style={{ ...F(30, DISP), color: NAVY, lineHeight: 1.05, ...ellipsis() }}>{String(l.name).toUpperCase()}</div>
            <div style={{ ...F(18, BODY, 700), color: "#334155", ...ellipsis() }}>{l.line}</div>
          </div>
        )) : <Empty>—</Empty>}
      </div>
    </Shell>
  );
}

// The film window with nothing playing (nothing picked, plays loading, a
// player with no plays): the frame stays whole on a broadcast (user, 2026-11-27).
const IdleFilm = () => (
  <div style={{ position: "absolute", inset: 0, overflow: "hidden", display: "grid", placeItems: "center", backgroundColor: DEEP, backgroundImage: `linear-gradient(115deg, ${NAVY} 0%, ${DEEP} 100%)` }}>
    <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(-45deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 34px, transparent 34px, transparent 124px)" }} />
    <div style={{ position: "relative", display: "grid", justifyItems: "center", gap: 22 }}>
      <img src={WeDraftLogo} alt="We-Draft.com" style={{ width: 720, height: 220, objectFit: "contain", ...anim("wdvPop", 500) }} />
      <div style={{ width: 420, height: 8, borderRadius: 4, background: GOLD, transformOrigin: "center", ...anim("wdvLine", 420, 200) }} />
      {/* The site's line — a tagline, nothing louder (user, 2026-11-27). */}
      <div style={{ ...F(44, BODY, 600), color: "rgba(255,255,255,0.82)", letterSpacing: 1, marginTop: 6, ...anim("wdvRise", 460, 360) }}>Grade every prospect. Build your board.</div>
      <div style={{ ...F(40, DISP), color: GOLD, letterSpacing: 3, lineHeight: 1, ...anim("wdvRise", 460, 480) }}>WE-DRAFT.COM</div>
    </div>
  </div>
);

// ── The center's Background card (the breakdowns' cardBackground, AdminDraftBreakdowns.jsx):
// in film-window pixels (1440×810). ──
const STRIPES = (a) => `repeating-linear-gradient(-45deg, rgba(255,255,255,${a}) 0px, rgba(255,255,255,${a}) 34px, transparent 34px, transparent 124px)`;
const TILE = { x: 32, y: 32, w: 520, h: 746 };
const lum = (hex) => {
  const m = String(hex || "").replace("#", "");
  if (m.length < 6) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// Measurements as the breakdowns write them (heightText … measuresOf there).
const EIGHTHS = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];
const inchParts = (n) => { let w = Math.floor(n); let e = Math.round((n - w) * 8); if (e === 8) { w += 1; e = 0; } return `${w}${EIGHTHS[e]}`; };
const heightText = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d+)'\s*(\d+(?:\.\d+)?)/);
  if (m) return `${m[1]}'${inchParts(parseFloat(m[2]))}"`;
  const n = parseFloat(s);
  return n > 48 && n < 96 ? `${Math.floor(n / 12)}'${inchParts(n - Math.floor(n / 12) * 12)}"` : s;
};
const inchText = (raw) => { const s = String(raw ?? "").trim(); if (!s || /["/]/.test(s)) return s; const n = parseFloat(s); return Number.isNaN(n) ? s : `${inchParts(n)}"`; };
const broadText = (raw) => { const s = String(raw ?? "").trim(); if (!s || s.includes("'")) return s; const n = parseFloat(s); return Number.isNaN(n) ? s : `${Math.floor(n / 12)}'${Math.round(n % 12)}"`; };
const plain = (raw) => String(raw ?? "").trim();
const measuresOf = (p) => [
  ["Height", heightText(p.Height)], ["Weight", p.Weight ? `${plain(p.Weight)} lbs` : ""],
  ["Arm", inchText(p["Arm Length"])], ["Hand", inchText(p["Hand Size"])], ["Wingspan", inchText(p.Wingspan)],
  ["40-Yard", plain(p["40 Yard"])], ["Vertical", p.Vertical ? `${plain(p.Vertical).replace(/"$/, "")}"` : ""], ["Broad", broadText(p.Broad)],
  ["3-Cone", plain(p["3-Cone"])], ["Shuttle", plain(p.Shuttle)], ["Bench", plain(p.Bench)],
].filter(([, v]) => v).map(([label, value]) => ({ label, value }));

const Heading = ({ children, delay = 0 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0, ...anim("wdvIn", 420, delay) }}>
    <span style={{ ...F(36, DISP), color: GOLD, lineHeight: 1, whiteSpace: "nowrap", paddingTop: 4 }}>{children}</span>
    <span style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.18)" }} />
  </div>
);

// The tile's ground: his school's color (when it's dark enough) into deep navy, the stripes, the faded logo.
function TileGround({ school, logo, faded = true }) {
  return (
    <div style={{ position: "absolute", inset: 0, backgroundColor: DEEP, backgroundImage: `linear-gradient(180deg, ${school}, ${DEEP})` }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: STRIPES(0.06) }} />
      {logo && faded && <img src={logo} alt="" style={{ position: "absolute", left: 40, top: 40, width: TILE.w - 80, height: 380, objectFit: "contain", opacity: 0.2 }} />}
    </div>
  );
}

// Where the figure is in an action shot (user, 2026-11-27: "smart about
// fitting players"): the box around its non-transparent pixels, and which
// image edges it's cut off at. → { nw, nh, x, y, w, h, cut: { l, r, t, b }, opaque }
// | null (the image won't let us read it — CORS — or won't load). Cached.
const trimCache = new Map();
function trimOf(url) {
  if (!trimCache.has(url)) {
    trimCache.set(url, new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => {
        try {
          const nw = im.naturalWidth;
          const nh = im.naturalHeight;
          const k = Math.min(1, 360 / Math.max(nw, nh));
          const cw = Math.max(1, Math.round(nw * k));
          const ch = Math.max(1, Math.round(nh * k));
          const cv = document.createElement("canvas");
          cv.width = cw; cv.height = ch;
          const cx = cv.getContext("2d", { willReadFrequently: true });
          cx.drawImage(im, 0, 0, cw, ch);
          const d = cx.getImageData(0, 0, cw, ch).data;
          let x0 = cw; let y0 = ch; let x1 = -1; let y1 = -1; let clear = 0;
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              if (d[(y * cw + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } else clear++;
            }
          }
          if (x1 < 0) { resolve(null); return; }
          const edge = 2;
          resolve({
            nw, nh, x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k,
            cut: { l: x0 <= edge, r: x1 >= cw - 1 - edge, t: y0 <= edge, b: y1 >= ch - 1 - edge },
            opaque: clear < cw * ch * 0.02, // a photo, not a cutout
          });
        } catch { resolve(null); }
      };
      im.onerror = () => resolve(null);
      im.src = url;
    }));
  }
  return trimCache.get(url);
}
// The figure's place on the tile: as big as fits (a little air at the top and
// sides), standing on the floor; cut off at a side → flush to that side of the
// tile, so the crop reads as the tile's edge. → the image's { left, top, width, height }.
function fitFigure(t) {
  const PAD = 26;
  const TOP = 44;
  const flushL = t.cut.l && !t.cut.r;
  const flushR = t.cut.r && !t.cut.l;
  const roomW = t.cut.l && t.cut.r ? TILE.w : TILE.w - (flushL || flushR ? PAD : PAD * 2);
  const roomH = TILE.h - TOP;
  const s = Math.min(roomW / t.w, roomH / t.h);
  const fw = t.w * s;
  const fx = flushL ? 0 : flushR ? TILE.w - fw : (TILE.w - fw) / 2;
  const fy = TILE.h - t.h * s; // feet (or the cut) on the floor
  return { left: fx - t.x * s, top: fy - t.y * s, width: t.nw * s, height: t.nh * s };
}

// An action shot: a cutout fitted on the tile's floor (rising in); a full
// photo fills the tile; an image we can't measure is contained, bottom-centered.
function ShotTile({ shot, school, logo, onError }) {
  const [trim, setTrim] = useState(undefined);
  useEffect(() => { let c = false; setTrim(undefined); trimOf(shot).then((t) => { if (!c) setTrim(t); }); return () => { c = true; }; }, [shot]);
  const look = { position: "absolute", filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.45))", ...anim("wdvRiseBig", 620, 120) };
  return (
    <>
      <TileGround school={school} logo={logo} />
      {trim === undefined ? null
        : trim?.opaque ? <img src={shot} alt="" onError={onError} style={{ ...look, left: 0, top: 0, width: TILE.w, height: TILE.h, objectFit: "cover", objectPosition: "center top", filter: "none" }} />
          : trim ? <img src={shot} alt="" onError={onError} style={{ ...look, ...fitFigure(trim) }} />
            : <img src={shot} alt="" onError={onError} style={{ ...look, left: 16, top: 40, width: TILE.w - 32, height: TILE.h - 40, objectFit: "contain", objectPosition: "center bottom" }} />}
    </>
  );
}

// No center / right action shot: a portrait — his number huge and outlined
// behind, the school logo up top, his headshot in a gold ring, the position chip
// and school under it.
function PortraitTile({ who, info, school, logo }) {
  const num = who?.jersey ?? info.jersey;
  const D = 380;
  return (
    <>
      <TileGround school={school} logo={logo} faded={false} />
      {num != null && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 10, textAlign: "center", ...F(520, DISP), lineHeight: 1, color: "transparent", WebkitTextStroke: `5px ${GOLD}66`, ...anim("wdvFade", 600, 150) }}>{num}</div>
      )}
      {logo && <img src={logo} alt="" style={{ position: "absolute", left: 28, top: 28, width: 120, height: 120, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))", ...anim("wdvPop", 420, 120) }} />}
      <div style={{ position: "absolute", left: (TILE.w - D) / 2, top: 150, width: D, height: D, borderRadius: "50%", overflow: "hidden",
        background: "radial-gradient(circle at 50% 35%, #ffffff, #cfdbea)", boxShadow: `0 0 0 8px ${GOLD}, 0 22px 50px rgba(0,0,0,0.5)`, ...anim("wdvPop", 520, 220) }}>
        {info.shot
          ? <img src={info.shot} alt="" onError={info.onShotError} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
          : logo && <img src={logo} alt="" style={{ position: "absolute", inset: "15%", width: "70%", height: "70%", objectFit: "contain" }} />}
      </div>
      <div style={{ position: "absolute", left: 24, right: 24, top: 576, display: "grid", justifyItems: "center", gap: 10, textAlign: "center", ...anim("wdvRise", 460, 380) }}>
        {info.pos && <div style={{ padding: "6px 20px 0", borderRadius: 8, background: "#fff", color: NAVY, ...F(42, DISP), letterSpacing: 1, lineHeight: 1 }}>{info.pos}</div>}
        <div style={{ ...F(54, DISP), color: "#fff", lineHeight: 1, maxWidth: "100%", ...ellipsis() }}>{String(info.school || who?.team || "").toUpperCase()}</div>
        {info.cls && <div style={{ ...F(26, BODY, 800), color: GOLD, letterSpacing: 1.5, textTransform: "uppercase" }}>{info.cls}</div>}
      </div>
    </>
  );
}

function BackgroundCard({ who, info, shotAt = 0, onShots }) {
  // His photos (Content → Photos): the center / right-facing action shots, right first.
  const wdId = info.wd ? info.wd.id : info.wd === null ? "" : undefined;
  const [photo, setPhoto] = useState(undefined);
  useEffect(() => {
    let c = false;
    setPhoto(undefined);
    if (wdId === undefined) return undefined;
    if (!wdId) { setPhoto(null); return undefined; }
    getDoc(doc(db, "playerPhotos", String(wdId))).then((d) => { if (!c) setPhoto(d.exists() ? d.data() : null); }).catch(() => { if (!c) setPhoto(null); });
    return () => { c = true; };
  }, [wdId]);
  const [bad, setBad] = useState(() => new Set());
  const shots = useMemo(() => {
    const a = (photo?.action || []).filter((x) => x?.url && !bad.has(x.url));
    return [...a.filter((x) => x.orientation === "right"), ...a.filter((x) => x.orientation === "center")].map((x) => x.url);
  }, [photo, bad]);
  useEffect(() => { onShots?.(shots.length); }, [shots.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onShots?.(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  const shot = shots.length ? shots[((shotAt % shots.length) + shots.length) % shots.length] : "";

  // His career stats (ESPN — the breakdowns' table): the last three seasons and the total.
  const espnId = String(photo?.headshot?.espnId || info.cfId || "");
  const [table, setTable] = useState(undefined);
  useEffect(() => {
    let c = false;
    setTable(undefined);
    if (!/^\d+$/.test(espnId)) { setTable(null); return undefined; }
    espnStats("college-football", espnId).then((e) => {
      if (c) return;
      const g = careerGroups(e, info.pos)[0];
      setTable(g ? careerTable(e, g, info.pos) : null);
    }).catch(() => { if (!c) setTable(null); });
    return () => { c = true; };
  }, [espnId, info.pos]);

  const careerPlayer = useMemo(() => (info.wd === undefined ? null : info.wd || (info.school ? { School: info.school } : null)), [info.wd, info.school]);
  const career = useCareerPath(careerPlayer, info.cfId ? String(info.cfId) : "", null);
  const stops = (career.rows || []).slice(0, 4).reverse(); // oldest on the left
  const wd = info.wd || {};
  const measures = (info.wd ? measuresOf(info.wd) : [{ label: "Height", value: info.height }, { label: "Weight", value: info.weight ? `${info.weight} lbs` : "" }].filter((m) => m.value)).slice(0, 8);
  const stars = Number(wd.RecruitStars) || 0;
  const facts = [
    career.hometown && ["HOMETOWN", career.hometown],
    wd.HighSchool && ["HIGH SCHOOL", wd.HighSchool],
    stars > 0 && ["RECRUIT", `${"★".repeat(Math.min(5, stars))}${wd.RecruitYear ? ` · ${wd.RecruitYear}` : ""}`],
  ].filter(Boolean);
  const rows = (table?.rows || []).slice(-3);
  // Two rows of measurements + the career table + the path: the facts line
  // gives its room to the path (they're on the Info side panel too).
  if (measures.length > 4 && rows.length && stops.length) facts.length = 0;
  const c1 = info.brand?.Color1;
  const school = c1 && lum(c1) < 0.75 ? c1 : BLUE;
  const logo = info.brand?.LogoDark || info.brand?.Logo1 || "";
  const RX = TILE.x + TILE.w + 36;
  const RW = 1440 - 32 - RX;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundColor: DEEP, backgroundImage: `linear-gradient(180deg, ${DEEP}, ${NAVY})`, ...anim("wdvFade", 260) }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: STRIPES(0.035) }} />
      {/* The photo tile. */}
      <div style={{ position: "absolute", left: TILE.x, top: TILE.y, width: TILE.w, height: TILE.h, borderRadius: 20, overflow: "hidden", ...anim("wdvSlideL", 520, 80) }}>
        {photo === undefined ? <TileGround school={school} logo={logo} />
          : shot ? <ShotTile key={shot} shot={shot} school={school} logo={logo} onError={() => setBad((b) => new Set(b).add(shot))} />
            : <PortraitTile who={who} info={info} school={school} logo={logo} />}
        <div style={{ position: "absolute", inset: 0, borderRadius: 20, boxShadow: `inset 0 0 0 4px ${GOLD}e6`, pointerEvents: "none" }} />
      </div>

      {/* The right side: background facts, measurements, career stats, career path. */}
      <div style={{ position: "absolute", left: RX, top: 40, width: RW, bottom: 36, display: "flex", flexDirection: "column", gap: 22 }}>
        {facts.length > 0 && (
          <div style={{ display: "flex", gap: 26, flexWrap: "nowrap", overflow: "hidden", flexShrink: 0, ...anim("wdvRise", 420, 160) }}>
            {facts.map(([k, v]) => (
              <div key={k} style={{ minWidth: 0, flexShrink: k === "RECRUIT" ? 0 : 1 }}>
                <div style={{ ...F(17, BODY, 800), color: GOLD, letterSpacing: 2 }}>{k}</div>
                <div style={{ ...F(32, DISP), color: "#fff", lineHeight: 1.05, ...ellipsis() }}>{String(v).toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}
        {measures.length > 0 && (
          <div style={{ display: "grid", gap: 14, flexShrink: 0 }}>
            <Heading delay={200}>MEASUREMENTS</Heading>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(4, measures.length)}, minmax(0, 1fr))`, gap: 12 }}>
              {measures.map((m, i) => (
                <div key={m.label} style={{ height: 84, borderRadius: 12, background: "rgba(255,255,255,0.08)", display: "grid", alignContent: "center", justifyItems: "center", minWidth: 0, ...anim("wdvPop", 380, 260 + i * 50) }}>
                  <div style={{ ...F(48, DISP), color: "#fff", lineHeight: 1 }}>{m.value}</div>
                  <div style={{ ...F(17, BODY, 800), color: GOLD, letterSpacing: 1.5, textTransform: "uppercase" }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <div style={{ display: "grid", gap: 6, flexShrink: 0 }}>
            <Heading delay={380}>CAREER {table.title}</Heading>
            <div style={{ display: "grid", gridTemplateColumns: `150px repeat(${table.cols.length}, minmax(0, 1fr))`, alignItems: "center", ...anim("wdvFade", 300, 420) }}>
              <span />
              {table.cols.map((c) => <span key={c} style={{ ...F(18, BODY, 800), color: "rgba(255,255,255,0.55)", textAlign: "center", ...ellipsis() }}>{c}</span>)}
            </div>
            {[...rows, { year: "CAREER", vals: table.total, total: true }].map((r, i) => (
              <div key={r.year} style={{ display: "grid", gridTemplateColumns: `150px repeat(${table.cols.length}, minmax(0, 1fr))`, alignItems: "center", height: 40, borderRadius: 8,
                background: r.total ? GOLD : `rgba(255,255,255,${i % 2 ? 0.05 : 0.09})`, color: r.total ? NAVY : "#fff", ...anim("wdvIn", 380, 440 + i * 70) }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: r.total ? 16 : 10, ...F(28, DISP), lineHeight: 1, paddingTop: 3 }}>
                  {!r.total && (r.logo ? <img src={r.logo} alt="" style={{ width: 28, height: 28, objectFit: "contain" }} /> : <span style={{ width: 28 }} />)}
                  {r.year}
                </span>
                {r.vals.map((v, j) => <span key={j} style={{ ...F(28, DISP), lineHeight: 1, textAlign: "center", paddingTop: 3, ...ellipsis() }}>{v || "—"}</span>)}
              </div>
            ))}
          </div>
        )}
        {stops.length > 0 && (
          <div style={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", gap: 12 }}>
            <Heading delay={560}>CAREER PATH</Heading>
            <div style={{ flex: 1, minHeight: 0, containerType: "size" }}>
              <div style={{ "--d": "min(104px, 46cqh)", position: "relative", height: "100%", display: "grid", gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }}>
                {stops.length > 1 && <div style={{ position: "absolute", left: `${50 / stops.length}%`, right: `${50 / stops.length}%`, top: "calc(var(--d) / 2 - 3px)", height: 6, background: `${GOLD}8c`, transformOrigin: "left", ...anim("wdvLine", 520, 600) }} />}
                {stops.map(({ key, name, span, brand, current, label }, i) => {
                  const l = brand?.Logo1 || brand?.LogoDark || "";
                  return (
                    <div key={key} style={{ position: "relative", display: "grid", justifyItems: "center", alignContent: "start", gap: 6, minWidth: 0, textAlign: "center", ...anim("wdvRise", 420, 620 + i * 110) }}>
                      <div style={{ width: "var(--d)", height: "var(--d)", borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", overflow: "hidden", boxShadow: current ? `0 0 0 6px ${GOLD}` : "0 6px 16px rgba(0,0,0,0.35)" }}>
                        {l ? <img src={l} alt="" style={{ width: "68%", height: "68%", objectFit: "contain" }} /> : <span style={{ fontSize: "calc(var(--d) * 0.36)", fontFamily: DISP, color: NAVY }}>{String(name || "").slice(0, 3).toUpperCase()}</span>}
                      </div>
                      <div style={{ fontSize: "min(32px, 15cqh)", fontFamily: DISP, color: "#fff", lineHeight: 0.95, maxWidth: "94%", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{String(name || "").toUpperCase()}</div>
                      <div style={{ fontSize: "min(20px, 10cqh)", fontFamily: BODY, fontWeight: 800, color: GOLD, letterSpacing: 1, textTransform: "uppercase", maxWidth: "94%", ...ellipsis() }}>{[label, span].filter(Boolean).join(" · ")}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── The center's Community card (the breakdowns' cardCommunity): the We-Draft
// community's grade, its top strengths / weaknesses as bars, and the gold
// GRADE HIM YOURSELF bar. Read live from players/{id}/evaluations. ──
const GREEN = "#1e9e57";
const RED = "#d23c3c";
async function communityOf(id, eligible) {
  const snap = await getDocs(collection(db, "players", String(id), "evaluations")).catch(() => null);
  const evals = snap ? snap.docs.map((d) => d.data()) : [];
  if (!evals.length) return { count: 0, avg: null, strengths: [], weaknesses: [] };
  const sC = {};
  const wC = {};
  evals.forEach((e) => {
    (e.strengths || []).forEach((t) => { sC[t] = (sC[t] || 0) + 1; });
    (e.weaknesses || []).forEach((t) => { wC[t] = (wC[t] || 0) + 1; });
  });
  const total = evals.filter((e) => e.grade !== "Watchlist" || (e.strengths?.length || 0) + (e.weaknesses?.length || 0) > 0).length || 1;
  const top = (c, other, strict) => Object.entries(c).filter(([t, n]) => (strict ? n > (other[t] ?? -1) : n >= (other[t] ?? -1)))
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([term, n]) => ({ term, pct: (n / total) * 100 }));
  return { count: evals.length, avg: communityAverage(evals, eligible, GRADE_SCALE), strengths: top(sC, wC, false), weaknesses: top(wC, sC, true) };
}
function CommunityCard({ info }) {
  const id = info.wd?.id;
  const [c, setC] = useState(undefined);
  useEffect(() => {
    let x = false;
    setC(undefined);
    if (info.wd === undefined) return undefined;
    if (!id) { setC(null); return undefined; }
    communityOf(id, info.wd?.Eligible).then((r) => { if (!x) setC(r); });
    return () => { x = true; };
  }, [id, info.wd]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = c?.count ? gradeLabel(c.avg) || "" : "";
  const look = gradeLook(label);
  const Bars = ({ title, list, color, delay }) => (
    <div style={{ display: "grid", gap: 14, alignContent: "start", minWidth: 0 }}>
      <Heading delay={delay}>{title}</Heading>
      {list.length ? list.map((r, i) => (
        <div key={r.term} style={{ display: "grid", gap: 6, ...anim("wdvIn", 420, delay + 80 + i * 90) }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ ...F(36, DISP), color: "#fff", lineHeight: 1, flex: 1, ...ellipsis() }}>{String(r.term).toUpperCase()}</span>
            <span style={{ ...F(26, BODY, 800), color: "rgba(255,255,255,0.75)" }}>{Math.round(r.pct)}%</span>
          </div>
          <div style={{ height: 14, borderRadius: 7, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(3, Math.min(100, r.pct))}%`, borderRadius: 7, background: color, transformOrigin: "left", ...anim("wdvLine", 600, delay + 160 + i * 90) }} />
          </div>
        </div>
      )) : <div style={{ ...F(24, BODY, 700), color: "rgba(255,255,255,0.55)" }}>None picked yet</div>}
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundColor: DEEP, backgroundImage: `linear-gradient(180deg, ${DEEP}, ${NAVY})`, ...anim("wdvFade", 260) }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: STRIPES(0.035) }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 40, textAlign: "center", ...anim("wdvHead", 460, 80) }}>
        <div style={{ ...F(76, DISP), color: "#fff", lineHeight: 1 }}>WE-DRAFT.COM COMMUNITY GRADE</div>
        <div style={{ width: 160, height: 6, background: GOLD, margin: "10px auto 0" }} />
      </div>
      {c === undefined ? null : !c?.count ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 250, textAlign: "center", ...anim("wdvRise", 460, 200) }}>
          <div style={{ ...F(84, DISP), color: "#fff", lineHeight: 1 }}>NO COMMUNITY GRADES YET</div>
          <div style={{ ...F(50, DISP), color: GOLD, lineHeight: 1.2 }}>BE THE FIRST TO GRADE HIM</div>
        </div>
      ) : (
        <div style={{ position: "absolute", left: 44, right: 44, top: 170, height: 420, display: "grid", gridTemplateColumns: "380px minmax(0, 1fr) minmax(0, 1fr)", gap: 40 }}>
          <div style={{ display: "grid", justifyItems: "center", alignContent: "start", gap: 16 }}>
            <div style={{ width: 230, height: 230, borderRadius: 28, background: look.bg, boxShadow: `inset 0 0 0 8px ${look.border}`, display: "grid", placeItems: "center", alignContent: "center", color: "#fff", ...anim("wdvPop", 520, 200) }}>
              {look.qualifier && <div style={{ ...F(42, DISP), lineHeight: 1 }}>{look.qualifier}</div>}
              <div style={{ ...F(140, DISP), lineHeight: 0.9 }}>{String(look.short || "").toUpperCase()}</div>
            </div>
            <div style={{ ...F(44, DISP), color: "#fff", lineHeight: 1, ...anim("wdvRise", 420, 380) }}>{label.toUpperCase()}</div>
            <div style={{ ...F(24, BODY, 800), color: GOLD, letterSpacing: 1.5, ...anim("wdvRise", 420, 460) }}>{c.count} EVALUATION{c.count === 1 ? "" : "S"}</div>
          </div>
          <Bars title="TOP STRENGTHS" list={c.strengths} color={GREEN} delay={300} />
          <Bars title="TOP WEAKNESSES" list={c.weaknesses} color={RED} delay={380} />
        </div>
      )}
      {/* GRADE HIM YOURSELF — the outlined blue We-Draft.com on the site's gold. */}
      <div style={{ position: "absolute", left: 44, right: 44, bottom: 44, height: 156, borderRadius: 24, background: GOLD, display: "flex", alignItems: "center", gap: 40, padding: "0 40px", boxSizing: "border-box", overflow: "hidden", ...anim("wdvRiseBig", 520, 520) }}>
        <div style={{ ...F(76, DISP), color: NAVY, lineHeight: 0.92, flex: 1 }}>GRADE HIM YOURSELF</div>
        <img src={WeDraftOutline} alt="We-Draft.com" style={{ height: 96, maxWidth: "55%", objectFit: "contain", ...anim("wdvPop", 460, 760) }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "30%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)", ...anim("wdvShine", 900, 1100, "ease-in-out") }} />
      </div>
    </div>
  );
}

// ── A game's header as a final scoreboard (user, 2026-11-27): away logo, name,
// score · FINAL · score, name, home logo — the winner's score in gold. The
// score from the film's schedule match (ap / hp), else the box score. ──
function Scoreboard({ game, box, brands, aw, hm }) {
  const ptsOf = (name, side) => {
    const t = (box?.teams || []).find((x) => x.side === side) || (box?.teams || []).find((x) => teamKey(x.name) === teamKey(name));
    return t?.points ?? null;
  };
  const ap = game.ap ?? ptsOf(aw, "away");
  const hp = game.hp ?? ptsOf(hm, "home");
  const final = ap != null && hp != null;
  const win = final ? (Number(ap) > Number(hp) ? "a" : Number(hp) > Number(ap) ? "h" : "") : "";
  const Logo = ({ name }) => {
    const b = brands[name];
    const src = b?.LogoDark || b?.Logo1 || "";
    return src
      ? <img src={src} alt="" style={{ width: 84, height: 84, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))" }} />
      : <span style={{ width: 84, height: 84, borderRadius: "50%", background: "rgba(255,255,255,0.12)", display: "grid", placeItems: "center", flexShrink: 0, ...F(36, DISP), color: "#fff" }}>{String(name).slice(0, 3).toUpperCase()}</span>;
  };
  const Name = ({ name, lost }) => <span style={{ ...F(68, DISP), color: lost ? "rgba(255,255,255,0.6)" : "#fff", lineHeight: 1, paddingTop: 6, minWidth: 0, ...ellipsis() }}>{String(name).toUpperCase()}</span>;
  const Score = ({ v, won }) => (
    <span style={{ minWidth: 96, padding: "6px 14px 0", borderRadius: 12, textAlign: "center", background: won ? GOLD : "rgba(0,10,30,0.35)", color: won ? NAVY : "#fff", ...F(78, DISP), lineHeight: 1, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{v}</span>
  );
  return (
    <div style={{ position: "absolute", left: VID.x, top: 14, width: VID.w, height: 90, display: "flex", alignItems: "center", gap: 18 }}>
      <Logo name={aw} />
      <Name name={aw} lost={win === "h"} />
      {final ? (
        <>
          <Score v={ap} won={win === "a"} />
          <span style={{ padding: "6px 14px 2px", borderRadius: 8, background: "#fff", color: NAVY, ...F(30, DISP), letterSpacing: 2, lineHeight: 1, flexShrink: 0 }}>FINAL</span>
          <Score v={hp} won={win === "h"} />
        </>
      ) : <span style={{ ...F(44, DISP), color: GOLD, flexShrink: 0, paddingTop: 4 }}>{game.home && !game.neutral ? "AT" : "VS"}</span>}
      <Name name={hm} lost={win === "a"} />
      <Logo name={hm} />
    </div>
  );
}

// ── The YouTube frame (1920×1080, scaled to fit its box — or the screen). ──
function YouTubeFrame({ who: whoIn, game: gameIn, filmId = "none", side = "stats", center = "film", shotAt = 0, onShots, settling = false, cam = true, children }) {
  useFrameFonts();
  const frameRef = useRef(null);
  // Flipping to another player (or game): the wipe sweeps in, what the frame
  // shows swaps while it covers the film window, and it holds there until the
  // new film is up (settling) — then sweeps out. Only a new FILM wipes
  // (filmId): featuring a player on a game keeps the film as it is, and just
  // the header and side panel change (user, 2026-11-27).
  const idKey = whoIn?.key || (gameIn?.id ? `g:${gameIn.id}` : "none");
  const [shown, setShown] = useState({ who: whoIn, game: gameIn, key: idKey, filmId });
  const [wipe, setWipe] = useState(null); // { id, out }
  const wipeN = useRef(0);
  const swapAt = useRef(0);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (idKey === shown.key) { setLeaving(false); if (whoIn !== shown.who || gameIn !== shown.game || filmId !== shown.filmId) setShown({ who: whoIn, game: gameIn, key: idKey, filmId }); return undefined; }
    // A new film: a wipe comes in (one already covering stays put — a quick second flip).
    if (filmId !== shown.filmId) setWipe((w) => (w && !w.out ? w : { id: ++wipeN.current, out: false }));
    setLeaving(true);
    const t = setTimeout(() => { swapAt.current = performance.now(); setShown({ who: whoIn, game: gameIn, key: idKey, filmId }); setLeaving(false); }, SWAP_MS);
    return () => clearTimeout(t);
  }, [idKey, whoIn, gameIn, filmId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!wipe || wipe.out || leaving) return undefined;
    const wait = settling ? Math.max(0, HOLD_MAX_MS - (performance.now() - swapAt.current)) : HOLD_MS;
    const id = wipe.id;
    const t = setTimeout(() => setWipe((w) => (w && w.id === id ? { ...w, out: true } : w)), wait);
    return () => clearTimeout(t);
  }, [wipe, leaving, settling]);
  // Until the swap, the film window keeps the film that was up — the new
  // player's plays are still loading, and nothing else (the idle card) may
  // show before the wipe has covered it.
  const switching = (leaving || idKey !== shown.key) && filmId !== shown.filmId;
  const heldFilm = useRef(children);
  if (!switching) heldFilm.current = children;
  const film = switching ? heldFilm.current : children;
  const who = shown.who;
  const game = shown.game;
  const info = usePlayerData(who);
  // The center card (Background needs someone featured): it fades in over the
  // film, and out when the film comes back.
  const cardWant = center === "logo" ? "logo" : PLAYER_CENTERS.includes(center) && who ? center : null;
  const [card, setCard] = useState(cardWant);
  const [cardOut, setCardOut] = useState(false);
  useEffect(() => {
    if (cardWant) { setCard(cardWant); setCardOut(false); return undefined; }
    if (!card) return undefined;
    setCardOut(true);
    const t = setTimeout(() => { setCard(null); setCardOut(false); }, 280);
    return () => clearTimeout(t);
  }, [cardWant]); // eslint-disable-line react-hooks/exhaustive-deps
  const [box, setBox] = useState(null);
  useEffect(() => { setBox(null); loadBox(game?.cfbdGameId).then(setBox); }, [game?.cfbdGameId]);
  const brands = useSchools((box?.teams || []).map((t) => t.name).concat(sidesOf(game)));
  const mine = info.school || who?.team;
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const fit = () => { const r = el.getBoundingClientRect(); setScale(Math.min(r.width / W, r.height / H) || 0.5); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameRef]);
  // Header: a player's plays → the player (his school's logo, name, position ·
  // school · class); a game → the matchup, even with a player featured in the
  // side panel (user, 2026-11-27) — and it stays put when the featured player changes.
  const gameView = String(shown.filmId || "").startsWith("g:");
  const headWho = gameView ? null : who;
  const [aw, hm] = sidesOf(game);
  const logo = headWho ? info.brand?.LogoDark || info.brand?.Logo1 || "" : "";
  // Nothing up: the site's own header, so the frame never sits half empty.
  const name = headWho ? headWho.name : game ? `${aw || ""}${hm ? ` ${game?.home && !game?.neutral ? "at" : "vs"} ${hm}` : ""}` : "We-Draft.com";
  const sub = headWho ? [info.pos, mine, info.cls].filter(Boolean).join("  ·  ") : game ? [dateOf(game?.date), seasonFor(game) && `${seasonFor(game)} season`].filter(Boolean).join("  ·  ") : "NFL Draft breakdowns";
  const x0 = logo ? 160 : VID.x;
  const headKey = gameView ? `h:${shown.filmId}` : `h:${shown.key}`;
  const headLeaving = leaving && (!gameView || filmId !== shown.filmId);
  return (
    <div ref={frameRef} style={{ position: "relative", width: "100%", height: "100%", background: "#000", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "center", overflow: "hidden",
        backgroundColor: DEEP, backgroundImage: `linear-gradient(115deg, ${BLUE} 0%, ${DEEP} 100%)` }}>
        {/* The frames' diagonal stripes. */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(-45deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 34px, transparent 34px, transparent 124px)" }} />
        <style>{FRAME_CSS}</style>
        <div key={headKey} style={{ position: "absolute", left: 0, top: 0, width: VID.x + VID.w, height: VID.y, pointerEvents: "none", ...(headLeaving ? anim("wdvHeadOut", 300, 0, "ease-in") : anim("wdvHead", 500)) }}>
          {!headWho && game && aw && hm ? (
            <>
              <Scoreboard game={game} box={box} brands={brands} aw={aw} hm={hm} />
              <div style={{ position: "absolute", left: VID.x + 2, top: 108, width: VID.w, color: GOLD, ...F(28, BODY, 800), letterSpacing: 1, ...ellipsis() }}>{sub.toUpperCase()}</div>
            </>
          ) : (
            <>
              {logo && <img src={logo} alt="" style={{ position: "absolute", left: 36, top: 24, width: 104, height: 104, objectFit: "contain" }} />}
              <div style={{ position: "absolute", left: x0, top: 18, width: VID.x + VID.w - x0, color: "#fff", ...F(96, DISP), lineHeight: 1, ...ellipsis() }}>{String(name).toUpperCase()}</div>
              <div style={{ position: "absolute", left: x0 + 2, top: 108, width: VID.x + VID.w - x0, color: GOLD, ...F(28, BODY, 800), letterSpacing: 1, ...ellipsis() }}>{sub.toUpperCase()}</div>
            </>
          )}
        </div>
        {/* The film window. */}
        <div style={{ position: "absolute", left: VID.x, top: VID.y, width: VID.w, height: VID.h, background: "#000", boxShadow: "0 18px 40px rgba(0,10,30,0.45)", overflow: "hidden" }}>
          {film || <IdleFilm />}
          {/* The center card over the film: the breakdowns' background, or the We-Draft.com card. */}
          {card && (
            <div key={card} style={{ position: "absolute", inset: 0, zIndex: 3, ...(cardOut ? anim("wdvFadeOut", 280, 0, "ease-in") : null) }}>
              {card === "logo" ? <IdleFilm />
                : !who ? null
                  : card === "community" ? <CommunityCard key={shown.key} info={info} />
                    : <BackgroundCard key={shown.key} who={who} info={info} shotAt={shotAt} onShots={onShots} />}
            </div>
          )}
          {/* The film window's wipe — only here; the rest of the frame stays put. */}
          {wipe && (
            <div key={`w:${wipe.id}`} onAnimationEnd={(e) => { if (e.animationName === "wdvWipeOut") setWipe((w) => (w?.id === wipe.id ? null : w)); }}
              style={{ position: "absolute", top: -40, bottom: -40, left: -160, right: -160, zIndex: 5, pointerEvents: "none", display: "grid", placeItems: "center",
                backgroundColor: NAVY, backgroundImage: `linear-gradient(90deg, ${GOLD} 0 18px, ${DEEP} 18px, ${BLUE} 50%, ${DEEP} calc(100% - 18px), ${GOLD} calc(100% - 18px))`,
                ...(wipe.out ? anim("wdvWipeOut", WIPE_OUT_MS, 0, "cubic-bezier(.6,0,.4,1)") : anim("wdvWipeIn", WIPE_IN_MS, 0, "cubic-bezier(.6,0,.4,1)")) }}>
              <img src={WeDraftLogo} alt="" style={{ width: 520, height: 180, objectFit: "contain", transform: "skewX(12deg)" }} />
            </div>
          )}
        </div>
        {/* The face cam window: the key color (OBS keys it out — the cam shows
            through), or, with the cam hidden, the We-Draft.com tile. */}
        <Shell box={FACE} fill={cam ? CAM_KEY : DEEP}>
          {!cam && (
            <div key="camOff" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", backgroundImage: `linear-gradient(115deg, ${NAVY} 0%, ${DEEP} 100%)`, ...anim("wdvFade", 300) }}>
              <div style={{ position: "absolute", inset: 0, backgroundImage: STRIPES(0.04) }} />
              <img src={WeDraftLogo} alt="We-Draft.com" style={{ position: "relative", width: 300, height: 110, objectFit: "contain" }} />
            </div>
          )}
        </Shell>
        {/* The side panel, chosen from the Viewer or the iPad — it slides in on a change. */}
        <div key={`s:${side}:${shown.key}`} style={{ position: "absolute", left: PANEL.x - 10, top: PANEL.y - 10, width: PANEL.w + 20, height: PANEL.h + 20, pointerEvents: "none", ...(leaving ? anim("wdvOut", 300, 40, "ease-in") : anim("wdvIn", 450, 60)) }}>
          <div style={{ position: "absolute", left: -(PANEL.x - 10), top: -(PANEL.y - 10), width: W, height: H }}>
          {side === "site" || (!who && !game && side !== "subscribe") ? <SitePanel who={who} />
            : side === "subscribe" ? <SubscribePanel />
              : !who ? <GamePanel box={box} brands={brands} />
                : side === "info" ? <InfoPanel who={who} info={info} />
                  : <PlayerPanel who={who} info={info} />}
          </div>
        </div>
        <img src={WeDraftLogo} alt="We-Draft.com" style={{ position: "absolute", left: PANEL.x, top: 974, width: PANEL.w, height: 76, objectFit: "contain" }} />
      </div>
    </div>
  );
}

// The game's scrub row — it owns the clock, so the film's ~8 time ticks a
// second redraw only this row, not the whole Viewer (user, 2026-11-27: the
// game film felt choppy — every tick re-rendered the frame and the finder).
function GameScrub({ api, timeSub, motion, ticks }) {
  const [t, setT] = useState(0);
  useEffect(() => { timeSub.current = setT; return () => { timeSub.current = null; }; }, [timeSub]);
  const dur = api.current?.duration?.() || 0;
  return (
    <ScrubRow apiRef={api} min={0} max={dur || Math.max(t, 1)} t={t} motion={motion} ticks={ticks}
      onClicks={(dir, n) => { if (n >= 2) api.current?.nudge(5 * dir); }} label={`${clock(t)} / ${clock(dur)}`} />
  );
}

export default function ViewerTab({ games, fileFor, gate, ready, filmPool }) {
  const prefs = useMemo(() => { try { return JSON.parse(localStorage.getItem("wd.film.viewer") || "{}"); } catch { return {}; } }, []);
  const [by, setBy] = useState(prefs.by || "player"); // "player" | "game"
  // The view (user, 2026-11-27): Big screen by default; YouTube mode is the
  // broadcast frame — always up, whole even with nothing on screen. (A new
  // setting: the earlier one defaulted to YouTube.)
  const [layout, setLayout] = useState(prefs.view === "youtube" ? "youtube" : "full"); // "youtube" | "full"
  const [washed, setWashed] = useState(prefs.washed ?? true);
  const [marks, setMarks] = useState(prefs.marks ?? true);
  // The side panel: stats · info (him) · site (the We-Draft.com plug) · subscribe.
  const [side, setSide] = useState(prefs.side || "stats");
  // The face cam window: shown (the key color — OBS's cam shows through) or hidden.
  const [cam, setCam] = useState(prefs.cam ?? true);
  // The center window: film · background (the breakdowns' card) · logo (the We-Draft.com card).
  // Always opens on the film (a card left up last time paused the film under it — "film not playing").
  const [center, setCenter] = useState("film");
  // The background's action shot: which of his center / right-facing shots (the card reports how many).
  const [shotAt, setShotAt] = useState(0);
  const [shotCount, setShotCount] = useState(0);
  useEffect(() => { try { localStorage.setItem("wd.film.viewer", JSON.stringify({ by, view: layout, washed, marks, side, cam })); } catch { /* private window */ } }, [by, layout, washed, marks, side, cam]);
  const [q, setQ] = useState("");
  const [yr, setYr] = useState("");
  const [who, setWho] = useState(null);
  const [game, setGame] = useState(null);
  const [plays, setPlays] = useState(null);
  const [labelF, setLabelF] = useState("all");
  const [at, setAt] = useState(0);
  const [file, setFile] = useState(null);
  const [feat, setFeat] = useState(null); // a game: the player featured in the side bar
  const [gameBox, setGameBox] = useState(null);
  const timeSub = useRef(null);
  const [msg, setMsg] = useState("");
  const api = useRef(null);
  const inkRef = useRef({ strokes: [], cur: null }); // ✏️ Draw's strokes (below)
  // The screen: the one box that goes full screen — it stays put while the
  // play, the player, the game or the view changes (the remote changes them
  // without knocking the PC out of full screen).
  const screenRef = useRef(null);
  const motion = useFastMotion(api, 3);

  const gameById = useMemo(() => Object.fromEntries(games.map((g) => [g.id, g])), [games]);
  const seasons = useMemo(() => [...new Set(games.map(seasonFor).filter(Boolean))].sort((a, b) => b.localeCompare(a)), [games]);

  // ── Finding: players with film; every game film. ──
  const s = q.trim().toLowerCase();
  const people = useMemo(() => {
    const m = new Map();
    filmPool.forEach((p) => { if (p?.key && !m.has(p.key)) m.set(p.key, p); });
    return [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [filmPool]);
  const foundPeople = useMemo(() => people.filter((p) => !s || `${p.name} ${p.team} ${p.pos}`.toLowerCase().includes(s)).slice(0, 200), [people, s]);
  const gameRows = useMemo(() => games.filter((g) => g.file).map((g) => ({ g, name: filmName(g), season: seasonFor(g), hay: `${filmName(g)} ${g.offense} ${g.defense} ${g.home || ""} ${g.away || ""}`.toLowerCase() }))
    .sort((a, b) => String(b.g.date || b.season).localeCompare(String(a.g.date || a.season)) || a.name.localeCompare(b.name)), [games]);
  const foundGames = useMemo(() => gameRows.filter((r) => (!yr || r.season === yr) && (!s || r.hay.includes(s))).slice(0, 300), [gameRows, yr, s]);

  const pickPlayer = (p) => { setWho(person(p)); setGame(null); setPlays(null); setAt(0); setLabelF("all"); };
  const pickGame = (g) => { setGame(g); setWho(null); setPlays(null); setFeat(null); };
  useEffect(() => {
    let c = false;
    if (who) playsForPlayer(who.key).then((ps) => { if (!c) setPlays(ps); }).catch((e) => setMsg(e.message));
    else if (game) playsForGame(game.id).then((ps) => { if (!c) setPlays(ps); }).catch(() => { if (!c) setPlays([]); });
    return () => { c = true; };
  }, [who?.key, game?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setGameBox(null); if (game?.cfbdGameId) loadBox(game.cfbdGameId).then(setGameBox); }, [game?.cfbdGameId]);

  // ── A player's plays. ──
  const tagOf = (p) => (who && p?.players?.[who.key]) || {};
  const labelOf = (p) => tagOf(p).label || "";
  const list = who ? (plays || []).filter((p) => labelF === "all" || (labelF === "untagged" ? !labelOf(p) : labelOf(p) === labelF))
    .sort((a, b) => String(gameById[b.gameId]?.date || seasonFor(gameById[b.gameId])).localeCompare(String(gameById[a.gameId]?.date || seasonFor(gameById[a.gameId]))) || String(a.gameId).localeCompare(String(b.gameId)) || a.in - b.in) : [];
  const idx = list.length ? Math.min(at, list.length - 1) : 0;
  const cur = list[idx] || null;
  const tag = tagOf(cur);
  const range = cur ? { in: tag.trim?.in ?? cur.in, out: tag.trim?.out ?? cur.out } : null;
  const washKeys = tag.wash?.keys || [];
  const mark = markOf(tag);
  // What's on: a player's play, or a whole game.
  const filmGame = who ? (cur ? gameById[cur.gameId] || { id: cur.gameId, file: cur.file } : null) : game;
  const filmKey = who ? cur?.id : game?.id;

  // The film (a click is the gesture Chrome needs the first time). fileBusy:
  // a new file is on its way — the YouTube frame's wipe holds until it's in.
  const [fileBusy, setFileBusy] = useState(false);
  useEffect(() => {
    if (!filmGame) { setFileBusy(false); return undefined; }
    const want = filmGame.file || cur?.file;
    if (want && file?.name === want) { setFileBusy(false); return undefined; }
    let c = false;
    setFileBusy(true);
    fileFor(filmGame).then((f) => { if (!c && f) setFile(f); }).catch(() => {}).finally(() => { if (!c) setFileBusy(false); });
    return () => { c = true; };
  }, [filmKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (d) => { if (list.length) setAt((x) => (Math.min(x, list.length - 1) + d + list.length) % list.length); };
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || !filmGame) return;
      const k = e.key;
      if (k === " ") { e.preventDefault(); api.current?.toggle(); }
      else if (who && (k === "ArrowRight" || k === "n" || k === "N")) { e.preventDefault(); go(1); }
      else if (who && (k === "ArrowLeft" || k === "p" || k === "P")) { e.preventDefault(); go(-1); }
      else if (!who && (k === "ArrowRight" || k === "ArrowLeft")) { e.preventDefault(); api.current?.nudge(k === "ArrowRight" ? 5 : -5); }
      else if (who && (k === "r" || k === "R")) { api.current?.seek(range.in); api.current?.play(); }
      else if (who && (k === "v" || k === "V")) setWashed((x) => !x);
      else if (who && (k === "m" || k === "M")) setMarks((x) => !x);
      else if (layout === "youtube" && (k === "b" || k === "B")) setCenter((x) => (x === "background" ? "film" : "background"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A card over the center: the film waits under it (paused) and plays when
  // the card comes down — always (a film that loaded under the card was never
  // "playing", so remembering that left it stopped).
  const cardUp = layout === "youtube" && (center === "logo" || (PLAYER_CENTERS.includes(center) && !!(who || feat)));
  const wasUp = useRef(cardUp);
  useEffect(() => {
    const a = api.current;
    if (cardUp) a?.pause();
    else if (wasUp.current) a?.play();
    wasUp.current = cardUp;
  }, [cardUp]);
  useEffect(() => { setShotAt(0); }, [(who || feat)?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const player = filmGame && (
    <FilmPlayer key={layout} file={file} gate={gate} apiRef={api} inkRef={inkRef} autoPlay={!cardUp} bare={layout === "youtube"} hud={false} onTime={game ? (x) => timeSub.current?.(x) : undefined}
      stageRef={screenRef}
      fitHeight={layout === "full" ? "calc(100vh - 300px)" : null}
      range={who ? range : null}
      mode={who && washed && washKeys.length ? "wash" : "original"} editWash={false} washKeys={who ? washKeys : []}
      spots={who && marks && mark ? [{ ...mark, color: UI_GOLD }] : []}
      onEnd={who && list.length > 1 ? () => go(1) : undefined}
      style={layout === "youtube" ? { width: "100%", height: "100%" } : undefined} />
  );
  const fullScreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else screenRef.current?.requestFullscreen?.().catch(() => {});
  };
  // A game's people to feature: its box score, team by team.
  const featOptions = (gameBox?.teams || []).map((tm) => ({ team: tm.name, players: [...tm.players].sort((a, b) => String(a.name).localeCompare(String(b.name))) }));
  const featured = who || feat;
  const featureById = (id) => {
    if (!id) { setFeat(null); return; }
    for (const tm of featOptions) { const pl = tm.players.find((x) => String(x.id) === String(id)); if (pl) { setFeat(person({ name: pl.name, team: tm.team, cfbd: pl.id })); return; } }
  };

  // ── Cut (user, 2026-11-27): watching a whole game live, the iPad cuts plays
  // (start / end) or makes the play under the playhead hot, then drops it into
  // players — the Film Manager's hot plays, with buttons (no voice, no labels,
  // no marks: just which players the play is for). ──
  const [cutIn, setCutIn] = useState(null); // the play being cut: its start
  const [hot, setHot] = useState(null); // { id, in, out, playerIds }
  const hotRef = useRef(null);
  hotRef.current = hot;
  useEffect(() => { setCutIn(null); setHot(null); }, [game?.id]);
  const cutStart = () => { const t0 = api.current?.time(); if (t0 != null) setCutIn(Math.round(t0 * 100) / 100); };
  const cutEnd = async () => {
    const t1 = api.current?.time();
    if (!game || cutIn == null || t1 == null) return;
    const a = Math.min(cutIn, t1);
    const b = Math.max(cutIn, t1);
    if (b - a < 0.3) { setMsg("That play is under a third of a second — not cut."); return; }
    setCutIn(null);
    try {
      const p = await cutPlay(game, Math.round(a * 100) / 100, Math.round(b * 100) / 100);
      setPlays((ps) => [...(ps || []), p].sort((x, y) => x.in - y.in));
      setHot({ id: p.id, gameId: p.gameId, in: p.in, out: p.out, playerIds: [] });
      setMsg("");
    } catch (e) { setMsg(`Couldn't save the play: ${e.message}`); }
  };
  const hotHere = () => {
    const t0 = api.current?.time() ?? 0;
    const ps = plays || [];
    const p = ps.find((x) => t0 >= x.in - 0.05 && t0 <= x.out + 0.05) || [...ps].reverse().find((x) => x.in <= t0);
    if (p) setHot({ id: p.id, gameId: p.gameId, in: p.in, out: p.out, playerIds: [...(p.playerIds || [])] });
  };
  // Drop the hot play into a player (or take it back out) — shown at once, then saved.
  const toggleHotTag = async (who0) => {
    const h = hotRef.current;
    if (!h || !who0?.key) return;
    const on = h.playerIds.includes(who0.key);
    const next = { ...h, playerIds: on ? h.playerIds.filter((k) => k !== who0.key) : [...h.playerIds, who0.key] };
    hotRef.current = next;
    setHot(next);
    try {
      if (on) await untagPlayer(h, who0.key); else await tagPlayer(h, who0);
      setPlays((ps) => (ps || []).map((x) => (x.id === h.id ? { ...x, playerIds: next.playerIds } : x)));
    } catch (e) {
      setMsg(`Couldn't ${on ? "untag" : "tag"} ${who0.name}: ${e.message}`);
      setHot((cur) => (cur?.id === h.id ? { ...cur, playerIds: on ? [...cur.playerIds, who0.key] : cur.playerIds.filter((k) => k !== who0.key) } : cur));
    }
  };
  // Hold ◀◀ / ▶▶ on the iPad = fast motion (the Scrub arrows' useFastMotion);
  // a lost let-go can't leave it running.
  const fastSafety = useRef(null);
  const fastStart = (dir) => { motion.start(dir); clearTimeout(fastSafety.current); fastSafety.current = setTimeout(() => motion.end(), 20000); };
  const fastEnd = () => { clearTimeout(fastSafety.current); motion.end(); };
  // Hold 🐢 on the iPad = ½× forward / backward; let go = paused, back at 1×.
  const slowStop = useRef(null);
  const slowEnd = () => {
    clearTimeout(fastSafety.current);
    const a = api.current;
    slowStop.current?.();
    slowStop.current = null;
    a?.pause();
    a?.setRate(1);
  };
  const slowStart = (dir) => {
    const a = api.current;
    if (!a) return;
    slowStop.current?.();
    if (dir > 0) { slowStop.current = null; a.setRate(0.5); a.play(); } else slowStop.current = a.rewind(0.5);
    clearTimeout(fastSafety.current);
    fastSafety.current = setTimeout(slowEnd, 20000);
  };
  // Delete the hot play (the iPad confirms) — off every player it was on.
  const hotDelete = async (id) => {
    const p = (plays || []).find((x) => x.id === id) || (hotRef.current?.id === id ? hotRef.current : null);
    if (!p) return;
    setHot((h) => (h?.id === id ? null : h));
    setPlays((ps) => (ps || []).filter((x) => x.id !== id));
    try { await deletePlay({ id, gameId: p.gameId || game?.id }); } catch (e) { setMsg(`Couldn't delete the play: ${e.message}`); }
  };

  // ── The iPad remote (/film/remote — utils/film/remote.js). Its commands run
  // here, on the film; what's up and the playback go back to it, live. ──
  const remoteRun = useRef(null);
  remoteRun.current = (c) => {
    const a = api.current;
    const x = c.args || {};
    switch (c.type) {
      case "pickPlayer": if (x.person?.key) { setBy("player"); pickPlayer(x.person); } break;
      case "pickGame": { const g = gameById[x.id]; if (g) { setBy("game"); pickGame(g); } break; }
      case "toggle": a?.toggle(); break;
      case "play": a?.play(); break;
      case "pause": a?.pause(); break;
      case "next": go(1); break;
      case "prev": go(-1); break;
      case "jump": { const i = list.findIndex((p) => p.id === x.id); if (i >= 0) setAt(i); break; }
      case "restart": if (range) a?.seek(range.in); else a?.seek(0); a?.play(); break;
      case "skip": a?.nudge(Number(x.s) || 0); break;
      case "seek": a?.seek(Math.max(0, Number(x.t) || 0)); break;
      case "rate": a?.setRate(Number(x.r) || 1); if (a?.paused()) a.play(); break;
      case "washed": setWashed(!!x.on); break;
      case "marks": setMarks(!!x.on); break;
      case "cam": setCam(!!x.on); break;
      case "layout": if (x.v === "youtube" || x.v === "full") setLayout(x.v); break;
      case "label": setLabelF(x.l || "all"); setAt(0); break;
      case "feature": featureById(x.id); break;
      case "side": if (["stats", "info", "site", "subscribe"].includes(x.v)) setSide(x.v); break;
      case "center": if (CENTERS.some(([k]) => k === x.v)) setCenter(x.v); break;
      case "photo": setShotAt((i) => i + (Number(x.d) || 1)); break;
      case "fast": fastStart(Number(x.dir) < 0 ? -1 : 1); break;
      case "fastEnd": fastEnd(); break;
      case "slow": slowStart(Number(x.dir) < 0 ? -1 : 1); break;
      case "slowEnd": slowEnd(); break;
      case "hotDelete": if (game && x.id) hotDelete(x.id); break;
      case "cutStart": if (game) cutStart(); break;
      case "cutEnd": if (game) cutEnd(); break;
      case "cutCancel": setCutIn(null); break;
      case "hotHere": if (game) hotHere(); break;
      case "hotDone": setHot(null); break;
      case "tag": if (x.person?.key) toggleHotTag(x.person); break;
      case "draw": drawOn(x.on ? String(x.sid || "") : ""); break;
      default: break;
    }
  };
  // ✏️ Draw (user, 2026-11-27): the iPad pops into the film and draws on it —
  // this streams the film's canvas to it and draws its strokes over the film
  // (utils/film/remote.js hostDraw). Nothing is saved; popping out clears it.
  const drawStop = useRef(null);
  const [drawSt, setDrawSt] = useState(""); // "" | "connecting" | "live" | "failed"
  const drawOn = (sid) => {
    drawStop.current?.();
    drawStop.current = null;
    inkRef.current = { strokes: [], cur: null };
    if (!sid) { setDrawSt(""); return; }
    setDrawSt("connecting");
    drawStop.current = hostDraw(sid, {
      getCanvas: () => api.current?.canvas?.() || null,
      onStatus: setDrawSt,
      onMsg: (m) => {
        if (m.t === "all") inkRef.current = { strokes: Array.isArray(m.strokes) ? m.strokes : [], cur: null };
        else if (m.t === "cur") inkRef.current = { ...inkRef.current, cur: m.s || null };
        else if (m.t === "cmd" && m.type !== "draw") remoteRun.current?.({ type: m.type, args: m.args || {} });
      },
    });
  };
  useEffect(() => () => drawStop.current?.(), []);
  // A new play / game: a clean slate.
  useEffect(() => { inkRef.current = { strokes: [], cur: null }; }, [filmKey]);
  const [remoteSt, setRemoteSt] = useState({ ok: false, error: "", last: null });
  useEffect(() => watchCmds((c) => remoteRun.current?.(c), setRemoteSt), []);
  // What's up (written when it changes).
  const remoteState = {
    mode: who ? "player" : game ? "game" : null,
    who: who ? { key: who.key, name: who.name, pos: who.pos || "", team: who.team || "", wd: who.wd || null, cfbd: who.cfbd || null } : null,
    game: game ? { id: game.id, name: filmName(game), offense: game.offense || "", defense: game.defense || "",
      focus: (game.focus || []).map((p) => ({ key: p.key, name: p.name || "", pos: p.pos || "", team: p.team || "", wd: p.wd || null, cfbd: p.cfbd || null, jersey: p.jersey ?? null })) } : null,
    cut: game ? { inPt: cutIn, hot: hot ? { id: hot.id, in: hot.in, out: hot.out, ids: hot.playerIds } : null } : null,
    loading: !!(who || game) && plays === null,
    list: list.slice(0, 400).map((p) => ({ id: p.id, g: gameById[p.gameId] ? filmName(gameById[p.gameId]) : p.gameId, o: oppOf(gameById[p.gameId], who?.team), y: seasonFor(gameById[p.gameId]), l: labelOf(p), w: !!tagOf(p).wash?.keys?.length, t: Math.round(p.in) })),
    curId: cur?.id || null, idx, count: list.length,
    washed, marks, layout, labelF, side, center, cam,
    canBg: !!featured, shots: shotCount, shot: shotCount ? ((shotAt % shotCount) + shotCount) % shotCount : 0,
    feat: feat?.cfbd ? String(feat.cfbd) : null,
    featOptions: featOptions.map((tm) => ({ team: tm.team, players: tm.players.map((pl) => ({ id: String(pl.id), name: pl.name })) })),
    // Objects, not [in, out] pairs — Firestore takes no nested arrays.
    ticks: game ? (plays || []).map((p) => ({ a: p.in, b: p.out })) : [],
  };
  const stateKey = JSON.stringify(remoteState);
  const sentState = useRef("");
  useEffect(() => {
    if (stateKey === sentState.current) return undefined;
    const id = setTimeout(() => { sentState.current = stateKey; putState(JSON.parse(stateKey)); }, 150);
    return () => clearTimeout(id);
  }, [stateKey]);
  // The playback: on a change, and a heartbeat every 5 s (the remote runs the clock between).
  const playRef = useRef({ curId: cur?.id || game?.id || null, range });
  playRef.current = { curId: cur?.id || game?.id || null, range };
  useEffect(() => {
    let last = null;
    const id = setInterval(() => {
      const a = api.current;
      const now = Date.now();
      const p = a ? { playing: !a.paused(), t: Math.round((a.time() || 0) * 10) / 10, rate: a.rate() || 1, dur: Math.round((a.duration() || 0) * 10) / 10 } : { playing: false, t: 0, rate: 1, dur: 0 };
      const { curId, range: r } = playRef.current;
      const predicted = last ? last.t + (last.playing ? ((now - last.ms) / 1000) * last.rate : 0) : null;
      const changed = !last || last.playing !== p.playing || last.rate !== p.rate || Math.abs(last.dur - p.dur) > 0.5 || last.curId !== curId || Math.abs(predicted - p.t) > 0.75 || now - last.ms > 5000;
      if (!changed) return;
      last = { ...p, curId, ms: now };
      putPlay({ ...p, curId, rin: r?.in ?? null, rout: r?.out ?? null, ms: now });
    }, 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      {/* Finder */}
      <div style={{ ...panel, position: "sticky", top: 12 }}>
        {/* The iPad remote (/film/remote): listening, its last command, or what's wrong. */}
        <div title="Open we-draft.com/film/remote on the iPad" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: remoteSt.error ? "#ff9b8f" : remoteSt.ok ? "#4ade80" : "#8494ad", ...ellipsis() }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: remoteSt.error ? "#ff6b5b" : remoteSt.ok ? "#4ade80" : "#56637a" }} />
          📱 Remote: {remoteSt.error || (remoteSt.ok ? (remoteSt.last ? `listening · last: ${remoteSt.last.type}` : "listening") : "connecting…")}
          {drawSt && <span style={{ color: drawSt === "failed" ? "#ff9b8f" : "#f6a21d" }}> · ✏️ Draw {drawSt === "live" ? "live" : drawSt === "failed" ? "— film stream failed (ink still comes through)" : "connecting…"}</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" style={chip(by === "player", UI_GOLD)} onClick={() => { setBy("player"); setQ(""); }}>Players</button>
          <button type="button" style={chip(by === "game", UI_GOLD)} onClick={() => { setBy("game"); setQ(""); }}>Games</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={by === "player" ? "Find a player, team or position…" : "Find a team or game…"} style={field} autoFocus />
        {by === "game" && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button type="button" style={chip(!yr)} onClick={() => setYr("")}>All</button>
            {seasons.map((y) => <button key={y} type="button" style={chip(yr === y)} onClick={() => setYr(y)}>{y}</button>)}
          </div>
        )}
        <div style={{ display: "grid", gap: 3, maxHeight: "calc(100vh - 300px)", minHeight: 240, overflowY: "auto", paddingRight: 2 }}>
          {by === "player" ? foundPeople.map((p) => (
            <button key={p.key} type="button" onClick={() => pickPlayer(p)} style={{ textAlign: "left", border: `1px solid ${who?.key === p.key ? UI_BLUE : "#263247"}`, background: who?.key === p.key ? "#1c3355" : "#0f1726", color: "#e8edf5", borderRadius: 8, padding: "6px 9px", cursor: "pointer", display: "grid", gap: 1 }}>
              <span style={ellipsis({ fontSize: 14, fontWeight: 900 })}>{p.name}</span>
              <span style={ellipsis({ fontSize: 11, fontWeight: 800, color: "#8494ad" })}>{[p.pos, p.team].filter(Boolean).join(" · ")}</span>
            </button>
          )) : foundGames.map(({ g, name: gName }) => (
            <button key={g.id} type="button" onClick={() => pickGame(g)} style={{ textAlign: "left", border: `1px solid ${game?.id === g.id ? UI_BLUE : "#263247"}`, background: game?.id === g.id ? "#1c3355" : "#0f1726", color: "#e8edf5", borderRadius: 8, padding: "6px 9px", cursor: "pointer", display: "grid", gap: 1 }}>
              <span style={ellipsis({ fontSize: 13, fontWeight: 900 })}>{gName}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#8494ad" }}>{[dateOf(g.date) || seasonFor(g), g.plays ? `${g.plays} plays cut` : ""].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {by === "player" && !foundPeople.length && <div style={{ fontSize: 12, color: "#8494ad", fontWeight: 700 }}>No one with film matches.</div>}
          {by === "game" && !foundGames.length && <div style={{ fontSize: 12, color: "#8494ad", fontWeight: 700 }}>No game film matches.</div>}
        </div>
      </div>

      {/* Watching */}
      <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 18, fontWeight: 900, ...ellipsis({ maxWidth: 420 }) }}>{who ? who.name : game ? filmName(game) : "Nothing picked"}</div>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#8494ad" }}>{who ? (plays === null ? "Loading plays…" : `${list.length} play${list.length === 1 ? "" : "s"}`) : game ? "Full game" : "Pick a player or a game"}</span>
              <span style={{ flex: 1 }} />
              <span style={head}>View</span>
              <button type="button" style={btn(layout === "full")} onClick={() => setLayout("full")}>Big screen</button>
              <button type="button" style={btn(layout === "youtube")} onClick={() => setLayout("youtube")}>YouTube mode</button>
              {who && (
                <>
                  <span style={head}>Film</span>
                  <button type="button" style={btn(washed)} onClick={() => setWashed(true)} title="Each play's washed version where it has one (V)">Washed</button>
                  <button type="button" style={btn(!washed)} onClick={() => setWashed(false)} title="The plays as cut (V)">Original</button>
                  <button type="button" style={btn(marks)} onClick={() => setMarks((x) => !x)} title="Circles / arrows (M)">Marks {marks ? "on" : "off"}</button>
                </>
              )}
              <button type="button" style={{ ...btn(true), background: UI_GOLD, borderColor: UI_GOLD, color: "#00264d" }} onClick={fullScreen} disabled={layout !== "youtube" && !filmGame}>⛶ Full screen</button>
            </div>
            {layout === "youtube" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={head}>Face cam</span>
                <button type="button" style={chip(cam, UI_GOLD)} onClick={() => setCam(true)} title="The window is OBS's key color (magenta) — the cam shows through">Show</button>
                <button type="button" style={chip(!cam, UI_GOLD)} onClick={() => setCam(false)} title="Covers the window with the We-Draft.com tile">Hide</button>
                <span style={{ ...head, marginLeft: 10 }}>Side panel</span>
                {SIDES.map(([k, l]) => <button key={k} type="button" style={chip(side === k, UI_GOLD)} onClick={() => setSide(k)}>{l}</button>)}
                <span style={{ ...head, marginLeft: 10 }}>Center</span>
                {CENTERS.map(([k, l]) => (
                  <button key={k} type="button" disabled={PLAYER_CENTERS.includes(k) && !featured} title={PLAYER_CENTERS.includes(k) && !featured ? "Feature a player first" : k === "background" ? "The breakdowns' background card (B)" : undefined}
                    style={{ ...chip(center === k, UI_BLUE), opacity: PLAYER_CENTERS.includes(k) && !featured ? 0.45 : 1 }} onClick={() => setCenter(k)}>{l}</button>
                ))}
                {center === "background" && featured && shotCount > 1 && (
                  <button type="button" style={chip(false)} onClick={() => setShotAt((i) => i + 1)}>Photo {((shotAt % shotCount) + shotCount) % shotCount + 1} / {shotCount} ›</button>
                )}
                {center === "background" && featured && shotCount === 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#8494ad" }}>No center / right action shot — portrait tile</span>}
              </div>
            )}
            {/* The screen: YouTube mode is always up (a broadcast never breaks); Big screen once something's picked. */}
            {layout === "youtube" || who || game ? (
              <div ref={screenRef} style={{ position: "relative", width: "100%", background: "#000", borderRadius: 10, overflow: "hidden", ...(layout === "youtube" ? { aspectRatio: "16 / 9" } : { minHeight: 200 }) }}>
                {layout === "youtube"
                  ? <YouTubeFrame who={featured} game={filmGame || game} filmId={who ? `p:${who.key}` : game ? `g:${game.id}` : "none"} side={side} center={center} shotAt={shotAt} onShots={setShotCount} cam={cam}
                    settling={!cardUp && (who ? plays === null || fileBusy : !!game && fileBusy)}>{player}</YouTubeFrame>
                  : player}
                {layout !== "youtube" && !filmGame && who && plays !== null && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 14, fontWeight: 800, color: "#9fb0c8", pointerEvents: "none" }}>No plays{labelF !== "all" ? " with that label" : ""}.</div>}
              </div>
            ) : (
              <div style={{ ...panel, padding: 28, textAlign: "center", fontSize: 14, fontWeight: 800, color: "#9fb0c8" }}>Pick a player (his plays, back to back) or a game (the whole film). Nothing is edited here.</div>
            )}

            {/* A whole game: scrub it (the saved plays are ticks), feature a player. */}
            {game && (
              <>
                <GameScrub api={api} timeSub={timeSub} motion={motion} ticks={(plays || []).map((p) => ({ id: p.id, in: p.in, out: p.out }))} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" style={btn(true)} onClick={() => api.current?.toggle()}>▶ / ❚❚</button>
                  <span style={head}>Side bar</span>
                  <select value={feat ? String(feat.cfbd) : ""} onChange={(e) => featureById(e.target.value)} style={{ ...field, width: "auto", maxWidth: 320, padding: "5px 8px", fontSize: 13 }}>
                    <option value="">The game — final + leaders</option>
                    {featOptions.map((tm) => (
                      <optgroup key={tm.team} label={tm.team}>{tm.players.map((pl) => <option key={pl.id} value={String(pl.id)}>{pl.name}</option>)}</optgroup>
                    ))}
                  </select>
                  {!gameBox && <span style={{ fontSize: 11, fontWeight: 800, color: "#8494ad" }}>{game.cfbdGameId ? "Loading the box score…" : "Not on a game — no box score"}</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>Space play / pause · ←/→ 5s · hold ◀ ▶ fast · F full screen</span>
                </div>
                {/* Cutting from the iPad. */}
                {(cutIn != null || hot) && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, fontWeight: 800 }}>
                    {cutIn != null && <span style={{ color: "#f6c66b" }}>✂ Play started at {clock(cutIn)} — end it on the iPad</span>}
                    {hot && <span style={{ color: "#4ade80" }}>🔥 Hot {clock(hot.in)}–{clock(hot.out)} · {hot.playerIds.length} player{hot.playerIds.length === 1 ? "" : "s"}</span>}
                    {hot && <button type="button" style={chip(false)} onClick={() => setHot(null)}>Done</button>}
                  </div>
                )}
              </>
            )}

            {/* A player's plays: back to back; filter by label, click to jump. */}
            {who && cur && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" style={btn(false)} onClick={() => go(-1)} title="← / P">◀ Last</button>
                <span style={{ fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>Play {idx + 1} / {list.length}</span>
                <button type="button" style={btn(false)} onClick={() => go(1)} title="→ / N">Next ▶</button>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#8494ad", ...ellipsis({ maxWidth: 380 }) }}>{filmName(filmGame)}</span>
                {washed && !washKeys.length && <span style={{ fontSize: 11, fontWeight: 800, color: "#f6c66b" }}>No wash on this play — the original</span>}
              </div>
            )}
            {msg && <div style={{ fontSize: 12, fontWeight: 700, color: "#ff7a6b" }}>{msg}</div>}
            {who && plays && plays.length > 0 && (
              <div style={panel}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={head}>Plays</span>
                  {["all", ...LABELS, "untagged"].map((l) => <button key={l} type="button" style={chip(labelF === l, LABEL_COLORS[l] || UI_BLUE)} onClick={() => { setLabelF(l); setAt(0); }}>{l === "all" ? "All" : l === "untagged" ? "No label" : l}</button>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                  {list.map((p, i) => {
                    const g = gameById[p.gameId];
                    const l = labelOf(p);
                    return (
                      <button key={p.id} type="button" onClick={() => setAt(i)} style={{ textAlign: "left", border: `1px solid ${i === idx ? UI_GOLD : "#263247"}`, background: i === idx ? "#2a2410" : "#0f1726", color: "#e8edf5", borderRadius: 8, padding: "5px 8px", cursor: "pointer", display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 900, color: UI_GOLD, width: 26, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                        <span style={ellipsis({ fontSize: 12, fontWeight: 800, flex: 1 })}>{g ? filmName(g) : p.gameId}</span>
                        {tagOf(p).wash?.keys?.length > 0 && <span title="Has a washed version" style={{ fontSize: 10, fontWeight: 900, color: "#6fb1ff" }}>W</span>}
                        {l && <span style={{ width: 8, height: 8, borderRadius: 4, background: LABEL_COLORS[l], flexShrink: 0 }} title={l} />}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8494ad" }}>Keys: Space play / pause · ←/→ or N/P last / next play · R restart · V washed / original · M marks · B background · F full screen</div>
              </div>
            )}
        </>
      </div>
    </div>
  );
}
