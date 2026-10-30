// src/broadcast/OnTheClockScreen.js
//
// On the Clock's 1920×1080 frame (pages/BroadcastOnTheClockPage.js): the
// nightly Draft Sim broadcast, played from its script at `now`
// (utils/draftSim/onTheClock.js momentAt). Everything here is a function of
// (script, now) — the stream and every site viewer render the same frame.
//
//   top bar      brand, LIVE, the format, round · pick, the show clock
//   stage        (left) pre-show countdown (who's on the clock first and
//                when, over rotating prospect spotlights, the first-round
//                order and the sim's ad) → intro → team on the clock (best
//                available) → trade → the pick is in →
//                the pick → round break (the round's picks) → final grades
//   desk         (right) the analyst desk's posts, newest on top — before
//                the draft, its pre-draft lines in rotation; verified
//                analysts carry the check
//   up next      (bottom) the next picks, then the last few made
//
// Motion: the team screen just updates — the new team's colors cross-fade
// in and its content fades over; when the pick is in, the same screen's
// clock turns into "The Pick Is In" (no screen of its own). The big moments
// — the pick, a trade, a round break, the final — open with a team-color
// wipe across the stage and build in piece by piece (otcIn, --d delays):
// the pick lands big (otcSlam) with a light sweep; a trade's logos come in
// from either side and meet.
// Desk posts and previous picks slide in as they're added. Each animation
// runs once. The clock bar is one CSS animation per beat, offset to where
// the beat is.
//
// links: the site's interactive version (pages/DraftSimLive.jsx) — every
// player's name a link to his page and every team's logo and name to its
// NFL page, each in a new tab so the show keeps playing. Off on the YouTube
// frame, which renders exactly as before.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gradeLabel, gradeLook } from "../utils/communityGrades";
import { postsAt, INTRO_MS, showTimes, spotlights, firstOnClock, easternClock, pregamePosts, PREGAME_POST_MS, ownersAt, tradesAired } from "../utils/draftSim/onTheClock";
import { ordinal } from "../utils/draftSim/analysts";
import { textOn } from "../utils/teamColors";
import { GOLD, SITE_BLUE } from "./broadcastStyle";

const WD_ICON = "/wd-icon.png";

export const OTC_STYLE = `
.otc { position: absolute; inset: 0; }
.otc-bg { position: absolute; inset: 0; transition: background 1.2s ease; }
.otc-fade { animation: otcFade .8s ease both; }
@keyframes otcFade { from { opacity: 0; } to { opacity: 1; } }
.otc-update { animation: otcFade .45s ease both; }
.otc-layer { position: absolute; inset: 0; }
.otc-enter { animation: otcFade .6s ease .25s both; }
.otc-leave { animation: otcLeave .45s ease-in both; pointer-events: none; z-index: 2; }
/* the frame leaving is moved into this layer (a re-mount): hold it as it
   finished — no entrance animations replayed, no wipe */
.otc-leave * { animation: none !important; }
.otc-leave.otc-slide-out { animation: otcSlideOut .32s cubic-bezier(.4,0,1,1) both; }
.otc-enter.otc-slide-in { animation: otcSlideIn .5s cubic-bezier(0,0,.2,1) .3s both; }
@keyframes otcSlideOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(-40px); } }
@keyframes otcSlideIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: none; } }
.otc-leave .otc-wipe, .otc-leave .otc-shine { display: none; }
@keyframes otcLeave { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-18px); } }
.otc-pickin { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px 26px; border-radius: 16px; background: rgba(0,0,0,.4); border: 2px solid var(--pi, ${GOLD}); text-align: center; }
.otc-pickin .bc-disp { font-size: 64px; line-height: .9; }
.otc-in { animation: otcIn .65s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0ms); }
@keyframes otcIn { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }
.otc-in-l { animation: otcInL .7s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0ms); }
@keyframes otcInL { from { opacity: 0; transform: translateX(-80px); } to { opacity: 1; transform: none; } }
.otc-in-r { animation: otcInR .7s cubic-bezier(.2,.8,.2,1) both; animation-delay: var(--d, 0ms); }
@keyframes otcInR { from { opacity: 0; transform: translateX(80px); } to { opacity: 1; transform: none; } }
.otc-pop { animation: otcPop .7s cubic-bezier(.2,1.3,.4,1) both; animation-delay: var(--d, 0ms); }
@keyframes otcPop { from { opacity: 0; transform: scale(.55); } to { opacity: 1; transform: none; } }
.otc-slam { animation: otcSlam .75s cubic-bezier(.15,.9,.25,1) both; animation-delay: var(--d, 0ms); transform-origin: 0 60%; }
@keyframes otcSlam { 0% { opacity: 0; transform: scale(1.45); filter: blur(10px); } 60% { opacity: 1; filter: blur(0); } 100% { opacity: 1; transform: none; filter: none; } }
.otc-beat { animation: otcBeat 1.1s ease-in-out 3 both; animation-delay: var(--d, 0ms); }
@keyframes otcBeat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
.otc-spin { animation: otcSpin .9s cubic-bezier(.3,.9,.3,1) both; animation-delay: var(--d, 0ms); }
@keyframes otcSpin { from { opacity: 0; transform: rotate(-180deg) scale(.5); } to { opacity: 1; transform: none; } }
.otc-wipe { position: absolute; inset: 0; z-index: 5; pointer-events: none; overflow: hidden; }
.otc-wipe i { position: absolute; top: -10%; bottom: -10%; left: 0; width: 70%; transform: translateX(-150%) skewX(-16deg); animation: otcWipe .95s cubic-bezier(.65,0,.35,1) both; }
.otc-wipe i:nth-child(1) { background: var(--w2); }
.otc-wipe i:nth-child(2) { background: var(--w1); animation-delay: 90ms; }
@keyframes otcWipe { from { transform: translateX(-150%) skewX(-16deg); } to { transform: translateX(230%) skewX(-16deg); } }
.otc-shine { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.otc-shine::after { content: ""; position: absolute; top: 0; bottom: 0; width: 28%; left: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent); transform: translateX(-120%) skewX(-18deg); animation: otcShine 1.3s ease-out .55s both; }
@keyframes otcShine { from { transform: translateX(-120%) skewX(-18deg); } to { transform: translateX(420%) skewX(-18deg); } }
@keyframes otcBar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.otc-top { position: absolute; left: 56px; right: 56px; top: 56px; height: 60px; display: flex; align-items: center; gap: 22px; }
.otc-brand { display: flex; align-items: center; gap: 14px; }
.otc-brand img { width: 54px; height: 54px; }
.otc-brand .bc-disp { font-size: 54px; line-height: 1; padding-top: 4px; }
.otc-live { display: inline-flex; align-items: center; gap: 10px; height: 40px; padding: 0 16px; border-radius: 8px; background: #d62828; color: #fff; font-size: 24px; font-weight: 800; letter-spacing: .12em; }
.otc-live i { width: 12px; height: 12px; border-radius: 50%; background: #fff; }
.otc-ctx { font-size: 27px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #9fb0c8; padding-left: 22px; border-left: 2px solid rgba(255,255,255,.18); }
.otc-pill { height: 44px; display: inline-flex; align-items: center; padding: 0 18px; border-radius: 8px; background: rgba(255,255,255,.08); font-size: 26px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.otc-stage { position: absolute; left: 56px; top: 132px; width: 1240px; height: 804px; border-radius: 22px; overflow: hidden; background: #0b1424; border: 1px solid rgba(255,255,255,.08); }
.otc-desk { position: absolute; left: 1320px; right: 56px; top: 132px; height: 804px; border-radius: 22px; overflow: hidden; background: #0b1424; border: 1px solid rgba(255,255,255,.08); display: flex; flex-direction: column; }
.otc-desk-h { padding: 18px 24px 14px; font-size: 26px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: ${GOLD}; border-bottom: 1px solid rgba(255,255,255,.08); display: flex; align-items: center; gap: 12px; }
.otc-post-in { animation: otcPostIn .6s cubic-bezier(.2,.8,.2,1) both; }
@keyframes otcPostIn { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: none; } }
.otc-post { padding: 16px 22px; border-bottom: 1px solid rgba(255,255,255,.06); display: flex; gap: 14px; }
.otc-post .who { display: flex; align-items: baseline; gap: 8px; font-size: 22px; font-weight: 800; }
.otc-post .h { font-size: 18px; color: #7f91ab; font-weight: 600; }
.otc-post .tx { font-family: Arial, sans-serif; font-weight: 400; font-size: 21px; line-height: 1.3; color: #e7edf6; margin-top: 4px; }
.otc-post .ln { font-family: Arial, sans-serif; font-weight: 400; font-size: 18px; line-height: 1.3; color: #a9b7cb; margin-top: 4px; }
.otc-av { width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0; object-fit: cover; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; color: #fff; }
.otc-bottom { position: absolute; left: 56px; right: 56px; top: 956px; height: 92px; display: flex; gap: 10px; align-items: stretch; }
.otc-strip-h { flex-shrink: 0; display: flex; align-items: center; padding: 0 16px; border-radius: 12px; background: ${GOLD}; color: #111; font-size: 22px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; line-height: 1.05; text-align: center; }
.otc-recap-list { flex: 1; min-width: 0; display: flex; gap: 10px; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, #000 90%, transparent); mask-image: linear-gradient(90deg, #000 90%, transparent); }
.otc-chip { flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 0 20px 0 16px; border-radius: 12px; background: #0b1424; border: 1px solid rgba(255,255,255,.08); white-space: nowrap; max-width: 380px; }
.otc-chip-in { animation: otcChipIn .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes otcChipIn { from { opacity: 0; transform: translateX(-60px) scale(.95); } to { opacity: 1; transform: none; } }
.otc-chip .n { font-size: 30px; font-weight: 800; color: ${GOLD}; min-width: 36px; text-align: right; }
.otc-chip .nm { font-size: 26px; font-weight: 800; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; }
.otc-chip .sub { font-size: 19px; font-weight: 600; color: #9fb0c8; overflow: hidden; text-overflow: ellipsis; }
.otc-chip .ab { color: #fff; font-weight: 800; letter-spacing: .04em; }
.otc-next { position: absolute; left: 0; right: 0; top: 0; height: 40px; display: flex; align-items: stretch; background: rgba(0,0,0,.45); border-bottom: 1px solid rgba(255,255,255,.08); }
.otc-next .lbl { flex-shrink: 0; display: flex; align-items: center; padding: 0 18px 0 56px; background: ${GOLD}; color: #111; font-size: 19px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.otc-next .list { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; padding-left: 10px; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, #000 92%, transparent); mask-image: linear-gradient(90deg, #000 92%, transparent); }
.otc-next .it { flex-shrink: 0; font-size: 20px; font-weight: 700; color: #c3cfdf; padding: 3px 10px; border-radius: 6px; letter-spacing: .04em; }
.otc-next .it b { color: #7f91ab; font-weight: 700; margin-right: 6px; }
.otc-next .it.now { background: ${GOLD}; color: #111; }
.otc-next .it.now b { color: #111; }
.otc-next .rd { flex-shrink: 0; margin: 0 6px; padding: 2px 8px; border-radius: 6px; border: 2px solid ${GOLD}; color: ${GOLD}; font-size: 17px; font-weight: 800; letter-spacing: .08em; }
.otc-label { font-size: 30px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.otc-cand { display: flex; align-items: center; gap: 18px; height: 78px; padding: 0 22px; border-radius: 14px; background: rgba(0,0,0,.28); position: relative; overflow: hidden; }
.otc-cand .bar { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(255,255,255,.12); transition: width .8s ease; }
.otc-cand > *:not(.bar) { position: relative; }
.otc-x { color: inherit; text-decoration: none; cursor: pointer; pointer-events: auto; }
.otc-x:hover { text-decoration: underline; text-decoration-thickness: 3px; text-underline-offset: 6px; }
.otc-x:hover img { filter: brightness(1.12) drop-shadow(0 0 10px rgba(255,255,255,.35)); }
.otc-x img { transition: filter .15s ease; }
.otc-grade { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 8px; font-size: 22px; font-weight: 800; letter-spacing: .06em; color: #fff; }
`;

