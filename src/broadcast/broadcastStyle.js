// src/broadcast/broadcastStyle.js
//
// The broadcast's stylesheet. Everything is laid out in fixed pixels on a
// 1920×1080 canvas (.bc-stage) that the page scales as one unit — no vw /
// vh, no media queries, no hover — so a headless capture at 1920×1080 is
// pixel-identical to what a preview shows. Motion is transform / opacity
// only, every animation runs a fixed number of times (no infinite loops),
// and nothing animates while the screen is idle.

export const SITE_BLUE = "#0055a5";
export const GOLD = "#f6a21d";

export const BROADCAST_FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Bebas+Neue&display=block";

export const BROADCAST_STYLE = `
.bc-stage { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; overflow: hidden; transform-origin: 0 0;
  background: #060c18; color: #f4f7fb; font-family: "Barlow Condensed", "Arial Narrow", Arial, sans-serif; font-weight: 600;
  -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums; contain: strict; user-select: none; }
.bc-stage * { box-sizing: border-box; }
.bc-disp { font-family: "Bebas Neue", "Barlow Condensed", Impact, sans-serif; font-weight: 400; letter-spacing: 0.01em; line-height: 0.9; }
.bc-ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Backdrop: static team-color glows and a faint stripe — painted once. */
.bc-bg { position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(900px 620px at -4% 18%, color-mix(in srgb, var(--away) 34%, transparent), transparent 70%),
    radial-gradient(900px 620px at 104% 18%, color-mix(in srgb, var(--home) 34%, transparent), transparent 70%),
    radial-gradient(1200px 700px at 50% 120%, rgba(0,85,165,0.30), transparent 70%),
    repeating-linear-gradient(115deg, rgba(255,255,255,0.018) 0 2px, transparent 2px 28px),
    linear-gradient(180deg, #08142a 0%, #050a14 100%); }

/* ── Top bar ── */
.bc-top { position: absolute; left: 64px; right: 64px; top: 30px; height: 60px; display: flex; align-items: center; gap: 22px; }
.bc-brand { display: flex; align-items: center; gap: 14px; }
.bc-brand img { width: 54px; height: 54px; }
.bc-brand .bc-disp { font-size: 50px; line-height: 1; padding-top: 4px; }
.bc-brand .live { color: ${GOLD}; margin-left: 10px; }
.bc-ctx { height: 34px; padding-left: 22px; border-left: 2px solid rgba(255,255,255,0.18); display: flex; align-items: center; gap: 14px;
  font-size: 27px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb0c8; }
.bc-ctx .tag { color: #121212; background: ${GOLD}; border-radius: 6px; padding: 2px 12px; font-size: 22px; letter-spacing: 0.1em; }
.bc-pills { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.bc-pill { height: 40px; display: inline-flex; align-items: center; gap: 10px; padding: 0 16px; border-radius: 8px; font-size: 24px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
.bc-pill.live { background: #d92b2b; color: #fff; }
.bc-pill.live i { width: 12px; height: 12px; border-radius: 50%; background: #fff; }
.bc-pill.final { background: #eef2f8; color: #0a0f1a; }
.bc-pill.pre { background: rgba(255,255,255,0.1); color: #dfe6f0; }
.bc-pill.stale { background: rgba(242,201,76,0.16); color: #f2c94c; border: 1px solid rgba(242,201,76,0.5); font-size: 21px; letter-spacing: 0.08em; animation: bc-fade 600ms ease-out both; }
.bc-pill.replay { background: rgba(0,85,165,0.4); color: #cfe2ff; border: 1px solid rgba(120,170,255,0.45); }

/* ── Scorebug ── */
.bc-board { position: absolute; left: 64px; top: 112px; width: 1792px; height: 220px; display: grid; grid-template-columns: 580px 180px 272px 180px 580px;
  border-radius: 22px; overflow: hidden; box-shadow: 0 24px 60px -24px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08) inset; }
.bc-team { position: relative; display: flex; align-items: center; gap: 26px; padding: 0 34px; min-width: 0; }
.bc-team.away { background: linear-gradient(90deg, var(--pc) 0%, color-mix(in srgb, var(--pc) 70%, #0a1222) 100%); }
.bc-team.home { flex-direction: row-reverse; text-align: right; background: linear-gradient(270deg, var(--pc) 0%, color-mix(in srgb, var(--pc) 70%, #0a1222) 100%); }
.bc-team::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 8px; background: ${GOLD}; transform: scaleX(0); transition: transform 500ms cubic-bezier(.2,.8,.2,1); }
.bc-team.away::after { transform-origin: left; }
.bc-team.home::after { transform-origin: right; }
.bc-team.ball::after { transform: scaleX(1); }
.bc-team.lose { filter: saturate(0.45) brightness(0.7); }
.bc-logo { flex: 0 0 auto; width: 136px; height: 136px; object-fit: contain; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.45)); }
.bc-tname { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.bc-tname .row { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.bc-team.home .bc-tname .row { justify-content: flex-end; }
.bc-tname .rank { font-size: 46px; color: ${GOLD}; }
.bc-tname .school { font-size: 76px; min-width: 0; text-shadow: 0 3px 10px rgba(0,0,0,0.35); }
/* long names (Mississippi State, Florida Atlantic…) take two lines instead of an ellipsis */
.bc-tname .school.two { font-size: 64px; line-height: 0.92; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; padding-top: 4px; }
.bc-tname .sub { font-size: 27px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.78); }
.bc-score { position: relative; display: flex; align-items: center; justify-content: center; background: #0b1426; }
.bc-score.away { box-shadow: -1px 0 0 rgba(255,255,255,0.06) inset; }
.bc-score b { display: block; font-size: 158px; padding-top: 14px; }
.bc-score b.pop { animation: bc-pop 700ms cubic-bezier(.2,.8,.2,1) both; }
.bc-score.lose b { color: #6f819c; }
.bc-score .ball { position: absolute; top: 22px; width: 38px; height: 24px; color: ${GOLD}; animation: bc-fade 400ms ease-out both; }
.bc-score.away .ball { right: 14px; }
.bc-score.home .ball { left: 14px; }
.bc-mid { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: #050a14; }
.bc-mid .per { font-size: 32px; font-weight: 800; letter-spacing: 0.16em; color: ${GOLD}; text-transform: uppercase; }
.bc-mid .clk { font-size: 104px; }
.bc-mid .big { font-size: 74px; text-align: center; }
.bc-mid .small { font-size: 24px; font-weight: 700; letter-spacing: 0.12em; color: #9fb0c8; text-transform: uppercase; }

/* ── Situation strip ── */
.bc-sit { position: absolute; left: 64px; top: 348px; width: 1792px; height: 84px; display: flex; align-items: center; gap: 24px;
  background: rgba(10,18,34,0.86); border-radius: 16px; box-shadow: 0 0 0 1px rgba(255,255,255,0.07) inset; padding: 0 14px; }
.bc-dd { flex: 0 0 auto; min-width: 260px; height: 62px; padding: 0 22px; border-radius: 10px; background: var(--oc, #1d2840); display: flex; align-items: center; justify-content: center; gap: 12px;
  font-size: 58px; padding-top: 6px; box-shadow: 0 0 0 2px rgba(255,255,255,0.18) inset; }
.bc-dd img { width: 44px; height: 44px; object-fit: contain; margin-top: -6px; }
.bc-dd.brk { background: #eef2f8; color: #0a0f1a; font-size: 46px; }
.bc-dd.to { background: #f2c94c; color: #121212; font-size: 46px; }
.bc-spot { flex: 0 0 300px; font-size: 34px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #dfe6f0; }
.bc-spot small { display: block; font-size: 20px; letter-spacing: 0.14em; color: #7f90aa; }
.bc-field { position: relative; flex: 1 1 auto; height: 56px; margin: 0 54px 0 40px; }
.bc-field .turf { position: absolute; left: 0; right: 0; top: 18px; height: 20px; border-radius: 4px;
  background: repeating-linear-gradient(90deg, rgba(255,255,255,0.36) 0 2px, transparent 2px 10%), linear-gradient(180deg, #1f6b3a, #17502c); box-shadow: 0 0 0 1px rgba(255,255,255,0.25) inset; }
.bc-field .ez { position: absolute; top: 18px; height: 20px; width: 40px; }
.bc-field .ez.away { left: -40px; border-radius: 4px 0 0 4px; background: var(--away); }
.bc-field .ez.home { right: -40px; border-radius: 0 4px 4px 0; background: var(--home); }
.bc-field .mid { position: absolute; left: 50%; top: 10px; width: 3px; height: 36px; margin-left: -1px; background: #fff; border-radius: 2px; }
.bc-field .gain { position: absolute; top: 8px; width: 5px; height: 40px; margin-left: -2px; background: #ffd400; border-radius: 2px; transition: left 800ms cubic-bezier(.2,.8,.2,1); }
.bc-field .ballmk { position: absolute; top: 0; width: 56px; height: 56px; margin-left: -28px; border-radius: 50%; border: 3px solid #fff; background: var(--oc);
  display: flex; align-items: center; justify-content: center; transition: left 800ms cubic-bezier(.2,.8,.2,1); box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
.bc-field .ballmk img { width: 70%; height: 70%; object-fit: contain; }

/* ── Main area ── */
.bc-panel { position: absolute; background: rgba(13,22,40,0.92); border-radius: 20px; box-shadow: 0 0 0 1px rgba(255,255,255,0.07) inset, 0 20px 50px -30px rgba(0,0,0,0.9); overflow: hidden; }
.bc-ph { height: 52px; display: flex; align-items: center; gap: 14px; padding: 0 26px; font-size: 25px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: #9fb0c8;
  border-bottom: 1px solid rgba(255,255,255,0.07); }
.bc-ph .gold { color: ${GOLD}; }
.bc-ph .right { margin-left: auto; color: #7f90aa; }
.bc-ph img { width: 32px; height: 32px; }

.bc-play { left: 64px; top: 452px; width: 1150px; height: 322px; }
.bc-play-body { position: absolute; left: 0; right: 0; top: 52px; bottom: 0; padding: 16px 30px 0 34px; display: flex; gap: 28px; animation: bc-rise 450ms cubic-bezier(.2,.8,.2,1) both; }
.bc-play-body::before { content: ""; position: absolute; left: 0; top: 18px; bottom: 26px; width: 8px; border-radius: 0 4px 4px 0; background: var(--tone); }
.bc-play-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 9px; }
/* the play's players with their game lines so far */
.bc-pstats { display: flex; gap: 12px; min-width: 0; margin-top: 2px; }
.bc-pstat { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 16px 0 10px; border-radius: 10px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-left: 5px solid var(--pc); animation: bc-fade 500ms ease-out 250ms both; }
.bc-pstat img { flex: 0 0 auto; width: 28px; height: 28px; object-fit: contain; }
.bc-pstat .n { flex: 0 0 auto; max-width: 300px; font-size: 25px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc-pstat .l { flex: 0 1 auto; min-width: 0; font-size: 26px; font-weight: 700; color: ${GOLD}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bc-badge { align-self: flex-start; font-size: 26px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #0a0f1a; background: var(--tone); border-radius: 8px; padding: 4px 14px; }
.bc-line { font-size: 49px; font-weight: 700; line-height: 1.04; color: #f4f7fb; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.bc-line .pl { font-weight: 800; }
.bc-line .sub { font-weight: 600; color: #c9d5e6; }
.bc-detail { font-size: 30px; font-weight: 600; color: #9fb0c8; display: flex; align-items: center; gap: 14px; }
/* incomplete pass: the arrow crossed out (LivePlayCard.js .lpc-arrow-miss) */
.bc-arrow-miss { position: relative; display: inline-block; color: #8a5a5a; }
.bc-arrow-miss i { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -54%); font-style: normal; font-size: 0.95em; font-weight: 900; color: #ff5c5c; }
/* waiting for the snap — /live's three pulsing dots (opacity/transform only) */
.bc-dots-wait { display: inline-flex; gap: 7px; margin: 0 12px 0 10px; vertical-align: middle; }
.bc-dots-wait i { width: 10px; height: 10px; border-radius: 50%; background: ${GOLD}; animation: bc-dot 1.2s infinite ease-in-out; }
.bc-dots-wait i:nth-child(2) { animation-delay: 0.2s; }
.bc-dots-wait i:nth-child(3) { animation-delay: 0.4s; }
@keyframes bc-dot { 0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
.bc-chip.warn { background: #f2c94c; color: #121212; margin-left: 14px; }
.bc-chip { font-size: 22px; font-weight: 800; letter-spacing: 0.12em; color: #0a0f1a; background: #eef2f8; border-radius: 6px; padding: 2px 10px; }
.bc-play-side { flex: 0 0 210px; display: flex; flex-direction: column; align-items: center; gap: 12px; padding-top: 4px; }
.bc-play-side img { width: 120px; height: 120px; object-fit: contain; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.5)); }
.bc-play-side .clk { font-size: 28px; font-weight: 800; letter-spacing: 0.08em; color: #9fb0c8; text-align: center; }
.bc-next { position: absolute; left: 0; right: 0; top: 52px; bottom: 0; display: flex; align-items: center; gap: 36px; padding: 0 44px; animation: bc-rise 450ms cubic-bezier(.2,.8,.2,1) both; }
.bc-next img { width: 150px; height: 150px; object-fit: contain; }
.bc-next .lbl { font-size: 28px; font-weight: 800; letter-spacing: 0.16em; color: ${GOLD}; text-transform: uppercase; }
.bc-next .big { font-size: 112px; margin-top: 8px; }
.bc-next .sm { font-size: 36px; font-weight: 700; color: #c9d5e6; margin-top: 6px; }

.bc-recent { left: 64px; top: 790px; width: 1150px; height: 170px; }
.bc-rrow { height: 39px; display: flex; align-items: center; gap: 16px; padding: 0 26px; font-size: 27px; font-weight: 600; color: #dfe6f0; }
.bc-rrow + .bc-rrow { border-top: 1px solid rgba(255,255,255,0.05); }
.bc-rrow .t { flex: 0 0 132px; font-weight: 800; color: #7f90aa; letter-spacing: 0.04em; }
.bc-rrow img { flex: 0 0 auto; width: 30px; height: 30px; object-fit: contain; }
.bc-rrow .st { flex: 0 0 auto; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 23px; font-weight: 700; color: #c9a25a; }
.bc-rrow .st b { color: #9fb0c8; font-weight: 800; margin-right: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
.bc-rrow .x { flex: 1 1 auto; min-width: 0; }
.bc-rrow.td .x { color: #ffd27a; font-weight: 800; }
.bc-rrow.turnover .x { color: #ff8a8a; font-weight: 800; }
.bc-rrow.fresh { animation: bc-slide 500ms cubic-bezier(.2,.8,.2,1) both; }

/* ── Team stats (right column) ── */
.bc-tstats { left: 1246px; top: 452px; width: 610px; height: 508px; }
.bc-tst-head { height: 62px; display: flex; align-items: center; justify-content: space-between; padding: 0 26px; }
.bc-tst-head .t { display: flex; align-items: center; gap: 12px; }
.bc-tst-head img, .bc-tst-head .t > span { width: 40px; height: 40px; object-fit: contain; }
.bc-tst-head b { font-size: 40px; padding-top: 4px; }
.bc-tst-row { height: 46px; padding: 0 26px; display: flex; flex-direction: column; justify-content: center; gap: 5px; }
.bc-tstats.tall .bc-tst-row { height: 48px; }
.bc-tst-row .v { display: grid; grid-template-columns: 120px 1fr 120px; align-items: baseline; }
.bc-tst-row .v b { font-family: "Bebas Neue", sans-serif; font-weight: 400; font-size: 34px; line-height: 1; color: #9fb0c8; }
.bc-tst-row .v b.up { color: #fff; }
.bc-tst-row .v b:last-child { text-align: right; }
.bc-tst-row .v span { text-align: center; font-size: 19px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #7f90aa; }
.bc-tst-row .bar { height: 5px; border-radius: 3px; background: var(--hc); overflow: hidden; }
.bc-tst-row .bar i { display: block; height: 100%; background: var(--ac); box-shadow: 2px 0 0 #0d1628; transition: width 700ms cubic-bezier(.2,.8,.2,1); }
.bc-quiet { margin-top: 28px; font-size: 32px; font-weight: 600; color: #7f90aa; }

/* ── Halftime / final / break panels ── */
.bc-summary { left: 64px; top: 452px; width: 1150px; height: 508px; }
/* halftime / final: no situation strip — the panels move up into its space */
.bc-panel.tall { top: 348px; height: 612px; }
.bc-sum-body { position: absolute; left: 0; right: 0; top: 52px; bottom: 0; padding: 22px 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; animation: bc-fade 500ms ease-out both; }
.bc-ls { width: 100%; border-collapse: collapse; font-size: 32px; font-weight: 700; }
.bc-ls th { font-size: 21px; font-weight: 800; letter-spacing: 0.12em; color: #7f90aa; text-align: center; padding-bottom: 6px; }
.bc-ls td { text-align: center; height: 56px; border-top: 1px solid rgba(255,255,255,0.06); }
.bc-ls td.tm { text-align: left; display: flex; align-items: center; gap: 12px; height: 56px; }
.bc-ls td.tm img { width: 34px; height: 34px; object-fit: contain; }
.bc-ls td.tot { font-family: "Bebas Neue", sans-serif; font-weight: 400; font-size: 46px; color: #fff; }
.bc-lead { display: flex; flex-direction: column; gap: 10px; }
.bc-lead .h { font-size: 22px; font-weight: 800; letter-spacing: 0.16em; color: ${GOLD}; text-transform: uppercase; }
.bc-lead .p { display: grid; grid-template-columns: 40px 1fr; align-items: center; gap: 4px 14px; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.06); }
.bc-lead .p img { width: 36px; height: 36px; object-fit: contain; grid-row: span 2; }
.bc-lead .p .c { font-size: 19px; font-weight: 800; letter-spacing: 0.14em; color: #7f90aa; text-transform: uppercase; }
.bc-lead .p .n { font-size: 31px; font-weight: 800; }
.bc-lead .p .l { grid-column: 2; font-size: 25px; font-weight: 600; color: #c9d5e6; }
.bc-win { font-size: 92px; }
.bc-win small { display: block; font-family: "Barlow Condensed", sans-serif; font-size: 30px; font-weight: 700; letter-spacing: 0.1em; color: #9fb0c8; margin-top: 10px; text-transform: uppercase; }

/* ── Pregame ── */
.bc-match { position: absolute; left: 64px; top: 112px; width: 1792px; height: 470px; border-radius: 24px; overflow: hidden; display: grid; grid-template-columns: 1fr 420px 1fr;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset, 0 24px 60px -24px rgba(0,0,0,0.8); }
.bc-mside { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 0 30px; min-width: 0; }
.bc-mside.away { background: linear-gradient(135deg, var(--pc), color-mix(in srgb, var(--pc) 60%, #0a1222)); }
.bc-mside.home { background: linear-gradient(225deg, var(--pc), color-mix(in srgb, var(--pc) 60%, #0a1222)); }
.bc-mside img { width: 230px; height: 230px; object-fit: contain; filter: drop-shadow(0 10px 22px rgba(0,0,0,0.5)); }
.bc-mside .school { font-size: 88px; max-width: 100%; text-align: center; }
.bc-mside .rank { color: ${GOLD}; margin-right: 12px; }
.bc-mside .sub { font-size: 30px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.8); }
.bc-mmid { background: #050a14; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 0 20px; }
.bc-mmid .vs { font-size: 64px; color: #4f6080; }
.bc-mmid .lbl { font-size: 26px; font-weight: 800; letter-spacing: 0.16em; color: ${GOLD}; text-transform: uppercase; }
.bc-mmid .kick { font-size: 92px; }
.bc-mmid .cd { font-size: 34px; font-weight: 700; color: #dfe6f0; }
.bc-mmid .venue { font-size: 25px; font-weight: 600; color: #7f90aa; max-width: 380px; }
.bc-pros { left: 64px; top: 604px; width: 1792px; height: 356px; }
.bc-pgrid { position: absolute; left: 0; right: 0; top: 52px; bottom: 0; padding: 20px 26px; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); gap: 16px; }
.bc-pcard { position: relative; display: flex; align-items: center; gap: 18px; padding: 0 22px; border-radius: 14px; background: rgba(255,255,255,0.04); box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset; overflow: hidden; min-width: 0; }
.bc-pcard::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--pc); }
.bc-pcard img { width: 60px; height: 60px; object-fit: contain; flex: 0 0 auto; }
.bc-pcard .n { font-size: 40px; min-width: 0; }
.bc-pcard .m { font-size: 23px; font-weight: 700; letter-spacing: 0.1em; color: #9fb0c8; text-transform: uppercase; }

/* ── Ticker ── */
.bc-tick { position: absolute; left: 64px; right: 64px; top: 984px; height: 64px; display: flex; align-items: stretch; border-radius: 14px; overflow: hidden; background: rgba(5,10,20,0.92); box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset; }
.bc-tick .site { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; padding: 0 24px; background: ${SITE_BLUE}; font-size: 38px; padding-top: 4px; }
.bc-tick .site img { width: 38px; height: 38px; margin-top: -4px; }
.bc-tick .msg { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 20px; padding: 0 26px; animation: bc-fade 600ms ease-out both; }
.bc-tick .msg .l { font-size: 29px; font-weight: 700; color: #dfe6f0; text-transform: uppercase; letter-spacing: 0.06em; min-width: 0; }
.bc-tick .msg .u { flex: 0 0 auto; font-size: 31px; font-weight: 800; color: ${GOLD}; }
.bc-tick .msg .arrow { flex: 0 0 auto; width: 0; height: 0; border-top: 10px solid transparent; border-bottom: 10px solid transparent; border-left: 14px solid ${GOLD}; }

/* ── Slates (loading / missing) ── */
.bc-slate { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; text-align: center; }
.bc-slate img { width: 180px; height: 180px; }
.bc-slate .t { font-size: 120px; }
.bc-slate .t .live { color: ${GOLD}; margin-left: 18px; }
.bc-slate .s { font-size: 40px; font-weight: 700; color: #9fb0c8; letter-spacing: 0.06em; text-transform: uppercase; }

/* ── Event graphics (BroadcastEvents.js): a column morphs into the call ──
   .bc-mo sits exactly over a column (left: plays; right: insights — its
   position comes from the component). Its clip-path starts as the boxes
   there (a gap from --g1 to --g2 on the left), closes into one box, and
   reopens at the end; its background fades in from nothing so the first
   frame looks like the boxes themselves, and fades out at the very end to
   uncover them. Timeline (--dur = the event's length):
     0–160ms     panel color comes up over the column's content
     120–620ms   the boxes close into one; the team color fills in
     400–1100ms  the call comes in (big: logo punches, word slams, flash,
                 a light sweep, the number pops; the stripes keep moving)
     …hold…
     dur-760     the call fades
     dur-600     the team color drains back
     dur-420     the boxes reopen; the panel color fades off the real ones */
.bc-mo { position: absolute; z-index: 20; pointer-events: none; border-radius: 20px; overflow: hidden;
  background: rgba(13,22,40,0.97); box-shadow: 0 0 0 1px rgba(255,255,255,0.07) inset;
  animation: bc-mo-in 620ms cubic-bezier(.3,.7,.2,1) both, bc-mo-out 420ms cubic-bezier(.5,0,.3,1) calc(var(--dur) - 420ms) forwards; }
@keyframes bc-mo-in {
  0% { background-color: rgba(13,22,40,0); clip-path: polygon(0 0, 100% 0, 100% var(--g1), 0 var(--g1), 0 var(--g2), 100% var(--g2), 100% 100%, 0 100%); }
  20% { background-color: rgba(13,22,40,0.97); clip-path: polygon(0 0, 100% 0, 100% var(--g1), 0 var(--g1), 0 var(--g2), 100% var(--g2), 100% 100%, 0 100%); }
  100% { background-color: rgba(13,22,40,0.97); clip-path: polygon(0 0, 100% 0, 100% var(--gm), 0 var(--gm), 0 var(--gm), 100% var(--gm), 100% 100%, 0 100%); } }
@keyframes bc-mo-out {
  0% { background-color: rgba(13,22,40,0.97); clip-path: polygon(0 0, 100% 0, 100% var(--gm), 0 var(--gm), 0 var(--gm), 100% var(--gm), 100% 100%, 0 100%); }
  70% { background-color: rgba(13,22,40,0.97); clip-path: polygon(0 0, 100% 0, 100% var(--g1), 0 var(--g1), 0 var(--g2), 100% var(--g2), 100% 100%, 0 100%); }
  100% { background-color: rgba(13,22,40,0); clip-path: polygon(0 0, 100% 0, 100% var(--g1), 0 var(--g1), 0 var(--g2), 100% var(--g2), 100% 100%, 0 100%); } }
.bc-mo .tint { position: absolute; inset: 0; opacity: 0;
  background: linear-gradient(110deg, var(--ec) 0%, color-mix(in srgb, var(--ec) 75%, #050a14) 65%, color-mix(in srgb, var(--ec) 55%, #050a14) 100%);
  box-shadow: 0 0 0 3px var(--ec2) inset;
  animation: bc-tint-in 500ms ease-out 120ms forwards, bc-tint-out 300ms ease-in calc(var(--dur) - 600ms) forwards; }
.bc-mo.small .tint, .bc-mo.calm .tint { background: repeating-linear-gradient(115deg, color-mix(in srgb, var(--ec2) 16%, transparent) 0 18px, transparent 18px 64px),
  linear-gradient(110deg, var(--ec) 0%, color-mix(in srgb, var(--ec) 75%, #050a14) 65%, color-mix(in srgb, var(--ec) 55%, #050a14) 100%); }
.bc-mo.card .tint { background: linear-gradient(160deg, color-mix(in srgb, var(--ec) 62%, #0a1222) 0%, #0a1222 70%); }
@keyframes bc-tint-in { to { opacity: 1; } }
@keyframes bc-tint-out { from { opacity: 1; } to { opacity: 0; } }
/* big moments: stripes that keep moving while the graphic is up (one
   70.6px period — the stripe spacing along x at 115° — looped), a white
   flash as the box closes, and one light sweep across */
.bc-mo .stripes { position: absolute; top: 0; bottom: 0; left: -71px; right: 0; opacity: 0;
  background: repeating-linear-gradient(115deg, color-mix(in srgb, var(--ec2) 24%, transparent) 0 18px, transparent 18px 64px);
  animation: bc-tint-in 400ms ease-out 200ms forwards, bc-stripes 1.1s linear 200ms infinite, bc-tint-out 300ms ease-in calc(var(--dur) - 600ms) forwards; }
@keyframes bc-stripes { from { transform: translateX(0); } to { transform: translateX(70.6px); } }
.bc-mo .flash { position: absolute; inset: 0; background: #fff; opacity: 0; animation: bc-flash 560ms ease-out 520ms forwards; }
@keyframes bc-flash { 0% { opacity: 0; } 15% { opacity: 0.6; } 100% { opacity: 0; } }
.bc-mo .sweep { position: absolute; top: -20%; bottom: -20%; left: -300px; width: 240px; transform: skewX(-18deg);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.32), transparent); animation: bc-sweep 1000ms cubic-bezier(.4,.1,.3,1) 800ms forwards; }
@keyframes bc-sweep { to { transform: skewX(-18deg) translateX(1800px); } }
.bc-mo .body { position: absolute; inset: 0; display: flex; align-items: center; gap: 36px; padding: 0 44px; opacity: 0;
  animation: bc-call-in 480ms cubic-bezier(.2,.8,.2,1) 420ms forwards, bc-call-out 200ms ease-in calc(var(--dur) - 760ms) forwards; }
@keyframes bc-call-in { from { opacity: 0; transform: translateY(18px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes bc-call-out { from { opacity: 1; } to { opacity: 0; transform: scale(0.98); } }
.bc-mo .logo { flex: 0 0 auto; width: 200px; height: 200px; object-fit: contain; filter: drop-shadow(0 12px 26px rgba(0,0,0,0.5)); }
.bc-mo.big:not(.calm) .logo { animation: bc-punch 720ms cubic-bezier(.2,1.4,.3,1) 400ms both; }
@keyframes bc-punch { from { opacity: 0; transform: scale(0.3) rotate(-14deg); } to { opacity: 1; transform: none; } }
.bc-mo.small .logo { width: 160px; height: 160px; }
.bc-mo .txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.bc-mo .who { font-size: 50px; letter-spacing: 0.06em; color: rgba(255,255,255,0.82); }
.bc-mo .word { font-size: 158px; text-shadow: 0 8px 26px rgba(0,0,0,0.4); transform-origin: left center; }
.bc-mo.big:not(.calm) .word { animation: bc-slam 640ms cubic-bezier(.2,1.3,.3,1) 460ms both; }
@keyframes bc-slam { 0% { opacity: 0; transform: scale(1.7); } 55% { opacity: 1; transform: scale(0.95); } 100% { opacity: 1; transform: none; } }
.bc-mo .word.long { font-size: 120px; }
.bc-mo.small .word { font-size: 116px; }
.bc-mo.small .word.long { font-size: 96px; }
.bc-mo .sub { font-size: 40px; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; }
.bc-mo .num { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; font-size: 160px; color: var(--ec2); text-shadow: 0 8px 26px rgba(0,0,0,0.35);
  animation: bc-numpop 760ms cubic-bezier(.2,1.6,.3,1) 900ms both; }
.bc-mo .num small { font-size: 46px; letter-spacing: 0.1em; margin-top: -6px; }
@keyframes bc-numpop { from { opacity: 0; transform: scale(0) rotate(-12deg); } to { opacity: 1; transform: none; } }
.bc-wdtag { align-self: flex-start; display: inline-flex; align-items: center; gap: 12px; height: 46px; padding: 0 16px; border-radius: 10px; background: rgba(5,10,20,0.78); box-shadow: 0 0 0 2px ${GOLD} inset;
  font-size: 24px; font-weight: 800; letter-spacing: 0.06em; color: #fff; white-space: nowrap; max-width: 100%; }
.bc-wdtag img { width: 30px; height: 30px; flex: 0 0 auto; }
.bc-wdtag b { color: ${GOLD}; letter-spacing: 0.01em; min-width: 0; overflow: hidden; text-overflow: ellipsis; }

/* right column: a We-Draft player's card / a team trend (610 wide) */
.bc-mo.card .body { padding: 26px 30px; align-items: stretch; }
.bc-mo .pcard { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.bc-mo .pcard .kick { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; letter-spacing: 0.16em; color: ${GOLD}; text-transform: uppercase; }
.bc-mo .pcard .kick img { width: 34px; height: 34px; }
.bc-mo .pcard .who { display: flex; align-items: center; gap: 18px; min-width: 0; margin-top: 4px; font-size: inherit; letter-spacing: 0; color: inherit; }
.bc-mo .pcard .who img { flex: 0 0 auto; width: 78px; height: 78px; object-fit: contain; }
.bc-mo .pcard .nm { font-size: 66px; min-width: 0; line-height: 0.92; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.bc-mo .pcard .nm.long { font-size: 54px; }
.bc-mo .pcard .meta { font-size: 24px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #c9d5e6; }
.bc-mo .pcard .stat { font-size: 34px; font-weight: 800; color: #fff; }
.bc-mo .pcard .hl { font-size: 58px; line-height: 0.95; }
.bc-mo .pcard .ctx { font-size: 27px; font-weight: 600; color: #dfe6f0; line-height: 1.18; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.bc-mo .pcard.trend .ctx { font-size: 32px; -webkit-line-clamp: 3; }
.bc-mo .pcard .board { margin-top: 6px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.14); display: flex; flex-direction: column; gap: 12px; }
.bc-mo .pcard .grade { display: flex; align-items: center; gap: 12px; min-width: 0; }
.bc-mo .pcard .grade .pill { flex: 0 0 auto; min-width: 58px; height: 42px; padding: 0 10px; border-radius: 9px; border: 2px solid; display: inline-flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 800; color: #fff; }
.bc-mo .pcard .grade .gl { font-size: 30px; font-weight: 800; color: #fff; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; }
.bc-mo .pcard .grade .rk { margin-left: auto; font-size: 22px; font-weight: 800; letter-spacing: 0.08em; color: ${GOLD}; text-transform: uppercase; white-space: nowrap; }
.bc-mo .pcard .str { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-height: 92px; overflow: hidden; }
.bc-mo .pcard .str .h { font-size: 19px; font-weight: 800; letter-spacing: 0.14em; color: #7f90aa; text-transform: uppercase; margin-right: 4px; }
.bc-mo .pcard .str .tag { font-size: 22px; font-weight: 700; color: #dfe6f0; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 3px 10px; white-space: nowrap; }
.bc-mo .pcard .url { margin-top: auto; display: flex; flex-direction: column; gap: 2px; font-size: 18px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: #7f90aa; }
.bc-mo .pcard .url b { color: ${GOLD}; font-size: 27px; letter-spacing: 0.01em; text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* the scorebug side of a team that just scored: a light sweep, twice */
.bc-team.hot { overflow: hidden; }
.bc-team.hot::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 45%; z-index: 0; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.28), transparent); transform: translateX(-120%) skewX(-16deg);
  animation: bc-hot 1300ms ease-in-out 500ms 2 both; }
.bc-team.hot > * { position: relative; z-index: 1; }
@keyframes bc-hot { to { transform: translateX(260%) skewX(-16deg); } }

@keyframes bc-rise { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
@keyframes bc-slide { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
@keyframes bc-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes bc-pop { 0% { opacity: 0; transform: scale(1.5); } 60% { opacity: 1; transform: scale(0.96); } 100% { transform: scale(1); } }
.bc-recent .bc-ph { height: 50px; } /* three rows fit under it */
`;
