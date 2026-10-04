// src/pages/LivePage.js
//
// We-Draft Live — a "second screen" for college football Saturdays. Meant
// to sit on a monitor/TV and update itself: large type, dark background,
// no interaction needed once a view is picked (the view lives in the URL,
// so a TV can be bookmarked straight to /live?view=big).
//
// Data: ONE Firestore listener on liveSlate/current (every game on the
// slate + the rolling big-plays feed, maintained by the server-side
// ingester in server/live/*). The Game view adds that one game's listener
// (useLiveGame). Nothing here calls CFBD, so viewers never add API calls.
//
// Views: All Games · My Feed · My Teams · My Players · Big Plays · Game.
// My Feed = a game's play-by-play (left) + a personalized Feed (right,
// ⚙ Customize: We-Pick Ranked 6 / my teams / featured / followed players,
// and play types). Follows are
// per-browser (src/utils/live.js) and keyed by provider ids, so they work
// for every team/player, with or without a We-Draft profile.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useLiveGame } from "../hooks/useLiveGame";
import { useLiveGameDocs, useRankedSixIds, useGamePlays, useCfbdSchools, searchCfbdPlayers } from "../hooks/useLiveFeed";
import { usePlayReveal } from "../hooks/usePlayReveal";
import { useAuth } from "../context/AuthContext";
import AuthModal from "../components/AuthModal";
import Logo2 from "../assets/Logo2.png";
import LivePlayCard, { PLAY_CARD_STYLE, PendingPlayCard, TwoPointCard, FinalCard, playSummary } from "../components/LivePlayCard";
import confetti from "canvas-confetti";
import LiveGameStats, { LIVE_STATS_STYLE } from "../components/LiveGameStats";
import {
  statusLabel, teamShort, teamName, nextSituation, downLabel, spotLabel, clutchHeat, clockSecs, dedupeFeed,
  FOLLOW_TEAMS_KEY, FOLLOW_PLAYERS_KEY, loadFollows, saveFollows,
  loadFeedPrefs, saveFeedPrefs, normalizeFeedPrefs, playerIdSet, feedItemFromPlay,
} from "../utils/live";

const GOLD = "#f6a21d";
const LIVE_RED = "#ff4d4d";