const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
const name = (p) => (p ? `${p.f} ${p.l}`.trim() : "");
// An animation delay (the .otc-in family reads --d).
const d = (ms) => ({ "--d": `${ms}ms` });
const ROUND_WORD = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"];

function Avatar({ a, size = 46 }) {
  if (a?.avatar) return <img className="otc-av" src={a.avatar} alt="" style={{ width: size, height: size }} />;
  return <span className="otc-av" style={{ width: size, height: size, background: `linear-gradient(140deg, ${a?.color || SITE_BLUE}, #111a2e)` }}>{a?.initials || "WD"}</span>;
}

// The clock bar fills as the clock runs: one CSS animation over the whole
// segment, its start fixed when the segment mounts (re-timing it on every
// tick would run it fast). A preview that's paused or sped up draws it from
// m.progress instead.
function ClockBar({ m, color }) {
  return (
    <div style={{ height: 14, borderRadius: 7, background: "rgba(0,0,0,.35)", overflow: "hidden" }}>
      <ClockFill key={`${m.seg.start}`} m={m} color={color} />
    </div>
  );
}
function ClockFill({ m, color }) {
  const [anim] = useState(() => `otcBar ${m.seg.end - m.seg.start}ms linear ${-(m.t - m.seg.start)}ms both`);
  const bar = m.realtime === false ? { transform: `scaleX(${m.progress})` } : { animation: anim };
  return <div style={{ height: "100%", background: color, transformOrigin: "0 50%", ...bar }} />;
}

// The interactive version's links ({ abbrOf: team → abbr }), null on the
// YouTube frame — where these render their children as they are.
const Links = createContext(null);
function PlayerLink({ p, children }) {
  const on = useContext(Links);
  if (!on || !p?.slug) return children;
  return <a className="otc-x" href={`/player/${p.slug}`} target="_blank" rel="noopener noreferrer" title={`${name(p)} — player page`}>{children}</a>;
}
// team: a script team (or abbr: its abbreviation).
function TeamLink({ team, abbr, children }) {
  const on = useContext(Links);
  const a = abbr || on?.abbrOf.get(team);
  if (!on || !a) return children;
  return <a className="otc-x" href={`/nfl/${String(a).toLowerCase()}`} target="_blank" rel="noopener noreferrer" title={`${on.nameOf(a)} — team page`}>{children}</a>;
}
const PName = ({ p }) => <PlayerLink p={p}>{name(p)}</PlayerLink>;

function TeamLogo({ team, size }) {
  const logo = team?.logo ? <img src={team.logo} alt="" style={{ width: size, height: size, objectFit: "contain" }} /> : <span style={{ width: size, height: size }} />;
  return <TeamLink team={team}>{logo}</TeamLink>;
}

// One line of text at the largest size from max down to min (step 2) that
// fits its box; still too long at min, it's cut with an ellipsis. Measured
// again when the text changes and once the fonts are in (the frame's
// scaled with a transform, which doesn't change these widths). text: what's
// shown (and what it's measured on — children may wrap it in a link).
function FitText({ text, max, min, className = "", style, children }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  // from: the size to start at — max (a new text, the fonts loaded), else
  // the current one (it's come to overflow: a font swapped in late).
  const fit = useCallback((from) => {
    const el = ref.current;
    if (!el) return;
    let px = from;
    el.style.fontSize = `${px}px`;
    while (px > min && el.scrollWidth > el.clientWidth + 1) { px -= 2; el.style.fontSize = `${px}px`; }
    setSize(px);
  }, [min]);
  useLayoutEffect(() => {
    fit(max);
    let alive = true;
    const again = () => { if (alive) fit(max); };
    document.fonts?.ready?.then(again);
    document.fonts?.addEventListener?.("loadingdone", again);
    return () => { alive = false; document.fonts?.removeEventListener?.("loadingdone", again); };
  }, [text, max, fit]);
  // Every render (the show's clock ticks): still overflowing? fit again.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && size > min && el.scrollWidth > el.clientWidth + 1) fit(size);
  });
  return <div ref={ref} className={`bc-ell ${className}`} style={{ ...style, fontSize: size }}>{children ?? text}</div>;
}

// A community grade, as the site brands it (components/GradeChip.jsx, the
// player pages' badge): the grade's own colors with its darker border — the
// qualifier ("LATE") over the round ("1st") over ROUND — and its full name
// beside it. None yet: a dash.
function GradeTile({ label, title = "Community grade" }) {
  const look = label ? gradeLook(label) : null;
  return (
    <div style={{ gridColumn: "1 / -1", padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,.06)", minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#9fb0c8", marginBottom: 6 }}>{title}</div>
      {look ? (
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <span style={{ flexShrink: 0, minWidth: 76, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "6px 10px",
            background: look.bg, border: `4px solid ${look.border}`, borderRadius: 10, color: "#fff", lineHeight: 1, textAlign: "center" }}>
            {look.qualifier && <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: ".08em", opacity: 0.9 }}>{look.qualifier}</span>}
            <span className="bc-disp" style={{ fontSize: 42, lineHeight: 0.9 }}>{look.short}</span>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", opacity: 0.8 }}>ROUND</span>
          </span>
          <span className="bc-disp bc-ell" style={{ fontSize: 36, lineHeight: 1, minWidth: 0 }}>{label}</span>
        </div>
      ) : <div className="bc-disp" style={{ fontSize: 46, lineHeight: 1.05 }}>—</div>}
    </div>
  );
}

