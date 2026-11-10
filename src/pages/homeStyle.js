// src/pages/homeStyle.js
//
// The Home page's look (HomeHero.js, HomeOffSeason.js, HomeInstagram.jsx):
// one stylesheet scoped under .hx, so the layout is CSS (grid + media
// queries) instead of isMobile branches. Brand blue and gold, a light page,
// hairline cards with one radius scale (12 / 18 / pill), image-led
// sections. HomeInSeason.js still uses the older look (homeModernStyle.js).
const BLUE = "#0055a5";
const NAVY = "#062b57";
const GOLD = "#f6a21d";

const HOME_STYLE = `
.hx {
  --blue: ${BLUE}; --navy: ${NAVY}; --gold: ${GOLD};
  --ink: #0f1b2d; --ink-2: #33415a; --ink-3: #5b6b84; --ink-4: #8a97ab;
  --line: #e3e8ef; --line-2: #eef1f5; --soft: #f5f7fb; --card: #fff;
  --r: 12px; --r-lg: 18px;
  --shadow: 0 1px 2px rgba(15,27,45,0.04), 0 6px 24px rgba(15,27,45,0.06);
  max-width: 1280px; margin: 0 auto; color: var(--ink);
  font-family: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
}
.hx *, .hx *::before, .hx *::after { box-sizing: border-box; }
.hx a { color: inherit; text-decoration: none; }
.hx img { display: block; }

/* ── Hero ── */
.hx-hero {
  position: relative; overflow: hidden; border-radius: var(--r-lg);
  background: radial-gradient(1200px 500px at 85% -10%, rgba(246,162,29,0.22), transparent 60%),
              radial-gradient(900px 600px at -10% 120%, rgba(0,140,255,0.35), transparent 60%),
              linear-gradient(135deg, ${BLUE} 0%, ${NAVY} 100%);
  color: #fff; padding: 32px 40px;
  display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 36px; align-items: center;
}
.hx-hero::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.5;
  background-image: linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
  background-size: 44px 44px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 35%, #000 70%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 35%, #000 70%, transparent);
}
.hx-hero > * { position: relative; z-index: 1; }
.hx-logo { width: min(320px, 100%); height: auto; margin-bottom: 14px; }
.hx-eyebrow {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 8px; border-radius: 999px;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
  font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 14px;
}
.hx-eyebrow b { background: var(--gold); color: #1a1205; border-radius: 999px; padding: 2px 8px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.hx-h1 { font-family: "Arial Black", "Segoe UI", sans-serif; font-weight: 900; font-size: clamp(32px, 3.6vw, 50px); line-height: 1.02; letter-spacing: -0.01em; margin: 0 0 12px; text-transform: uppercase; }
.hx-h1 span { color: var(--gold); white-space: nowrap; }
.hx-lede { font-size: 16px; line-height: 1.55; color: rgba(255,255,255,0.82); max-width: 540px; margin: 0 0 20px; }
.hx-ctas { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.hx-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px;
  padding: 14px 24px; font-weight: 800; font-size: 15px; cursor: pointer; border: 0; font-family: inherit;
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s, border-color 0.15s;
}
.hx-btn:hover { transform: translateY(-1px); }
.hx-btn-gold { background: var(--gold); color: #1a1205 !important; box-shadow: 0 10px 28px rgba(246,162,29,0.35); }
.hx-btn-gold:hover { box-shadow: 0 14px 34px rgba(246,162,29,0.45); }
.hx-btn-ghost { background: rgba(255,255,255,0.08); color: #fff !important; border: 1px solid rgba(255,255,255,0.35); }
.hx-btn-ghost:hover { background: rgba(255,255,255,0.16); border-color: #fff; }
.hx-btn-blue { background: var(--blue); color: #fff !important; }
.hx-btn-blue:hover { box-shadow: 0 10px 24px rgba(0,85,165,0.3); }
.hx-fine { margin-top: 12px; font-size: 13px; color: rgba(255,255,255,0.6); }
.hx-fine a { color: var(--gold); font-weight: 700; }

/* the hero's featured prospect */
/* A wide, short card: the details on the left, his headshot on the right. */
.hx-feature {
  position: relative; border-radius: var(--r-lg); overflow: hidden; min-height: 210px;
  background: linear-gradient(120deg, rgba(255,255,255,0.15), rgba(255,255,255,0.04));
  border: 1px solid rgba(255,255,255,0.22); backdrop-filter: blur(6px);
  display: grid; grid-template-columns: minmax(0, 1fr) 200px; align-items: stretch;
  transition: transform 0.2s, border-color 0.2s;
}
.hx-feature:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.5); }
.hx-feature-body { padding: 20px 8px 20px 24px; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.hx-feature-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.hx-feature-num { font-family: "Arial Black", sans-serif; font-size: 34px; line-height: 1; color: var(--gold); }
.hx-feature-tag { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.75); line-height: 1.3; }
.hx-feature-name { font-family: "Arial Black", sans-serif; font-size: 26px; line-height: 1.05; text-transform: uppercase; margin: 0 0 8px; }
.hx-feature-meta { display: flex; align-items: center; gap: 8px; font-size: 14px; color: rgba(255,255,255,0.85); font-weight: 600; margin-bottom: 14px; }
.hx-feature-meta .hx-pos { background: rgba(255,255,255,0.16); color: #fff; }
.hx-feature-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.hx-feature-grade { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #fff; border-radius: 999px; padding: 5px 10px; }
.hx-feature-cta { font-size: 13px; font-weight: 800; color: var(--gold); }
.hx-feature-photo { position: relative; display: flex; align-items: flex-end; justify-content: center; }
.hx-feature-photo::before { content: ""; position: absolute; width: 190px; height: 190px; border-radius: 50%; bottom: 8px; background: radial-gradient(circle, rgba(246,162,29,0.45), rgba(246,162,29,0) 68%); }
.hx-feature-img { position: relative; width: 100%; height: auto; max-height: 100%; object-fit: contain; object-position: bottom; filter: drop-shadow(0 14px 24px rgba(0,0,0,0.35)); }
.hx-feature-skel { min-height: 210px; border-radius: var(--r-lg); background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); }

/* ── Quick links ── */
.hx-quick { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin: 18px 0 0; }
.hx-ql {
  display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: var(--r);
  background: var(--card); border: 1px solid var(--line); box-shadow: var(--shadow);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.hx-ql:hover { transform: translateY(-2px); border-color: var(--blue); box-shadow: 0 10px 28px rgba(0,85,165,0.12); }
.hx-ql-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: #eaf2fb; color: var(--blue); }
.hx-ql.hot .hx-ql-icon { background: var(--gold); color: #1a1205; }
.hx-ql-title { font-weight: 800; font-size: 15px; color: var(--ink); display: flex; align-items: center; gap: 6px; }
.hx-ql-sub { font-size: 13px; color: var(--ink-3); line-height: 1.4; }
.hx-new { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; background: #c8102e; color: #fff; border-radius: 999px; padding: 2px 7px; }

/* ── Sections ── */
.hx-section { margin-top: 44px; }
.hx-sechead { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.hx-kicker { font-size: 12px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--blue); margin-bottom: 4px; }
.hx-h2 { font-size: 26px; font-weight: 800; letter-spacing: -0.01em; margin: 0; color: var(--ink); }
.hx-more { font-size: 14px; font-weight: 700; color: var(--blue) !important; white-space: nowrap; }
.hx-more:hover { text-decoration: underline !important; text-underline-offset: 3px; }
.hx-card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow); }
/* evals | board | news */
.hx-three { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr); grid-template-areas: "evals board news"; gap: 24px; align-items: start; }
.hx-evalcol { grid-area: evals; } .hx-boardcol { grid-area: board; } .hx-newscol { grid-area: news; }
.hx-three .hx-sechead { min-height: 52px; }
.hx-three .hx-board { grid-template-columns: 1fr; grid-auto-flow: row; grid-template-rows: none; }
.hx-three .hx-board .hx-prow:nth-child(n+6) { border-left: 0; }
.hx-three .hx-board .hx-prow:nth-child(5) { border-bottom: 1px solid var(--line-2); }
.hx-evalcol .hx-evals { display: flex; flex-direction: column; gap: 12px; }
.hx-evalcol .hx-eval { padding: 16px; gap: 10px; }
/* The board alone in the middle (the others are in the side rails). */
.hx-three.solo { grid-template-columns: minmax(0, 1fr); grid-template-areas: "board"; }
.hx-three.solo .hx-board { grid-template-columns: 1fr 1fr; grid-auto-flow: column; grid-template-rows: repeat(5, auto); }
.hx-three.solo .hx-board .hx-prow:nth-child(n+6) { border-left: 1px solid var(--line-2); }
.hx-three.solo .hx-board .hx-prow:nth-child(5) { border-bottom: 0; }

/* ── Wide screens: Recent Evals and Latest in the page's side margins ── */
.hx-shell.railed { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr) minmax(260px, 320px); gap: 28px; align-items: start; }
.hx-shell.railed > .hx { max-width: 1280px; width: 100%; }
.hx.hx-rail { max-width: none; margin: 0; }
.hx-rail .hx-sechead { min-height: 52px; }

/* the big board */
.hx-tabs { display: inline-flex; padding: 4px; border-radius: 999px; background: #e9eef5; gap: 2px; }
.hx-tab { border: 0; background: transparent; padding: 7px 16px; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 800; color: var(--ink-3); cursor: pointer; }
.hx-tab[aria-selected="true"] { background: #fff; color: var(--blue); box-shadow: 0 1px 4px rgba(15,27,45,0.12); }
.hx-board { display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: column; grid-template-rows: repeat(5, auto); }
.hx-prow { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line-2); transition: background 0.12s; min-width: 0; }
.hx-prow:hover { background: var(--soft); }
.hx-prow:hover .hx-pname { color: var(--blue); }
.hx-board .hx-prow:nth-child(5), .hx-board .hx-prow:nth-child(10) { border-bottom: 0; }
.hx-board .hx-prow:nth-child(n+6) { border-left: 1px solid var(--line-2); }
.hx-rank { width: 28px; flex-shrink: 0; font-weight: 900; font-size: 18px; color: var(--ink-4); text-align: center; font-variant-numeric: tabular-nums; }
.hx-rank.top { color: var(--gold); }
.hx-avatar { width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0; background: #e9eef5; overflow: hidden; display: grid; place-items: center; font-weight: 800; font-size: 14px; color: var(--ink-3); }
.hx-avatar img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
.hx-pmain { flex: 1; min-width: 0; }
.hx-pname { font-weight: 800; font-size: 16px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color 0.12s; }
.hx-psub { font-size: 13px; color: var(--ink-3); display: flex; align-items: center; gap: 6px; margin-top: 2px; white-space: nowrap; overflow: hidden; }
.hx-pos { font-size: 11px; font-weight: 800; letter-spacing: 0.04em; color: var(--blue); background: #eaf2fb; border-radius: 6px; padding: 1px 6px; flex-shrink: 0; }
.hx-school { overflow: hidden; text-overflow: ellipsis; }
.hx-grade { flex-shrink: 0; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 54px; padding: 5px 8px; border-radius: 10px; color: #fff; line-height: 1; }
.hx-grade small { font-size: 9px; font-weight: 800; letter-spacing: 0.06em; opacity: 0.9; }
.hx-grade b { font-size: 15px; font-weight: 900; margin-top: 2px; }
.hx-boardfoot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-top: 1px solid var(--line-2); background: var(--soft); border-radius: 0 0 var(--r-lg) var(--r-lg); font-size: 13px; color: var(--ink-3); flex-wrap: wrap; }
.hx-btn-sm { padding: 9px 16px; font-size: 14px; }

/* news list */
.hx-news { display: flex; flex-direction: column; }
.hx-nrow { display: flex; gap: 14px; padding: 14px 16px; border-bottom: 1px solid var(--line-2); align-items: flex-start; transition: background 0.12s; }
.hx-nrow:last-child { border-bottom: 0; }
.hx-nrow:hover { background: var(--soft); }
.hx-nrow:hover .hx-ntitle { color: var(--blue); }
.hx-ndate { flex-shrink: 0; width: 44px; text-align: center; border-radius: 10px; background: var(--soft); border: 1px solid var(--line); padding: 5px 0; }
.hx-ndate small { display: block; font-size: 10px; font-weight: 800; color: var(--ink-4); text-transform: uppercase; letter-spacing: 0.06em; }
.hx-ndate b { display: block; font-size: 18px; font-weight: 900; color: var(--ink); line-height: 1.1; }
.hx-ntype { font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold); }
.hx-ntitle { font-weight: 700; font-size: 15px; line-height: 1.35; color: var(--ink); margin-top: 2px; transition: color 0.12s; }
.hx-nsum { font-size: 13px; color: var(--ink-3); margin-top: 3px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* recent evaluations */
.hx-evals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.hx-eval { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.hx-evhead { display: flex; align-items: center; gap: 12px; }
.hx-evplayer { font-weight: 800; font-size: 16px; color: var(--ink); }
.hx-evplayer:hover { color: var(--blue); }
.hx-evby { font-size: 13px; color: var(--ink-3); display: flex; align-items: center; gap: 4px; margin-top: 2px; }
.hx-evby img { width: 13px; height: 13px; }
.hx-evtext { font-size: 14px; line-height: 1.55; color: var(--ink-2); margin: 0; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.hx-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; }
.hx-chip { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 9px; }
.hx-chip.s { background: #e7f4ea; color: #1f6b2c; }
.hx-chip.w { background: #fbeaea; color: #a3261c; }

/* videos */
.hx-videos { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.hx-video { overflow: hidden; display: flex; flex-direction: column; transition: transform 0.15s, box-shadow 0.15s; }
.hx-video:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(15,27,45,0.12); }
.hx-vthumb { position: relative; aspect-ratio: 16 / 9; background: #0b1b33; overflow: hidden; }
.hx-vthumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
.hx-video:hover .hx-vthumb img { transform: scale(1.04); }
.hx-play { position: absolute; left: 12px; bottom: 12px; width: 38px; height: 38px; border-radius: 50%; background: rgba(0,0,0,0.6); display: grid; place-items: center; color: #fff; }
.hx-vbody { padding: 12px 14px 14px; }
.hx-vtitle { font-weight: 700; font-size: 15px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.hx-vdate { font-size: 12px; color: var(--ink-4); margin-top: 4px; font-weight: 600; }

/* Instagram */
.hx-ighead { display: flex; align-items: center; gap: 14px; }
.hx-igpic { width: 56px; height: 56px; border-radius: 50%; padding: 3px; background: linear-gradient(45deg, #f9ce34, #ee2a7b, #6228d7); flex-shrink: 0; }
.hx-igpic img, .hx-igpic span { width: 100%; height: 100%; border-radius: 50%; border: 3px solid #f4f6f9; object-fit: cover; background: var(--blue); }
.hx-igname { font-weight: 800; font-size: 20px; color: var(--ink); }
.hx-igmeta { font-size: 14px; color: var(--ink-3); margin-top: 2px; }
.hx-iggrid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.hx-igtile { position: relative; aspect-ratio: 4 / 5; border-radius: var(--r); overflow: hidden; background: #dfe6ef; }
.hx-igtile img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
.hx-igtile:hover img { transform: scale(1.05); }
.hx-igkind { position: absolute; top: 8px; right: 8px; color: #fff; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)); }
.hx-igcap { position: absolute; inset: 0; display: flex; align-items: flex-end; padding: 12px; color: #fff; font-size: 13px; line-height: 1.4; font-weight: 600;
  background: linear-gradient(180deg, transparent 35%, rgba(6,20,40,0.85)); opacity: 0; transition: opacity 0.2s; }
.hx-igcap span { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.hx-igtile:hover .hx-igcap, .hx-igtile:focus-visible .hx-igcap { opacity: 1; }
.hx-btn-ig { background: linear-gradient(45deg, #f09433, #dc2743 50%, #bc1888); color: #fff !important; }
.hx-btn-ig:hover { box-shadow: 0 10px 24px rgba(220,39,67,0.3); }

/* closing band */
.hx-band { margin-top: 48px; border-radius: var(--r-lg); padding: 36px 40px; display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap;
  background: linear-gradient(120deg, ${NAVY}, ${BLUE}); color: #fff; }
.hx-band h3 { font-family: "Arial Black", sans-serif; font-size: 28px; text-transform: uppercase; margin: 0 0 6px; line-height: 1.1; }
.hx-band h3 span { color: var(--gold); }
.hx-band p { margin: 0; color: rgba(255,255,255,0.78); font-size: 16px; }

.hx-skel { background: linear-gradient(90deg, #eef1f5 25%, #f6f8fb 50%, #eef1f5 75%); background-size: 200% 100%; animation: hxShimmer 1.2s infinite; border-radius: var(--r); }
@keyframes hxShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.hx-empty { padding: 28px; text-align: center; color: var(--ink-4); font-size: 14px; }

/* ── Tablet ── */
@media (max-width: 1100px) {
  .hx-quick { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .hx-three { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "board board" "evals news"; }
  .hx-three .hx-board { grid-template-columns: 1fr 1fr; grid-auto-flow: column; grid-template-rows: repeat(5, auto); }
  .hx-three .hx-board .hx-prow:nth-child(n+6) { border-left: 1px solid var(--line-2); }
  .hx-three .hx-board .hx-prow:nth-child(5) { border-bottom: 0; }
  .hx-videos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hx-iggrid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .hx-iggrid .hx-igtile:nth-child(n+9) { display: none; }
}
@media (max-width: 900px) {
  .hx-hero { grid-template-columns: 1fr; padding: 28px 24px; gap: 24px; }
  .hx-feature, .hx-feature-skel { min-height: 200px; }
  .hx-evals { grid-template-columns: 1fr 1fr; }
}
/* ── Phone ── */
@media (max-width: 640px) {
  .hx-hero { padding: 22px 16px 18px; gap: 18px; border-radius: 16px; }
  .hx-logo { width: 200px; margin-bottom: 12px; }
  .hx-lede { font-size: 15px; margin-bottom: 20px; }
  .hx-ctas .hx-btn { width: 100%; }
  .hx-feature, .hx-feature-skel { min-height: 170px; }
  .hx-feature { grid-template-columns: minmax(0, 1fr) 128px; }
  .hx-feature-body { padding: 16px 4px 16px 16px; }
  .hx-feature-num { font-size: 26px; }
  .hx-feature-tag { font-size: 10px; }
  .hx-feature-name { font-size: 20px; }
  .hx-feature-meta { font-size: 13px; margin-bottom: 10px; }
  .hx-feature-photo::before { width: 130px; height: 130px; }
  .hx-quick { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; margin: 14px -10px 0; padding: 2px 10px 6px; }
  .hx-quick::-webkit-scrollbar { display: none; }
  .hx-ql { flex: 0 0 150px; scroll-snap-align: start; padding: 14px; }
  .hx-ql-sub { display: none; }
  .hx-section { margin-top: 34px; }
  .hx-h2 { font-size: 22px; }
  .hx-three { grid-template-columns: minmax(0, 1fr); grid-template-areas: "board" "news" "evals"; gap: 34px; }
  .hx-three .hx-sechead { min-height: 0; }
  .hx .hx-board { grid-template-columns: 1fr; grid-auto-flow: row; grid-template-rows: none; }
  .hx .hx-board .hx-prow:nth-child(n+6) { border-left: 0; }
  .hx .hx-board .hx-prow:nth-child(5) { border-bottom: 1px solid var(--line-2); }
  .hx-prow { padding: 11px 12px; gap: 10px; }
  .hx-avatar { width: 40px; height: 40px; }
  .hx-evalcol .hx-evals { flex-direction: row; }
  .hx-evals { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; margin: 0 -10px; padding: 0 10px 6px; }
  .hx-evals::-webkit-scrollbar { display: none; }
  .hx-evals > * { flex: 0 0 85%; scroll-snap-align: start; }
  .hx-videos { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; margin: 0 -10px; padding: 0 10px 6px; }
  .hx-videos::-webkit-scrollbar { display: none; }
  .hx-videos > * { flex: 0 0 78%; scroll-snap-align: start; }
  .hx-iggrid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .hx-iggrid .hx-igtile:nth-child(n+7) { display: none; }
  .hx-igtile { border-radius: 8px; }
  .hx-igcap { display: none; }
  .hx-band { padding: 26px 20px; }
  .hx-band h3 { font-size: 22px; }
  .hx-band .hx-btn { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .hx *, .hx *::before, .hx *::after { transition: none !important; animation: none !important; }
}
`;

export default HOME_STYLE;