const STYLE = `${PLAY_CARD_STYLE}${LIVE_STATS_STYLE}
.wdl-gtabs { display: flex; gap: 8px; margin: 22px 0 14px; }
.wdl-gtab { background: transparent; color: #9fb0c8; border: 1px solid #26324a; border-radius: 999px; padding: 7px 18px; font-weight: 900; font-size: clamp(13px, 1vw, 15px); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
.wdl-gtab.on { background: #eef2f8; color: #0a0f1a; border-color: #eef2f8; }
.wdl, .wdl * { scrollbar-width: thin; scrollbar-color: #2e3d5c transparent; }
.wdl ::-webkit-scrollbar { width: 8px; height: 8px; }
.wdl ::-webkit-scrollbar-track { background: transparent; }
.wdl ::-webkit-scrollbar-thumb { background: #2e3d5c; border-radius: 999px; border: 2px solid #0a0f1a; }
.wdl ::-webkit-scrollbar-thumb:hover { background: ${GOLD}; }
html:has(.wdl)::-webkit-scrollbar { width: 10px; }
html:has(.wdl)::-webkit-scrollbar-track { background: #0a0f1a; }
html:has(.wdl)::-webkit-scrollbar-thumb { background: #2e3d5c; border-radius: 999px; border: 2px solid #0a0f1a; }
html:has(.wdl) { scrollbar-color: #2e3d5c #0a0f1a; }
.wdl-card.clutch { border-color: rgba(255,160,40, calc(0.35 + var(--heat) * 0.65));
  box-shadow: 0 0 calc(8px + var(--heat) * 30px) rgba(255,130,0, calc(var(--heat) * 0.55)), inset 0 0 0 1px rgba(255,170,40, calc(var(--heat) * 0.7)); }
.wdl-tag.clutch { background: #ff8c1a; color: #121212; }
.wdl-strip { display: flex; gap: 10px; overflow-x: auto; padding: 10px clamp(16px, 2.4vw, 36px); border-bottom: 1px solid #1d2840; background: #0c1220; scrollbar-width: thin; }
.wdl-strip-game { flex-shrink: 0; display: grid; grid-template-columns: auto; gap: 3px; min-width: 132px; background: #111a2b; border: 1px solid #1d2840; border-radius: 10px; padding: 7px 10px; color: #eef2f8; cursor: pointer; text-align: left; font-family: inherit; }
.wdl-strip-game.live { border-color: rgba(255,77,77,0.45); }
.wdl-strip-game.on { outline: 2px solid ${GOLD}; outline-offset: 1px; }
.wdl-strip-game.clutch { border-color: rgba(255,160,40, calc(0.4 + var(--heat) * 0.6)); box-shadow: 0 0 calc(var(--heat) * 18px) rgba(255,130,0, calc(var(--heat) * 0.6)); }
.wdl-strip-row { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 13px; }
.wdl-strip-row img { width: 18px; height: 18px; object-fit: contain; }
.wdl-strip-team { flex: 1; white-space: nowrap; }
.wdl-strip-row b { font-size: 16px; font-weight: 900; font-variant-numeric: tabular-nums; animation: wdl-flash 1.6s ease-out; }
.wdl-strip-row.lose { opacity: 0.4; }
.wdl-strip-row.lose b { font-weight: 700; }
.wdl-strip-status { font-size: 11px; font-weight: 900; color: #9fb0c8; font-variant-numeric: tabular-nums; }
.wdl-strip-game.live .wdl-strip-status { color: ${LIVE_RED}; }
.wdl-strip-status .wdl-dot { width: 6px; height: 6px; margin-right: 5px; }
.wdl-rail-item { overflow: hidden; }
.wdl-rail-new { animation: wdl-rail-in 0.9s ease-out; }
@keyframes wdl-rail-in { 0% { max-height: 0; opacity: 0; transform: translateY(-14px); } 60% { opacity: 1; } 100% { max-height: 420px; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wdl-rail-new { animation: none; } }
.wdl-slot { position: relative; }
.wdl-slot-swap { animation: wdl-swap 0.45s ease-out; }
@keyframes wdl-swap { 0% { opacity: 0; transform: scale(0.985); } 100% { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wdl-slot-swap { animation: none; } }
@media (min-width: 1150px) { .wdl-rail { position: sticky; top: 84px; max-height: calc(100vh - 100px); overflow-y: auto; padding-right: 4px; } }
.wdl-railhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 4px 0 12px; }
.wdl-railsub { margin-left: 8px; color: #4f6080; letter-spacing: 0.04em; text-transform: none; font-weight: 800; }
.wdl-iconbtn.on { border-color: ${GOLD}; color: ${GOLD}; }
.wdl-cust { background: #111a2b; border: 1px solid #2a3753; border-radius: 14px; padding: 14px 16px; margin-bottom: 14px; }
.wdl-cust-h { font-size: 12px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #6f819c; margin: 10px 0 6px; }
.wdl-cust-h:first-child { margin-top: 0; }
.wdl-cust-row { display: flex; align-items: center; gap: 12px; padding: 7px 2px; font-size: 16px; font-weight: 800; color: #eef2f8; cursor: pointer; }
.wdl-cust-row small { display: block; font-size: 12px; font-weight: 700; color: #6f819c; margin-top: 1px; }
.wdl-cust-row.dim { opacity: 0.4; cursor: default; }
.wdl-cust-row input { width: 20px; height: 20px; accent-color: ${GOLD}; flex-shrink: 0; }
.wdl-cust-done { margin-top: 10px; width: 100%; background: ${GOLD}; color: #121212; border: none; border-radius: 10px; padding: 9px; font-weight: 900; font-size: 14px; cursor: pointer; }
.wdl { min-height: 100vh; background: #0a0f1a; color: #eef2f8; font-family: "Inter", "Segoe UI", Arial, sans-serif; }
.wdl * { box-sizing: border-box; }
.wdl a { color: inherit; }
.wdl-top { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding: 14px clamp(16px, 2.4vw, 36px); background: rgba(10,15,26,0.94); border-bottom: 1px solid #1d2840; backdrop-filter: blur(6px); }
.wdl-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 900; letter-spacing: 0.1em; font-size: clamp(14px, 1.2vw, 19px); text-decoration: none; white-space: nowrap; }
.wdl-brand img { height: clamp(22px, 2vw, 32px); width: auto; display: block; }
.wdl-brand span { color: #121212; background: ${GOLD}; border-radius: 6px; padding: 2px 7px; line-height: 1.2; }
.wdl-auth { flex-shrink: 0; background: ${GOLD}; color: #121212; border: 0; border-radius: 999px; padding: 7px 16px; font-weight: 900; font-size: 13px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.wdl-auth.on { background: transparent; color: #7ddc9a; border: 1px solid #2c5a3c; cursor: default; font-weight: 800; }
.wdl-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.wdl-tab { background: transparent; color: #9fb0c8; border: 1px solid #26324a; border-radius: 999px; padding: 7px 16px;
  font-weight: 800; font-size: clamp(13px, 1vw, 16px); cursor: pointer; }
.wdl-tab.on { background: ${GOLD}; color: #121212; border-color: ${GOLD}; }
.wdl-meta { margin-left: auto; color: #6f819c; font-size: 13px; font-weight: 700; display: flex; gap: 14px; align-items: center; }
.wdl-iconbtn { background: transparent; border: 1px solid #26324a; color: #9fb0c8; border-radius: 8px; padding: 5px 10px; font-weight: 800; cursor: pointer; }
.wdl-main { padding: clamp(14px, 2vw, 30px) clamp(16px, 2.4vw, 36px) 40px; display: grid; gap: clamp(16px, 2vw, 30px); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1150px) { .wdl-main.split { grid-template-columns: minmax(0, 1fr) minmax(340px, 30%); } }
.wdl-h { font-size: clamp(13px, 0.95vw, 15px); font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #6f819c; margin: 4px 0 12px; }
.wdl-grid { display: grid; gap: clamp(12px, 1.2vw, 18px); grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); }
.wdl-card { background: #111a2b; border: 1px solid #1d2840; border-radius: 16px; padding: clamp(14px, 1.2vw, 20px); cursor: pointer; position: relative; transition: border-color .15s; }
.wdl-card:hover { border-color: #3a4a6a; }
.wdl-card.live { border-color: rgba(255,77,77,0.55); box-shadow: 0 0 0 1px rgba(255,77,77,0.18) inset; }
.wdl-row { display: flex; align-items: center; gap: 12px; padding: 5px 0; }
.wdl-logo { width: clamp(34px, 2.6vw, 46px); height: clamp(34px, 2.6vw, 46px); object-fit: contain; flex-shrink: 0; }
.wdl-team { flex: 1; min-width: 0; font-weight: 800; font-size: clamp(17px, 1.35vw, 22px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wdl-rank { color: #8193ad; font-size: 0.72em; margin-right: 6px; font-weight: 800; }
.wdl-score { font-weight: 900; font-size: clamp(30px, 2.6vw, 44px); font-variant-numeric: tabular-nums; min-width: 1.6em; text-align: right; animation: wdl-flash 1.6s ease-out; }
.wdl-score.dim { color: #5f6f88; }
@keyframes wdl-flash { 0% { color: ${GOLD}; transform: scale(1.12); } 100% { transform: scale(1); } }
.wdl-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #1d2840;
  font-weight: 900; font-size: clamp(13px, 1vw, 16px); font-variant-numeric: tabular-nums; color: #9fb0c8; }
.wdl-status.live { color: ${LIVE_RED}; }
.wdl-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: ${LIVE_RED}; margin-right: 7px; animation: wdl-pulse 1.4s infinite; }
@keyframes wdl-pulse { 50% { opacity: 0.25; } }
.wdl-ball { color: ${GOLD}; font-size: 12px; margin-left: 4px; }
.wdl-last { margin-top: 8px; color: #8193ad; font-size: 14px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wdl-star { background: none; border: none; color: #3d4d6a; cursor: pointer; font-size: 16px; padding: 0 2px; }
.wdl-star.on { color: ${GOLD}; }
.wdl-tag { display: inline-block; font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; background: #1d2840; color: #9fb0c8; }
.wdl-tag.hot { background: ${GOLD}; color: #121212; }
.wdl-athletes { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.wdl-ath { background: #1a2438; border: 1px solid #26324a; color: #c9d5e6; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 800; cursor: pointer; }
.wdl-ath.on { border-color: ${GOLD}; color: ${GOLD}; }
.wdl-empty { color: #6f819c; font-weight: 700; font-size: 17px; padding: 30px 0; line-height: 1.6; }
.wdl-mu { position: relative; overflow: hidden; display: grid; grid-template-columns: 1fr auto minmax(120px, auto) auto 1fr; align-items: center; gap: clamp(8px, 1.6vw, 28px);
  min-height: clamp(150px, 15vw, 230px); padding: clamp(14px, 1.8vw, 26px) clamp(16px, 2.4vw, 36px); border-radius: 20px; border: 1px solid #1d2840;
  background:
    linear-gradient(102deg, color-mix(in srgb, var(--ac) 62%, #0b111c) 0%, color-mix(in srgb, var(--ac) 30%, #0b111c) 34%, #0b111c 49.6%,
      #0b111c 50.4%, color-mix(in srgb, var(--hc) 30%, #0b111c) 66%, color-mix(in srgb, var(--hc) 62%, #0b111c) 100%); }
/* the seam where the two teams meet */
.wdl-mu::before { content: ""; position: absolute; top: -10%; bottom: -10%; left: 50%; width: 3px; transform: translateX(-50%) skewX(-12deg);
  background: linear-gradient(transparent, rgba(255,255,255,0.35), transparent); pointer-events: none; }
.wdl-mu.clutch { border-color: rgba(255,160,40, calc(0.35 + var(--heat) * 0.65));
  box-shadow: 0 0 calc(10px + var(--heat) * 34px) rgba(255,130,0, calc(var(--heat) * 0.55)), inset 0 0 0 1px rgba(255,170,40, calc(var(--heat) * 0.7)); }
.wdl-mu-team { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; text-align: center; }
.wdl-mu-team.away { justify-self: start; }
.wdl-mu-team.home { justify-self: end; }
.wdl-mu-logo { position: relative; width: clamp(64px, 7.5vw, 120px); height: clamp(64px, 7.5vw, 120px); object-fit: contain; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.5)); }
.wdl-mu-ghost { position: absolute; top: 50%; width: clamp(180px, 22vw, 340px); height: clamp(180px, 22vw, 340px); object-fit: contain; opacity: 0.09; transform: translateY(-50%); pointer-events: none; }
.wdl-mu-team.away .wdl-mu-ghost { left: calc(-1 * clamp(70px, 8vw, 130px)); }
.wdl-mu-team.home .wdl-mu-ghost { right: calc(-1 * clamp(70px, 8vw, 130px)); }
/* a wordmark is huge and faded: it fills its team's half of the header
   (and bleeds off the edge — the header clips it) */
.wdl-mu-ghost.wm { width: clamp(560px, 58vw, 1150px); height: auto; max-height: none; opacity: 0.15; filter: saturate(1.1); }
.wdl-mu-team.away .wdl-mu-ghost.wm { left: calc(-1 * clamp(120px, 12vw, 260px)); }
.wdl-mu-team.home .wdl-mu-ghost.wm { right: calc(-1 * clamp(120px, 12vw, 260px)); }
.wdl-mu-name { position: relative; font-weight: 900; font-size: clamp(16px, 1.6vw, 26px); color: #fff; letter-spacing: 0.02em; text-shadow: 0 2px 8px rgba(0,0,0,0.5); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding-bottom: 4px; }
.wdl-mu-name.ball::after { content: ""; position: absolute; left: 15%; right: 15%; bottom: 0; height: 3px; border-radius: 2px; background: ${GOLD}; box-shadow: 0 0 10px ${GOLD}; }
.wdl-mu-rank { color: rgba(255,255,255,0.65); font-size: 0.7em; margin-right: 6px; }
.wdl-mu-score { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.wdl-mu-score b { font-weight: 900; font-size: clamp(58px, 7.5vw, 120px); line-height: 1; color: #fff; text-shadow: 0 6px 22px rgba(0,0,0,0.55); animation: wdl-flash 1.6s ease-out; }
.wdl-mu-score b.pre { color: rgba(255,255,255,0.35); }
.wdl-mu-score.home { flex-direction: row-reverse; }
.wdl-mu-fb { font-size: clamp(16px, 1.6vw, 26px); filter: drop-shadow(0 0 6px rgba(246,162,29,0.8)); }
.wdl-mu .lose { opacity: 0.5; }
.wdl-mu-score.win b { text-shadow: 0 0 26px rgba(255,255,255,0.35), 0 6px 22px rgba(0,0,0,0.55); }
.wdl-mu-mid { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.wdl-mu-status { font-weight: 900; font-size: clamp(15px, 1.5vw, 24px); color: #eef2f8; background: rgba(10,15,26,0.75); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 999px; padding: 6px 16px; font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: 0.04em; }
.wdl-mu-status.live { color: #fff; background: rgba(214,40,40,0.85); border-color: rgba(255,120,120,0.6); }
.wdl-mu-status .wdl-dot { background: #fff; }
.wdl-mu.final .wdl-mu-status { background: rgba(255,255,255,0.92); color: #0a0f1a; }
.wdl-mu-next { font-weight: 800; font-size: clamp(13px, 1.1vw, 17px); color: rgba(255,255,255,0.8); white-space: nowrap; }
.wdl-mu-link { font-size: 12px; font-weight: 800; color: rgba(255,255,255,0.75); text-decoration: none; border: 1px solid rgba(255,255,255,0.22); border-radius: 8px; padding: 4px 10px; background: rgba(10,15,26,0.5); }
/* Phones — last, so it overrides the rules above. */
@media (max-width: 700px) {
  .wdl-top { gap: 8px 12px; padding: 10px 12px; }
  .wdl-brand { font-size: 12px; gap: 6px; }
  .wdl-brand img { height: 20px; }
  .wdl-auth { padding: 5px 12px; font-size: 12px; }
  .wdl-meta { margin-left: 0; }
  .wdl-top > .wdl-auth { margin-left: auto; }
  .wdl-tabs { order: 3; width: 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .wdl-tabs::-webkit-scrollbar { display: none; }
  .wdl-tab { white-space: nowrap; padding: 6px 12px; font-size: 13px; }
  .wdl-meta { font-size: 12px; }
  .wdl-meta .wdl-iconbtn { display: none; }
  .wdl-strip { padding: 8px 12px; }
  .wdl-main { padding: 12px 12px 32px; }
  .wdl-mu { grid-template-columns: 1fr auto auto auto 1fr; gap: 6px; padding: 14px 10px; min-height: 0; }
  .wdl-mu-logo { width: 44px; height: 44px; }
  .wdl-mu-ghost { display: none; }
  .wdl-mu-ghost.wm { display: block; width: 95vw; opacity: 0.13; }
  .wdl-mu-name { font-size: 13px; }
  .wdl-mu-score b { font-size: 40px; }
  .wdl-mu-fb { font-size: 13px; }
  .wdl-mu-status { font-size: 12px; padding: 4px 9px; }
  .wdl-mu-next { font-size: 11px; white-space: normal; }
  .wdl-mu-link { display: none; }
  .wdl-main.feed .wdl-rail { order: -1; max-height: 46vh; overflow-y: auto; border-bottom: 1px solid #1d2840; padding-bottom: 8px; }
  .lpc { padding: 12px 14px; }
  .lpc-line { font-size: 19px; }
  .lpc.hype .lpc-line { font-size: 22px; }
  .lpc-detail { font-size: 15px; }
}
/* Follow search + Customize tab */
.wdl-search { margin-bottom: 16px; max-width: 640px; }
.wdl-search input { width: 100%; box-sizing: border-box; background: #0c1220; border: 1px solid #2a3753; color: #eef2f8; border-radius: 12px; padding: 12px 14px; font-size: 16px; font-weight: 700; font-family: inherit; outline: none; }
.wdl-search input:focus { border-color: ${GOLD}; }
.wdl-search-list { margin-top: 6px; background: #111a2b; border: 1px solid #2a3753; border-radius: 12px; overflow: hidden; }
.wdl-search-hit { display: flex; align-items: center; gap: 12px; width: 100%; background: transparent; border: 0; border-bottom: 1px solid #1d2840; color: #eef2f8; padding: 9px 14px; cursor: pointer; text-align: left; font-family: inherit; }
.wdl-search-hit:last-child { border-bottom: 0; }
.wdl-search-hit:hover { background: #16213a; }
.wdl-search-hit img, .wdl-search-noimg { width: 30px; height: 30px; object-fit: contain; flex-shrink: 0; }
.wdl-search-pos { width: 34px; flex-shrink: 0; font-size: 12px; font-weight: 900; color: #9fb0c8; text-align: center; background: #1a2438; border-radius: 6px; padding: 4px 0; }
.wdl-search-name { flex: 1; font-weight: 800; font-size: 15px; min-width: 0; }
.wdl-search-name small { display: block; font-size: 12px; font-weight: 700; color: #6f819c; }
.wdl-search-hit b { font-size: 12px; font-weight: 900; color: ${GOLD}; white-space: nowrap; }
.wdl-search-hit.on b { color: #9fb0c8; }
.wdl-search-none { padding: 12px 14px; color: #6f819c; font-weight: 700; font-size: 14px; }
.wdl-chip { display: inline-flex; align-items: center; gap: 6px; }
.wdl-chip img { width: 16px; height: 16px; object-fit: contain; }
.wdl-chip-sub { color: #6f819c; font-weight: 700; }
.wdl-custpage { max-width: 640px; }
.wdl-cust-sub { font-size: 13px; font-weight: 800; color: #9fb0c8; margin: 8px 2px 6px; }
.wdl-seg { display: inline-flex; background: #0c1220; border: 1px solid #26324a; border-radius: 999px; padding: 3px; margin-bottom: 4px; }
.wdl-seg button { background: transparent; border: 0; color: #9fb0c8; font-weight: 800; font-size: 14px; padding: 6px 14px; border-radius: 999px; cursor: pointer; font-family: inherit; }
.wdl-seg button.on { background: ${GOLD}; color: #121212; }
.wdl-seg.dim { opacity: 0.4; }
.wdl-seg.dim button { cursor: default; }
.wdl-follow-sec { margin-bottom: 18px; }
.wdl-feed-nudge { background: #111a2b; border: 1px dashed #2a3753; border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; font-weight: 700; color: #9fb0c8; }
.wdl-feed-nudge button { background: none; border: 0; padding: 0; color: ${GOLD}; font-weight: 900; cursor: pointer; font-family: inherit; font-size: inherit; }
/* Compact (phones + tablets): the Feed is the page, a picked game stands alone. */
.wdl-compact .wdl-main.compact .wdl-rail { order: 0; max-height: none; overflow: visible; border-bottom: 0; padding: 0; position: static; }
.wdl-back { background: #111a2b; color: #eef2f8; border: 1px solid #26324a; border-radius: 999px; padding: 7px 14px; font-weight: 800; font-size: 14px; cursor: pointer; margin-bottom: 12px; font-family: inherit; }
.wdl-solo { max-width: 900px; margin: 0 auto; }
.wdl-rotate { display: none; }
/* Sideways: opening a game asks to turn upright (the game view is built
   for portrait) — tries to lock portrait where the browser allows it,
   else this hint shows. */
@media (orientation: landscape) {
  .wdl-compact .wdl-rotate { display: flex; align-items: center; gap: 8px; background: #111a2b; border: 1px solid #2a3753; border-radius: 10px;
    padding: 7px 12px; margin-bottom: 10px; font-size: 13px; font-weight: 800; color: #9fb0c8; }
  .wdl-compact .wdl-rotate b { font-size: 18px; color: ${GOLD}; }
}
/* Tablets: a bit more room than a phone. */
@media (min-width: 701px) {
  .wdl-compact .wdl-main { padding: 16px 20px 36px; }
}
/* Phones held sideways: short screen — slim header and strip, nothing sticky
   eating the height, a tighter scoreboard. */
@media (max-height: 540px) and (orientation: landscape) {
  .wdl-compact .wdl-top { position: static; padding: 6px 14px; gap: 6px 12px; flex-wrap: nowrap; }
  .wdl-compact .wdl-brand { font-size: 11px; }
  .wdl-compact .wdl-brand img { height: 18px; }
  .wdl-compact .wdl-auth { padding: 4px 11px; font-size: 12px; }
  .wdl-compact .wdl-tabs { order: 0; width: auto; flex: 1; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .wdl-compact .wdl-tabs::-webkit-scrollbar { display: none; }
  .wdl-compact .wdl-tab { white-space: nowrap; padding: 4px 11px; font-size: 12px; }
  .wdl-compact .wdl-meta { display: none; }
  .wdl-compact .wdl-strip { padding: 6px 14px; gap: 8px; }
  .wdl-compact .wdl-strip-game { min-width: 118px; padding: 5px 8px; }
  .wdl-compact .wdl-main { padding: 10px 14px 28px; }
  .wdl-compact .wdl-back { padding: 5px 12px; font-size: 13px; margin-bottom: 8px; }
  .wdl-compact .wdl-mu { grid-template-columns: 1fr auto auto auto 1fr; gap: 10px; padding: 10px 14px; min-height: 0; }
  .wdl-compact .wdl-mu-logo { width: 52px; height: 52px; }
  .wdl-compact .wdl-mu-score b { font-size: 46px; }
  .wdl-compact .wdl-mu-ghost.wm { opacity: 0.12; }
  .wdl-compact .lpc { padding: 10px 14px; }
}
`;