// The team on the clock (before a trade: the team that held the pick).
function onClockTeam(m) {
  if (!m.beat) return null;
  if (m.beat.trade && m.kind === "clock") return m.beat.trade.from;
  return m.beat.team;
}

// The verified check (SimFeed.jsx's), sized for the frame.
function Verified({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Verified" style={{ flexShrink: 0, alignSelf: "center" }}>
      <path fill="#1d9bf0" d="M12 1.5l2.6 2.1 3.3-.4 1.1 3.1 3 1.6-.9 3.2.9 3.2-3 1.6-1.1 3.1-3.3-.4L12 22.5l-2.6-2.1-3.3.4-1.1-3.1-3-1.6.9-3.2-.9-3.2 3-1.6 1.1-3.1 3.3.4z" />
      <path fill="#fff" d="M10.6 15.6l-3.2-3.2 1.3-1.3 1.9 1.9 4.7-4.7 1.3 1.3z" />
    </svg>
  );
}

// The countdown: who's on the clock first and when, in that team's colors,
// with the clock to Round 1 Pick 1 (the intro fills its last INTRO_MS);
// under it, a card every PRESHOW_CARD_MS on the show clock — prospect
// spotlights, with the first round's order and the sim's ad between.
const PRESHOW_CARD_MS = 20000;
const mod = (n, k) => ((n % k) + k) % k;
function preshowCards(script) {
  const out = [];
  spotlights(script).forEach((sp, i) => {
    out.push({ key: `sp${sp.pid}`, kind: "spot", sp });
    if (i % 3 === 2) out.push(i % 6 === 2 ? { key: `order${i}`, kind: "order" } : { key: `ad${i}`, kind: "ad" });
  });
  return out.length ? out : [{ key: "order", kind: "order" }];
}
function Countdown({ script, m }) {
  const team = script.teams[firstOnClock(script)] || {};
  const c1 = team.c1 || SITE_BLUE;
  const c2 = team.c2 || GOLD;
  const ink = textOn(c1, c2);
  const cards = preshowCards(script);
  const card = cards[mod(Math.floor(m.t / PRESHOW_CARD_MS), cards.length)];
  return (
    <div className="otc-fade" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 30, padding: "30px 36px", color: ink, overflow: "hidden",
        background: `linear-gradient(120deg, ${c1} 0%, ${c1} 55%, color-mix(in srgb, ${c2} 70%, ${c1}) 130%)`, borderBottom: `6px solid ${c2}` }}>
        <TeamLogo team={team} size={180} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="otc-label bc-ell" style={{ fontSize: 24, opacity: 0.85 }}>Tonight · {script.format.label}</div>
          <div className="bc-disp" style={{ fontSize: 40, lineHeight: 1, marginTop: 14, opacity: 0.9 }}>The <TeamLink team={team}>{team.nick || "first team"}</TeamLink> are on the clock at</div>
          <div className="bc-disp" style={{ fontSize: 120, lineHeight: 0.9, marginTop: 4, whiteSpace: "nowrap" }}>{easternClock(showTimes(script).firstPick)}</div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "center", padding: "16px 26px 10px", borderRadius: 18, background: "rgba(0,0,0,.42)", color: "#fff" }}>
          <div className="otc-label" style={{ fontSize: 20, color: "#c3cfdf" }}>Draft starts in</div>
          {/* To Round 1 Pick 1 — the intro fills the countdown's last INTRO_MS. */}
          <div className="bc-disp" style={{ fontSize: 118, lineHeight: 1, color: GOLD, fontVariantNumeric: "tabular-nums" }}>{fmtClock(m.left + INTRO_MS)}</div>
        </div>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <StageSwap id={card.key} slide>
          {card.kind === "spot" && <Spotlight script={script} sp={card.sp} />}
          {card.kind === "order" && <FirstRoundOrder script={script} />}
          {card.kind === "ad" && <PreshowAd />}
        </StageSwap>
      </div>
    </div>
  );
}

const SPOT_LOGO = 118;
const SPOT_LOGO_MAX_W = 220;
const SPOT_LOGO_INSET = 5;
const heightText = (inches) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : "");

// Each position's name and color on the spotlight's badge.
const POSITION = {
  QB: ["Quarterback", "#d62828"], RB: ["Running Back", "#2e9e5b"], WR: ["Wide Receiver", "#1d6fc0"], TE: ["Tight End", "#7a3cff"],
  OL: ["Offensive Line", "#a0662b"], DL: ["Defensive Line", "#c2410c"], EDGE: ["Edge Rusher", "#db2777"], LB: ["Linebacker", "#0e9f9f"],
  DB: ["Defensive Back", "#b7791f"],
};

