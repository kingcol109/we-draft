// src/pages/homeModernStyle.js
//
// ── Modern look — the player page's and Community Board's design language
// (PlayerProfile.js's MODERN_STYLE, CommunityBoard.js's BOARD_MODERN_STYLE)
// for the Home page: light page, 1px hairlines instead of 2–3px blue/gold
// borders, one radius scale (10 / 14 / pill), compact left-anchored blue
// card headers, quiet eyebrow section titles, outline-by-default pills, no
// gold stripes, no sub-10px text. Shared by HomeHero.js and both designs
// (HomeOffSeason.js / HomeInSeason.js); Home.js scopes it under .wdh and
// it's layered over their inline styles (hence !important). ?modern=0
// shows the old look. ──
const BLUE = "#0055a5";

const HOME_MODERN_STYLE = `
  .wdh {
    --ink: #0f1b2d; --ink-2: #33415a; --ink-3: #5b6b84; --ink-4: #8a97ab;
    --line: #e3e8ef; --line-2: #eef1f5; --soft: #f7f9fc;
  }
  body:has(.wdh) { background: #f4f6f9; }
  .wdh .wdh-stripe, .wdh .wdh-secbar, .wdh .wdh-pattern, .wdh .wdh-headpill { display: none !important; }

  /* hero: hairline + 16px radius, outlined tiles, one gold pill CTA */
  .wdh .wdh-hero { border: 1px solid var(--line) !important; border-radius: 16px !important; background: ${BLUE} !important; }
  .wdh .wdh-tile {
    border: 1px solid rgba(255,255,255,0.22) !important; border-radius: 14px !important;
    background: rgba(255,255,255,0.06) !important; transition: background 0.15s, border-color 0.15s !important;
  }
  .wdh a.wdh-tile:hover { border-color: #fff !important; background: rgba(255,255,255,0.14) !important; }
  .wdh .wdh-cta { border: 1px solid rgba(255,255,255,0.6) !important; border-radius: 999px !important; transition: filter 0.15s; }
  .wdh .wdh-cta:hover { filter: brightness(1.08); }
  .wdh .mobile-chip { border-radius: 12px !important; background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.22) !important; }

  /* section titles: a quiet eyebrow, not a 22px banner + double rule */
  .wdh .wdh-sectitle { font-size: 14px !important; letter-spacing: 0.14em !important; color: ${BLUE} !important; margin-left: 2px; }
  .wdh .wdh-seclink { color: var(--ink-3) !important; font-weight: 800 !important; text-underline-offset: 3px; text-decoration-color: var(--line) !important; }
  .wdh .wdh-seclink:hover { color: ${BLUE} !important; text-decoration-color: ${BLUE} !important; }
  .wdh .wdh-banner { border-radius: 999px !important; font-size: 15px !important; letter-spacing: 0.14em !important; padding: 8px 18px !important; }

  /* cards: hairline, 14px radius, compact site-blue header with white text */
  .wdh .wdh-card { border: 1px solid var(--line) !important; border-radius: 14px !important; background: #fff; box-shadow: none !important; }
  .wdh .wdh-cardhead { padding: 10px 16px !important; }
  .wdh .wdh-cardhead > div { color: #fff !important; font-size: 13px !important; letter-spacing: 0.14em !important; }
  .wdh .wdh-row { border-bottom-color: var(--line-2) !important; }
  .wdh .wdh-row:last-child { border-bottom: 0 !important; }
  .wdh .wdh-grade { border: 0 !important; border-radius: 10px !important; }
  .wdh .wdh-promo { border: 1px solid var(--line) !important; border-radius: 14px !important; background: ${BLUE} !important; }

  /* draft boards */
  .wdh .wdh-boardhead { background: ${BLUE} !important; padding: 12px 16px !important; }
  .wdh .prospect-row { border-bottom-color: var(--line-2) !important; background: #fff !important; }
  .wdh .prospect-row:hover { background: var(--soft) !important; box-shadow: inset 3px 0 0 ${BLUE}; transform: none; }
  .wdh .wdh-pname { color: var(--ink) !important; }
  .wdh .prospect-row:hover .wdh-pname, .wdh .wdh-trend:hover .wdh-pname { color: ${BLUE} !important; }
  .wdh .wdh-school { color: var(--ink-3) !important; font-weight: 600; }
  .wdh .wdh-rank { border: 0 !important; border-radius: 10px !important; box-shadow: none !important; font-variant-numeric: tabular-nums; }
  .wdh .wdh-rank:not(.wdh-medal) { background: var(--soft) !important; border: 1px solid var(--line) !important; }
  .wdh .wdh-rank:not(.wdh-medal) span { color: var(--ink-3) !important; }
  .wdh .wdh-medal span { text-shadow: none !important; }
  .wdh .wdh-pos { border-radius: 6px !important; }
  .wdh .wdh-boardfoot { background: var(--soft) !important; border-top: 1px solid var(--line-2); padding: 10px 16px !important; }
  .wdh .wdh-foottext { color: var(--ink-4) !important; font-size: 11px !important; }
  .wdh .wdh-footbtn {
    background: #fff !important; color: ${BLUE} !important; border: 1px solid var(--line) !important;
    border-radius: 999px !important; box-shadow: none !important; transition: border-color 0.15s !important;
  }
  .wdh .wdh-footbtn:hover { border-color: ${BLUE} !important; }

  /* recent evaluations */
  .wdh .wdh-eval { padding: 14px 16px !important; }
  .wdh .wdh-evuser { font-size: 11px !important; color: var(--ink-2) !important; }
  .wdh .wdh-evplayer { font-size: 11px !important; color: ${BLUE} !important; text-underline-offset: 3px; }
  .wdh .wdh-evtext { font-style: normal !important; font-size: 13px !important; color: var(--ink-2) !important; font-family: Arial, sans-serif; font-weight: 600; }
  .wdh .wdh-sw { border-radius: 6px !important; }
  .wdh .wdh-swtext { font-size: 12px !important; font-family: Arial, sans-serif; }

  /* news + videos (same as the player page / board sidebars) */
  .wdh .wdh-date { border: 1px solid var(--line) !important; border-radius: 8px !important; }
  .wdh .wdh-date > div:first-child { background: var(--soft) !important; padding: 2px 0 !important; }
  .wdh .wdh-date > div:first-child span { color: var(--ink-4) !important; font-size: 10px !important; }
  .wdh .wdh-date > div:last-child span { color: var(--ink) !important; font-variant-numeric: tabular-nums; }
  .wdh .wdh-ntitle { text-transform: none !important; letter-spacing: 0 !important; font-weight: 700 !important; font-size: 14px !important; line-height: 1.35 !important; color: var(--ink) !important; }
  .wdh .wdh-vtitle { text-transform: none !important; letter-spacing: 0 !important; font-weight: 800 !important; font-size: 14px !important; color: var(--ink) !important; }
  .wdh .wdh-row img { border-radius: 8px !important; }
  .wdh a.wdh-row:hover { background: var(--soft) !important; }

  .wdh .wdh-follow { border-top: 1px solid var(--line) !important; }

  /* no text under 10px (grade badges keep their own fixed scale) */
  .wdh [style*="font-size: 6px"]:not(.wdh-grade *), .wdh [style*="font-size: 7px"]:not(.wdh-grade *) { font-size: 9px !important; }
  .wdh [style*="font-size: 8px"]:not(.wdh-grade *) { font-size: 10px !important; }
  .wdh [style*="font-size: 9px"]:not(.wdh-grade *) { font-size: 11px !important; }
`;

export default HOME_MODERN_STYLE;