const sortGames = (a, b) => {
  const rank = (g) => (g.status === "in_progress" ? 0 : g.status === "scheduled" ? 1 : 2);
  return rank(a) - rank(b)
    || Number(b.gameOfWeek) - Number(a.gameOfWeek)
    || Number(b.featured) - Number(a.featured)
    || (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0);
};

function useNow(ms) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// Keep a TV/monitor from sleeping while /live is on screen (where supported).
function useWakeLock() {
  useEffect(() => {
    let lock = null;
    const request = async () => {
      try { if (document.visibilityState === "visible" && navigator.wakeLock) lock = await navigator.wakeLock.request("screen"); } catch { /* not allowed — fine */ }
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => { document.removeEventListener("visibilitychange", request); lock?.release?.().catch(() => {}); };
  }, []);
}

function TeamLine({ team, side, game, followedTeams, onToggleTeam }) {
  const live = game.status === "in_progress";
  const other = side === "home" ? game.away : game.home;
  const losing = game.status === "final" && team.points != null && other.points != null && team.points < other.points;
  const followed = followedTeams.includes(team.providerTeamId);
  return (
    <div className="wdl-row">
      {team.logo ? <img className="wdl-logo" src={team.logoDark || team.logo} alt="" onError={(e) => { if (team.logoDark && e.currentTarget.src !== team.logo) e.currentTarget.src = team.logo; }} /> : <div className="wdl-logo" />}
      <div className="wdl-team">
        {team.rank ? <span className="wdl-rank">{team.rank}</span> : null}
        {teamName(team)}
        {live && game.possession === side && <span className="wdl-ball" title="Possession">●</span>}
      </div>
      <button className={`wdl-star${followed ? " on" : ""}`} title={followed ? "Unfollow team" : "Follow team"}
        onClick={(e) => { e.stopPropagation(); onToggleTeam(team.providerTeamId); }}>★</button>
      {team.points != null && (
        <div key={team.points} className={`wdl-score${losing ? " dim" : ""}`}>{team.points}</div>
      )}
    </div>
  );
}

function GameTile({ game, followedTeams, onToggleTeam, onOpen }) {
  const live = game.status === "in_progress";
  const heat = clutchHeat(game);
  return (
    <div className={`wdl-card${live ? " live" : ""}${heat ? " clutch" : ""}`} style={heat ? { "--heat": heat.toFixed(2) } : undefined}
      onClick={() => onOpen(game.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(game.id); }}>
      <TeamLine team={game.away} side="away" game={game} followedTeams={followedTeams} onToggleTeam={onToggleTeam} />
      <TeamLine team={game.home} side="home" game={game} followedTeams={followedTeams} onToggleTeam={onToggleTeam} />
      <div className={`wdl-status${live ? " live" : ""}`}>
        <span>{live && <span className="wdl-dot" />}{statusLabel(game)}{live && game.situation ? <span style={{ color: "#9fb0c8", marginLeft: 10 }}>{game.situation}</span> : null}</span>
        <span style={{ display: "flex", gap: 6 }}>
          {heat >= 0.5 && <span className="wdl-tag clutch">Crunch time</span>}
          {game.gameOfWeek && <span className="wdl-tag hot">Game of the Week</span>}
          {!game.gameOfWeek && game.featured && <span className="wdl-tag">Featured</span>}
          {game.status === "scheduled" && game.tv && <span className="wdl-tag">{game.tv}</span>}
        </span>
      </div>
      {live && (game.lastPlay || game.lastPlayText) && (
        <div className="wdl-last">{game.lastPlay ? playSummary(game.lastPlay) : game.lastPlayText}</div>
      )}
    </div>
  );
}

// Not worth a Feed card even in "every play" mode.
const EVERY_SKIP = new Set(["timeout", "period"]);

// How far along a live game is, in game seconds (OT counts past the 4th).
const gameProgress = (g) => (g.period || 0) * 900 - Math.min(900, clockSecs(g.clock) ?? 900);
const gameMargin = (g) => Math.abs((g.home?.points ?? 0) - (g.away?.points ?? 0));
// Live games closest to finishing first — those in the 4th quarter / OT
// ordered by the closest score — then every final of the week, most recent
// kickoff first.
function stripOrder(games) {
  const live = games.filter((g) => g.status === "in_progress");
  const late = live.filter((g) => (g.period || 0) >= 4).sort((a, b) => gameMargin(a) - gameMargin(b) || gameProgress(b) - gameProgress(a));
  const early = live.filter((g) => (g.period || 0) < 4).sort((a, b) => gameProgress(b) - gameProgress(a));
  const finals = games.filter((g) => g.status === "final").sort((a, b) => (Date.parse(b.startDate) || 0) - (Date.parse(a.startDate) || 0));
  return [...late, ...early, ...finals];
}

// A row of live scores (then all of the week's finals) for views that aren't the
// All Games grid — click one to open it. Close 4th-quarter games glow. The
// order is set when the page loads and then holds — scores update in place
// and games only move on a refresh. Games that start later join the end of
// the live ones; games that go final later join the end of the row.
function ScoreStrip({ games, onPick, current }) {
  const order = useRef(null);
  const shown = games.filter((g) => g.status === "in_progress" || g.status === "final");
  if (!order.current && shown.length) order.current = stripOrder(shown).map((g) => g.id);
  if (order.current) {
    const known = new Set(order.current);
    const fresh = shown.filter((g) => !known.has(g.id));
    if (fresh.length) {
      const firstFinal = order.current.findIndex((id) => shown.find((g) => g.id === id)?.status === "final");
      const at = firstFinal < 0 ? order.current.length : firstFinal;
      const liveIds = fresh.filter((g) => g.status === "in_progress").map((g) => g.id);
      const finalIds = fresh.filter((g) => g.status === "final").map((g) => g.id);
      order.current = [...order.current.slice(0, at), ...liveIds, ...order.current.slice(at), ...finalIds];
    }
  }
  const byId = new Map(shown.map((g) => [g.id, g]));
  const list = (order.current || []).map((id) => byId.get(id)).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="wdl-strip">
      {list.map((g) => {
        const heat = clutchHeat(g);
        const live = g.status === "in_progress";
        return (
          <button key={g.id} className={`wdl-strip-game${live ? " live" : ""}${heat ? " clutch" : ""}${g.id === current ? " on" : ""}`}
            style={heat ? { "--heat": heat.toFixed(2) } : undefined} onClick={() => onPick(g.id)}>
            {["away", "home"].map((side) => (
              <span key={side} className={`wdl-strip-row${g.status === "final" && g[side].points < g[side === "home" ? "away" : "home"].points ? " lose" : ""}`}>
                {g[side].logo && <img src={g[side].logoDark || g[side].logo} alt="" />}
                <span className="wdl-strip-team">{teamShort(g[side])}</span>
                <b key={g[side].points}>{g[side].points ?? ""}</b>
              </span>
            ))}
            <span className="wdl-strip-status">{live && <span className="wdl-dot" />}{statusLabel(g)}</span>
          </button>
        );
      })}
    </div>
  );
}