// A prospect on the countdown. Left: his name, school and size, then his
// position — a badge in its color, named in full — and his season line
// (where he led the nation, too). Right, as the pick screen has it (Reveal): his board
// and position ranks, the community's grade, strengths and concerns.
function Spotlight({ script, sp }) {
  const p = script.players[sp.pid] || {};
  const season = script.preshow?.season;
  const [posName, posColor] = POSITION[p.pos] || [p.pos, SITE_BLUE];
  const hasLine = sp.stats?.length > 0;
  // (His size is in the boxes when there's no season line.)
  const facts = [p.sch, ...(hasLine ? [heightText(p.ht), p.wt ? `${p.wt} lbs` : ""] : [])].filter(Boolean);
  // No season line (a lineman, mostly): his size in the boxes instead.
  const chips = hasLine ? sp.stats : [
    p.ht && { label: "Height", v: heightText(p.ht) },
    p.wt && { label: "Weight", v: `${p.wt} lbs` },
    p.count >= 10 && { label: "Community boards", v: String(p.count) },
  ].filter(Boolean);
  const label = gradeLabel(p.avg);
  const traits = (title, color, mark, list, delay) => (list?.length ? (
    <div>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color, marginBottom: 4 }}>{title}</div>
      {list.slice(0, 3).map((t, k) => (
        <div key={t} className="otc-in" style={{ display: "flex", gap: 10, fontSize: 22, fontWeight: 700, lineHeight: 1.2, padding: "2px 0", ...d(delay + k * 110) }}>
          <span style={{ color, fontWeight: 800, width: 14 }}>{mark}</span><span className="bc-ell">{t}</span>
        </div>
      ))}
    </div>
  ) : null);
  return (
    <div style={{ height: "100%", padding: "24px 32px 24px 36px", display: "flex", gap: 28, boxSizing: "border-box" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="otc-in" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="otc-label" style={{ fontSize: 20, color: GOLD }}>Prospect Spotlight</span>
        </div>
        {/* The name's cap tops the logo and the school line's baseline meets
            its bottom: the logo set by its height (a wide one gets its width,
            up to SPOT_LOGO_MAX_W), the column that height less the padding
            a logo file carries (SPOT_LOGO_INSET), each line's leading trimmed
            (line-height 1, pulled in by the font's own margins). */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {p.logo ? <img className="otc-pop" src={p.logo} alt="" style={{ height: SPOT_LOGO, width: "auto", maxWidth: SPOT_LOGO_MAX_W, objectFit: "contain", flexShrink: 0, ...d(120) }} /> : null}
          <div style={{ flex: 1, minWidth: 0, height: SPOT_LOGO - 2 * SPOT_LOGO_INSET, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <FitText text={name(p)} max={86} min={48} className="bc-disp otc-in" style={{ lineHeight: 1, margin: "-0.093em 0 -0.116em", ...d(160) }}><PName p={p} /></FitText>
            <div className="otc-in bc-ell" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: "#b9c6d8", marginBottom: -3, ...d(220) }}>{facts.join(" · ")}</div>
          </div>
        </div>
        <div className="otc-in" style={{ display: "flex", alignItems: "stretch", alignSelf: "flex-start", borderRadius: 12, overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,.3)", ...d(260) }}>
          <span className="bc-disp" style={{ display: "flex", alignItems: "center", padding: "4px 18px", fontSize: 54, lineHeight: 1, background: posColor, color: "#fff" }}>{p.pos}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 18px", background: `color-mix(in srgb, ${posColor} 28%, #0b1424)`, color: "#fff" }}>
            <span className="bc-disp" style={{ fontSize: 40, lineHeight: 1 }}>{posName}</span>
            {p.posRank ? <span style={{ fontSize: 22, fontWeight: 800, color: "#dbe6f5", letterSpacing: ".06em" }}>{p.pos}{p.posRank} on the board</span> : null}
          </span>
        </div>
        {chips.length > 0 && (
          <>
            {hasLine && (
              <div className="otc-in" style={{ fontSize: 22, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#9fb0c8", marginBottom: -6, ...d(320) }}>
                {season ? `${season} season` : "This season"}
                {sp.leader && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 700 }}> · <span style={{ color: GOLD }}>{sp.leader.tied ? "Tied for " : ""}{ordinal(sp.leader.rank)} in the nation in {sp.leader.stat}</span> <span style={{ color: "#e7edf6" }}>({sp.leader.v})</span></span>}
              </div>
            )}
            <div className="otc-in" style={{ display: "flex", gap: 12, ...d(380) }}>
              {chips.map((c) => (
                <div key={c.label} style={{ flex: 1, minWidth: 0, padding: "10px 14px", borderRadius: 14, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)" }}>
                  <div className="bc-disp" style={{ fontSize: 54, lineHeight: 1 }}>{c.v}</div>
                  <div className="bc-ell" style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#9fb0c8" }}>{c.label}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="otc-in-r" style={{ width: 390, flexShrink: 0, alignSelf: "center", borderRadius: 18, background: "rgba(5,10,20,.72)", border: "1px solid rgba(255,255,255,.1)", padding: "18px 20px", color: "#fff", display: "flex", flexDirection: "column", gap: 12, ...d(260) }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Stat k="Board" v={p.rank != null ? `#${p.rank}` : "—"} />
          <Stat k={`${p.pos} rank`} v={p.posRank != null ? `${p.pos}${p.posRank}` : "—"} />
          <GradeTile label={label} />
        </div>
        {traits("Strengths", "#5fd38a", "+", p.str, 420)}
        {traits("Concerns", "#ff7a6b", "−", p.wk, 640)}
        {!(p.str || []).length && !(p.wk || []).length && <div style={{ fontSize: 19, color: "#9fb0c8" }}>No community evaluations yet.</div>}
      </div>
    </div>
  );
}

// The first round's order as it stands before the draft: none of the sim's
// trades yet (ownersAt).
function FirstRoundOrder({ script }) {
  const r1 = script.beats.filter((b) => b.round === 1);
  const owners = ownersAt(script, 0);
  return (
    <div style={{ height: "100%", padding: "26px 36px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="otc-label otc-in" style={{ fontSize: 22, color: GOLD }}>The First Round Order</div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gridAutoRows: "1fr", gap: 10 }}>
        {r1.map((b, k) => {
          const abbr = owners[b.overall] || b.team;
          const t = script.teams[abbr] || {};
          return (
            <div key={b.overall} className="otc-in" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderRadius: 12,
              background: `linear-gradient(135deg, color-mix(in srgb, ${t.c1 || SITE_BLUE} 70%, #0b1424), #0b1424)`, ...d(30 * k) }}>
              <span className="bc-disp" style={{ fontSize: 34, color: GOLD, minWidth: 34, textAlign: "right" }}>{b.overall}</span>
              <TeamLogo team={t} size={52} />
              <span style={{ fontSize: 20, fontWeight: 800 }}><TeamLink abbr={abbr}>{abbr}</TeamLink></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The sim's ad, as a countdown card.
function PreshowAd() {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 40, padding: "0 50px",
      background: `linear-gradient(135deg, ${SITE_BLUE}, #0b2a52 70%)` }}>
      <img className="otc-pop" src={WD_ICON} alt="" style={{ width: 190, height: 190 }} />
      <div>
        <div className="bc-disp otc-in" style={{ fontSize: 100, lineHeight: 0.9 }}>Run your own draft</div>
        <div className="otc-in" style={{ fontSize: 30, fontWeight: 700, color: "#dbe6f5", marginTop: 14, maxWidth: 720, ...d(120) }}>
          Pick for your team, make trades, and get your draft graded in the We-Draft.com Draft Sim.
        </div>
        <div className="bc-disp otc-in" style={{ fontSize: 54, color: GOLD, marginTop: 14, ...d(220) }}>we-draft.com/draftsim</div>
      </div>
    </div>
  );
}

function Intro({ script }) {
  const rounds = Math.max(0, ...script.beats.map((b) => b.round));
  return (
    <div className="otc-fade" style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, textAlign: "center" }}>
      <img src={WD_ICON} alt="" style={{ width: 150, height: 150 }} />
      <div className="bc-disp" style={{ fontSize: 170, lineHeight: 0.9 }}>On the Clock</div>
      <div className="bc-disp" style={{ fontSize: 70, color: GOLD }}>{script.format.label}</div>
      <div style={{ fontSize: 32, color: "#c3cfdf", fontWeight: 700 }}>{rounds} round{rounds === 1 ? "" : "s"} · {script.beats.length} picks · 32 CPU war rooms</div>
    </div>
  );
}

// The team on the clock — and, once the pick is in, the same screen with the
// clock turned to "The Pick Is In" (m.kind "pickIn"), so it reads as an
// update, not a new screen.
function OnClock({ script, m }) {
  const abbr = onClockTeam(m);
  const team = script.teams[abbr] || {};
  const b = m.beat;
  const pickIn = m.kind === "pickIn";
  // After a trade up, the team that moved up is picking (its own picks and targets).
  const traded = pickIn && !!b.trade;
  return (
    <div className="otc-update" style={{ height: "100%", padding: "40px 56px", display: "flex", flexDirection: "column", gap: 22, color: textOn(team.c1) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        <div className={pickIn ? "otc-beat" : undefined}><TeamLogo team={team} size={180} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="otc-label bc-ell" style={{ opacity: 0.85 }}>{pickIn ? "The pick is in" : "On the Clock"} · Pick {b.overall} · {team.city}</div>
          <FitText text={team.nick || abbr} max={140} min={80} className="bc-disp"><TeamLink abbr={abbr}>{team.nick || abbr}</TeamLink></FitText>
          <div style={{ fontSize: 30, fontWeight: 700, opacity: 0.85 }}>{ROUND_WORD[b.round] || `Round ${b.round}`} round · pick {b.inRound}{b.via && !b.trade ? ` · via ${script.teams[b.via]?.nick || b.via}` : ""}</div>
          <TeamPicks picks={traded ? b.trade.picks : b.picks} />
        </div>
        {pickIn ? (
          <div className="otc-pop" style={{ minWidth: 190, display: "flex", justifyContent: "flex-end" }}>
            <div className="otc-pickin" style={{ "--pi": team.c2 || GOLD, color: "#fff" }}><span className="bc-disp">The Pick</span><span className="bc-disp" style={{ color: GOLD }}>Is In</span></div>
          </div>
        ) : (
          <div className="bc-disp" style={{ fontSize: 120, minWidth: 190, textAlign: "right" }}>{fmtClock(m.left)}</div>
        )}
      </div>
      {pickIn ? (
        <div style={{ height: 14, borderRadius: 7, background: team.c2 || GOLD }} />
      ) : <ClockBar m={m} color={team.c2 || GOLD} />}
      <Targets script={script} targets={traded ? b.trade.targets : b.targets} />
      <SoFar script={script} m={m} abbr={abbr} team={team} />
    </div>
  );
}

// The team's picks left tonight, as the Draft Sim's stage shows them:
// numbered chips, the one on the clock solid.
function TeamPicks({ picks }) {
  if (!picks?.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
      <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: ".18em", opacity: 0.75 }}>PICKS</span>
      {picks.map((n, i) => (
        <span key={n} style={{ fontSize: 22, fontWeight: 800, padding: "3px 13px", borderRadius: 999, background: i === 0 ? "#fff" : "rgba(255,255,255,0.14)", color: i === 0 ? "#0b1220" : "#fff" }}>{n}</span>
      ))}
    </div>
  );
}

// Potential Targets: three players the team might take (the script's
// targets) — just the players.
function Targets({ script, targets }) {
  if (!targets?.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="otc-label" style={{ fontSize: 24, opacity: 0.8, marginBottom: 10 }}>Potential Targets</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${targets.length}, minmax(0, 1fr))`, gap: 12 }}>
        {targets.map((pid) => {
          const p = script.players[pid] || {};
          return (
            <div key={pid} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 16px", borderRadius: 14, background: "rgba(5,10,20,.55)", color: "#fff", minWidth: 0 }}>
              {p.logo ? <img src={p.logo} alt="" style={{ width: 58, height: 58, objectFit: "contain", flexShrink: 0 }} /> : null}
              <div style={{ minWidth: 0 }}>
                <FitText text={name(p)} max={28} min={20} style={{ fontWeight: 800, lineHeight: 1.1 }}><PName p={p} /></FitText>
                <div className="bc-ell" style={{ fontSize: 19, color: "#b9c6d8", marginTop: 3 }}>{p.pos} · {p.sch}</div>
                <div className="bc-ell" style={{ fontSize: 17, fontWeight: 800, color: GOLD, marginTop: 3, letterSpacing: ".04em" }}>Board #{p.rank}{p.posRank ? ` · ${p.pos}${p.posRank}` : ""}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The team on the clock's picks so far tonight. Up to six in three columns;
// more, the grid widens (to five) and the tiles tighten; past SO_FAR_MAX,
// the oldest fold into a "+N more" tile — always two rows at most.
const SO_FAR_MAX = 10;
function SoFar({ script, m, abbr, team }) {
  const mine = script.beats.slice(0, m.beatIdx).filter((x) => x.team === abbr);
  const nick = team.nick || abbr;
  const more = mine.length > SO_FAR_MAX ? mine.length - (SO_FAR_MAX - 1) : 0;
  const shown = more ? mine.slice(-(SO_FAR_MAX - 1)) : mine;
  const tiles = shown.length + (more ? 1 : 0);
  const cols = tiles <= 6 ? 3 : Math.min(5, Math.ceil(tiles / 2));
  const tight = cols > 3;
  return (
    <div style={{ marginTop: "auto" }}>
      <div className="otc-label" style={{ fontSize: 24, opacity: 0.8, marginBottom: 10 }}>{nick} picks so far{mine.length ? ` · ${mine.length}` : ""}</div>
      {!mine.length ? (
        <div style={{ fontSize: 26, fontWeight: 700, opacity: 0.85 }}>First pick of the night for the {nick}.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: tight ? 8 : 10 }}>
          {more ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "rgba(0,0,0,.3)", color: "#fff", fontSize: 22, fontWeight: 800 }}>+{more} more</div>
          ) : null}
          {shown.map((x) => {
            const p = script.players[x.pid] || {};
            return (
              <div key={x.overall} style={{ display: "flex", alignItems: "center", gap: tight ? 8 : 12, padding: tight ? "8px 10px" : "10px 14px", borderRadius: 12, background: "rgba(0,0,0,.3)", color: "#fff", minWidth: 0 }}>
                <span className="bc-disp" style={{ fontSize: tight ? 28 : 34, color: GOLD, minWidth: tight ? 36 : 44 }}>{x.overall}</span>
                {p.logo ? <img src={p.logo} alt="" style={{ width: tight ? 30 : 38, height: tight ? 30 : 38, objectFit: "contain", flexShrink: 0 }} /> : null}
                <div style={{ minWidth: 0 }}>
                  <div className="bc-ell" style={{ fontSize: tight ? 20 : 23, fontWeight: 800 }}><PlayerLink p={p}>{tight ? `${(p.f || "")[0] || ""}. ${p.l}` : name(p)}</PlayerLink></div>
                  <div className="bc-ell" style={{ fontSize: tight ? 15 : 17, color: "#b9c6d8" }}>R{x.round} · {p.pos}{tight ? "" : ` · ${p.sch}`}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Trade({ script, m }) {
  const t = m.beat.trade;
  const to = script.teams[t.to] || {};
  const from = script.teams[t.from] || {};
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30, color: textOn(to.c1), textAlign: "center" }}>
      <div className="otc-label otc-pop" style={{ fontSize: 40, padding: "4px 22px", borderRadius: 10, background: "rgba(0,0,0,.35)", color: GOLD, ...d(300) }}>Trade</div>
      <div style={{ display: "flex", alignItems: "center", gap: 60 }}>
        <div className="otc-in-l" style={{ ...d(420), animationDuration: "900ms" }}><TeamLogo team={to} size={200} /></div>
        <div className="bc-disp otc-spin" style={{ fontSize: 90, ...d(800) }}>⇄</div>
        <div className="otc-in-r" style={{ ...d(420), animationDuration: "900ms" }}><TeamLogo team={from} size={200} /></div>
      </div>
      <div className="bc-disp otc-in" style={{ fontSize: 96, ...d(1000) }}>The {to.nick} move up to No. {m.beat.overall}</div>
      <div className="otc-in" style={{ fontSize: 34, fontWeight: 700, ...d(1200) }}>{from.nick} get {t.give.join(", ")}</div>
    </div>
  );
}

// The selection: the pick lands big on the left; the scouting card on the
// right — board rank, position rank, community grade, size, and the
// community's strengths and concerns.
const sizeOf = (p) => [p.ht ? `${Math.floor(p.ht / 12)}-${p.ht % 12}` : null, p.wt ? `${p.wt} lbs` : null].filter(Boolean).join(" · ");
function Reveal({ script, m }) {
  const b = m.beat;
  const team = script.teams[b.team] || {};
  const p = script.players[b.pid] || {};
  const fg = textOn(team.c1);
  const tag = b.value >= 5 ? { t: `Value +${b.value}`, c: "#2e9d4f" } : b.value <= -8 ? { t: `Reach ${b.value}`, c: "#c0392b" } : null;
  const label = gradeLabel(p.avg);
  // The name as big as it fits the left column (Bebas runs ~0.42em a letter).
  const longest = Math.max((p.f || "").length, (p.l || "").length, 1);
  const nameSize = Math.min(190, Math.floor(640 / (longest * 0.43)));
  const size = sizeOf(p);
  return (
    <div key={`r${b.overall}`} style={{ position: "relative", height: "100%", padding: "44px 48px 44px 56px", display: "flex", gap: 36, color: fg }}>
      {team.logo && <div className="otc-in" style={{ position: "absolute", left: 220, top: "50%", marginTop: -310, pointerEvents: "none", ...d(300), animationDuration: "1.4s" }}><img src={team.logo} alt="" style={{ width: 620, height: 620, objectFit: "contain", opacity: 0.12 }} /></div>}
      <div className="otc-shine" />
      <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 22 }}>
        <div className="otc-in" style={{ display: "flex", alignItems: "center", gap: 18, ...d(250) }}>
          <TeamLogo team={team} size={80} />
          <div className="otc-label bc-ell" style={{ opacity: 0.9, minWidth: 0 }}>Pick {b.overall} · <TeamLink abbr={b.team}>{team.nick}</TeamLink></div>
          {b.trade && <span className="otc-pill" style={{ flexShrink: 0, height: 36, fontSize: 20, background: GOLD, color: "#111" }}>Trade</span>}
        </div>
        <div className="bc-disp" style={{ fontSize: nameSize, lineHeight: 0.86 }}>
          <div className="otc-slam" style={d(380)}><PlayerLink p={p}>{p.f}</PlayerLink></div>
          <div className="otc-slam" style={d(520)}><PlayerLink p={p}>{p.l}</PlayerLink></div>
        </div>
        <div className="otc-in" style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 8, ...d(900) }}>
          {p.logo ? <img src={p.logo} alt="" style={{ width: 150, height: 150, objectFit: "contain", flexShrink: 0 }} /> : null}
          <div style={{ minWidth: 0 }}>
            <div className="bc-disp bc-ell" style={{ fontSize: 76, lineHeight: 0.95 }}>{p.sch}</div>
            <div className="bc-ell" style={{ fontSize: 32, fontWeight: 800, opacity: 0.9, marginTop: 6 }}>{p.pos} · {ROUND_WORD[b.round] || `Round ${b.round}`} round, pick {b.inRound}</div>
          </div>
        </div>
        {tag ? (
          <div className="otc-in" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", ...d(1050) }}>
            <span className="otc-pill" style={{ background: tag.c, color: "#fff" }}>{tag.t}</span>
          </div>
        ) : null}
      </div>
      <div className="otc-in-r" style={{ position: "relative", width: 440, flexShrink: 0, alignSelf: "center", borderRadius: 18, background: "rgba(5,10,20,.72)", border: "1px solid rgba(255,255,255,.1)", padding: "24px 26px", color: "#fff", display: "flex", flexDirection: "column", gap: 18, ...d(1000) }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Stat k="Board" v={p.rank != null ? `#${p.rank}` : "—"} />
          <Stat k={`${p.pos} rank`} v={p.posRank != null ? `${p.pos}${p.posRank}` : "—"} />
          <GradeTile label={label} />
          {size && <Stat wide v={size} small />}
        </div>
        <Traits title="Strengths" color="#5fd38a" mark="+" list={p.str} delay={1250} />
        <Traits title="Concerns" color="#ff7a6b" mark="−" list={p.wk} delay={1450} />
        {!(p.str || []).length && !(p.wk || []).length && <div style={{ fontSize: 20, color: "#9fb0c8" }}>No community evaluations yet.</div>}
      </div>
    </div>
  );
}

// wide: the whole row (the grade's longest label, "MIDDLE 1ST", needs it).
function Stat({ k, v, sub, small, wide }) {
  return (
    <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,.06)", minWidth: 0, ...(wide ? { gridColumn: "1 / -1" } : {}) }}>
      {k && <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#9fb0c8" }}>{k}</div>}
      <div className="bc-disp bc-ell" style={{ fontSize: small ? 34 : 46, lineHeight: 1.05 }}>{v}</div>
      {sub && <div style={{ fontSize: 15, color: "#9fb0c8" }}>{sub}</div>}
    </div>
  );
}

function Traits({ title, color, mark, list, delay }) {
  if (!list?.length) return null;
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color, marginBottom: 6 }}>{title}</div>
      {list.map((t, k) => (
        <div key={t} className="otc-in" style={{ display: "flex", gap: 10, fontSize: 24, fontWeight: 700, lineHeight: 1.25, padding: "3px 0", ...d(delay + k * 110) }}>
          <span style={{ color, fontWeight: 800, width: 16 }}>{mark}</span><span>{t}</span>
        </div>
      ))}
    </div>
  );
}

function RoundBreak({ script, m }) {
  const round = m.seg.round;
  const picks = script.beats.filter((b) => b.round === round);
  const cols = picks.length > 16 ? 2 : 1;
  return (
    <div style={{ height: "100%", padding: "34px 44px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="bc-disp otc-slam" style={{ fontSize: 80, color: GOLD, ...d(300) }}>Round {round} Complete</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoFlow: "column", gridTemplateRows: `repeat(${Math.ceil(picks.length / cols)}, 1fr)`, columnGap: 28, flex: 1, minHeight: 0 }}>
        {picks.map((b, k) => {
          const p = script.players[b.pid] || {};
          const t = script.teams[b.team] || {};
          return (
            <div key={b.overall} className="otc-in" style={{ ...d(600 + k * 35), display: "flex", alignItems: "center", gap: 12, fontSize: 21, fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,.06)" }}>
              <span style={{ width: 44, color: "#7f91ab", textAlign: "right" }}>{b.overall}</span>
              <TeamLogo team={t} size={28} />
              <span className="bc-ell" style={{ flex: 1 }}><PName p={p} /></span>
              <span style={{ color: "#9fb0c8", width: 60 }}>{p.pos}</span>
              <span className="bc-ell" style={{ color: "#7f91ab", width: 170 }}>{p.sch}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Final: it rotates (FINAL_PAGE_MS a page, sliding like Best Available) —
// every team's grade on one board, then the classes, FINAL_TEAMS teams a
// page in grade order: each team's grade over every pick it made, each pick
// with its own grade. The stage is full width by then (no desk, no
// previous picks).
const FINAL_ROWS = 8;
const FINAL_TEAMS = 4;
const FINAL_PAGE_MS = 20000;
function Final({ script, m }) {
  const grades = script.grades;
  const classes = [];
  for (let i = 0; i < grades.length; i += FINAL_TEAMS) classes.push(i);
  const pages = ["board", ...classes];
  const idx = Math.floor(Math.max(0, m.t - m.seg.start) / FINAL_PAGE_MS) % pages.length;
  const page = pages[idx];
  const label = page === "board" ? `All ${grades.length} teams` : `Ranked ${page + 1}–${Math.min(grades.length, page + FINAL_TEAMS)}`;
  return (
    <div style={{ height: "100%", padding: "28px 40px 30px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 26 }}>
        <div className="bc-disp otc-slam" style={{ fontSize: 88, color: GOLD, ...d(250) }}>Final Draft Grades</div>
        <div className="otc-label otc-in" style={{ color: "#9fb0c8", ...d(500) }}>{script.format.label}</div>
        <div key={label} className="otc-label otc-update" style={{ marginLeft: "auto", color: "#fff" }}>{label}</div>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <StageSwap id={`final-${idx}`} slide>
          {page === "board" ? <GradeBoard script={script} /> : <Classes script={script} from={page} />}
        </StageSwap>
      </div>
    </div>
  );
}

// Every team's grade, best first: four columns of eight.
function GradeBoard({ script }) {
  const grades = script.grades;
  const cols = Math.max(1, Math.ceil(grades.length / FINAL_ROWS));
  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${FINAL_ROWS}, minmax(0, 1fr))`, gridAutoFlow: "column", gap: "10px 16px" }}>
      {grades.map((g, i) => {
        const t = script.teams[g.team] || {};
        const best = g.best && script.players[g.best.pid];
        return (
          <div key={g.team} className="otc-in" style={{ ...d(300 + i * 40), display: "flex", alignItems: "center", gap: 12, padding: "0 16px", borderRadius: 12, minWidth: 0,
            background: `linear-gradient(90deg, ${t.c1}, color-mix(in srgb, ${t.c1} 30%, #0b1424) 70%)` }}>
            <span className="bc-disp" style={{ fontSize: 34, width: 34, textAlign: "right", color: textOn(t.c1), opacity: 0.85 }}>{i + 1}</span>
            <TeamLogo team={t} size={52} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bc-ell" style={{ fontSize: 27, fontWeight: 800, color: "#fff" }}>{t.nick || g.team}</div>
              {best && <div className="bc-ell" style={{ fontSize: 16, color: "#dbe4f0" }}>Best: <PName p={best} /> · No. {g.best.overall}</div>}
            </div>
            <GradeLetter size={62}>{g.letter}</GradeLetter>
          </div>
        );
      })}
    </div>
  );
}

// FINAL_TEAMS teams' classes side by side, from rank `from`.
function Classes({ script, from }) {
  const teams = script.grades.slice(from, from + FINAL_TEAMS);
  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: `repeat(${FINAL_TEAMS}, minmax(0, 1fr))`, gap: 16 }}>
      {teams.map((g, k) => <TeamClass key={g.team} script={script} g={g} rank={from + k + 1} delay={300 + k * 120} />)}
    </div>
  );
}

// One team's class: its grade up top, then every pick (as many as fit —
// the rows tighten for a big class).
function TeamClass({ script, g, rank, delay }) {
  const t = script.teams[g.team] || {};
  const rows = g.rows || [];
  const tight = rows.length > 9;
  return (
    <div className="otc-in" style={{ ...d(delay), display: "flex", flexDirection: "column", minWidth: 0, borderRadius: 16, overflow: "hidden", background: "rgba(5,10,20,.55)", border: "1px solid rgba(255,255,255,.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: `linear-gradient(90deg, ${t.c1}, color-mix(in srgb, ${t.c1} 35%, #0b1424))` }}>
        <span className="bc-disp" style={{ fontSize: 36, color: textOn(t.c1), opacity: 0.85 }}>{rank}</span>
        <TeamLogo team={t} size={60} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="bc-ell" style={{ fontSize: 30, fontWeight: 800, color: "#fff" }}>{t.nick || g.team}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#dbe4f0" }}>{rows.length} pick{rows.length === 1 ? "" : "s"}</div>
        </div>
        <GradeLetter size={76}>{g.letter}</GradeLetter>
      </div>
      {/* Listed from the top at a steady spacing — a small class leaves the bottom empty. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: tight ? 9 : 16, padding: tight ? "12px 14px 8px" : "18px 14px 8px" }}>
        {rows.map((r) => {
          const p = script.players[r.pid] || {};
          return (
            <div key={r.o} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, color: "#fff" }}>
              <span className="bc-disp" style={{ fontSize: tight ? 24 : 30, color: GOLD, minWidth: tight ? 36 : 44, textAlign: "right" }}>{r.o}</span>
              {p.logo ? <img src={p.logo} alt="" style={{ width: tight ? 24 : 30, height: tight ? 24 : 30, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: tight ? 24 : 30, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="bc-ell" style={{ fontSize: tight ? 18 : 21, fontWeight: 800, lineHeight: 1.1 }}><PName p={p} /></div>
                {!tight && <div className="bc-ell" style={{ fontSize: 15, color: "#9fb0c8" }}>R{r.r} · {p.pos} · {p.sch}</div>}
              </div>
              {tight && <span style={{ fontSize: 15, color: "#9fb0c8", flexShrink: 0 }}>{p.pos}</span>}
              <span className="bc-disp" style={{ fontSize: tight ? 26 : 32, minWidth: 40, textAlign: "right", color: "#dbe4f0" }}>{r.g}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A grade letter in gold, shadowed so it reads on any team color.
function GradeLetter({ size, children }) {
  return <div className="bc-disp" style={{ fontSize: size, color: GOLD, minWidth: size, textAlign: "right", textShadow: "0 2px 0 rgba(0,0,0,.55), 0 0 14px rgba(0,0,0,.6)" }}>{children}</div>;
}

const DESK_SKIP = "wedraft";
// The desk's latest comment, as big as it fits: after it mounts (and again
// once the fonts are in) its text steps down in size (--k) until the post
// fits the space left in the panel.
const DESK_SCALES = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.53, 0.47];
function DeskPost({ post, a }) {
  const ref = useRef(null);
  const [k, setK] = useState(1);
  const [fontsIn, setFontsIn] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => { if (alive) setFontsIn(true); });
    return () => { alive = false; };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    let fit = DESK_SCALES[DESK_SCALES.length - 1];
    for (const scale of DESK_SCALES) {
      el.style.setProperty("--k", scale);
      if (el.scrollHeight <= box.clientHeight) { fit = scale; break; }
    }
    el.style.setProperty("--k", fit);
    setK(fit);
  }, [post.key, fontsIn]);
  return (
    <div ref={ref} className="otc-post otc-post-in" style={{ borderBottom: "none", padding: "20px 22px", "--k": k }}>
      <Avatar a={a} size={58} />
      <div style={{ minWidth: 0 }}>
        <div className="who" style={{ fontSize: "calc(24px * var(--k))" }}><span style={{ color: a.color === SITE_BLUE ? "#6fb1ff" : a.color }}>{a.name}</span>{a.verified && <Verified size={24} />}<span className="h">{a.handle}</span></div>
        <div className="tx" style={{ fontSize: "calc(26px * var(--k))", lineHeight: 1.3, marginTop: 6 }}>{post.text}</div>
        {(post.lines || []).slice(0, 1).map((l) => <div key={l} className="ln" style={{ fontSize: "calc(21px * var(--k))" }}>{l}</div>)}
      </div>
    </div>
  );
}

// The pick the desk's Best Available is for: the one on the stage, else the
// next one up (after a pick, the board as it stands now). None at the final.
function upBeat(script, m) {
  if (m.beat && ["clock", "trade", "pickIn"].includes(m.kind)) return { b: m.beat, idx: m.beatIdx, team: onClockTeam(m) };
  if (m.kind === "final") return null;
  const idx = m.kind === "preshow" || m.kind === "intro" ? 0 : m.made;
  const b = script.beats[idx];
  return b ? { b, idx, team: ownersAt(script, tradesAired(script, m))[b.overall] || b.team } : null;
}

// Best Available rotates: Overall, then each position — the top BA_SIZE still
// on the board (script.board less everyone drafted before the pick that's
// up), BA_MS each. On the show clock, so every screen shows the same page.
const BA_SIZE = 5;
const BA_MS = 15000;
const BA_AD_EVERY = 3;
// The list's (and the ad's) height, so the desk under it never moves.
const BA_HEIGHT = 396;
const BA_PAGES = ["Overall", "QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
function bestAvailable(script, upIdx, t) {
  const taken = new Set(script.beats.slice(0, upIdx).map((x) => x.pid));
  const left = (pos) => (script.board?.[pos] || []).filter((pid) => !taken.has(pid));
  const pages = BA_PAGES.map((key) => {
    if (key !== "Overall") return { key, list: left(key).slice(0, BA_SIZE) };
    const all = Object.keys(script.board || {}).flatMap(left);
    const list = all.length ? all.sort((x, y) => (script.players[x]?.rank ?? 1e9) - (script.players[y]?.rank ?? 1e9)).slice(0, BA_SIZE) : script.beats[upIdx]?.top || [];
    return { key, list };
  }).filter((pg) => pg.list.length);
  if (!pages.length) return null;
  // The rotation, with the Draft Sim ad after every BA_AD_EVERY pages (the
  // tab before it stays lit while it's up).
  const seq = pages.flatMap((page, i) => ((i + 1) % BA_AD_EVERY === 0 ? [{ page }, { page, ad: true }] : [{ page }]));
  const slot = seq[Math.floor(Math.max(0, t) / BA_MS) % seq.length];
  return { pages, page: slot.page, ad: !!slot.ad };
}

// The Draft Sim ad, in Best Available's spot (the same height as its list).
function SimAd() {
  return (
    <div style={{ height: 380, margin: "10px 16px 6px", borderRadius: 14, padding: "22px 24px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, color: "#fff",
      background: `linear-gradient(135deg, ${SITE_BLUE}, #0b2a52 70%)`, border: `2px solid ${GOLD}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src={WD_ICON} alt="" style={{ width: 64, height: 64 }} />
        <div className="bc-disp" style={{ fontSize: 58, lineHeight: 0.9 }}>Run Your<br />Own Draft</div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3, color: "#dbe6f5" }}>
        Pick for your team, make trades, and get your draft graded in the We-Draft.com Draft Sim.
      </div>
      <div className="bc-disp" style={{ fontSize: 40, color: GOLD }}>we-draft.com/draftsim</div>
    </div>
  );
}

// The desk panel: Best Available for the pick that's up (rotating through
// the positions), and under it the desk's latest comment.
function Desk({ script, timeline, m }) {
  // We-Draft.com's own posts stay off the desk — the stage tells the pick.
  // Before the draft, the pre-draft lines in rotation (We-Draft.com's too).
  const pregame = m.kind === "preshow" ? pregamePosts(script) : null;
  const post = pregame
    ? (pregame.length ? pregame[mod(Math.floor(m.t / PREGAME_POST_MS), pregame.length)] : null)
    : postsAt(script, timeline, m.t, 12).find((p) => p.a !== DESK_SKIP);
  const up = upBeat(script, m);
  const ba = up ? bestAvailable(script, up.idx, m.t) : null;
  const a = post ? script.analysts[post.a] || {} : null;
  return (
    <div className="otc-desk">
      {ba && (
        <>
          <div className="otc-desk-h"><span>Best Available</span><span style={{ marginLeft: "auto", color: "#9fb0c8", fontSize: 22 }}>No. {up.b.overall} · {up.team}</span></div>
          <div style={{ display: "flex", gap: 4, padding: "10px 16px 0", flexWrap: "nowrap" }}>
            {ba.pages.map((pg) => (
              <span key={pg.key} style={{ fontSize: 16, fontWeight: 800, letterSpacing: ".06em", padding: "3px 7px", borderRadius: 6, background: pg === ba.page ? GOLD : "transparent", color: pg === ba.page ? "#111" : "#7f91ab", transition: "background .3s, color .3s" }}>{pg.key === "Overall" ? "ALL" : pg.key}</span>
            ))}
          </div>
          {/* Each page (and the ad) slides in as the last slides out. Keyed by
              the page only: when a pick lands, the list updates in place. */}
          <div style={{ position: "relative", height: BA_HEIGHT, flexShrink: 0, overflow: "hidden" }}>
          <StageSwap id={ba.ad ? `ad-${ba.page.key}` : `ba-${ba.page.key}`} slide>
          {ba.ad ? <SimAd /> : (
          <div style={{ padding: "10px 16px 6px", display: "flex", flexDirection: "column", gap: 8 }}>
            {ba.page.list.map((pid, k) => {
              const p = script.players[pid] || {};
              return (
                <div key={pid} className="otc-cand" style={{ color: "#fff", height: 62, padding: "0 14px", gap: 12 }}>
                  <span className="bc-disp" style={{ fontSize: 30, color: "#7f91ab", width: 22, textAlign: "right" }}>{k + 1}</span>
                  {p.logo ? <img src={p.logo} alt="" style={{ width: 38, height: 38, objectFit: "contain" }} /> : <span style={{ width: 38 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FitText text={name(p)} max={24} min={18} style={{ fontWeight: 800 }}><PName p={p} /></FitText>
                    <div className="bc-ell" style={{ fontSize: 17, color: "#b9c6d8" }}>{p.pos}{p.posRank || ""} · {p.sch} · #{p.rank} overall</div>
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 18, fontWeight: 700, color: "#9fb0c8", padding: "2px 4px" }}>
              Run your own draft at <span style={{ color: GOLD }}>we-draft.com/draftsim</span>
            </div>
          </div>
          )}
          </StageSwap>
          </div>
        </>
      )}
      <div className="otc-desk-h" style={{ borderTop: ba ? "1px solid rgba(255,255,255,.08)" : "none" }}><img src={WD_ICON} alt="" style={{ width: 30, height: 30 }} />The Desk</div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {post ? (
          <DeskPost key={post.key} post={post} a={a} />
        ) : (
          <div style={{ padding: "16px 22px", display: "flex", flexWrap: "wrap", gap: 14 }}>
            {Object.entries(script.analysts).filter(([id]) => id !== DESK_SKIP).map(([id, x]) => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 800 }}>
                <Avatar a={x} size={40} /><span style={{ color: x.color === SITE_BLUE ? "#6fb1ff" : x.color }}>{x.name}</span>{x.verified && <Verified size={20} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Up Next, along the top: the pick on the stage, then the ones after it —
// just the number and the team's abbreviation.
const UP_NEXT = 24;
function UpNext({ script, m }) {
  const beats = script.beats;
  const onStage = m.beat && ["clock", "trade", "pickIn"].includes(m.kind) ? m.beatIdx : null;
  const from = onStage ?? Math.min(m.kind === "preshow" || m.kind === "intro" ? 0 : m.made, beats.length);
  const slots = beats.slice(from, from + UP_NEXT);
  // Each pick's team as of now: only the trades that have aired.
  const owners = ownersAt(script, tradesAired(script, m));
  return (
    <div className="otc-next">
      <div className="lbl">Up Next</div>
      <div className="list">
        {!slots.length && <span className="it" style={{ color: "#fff" }}>That&apos;s the draft · Run your own at <span style={{ color: GOLD }}>we-draft.com/draftsim</span></span>}
        {slots.map((b, k) => {
          const i = from + k;
          const abbr = i === onStage ? onClockTeam(m) : owners[b.overall] || b.team;
          const newRound = k > 0 && b.round !== slots[k - 1].round;
          return [
            newRound ? <span key={`r${b.round}`} className="rd">R{b.round}</span> : null,
            <span key={b.overall} className={`it${i === onStage ? " now" : ""}`}><b>{b.overall}</b><TeamLink abbr={abbr}>{abbr}</TeamLink></span>,
          ];
        })}
      </div>
    </div>
  );
}

// The previous picks, along the bottom: every pick made, newest first.
const RECAP = 10;
function Recap({ script, m }) {
  const made = script.beats.slice(Math.max(0, m.made - RECAP), m.made).reverse();
  return (
    <div className="otc-bottom">
      <div className="otc-strip-h">Previous<br />Picks</div>
      <div className="otc-recap-list">
        {!made.length && <div className="otc-chip" style={{ color: "#9fb0c8" }}>The first pick is coming up</div>}
        {made.map((b) => {
          const p = script.players[b.pid] || {};
          return (
            <div key={b.overall} className="otc-chip otc-chip-in">
              <span className="n">{b.overall}</span>
              <TeamLogo team={script.teams[b.team]} size={46} />
              <div style={{ minWidth: 0 }}>
                <div className="nm"><PName p={p} /></div>
                <div className="sub"><span className="ab"><TeamLink abbr={b.team}>{b.team}</TeamLink></span> · {p.pos} · {p.sch}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Which screen the stage is showing: a team's clock and its pick-is-in are
// one screen (it updates); every other segment is its own.
const stageId = (m) => (m.kind === "clock" || m.kind === "pickIn" ? `c${m.beat.overall}` : m.kind === "reveal" ? `r${m.beat.overall}` : `${m.kind}${m.seg?.start ?? ""}`);

// The stage's screens cross-fade: when the screen changes, the one leaving
// stays up as a frozen frame (its last render) and fades out, drifting up a
// touch, while the new one fades in under it — no cut to an empty stage.
const SWAP_MS = 700;
// slide: the carousel look (Best Available) — out to the left, in from the right.
function StageSwap({ id, children, slide = false }) {
  const cur = useRef({ id, el: children });
  const [leaving, setLeaving] = useState(null);
  const changed = cur.current.id !== id;
  const old = changed ? cur.current : null;
  if (!changed) cur.current = { id, el: children };
  useLayoutEffect(() => {
    if (!old) return undefined;
    cur.current = { id, el: children };
    setLeaving(old);
    const t = setTimeout(() => setLeaving((l) => (l === old ? null : l)), SWAP_MS);
    return () => clearTimeout(t);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {leaving && <div key={`out-${leaving.id}`} className={`otc-layer otc-leave${slide ? " otc-slide-out" : ""}`}>{leaving.el}</div>}
      <div key={`in-${id}`} className={`otc-layer otc-enter${slide ? " otc-slide-in" : ""}`}>{children}</div>
    </>
  );
}

// The beats that open with the wipe (the team screen just updates).
const WIPE = ["intro", "trade", "reveal", "roundBreak", "final"];

export default function OnTheClockScreen({ script, timeline, m, links = false }) {
  const linkCtx = useMemo(() => (links ? {
    abbrOf: new Map(Object.entries(script.teams || {}).map(([abbr, t]) => [t, abbr])),
    nameOf: (abbr) => script.teams?.[abbr]?.name || abbr,
  } : null), [links, script]);
  const stageTeam = ["clock", "trade", "pickIn", "reveal"].includes(m.kind)
    ? script.teams[m.kind === "trade" ? m.beat.trade.to : onClockTeam(m)] : null;
  const bg = stageTeam
    ? `radial-gradient(1100px 760px at 20% 30%, color-mix(in srgb, ${stageTeam.c1} 55%, transparent), transparent 70%), linear-gradient(180deg, #08142a, #050a14)`
    : "radial-gradient(1200px 700px at 50% 120%, rgba(0,85,165,0.35), transparent 70%), linear-gradient(180deg, #08142a 0%, #050a14 100%)";
  // The final takes the whole frame under the top bar.
  const final = m.kind === "final";
  const stageFill = stageTeam ? `linear-gradient(135deg, ${stageTeam.c1}, color-mix(in srgb, ${stageTeam.c1} 45%, #0b1424))` : "#0b1424";
  const b = m.beat;
  const ctx = m.kind === "preshow" ? "Starting soon" : m.kind === "intro" ? "Opening" : m.kind === "final" ? "Final" : b ? `Round ${b.round} · Pick ${b.overall}` : "";
  return (
    <Links.Provider value={linkCtx}>
    <div className="otc">
      <div className="otc-bg" style={{ background: bg }} />
      <UpNext script={script} m={m} />
      <div className="otc-top">
        <div className="otc-brand"><img src={WD_ICON} alt="" /><span className="bc-disp">On the Clock</span></div>
        {m.kind !== "preshow" && <span className="otc-live"><i />LIVE</span>}
        {/* The format's on the countdown and intro; up here, the sim. */}
        <span className="otc-ctx bc-ell" style={{ maxWidth: 900, color: "#fff" }}>Run your own draft <span style={{ color: GOLD }}>we-draft.com/draftsim</span></span>
        <span style={{ marginLeft: "auto" }} className="otc-pill">{ctx}</span>
      </div>
      <div className="otc-stage" style={{ background: stageFill, transition: "background 1.2s ease", ...(final ? { width: 1808, height: 916 } : {}) }}>
        {WIPE.includes(m.kind) && (
          <div key={`w${m.seg?.start}`} className="otc-wipe" style={{ "--w1": stageTeam?.c1 || SITE_BLUE, "--w2": stageTeam?.c2 || GOLD }}><i /><i /></div>
        )}
        <StageSwap id={stageId(m)}>
          {m.kind === "preshow" && <Countdown script={script} m={m} />}
          {m.kind === "intro" && <Intro script={script} />}
          {m.kind === "clock" || m.kind === "pickIn" ? <OnClock script={script} m={m} /> : null}
          {m.kind === "trade" && <Trade script={script} m={m} />}
          {m.kind === "reveal" && <Reveal script={script} m={m} />}
          {m.kind === "roundBreak" && <RoundBreak script={script} m={m} />}
          {m.kind === "final" && <Final script={script} m={m} />}
        </StageSwap>
      </div>
      {!final && <Desk script={script} timeline={timeline} m={m} />}
      {!final && <Recap script={script} m={m} />}
    </div>
    </Links.Provider>
  );
}