// A feed list where new entries slide in at the top and push the rest down,
// like a scrolling feed — instead of the list jumping. Entries there when
// the list first had content don't animate; an entry marked new keeps its
// class, so a re-render mid-animation doesn't cut it off.
function FeedList({ items, render }) {
  const st = useRef({ init: false, known: new Set(), fresh: new Set() });
  const r = st.current;
  if (!r.init) {
    if (items.length) { items.forEach((i) => r.known.add(i.key)); r.init = true; }
  } else {
    items.forEach((i) => { if (!r.known.has(i.key)) { r.known.add(i.key); r.fresh.add(i.key); } });
  }
  return items.map((item) => (
    <div key={item.key} className={`wdl-rail-item${r.fresh.has(item.key) ? " wdl-rail-new" : ""}`}>{render(item)}</div>
  ));
}

// One Feed entry — clicking it opens the play in My Feed's left-hand game
// feed (onSelect), or elsewhere opens that game's view.
function BigPlayItem({ play, followedPlayers, onTogglePlayer, onOpenGame, onSelect, selected }) {
  const followedIds = playerIdSet(followedPlayers);
  return (
    <LivePlayCard
      variant="compact"
      play={play}
      team={play.teamLogo || play.offenseLogo ? { logo: play.teamLogo || play.offenseLogo, short: play.teamName || play.offenseName } : null}
      scoreboard={{
        away: { short: play.awayShort, logo: play.awayLogo, score: play.awayScore },
        home: { short: play.homeShort, logo: play.homeLogo, score: play.homeScore },
      }}
      onClick={() => (onSelect ? onSelect(play) : onOpenGame(play.gameId))}
      highlight={selected}
      teamColor={play.teamColor}
      followedIds={followedIds}
      onTogglePlayer={onTogglePlayer}
    />
  );
}

function GameView({ gameId, slateGame, followedPlayers, onTogglePlayer, focusPlayId, scrollToPlayId, onQueueChange }) {
  // Jumping to a specific play (from the Feed) loads the full play list so
  // an older play can be found; otherwise just the newest plays.
  const { game: live, plays, ready } = useLiveGame(gameId, { plays: focusPlayId ? "all" : "recent", box: false });
  const gLive = live || slateGame;
  // New plays are revealed through the top slot one at a time (each held
  // ~10s before it drops into the list) — see hooks/usePlayReveal.js.
  const { listed, slot, justListed, queued } = usePlayReveal(plays, gameId);
  // Tell the page which plays are still queued, so the Feed rail holds
  // them back until the game feed has shown them.
  const queuedKey = queued.join(",");
  useEffect(() => {
    onQueueChange?.(gameId, queued);
    return () => onQueueChange?.(gameId, []); // leaving this game: nothing held back
  }, [gameId, queuedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // While plays are queued, the header shows the game as of the last play
  // revealed — score, quarter, clock — and catches up as they play out.
  const g = useMemo(() => {
    if (!gLive || !queued.length) return gLive;
    const shownNewest = slot || listed[listed.length - 1];
    if (!shownNewest || shownNewest.homeScore == null) return gLive;
    return {
      ...gLive,
      home: { ...gLive.home, points: shownNewest.homeScore },
      away: { ...gLive.away, points: shownNewest.awayScore },
      period: shownNewest.period ?? gLive.period,
      clock: shownNewest.clock ?? gLive.clock,
    };
  }, [gLive, queuedKey, slot, listed]); // eslint-disable-line react-hooks/exhaustive-deps
  const newestListed = useMemo(() => [...listed].reverse(), [listed]);

  // Scroll the play picked in the Feed into view — once per pick. (It
  // waits for that play to be loaded, but new plays arriving afterwards
  // never scroll the page again.)
  // Confetti in the winner's color when the game goes final while it's on
  // screen (not when opening an already-finished game).
  const prevStatus = useRef(null);
  useEffect(() => {
    const st = live?.status;
    if (prevStatus.current === "in_progress" && st === "final" && live) {
      const winner = (live.home?.points ?? 0) >= (live.away?.points ?? 0) ? live.home : live.away;
      confetti({ particleCount: 180, spread: 100, origin: { y: 0.3 }, colors: [winner?.color || "#f6a21d", "#ffffff", "#f6a21d"], disableForReducedMotion: true });
    }
    if (st) prevStatus.current = st;
  }, [live]);

  // Play-by-Play | Stats. Jumping to a play always shows the plays.
  const [tab, setTab] = useState("plays");
  useEffect(() => { if (scrollToPlayId) setTab("plays"); }, [scrollToPlayId]);

  const scrolledTo = useRef(null);
  useEffect(() => {
    if (!scrollToPlayId || scrolledTo.current === scrollToPlayId) return;
    const el = document.getElementById(`play-${scrollToPlayId}`);
    if (el) {
      scrolledTo.current = scrollToPlayId;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToPlayId, plays.length]);

  if (!g) return <div className="wdl-empty">{ready ? "This game isn't on the current slate." : "Loading…"}</div>;
  const isLive = g.status === "in_progress";
  const followedIds = playerIdSet(followedPlayers);
  const cardProps = (p) => ({
    play: p,
    // Badge = team credited with the play (defense on a sack/pick); the
    // right column shows who had the ball on the snap.
    team: (p.presentation?.creditSide || p.offense) ? g[p.presentation?.creditSide || p.offense] : null,
    possessionTeam: p.offense ? g[p.offense] : null,
    scoreLabel: `${teamShort(g.away)} ${p.awayScore} – ${teamShort(g.home)} ${p.homeScore}`,
    followedIds,
    onTogglePlayer,
  });
  // The upcoming snap, inferred from the plays on screen (utils/live.js
  // nextSituation) — so it always follows from what the viewer just saw.
  // One object feeds the next-play card AND the header. null → nothing to
  // show (not live, or a kickoff is next after a score).
  const shown = slot ? [slot, ...newestListed] : newestListed;
  const next = isLive ? nextSituation(shown, g) : null;
  const nextOffense = next?.offense ? g[next.offense] : null;
  const nextDefense = next?.offense ? g[next.offense === "home" ? "away" : "home"] : null;
  const nextText = next?.down
    ? `${downLabel(next.down, next.distance)}${next.ytg != null ? ` at ${spotLabel(next.ytg, nextOffense, nextDefense)}` : ""}`
    : next?.brk?.label || "";
  const heat = clutchHeat(g);
  const isFinal = g.status === "final";
  // A two-point try is its own entity, right after its touchdown.
  const withTwo = (p) => (p.presentation?.pat?.type === "two"
    ? <TwoPointCard pat={p.presentation.pat} team={g[p.presentation.creditSide || p.offense]} /> : null);
  return (
    <div>
      {/* Head-to-head header: each half in its team's color meeting at a
          slanted seam, logos facing off from the edges, scores on either
          side of the status medallion. */}
      {(() => {
        const hp = g.home?.points;
        const ap = g.away?.points;
        const loser = isFinal && hp != null && ap != null && hp !== ap ? (hp > ap ? "away" : "home") : null;
        const team = (side) => {
          const t = g[side] || {};
          const logo = t.logoDark || t.logo;
          const hasBall = isLive && g.possession === side;
          return (
            <div className={`wdl-mu-team ${side}${loser === side ? " lose" : ""}${loser && loser !== side ? " win" : ""}`}>
              {(t.wordmark || logo) && <img className={`wdl-mu-ghost${t.wordmark ? " wm" : ""}`} src={t.wordmark || logo} alt="" aria-hidden="true" />}
              {logo && <img className="wdl-mu-logo" src={logo} alt="" />}
              <div className={`wdl-mu-name${hasBall ? " ball" : ""}`}>
                {t.rank ? <span className="wdl-mu-rank">#{t.rank}</span> : null}{teamName(t)}
              </div>
            </div>
          );
        };
        const score = (side) => {
          const t = g[side] || {};
          return (
            <div className={`wdl-mu-score ${side}${loser === side ? " lose" : ""}${loser && loser !== side ? " win" : ""}`}>
              {isLive && g.possession === side && <span className="wdl-mu-fb" title="Possession">🏈</span>}
              {t.points != null ? <b key={t.points}>{t.points}</b> : <b className="pre">–</b>}
            </div>
          );
        };
        return (
          <div className={`wdl-mu${heat ? " clutch" : ""}${isFinal ? " final" : ""}`}
            style={{ "--ac": g.away?.color || "#2a4a7a", "--hc": g.home?.color || "#7a2a2a", ...(heat ? { "--heat": heat.toFixed(2) } : {}) }}>
            {team("away")}
            {score("away")}
            <div className="wdl-mu-mid">
              <div className={`wdl-mu-status${isLive ? " live" : ""}`}>{isLive && <span className="wdl-dot" />}{statusLabel(g)}</div>
              {nextText && !slot && isLive && <div className="wdl-mu-next">{nextText}</div>}
              {!isLive && !isFinal && <div className="wdl-mu-next">{g.tv || ""}</div>}
              {g.slug && <Link to={`/game/${g.slug}`} className="wdl-mu-link">Game page →</Link>}
            </div>
            {score("home")}
            {team("home")}
          </div>
        );
      })()}
      <div className="wdl-gtabs">
        <button className={`wdl-gtab${tab === "plays" ? " on" : ""}`} onClick={() => setTab("plays")}>{isLive ? "Live play-by-play" : "Play-by-play"}</button>
        <button className={`wdl-gtab${tab === "stats" ? " on" : ""}`} onClick={() => setTab("stats")}>{isLive ? "Live stats" : "Stats"}</button>
      </div>
      {tab === "stats" ? <LiveGameStats gameId={gameId} game={g} /> : <>
      {/* The top slot: one persistent box that is the "next play", turns
          into the play that just happened (held ~10s, "JUST NOW"), then
          goes back to the next play once that one drops into the list. */}
      {/* A finished game opens with the winner — in place of the bare
          "END OF Q4" play, which is left out of the list below. */}
      {isFinal && <FinalCard game={g} />}
      {(slot || next) && (
        <div className="wdl-slot">
          {slot ? (
            <div key={`slot-${slot.id}`} className="wdl-slot-swap" id={`play-${slot.id}`}>
              <LivePlayCard variant="detailed" justNow {...cardProps(slot)} />
              {withTwo(slot)}
            </div>
          ) : (
            <div key="slot-next" className="wdl-slot-swap">
              <PendingPlayCard game={g} situation={next} />
            </div>
          )}
        </div>
      )}
      {newestListed.length || slot ? newestListed.filter((p) => !(isFinal && p.presentation?.type === "period" && p.period >= 4)).map((p) => (
        <div key={p.id} id={`play-${p.id}`}>
          <LivePlayCard variant="detailed" highlight={p.id === focusPlayId} fresh={p.id === justListed} {...cardProps(p)} />
          {withTwo(p)}
        </div>
      )) : (
        <div className="wdl-empty">
          {g.status === "scheduled" ? `Kickoff ${statusLabel(g)}. Plays will stream in here once it starts.` : "No plays available for this game yet."}
        </div>
      )}
      </>}
    </div>
  );
}

// My Feed's settings panel (opened by the rail's Customize button).
// Follow a team: search every school linked to a CFBD team (by school,
// mascot or abbreviation) and tap to follow / unfollow.
function TeamSearch({ schools, followed, onToggle }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hits = needle.length < 2 ? [] : schools.filter((t) =>
    [t.name, t.short, t.mascot, t.alt, `${t.name} ${t.mascot}`].some((v) => v && v.toLowerCase().includes(needle))).slice(0, 8);
  return (
    <div className="wdl-search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams to follow — e.g. Ohio State, Ducks, LSU" aria-label="Search teams" />
      {needle.length >= 2 && (
        <div className="wdl-search-list">
          {hits.length ? hits.map((t) => {
            const on = followed.includes(t.id);
            return (
              <button key={t.id} className={`wdl-search-hit${on ? " on" : ""}`} onClick={() => onToggle(t.id)}>
                {t.logo ? <img src={t.logo} alt="" /> : <span className="wdl-search-noimg" />}
                <span className="wdl-search-name">{t.name}<small>{[t.mascot, t.conference].filter(Boolean).join(" · ")}</small></span>
                <b>{on ? "★ Following" : "+ Follow"}</b>
              </button>
            );
          }) : <div className="wdl-search-none">{schools.length ? "No teams match." : "Loading teams…"}</div>}
        </div>
      )}
    </div>
  );
}

// Follow a player: name search over every player CFBD knows (cfbdPlayers),
// most recent roster first.
function PlayerSearch({ followedIds, onToggle }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setHits([]); setBusy(false); return undefined; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      searchCfbdPlayers(text).then((r) => { if (alive) { setHits(r); setBusy(false); } }).catch(() => { if (alive) setBusy(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  return (
    <div className="wdl-search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players to follow — e.g. Julian Sayin" aria-label="Search players" />
      {q.trim().length >= 2 && (
        <div className="wdl-search-list">
          {hits.length ? hits.map((p) => {
            const on = followedIds.has(p.id);
            return (
              <button key={p.id} className={`wdl-search-hit${on ? " on" : ""}`} onClick={() => onToggle(p)}>
                <span className="wdl-search-pos">{p.position || "—"}</span>
                <span className="wdl-search-name">{p.name}<small>{[p.team, p.jersey != null && `#${p.jersey}`].filter(Boolean).join(" · ")}</small></span>
                <b>{on ? "★ Following" : "+ Follow"}</b>
              </button>
            );
          }) : <div className="wdl-search-none">{busy ? "Searching…" : "No players match."}</div>}
        </div>
      )}
    </div>
  );
}

function FeedCustomize({ prefs, onChange, onClose, signedIn, rankedCount, teamCount, playerCount }) {
  const setGames = (k, v) => onChange({ ...prefs, games: { ...prefs.games, [k]: v } });
  const setType = (k, v) => onChange({ ...prefs, types: { ...prefs.types, [k]: v } });
  const allGames = prefs.games.all;
  const Row = ({ checked, onToggle, label, note, disabled }) => (
    <label className={`wdl-cust-row${disabled ? " dim" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
      <span>{label}{note && <small>{note}</small>}</span>
    </label>
  );
  // Big plays only, or every play — for followed teams' games and for
  // followed players.
  const Choice = ({ value, onPick, disabled, options = [["big", "Big plays"], ["all", "Every play"]] }) => (
    <div className={`wdl-seg${disabled ? " dim" : ""}`}>
      {options.map(([k, l]) => (
        <button key={k} type="button" disabled={disabled} className={value === k ? "on" : ""} onClick={() => onPick(k)}>{l}</button>
      ))}
    </div>
  );
  return (
    <div className="wdl-cust">
      <div className="wdl-cust-h">Games</div>
      <Row checked={allGames} onToggle={(v) => setGames("all", v)} label="All games" />
      <Row disabled={allGames} checked={prefs.games.wepick} onToggle={(v) => setGames("wepick", v)} label="My We-Pick games"
        note={signedIn ? `${rankedCount} game${rankedCount === 1 ? "" : "s"} in your Ranked 6` : "Sign in to use your Ranked 6"} />
      <Row disabled={allGames} checked={prefs.games.myTeams} onToggle={(v) => setGames("myTeams", v)} label="My teams" note={`${teamCount} followed`} />
      <Row disabled={allGames} checked={prefs.games.featured} onToggle={(v) => setGames("featured", v)} label="Featured & Game of the Week" />
      <div className="wdl-cust-sub">From my teams' games</div>
      <Choice value={prefs.teamPlays} disabled={allGames || !prefs.games.myTeams} onPick={(v) => onChange({ ...prefs, teamPlays: v })} />
      <div className="wdl-cust-h">Players</div>
      <Row checked={prefs.players} onToggle={(v) => onChange({ ...prefs, players: v })} label="Plays by players I follow" note={`${playerCount} followed`} />
      <div className="wdl-cust-sub">From my players</div>
      <Choice value={prefs.playerPlays} disabled={!prefs.players} onPick={(v) => onChange({ ...prefs, playerPlays: v })} />
      <div className="wdl-cust-h">Big plays include</div>
      <Row checked={prefs.types.score} onToggle={(v) => setType("score", v)} label="Scoring plays" />
      <Row checked={prefs.types.big} onToggle={(v) => setType("big", v)} label="Big plays (20+ yards)" />
      <Row checked={prefs.types.turnover} onToggle={(v) => setType("turnover", v)} label="Turnovers" note="Interceptions & fumbles" />
      <Row checked={prefs.types.final} onToggle={(v) => setType("final", v)} label="Final scores" note="When your games end" />
      <div className="wdl-cust-h">Scoreboard</div>
      <div className="wdl-cust-sub">Scores along the top</div>
      <Choice value={prefs.strip} options={[["all", "All games"], ["mine", "My games"]]} onPick={(v) => onChange({ ...prefs, strip: v })} />
      <button className="wdl-cust-done" onClick={onClose}>Done</button>
    </div>
  );
}

// Phones (either way up) and tablets: no side rail. /live opens on the Feed
// — scores on top, the Feed below — and picking a game shows just that game,
// scoreboard on top and its plays underneath.
// Ask for portrait when a game opens. Only some browsers allow it (mostly
// Android, often only in full screen); everywhere else it quietly does
// nothing and the rotate hint covers it.
function tryPortrait() {
  try { const p = window.screen?.orientation?.lock?.("portrait"); if (p?.catch) p.catch(() => {}); } catch { /* not supported */ }
}
function unlockOrientation() {
  try { window.screen?.orientation?.unlock?.(); } catch { /* not supported */ }
}
const COMPACT_QUERY = "(max-width: 1149px), (max-height: 540px), (pointer: coarse) and (max-width: 1366px)";
function useCompact() {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(COMPACT_QUERY).matches;
  const [compact, setCompact] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(COMPACT_QUERY);
    if (!mq) return undefined;
    const on = () => setCompact(mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener("change", on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", on); else mq.removeListener(on); };
  }, []);
  return compact;
}

export default function LivePage() {
  const [params, setParams] = useSearchParams();
  const compact = useCompact();
  // My Teams / My Players live inside Customize now — old links land there.
  const rawView = params.get("view");
  const view = rawView === "teams" || rawView === "players" ? "customize" : rawView === "big" ? "feed" : rawView || (compact ? "feed" : "all");
  const gameParam = params.get("game");
  const [slate, setSlate] = useState(null);
  const [error, setError] = useState(false);
  const [followedTeams, setFollowedTeams] = useState(() => loadFollows(FOLLOW_TEAMS_KEY));
  const [followedPlayers, setFollowedPlayers] = useState(() => loadFollows(FOLLOW_PLAYERS_KEY));
  const { user, login } = useAuth();
  const uid = user?.uid || null;
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const synced = useRef({ uid: null, json: null, ready: false });
  const now = useNow(15000);
  useWakeLock();
  useEffect(() => {
    const { paddingTop, backgroundColor } = document.body.style;
    document.body.style.paddingTop = "0";
    document.body.style.backgroundColor = "#0a0f1a";
    // A refresh starts at the top — the browser's own scroll restoration
    // would drop you mid-feed once the plays load in.
    const restoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    return () => {
      document.body.style.paddingTop = paddingTop;
      document.body.style.backgroundColor = backgroundColor;
      window.history.scrollRestoration = restoration;
    };
  }, []);

  useEffect(() => onSnapshot(
    doc(db, "liveSlate", "current"),
    (s) => { setSlate(s.exists() ? s.data() : { games: [], bigPlays: [] }); setError(false); },
    () => setError(true),
  ), []);

  const setView = (v, extra = {}) => setParams({ view: v, ...extra });
  const openGame = (id) => setView("game", { game: id });
  const toggleTeam = (id) => setFollowedTeams((prev) => {
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    if (!uidRef.current) saveFollows(FOLLOW_TEAMS_KEY, next);
    return next;
  });
  const togglePlayer = (a) => setFollowedPlayers((prev) => {
    const same = (p) => String(p.id) === String(a.id);
    const next = prev.some(same) ? prev.filter((p) => !same(p))
      : [...prev, { id: a.id, name: a.name, ...(a.teamId != null ? { teamId: a.teamId, team: a.team || null, position: a.position || null } : {}) }];
    if (!uidRef.current) saveFollows(FOLLOW_PLAYERS_KEY, next);
    return next;
  });
  // Players followed from a play card come without their team — look it up
  // once (cfbdPlayers), so "every play" can find their games.
  useEffect(() => {
    const missing = followedPlayers.filter((p) => p.teamId == null && !p.lookedUp);
    if (!missing.length) return undefined;
    let alive = true;
    Promise.all(missing.map((p) => getDoc(doc(db, "cfbdPlayers", String(p.id)))
      .then((snap) => [String(p.id), snap.exists() ? snap.data() : null]).catch(() => [String(p.id), null])))
      .then((rows) => {
        if (!alive) return;
        const info = new Map(rows);
        setFollowedPlayers((prev) => {
          const next = prev.map((p) => {
            if (!info.has(String(p.id))) return p;
            const d = info.get(String(p.id));
            return { ...p, lookedUp: true, ...(d ? { teamId: d.teamId ?? null, team: d.team || null, position: d.position || null } : {}) };
          });
          if (!uidRef.current) saveFollows(FOLLOW_PLAYERS_KEY, next);
          return next;
        });
      });
    return () => { alive = false; };
  }, [followedPlayers]);

  const games = useMemo(() => [...(slate?.games || [])].sort(sortGames), [slate]);
  const bigPlays = useMemo(() => slate?.bigPlays || [], [slate]);
  const liveCount = games.filter((g) => g.status === "in_progress").length;
  const updatedAgo = slate?.updatedAt?.toMillis ? Math.max(0, Math.round((now - slate.updatedAt.toMillis()) / 60000)) : null;

  const schools = useCfbdSchools(view === "customize");
  // A followed team's name and logo — from the school list, else the slate.
  const teamInfo = (id) => {
    const sc = schools.find((t) => t.id === id);
    if (sc) return { name: sc.name, logo: sc.logo };
    const g = games.find((x) => x.home.providerTeamId === id || x.away.providerTeamId === id);
    const t = g ? (g.home.providerTeamId === id ? g.home : g.away) : null;
    return { name: t ? (t.school || t.name) : `Team ${id}`, logo: t ? (t.logoDark || t.logo) : null };
  };
  const followedIds = useMemo(() => playerIdSet(followedPlayers), [followedPlayers]);

  // ── My Feed ──
  const [feedPrefs, setFeedPrefs] = useState(loadFeedPrefs);
  const updatePrefs = (next) => { setFeedPrefs(next); if (!uidRef.current) saveFeedPrefs(next); };

  // ── Account sync ──
  // Signed in: follows + Feed settings live on the account
  // (users/{uid}/liveSettings/main, owner-only) and follow you across
  // devices. The first sign-in keeps what you picked as a guest. Signed
  // out: this browser's copy, as before.
  useEffect(() => {
    synced.current = { uid, json: null, ready: false };
    if (!uid) {
      setFollowedTeams(loadFollows(FOLLOW_TEAMS_KEY));
      setFollowedPlayers(loadFollows(FOLLOW_PLAYERS_KEY));
      setFeedPrefs(loadFeedPrefs());
      return undefined;
    }
    const ref = doc(db, "users", uid, "liveSettings", "main");
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setDoc(ref, {
          teams: loadFollows(FOLLOW_TEAMS_KEY), players: loadFollows(FOLLOW_PLAYERS_KEY),
          feedPrefs: loadFeedPrefs(), updatedAt: serverTimestamp(),
        }).catch(() => { synced.current.ready = true; });
        return;
      }
      const d = snap.data();
      const next = { teams: d.teams || [], players: d.players || [], feedPrefs: normalizeFeedPrefs(d.feedPrefs) };
      synced.current = { uid, json: JSON.stringify(next), ready: true };
      setFollowedTeams(next.teams);
      setFollowedPlayers(next.players);
      setFeedPrefs(next.feedPrefs);
    }, () => { synced.current.ready = true; });
  }, [uid]);
  useEffect(() => {
    if (!uid || !synced.current.ready || synced.current.uid !== uid) return;
    const next = { teams: followedTeams, players: followedPlayers, feedPrefs };
    const json = JSON.stringify(next);
    if (json === synced.current.json) return;
    synced.current.json = json;
    setDoc(doc(db, "users", uid, "liveSettings", "main"), { ...next, updatedAt: serverTimestamp() }).catch(() => {});
  }, [uid, followedTeams, followedPlayers, feedPrefs]);
  const onFeed = view === "feed";
  const rankedIds = useRankedSixIds(onFeed || feedPrefs.strip === "mine" ? user?.uid : null, games.map((g) => g.wedraftWeek));
  const rankedGames = games.filter((g) => g.wedraftGameId && rankedIds.has(g.wedraftGameId));
  // Games the feed follows (unless "All games"): union of the checked sources.
  const feedGameIds = useMemo(() => {
    if (feedPrefs.games.all) return [];
    const ids = new Set();
    for (const g of games) {
      if (feedPrefs.games.wepick && g.wedraftGameId && rankedIds.has(g.wedraftGameId)) ids.add(g.id);
      if (feedPrefs.games.myTeams && (followedTeams.includes(g.home.providerTeamId) || followedTeams.includes(g.away.providerTeamId))) ids.add(g.id);
      if (feedPrefs.games.featured && (g.featured || g.gameOfWeek)) ids.add(g.id);
    }
    return [...ids];
  }, [feedPrefs, games, rankedIds, followedTeams]);
  // Each followed game's complete Feed list (liveGames/{id}.feedPlays).
  const feedDocs = useLiveGameDocs(onFeed ? feedGameIds : []);
  // "Every play" modes (Customize): the full play-by-play of followed
  // teams' games, and every play a followed player is in.
  const teamEvery = !feedPrefs.games.all && feedPrefs.games.myTeams && feedPrefs.teamPlays === "all";
  const playerEvery = feedPrefs.players && feedPrefs.playerPlays === "all" && followedPlayers.length > 0;
  const everyGameIds = useMemo(() => {
    const teamGame = (g) => followedTeams.includes(g.home.providerTeamId) || followedTeams.includes(g.away.providerTeamId);
    const playerTeams = new Set(followedPlayers.map((p) => p.teamId).filter((x) => x != null).map(String));
    const playerGame = (g) => playerTeams.has(String(g.home.providerTeamId)) || playerTeams.has(String(g.away.providerTeamId));
    return games
      .filter((g) => (g.status === "in_progress" || g.status === "final") && ((teamEvery && teamGame(g)) || (playerEvery && playerGame(g))))
      .sort((a, b) => (a.status === "in_progress" ? 0 : 1) - (b.status === "in_progress" ? 0 : 1))
      .map((g) => g.id);
  }, [games, followedTeams, followedPlayers, teamEvery, playerEvery]);
  const everyPlays = useGamePlays(onFeed ? everyGameIds : []);
  // Nothing to follow yet → the whole slate's Feed, with a nudge to follow.
  const followsNothing = !feedPrefs.games.all && !feedGameIds.length && !(feedPrefs.players && followedPlayers.length);
  const myFeed = useMemo(() => {
    const typeOn = (b) => b.every || !b.kinds?.length || b.kinds.some((k) => feedPrefs.types[k]);
    if (followsNothing) return dedupeFeed(bigPlays.filter(typeOn));
    // Every-play entries first, so a play that's also a Feed big play keeps
    // the Feed's version (it carries the big-play kinds).
    const every = [];
    const gameById = new Map(games.map((g) => [g.id, g]));
    for (const [gid, plays] of everyPlays) {
      const g = gameById.get(gid);
      if (!g) continue;
      const wholeGame = teamEvery && (followedTeams.includes(g.home.providerTeamId) || followedTeams.includes(g.away.providerTeamId));
      for (const p of plays) {
        if (p.removed || EVERY_SKIP.has(p.presentation?.type)) continue;
        const item = feedItemFromPlay(gid, g, p);
        if (wholeGame || (playerEvery && item.athletes.some((a) => followedIds.has(a.id)))) every.push(item);
      }
    }
    // Followed games: each one's plays plus its FINAL entry once it ends.
    let items = feedPrefs.games.all ? bigPlays
      : [...feedDocs.values()].flatMap((d) => [...(d.feedPlays || []), ...(d.finalFeed ? [d.finalFeed] : [])]);
    if (!feedPrefs.games.all && feedPrefs.players) {
      items = items.concat(bigPlays.filter((b) => (b.athletes || []).some((a) => followedIds.has(a.id))));
    }
    const byKey = new Map([...every, ...items.filter(typeOn)].map((b) => [b.key, b]));
    return dedupeFeed([...byKey.values()].sort((a, b) => b.at - a.at));
  }, [feedPrefs, bigPlays, feedDocs, followedIds, followsNothing, everyPlays, games, teamEvery, playerEvery, followedTeams]);
  const feedMax = teamEvery || playerEvery ? 80 : 30;
  // Top scoreboard (Customize): every game, or just "my games" — followed
  // teams, followed players' teams, the We-Pick Ranked 6, and featured games
  // when the Feed includes them. Nothing of yours on → every game.
  const stripGames = useMemo(() => {
    if (feedPrefs.strip !== "mine") return games;
    const playerTeams = new Set(followedPlayers.map((p) => p.teamId).filter((x) => x != null).map(String));
    const mine = games.filter((g) => followedTeams.includes(g.home.providerTeamId) || followedTeams.includes(g.away.providerTeamId)
      || playerTeams.has(String(g.home.providerTeamId)) || playerTeams.has(String(g.away.providerTeamId))
      || (g.wedraftGameId && rankedIds.has(g.wedraftGameId))
      || (feedPrefs.games.featured && (g.featured || g.gameOfWeek)));
    return mine.length ? mine : games;
  }, [feedPrefs, games, followedTeams, followedPlayers, rankedIds]);
  // Left side of My Feed: the game picked from the feed, else the newest
  // feed item's game, else the first live game the feed follows.
  const feedGameId = gameParam
    || myFeed[0]?.gameId
    || games.find((g) => g.status === "in_progress" && (feedPrefs.games.all || feedGameIds.includes(g.id)))?.id
    || null;
  // Pin the first pick into the URL so the center game only changes when
  // the user picks one — not every time a new big play tops the feed.
  useEffect(() => {
    if (!compact && onFeed && !gameParam && feedGameId) setParams({ view: "feed", game: feedGameId }, { replace: true });
  }, [compact, onFeed, gameParam, feedGameId, setParams]);
  const focusPlay = onFeed ? params.get("play") : null;
  // A play id left in the URL from an older link is dropped on load, so
  // opening /live never jumps into the middle of a feed.
  useEffect(() => {
    if (params.get("play")) {
      const next = new URLSearchParams(params);
      next.delete("play");
      setParams(next, { replace: true });
    }
    // on first load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Clicking a Feed play opens its game at the top of the page (no jump to
  // the play itself); the Feed card stays highlighted as the pick.
  const [selectedFeedKey, setSelectedFeedKey] = useState(null);
  // Plays the open game's feed hasn't revealed yet — kept out of the Feed
  // rail until it has, so the rail never gets ahead of the game feed.
  const [queuedPlays, setQueuedPlays] = useState({ gameId: null, ids: [] });
  const onQueueChange = useCallback((gameId, ids) => setQueuedPlays({ gameId, ids }), []);
  const notYetShown = (p) => p.gameId === queuedPlays.gameId && queuedPlays.ids.includes(p.playId);
  const selectFeedPlay = (b) => {
    setSelectedFeedKey(b.key);
    setParams({ view: "feed", game: b.gameId });
    if (compact) tryPortrait();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tabs = [
    { key: "all", label: `All Games${liveCount ? ` · ${liveCount} live` : ""}` },
    { key: "feed", label: "My Feed" },
    { key: "customize", label: "⚙ Customize" },
    ...(view === "game" ? [{ key: "game", label: "Game" }] : []),
  ];

  // The right rail. On My Feed it's personalized (Customize) and clicking a
  // play loads it on the left; elsewhere it's the whole slate's Feed.
  const sourceSummary = feedPrefs.games.all ? "All games" : [
    feedPrefs.games.wepick && "We-Pick", feedPrefs.games.myTeams && "My teams", feedPrefs.games.featured && "Featured",
    feedPrefs.players && followedPlayers.length > 0 && "My players",
  ].filter(Boolean).join(" · ") || "Nothing selected";
  const feedRail = onFeed ? (
    <aside className="wdl-rail">
      <div className="wdl-railhead">
        <div className="wdl-h" style={{ margin: 0 }}>Feed <span className="wdl-railsub">{sourceSummary}</span></div>
        <button className="wdl-iconbtn" onClick={() => setView("customize")}>⚙ Customize</button>
      </div>
      {followsNothing && !compact && (
        <div className="wdl-feed-nudge">Showing the whole slate. <button onClick={() => setView("customize")}>Follow teams and players</button> to make this your Feed.</div>
      )}
      {myFeed.length
        ? <div className="wdl-feedcols"><FeedList items={myFeed.filter((p) => !notYetShown(p)).slice(0, feedMax)} render={(p) => (
          <BigPlayItem play={p} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer}
            onSelect={selectFeedPlay} selected={p.key === selectedFeedKey && p.gameId === feedGameId} />
        )} /></div>
        : <div className="wdl-empty">{feedPrefs.games.all || feedGameIds.length
          ? "Scoring plays, turnovers and big gains from your games show up here."
          : "Pick games for your feed with ⚙ Customize — your We-Pick games, teams you follow, or featured games."}</div>}
    </aside>
  ) : (
    <aside className="wdl-rail">
      <div className="wdl-h">Feed</div>
      {bigPlays.length
        ? <FeedList items={bigPlays.filter((p) => !notYetShown(p)).slice(0, 12)} render={(p) => <BigPlayItem play={p} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer} onOpenGame={openGame} />} />
        : <div className="wdl-empty">Touchdowns, turnovers and explosive plays from across the slate show up here.</div>}
    </aside>
  );

  const grid = (list, empty) => (list.length
    ? <div className="wdl-grid">{list.map((g) => <GameTile key={g.id} game={g} followedTeams={followedTeams} onToggleTeam={toggleTeam} onOpen={openGame} />)}</div>
    : <div className="wdl-empty">{empty}</div>);

  let body;
  if (!slate) body = <div className="wdl-empty">{error ? "We-Draft Live is temporarily unavailable." : "Loading the slate…"}</div>;
  else if (view === "game" && gameParam) body = <GameView gameId={gameParam} slateGame={games.find((g) => g.id === gameParam)} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer} onQueueChange={onQueueChange} />;
  else if (compact && (view === "game" || onFeed) && gameParam) body = (
    <div className="wdl-solo">
      <button className="wdl-back" onClick={() => { unlockOrientation(); setParams({ view: "feed" }); window.scrollTo(0, 0); }}>← Feed</button>
      <div className="wdl-rotate"><b>↻</b> Turn your device upright for the full game view</div>
      <GameView key={gameParam} gameId={gameParam} slateGame={games.find((g) => g.id === gameParam)} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer} onQueueChange={onQueueChange} />
    </div>
  );
  else if (compact && onFeed) body = feedRail;
  else if (onFeed) body = feedGameId
    ? <GameView key={feedGameId} gameId={feedGameId} slateGame={games.find((g) => g.id === feedGameId)} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer} focusPlayId={focusPlay} onQueueChange={onQueueChange} />
    : <div className="wdl-empty">Your feed's games will play out here. Use ⚙ Customize on the right to choose them.</div>;
  else if (view === "customize") body = (
    <div className="wdl-custpage">
      <div className="wdl-h">Customize your Feed</div>
      <div className="wdl-follow-sec">
        <div className="wdl-cust-h">Teams I follow</div>
        <TeamSearch schools={schools} followed={followedTeams} onToggle={toggleTeam} />
        {followedTeams.length > 0 ? (
          <div className="wdl-athletes">
            {followedTeams.map((id) => {
              const t = teamInfo(id);
              return (
                <button key={id} className="wdl-ath on wdl-chip" onClick={() => toggleTeam(id)} title="Unfollow">
                  {t.logo && <img src={t.logo} alt="" />}★ {t.name} ✕
                </button>
              );
            })}
          </div>
        ) : <div className="wdl-cust-sub">None yet — search above, or tap ★ next to a team in All Games.</div>}
      </div>
      <div className="wdl-follow-sec">
        <div className="wdl-cust-h">Players I follow</div>
        <PlayerSearch followedIds={followedIds} onToggle={togglePlayer} />
        {followedPlayers.length > 0 ? (
          <div className="wdl-athletes">
            {followedPlayers.map((p) => (
              <button key={p.id} className="wdl-ath on" onClick={() => togglePlayer(p)} title="Unfollow">
                ★ {p.name}{p.team && <span className="wdl-chip-sub"> {[p.position, p.team].filter(Boolean).join(" · ")}</span>} ✕
              </button>
            ))}
          </div>
        ) : <div className="wdl-cust-sub">None yet — search above, or tap + next to a player in any play.</div>}
      </div>
      <FeedCustomize prefs={feedPrefs} onChange={updatePrefs} onClose={() => setView("feed")}
        signedIn={!!user} rankedCount={rankedGames.length} teamCount={followedTeams.length} playerCount={followedPlayers.length} />
    </div>
  );
  else body = (
    <div>
      <div className="wdl-h">{slate.week ? `Week ${slate.week}` : "This week"} · {games.length} games</div>
      {grid(games, "No games on the slate right now.")}
    </div>
  );

  const split = !compact && (view === "all" || view === "game" || onFeed);

  return (
    <div className={`wdl${compact ? " wdl-compact" : ""}`}>
      <Helmet>
        <title>We-Draft Live — College Football Scores, Plays & Big Plays</title>
        <meta name="description" content="Live college football scores, play-by-play and big plays across the FBS slate — a second screen for Saturdays from We-Draft." />
      </Helmet>
      <style>{STYLE}</style>
      <header className="wdl-top">
        <Link to="/" className="wdl-brand" aria-label="We-Draft.com home"><img src={Logo2} alt="We-Draft.com" /><span>LIVE</span></Link>
        <nav className="wdl-tabs">
          {tabs.map((t) => (
            <button key={t.key} className={`wdl-tab${view === t.key ? " on" : ""}`} onClick={() => (t.key === "game" ? null : setView(t.key))}>{t.label}</button>
          ))}
        </nav>
        <div className="wdl-meta">
          {updatedAgo != null && <span>Updated {updatedAgo === 0 ? "just now" : `${updatedAgo}m ago`}</span>}
          <button className="wdl-iconbtn" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {})}>⛶ Full screen</button>
        </div>
        {user
          ? <span className="wdl-auth on" title="Your follows and Feed settings are saved to your account">✓ Signed in</span>
          : <button className="wdl-auth" onClick={login} title="Log in to save your teams, players and Feed to your account">Log in</button>}
      </header>
      <AuthModal />
      {slate && view !== "all" && (
        <ScoreStrip games={stripGames} current={onFeed && !compact ? feedGameId : gameParam}
          onPick={(id) => { if (onFeed) setParams({ view: "feed", game: id }); else openGame(id); if (compact) { tryPortrait(); window.scrollTo(0, 0); } }} />
      )}
      <main className={`wdl-main${split ? " split" : ""}${onFeed ? " feed" : ""}${compact ? " compact" : ""}`}>
        <section>{body}</section>
        {split && slate && feedRail}
      </main>
    </div>
  );
}
