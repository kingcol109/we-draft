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
// Views: All Games · My Feed · Top Performances (Last Week during preview) · Customize · Game.
// My Feed = a game's play-by-play (left) + a personalized Feed (right,
// ⚙ Customize: We-Pick Ranked 6 / my teams / featured / followed players,
// and play types). Follows are
// per-browser (src/utils/live.js) and keyed by provider ids, so they work
// for every team/player, with or without a We-Draft profile.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { wePickHref, isWePickPath } from "../utils/wePickRoutes";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import { useFbsTeamStats, fmtTeamStat } from "../utils/fbsTeamStats";
import { syncProfileFollow } from "../utils/liveFollowSync";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { useLiveGame, useLiveStats } from "../hooks/useLiveGame";
import { LEADER_CATS, statLine } from "../utils/liveStats";
import { communityFor, gradeLabel } from "../utils/communityGrades";
import { fetchCurrentRankMap } from "../utils/rankings";
import { isPickable, mondayOfWeekUtc, toMs } from "../utils/wePickLocks";
import { summarizePicks, pickView, pickPublic, listedPick } from "../utils/wePickSummary";
import { pickedSideOf, isGameFinal, hasScorePick, scoreGamePick, compareStandingsEntries } from "../utils/wePickScoring";
import { hasRankedRoom, loadWeekRanked, swapRanked, RANKED_SIZE } from "../utils/wePickRanked";
import RankedSwap from "../components/RankedSwap";
import { useLiveGameDocs, useRankedSixIds, useGamePlays, useCfbdSchools, searchCfbdPlayers } from "../hooks/useLiveFeed";
import { useGameFeed } from "../hooks/useGameFeed";
import { useInsightReveal, useDevInsights } from "../hooks/useInsightReveal";
import { useAuth } from "../context/AuthContext";
import AuthModal from "../components/AuthModal";
import Logo2 from "../assets/Logo2.png";
import LivePlayCard, { PLAY_CARD_STYLE, PendingPlayCard, TwoPointCard, FinalCard, playSummary } from "../components/LivePlayCard";
import LiveInsightCard, { INSIGHT_CARD_STYLE } from "../components/LiveInsightCard";
import LiveBreakCard, { BREAK_CARD_STYLE, TimeoutTip, pickTimeoutTip } from "../components/LiveBreakCard";
import confetti from "canvas-confetti";
import LiveGameStats, { LIVE_STATS_STYLE } from "../components/LiveGameStats";
import LivePerformances, { PERF_STYLE, performancesFromGames } from "../components/LivePerformances";
import LiveChat, { LIVE_CHAT_STYLE } from "../components/LiveChat";
import VerifiedNameBadge from "../components/VerifiedNameBadge";
import LiveField, { LIVE_FIELD_STYLE } from "../components/LiveField";
import TeamRoster from "../components/TeamRoster";
import { briefPlay } from "../utils/briefPlay";
import HeaderTakeover, { TAKEOVER_STYLE, TAKEOVER_POINTS } from "../components/HeaderTakeover";
import ScoresWidget, { SCORES_WIDGET_STYLE, openPipWindow } from "../components/ScoresWidget";
import {
  statusLabel, teamShort, teamName, timeoutSide, slatePhase, kickoffLabel, myFeedWindow, clutchHeat, clockSecs, dedupeFeed,
  FOLLOW_TEAMS_KEY, FOLLOW_PLAYERS_KEY, loadFollows,
  loadFeedPrefs, normalizeFeedPrefs, DEFAULT_FEED_PREFS, playerIdSet, feedItemFromPlay, isCloseLatePlay,
  slateWeekKey, normalizeWeek, loadWeekFollows, weekTeams, weekPlayers, toggleWeekTeam, toggleWeekPlayer,
  scrollActiveTabIntoView, liveGameHref, distinctTeamColors,
} from "../utils/live";

// We-Pick (predictions, Ranked 6, standings, stats, friends) is a /live tab
// — loaded only when opened.
const WePickHub = lazy(() => import("./WePickHub"));

const GOLD = "#f6a21d";
// No new play and no clock movement this long → a stoppage (GameView).
const LIVE_RED = "#ff4d4d";

// Bebas Neue — the scoreboard's athletic display face (team names).
// @import has to lead the stylesheet.
const STYLE = `@import url("https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap");
${PLAY_CARD_STYLE}${INSIGHT_CARD_STYLE}${BREAK_CARD_STYLE}${LIVE_STATS_STYLE}${PERF_STYLE}${LIVE_CHAT_STYLE}${LIVE_FIELD_STYLE}${TAKEOVER_STYLE}${SCORES_WIDGET_STYLE}
.wdl-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.wdl-gtabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 14px; }
/* phones: every tab (Chat included) stays on screen — they wrap, smaller */
@media (max-width: 640px) { .wdl-gtabs { gap: 6px; } .wdl-gtab { padding: 6px 11px; font-size: 11px; letter-spacing: 0.04em; } }
.wdl-gtab { background: transparent; color: #9fb0c8; border: 1px solid #26324a; border-radius: 999px; padding: 7px 18px; font-weight: 900; font-size: clamp(13px, 1vw, 15px); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
.wdl-gtab.on { background: #eef2f8; color: #0a0f1a; border-color: #eef2f8; }
/* pop out the live play-by-play (desktop only), at the tabs' right end */
.wdl-gtab-pop { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; background: transparent; color: #9fb0c8; border: 1px solid #26324a; border-radius: 999px;
  padding: 7px 14px; font-weight: 900; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; font-family: inherit; white-space: nowrap; }
.wdl-gtab-pop:hover { color: #fff; border-color: ${GOLD}; }
.wdl-gtab-pop.on { color: ${GOLD}; border-color: ${GOLD}; }
.wdl-gtab-pop svg { width: 15px; height: 15px; display: block; }
/* the play-by-play pop-out window: scoreboard pinned on top, the log scrolls */
.wdl-logwin { min-height: calc(100vh / var(--pz, 1)); background: #0a0f1a; }
.wdl-logwin-board { position: sticky; top: 0; z-index: 10; background: #0a0f1a; }
.wdl-logwin-board .wdl-mu { border: 0; border-radius: 0; }
.wdl-logwin-plays { padding: 12px 10px 20px; }
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
.wdl-strip-team { flex: 1; white-space: nowrap; text-transform: uppercase; }
.wdl-strip-rank { color: #8193ad; font-size: 10px; font-weight: 800; margin-right: 4px; }
.wdl-strip-row b { font-size: 16px; font-weight: 900; font-variant-numeric: tabular-nums; animation: wdl-flash 1.6s ease-out; }
.wdl-strip-row.lose { opacity: 0.4; }
.wdl-strip-row.lose b { font-weight: 700; }
.wdl-strip-status { font-size: 11px; font-weight: 900; color: #9fb0c8; font-variant-numeric: tabular-nums; }
.wdl-strip-game.live .wdl-strip-status { color: ${LIVE_RED}; }
.wdl-strip-tv { margin-left: 6px; color: #9fb0c8; font-weight: 800; }
.wdl-strip-status { display: flex; align-items: center; }
.wdl-strip-tag { margin-left: auto; padding-left: 8px; font-size: 9px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb0c8; }
/* Same tag colors as We-Pick's game rows (WePickHub.js RowTag): purple
   Game of the Week, gold Featured. */
.wdl-strip-pill { display: inline-block; padding: 1px 6px; border-radius: 4px; color: #fff; font-size: 9px; font-weight: 900; letter-spacing: 0.08em; line-height: 1.5; text-transform: uppercase; vertical-align: middle; }
.wdl-strip-pill.gotw { background: #7c3aed; }
/* pop-out scores button, pinned to the strip's right end */
.wdl-strip-pop { position: sticky; right: 0; flex-shrink: 0; align-self: center; width: 38px; height: 38px; padding: 9px; margin-left: auto; border-radius: 10px; cursor: pointer;
  background: #111a2b; border: 1px solid #26324a; color: #9fb0c8; box-shadow: -14px 0 14px #0c1220; }
.wdl-strip-pop:hover { color: #fff; border-color: ${GOLD}; }
.wdl-strip-pop.on { color: ${GOLD}; border-color: ${GOLD}; }
.wdl-strip-pop svg { width: 100%; height: 100%; display: block; }
/* All Games: the same, as a labeled button */
.wdl-sw-row { display: flex; justify-content: flex-end; padding: 10px clamp(16px, 2.4vw, 36px) 0; }
.wdl-sw-btn { display: inline-flex; align-items: center; gap: 7px; background: #111a2b; border: 1px solid #26324a; color: #c9d5e6; border-radius: 999px; padding: 6px 13px;
  font: inherit; font-weight: 800; font-size: 13px; cursor: pointer; }
.wdl-sw-btn svg { width: 16px; height: 16px; }
.wdl-sw-btn:hover { border-color: ${GOLD}; color: #fff; }
.wdl-sw-btn.on { border-color: ${GOLD}; color: ${GOLD}; }
/* its chooser */
.wdl-swp { position: absolute; right: clamp(16px, 2.4vw, 36px); z-index: 60; width: 340px; margin-top: 6px; background: #0e1625; border: 1px solid #26324a; border-radius: 14px; padding: 12px;
  box-shadow: 0 16px 40px rgba(0,0,0,0.55); display: flex; flex-direction: column; gap: 10px; }
.wdl-swp-h { display: flex; align-items: center; justify-content: space-between; font-weight: 900; font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: #eef2f8; }
.wdl-swp-h button { background: none; border: 0; color: #8193ad; font-size: 15px; cursor: pointer; }
.wdl-swp .wdl-seg { align-self: flex-start; margin: 0; }
.wdl-swp-list { max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; scrollbar-width: thin; }
.wdl-swp-list label { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; font-weight: 800; font-size: 13px; color: #c9d5e6; }
.wdl-swp-list label:hover { background: #16213a; }
.wdl-swp-list label.on { color: #fff; }
.wdl-swp-list input { accent-color: ${GOLD}; }
.wdl-swp-list .m { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; }
.wdl-swp-list .m small { color: #8193ad; font-size: 10px; margin-right: 3px; }
.wdl-swp-list .s { font-size: 11px; color: #6f819c; white-space: nowrap; }
.wdl-swp-list .s.live { color: ${LIVE_RED}; }
.wdl-swp-go { background: ${GOLD}; color: #121212; border: 0; border-radius: 999px; padding: 9px 14px; font-weight: 900; font-size: 13px; cursor: pointer; font-family: inherit; }
.wdl-swp-go:disabled { opacity: 0.45; cursor: default; }
.wdl-strip-pill.feat { background: ${GOLD}; }
.wdl-strip-game.gotw { border-color: rgba(124,58,237,0.7); }
.wdl-rec { color: #6f819c; font-size: 0.68em; font-weight: 800; margin-left: 8px; font-variant-numeric: tabular-nums; }
.wdl-mu-rec { position: relative; margin-top: -4px; font-weight: 800; font-size: clamp(12px, 1vw, 15px); color: rgba(255,255,255,0.75); font-variant-numeric: tabular-nums; text-shadow: 0 1px 4px rgba(0,0,0,0.5); }
.wdl-mu-tv { font-weight: 800; font-size: clamp(12px, 0.95vw, 15px); color: rgba(255,255,255,0.85); background: rgba(10,15,26,0.5); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 3px 10px; white-space: nowrap; }
.wdl-strip-status .wdl-dot { width: 6px; height: 6px; margin-right: 5px; }
.wdl-rail-item { overflow: hidden; }
.wdl-rail-new { animation: wdl-rail-in 0.9s ease-out; }
@keyframes wdl-rail-in { 0% { max-height: 0; opacity: 0; transform: translateY(-14px); } 60% { opacity: 1; } 100% { max-height: 420px; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wdl-rail-new { animation: none; } }
.wdl-slot { position: relative; }
.wdl-slot-swap { animation: wdl-swap 0.45s ease-out; }
@keyframes wdl-swap { 0% { opacity: 0; transform: scale(0.985); } 100% { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wdl-slot-swap { animation: none; } }
@media (min-width: 1150px) { .wdl-rail { position: sticky; top: 84px; max-height: calc(100vh / var(--pz, 1) - 100px); overflow-y: auto; padding-right: 4px; } }
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
.wdl { min-height: calc(100vh / var(--pz, 1)); background: #0a0f1a; color: #eef2f8; font-family: "Inter", "Segoe UI", Arial, sans-serif; }
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
.wdl-wp { max-width: 1280px; margin: 0 auto; }
/* Reviewed (final) games: drive summary + recap cards, styled as play cards (.lpc). */
.wdl-drive { cursor: pointer; padding: 12px 16px; border-left-color: var(--tc, #2a3753); }
.wdl-drive:hover { border-color: #3a4a6a; border-left-color: var(--tc, #2a3753); }
.wdl-drive-top { display: flex; align-items: center; gap: 12px; }
.wdl-drive-team { display: inline-flex; align-items: center; gap: 8px; font-weight: 900; font-size: 15px; color: #eef2f8; text-transform: uppercase; min-width: 0; }
.wdl-drive-team img { width: 26px; height: 26px; object-fit: contain; }
.wdl-drive-res { font-weight: 900; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; background: #1d2840; color: #9fb0c8; white-space: nowrap; }
.wdl-drive-res.td { background: ${GOLD}; color: #121212; }
.wdl-drive-res.fg { background: #3ecf8e; color: #0a0f1a; }
.wdl-drive-res.to { background: #ff4d4d; color: #fff; }
.wdl-drive-score { margin-left: auto; font-weight: 900; font-size: 15px; color: #eef2f8; font-variant-numeric: tabular-nums; white-space: nowrap; }
.wdl-drive-meta { margin-top: 6px; display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; font-weight: 800; color: #9fb0c8; font-variant-numeric: tabular-nums; }
.wdl-drive-meta span b { color: #eef2f8; }
.wdl-drive-caret { color: #6f819c; font-size: 12px; margin-left: 6px; }
.wdl-drive-plays { margin: -4px 0 14px clamp(10px, 2vw, 26px); padding-left: 12px; border-left: 2px dashed #26324a; }
.wdl-drive-q { font-size: 12px; font-weight: 900; letter-spacing: 0.14em; color: #6f819c; text-transform: uppercase; margin: 14px 0 8px; }
.wdl-recap .lpc { --hc: var(--tc, #2a3753); }
.wdl-recap-name { font-weight: 900; font-size: clamp(18px, 1.5vw, 24px); color: #fff; text-decoration: none; }
.wdl-recap-lines { margin-top: 6px; display: grid; gap: 3px; }
.wdl-recap-lines div { font-weight: 900; font-size: 15px; color: #eef2f8; font-variant-numeric: tabular-nums; }
.wdl-recap-lines div span { display: inline-block; width: 46px; font-size: 11px; letter-spacing: 0.1em; color: #6f819c; }
.wdl-recap-big { font-weight: 900; font-size: clamp(18px, 1.5vw, 24px); color: #fff; font-variant-numeric: tabular-nums; }
.wdl-recap-big small { font-size: 12px; color: #9fb0c8; letter-spacing: 0.08em; margin-right: 8px; text-transform: uppercase; }
.wdl-recap-bar { margin-top: 10px; height: 8px; border-radius: 999px; background: #26324a; overflow: hidden; }
.wdl-recap-bar i { display: block; height: 100%; background: var(--tc, ${GOLD}); }
.wdl-recap-sub { margin-top: 6px; font-size: 13px; font-weight: 800; color: #9fb0c8; }
.wdl-recap-inline { margin-bottom: 16px; }
.wdl-weeknav { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; }
.wdl-weeknav span { font-weight: 900; font-size: clamp(16px, 1.3vw, 20px); letter-spacing: 0.06em; text-transform: uppercase; color: #fff; min-width: 92px; text-align: center; }
.wdl-weeknav button { background: #111a2b; border: 1px solid #26324a; color: #eef2f8; border-radius: 999px; width: 34px; height: 34px; font-size: 20px; font-weight: 900; line-height: 1; cursor: pointer; font-family: inherit; }
.wdl-weeknav button:disabled { opacity: 0.3; cursor: default; }
.wdl-weeknav button.now { width: auto; padding: 0 14px; font-size: 13px; background: ${GOLD}; color: #121212; border-color: ${GOLD}; }
.wdl-mu-above { display: flex; gap: 8px; margin-bottom: 10px; }
/* a game's roster tab: the team page's roster card */
.wdl-roster { border-radius: 12px; overflow: hidden; }
/* pop-out icon, bottom-right of the scoreboard (desktop only) */
.wdl-mu-popicon { position: absolute; right: 10px; bottom: 10px; z-index: 5; width: 30px; height: 30px; padding: 6px; border-radius: 8px; cursor: pointer;
  background: rgba(10,15,26,0.45); border: 1px solid rgba(255,255,255,0.22); color: rgba(255,255,255,0.75); transition: color 0.15s, border-color 0.15s, background 0.15s; }
.wdl-mu-popicon:hover { color: #fff; border-color: ${GOLD}; background: rgba(10,15,26,0.7); }
.wdl-mu-popicon.on { color: ${GOLD}; border-color: ${GOLD}; }
.wdl-mu-popicon svg { width: 100%; height: 100%; display: block; }
/* "rotate your phone" — only in portrait, in full screen */
.wdl-mu-rotate { display: none; position: absolute; left: 50%; bottom: max(22px, calc(env(safe-area-inset-bottom) + 10px)); transform: translateX(-50%); z-index: 4;
  align-items: center; gap: 8px; white-space: nowrap; padding: 8px 14px; border-radius: 999px; background: rgba(6,10,18,0.7); border: 1px solid rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.85); font-weight: 800; font-size: 13px; }
.wdl-mu-rotate svg { width: 20px; height: 20px; animation: wdl-rotate-hint 2.4s ease-in-out infinite; }
@keyframes wdl-rotate-hint { 0%, 30% { transform: rotate(0); } 55%, 85% { transform: rotate(-90deg); } 100% { transform: rotate(0); } }
@media (orientation: portrait) { .wdl-mu.full .wdl-mu-rotate { display: flex; } }
/* full-screen scoreboard (phones / tablets) — the ✕ moves to the top corner */
.wdl-mu.full { position: fixed; inset: 0; z-index: 10050; margin: 0; border: 0; border-radius: 0; min-height: calc(100vh / var(--pz, 1)); min-height: calc(100dvh / var(--pz, 1)); align-content: center;
  padding-top: max(14px, env(safe-area-inset-top)); padding-bottom: max(14px, env(safe-area-inset-bottom)); }
.wdl-mu.full .wdl-mu-popicon.close { top: max(10px, env(safe-area-inset-top)); bottom: auto; width: 36px; height: 36px; padding: 8px; }
/* the pop-out widget window: the scoreboard fills it, flush to the top */
.wdl-widget { min-height: calc(100vh / var(--pz, 1)); background: #0a0f1a; }
.wdl-widget .wdl-mu { min-height: calc(100vh / var(--pz, 1)); box-sizing: border-box; border: 0; border-radius: 0; padding-top: 6px; align-content: start; }
/* the latest play — the board's last row */
.wdl-mu-play { grid-column: 1 / -1; position: relative; z-index: 1; margin-top: 2px; padding: 8px 12px; border-radius: 10px; text-align: center;
  background: rgba(6,10,18,0.55); border: 1px solid rgba(255,255,255,0.12); font-weight: 800; font-size: 14px; line-height: 1.35; color: #eef2f8;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5); animation: wdl-wplay-in 0.45s ease-out; }
@keyframes wdl-wplay-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.wdl-mu-week { margin-top: 0; background: rgba(10,15,26,0.5); border: 1px solid rgba(255,255,255,0.25); color: #fff; border-radius: 999px; padding: 4px 12px; font-weight: 900; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; font-family: inherit; }
.wdl-mu-week:hover { border-color: ${GOLD}; }
.wdl-share { position: relative; margin-left: auto; }
.wdl-share-btn { display: inline-flex; align-items: center; gap: 6px; }
.wdl-share-btn svg { width: 14px; height: 14px; }
.wdl-share-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; min-width: 160px; display: flex; flex-direction: column; padding: 6px;
  background: #0c1220; border: 1px solid #3a4a6a; border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
.wdl-share-menu a, .wdl-share-menu button { display: block; text-align: left; padding: 9px 12px; border-radius: 8px; color: #eef2f8; font: inherit; font-weight: 800; font-size: 14px;
  text-decoration: none; background: none; border: 0; cursor: pointer; }
.wdl-share-menu a:hover, .wdl-share-menu button:hover { background: #1d2840; }
/* Upcoming games: Preview (tale of the tape, prospects) + We-Pick card. */
.wdl-pv-sec { margin-bottom: 22px; }
.wdl-tape { background: #111a2b; border: 1px solid #1d2840; border-radius: 14px; overflow: hidden; }
.wdl-tape-head, .wdl-tape-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 10px 16px; }
.wdl-tape-head { background: #0c1220; border-bottom: 1px solid #1d2840; font-weight: 900; text-transform: uppercase; color: #fff; }
.wdl-tape-head .t { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wdl-tape-head .t.home { justify-content: flex-end; }
.wdl-tape-head img { width: 28px; height: 28px; object-fit: contain; }
.wdl-tape-row { border-top: 1px solid #1a2438; }
.wdl-tape-row:first-of-type { border-top: 0; }
.wdl-tape-row .v { font-weight: 900; font-size: clamp(18px, 1.5vw, 22px); line-height: 1.15; color: #eef2f8; font-variant-numeric: tabular-nums; min-width: 0; }
.wdl-tape-row .v.home { text-align: right; }
.wdl-tape-row .v small { display: block; margin-top: 2px; font-size: 12px; letter-spacing: 0.02em; font-weight: 700; color: #9fb0c8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wdl-tape-row .v.edge { color: ${GOLD}; }
.wdl-tape-row .v .u { font-size: 12px; font-weight: 800; color: #9fb0c8; text-transform: uppercase; letter-spacing: 0.04em; }
.wdl-tape-row .v .nm { display: block; font-size: clamp(16px, 1.25vw, 19px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wdl-tape-row .v .nm a { color: inherit; text-decoration: none; }
.wdl-tape-row .v .nm a:hover { color: ${GOLD}; }
.wdl-tape-row .v small.stat { font-size: 14px; font-weight: 900; color: #eef2f8; text-transform: uppercase; letter-spacing: 0.03em; }
.wdl-tape-row .v small.sub { margin-top: 0; font-size: 11px; color: #6f819c; }
.wdl-tape-row .k { font-size: clamp(12px, 1vw, 14px); font-weight: 900; letter-spacing: 0.05em; line-height: 1.2; text-transform: uppercase; color: #c3cfe0; text-align: center; max-width: 150px; }
@media (max-width: 520px) { .wdl-tape-row .k { max-width: 108px; } }
.wdl-pros-cols { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); }
.wdl-pros-team { display: flex; align-items: center; gap: 8px; font-weight: 900; font-size: 14px; text-transform: uppercase; color: #fff; margin-bottom: 8px; }
.wdl-pros-team img { width: 24px; height: 24px; object-fit: contain; }
.wdl-pro { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; background: #111a2b; border: 1px solid #1d2840; border-left: 4px solid var(--tc, #2a3753); border-radius: 10px; padding: 9px 12px; margin-bottom: 8px; text-decoration: none; }
.wdl-pro:hover { border-color: #3a4a6a; border-left-color: var(--tc, #2a3753); }
.wdl-pro .n { font-weight: 900; font-size: 15px; color: #fff; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wdl-pro .n small { margin-left: 6px; font-size: 11px; color: #8193ad; font-weight: 800; }
.wdl-pro .g { grid-row: 1 / span 2; grid-column: 2; align-self: center; text-align: right; font-size: 11px; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; color: ${GOLD}; }
.wdl-pro .g span { display: block; color: #e8a317; letter-spacing: 1px; }
.wdl-pro .l { font-size: 12px; font-weight: 800; color: #9fb0c8; font-variant-numeric: tabular-nums; }
.wdl-pro-traits { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 5px; }
.wdl-pro-traits span { font-size: 11px; font-weight: 800; padding: 2px 7px; border-radius: 999px; }
.wdl-pro-traits .up { color: #7ee2a8; background: rgba(62,207,142,0.12); }
.wdl-pro-traits .dn { color: #ff9a9a; background: rgba(255,77,77,0.12); }
.wdl-picklist { margin-top: 14px; border-top: 1px solid #1d2840; padding-top: 10px; }
.wdl-picklist-h { font-size: 11px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #6f819c; margin-bottom: 6px; }
.wdl-picklist-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 7px 0; border-bottom: 1px solid #1a2438; }
.wdl-picklist-row.me .who { color: ${GOLD}; }
.wdl-picklist-row .who { font-weight: 800; font-size: 13px; color: #dfe6f0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wdl-picklist-row .pk { display: inline-flex; align-items: center; gap: 6px; font-weight: 900; font-size: 14px; color: #fff; font-variant-numeric: tabular-nums; }
.wdl-picklist-row .pk img { width: 18px; height: 18px; object-fit: contain; }
.wdl-picklist-row .txt { grid-column: 1 / -1; font-size: 12px; font-weight: 600; color: #9fb0c8; font-style: italic; }
.wdl-picklist-more { margin-top: 8px; width: 100%; background: none; border: 1px solid #26324a; color: #9fb0c8; border-radius: 8px; padding: 6px; font-weight: 800; font-size: 12px; cursor: pointer; font-family: inherit; }
.wdl-pick-form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.wdl-pick-row { display: flex; align-items: center; gap: 10px; font-weight: 900; color: #eef2f8; text-transform: uppercase; }
.wdl-pick-row img { width: 26px; height: 26px; object-fit: contain; }
.wdl-pick-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wdl-pick-row input::-webkit-outer-spin-button, .wdl-pick-row input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.wdl-pick-row input { -moz-appearance: textfield; appearance: textfield; width: 64px; text-align: center; font: inherit; font-size: 20px; font-weight: 900; color: #fff; background: #0c1220; border: 1px solid #2a3753; border-radius: 8px; padding: 6px; outline: none; }
.wdl-pick-row input:focus { border-color: ${GOLD}; }
.wdl-pick-save { margin-top: 4px; background: ${GOLD}; color: #121212; border: 0; border-radius: 10px; padding: 9px; font-weight: 900; font-size: 14px; cursor: pointer; font-family: inherit; }
.wdl-pick-save:disabled { opacity: 0.6; cursor: default; }
.wdl-rk { display: inline-block; font-size: 10px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 7px; border-radius: 5px; background: #26324a; color: #c9d5e6; vertical-align: 1px; }
.wdl-rk.on { background: rgba(246,162,29,0.18); color: ${GOLD}; }
.wdl-rank-it { background: none; border: 0; padding: 0; color: ${GOLD}; font: inherit; font-weight: 900; cursor: pointer; }
.wdl-rank-it:disabled { opacity: 0.6; cursor: default; }
.wdl-pick-split { display: flex; height: 10px; border-radius: 999px; overflow: hidden; margin-top: 10px; background: #26324a; }
/* The Community Pick block on the We-Pick card */
.wdl-cp { margin-top: 14px; padding: 12px 12px 10px; border-radius: 12px; background: linear-gradient(160deg, rgba(124,58,237,0.22), rgba(17,26,43,0.9) 70%); border: 1px solid rgba(124,58,237,0.55); }
.wdl-cp-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.wdl-cp-h span { font-size: 12px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #c4b5fd; }
.wdl-cp-h small { font-size: 11px; font-weight: 800; color: #8193ad; }
.wdl-cp-board { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; }
.wdl-cp-team { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; transition: opacity 0.2s; }
.wdl-cp-team img { width: 38px; height: 38px; object-fit: contain; }
.wdl-cp-team .nm { font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; color: #eef2f8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.wdl-cp-team.dog { opacity: 0.6; }
.wdl-cp-team.fav .nm { color: ${GOLD}; }
.wdl-cp-score { display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.wdl-cp-score b { font-size: 34px; font-weight: 900; line-height: 1; color: #c9d5e6; }
.wdl-cp-score b.fav { color: #fff; text-shadow: 0 0 14px rgba(246,162,29,0.45); }
.wdl-cp-score span { font-size: 20px; font-weight: 900; color: #6f819c; }
.wdl-cp-score.none { font-size: 12px; font-weight: 900; color: #6f819c; text-transform: uppercase; }
/* ⓘ next to a We-Pick header, with its hover / focus bubble */
.wdl-h-info { display: flex; align-items: center; gap: 8px; }
.wdl-wpi { position: relative; display: inline-flex; vertical-align: middle; margin-left: 6px; text-transform: none; letter-spacing: normal; }
.wdl-h-info .wdl-wpi { margin-left: 0; }
.wdl-wpi-btn { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid #8193ad; background: transparent; color: #c9d5e6; font: italic 900 11px/1 Georgia, serif;
  cursor: help; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.wdl-wpi:hover .wdl-wpi-btn, .wdl-wpi-btn:focus-visible { border-color: ${GOLD}; color: ${GOLD}; outline: none; }
.wdl-wpi-tip { position: absolute; z-index: 30; top: calc(100% + 8px); left: -8px; width: min(280px, 80vw); padding: 12px 14px; border-radius: 10px;
  background: #0c1220; border: 1px solid #3a4a6a; box-shadow: 0 12px 30px rgba(0,0,0,0.5); color: #c9d5e6; font-size: 13px; font-weight: 600; line-height: 1.45;
  opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity 0.15s, transform 0.15s, visibility 0.15s; }
.wdl-wpi-tip::before { content: ""; position: absolute; top: -12px; left: 0; right: 0; height: 12px; }
.wdl-wpi:hover .wdl-wpi-tip, .wdl-wpi:focus-within .wdl-wpi-tip { opacity: 1; visibility: visible; transform: none; }
.wdl-wpi-tip b { display: block; color: #fff; font-weight: 900; margin-bottom: 4px; }
.wdl-wpi-tip b.inline { display: inline; margin: 0; color: #c4b5fd; }
.wdl-wpi-tip .gap { display: block; height: 6px; }
.wdl-wpi-tip .go { display: inline-block; margin-top: 8px; color: ${GOLD}; font-weight: 900; text-decoration: none; }
.wdl-pick-split i { display: block; height: 100%; }
.wdl-pick-legend { display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; font-weight: 900; color: #c9d5e6; font-variant-numeric: tabular-nums; }
.wdl-recap-headline { margin-top: 6px; font-weight: 800; font-size: clamp(16px, 1.25vw, 19px); line-height: 1.45; color: #dfe6f0; }
.wdl-recap-headline b { color: #fff; font-weight: 900; }
.wdl-wp-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 4px 0 12px; }
.wdl-wp-sub { color: #6f819c; font-size: 13px; font-weight: 700; }
.wdl-wp-review { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; background: linear-gradient(100deg, rgba(223,230,240,0.10), #111a2b 70%); border: 1px solid #3a4a68; border-radius: 12px; padding: 10px 14px; margin-bottom: 14px; }
.wdl-wp-review b { font-weight: 900; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #eef2f8; }
.wdl-wp-review span { font-size: 13px; font-weight: 700; color: #9fb0c8; }
.wdl-wp-grid { display: grid; gap: 22px; grid-template-columns: minmax(0, 1fr); }
.wdl-wp-main, .wdl-wp-side { min-width: 0; }
/* Phones / tablets (one column): the side column's pick tracker (Ranked
   status / Report Card + Share Picks) goes first on the tab, above the
   games; its recap and rules stay after them. */
@media (max-width: 1149px) {
  .wdl-wp-side { display: contents; }
  .wdl-wp-side > * { order: 1; }
  .wdl-wp-side > .wdl-wp-tracker { order: -1; }
}
@media (min-width: 1150px) {
  .wdl-wp-grid { grid-template-columns: minmax(0, 1fr) minmax(340px, 400px); align-items: start; }
  .wdl-wp-side { position: sticky; top: 84px; max-height: calc(100vh / var(--pz, 1) - 100px); overflow-y: auto; }
}
.wdl-wp-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid #1d2840; }
.wdl-wp-tab { display: inline-flex; align-items: center; gap: 6px; background: #111a2b; color: #9fb0c8; border: 1px solid #26324a; border-radius: 999px; padding: 6px 14px; font-weight: 800; font-size: 13px; text-decoration: none; white-space: nowrap; }
.wdl-wp-tab.on { background: #eef2f8; color: #0a0f1a; border-color: #eef2f8; }
.wdl-wp-badge { min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px; background: ${LIVE_RED}; color: #fff; font-size: 10px; font-weight: 900; display: inline-flex; align-items: center; justify-content: center; }
@media (max-width: 1149px) { .wdl-wp-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; } .wdl-wp-tabs::-webkit-scrollbar { display: none; } }
.wdl-yw-cols { display: grid; gap: clamp(18px, 2vw, 32px); grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); align-items: start; }
.wdl-yw-sec { min-width: 0; }
.wdl-yw-sec .wdl-grid { grid-template-columns: 1fr; }
.wdl-yw-h { display: flex; align-items: center; gap: 10px; font-size: clamp(17px, 1.3vw, 21px); font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; color: #fff; padding-bottom: 8px; margin: 0 0 14px; border-bottom: 3px solid ${GOLD}; }
.wdl-yw-h .ct { margin-left: auto; font-size: 11px; font-weight: 900; letter-spacing: 0.08em; color: #0a0f1a; background: ${GOLD}; border-radius: 999px; padding: 3px 9px; }
.wdl-yw-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.wdl-yw-stat { background: #111a2b; border: 1px solid #1d2840; border-radius: 10px; padding: 10px 14px; }
.wdl-yw-stat b { display: block; font-size: 28px; font-weight: 900; color: ${GOLD}; font-variant-numeric: tabular-nums; line-height: 1.1; }
.wdl-yw-stat b.dim { color: #6f819c; font-size: 18px; }
.wdl-yw-stat span { font-size: 11px; font-weight: 800; color: #9fb0c8; text-transform: uppercase; letter-spacing: 0.08em; }
.wdl-yw-list { display: grid; gap: 8px; }
.wdl-yw-pick { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; background: #111a2b; border: 1px solid #1d2840; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
.wdl-yw-pick.live { border-color: rgba(255,77,77,0.45); }
.wdl-yw-teams { display: flex; align-items: center; gap: 8px; font-weight: 900; font-size: 15px; color: #eef2f8; text-transform: uppercase; min-width: 0; flex-wrap: wrap; }
.wdl-yw-teams img { width: 22px; height: 22px; object-fit: contain; }
.wdl-yw-teams .sc { font-variant-numeric: tabular-nums; color: #eef2f8; }
.wdl-yw-teams .rk { color: #8193ad; font-size: 11px; margin-right: 2px; }
.wdl-yw-meta { font-size: 12px; font-weight: 700; color: #9fb0c8; }
.wdl-yw-meta .mine { color: #eef2f8; font-weight: 900; }
.wdl-yw-pts { grid-row: 1 / span 2; grid-column: 2; text-align: right; font-weight: 900; font-variant-numeric: tabular-nums; }
.wdl-yw-pts b { display: block; font-size: 22px; }
.wdl-yw-pts small { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb0c8; }
.wdl-yw-pts.win b { color: #3ddc84; } .wdl-yw-pts.loss b { color: #ff6b6b; } .wdl-yw-pts.live b { color: ${GOLD}; } .wdl-yw-pts.wait b { color: #6f819c; }
.wdl-yw-player { background: #111a2b; border: 1px solid #1d2840; border-radius: 10px; padding: 10px 14px; }
.wdl-yw-player.live { border-color: rgba(255,77,77,0.45); }
.wdl-yw-ph { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.wdl-yw-name { font-weight: 900; font-size: 15px; color: #eef2f8; text-decoration: none; }
.wdl-yw-name small { color: #8193ad; font-weight: 800; font-size: 11px; margin-left: 6px; }
.wdl-yw-game { font-size: 11px; font-weight: 800; color: #9fb0c8; cursor: pointer; text-transform: uppercase; }
.wdl-yw-game.live { color: ${LIVE_RED}; }
.wdl-yw-line { margin-top: 6px; display: grid; gap: 2px; }
.wdl-yw-line div { font-size: 14px; font-weight: 900; color: #eef2f8; font-variant-numeric: tabular-nums; }
.wdl-yw-line div span { display: inline-block; width: 44px; font-size: 10px; font-weight: 900; letter-spacing: 0.08em; color: #6f819c; }
.wdl-yw-none { font-size: 12px; font-weight: 700; color: #6f819c; margin-top: 4px; }
.wdl-yw-cta { background: none; border: 1px solid #2c3b57; color: #eef2f8; border-radius: 8px; padding: 7px 12px; font-weight: 900; font-size: 12px; cursor: pointer; font-family: inherit; text-decoration: none; display: inline-block; }
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
/* Game of the Week / Featured — We-Pick's colors (WePickHub.js RowTag). */
.wdl-tag.gotw { background: #7c3aed; color: #fff; }
.wdl-tag.feat { background: ${GOLD}; color: #fff; }
.wdl-athletes { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.wdl-ath { background: #1a2438; border: 1px solid #26324a; color: #c9d5e6; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 800; cursor: pointer; }
.wdl-ath.on { border-color: ${GOLD}; color: ${GOLD}; }
.wdl-ath.wk { border-color: #4d9fff; color: #9cc8ff; }
.wdl-ath.off { opacity: 0.55; border-style: dashed; }
.wdl-week { background: #0e1625; border: 1px solid #22304b; border-radius: 14px; padding: 14px 16px; }
.wdl-week .wdl-search { margin-bottom: 10px; }
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
.wdl-mu-team { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; max-width: 100%; text-align: center; }
.wdl-mu-short { display: none; }
/* Phones: the short name (WKU, not Western Kentucky), so it never runs under the score. */
@media (max-width: 640px) {
  .wdl-mu-full { display: none; }
  .wdl-mu-short { display: inline; }
  .wdl-mu-week { font-size: 10px; padding: 3px 8px; }
}
.wdl-mu-team.away { justify-self: start; }
.wdl-mu-team.home { justify-self: end; }
.wdl-mu-logo { position: relative; width: clamp(64px, 7.5vw, 120px); height: clamp(64px, 7.5vw, 120px); object-fit: contain; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.5)); }
.wdl-mu-name { position: relative; font-family: "Bebas Neue", "Arial Narrow", sans-serif; font-weight: 400; font-size: clamp(26px, 2.3vw, 40px); line-height: 1; text-transform: uppercase; color: #fff; letter-spacing: 0.03em; text-shadow: 0 3px 12px rgba(0,0,0,0.6); padding: 4px 2px 7px;
  /* always one line (ellipsis only as a last resort on the longest names) */
  white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.wdl-mu-name.ball::after { content: ""; position: absolute; left: 15%; right: 15%; bottom: 0; height: 3px; border-radius: 2px; background: ${GOLD}; box-shadow: 0 0 10px ${GOLD}; }
.wdl-mu-tlink { color: inherit; text-decoration: none; }
.wdl-mu-tlink:hover { text-decoration: underline; text-underline-offset: 4px; }
.wdl-mu-rank { color: rgba(255,255,255,0.65); font-size: 0.7em; margin-right: 6px; }
.wdl-mu-score { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.wdl-mu-score b { font-weight: 900; font-size: clamp(58px, 7.5vw, 120px); line-height: 1; color: #fff; text-shadow: 0 6px 22px rgba(0,0,0,0.55); animation: wdl-flash 1.6s ease-out; }
.wdl-mu-score b.pre { color: rgba(255,255,255,0.35); }
.wdl-mu-score.home { flex-direction: row-reverse; }
.wdl-mu-fb { width: clamp(30px, 2.8vw, 46px); height: auto; flex-shrink: 0; filter: drop-shadow(0 0 6px rgba(255,255,255,0.55)); }
.wdl-mu-fb.away { transform: rotate(32deg); }
.wdl-mu-fb.home { transform: rotate(-32deg); }
/* Down & distance — a scoreboard readout: two lit cells. */
/* themed by the team with the ball (--pc, its color) */
.wdl-mu-ddbox { display: grid; place-items: center; }
.wdl-mu-ddbox > * { grid-area: 1 / 1; }
.wdl-mu-sizer { visibility: hidden; }
.wdl-mu-tobadge { align-self: start; transform: translateY(-62%); font-size: 9px; font-weight: 900; letter-spacing: 0.14em; color: #121212; background: #f2c94c; border-radius: 999px; padding: 2px 8px; z-index: 1; }
.wdl-mu-dd { display: flex; border-radius: 10px; overflow: hidden; border: 2px solid rgba(255,255,255,0.85); background: linear-gradient(180deg, color-mix(in srgb, var(--pc) 88%, #fff), var(--pc) 55%, color-mix(in srgb, var(--pc) 75%, #000)); box-shadow: 0 0 16px color-mix(in srgb, var(--pc) 60%, transparent), 0 4px 14px rgba(0,0,0,0.45); }
.wdl-mu-dd > div { display: flex; flex-direction: column; align-items: center; padding: 5px 14px 6px; min-width: 56px; }
.wdl-mu-dd > div + div { border-left: 1px solid rgba(255,255,255,0.35); }
.wdl-mu-dd span { font-size: 9px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(255,255,255,0.75); text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
.wdl-mu-dd b { font-weight: 900; font-size: clamp(20px, 1.8vw, 28px); line-height: 1.05; color: #fff; font-variant-numeric: tabular-nums; text-transform: uppercase; text-shadow: 0 2px 6px rgba(0,0,0,0.55); }
.wdl-mu-dd b.goal { color: #fff; }
.wdl-mu .lose { opacity: 0.5; }
.wdl-mu-score.win b { text-shadow: 0 0 26px rgba(255,255,255,0.35), 0 6px 22px rgba(0,0,0,0.55); }
.wdl-mu-mid { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
/* Before kickoff: team | game info | team — no score columns. */
.wdl-mu.pre { grid-template-columns: 1fr minmax(0, auto) 1fr; }
.wdl-mu-pre { gap: 6px; padding: 0 clamp(4px, 1vw, 16px); }
.wdl-mu-tag { font-size: 10px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; color: #fff; }
.wdl-mu-tag.gotw { background: #7c3aed; }
.wdl-mu-tag.feat { background: ${GOLD}; color: #121212; }
.wdl-mu-day { font-weight: 900; font-size: clamp(14px, 1.2vw, 18px); letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.85); text-shadow: 0 1px 4px rgba(0,0,0,0.5); }
.wdl-mu-day small { margin-left: 8px; font-size: 0.85em; color: rgba(255,255,255,0.6); }
.wdl-mu-kick { font-weight: 900; font-size: clamp(30px, 3.4vw, 54px); line-height: 1; color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; text-shadow: 0 4px 16px rgba(0,0,0,0.55); }
.wdl-mu-count { font-weight: 800; font-size: clamp(12px, 1vw, 15px); color: ${GOLD}; text-shadow: 0 1px 4px rgba(0,0,0,0.5); }
.wdl-mu-meta { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px 10px; margin-top: 2px; font-size: clamp(11px, 0.9vw, 14px); font-weight: 800; color: rgba(255,255,255,0.7); }
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
  .wdl-mu-name { font-size: 22px; }
  .wdl-mu-score b { font-size: 40px; }
  .wdl-mu-fb { width: 22px; }
  .wdl-mu-dd > div { padding: 3px 8px 4px; min-width: 40px; }
  .wdl-mu-dd span { font-size: 8px; letter-spacing: 0.1em; }
  .wdl-mu-dd b { font-size: 16px; }
  .wdl-mu-status { font-size: 12px; padding: 4px 9px; }
  .wdl-mu-next { font-size: 11px; white-space: normal; }
  .wdl-mu-link { display: none; }
  .wdl-mu-rec { font-size: 11px; margin-top: -2px; }
  .wdl-mu.pre { grid-template-columns: 1fr minmax(0, auto) 1fr; }
  .wdl-mu-kick { font-size: 24px; }
  .wdl-mu-day { font-size: 11px; letter-spacing: 0.08em; }
  .wdl-mu-day small { display: block; margin: 2px 0 0; }
  .wdl-mu-tag { font-size: 8px; padding: 2px 7px; letter-spacing: 0.08em; }
  .wdl-mu-tv { font-size: 10px; padding: 2px 6px; }
  .wdl-main.feed .wdl-rail { order: -1; max-height: calc(46vh / var(--pz, 1)); overflow-y: auto; border-bottom: 1px solid #1d2840; padding-bottom: 8px; }
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
.wdl-phase { display: flex; align-items: center; gap: 12px 20px; flex-wrap: wrap; margin: 14px clamp(16px, 2.4vw, 36px) 0; padding: 12px 16px; border-radius: 14px; border: 1px solid #26324a; }
.wdl-phase.review { background: linear-gradient(100deg, rgba(223,230,240,0.10), #111a2b 70%); border-color: #3a4a68; }
.wdl-phase.preview { background: linear-gradient(100deg, rgba(77,159,255,0.16), #111a2b 70%); border-color: #2c4a78; }
.wdl-phase-text { flex: 1; min-width: 220px; }
.wdl-phase-tag { font-weight: 900; font-size: clamp(14px, 1.1vw, 17px); letter-spacing: 0.12em; text-transform: uppercase; color: #fff; }
.wdl-phase-sub { margin-top: 3px; font-weight: 700; font-size: 14px; color: #9fb0c8; line-height: 1.45; }
.wdl-phase-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.wdl-phase-btns button { background: #eef2f8; color: #0a0f1a; border: 0; border-radius: 999px; padding: 7px 14px; font-weight: 900; font-size: 13px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.wdl-phase.review .wdl-phase-btns button:first-child, .wdl-phase.preview .wdl-phase-btns button { background: ${GOLD}; color: #121212; }
.wdl-day + .wdl-day { margin-top: 22px; }
@media (max-width: 700px) { .wdl-phase { margin: 10px 12px 0; padding: 10px 12px; } .wdl-phase-sub { font-size: 13px; } }
.wdl-rotate { display: none; }
.wdl-fs { border-color: #3a4a68; color: #eef2f8; }
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
  /* One header row: the tabs scroll sideways instead of wrapping, so Log in
     never drops to its own line (that extra row of the sticky header sat
     on top of the scores). The "Updated" time and the second full-screen
     button are desktop-only. */
  .wdl-compact .wdl-top { flex-wrap: nowrap; }
  .wdl-compact .wdl-tabs { flex: 1; min-width: 0; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .wdl-compact .wdl-tabs::-webkit-scrollbar { display: none; }
  .wdl-compact .wdl-tab { white-space: nowrap; }
  .wdl-compact .wdl-meta { display: none; }
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
  .wdl-compact .lpc { padding: 10px 14px; }
}
`;

// Top 25 first: a matchup ranks by its better-ranked team (two ranked
// teams break a tie by the other one's rank), then unranked games by
// kickoff. The scoreboard order on days without games.
const bestRank = (g) => Math.min(g.home?.rank || 99, g.away?.rank || 99);
const otherRank = (g) => Math.max(g.home?.rank || 99, g.away?.rank || 99);
const byTop25 = (a, b) => bestRank(a) - bestRank(b) || otherRank(a) - otherRank(b)
  || (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0);

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
        {team.record && <span className="wdl-rec">{team.record}</span>}
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
  const tvShort = useTvShort();
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
          {game.gameOfWeek && <span className="wdl-tag gotw">GOTW</span>}
          {!game.gameOfWeek && game.featured && <span className="wdl-tag feat">Featured</span>}
          {game.status === "scheduled" && game.tv && <span className="wdl-tag">{tvShort(game.tv)}</span>}
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

// A row of the week's games for views that aren't the All Games grid: live
// games first, then the ones still to come (kickoff order, with time and
// TV), then the finals — so it's never empty while the week has games — click one to open it. Close 4th-quarter games glow. The
// order is set when the page loads and then holds — scores update in place
// and games only move on a refresh. In review (the week's over, all finals)
// the row is Top 25 first instead (byTop25). Ranks show before each name. Games that start later join the end of
// the live ones; games that go final later join the end of the row.
// Before anything has kicked off (preview), it's the week's games in kickoff
// order, with time and TV. onPopout: the pop-out scores button at its end.
function ScoreStrip({ games, onPick, current, phase, onPopout, popped }) {
  const tvShort = useTvShort();
  const order = useRef(null);
  const orderPhase = useRef(phase);
  if (orderPhase.current !== phase) { orderPhase.current = phase; order.current = null; }
  const shown = games.filter((g) => g.status === "in_progress" || g.status === "final");
  // Still to be played (a game 6+ hours past kickoff that never started —
  // postponed — is left out).
  const upcoming = games.filter((g) => g.status === "scheduled" && !(Date.parse(g.startDate) < Date.now() - 6 * 3600e3))
    .sort((a, b) => (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0));
  if (!order.current && shown.length) order.current = (phase === "review" ? [...shown].sort(byTop25) : stripOrder(shown)).map((g) => g.id);
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
  const ordered = (order.current || []).map((id) => byId.get(id)).filter(Boolean);
  const list = [...ordered.filter((g) => g.status === "in_progress"), ...upcoming, ...ordered.filter((g) => g.status === "final")];
  if (!list.length) return null;
  return (
    <div className="wdl-strip">
      {list.map((g) => {
        const heat = clutchHeat(g);
        const live = g.status === "in_progress";
        return (
          <button key={g.id} className={`wdl-strip-game${live ? " live" : ""}${heat ? " clutch" : ""}${g.gameOfWeek && !live && !heat ? " gotw" : ""}${g.id === current ? " on" : ""}`}
            style={heat ? { "--heat": heat.toFixed(2) } : undefined} onClick={() => onPick(g.id)}>
            {["away", "home"].map((side) => (
              <span key={side} className={`wdl-strip-row${g.status === "final" && g[side].points < g[side === "home" ? "away" : "home"].points ? " lose" : ""}`}>
                {g[side].logo && <img src={g[side].logoDark || g[side].logo} alt="" />}
                <span className="wdl-strip-team">{g[side].rank ? <span className="wdl-strip-rank">{g[side].rank}</span> : null}{teamShort(g[side])}</span>
                <b key={g[side].points}>{g[side].points ?? ""}</b>
              </span>
            ))}
            <span className="wdl-strip-status">
              {live && <span className="wdl-dot" />}{statusLabel(g)}{g.status !== "final" && g.tv && <span className="wdl-strip-tv">{tvShort(g.tv)}</span>}
              {g.gameOfWeek ? <span className="wdl-strip-tag" title="Game of the Week"><span className="wdl-strip-pill gotw">GOTW</span></span>
                : g.featured ? <span className="wdl-strip-tag" title="Featured game"><span className="wdl-strip-pill feat">Featured</span></span> : null}
            </span>
          </button>
        );
      })}
      {onPopout && (
        <button type="button" className={`wdl-strip-pop${popped ? " on" : ""}`} onClick={onPopout} title={popped ? "Close the pop-out scores" : "Pop out scores — float them over your other windows"} aria-label="Pop out scores">
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9 3h8v8M17 3l-7.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
    </div>
  );
}

// The scores pop-out's chooser: every game, or a picked set (kept in this
// browser for next time).
const SCORES_PICK_KEY = "wdLive.scoresPick";
const loadScoresPick = () => { try { return JSON.parse(localStorage.getItem(SCORES_PICK_KEY) || "null") || { mode: "all", ids: [] }; } catch { return { mode: "all", ids: [] }; } };
function ScoresPicker({ games, sel, onChange, onOpen, onClose }) {
  const ids = new Set(sel.ids);
  const listed = [...games].sort((a, b) => (a.status === "in_progress" ? 0 : a.status === "scheduled" ? 1 : 2) - (b.status === "in_progress" ? 0 : b.status === "scheduled" ? 1 : 2)
    || (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0));
  const toggle = (id) => onChange({ ...sel, ids: ids.has(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id] });
  return (
    <div className="wdl-swp" role="dialog" aria-label="Pop out scores">
      <div className="wdl-swp-h">Pop out scores<button type="button" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="wdl-seg">
        <button type="button" className={sel.mode === "all" ? "on" : ""} onClick={() => onChange({ ...sel, mode: "all" })}>All games</button>
        <button type="button" className={sel.mode === "pick" ? "on" : ""} onClick={() => onChange({ ...sel, mode: "pick" })}>Pick games</button>
      </div>
      {sel.mode === "pick" && (
        <div className="wdl-swp-list">
          {listed.map((g) => (
            <label key={g.id} className={ids.has(g.id) ? "on" : ""}>
              <input type="checkbox" checked={ids.has(g.id)} onChange={() => toggle(g.id)} />
              <span className="m">{g.away.rank ? <small>{g.away.rank}</small> : null}{teamShort(g.away)} @ {g.home.rank ? <small>{g.home.rank}</small> : null}{teamShort(g.home)}</span>
              <span className={`s${g.status === "in_progress" ? " live" : ""}`}>{statusLabel(g)}</span>
            </label>
          ))}
        </div>
      )}
      <button type="button" className="wdl-swp-go" disabled={sel.mode === "pick" && !sel.ids.length} onClick={onOpen}>
        ⧉ Pop out {sel.mode === "all" ? "all games" : `${sel.ids.length} game${sel.ids.length === 1 ? "" : "s"}`}
      </button>
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

// Preview: the slate's games under a heading per day ("Saturday, Oct 10"),
// Top 25 first within each day.
function gamesByDay(games) {
  const byDay = new Map();
  for (const g of [...games].sort((a, b) => (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0))) {
    const d = new Date(g.startDate);
    const key = isNaN(d) ? "Date TBA" : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(g);
  }
  return [...byDay.entries()].map(([day, list]) => [day, list.sort(byTop25)]);
}

// The week's mode, said up top. Review: the week's over — catch up (finals,
// Feed, Top Performances) until the next week takes over Monday morning.
// Preview: next week's matchups — follow teams and players before kickoff.
function PhaseBanner({ phase, slate, games, setView }) {
  const wk = slate.week ? `Week ${slate.week}` : "This week";
  if (phase === "review") {
    const at = slate.nextWeekAt ? new Date(slate.nextWeekAt) : null;
    const when = at && !isNaN(at) ? at.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" }).replace(":00", "") : null;
    return (
      <div className="wdl-phase review">
        <div className="wdl-phase-text">
          <div className="wdl-phase-tag">🏁 {wk} in review</div>
          <div className="wdl-phase-sub">Every final, the biggest plays and the top performances — get caught up.{when ? ` Next week's preview opens ${when}.` : ""}</div>
        </div>
        <div className="wdl-phase-btns">
          <button onClick={() => setView("week")}>Your Week</button>
          <button onClick={() => setView("perf")}>Top Performances</button>
          <button onClick={() => setView("all")}>Final scores</button>
        </div>
      </div>
    );
  }
  const first = games.filter((g) => g.startDate).sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))[0];
  return (
    <div className="wdl-phase preview">
      <div className="wdl-phase-text">
        <div className="wdl-phase-tag">📅 {wk} preview</div>
        <div className="wdl-phase-sub">{games.length} games{first ? ` · first kickoff ${kickoffLabel(first.startDate, first.startTimeTBD)}` : ""}. Follow your teams and players now — My Feed opens an hour before kickoff.</div>
      </div>
      <div className="wdl-phase-btns">
        <button onClick={() => setView("customize")}>⚙ Follow teams & players</button>
      </div>
    </div>
  );
}

// ── Your Week ── a signed-in fan's week on one page: We-Pick Ranked 6
// results, followed teams' scores and followed players' stat lines. Lives
// all week — during games everything updates in place (the slate listener
// for scores, one live-stats listener per game a followed player is in).

// The user's pick + the schedule26 game for each ranked game (official
// final scores, and which side is "home" for the pick) — two reads a game,
// once.
function useRankedPicks(uid, ids) {
  const key = [...ids].sort().join("|");
  const [rows, setRows] = useState({});
  useEffect(() => {
    let alive = true;
    setRows({});
    if (!uid || !key) return undefined;
    Promise.all(key.split("|").map((id) => Promise.all([
      getDoc(doc(db, "users", uid, "picks", id)).catch(() => null),
      getDoc(doc(db, "schedule26", id)).catch(() => null),
    ]).then(([p, g]) => [id, { pick: p?.exists() ? p.data() : null, sched: g?.exists() ? g.data() : null }])))
      .then((list) => { if (alive) setRows(Object.fromEntries(list)); });
    return () => { alive = false; };
  }, [uid, key]);
  return rows;
}

// One ranked game: the pick vs. the score. Points are official once the
// schedule has the final (same as We-Pick's grading); before that they're
// what the pick would score if the game ended now.
function rankedPickRow(game, row) {
  const sched = row?.sched || {};
  // schedule26's Home/Away can be flipped from CFBD's (neutral sites).
  const swapped = !!sched.Home && sched.Home === game.away.school;
  const home = swapped ? game.away : game.home;
  const away = swapped ? game.home : game.away;
  const official = isGameFinal(sched);
  const started = game.status === "in_progress" || game.status === "final";
  const scored = official ? sched
    : started ? { Final: true, HomeScore: home.points ?? 0, AwayScore: away.points ?? 0 } : null;
  const pick = row?.pick;
  const points = scored && hasScorePick(pick) ? scoreGamePick(pick, scored) : null;
  const state = !started && !official ? "wait" : game.status === "in_progress" && !official ? "live" : points > 0 ? "win" : "loss";
  return { home, away, pick, points, state, official };
}

// The week's final We-Pick standings (wePickStandings2026/{week}, written
// by scripts/gradeWePickWeek.js once every game is final) — one doc,
// listened to so the rank appears the moment the week is graded.
function useWeekStanding(uid, week) {
  const [state, setState] = useState(null);
  useEffect(() => {
    setState(null);
    if (!uid || !week) return undefined;
    return onSnapshot(doc(db, "wePickStandings2026", week), (snap) => {
      const d = snap.exists() ? snap.data() : null;
      if (!d?.graded || !Array.isArray(d.entries)) { setState({ graded: false }); return; }
      const sorted = [...d.entries].sort(compareStandingsEntries);
      const at = sorted.findIndex((e) => e.uid === uid);
      setState({ graded: true, rank: at < 0 ? null : at + 1, of: sorted.length, entry: at < 0 ? null : sorted[at] });
    }, () => setState(null));
  }, [uid, week]);
  return state;
}

function YourWeekPicks({ games, rows, standing, onOpen }) {
  const list = games.map((g) => ({ g, r: rankedPickRow(g, rows[g.wedraftGameId]) }));
  const total = standing?.entry ? standing.entry.points : list.reduce((t, x) => t + (x.r.points || 0), 0);
  const anyLive = list.some((x) => x.r.state === "live");
  return (
    <>
      <div className="wdl-yw-stats">
        <div className="wdl-yw-stat"><b>{total.toLocaleString()}</b><span>{anyLive ? "Points if it ended now" : standing?.graded ? "Final points" : "Points so far"}</span></div>
        <div className="wdl-yw-stat">
          {standing?.graded
            ? (standing.rank ? <b>#{standing.rank}<small style={{ fontSize: 13, color: "#9fb0c8" }}> of {standing.of}</small></b> : <b className="dim">Didn't qualify</b>)
            : <b className="dim">Pending</b>}
          <span>{standing?.graded ? "Final ranking" : "Final ranking · after every game ends"}</span>
        </div>
      </div>
      <div className="wdl-yw-list">
        {list.map(({ g, r }) => {
          const side = r.pick ? pickedSideOf(r.pick) : null;
          const picked = side === "home" ? r.home : side === "away" ? r.away : null;
          return (
            <div key={g.id} className={`wdl-yw-pick${r.state === "live" ? " live" : ""}`} onClick={() => onOpen(g.id)}>
              <div className="wdl-yw-teams">
                {[r.away, r.home].map((t, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {i === 1 && <span style={{ color: "#6f819c" }}>@</span>}
                    {(t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}
                    {t.rank ? <span className="rk">{t.rank}</span> : null}{teamShort(t)}
                    {t.points != null && <span className="sc">{t.points}</span>}
                  </span>
                ))}
              </div>
              <div className={`wdl-yw-pts ${r.state}`}>
                <b>{r.points == null ? "—" : r.points}</b>
                <small>{r.state === "live" ? "Live" : r.state === "wait" ? kickoffLabel(g.startDate, g.startTimeTBD) : r.official ? "Final" : "Final · unofficial"}</small>
              </div>
              <div className="wdl-yw-meta">
                {hasScorePick(r.pick)
                  ? <>Your pick: <span className="mine">{picked ? teamShort(picked).toUpperCase() : "—"}</span> · {teamShort(r.away).toUpperCase()} {r.pick.awayScore} – {teamShort(r.home).toUpperCase()} {r.pick.homeScore}</>
                  : "No score pick on this game"}
                {g.status === "in_progress" && <> · <span style={{ color: LIVE_RED }}>{statusLabel(g)}</span></>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const YW_CATS = { passing: "PASS", rushing: "RUSH", receiving: "REC", defense: "DEF" };
const ywNorm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// Followed players in one game — one live-stats listener for all of them.
function YourWeekGamePlayers({ game, players, onOpen }) {
  const started = game.status === "in_progress" || game.status === "final";
  const { stats } = useLiveStats(started ? game.id : null);
  const live = game.status === "in_progress";
  return players.map((p) => {
    const side = String(game.home.providerTeamId) === String(p.teamId) ? "home" : "away";
    const opp = side === "home" ? game.away : game.home;
    const line = (stats?.players?.[side] || []).find((l) => String(l.key) === String(p.id) || ywNorm(l.name) === ywNorm(p.name));
    const rows = line ? LEADER_CATS.map((cat) => [YW_CATS[cat], statLine(cat, line.stats?.[cat])]).filter(([, t]) => t) : [];
    const slug = line?.slug;
    const sub = [p.position, p.team].filter(Boolean).join(" · ");
    return (
      <div key={p.id} className={`wdl-yw-player${live ? " live" : ""}`}>
        <div className="wdl-yw-ph">
          {slug
            ? <Link to={`/player/${slug}`} target="_blank" rel="noopener noreferrer" className="wdl-yw-name">{p.name}<small>{sub}</small></Link>
            : <span className="wdl-yw-name">{p.name}<small>{sub}</small></span>}
          <span className={`wdl-yw-game${live ? " live" : ""}`} onClick={() => onOpen(game.id)}>
            {side === "home" ? "vs" : "@"} {teamShort(opp)} · {started ? `${statusLabel(game)} ${game[side].points ?? 0}-${opp.points ?? 0}` : kickoffLabel(game.startDate, game.startTimeTBD)}
          </span>
        </div>
        {rows.length
          ? <div className="wdl-yw-line">{rows.map(([label, text]) => <div key={label}><span>{label}</span>{text}</div>)}</div>
          : <div className="wdl-yw-none">{started ? "No stats yet." : "Hasn't kicked off."}</div>}
      </div>
    );
  });
}

function YourWeek({ week, signedIn, login, rankedGames, rankedRows, standing, teamGames, players, games, grid, onOpen, onCustomize, onWePick, toggle }) {
  // Followed players grouped by their game this week.
  const byGame = new Map();
  const idle = [];
  players.forEach((p) => {
    const g = p.teamId != null && games.find((x) => String(x.home.providerTeamId) === String(p.teamId) || String(x.away.providerTeamId) === String(p.teamId));
    if (!g) { idle.push(p); return; }
    if (!byGame.has(g.id)) byGame.set(g.id, { game: g, players: [] });
    byGame.get(g.id).players.push(p);
  });
  const groups = [...byGame.values()].sort((a, b) => sortGames(a.game, b.game));
  return (
    <div>
      {toggle}
      <div className="wdl-h">Your Week{week ? ` · Week ${week}` : ""}</div>
      <div className="wdl-yw-cols">
      <section className="wdl-yw-sec">
        <h2 className="wdl-yw-h">🏆 We-Pick Ranked 6{signedIn && rankedGames.length > 0 && <span className="ct">{rankedGames.length}/6</span>}</h2>
        {!signedIn ? (
          <div className="wdl-cust-sub"><button className="wdl-yw-cta" onClick={login}>Log in</button> to see your We-Pick results.</div>
        ) : rankedGames.length ? (
          <YourWeekPicks games={rankedGames} rows={rankedRows} standing={standing} onOpen={onOpen} />
        ) : (
          <div className="wdl-cust-sub">No Ranked 6 this week. <button className="wdl-yw-cta" onClick={onWePick}>Make your picks →</button></div>
        )}
      </section>
      <section className="wdl-yw-sec">
        <h2 className="wdl-yw-h">🏈 Your teams{teamGames.length > 0 && <span className="ct">{teamGames.length}</span>}</h2>
        {teamGames.length ? grid(teamGames, "") : (
          <div className="wdl-cust-sub">None of your teams play this week. <button className="wdl-yw-cta" onClick={onCustomize}>⚙ Follow teams</button></div>
        )}
      </section>
      <section className="wdl-yw-sec">
        <h2 className="wdl-yw-h">⭐ Your players{players.length > 0 && <span className="ct">{players.length}</span>}</h2>
        {groups.length ? (
          <div className="wdl-yw-list">
            {groups.map(({ game, players: ps }) => <YourWeekGamePlayers key={game.id} game={game} players={ps} onOpen={onOpen} />)}
          </div>
        ) : (
          <div className="wdl-cust-sub">{players.length ? "None of your players have a game this week." : "You're not following any players yet."} <button className="wdl-yw-cta" onClick={onCustomize}>⚙ Follow players</button></div>
        )}
        {idle.length > 0 && groups.length > 0 && (
          <div className="wdl-yw-none" style={{ marginTop: 10 }}>No game this week: {idle.map((p) => p.name).join(", ")}</div>
        )}
      </section>
      </div>
    </div>
  );
}

// Your Week for the previous week (the toggle on Your Week while the slate
// is in preview or review): that week's games from liveGames (useWeekGames,
// cached), your Ranked 6 for it, its final standing, and your followed
// teams and players with that week's adds/drops applied.
function YourLastWeek({ season, week, uid, followedTeams, followedPlayers, weekFollows, ...rest }) {
  const loaded = useWeekGames(season, week > 0 ? week : null);
  const games = useMemo(() => loaded || [], [loaded]);
  const rankedIds = useRankedSixIds(uid, games.map((g) => g.wedraftWeek));
  const rankedGames = games.filter((g) => g.wedraftGameId && rankedIds.has(g.wedraftGameId));
  const rankedRows = useRankedPicks(uid, rankedGames.map((g) => g.wedraftGameId));
  const wpWeek = useMemo(() => {
    const n = {};
    games.forEach((g) => { if (g.wedraftWeek) n[g.wedraftWeek] = (n[g.wedraftWeek] || 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }, [games]);
  const standing = useWeekStanding(uid, wpWeek);
  const teams = weekTeams(followedTeams, weekFollows);
  const teamGames = games.filter((g) => teams.includes(g.home.providerTeamId) || teams.includes(g.away.providerTeamId));
  return <YourWeek week={week} rankedGames={rankedGames} rankedRows={rankedRows} standing={standing}
    teamGames={teamGames} players={weekPlayers(followedPlayers, weekFollows)} games={games} {...rest} />;
}

// ── Reviewed games ── a final game opens on Stats, its play-by-play folds
// into a chronological drive summary (expand a drive for its plays), and
// the right rail becomes a Game Recap.

const NOT_SNAP = /kickoff|end period|end of|timeout|extra point|two point|2pt|pat|coin toss/i;
const fmtClock = (secs) => `${Math.floor(secs / 60)}:${String(Math.max(0, secs) % 60).padStart(2, "0")}`;

// Drives from a game's plays (chronological, utils/live.js comparePlays):
// who had it, how it ended, plays / yards / time, where it started and the
// score after it. Late-corrected plays can carry a stale score (one that's
// higher than the plays after it) — those scores are ignored.
function buildDrives(sortedPlays) {
  // Scores you can trust: a play's score counts only if nothing later is lower.
  const score = new Array(sortedPlays.length);
  let floor = { home: Infinity, away: Infinity };
  for (let i = sortedPlays.length - 1; i >= 0; i -= 1) {
    const p = sortedPlays[i];
    const ok = p.homeScore != null && p.awayScore != null && p.homeScore <= floor.home && p.awayScore <= floor.away;
    score[i] = ok ? { home: p.homeScore, away: p.awayScore } : null;
    if (ok) floor = { home: p.homeScore, away: p.awayScore };
  }
  const order = [];
  const byId = new Map();
  let running = { home: 0, away: 0 };
  sortedPlays.forEach((p, i) => {
    if (score[i]) running = score[i];
    const key = p.driveId || `p${p.period}-${p.id}`;
    if (!byId.has(key)) { byId.set(key, []); order.push(key); }
    byId.get(key).push({ p, after: running });
  });
  let before = { home: 0, away: 0 };
  return order.map((key) => {
    const rows = byId.get(key);
    const list = rows.map((r) => r.p);
    const snaps = list.filter((p) => p.down != null && !NOT_SNAP.test(p.type || ""));
    const first = snaps[0] || list[0];
    const side = first.offense || list.find((p) => p.offense)?.offense || null;
    const real = list.filter((p) => !/end period|end of|timeout/i.test(p.type || ""));
    const last = real[real.length - 1] || list[list.length - 1];
    const tail = list[list.length - 1];
    const after = rows[rows.length - 1].after;
    const other = side === "home" ? "away" : "home";
    const pts = side ? after[side] - before[side] : 0;
    const oppPts = side ? after[other] - before[other] : 0;
    const t = (last.type || "").toLowerCase();
    let result = "", kind = "";
    if (pts >= 6) { result = "Touchdown"; kind = "td"; }
    else if (pts === 3 || /field goal good/.test(t)) { result = "Field Goal"; kind = "fg"; }
    else if (oppPts >= 6) { result = /interception/.test(t) ? "Pick-six" : "Defensive TD"; kind = "to"; }
    else if (oppPts === 2 || /safety/.test(t)) { result = "Safety"; kind = "to"; }
    else if (/interception/.test(t)) { result = "Interception"; kind = "to"; }
    else if (/fumble/.test(t)) { result = "Fumble"; kind = "to"; }
    else if (/missed field goal|field goal missed|blocked field goal/.test(t)) { result = "Missed FG"; }
    else if (/punt/.test(t)) { result = "Punt"; }
    else if (last.down === 4 && (last.yards ?? 0) < (last.distance ?? 0)) { result = "Downs"; kind = "to"; }
    else if (/end period|end of/i.test(tail.type || "") && (tail.period === 2 || tail.period >= 4)) { result = tail.period === 2 ? "End of Half" : "End of Game"; }
    // Yards by field position: where it started to where the last
    // non-kicking snap left the ball (a TD is the goal line). Kick plays'
    // own spots aren't trusted — the feed sometimes reports a punt at 0.
    const runPlays = snaps.filter((p) => !/punt|field goal/i.test(p.type || ""));
    const lastSnap = runPlays[runPlays.length - 1];
    let yards = 0;
    if (first.yardsToGoal != null && lastSnap?.yardsToGoal != null) {
      const endYtg = kind === "td" && pts >= 6 ? 0 : Math.min(100, Math.max(0, lastSnap.yardsToGoal - (lastSnap.yards || 0)));
      yards = first.yardsToGoal - endYtg;
    }
    const startSecs = first.clockSeconds ?? 900;
    const endSecs = last.clockSeconds ?? 0;
    const span = (last.period || 0) === (first.period || 0)
      ? startSecs - endSecs
      : startSecs + Math.max(0, (last.period || 0) - (first.period || 0) - 1) * 900 + (900 - endSecs);
    const ytg = first.yardsToGoal;
    const kicks = snaps.filter((p) => /punt|field goal/i.test(p.type || "")).length;
    const drive = {
      key, side, plays: list, snaps: snaps.length - kicks, result, kind, yards,
      time: span > 0 ? fmtClock(span) : null,
      period: first.period, clock: first.clock,
      start: ytg == null ? null : ytg > 50 ? `Own ${100 - ytg}` : ytg === 50 ? "50" : `Opp ${ytg}`,
      scored: pts > 0 || oppPts > 0, after,
    };
    before = after;
    return drive;
  });
}

function DriveSummary({ plays, game, cardProps, withTwo }) {
  const drives = useMemo(() => buildDrives(plays), [plays]);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  if (!drives.length) return <div className="wdl-empty">No plays available for this game.</div>;
  let lastQ = null;
  return drives.map((d) => {
    const t = d.side ? game[d.side] : null;
    const q = d.period ? (d.period > 4 ? `Overtime${d.period > 5 ? ` ${d.period - 4}` : ""}` : `${["1st", "2nd", "3rd", "4th"][d.period - 1]} Quarter`) : null;
    const showQ = q && q !== lastQ;
    lastQ = q || lastQ;
    const isOpen = open.has(d.key);
    return (
      <div key={d.key}>
        {showQ && <div className="wdl-drive-q">{q}</div>}
        <div className="lpc wdl-drive" style={{ "--tc": t?.color || "#2a3753" }} onClick={() => toggle(d.key)}>
          <div className="wdl-drive-top">
            <span className="wdl-drive-team">{t && (t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}{t ? teamShort(t) : "—"}</span>
            {d.result && <span className={`wdl-drive-res ${d.kind}`}>{d.result}</span>}
            {d.scored && <span className="wdl-drive-score">{teamShort(game.away)} {d.after.away} – {teamShort(game.home)} {d.after.home}</span>}
          </div>
          <div className="wdl-drive-meta">
            <span>{d.clock ? `${d.clock}` : ""}</span>
            <span><b>{d.snaps}</b> play{d.snaps === 1 ? "" : "s"}</span>
            <span><b>{d.yards}</b> yds</span>
            {d.time && <span><b>{d.time}</b></span>}
            {d.start && <span>Start: {d.start}</span>}
            <span className="wdl-drive-caret">{isOpen ? "▲ Hide plays" : "▼ Plays"}</span>
          </div>
        </div>
        {isOpen && (
          <div className="wdl-drive-plays">
            {d.plays.map((p) => (
              <div key={p.id} id={`play-${p.id}`}>
                <LivePlayCard variant="detailed" {...cardProps(p)} />
                {withTwo(p)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  });
}

// Fantasy-style weight for picking a game's top performer.
const perfScore = (st = {}) => {
  const ps = st.passing || {}, ru = st.rushing || {}, re = st.receiving || {}, de = st.defense || {};
  return (ps.yds || 0) * 0.04 + (ps.td || 0) * 4 - (ps.int || 0) * 2
    + (ru.yds || 0) * 0.1 + (ru.td || 0) * 6
    + (re.yds || 0) * 0.1 + (re.td || 0) * 6 + (re.rec || 0) * 0.5
    + (de.tot || 0) * 0.5 + (de.sacks || 0) * 3 + (de.tfl || 0) * 1 + (de.int || 0) * 4 + (de.ff || 0) * 2 + (de.fr || 0) * 2;
};

// We-Pick on one game: every public pick (schedule26/{id}/picks), mapped
// onto /live's home/away by school name — read once.
// A score with the winner first: "OSU 31 – IOWA 17".
function winFirst(game, away, home) {
  const [w, ws, l, ls] = home > away ? [game.home, home, game.away, away] : [game.away, away, game.home, home];
  return `${teamShort(w)} ${ws} – ${teamShort(l)} ${ls}`;
}

// uid → verified (users/{uid}.verified) for the names on screen. Cached for
// the page's life, so each person is read once.
const verifiedCache = new Map();
function useVerifiedUids(uids) {
  const key = [...new Set(uids)].sort().join(",");
  const [, bump] = useState(0);
  useEffect(() => {
    let alive = true;
    const missing = key ? key.split(",").filter((u) => !verifiedCache.has(u)) : [];
    if (!missing.length) return undefined;
    Promise.all(missing.map((u) => getDoc(doc(db, "users", u)).then((s) => verifiedCache.set(u, !!(s.exists() && s.data().verified))).catch(() => verifiedCache.set(u, false))))
      .then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
  }, [key]);
  return Object.fromEntries(key ? key.split(",").map((u) => [u, !!verifiedCache.get(u)]) : []);
}

// The game's community We-Pick picks for the halftime break card: who
// fans picked, their average predicted final, and the viewer's own pick
// (all in /live's home/away). null when there are none.
function breakPickSummary(game, data, user) {
  const v = pickView(data, user?.uid);
  if (!game || !v || !(v.summary.count || v.summary.scored)) return null;
  const S = v.summary;
  const swapped = !!v.sched.Home && v.sched.Home === game.away?.school;
  const split = swapped ? { home: S.split.away, away: S.split.home } : { home: S.split.home, away: S.split.away };
  const avg = (k) => Math.round(S.sum[k] / (S.scored || 1));
  const mine = v.mine;
  return {
    split,
    avg: S.scored ? { home: swapped ? avg("away") : avg("home"), away: swapped ? avg("home") : avg("away") } : null,
    mine: mine && hasScorePick(mine) ? { home: swapped ? mine.awayScore : mine.homeScore, away: swapped ? mine.homeScore : mine.awayScore } : null,
  };
}

// A game's community We-Pick picks: { sched, summary, mine, mineCounted }.
//   summary  wePickSummaries/{id} — one doc the live ingester keeps
//            (server/live/pickSummaries.js): count, split { away, home },
//            scored, sum { away, home }, scores ("away-home" → n),
//            publicCount, recent (the newest public picks), builtAt — all
//            in schedule26's orientation. A game without one yet (a game
//            from before summaries) reads every pick instead and is
//            summarized here the same way.
//   mine     the viewer's own pick (users/{uid}/picks/{id}); mineCounted:
//            whether the summary already includes it (it may lag a few
//            minutes — pickView folds a newer one in).
// Three reads (four with a pick of your own) however many fans picked.
function useGamePicks(wedraftGameId) {
  const { user } = useAuth();
  const uid = user?.uid || null;
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    if (!wedraftGameId) return undefined;
    (async () => {
      const [g, sum, own] = await Promise.all([
        getDoc(doc(db, "schedule26", wedraftGameId)),
        getDoc(doc(db, "wePickSummaries", wedraftGameId)).catch(() => null),
        uid ? getDoc(doc(db, "users", uid, "picks", wedraftGameId)).catch(() => null) : null,
      ]);
      const sched = g.exists() ? g.data() : {};
      const mine = own?.exists() ? { uid, ...own.data() } : null;
      if (sum?.exists()) {
        const summary = sum.data();
        return { sched, summary, mine, mineCounted: !!mine && (toMs(mine.updatedAt) || 0) <= (summary.builtAt || 0) };
      }
      const ps = await getDocs(collection(db, "schedule26", wedraftGameId, "picks"));
      const picks = ps.docs.map((d) => ({ uid: d.id, ...d.data() }));
      const own2 = mine || picks.find((p) => p.uid === uid) || null;
      return { sched, summary: summarizePicks(picks), mine: own2, mineCounted: !!own2 && picks.some((p) => p.uid === uid) };
    })()
      .then((st) => { if (alive) setState(st); })
      .catch(() => { if (alive) setState({ sched: {}, summary: summarizePicks([]), mine: null, mineCounted: false }); });
    return () => { alive = false; };
  }, [wedraftGameId, uid]);
  return state;
}

// Older public picks, newest first, MORE_PICKS_PAGE per page — read only
// when someone opens the full list (the summary carries the newest).
const MORE_PICKS_PAGE = 50;
function useMorePicks(wedraftGameId, pages) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!wedraftGameId) { setList(null); return undefined; }
    getDocs(query(collection(db, "schedule26", wedraftGameId, "picks"), orderBy("updatedAt", "desc"), limit(pages * MORE_PICKS_PAGE)))
      .then((snap) => {
        if (!alive) return;
        const out = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter(pickPublic).map(listedPick);
        out.full = snap.size >= pages * MORE_PICKS_PAGE; // a full page: there may be more
        setList(out);
      })
      .catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [wedraftGameId, pages]);
  return list;
}


// The recap's one-line story of the game: "Ohio State routs Iowa 42–10,
// moving to 4-1. Iowa drops to 4-1." The verb follows the margin (blowout,
// comfortable, close, a field goal or less), with shutouts, overtime and
// ranked upsets called out; the wording is picked per game (stable across
// refreshes, varied across games).
const RESULT_VERBS = {
  ot: ["outlasts", "survives", "gets past"],
  shutout: ["shuts out", "blanks", "shuts down"],
  rout: ["routs", "rolls past", "cruises past", "dominates", "runs away from"],
  solid: ["handles", "pulls away from", "takes care of", "beats"],
  win: ["defeats", "beats", "gets past", "tops"],
  close: ["holds off", "edges", "fends off", "outlasts"],
  nail: ["squeaks past", "survives", "escapes", "edges"],
};
const WIN_REC = [(r) => `moving to ${r}`, (r) => `improving to ${r}`, (r) => `to go ${r}`];
const LOSE_REC = [(t, r) => `${t} drops to ${r}`, (t, r) => `${t} falls to ${r}`, (t, r) => `${t} slips to ${r}`];
const pickBy = (list, seed) => list[Math.abs(seed) % list.length];
const seedOf = (id) => String(id || "").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const wl = (rec) => { const m = /^(\d+)-(\d+)$/.exec(rec || ""); return m ? [Number(m[1]), Number(m[2])] : null; };

function resultSentence(game, win, lose, winRec, loseRec) {
  const seed = seedOf(game.id || game.providerGameId);
  const wPts = win.points ?? 0, lPts = lose.points ?? 0;
  const margin = wPts - lPts;
  const nm = (t) => `${t.rank ? `#${t.rank} ` : ""}${t.school || t.name || teamShort(t)}`;
  const upset = !!lose.rank && (!win.rank || win.rank > lose.rank);
  const kind = (game.period || 0) > 4 ? "ot" : lPts === 0 ? "shutout"
    : margin >= 28 ? "rout" : margin >= 15 ? "solid" : margin >= 8 ? "win" : margin >= 4 ? "close" : "nail";
  const verb = upset && kind !== "shutout" ? pickBy(["upsets", "stuns", "knocks off"], seed) : pickBy(RESULT_VERBS[kind], seed);
  const score = `${wPts}–${lPts}${kind === "ot" ? " in overtime" : ""}`;
  const w = wl(winRec), l = wl(loseRec);
  const winClause = winRec ? (w && w[1] === 0 && w[0] >= 3 ? `, staying unbeaten at ${winRec}` : `, ${pickBy(WIN_REC, seed >> 3)(winRec)}`) : "";
  const loseName = lose.school || lose.name || teamShort(lose);
  const loseClause = loseRec ? (l && l[1] === 1 && l[0] >= 3 ? ` ${loseName} suffers its first loss and falls to ${loseRec}.` : ` ${pickBy(LOSE_REC, seed >> 5)(loseName, loseRec)}.`) : "";
  return { lead: nm(win), rest: ` ${verb} ${nm(lose)} ${score}${winClause}.${loseClause}` };
}

function GameRecap({ game, gameId, slateGame }) {
  const { user } = useAuth();
  const { stats } = useLiveStats(gameId);
  const picks = useGamePicks(game?.wedraftGameId);
  if (!game) return null;
  const hp = game.home?.points ?? 0, ap = game.away?.points ?? 0;
  const winSide = hp >= ap ? "home" : "away";
  const loseSide = winSide === "home" ? "away" : "home";
  const win = game[winSide] || {};
  const lose = game[loseSide] || {};
  // New records (W-L, this game included) — on the slate's copy of the game.
  const recOf = (side) => slateGame?.[side]?.record || null;

  // Top performer on the winning team.
  const top = (stats?.players?.[winSide] || [])
    .map((l) => ({ l, v: perfScore(l.stats) })).sort((a, b) => b.v - a.v)[0]?.l || null;
  const topLines = top ? LEADER_CATS.map((cat) => [YW_CATS[cat], statLine(cat, top.stats?.[cat])]).filter(([, t]) => t) : [];

  // We-Pick: fans' average predicted final, and how many called the winner.
  let wp = null;
  const pv = pickView(picks, user?.uid);
  if (pv && (pv.summary.count || pv.summary.scored)) {
    const S = pv.summary;
    const swapped = !!pv.sched.Home && pv.sched.Home === game.away.school;
    // (the summary is in schedule26's orientation; a swapped game's "home" is /live's away)
    const schedSide = (sd) => (swapped ? (sd === "home" ? "away" : "home") : sd);
    const avg = (k) => Math.round(S.sum[k] / (S.scored || 1));
    const avgHome = avg(schedSide("home"));
    const avgAway = avg(schedSide("away"));
    const right = S.split[schedSide(winSide)] || 0;
    const exact = S.scores[swapped ? `${hp}-${ap}` : `${ap}-${hp}`] || 0;
    const mine = pv.mine;
    const schedFinal = swapped ? { Final: true, HomeScore: ap, AwayScore: hp } : { Final: true, HomeScore: hp, AwayScore: ap };
    wp = {
      total: S.count, right, pct: S.count ? Math.round((100 * right) / S.count) : 0,
      avgHome, avgAway, scoredCount: S.scored, exact,
      mine: mine && hasScorePick(mine) ? {
        home: swapped ? mine.awayScore : mine.homeScore, away: swapped ? mine.homeScore : mine.awayScore,
        points: scoreGamePick(mine, schedFinal),
        ranked: mine.ranked === true,
      } : null,
    };
  }

  return (
    <div className="wdl-recap">
      {/* The result as a sentence, with each team's new record. */}
      {(() => {
        const line = resultSentence(game, win, lose, recOf(winSide), recOf(loseSide));
        return (
          <div className="lpc" style={{ "--tc": win.color || GOLD }}>
            <div className="lpc-head"><span className="lpc-badge">🏁 {(game.period || 0) > 4 ? "FINAL / OT" : "FINAL"}</span></div>
            <div className="wdl-recap-headline"><b>{line.lead}</b>{line.rest}</div>
          </div>
        );
      })()}
      {top && (
        <div className="lpc" style={{ "--tc": win.color || GOLD }}>
          <div className="lpc-head">
            <span className="lpc-badge">⭐ TOP PERFORMER</span>
            <span className="lpc-team">{(win.logoDark || win.logo) && <img src={win.logoDark || win.logo} alt="" />}{teamShort(win)}</span>
          </div>
          {top.slug
            ? <Link to={`/player/${top.slug}`} target="_blank" rel="noopener noreferrer" className="wdl-recap-name">{top.name}</Link>
            : <div className="wdl-recap-name">{top.name}</div>}
          <div className="wdl-recap-lines">{topLines.map(([k, v]) => <div key={k}><span>{k}</span>{v}</div>)}</div>
        </div>
      )}
      {game.wedraftGameId && (
        <div className="lpc" style={{ "--tc": "#7c3aed" }}>
          <div className="lpc-head"><span className="lpc-badge">🔮 WE-PICK RESULTS</span></div>
          {!picks ? <div className="wdl-recap-sub">Loading picks…</div>
            : !wp ? <div className="wdl-recap-sub">No We-Pick picks on this game.</div>
              : <>
                {wp.scoredCount > 0 && (
                  <div className="wdl-recap-big"><small>Fans predicted</small>{winFirst(game, wp.avgAway, wp.avgHome)}</div>
                )}
                <div className="wdl-recap-sub">
                  Final: {winFirst(game, ap, hp)}
                </div>
                <div className="wdl-recap-big" style={{ marginTop: 10 }}>{wp.pct}%<small style={{ marginLeft: 8 }}>picked {teamShort(win)} · {wp.right} of {wp.total}</small></div>
                <div className="wdl-recap-bar" style={{ "--tc": win.color || GOLD }}><i style={{ width: `${wp.pct}%` }} /></div>
                {wp.exact > 0 && <div className="wdl-recap-sub">🎯 {wp.exact} nailed the exact score</div>}
                {wp.mine && (
                  <div className="wdl-recap-sub" style={{ color: "#eef2f8" }}>
                    Your pick: {winFirst(game, wp.mine.away, wp.mine.home)} · <span style={{ color: wp.mine.points > 0 ? "#3ddc84" : "#ff6b6b" }}>{wp.mine.points} pts</span>
                    {" "}{wp.mine.ranked ? <span className="wdl-rk on">⭐ Ranked</span> : <span className="wdl-rk">Unranked</span>}
                  </div>
                )}
              </>}
        </div>
      )}
    </div>
  );
}

// ── Upcoming games ── a scheduled game opens on its Preview (tale of the
// tape: records, then points and yards (total / passing / rushing) per
// game, gained and allowed, turnover margin and 3rd down %, with national
// ranks) with a
// Prospects tab (the We-Draft prospects on both sides, with grades and
// community strengths/weaknesses); the right rail (or the top, on phones)
// is the We-Pick card — your score pick, the community split and the
// public picks.

// Both teams' CFBD rosters (cfbRosters/{teamId}, written weekly by
// scripts/syncCfbdRosters.js) — two reads.
function useTeamRosters(homeId, awayId) {
  const [rosters, setRosters] = useState(null);
  useEffect(() => {
    let alive = true;
    setRosters(null);
    Promise.all([homeId, awayId].map((id) => (id == null ? Promise.resolve(null)
      : getDoc(doc(db, "cfbRosters", String(id))).then((d) => (d.exists() ? d.data() : null)).catch(() => null))))
      .then(([home, away]) => { if (alive) setRosters({ home, away }); });
    return () => { alive = false; };
  }, [homeId, awayId]);
  return rosters;
}

// Each school's We-Draft prospects (active classes, Live), best community
// grade first, with their top community strengths/weaknesses — two players
// queries + the grades snapshot.
const PREVIEW_CLASSES = ["2027", "2028", "2029"];
const PREVIEW_HIDDEN = [false, null, 0, "false", "no"];
function useSchoolProspects(homeSchool, awaySchool) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    const load = async (school) => {
      if (!school) return [];
      const snap = await getDocs(query(collection(db, "players"), where("School", "==", school)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => PREVIEW_CLASSES.includes(String(p.Eligible)) && !PREVIEW_HIDDEN.includes(p.Live) && p.Slug);
    };
    Promise.all([load(homeSchool), load(awaySchool)]).then(async ([home, away]) => {
      const comm = await communityFor([...home, ...away].map((p) => p.id));
      const rank = (list) => list.map((p) => ({ ...p, ...(comm[p.id] || { avg: null, strengths: [], weaknesses: [] }) }))
        .sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99) || String(a.Eligible).localeCompare(String(b.Eligible)));
      if (alive) setState({ home: rank(home), away: rank(away) });
    }).catch(() => { if (alive) setState({ home: [], away: [] }); });
    return () => { alive = false; };
  }, [homeSchool, awaySchool]);
  return state;
}

const sN = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
// A player's season line for his position, from roster season stats (s).
function seasonLine(s = {}, pos = "") {
  const pa = s.passing || {}, ru = s.rushing || {}, re = s.receiving || {}, de = s.defensive || {}, it = s.interceptions || {};
  const parts = [];
  if (sN(pa.ATT) && (pos === "QB" || sN(pa.YDS) > 100)) parts.push(`${sN(pa.COMPLETIONS)}/${sN(pa.ATT)}, ${sN(pa.YDS)} pass yds, ${sN(pa.TD)} TD`);
  if (sN(ru.CAR) && (pos === "RB" || sN(ru.YDS) >= 100)) parts.push(`${sN(ru.YDS)} rush yds, ${sN(ru.TD)} TD`);
  if (sN(re.REC) && (pos !== "QB")) parts.push(`${sN(re.REC)} rec, ${sN(re.YDS)} yds, ${sN(re.TD)} TD`);
  if (sN(de.TOT) || sN(de.SACKS) || sN(it.INT)) {
    parts.push([`${sN(de.TOT)} tkl`, sN(de.TFL) && `${sN(de.TFL)} TFL`, sN(de.SACKS) && `${sN(de.SACKS)} sk`, sN(it.INT) && `${sN(it.INT)} INT`, sN(de.PD) && `${sN(de.PD)} PBU`].filter(Boolean).join(", "));
  }
  return parts.join(" · ");
}

// Each team's season leaders, from its roster doc's season stats (s):
// label, unit, the stat, and a short line under the name.
const TEAM_LEADERS = [
  ["Passing", "yds", (st) => sN(st.passing?.YDS), (st) => `${sN(st.passing?.COMPLETIONS)}/${sN(st.passing?.ATT)}, ${sN(st.passing?.TD)} TD, ${sN(st.passing?.INT)} INT`],
  ["Rushing", "yds", (st) => sN(st.rushing?.YDS), (st) => `${sN(st.rushing?.CAR)} car, ${sN(st.rushing?.TD)} TD`],
  ["Receiving", "yds", (st) => sN(st.receiving?.YDS), (st) => `${sN(st.receiving?.REC)} rec, ${sN(st.receiving?.TD)} TD`],
  ["Tackles", "tkl", (st) => sN(st.defensive?.TOT), (st) => `${sN(st.defensive?.TFL)} TFL`],
  ["Sacks", "sk", (st) => sN(st.defensive?.SACKS), null],
  ["Interceptions", "int", (st) => sN(st.interceptions?.INT), null],
];
function leaderOf(roster, get) {
  let best = null;
  for (const p of roster?.players || []) {
    const v = get(p.s || {});
    if (v > 0 && (!best || v > best.v)) best = { p, v };
  }
  return best;
}

// A team's whole roster on a game (Preview, and live — not once it's
// final): the team page's roster table (components/TeamRoster.js), from
// cfbRosters/{teamId}. `roster` when the caller already has it (Preview).
function GameRoster({ game, side, roster: given, loading }) {
  const t = game[side] || {};
  const fetched = useTeamRosters(given === undefined && side === "home" ? t.providerTeamId : null, given === undefined && side === "away" ? t.providerTeamId : null);
  const roster = given !== undefined ? given : fetched?.[side];
  const pending = given !== undefined ? loading : !fetched;
  const narrow = typeof window !== "undefined" && window.innerWidth < 760;
  if (pending) return <div className="wdl-empty">Loading the {teamShort(t)} roster…</div>;
  if (!roster?.players?.length) return <div className="wdl-empty">No roster on file for {teamShort(t)} yet.</div>;
  return (
    <div className="wdl-roster">
      <TeamRoster roster={roster} color1={t.color || "#1d2840"} color2={t.color2 || "#f6a21d"} isMobile={narrow} dark hideStars newTab />
    </div>
  );
}

function PreviewView({ game, slateGame }) {
  const [tab, setTab] = useState("preview");
  const rosters = useTeamRosters(game.home?.providerTeamId, game.away?.providerTeamId);
  const pros = useSchoolProspects(game.home?.school, game.away?.school);
  const teamStats = useFbsTeamStats();
  const ts = { home: teamStats?.get(Number(game.home?.providerTeamId)), away: teamStats?.get(Number(game.away?.providerTeamId)) };
  const rec = (side) => slateGame?.[side]?.record || game[side]?.record || null;
  // Gold = the better number on a row.
  const edge = (a, b, low = false) => (a == null || b == null || a === b ? [false, false] : low ? [a < b, b < a] : [a > b, b > a]);
  // A per-game row: the label, both teams' averages over their national
  // ranks, gold on the better one (low: fewer is better — yards / points
  // allowed). An FCS team has no line.
  const cell = (t, k) => (t?.v?.[k] == null ? <span style={{ color: "#6f819c" }}>—</span>
    : <>{fmtTeamStat(k, t.v[k])}{t.r?.[k] && <small>{t.r[k].replace(/^(T-)?/, "$1#")} in FBS</small>}</>);
  const stat = (label, k, low = false) => [label, cell(ts.away, k), cell(ts.home, k), edge(ts.away?.v?.[k], ts.home?.v?.[k], low)];
  const rows = [
    ["Record", rec("away") || "—", rec("home") || "—", [false, false]],
    stat("Points / game", "ppg"),
    stat("Points allowed", "papg", true),
    stat("Total yards / game", "ypg"),
    stat("Total yards allowed", "yapg", true),
    stat("Pass yards / game", "passYpg"),
    stat("Pass yards allowed", "passYapg", true),
    stat("Rush yards / game", "rushYpg"),
    stat("Rush yards allowed", "rushYapg", true),
    stat("Turnover margin / game", "toMargin"),
    stat("3rd down %", "thirdPct"),
    stat("3rd down % allowed", "thirdPctA", true),
  ];
  // Leaders: the player's name as the header (a link when he has a
  // We-Draft profile), then the stat and his line under it.
  const leaderCell = (x, unit, line) => (!x ? <span style={{ color: "#6f819c" }}>—</span> : <>
    <span className="nm">{x.p.slug ? <Link to={`/player/${x.p.slug}`} target="_blank" rel="noopener noreferrer">{x.p.first} {x.p.last}</Link> : `${x.p.first} ${x.p.last}`}{x.p.pos && <span className="u"> {x.p.pos}</span>}</span>
    <small className="stat">{Number.isInteger(x.v) ? x.v.toLocaleString() : x.v} {unit}</small>
    {line && <small className="sub">{line(x.p.s || {})}</small>}
  </>);
  const leaderRows = TEAM_LEADERS.map(([label, unit, get, line]) => {
    const a = leaderOf(rosters?.away, get);
    const h = leaderOf(rosters?.home, get);
    return [label, leaderCell(a, unit, line), leaderCell(h, unit, line)];
  });
  const head = (side) => {
    const t = game[side] || {};
    return <span className={`t ${side}`}>{side === "away" && (t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}{teamShort(t)}{side === "home" && (t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}</span>;
  };
  const bySlug = (side) => new Map((rosters?.[side]?.players || []).filter((p) => p.slug).map((p) => [p.slug, p]));
  const prospectCol = (side) => {
    const t = game[side] || {};
    const list = pros?.[side] || [];
    const roster = bySlug(side);
    return (
      <div key={side}>
        <div className="wdl-pros-team">{(t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}{teamShort(t)}</div>
        {!pros ? <div className="wdl-cust-sub">Loading…</div>
          : !list.length ? <div className="wdl-cust-sub">No We-Draft prospects on this roster yet.</div>
            : list.slice(0, 12).map((p) => {
              const r = roster.get(p.Slug);
              const line = r?.s ? seasonLine(r.s, p.Position) : "";
              return (
                <Link key={p.id} to={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" className="wdl-pro" style={{ "--tc": t.color || "#2a3753" }}>
                  <span className="n">{p.First} {p.Last}<small>{[p.Position, p.Eligible].filter(Boolean).join(" · ")}</small></span>
                  <span className="g">{gradeLabel(p.avg) || "Watchlist"}</span>
                  <span className="l">{line || "No stats yet this season"}</span>
                  {(p.strengths?.length > 0 || p.weaknesses?.length > 0) && (
                    <span className="wdl-pro-traits">
                      {p.strengths.map((x) => <span key={`s${x}`} className="up">▲ {x}</span>)}
                      {p.weaknesses.map((x) => <span key={`w${x}`} className="dn">▼ {x}</span>)}
                    </span>
                  )}
                </Link>
              );
            })}
      </div>
    );
  };
  return (
    <div>
      <div className="wdl-gtabs">
        <button className={`wdl-gtab${tab === "preview" ? " on" : ""}`} onClick={() => setTab("preview")}>Preview</button>
        <button className={`wdl-gtab${tab === "prospects" ? " on" : ""}`} onClick={() => setTab("prospects")}>Prospects{pros ? ` · ${(pros.home?.length || 0) + (pros.away?.length || 0)}` : ""}</button>
        {["away", "home"].map((side) => (
          <button key={side} className={`wdl-gtab${tab === `roster-${side}` ? " on" : ""}`} onClick={() => setTab(`roster-${side}`)}>{teamShort(game[side])} roster</button>
        ))}
        {/* Pregame chat — open from game week (components/LiveChat.js). */}
        <button className={`wdl-gtab${tab === "chat" ? " on" : ""}`} onClick={() => setTab("chat")}>💬 Chat</button>
      </div>
      {tab === "chat" ? <LiveChat gameId={String(game.id)} game={game} />
        : tab.startsWith("roster-") ? <GameRoster game={game} side={tab.slice(7)} roster={rosters ? rosters[tab.slice(7)] || null : null} loading={!rosters} />
        : tab === "preview" ? (<>
      <div className="wdl-pv-sec">
        <div className="wdl-h">Tale of the tape</div>
        <div className="wdl-tape">
          <div className="wdl-tape-head">{head("away")}<span className="k" style={{ color: "#6f819c", fontSize: 11 }}>vs</span>{head("home")}</div>
          {rows.filter(([, a, h]) => !(a === "—" && h === "—")).map(([k, a, h, [ea, eh]]) => (
            <div key={k} className="wdl-tape-row">
              <span className={`v${ea ? " edge" : ""}`}>{a}</span>
              <span className="k">{k}</span>
              <span className={`v home${eh ? " edge" : ""}`}>{h}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="wdl-pv-sec">
        <div className="wdl-h">Leaders</div>
        <div className="wdl-tape">
          <div className="wdl-tape-head">{head("away")}<span className="k" style={{ color: "#6f819c", fontSize: 11 }}>vs</span>{head("home")}</div>
          {!rosters ? <div className="wdl-empty">Loading leaders…</div> : leaderRows.map(([k, a, h]) => (
            <div key={k} className="wdl-tape-row">
              <span className="v">{a}</span>
              <span className="k">{k}</span>
              <span className="v home">{h}</span>
            </div>
          ))}
        </div>
      </div>
      </>) : (
      <div className="wdl-pv-sec">
        <div className="wdl-h">Prospects to watch</div>
        <div className="wdl-pros-cols">{prospectCol("away")}{prospectCol("home")}</div>
      </div>
      )}
    </div>
  );
}

// ⓘ next to a We-Pick header: a short intro to We-Pick on hover (or tap /
// keyboard focus — the bubble shows while the button has focus).
function WePickInfo() {
  return (
    <span className="wdl-wpi">
      <button type="button" className="wdl-wpi-btn" aria-label="What is We-Pick?">i</button>
      <span className="wdl-wpi-tip" role="tooltip">
        <b>What is We-Pick?</b>
        We-Draft's free college football pick'em. Predict the final score of any game — picks open the Monday of game week and lock at kickoff.
        <span className="gap" />
        Your Ranked 6 picks each week are scored for the We-Pick standings. The <b className="inline">Community Pick</b> is every fan's prediction averaged together.
        <Link to={wePickHref()} className="go">Play We-Pick →</Link>
      </span>
    </span>
  );
}

// We-Pick on an upcoming game: your score pick (made or edited here — same
// doc pair and fields as the game page's pick, see GamePage.js
// handleSavePick) and the community's split + average predicted score.
function PreviewPickCard({ game, withInfo = false }) {
  const { user, profile, login } = useAuth();
  const data = useGamePicks(game?.wedraftGameId);
  const [vals, setVals] = useState({ away: "", home: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [mineLocal, setMineLocal] = useState(null);
  const [showAllPicks, setShowAllPicks] = useState(false);
  const [morePages, setMorePages] = useState(1);
  // Switching games reuses this card — start the new game clean (the last
  // game's typed score, message and saved pick must not carry over).
  useEffect(() => {
    setVals({ away: "", home: "" }); setMsg(""); setMineLocal(null); setShowAllPicks(false); setMorePages(1); setSwap(null);
  }, [game?.wedraftGameId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The Ranked 6 swap chooser (components/RankedSwap.js), open when this
  // pick should be ranked but the week's 6 are full: { ranked } (the other
  // ranked picks). swapBusy: the pick being swapped out / "rank" while ranking.
  const [swap, setSwap] = useState(null);
  const [swapBusy, setSwapBusy] = useState("");
  const swapped = !!data?.sched?.Home && data.sched.Home === game.away.school;
  // The community summary with your own pick folded in (pickView).
  const view = useMemo(() => pickView(data, user?.uid, mineLocal), [data, user?.uid, mineLocal]);
  const S = view?.summary || null;
  const mine = view?.mine || null;
  // Public picks: the summary's newest, then — only when asked for — older
  // ones a page at a time (useMorePicks).
  const more = useMorePicks(showAllPicks && S && S.publicCount > (S.recent || []).length ? game?.wedraftGameId : null, morePages);
  const publicPicks = useMemo(() => {
    const seen = new Set();
    return [...(S?.recent || []), ...(more || [])].filter((r) => !seen.has(r.uid) && seen.add(r.uid));
  }, [S, more]);
  // Verified badges: in the summary; looked up only for the older ones loaded.
  const verifiedMore = useVerifiedUids((more || []).map((r) => r.uid));
  // A pick's scores in /live's orientation.
  const live = (p) => ({ home: swapped ? p.awayScore : p.homeScore, away: swapped ? p.homeScore : p.awayScore });
  useEffect(() => {
    if (mine && hasScorePick(mine)) { const m = live(mine); setVals({ away: String(m.away), home: String(m.home) }); }
  }, [mine?.awayScore, mine?.homeScore, swapped]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!game?.wedraftGameId) return null;
  // Same open/lock rule as We-Pick's My Picks (utils/wePickLocks.js): opens
  // the Monday of the game's week (or when an admin force-opens it), locks
  // at kickoff.
  const sched = data?.sched || null;
  const open = !!sched && game.status === "scheduled" && isPickable(sched);
  const opensAt = sched && !open && game.status === "scheduled" && toMs(sched.Date) ? mondayOfWeekUtc(toMs(sched.Date)) : null;
  const notYet = opensAt != null && Date.now() < opensAt && !sched.PicksForceOpen;
  // The split and the average score, in /live's orientation (the summary
  // is in schedule26's).
  const total = S?.count || 0;
  const liveSide = (sd) => (swapped ? (sd === "home" ? "away" : "home") : sd);
  const awayPct = total ? Math.round((100 * (S.split[liveSide("away")] || 0)) / total) : 0;
  const avg = (k) => Math.round((S?.sum?.[liveSide(k)] || 0) / (S?.scored || 1));

  const rankThis = async () => {
    if (!user || !sched?.Week) return;
    setSwapBusy("rank"); setMsg("");
    try {
      const { ranked } = await loadWeekRanked(user.uid, sched.Week);
      const others = ranked.filter((r) => r.id !== game.wedraftGameId);
      if (others.length < RANKED_SIZE) {
        await swapRanked(user.uid, null, game.wedraftGameId);
        setMineLocal((m) => ({ ...(m || mine), ranked: true }));
        setMsg("Pick saved!");
      } else {
        setSwap({ ranked: others });
      }
    } catch {
      setMsg("Couldn't update your Ranked 6 — try again.");
    } finally {
      setSwapBusy("");
    }
  };
  const swapOut = async (outId) => {
    setSwapBusy(outId);
    try {
      await swapRanked(user.uid, outId, game.wedraftGameId);
      setMineLocal((m) => ({ ...(m || mine), ranked: true }));
      setSwap(null);
      setMsg("Swapped into your Ranked 6!");
    } catch {
      setMsg("Couldn't swap — try again.");
    } finally {
      setSwapBusy("");
    }
  };

  const save = async () => {
    if (!user) { login(); return; }
    if (vals.away.trim() === "" || vals.home.trim() === "") { setMsg("Enter a score for both teams."); return; }
    const a = Math.max(0, Math.min(99, Math.round(Number(vals.away)))), h = Math.max(0, Math.min(99, Math.round(Number(vals.home))));
    const awayScore = swapped ? h : a, homeScore = swapped ? a : h;
    const hadScore = hasScorePick(mine);
    setSaving(true); setMsg("");
    // A new score pick joins the Ranked 6 only while the week has room —
    // a 7th ranked pick would disqualify the week (utils/wePickRanked.js).
    let ranked = hadScore ? (mine.ranked ?? true) : false;
    if (!hadScore && !sched?.RankedDisqualified) {
      try { ranked = await hasRankedRoom(user.uid, sched?.Week, game.wedraftGameId); } catch { ranked = false; }
    }
    const payload = {
      uid: user.uid,
      displayName: profile?.username?.trim() || "Anonymous Fan",
      pickType: "score",
      pickedTeam: awayScore > homeScore ? "away" : homeScore > awayScore ? "home" : null,
      awayScore, homeScore,
      prediction: mine?.prediction || "",
      ranked,
      visibility: mine?.visibility || "public",
      updatedAt: serverTimestamp(),
    };
    try {
      await Promise.all([
        setDoc(doc(db, "schedule26", game.wedraftGameId, "picks", user.uid), payload),
        setDoc(doc(db, "users", user.uid, "picks", game.wedraftGameId), payload),
      ]);
      setMineLocal({ ...payload, updatedAt: new Date() });
      setMsg("Pick saved!");
      const w = a > h ? game.away : h > a ? game.home : null;
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors: [w?.color || GOLD, "#ffffff"], disableForReducedMotion: true });
    } catch (e) {
      setMsg(open ? "Couldn't save — try again." : "Picks are locked — this game has kicked off.");
    } finally {
      setSaving(false);
    }
  };

  const row = (side) => {
    const t = game[side] || {};
    return (
      <label className="wdl-pick-row">
        {(t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}
        <span className="nm">{teamShort(t)}</span>
        <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={vals[side]} disabled={!open || saving}
          onChange={(e) => setVals((v) => ({ ...v, [side]: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) }))} />
      </label>
    );
  };
  return (
    <div className="lpc" style={{ "--tc": "#7c3aed" }}>
      <div className="lpc-head">
        <span className="lpc-badge">🔮 WE-PICK</span>{withInfo && <WePickInfo />}
        {game.gameOfWeek ? <span className="wdl-strip-pill gotw">GOTW</span> : game.featured ? <span className="wdl-strip-pill feat">Featured</span> : null}
      </div>
      {open ? (
        <div className="wdl-pick-form">
          {row("away")}
          {row("home")}
          <button className="wdl-pick-save" disabled={saving} onClick={save}>{!user ? "Log in to pick" : saving ? "Saving…" : hasScorePick(mine) ? "Update my pick" : "Lock in my pick"}</button>
          {msg && <div className="wdl-recap-sub" style={{ color: /^(Pick saved|Swapped)/.test(msg) ? "#3ddc84" : "#ff8a7a" }}>{msg}</div>}
          {hasScorePick(mine) && (
            <div className="wdl-recap-sub">
              {mine.ranked ? <span className="wdl-rk on">⭐ Ranked</span> : <span className="wdl-rk">Unranked</span>}
              {mine.ranked ? " Counts toward your Ranked 6" : " Doesn't count toward your Ranked 6"}
              {!mine.ranked && !sched?.RankedDisqualified && !swap && (
                <> · <button type="button" className="wdl-rank-it" disabled={!!swapBusy} onClick={rankThis}>{swapBusy === "rank" ? "Ranking…" : "⭐ Rank it"}</button></>
              )}
              {" · "}<Link to={wePickHref()} style={{ color: GOLD }}>Manage in We-Pick</Link>
            </div>
          )}
          {swap && sched && (
            <div style={{ marginTop: 10 }}>
              <RankedSwap week={sched.Week} inGame={{ id: game.wedraftGameId, ...sched }} ranked={swap.ranked}
                busyId={swapBusy && swapBusy !== "rank" ? swapBusy : ""} onSwap={swapOut} onCancel={() => setSwap(null)} />
            </div>
          )}
        </div>
      ) : (
        <div className="wdl-recap-sub">
          {hasScorePick(mine) ? <>Your pick: {winFirst(game, live(mine).away, live(mine).home)} {mine.ranked ? <span className="wdl-rk on">⭐ Ranked</span> : <span className="wdl-rk">Unranked</span>}</>
            : !data ? "Loading…"
              : notYet ? `Picks open ${new Date(opensAt).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}.`
                : "Picks are locked."}
        </div>
      )}
      {total > 0 ? (() => {
        // The Community Pick: every fan's score pick averaged (the big
        // score, the favorite lit up), over who they're picking to win.
        const aAvg = S.scored ? avg("away") : null;
        const hAvg = S.scored ? avg("home") : null;
        const fav = aAvg != null && aAvg !== hAvg ? (aAvg > hAvg ? "away" : "home") : awayPct !== 50 ? (awayPct > 50 ? "away" : "home") : null;
        const side = (sd) => {
          const t = game[sd] || {};
          return (
            <div className={`wdl-cp-team ${sd}${fav === sd ? " fav" : fav ? " dog" : ""}`}>
              {(t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}
              <span className="nm">{teamShort(t)}</span>
            </div>
          );
        };
        return (
          <div className="wdl-cp">
            <div className="wdl-cp-h"><span>Community Pick</span><small>{total} pick{total === 1 ? "" : "s"}</small></div>
            <div className="wdl-cp-board">
              {side("away")}
              {aAvg != null ? (
                <div className="wdl-cp-score">
                  <b className={fav === "away" ? "fav" : ""}>{aAvg}</b><span>–</span><b className={fav === "home" ? "fav" : ""}>{hAvg}</b>
                </div>
              ) : <div className="wdl-cp-score none">vs</div>}
              {side("home")}
            </div>
            <div className="wdl-pick-split">
              <i style={{ width: `${awayPct}%`, background: distinctTeamColors(game.away, game.home, ["#4d9fff", GOLD])[0] }} />
              <i style={{ width: `${100 - awayPct}%`, background: distinctTeamColors(game.away, game.home, ["#4d9fff", GOLD])[1] }} />
            </div>
            <div className="wdl-pick-legend"><span>{awayPct}% pick {teamShort(game.away)}</span><span>{100 - awayPct}% pick {teamShort(game.home)}</span></div>
            {aAvg == null && <div className="wdl-recap-sub">No score picks yet — the average score shows once fans predict one.</div>}
          </div>
        );
      })() : data && open && <div className="wdl-recap-sub">No picks yet — be the first.</div>}
      {S && publicPicks.length > 0 && (
        <div className="wdl-picklist">
          <div className="wdl-picklist-h">Public picks</div>
          {publicPicks.slice(0, showAllPicks ? publicPicks.length : 12).map((p) => {
            const sc = p.away != null && p.home != null ? live({ awayScore: p.away, homeScore: p.home }) : null;
            const side = p.side ? liveSide(p.side) : null;
            const t = side ? game[side] : null;
            return (
              <div key={p.uid} className={`wdl-picklist-row${user && p.uid === user.uid ? " me" : ""}`}>
                <span className="who"><VerifiedNameBadge uid={p.uid} name={p.name || "Anonymous Fan"} verified={!!(p.verified ?? verifiedMore[p.uid])} size={13} />{user && p.uid === user.uid ? " (you)" : ""}{p.ranked && sc && <span title="In their Ranked 6"> ⭐</span>}</span>
                <span className="pk">
                  {t && (t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}
                  {sc ? `${Math.max(sc.away, sc.home)}–${Math.min(sc.away, sc.home)}` : t ? teamShort(t) : ""}
                </span>
                {p.prediction && <span className="txt">“{p.prediction}”</span>}
              </div>
            );
          })}
          {S.publicCount > 12 && (
            <button className="wdl-picklist-more" onClick={() => setShowAllPicks((v) => !v)}>{showAllPicks ? "Show fewer" : `Show all ${S.publicCount}`}</button>
          )}
          {showAllPicks && more?.full && publicPicks.length < S.publicCount && (
            <button className="wdl-picklist-more" onClick={() => setMorePages((n) => n + 1)}>Show more</button>
          )}
        </div>
      )}
    </div>
  );
}

// The right rail on a game: Game Recap once it's final, the We-Pick card
// before kickoff, else (live) the Feed.
function GameRecapRail({ gameId, slateGame, fallback }) {
  const { game: live, ready } = useLiveGame(gameId, { plays: "none", box: false });
  const scheduled = useScheduledGame(ready && !live && !slateGame ? gameId : null);
  const game = live || slateGame || scheduled || null;
  if (game?.status === "final") {
    return (
      <aside className="wdl-rail">
        <div className="wdl-h">Game Recap</div>
        <GameRecap game={live || game} gameId={gameId} slateGame={slateGame} />
      </aside>
    );
  }
  if (game?.status === "scheduled") {
    return (
      <aside className="wdl-rail">
        <div className="wdl-h wdl-h-info">We-Pick <WePickInfo /></div>
        <PreviewPickCard game={game} />
      </aside>
    );
  }
  return fallback;
}

// A game /live hasn't ingested yet (a future week — opened from We-Pick):
// built from its schedule26 row (matched on CFBDGameId) and both schools'
// branding, shaped like a slate game so GameView can show its preview.
// One query for the game, one for the two schools.
// TV channel short names (CBS Sports Network → CBSSN) from the admin's
// tvChannels list — the same list the CFB schedule page uses. One read of
// the (small) collection per page session; until it loads, names show as-is.
let tvShortsPromise = null;
const tvShorts = {};
function useTvShort() {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!tvShortsPromise) {
      tvShortsPromise = getDocs(collection(db, "tvChannels")).then((snap) => {
        snap.docs.forEach((d) => { const c = d.data(); if (c.Name) tvShorts[c.Name] = c.Short || c.Name; });
      }).catch(() => {});
    }
    let alive = true;
    tvShortsPromise.then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
  }, []);
  return (name) => (name ? tvShorts[name] || name : "");
}

// The latest published Top 25 (utils/rankings.js) — what a future week's
// schedule-built games show, since their own week's poll doesn't exist yet.
let latestRanksPromise = null;
const latestRanks = () => (latestRanksPromise ||= fetchCurrentRankMap().catch(() => ({})));

// A schedule26 row + its two schools' branding (schools docs by name),
// shaped like a slate game.
function scheduledGameFrom(rowId, s, brand, ranks = {}) {
  const team = (name) => {
    const b = brand[name] || {};
    return { name, school: name, short: b.Short || null, logo: b.Logo1 || null, logoDark: b.LogoDark || null, color: b.Color1 || null, rank: ranks[name] ?? null, points: null, providerTeamId: b.CFBDTeamId ?? null };
  };
  const at = s.KickoffAt?.toDate?.() || s.Date?.toDate?.() || null;
  return {
    id: String(s.CFBDGameId ?? rowId), status: "scheduled", scheduleOnly: true,
    startDate: at ? at.toISOString() : null, startTimeTBD: !s.KickoffAt,
    tv: s.Channel || null, slug: s.Slug || null, wedraftGameId: rowId, wedraftWeek: s.Week || null,
    gameOfWeek: !!s.GameOfWeek, featured: !!s.Featured, neutralSite: !!s.Neutral,
    home: team(s.Home), away: team(s.Away),
  };
}
async function schoolBrands(names) {
  const list = [...new Set(names.filter(Boolean))];
  const brand = {};
  for (let i = 0; i < list.length; i += 30) {
    const snap = await getDocs(query(collection(db, "schools"), where("School", "in", list.slice(i, i + 30))));
    snap.docs.forEach((d) => { brand[d.data().School] = d.data(); });
  }
  return brand;
}

// How long a game page that saw its game end waits for the play archive
// before loading every play instead (GameView).
const ARCHIVE_WAIT_MS = 2 * 60 * 1000;

const scheduledCache = new Map(); // CFBD game id → built game (or null), per page session
function useScheduledGame(cfbdGameId) {
  const [game, setGame] = useState(() => (cfbdGameId != null && scheduledCache.has(String(cfbdGameId)) ? scheduledCache.get(String(cfbdGameId)) : undefined)); // undefined = loading/off, null = none
  useEffect(() => {
    let alive = true;
    const id = Number(cfbdGameId);
    if (cfbdGameId == null || !Number.isFinite(id)) { setGame(undefined); return undefined; }
    if (scheduledCache.has(String(id))) { setGame(scheduledCache.get(String(id))); return undefined; }
    setGame(undefined);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "schedule26"), where("CFBDGameId", "==", id), limit(1)));
        const row = snap.docs[0];
        if (!row) { scheduledCache.set(String(id), null); if (alive) setGame(null); return; }
        const sch = row.data();
        const [brand, ranks] = await Promise.all([schoolBrands([sch.Home, sch.Away]), latestRanks()]);
        const built = scheduledGameFrom(row.id, sch, brand, ranks);
        scheduledCache.set(String(id), built);
        if (alive) setGame(built);
      } catch {
        if (alive) setGame(null);
      }
    })();
    return () => { alive = false; };
  }, [cfbdGameId]);
  return game;
}

// Any week's slate for All Games' week browser and Last Week: the week's
// archive (liveSlate/week-{season}-regular-{week} — one doc the ingester
// keeps, server/live/store.js writeSlate: each game as the slate has it,
// with its statLeaders); for a week from before archives, /live's own
// games (liveGames by season + week); else the week's schedule rows (a
// future week). Cached per page session.
const weekGamesCache = new Map();
function useWeekGames(season, week) {
  const key = week ? `${season}-${week}` : null;
  const [games, setGames] = useState(() => (key && weekGamesCache.has(key) ? weekGamesCache.get(key) : null));
  useEffect(() => {
    let alive = true;
    if (!key) { setGames(null); return undefined; }
    if (weekGamesCache.has(key)) { setGames(weekGamesCache.get(key)); return undefined; }
    setGames(null);
    (async () => {
      try {
        const archived = await getDoc(doc(db, "liveSlate", `week-${season}-regular-${week}`));
        let list = archived.exists() ? archived.data().games || [] : [];
        if (!list.length) {
          const live = await getDocs(query(collection(db, "liveGames"), where("season", "==", season), where("week", "==", week), where("seasonType", "==", "regular")));
          list = live.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (!list.length) {
          const rows = await getDocs(query(collection(db, "schedule26"), where("Week", "==", `Week ${week}`)));
          const [brand, ranks] = await Promise.all([schoolBrands(rows.docs.flatMap((d) => [d.data().Home, d.data().Away])), latestRanks()]);
          list = rows.docs.filter((d) => d.data().CFBDGameId != null).map((d) => scheduledGameFrom(d.id, d.data(), brand, ranks));
        }
        weekGamesCache.set(key, list);
        if (alive) setGames(list);
      } catch {
        if (alive) setGames([]);
      }
    })();
    return () => { alive = false; };
  }, [key, season, week]);
  return games;
}

// Last Week (replaces Top Performances while next week is in preview): the
// previous week's top performances and final scores, from its liveGames
// docs (the same per-week load as WeekSlate, cached).
function LastWeek({ season, week, grid, onOpenGame, followedIds, onTogglePlayer }) {
  const games = useWeekGames(season, week > 0 ? week : null);
  const perf = useMemo(() => (games ? performancesFromGames(games) : null), [games]);
  const [tab, setTab] = useState("perf");
  if (!(week > 0)) return <div className="wdl-empty">No previous week yet.</div>;
  if (!games) return <div className="wdl-empty">Loading Week {week}…</div>;
  const finals = games.filter((g) => g.status === "final").sort(byTop25);
  return (
    <div>
      <div className="wdl-gtabs" style={{ marginTop: 0 }}>
        <button className={`wdl-gtab${tab === "perf" ? " on" : ""}`} onClick={() => setTab("perf")}>Performances</button>
        <button className={`wdl-gtab${tab === "scores" ? " on" : ""}`} onClick={() => setTab("scores")}>Scores</button>
      </div>
      {tab === "perf" ? (
        <LivePerformances games={games} perf={perf} initial={5} title={`Top performances · Week ${week}`}
          followedIds={followedIds} onTogglePlayer={onTogglePlayer} onOpenGame={onOpenGame} />
      ) : (
        <>
          <div className="wdl-h">Week {week} scores · {finals.length} final{finals.length === 1 ? "" : "s"}</div>
          {grid(finals, `No Week ${week} finals.`)}
        </>
      )}
    </div>
  );
}

// ‹ Week N › — steps All Games between weeks; "This week" returns to the slate.
function WeekNav({ week, current, onWeek }) {
  return (
    <div className="wdl-weeknav">
      <button disabled={week <= 0} onClick={() => onWeek(week - 1)} aria-label="Previous week">‹</button>
      <span>Week {week}</span>
      <button disabled={week >= 15} onClick={() => onWeek(week + 1)} aria-label="Next week">›</button>
      {current != null && week !== current && <button className="now" onClick={() => onWeek(current)}>This week</button>}
    </div>
  );
}

function WeekSlate({ season, week, current, onWeek, grid }) {
  const games = useWeekGames(season, week);
  const list = games ? [...games].sort((a, b) => sortGames(a, b) || byTop25(a, b)) : [];
  return (
    <div>
      <WeekNav week={week} current={current} onWeek={onWeek} />
      {!games ? <div className="wdl-empty">Loading Week {week}…</div>
        : grid(list, `No games on the Week ${week} slate.`)}
    </div>
  );
}

// School → { color2, mascot } for the given school names (two reads, once
// per game) — for game docs written before the ingester carried them.
function useSchoolExtras(names) {
  const key = names.filter(Boolean).join("|");
  const [map, setMap] = useState({});
  useEffect(() => {
    let alive = true;
    if (!key) return undefined;
    getDocs(query(collection(db, "schools"), where("School", "in", key.split("|"))))
      .then((snap) => {
        if (!alive) return;
        const m = {};
        snap.docs.forEach((d) => { const x = d.data(); if (x.School) m[x.School] = { color2: x.Color2 || null, mascot: x.Mascot || null, slug: x.Slug || x.TeamSlug || null }; });
        setMap(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return map;
}

// A scoreboard score: when it goes up it counts to the new total with a
// pop in the team's second color (`bump`).
function ScoreNum({ value, bump }) {
  const [shown, setShown] = useState(value);
  const [bumpKey, setBumpKey] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from == null || value == null || value <= from) { setShown(value); return undefined; }
    setBumpKey((k) => k + 1);
    const steps = value - from;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(from + i);
      if (i >= steps) clearInterval(id);
    }, Math.max(40, Math.min(110, 700 / steps)));
    return () => clearInterval(id);
  }, [value]);
  return <b key={bumpKey} className={bumpKey ? "wdl-score-bump" : undefined} style={{ "--bump": bump }}>{shown}</b>;
}

// Possession marker on the scoreboard: a plain white football, tipped up
// and away from the middle (the away side's leans left, home's right).
function FootballIcon({ side }) {
  return (
    <svg className={`wdl-mu-fb ${side}`} viewBox="0 0 28 16" role="img" aria-label="Possession">
      <path d="M1 8 C5 -0.5 23 -0.5 27 8 C23 16.5 5 16.5 1 8 Z" fill="#fff" />
    </svg>
  );
}

// Share a game — "Follow Troy vs Southern Miss Live" + its /live/{slug}
// link (the final score once it's over). Phones (and any browser with the
// Web Share API) get the system share sheet — Messages, Mail, anything;
// elsewhere a small menu: Text (sms:), Email (mailto:), Copy link.
function ShareGame({ game }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const a = teamName(game.away) || "Away";
  const h = teamName(game.home) || "Home";
  const url = `https://we-draft.com${liveGameHref(game)}`;
  const text = game.status === "final"
    ? `${a} ${game.away?.points ?? ""}, ${h} ${game.home?.points ?? ""} — final score, stats & recap`
    : game.status === "in_progress" ? `Follow ${a} vs ${h} Live` : `Follow ${a} vs ${h} Live on We-Draft Live`;
  const share = async () => {
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: `${a} vs ${h} | We-Draft Live`, text, url }); } catch { /* dismissed */ }
      return;
    }
    setOpen((v) => !v);
  };
  const body = `${text}\n${url}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ }
  };
  return (
    <div className="wdl-share" ref={ref}>
      <button type="button" className="wdl-mu-week wdl-share-btn" onClick={share} aria-haspopup="menu" aria-expanded={open}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3M6 6.5L10 2.5l4 4M4 10v6.5h12V10" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Share
      </button>
      {open && (
        <div className="wdl-share-menu" role="menu">
          <a role="menuitem" href={`sms:?&body=${encodeURIComponent(body)}`} onClick={() => setOpen(false)}>💬 Text</a>
          <a role="menuitem" href={`mailto:?subject=${encodeURIComponent(`${a} vs ${h} | We-Draft Live`)}&body=${encodeURIComponent(body)}`} onClick={() => setOpen(false)}>✉️ Email</a>
          <button type="button" role="menuitem" onClick={copy}>{copied ? "✓ Copied" : "🔗 Copy link"}</button>
        </div>
      )}
    </div>
  );
}

function GameView({ gameId, slateGame, followedPlayers, onTogglePlayer, focusPlayId, scrollToPlayId, onQueueChange, showRecap, onWeek }) {
  // The scoreboard's big-moment takeover (components/HeaderTakeover.js).
  // takeover: { kind, side, key, hold? } — hold is the score shown until it
  // ends (the old score), then the new one counts up (ScoreNum).
  const [takeover, setTakeover] = useState(null);
  // Takeovers that have played out (by key) — their score is no longer held.
  const doneTakeovers = useRef(new Set());
  const clearTakeover = useCallback(() => setTakeover((t) => { if (t) doneTakeovers.current.add(t.key); return null; }), []);
  // Pop-out scoreboard (desktop Chrome / Edge): an always-on-top Document
  // Picture-in-Picture window the scoreboard + a play line render into, so
  // it can float over other apps and screens. The page's styles are copied in.
  const canWidget = typeof window !== "undefined" && "documentPictureInPicture" in window;
  const [widgetWin, setWidgetWin] = useState(null);
  const openWidget = async () => {
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 620, height: 330 });
      document.querySelectorAll("style, link[rel='stylesheet']").forEach((n) => win.document.head.appendChild(n.cloneNode(true)));
      win.document.title = "We-Draft Live";
      // The site's body padding (index.css pt-20, for the fixed navbar) and
      // scrollbars don't belong in the widget.
      win.document.documentElement.style.cssText = "overflow:hidden;background:#0a0f1a;";
      win.document.body.style.cssText = "margin:0;padding:0;overflow:hidden;background:#0a0f1a;";
      win.addEventListener("pagehide", () => setWidgetWin(null));
      // Its full-screen button: the pop-out itself goes full screen where the
      // browser allows; otherwise the pop-out closes and the scoreboard goes
      // full screen on the page.
      win.document.addEventListener("click", (e) => {
        if (!e.target.closest?.(".wdl-wfull")) return;
        const d = win.document;
        if (d.fullscreenElement) { d.exitFullscreen().catch(() => {}); return; }
        const onPage = () => { win.close(); enterFull(); };
        if (!d.documentElement.requestFullscreen) { onPage(); return; }
        d.documentElement.requestFullscreen().catch(onPage);
      });
      setWidgetWin(win);
    } catch { /* blocked or dismissed */ }
  };
  // Leaving the game closes it.
  useEffect(() => () => { if (widgetWin && !widgetWin.closed) widgetWin.close(); }, [widgetWin]);
  // Pop-out play-by-play: the same kind of window, taller and scrolling —
  // the scoreboard pinned on top, the live log under it. (The browser allows
  // one pop-out at a time, so opening it closes the scoreboard one.)
  const [logWin, setLogWin] = useState(null);
  const openLog = async () => {
    const win = await openPipWindow({ width: 460, height: 720, title: "We-Draft Live · Play-by-play", scroll: true });
    if (!win) return;
    win.addEventListener("pagehide", () => setLogWin(null));
    setLogWin(win);
  };
  useEffect(() => () => { if (logWin && !logWin.closed) logWin.close(); }, [logWin]);
  // Phones / tablets (or browsers without the pop-out): the same icon makes
  // the scoreboard full screen instead — real fullscreen where the browser
  // allows it on an element (Android, iPad), else it just covers the
  // viewport (iPhone Safari).
  const boardRef = useRef(null);
  const [boardFull, setBoardFull] = useState(false);
  const touchish = () => typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 1000);
  const enterFull = () => {
    setBoardFull(true);
    const el = boardRef.current;
    const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    if (req) Promise.resolve(req.call(el)).catch(() => {});
  };
  const exitFull = () => {
    setBoardFull(false);
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
  };
  useEffect(() => {
    if (!boardFull) return undefined;
    // Leaving browser fullscreen (Esc, back gesture) leaves our full screen too.
    const onFs = () => { if (!(document.fullscreenElement || document.webkitFullscreenElement)) setBoardFull(false); };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      document.body.style.overflow = prevOverflow;
    };
  }, [boardFull]);
  // Jumping to a specific play (from the Feed) loads the full play list so
  // an older play can be found, and a final game loads its whole list (its
  // drive summary needs every play) from its play archive — one or two
  // docs (hooks/useLiveGame.js "final"); otherwise just the newest plays.
  const [finalSeen, setFinalSeen] = useState(slateGame?.status === "final");
  const { game: live, plays, ready } = useLiveGame(gameId, { plays: focusPlayId ? "all" : finalSeen ? "final" : "recent", box: false });
  const tvShort = useTvShort();
  // Not on the slate and not ingested yet → its schedule row (future weeks).
  const scheduled = useScheduledGame(ready && !live && !slateGame ? gameId : null);
  // A game that ends while it's open: its archive is written within a tick
  // or two of the final — wait for it (up to ARCHIVE_WAIT_MS) rather than
  // every viewer loading every play the moment the game ends.
  // (A game that was already over when the page opened needs no wait.)
  const hasArchive = !!live?.playArchive?.chunks;
  const sawLive = useRef(false);
  if (live?.status && live.status !== "final") sawLive.current = true;
  useEffect(() => {
    if (live?.status !== "final" || finalSeen) return undefined;
    if (hasArchive || !sawLive.current) { setFinalSeen(true); return undefined; }
    const t = setTimeout(() => setFinalSeen(true), ARCHIVE_WAIT_MS);
    return () => clearTimeout(t);
  }, [live?.status, hasArchive, finalSeen]);
  const gLive = live || slateGame || scheduled || null;
  // Each team's second color and mascot for the takeover — on the game doc
  // once the ingester has written them, else read from its school.
  const extras = useSchoolExtras([gLive?.away?.school, gLive?.home?.school]);
  // The game as of the plays on screen — the reveal pacing, the score held
  // to the newest play shown, stoppages, the next snap, who has the ball
  // and the slot play's takeover (hooks/useGameFeed.js, shared with the
  // broadcast renderer so the two never disagree).
  const { listed, slot, justListed, queued, queuedKey, g, newestListed, shown, next, snapNext, ballSide, prevPts, slotTk } = useGameFeed(gameId, gLive, plays);
  // Insight cards (server/live/insights.js, on the game doc): each shows a
  // beat after its play drops into the list, just above it.
  const devPreview = useDevInsights(gameId); // local preview only (null in production)
  const devInsights = devPreview?.insights || null;
  const insightsByPlay = useInsightReveal(devInsights || live?.insights, listed, gameId);
  // Break summaries (server/live/breaks.js): the rotating break card in the
  // top slot while play is stopped, a recap in the log after.
  const breaks = devPreview?.breaks || live?.breaks || [];
  const trivia = devPreview?.trivia || live?.trivia || [];
  const breakByPlay = new Map(breaks.map((b) => [b.markerPlayId, b]));
  // (preview only: each timeout's box as the live slot would have shown it)
  const devTimeouts = new Map((devPreview?.timeouts || []).map((t) => [t.playId, t]));
  const { user } = useAuth();
  // We-Pick's community picks — read only once halftime has a card to show them on.
  const breakPicks = useGamePicks(breaks.some((b) => b.key === "half") ? gLive?.wedraftGameId : null);
  const breakPick = useMemo(() => breakPickSummary(gLive, breakPicks, user), [gLive?.wedraftGameId, breakPicks, user]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tell the page which plays are still queued, so the Feed rail holds
  // them back until the game feed has shown them.
  useEffect(() => {
    onQueueChange?.(gameId, queued);
    return () => onQueueChange?.(gameId, []); // leaving this game: nothing held back
  }, [gameId, queuedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the play picked in the Feed into view — once per pick. (It
  // waits for that play to be loaded, but new plays arriving afterwards
  // never scroll the page again.)
  // Confetti in the winner's color, and the winner's takeover, when the
  // game goes final while it's on screen (not when opening an
  // already-finished game).
  const prevStatus = useRef(null);
  useEffect(() => {
    const st = live?.status;
    if (prevStatus.current === "in_progress" && st === "final" && live) {
      const winner = (live.home?.points ?? 0) >= (live.away?.points ?? 0) ? live.home : live.away;
      confetti({ particleCount: 180, spread: 100, origin: { y: 0.3 }, colors: [winner?.color || "#dfe6f0", "#ffffff"], disableForReducedMotion: true });
      if (live.home?.points !== live.away?.points) setTakeover({ kind: "win", side: winner === live.home ? "home" : "away", key: "final" });
    }
    if (st) prevStatus.current = st;
  }, [live]);

  // Play-by-Play | Stats | Chat. Jumping to a play always shows the plays;
  // a final game lands on Stats (until the viewer picks a tab).
  const [tab, setTab] = useState(slateGame?.status === "final" && !scrollToPlayId ? "stats" : "plays");
  const tabPicked = useRef(false);
  const pickTab = (t) => { tabPicked.current = true; setTab(t); };
  useEffect(() => { if (scrollToPlayId) setTab("plays"); }, [scrollToPlayId]);
  useEffect(() => {
    if (live?.status === "final" && !tabPicked.current && !scrollToPlayId) setTab("stats");
  }, [live?.status, scrollToPlayId]);

  // Takeovers: a touchdown / field goal / safety / turnover as its play is
  // revealed (the "just now" slot — never for plays already there when the
  // game opened). The winner's takeover is with the final confetti below.
  // slotTk (useGameFeed) is known in the same render the play appears, so
  // the score is held from the first frame (an effect alone let the new
  // score flash up before the takeover started).
  const slotKey = slot ? `play-${slot.id}` : null;
  useEffect(() => {
    if (slotTk?.side) setTakeover({ ...slotTk, key: slotKey, hold: TAKEOVER_POINTS[slotTk.kind] ? prevPts : null });
  }, [slotKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The score on the board while a scoring takeover is pending or running.
  const holdPts = takeover?.hold
    || (slotTk?.side && TAKEOVER_POINTS[slotTk.kind] && !doneTakeovers.current.has(slotKey) && takeover?.key !== slotKey ? prevPts : null);

  const scrolledTo = useRef(null);
  useEffect(() => {
    if (!scrollToPlayId || scrolledTo.current === scrollToPlayId) return;
    const el = document.getElementById(`play-${scrollToPlayId}`);
    if (el) {
      scrolledTo.current = scrollToPlayId;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToPlayId, plays.length]);

  if (!g) return <div className="wdl-empty">{ready && scheduled === null ? "We couldn't find this game." : "Loading…"}</div>;
  const isLive = g.status === "in_progress";
  const followedIds = playerIdSet(followedPlayers);
  const cardProps = (p) => ({
    play: p,
    // Badge = team credited with the play (defense on a sack/pick); the
    // right column shows who had the ball on the snap.
    // A timeout's team only when its text names one (utils/live.js timeoutSide).
    team: p.presentation?.type === "timeout" ? (timeoutSide(p, g) ? g[timeoutSide(p, g)] : null)
      : (p.presentation?.creditSide || p.offense) ? g[p.presentation?.creditSide || p.offense] : null,
    possessionTeam: p.offense ? g[p.offense] : null,
    scoreLabel: `${teamShort(g.away)} ${p.awayScore} – ${teamShort(g.home)} ${p.homeScore}`,
    followedIds,
    onTogglePlayer,
  });
  // next: the upcoming snap (useGameFeed → utils/live.js nextSituation) —
  // one object feeds the next-play card AND the header. null → nothing to
  // show (not live, or a kickoff is next after a score).
  // The break on right now: play stopped at the end of a period whose
  // summary is in (end of Q1, halftime, end of Q3).
  const activeBreak = isLive && !slot && next?.brk && shown[0]?.presentation?.type === "period"
    ? breaks.find((b) => b.period === shown[0].period) || null : null;
  const heat = clutchHeat(g);
  const isFinal = g.status === "final";
  // The scoreboard's state.
  const headG = g;
  const headLive = isLive;
  const headNext = next;
  // ballSide (useGameFeed): who has the ball as of the plays on screen (the
  // game doc's possession runs ahead of them) — nobody at a break or after a score.
  // A two-point try is its own entity, right after its touchdown.
  const withTwo = (p) => (p.presentation?.pat?.type === "two"
    ? <TwoPointCard pat={p.presentation.pat} team={g[p.presentation.creditSide || p.offense]} /> : null);
  // Head-to-head header: each half in its team's color meeting at a
  // slanted seam, logos facing off from the edges, scores on either side
  // of the status medallion. One element: the page shows it, and so does
  // the pop-out widget (inWidget: the latest play as the board's last row,
  // no pop-out icon).
  // The widget's play line: the latest play, in brief, then the next snap.
  const latestPlay = slot || newestListed[0] || null;
  const widgetPlay = latestPlay ? briefPlay(latestPlay, next) : "";
  // inWidget: "log" is the play-by-play pop-out's board (no play line or
  // full-screen button — the log is right under it).
  const renderBoard = (inWidget) => {
        const hp = headG.home?.points;
        const ap = headG.away?.points;
        const loser = isFinal && hp != null && ap != null && hp !== ap ? (hp > ap ? "away" : "home") : null;
        const team = (side) => {
          const t = headG[side] || {};
          const logo = t.logoDark || t.logo;
          const hasBall = headLive && ballSide === side;
          return (
            <div className={`wdl-mu-team ${side}${loser === side ? " lose" : ""}${loser && loser !== side ? " win" : ""}`}>
              {logo && <img className="wdl-mu-logo" src={logo} alt="" />}
              <div className={`wdl-mu-name${hasBall ? " ball" : ""}`}>
                {(() => {
                  const label = <>{t.rank ? <span className="wdl-mu-rank">#{t.rank}</span> : null}<span className="wdl-mu-full">{teamName(t)}</span><span className="wdl-mu-short">{teamShort(t)}</span></>;
                  // the school's Slug, else the site-wide fallback from its name (TeamPage.js toTeamSlug)
                  const slug = t.slug || extras[t.school]?.slug
                    || (t.school ? t.school.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-") : null);
                  // The team's We-Draft page — a new tab, so the game stays open.
                  return slug ? <a className="wdl-mu-tlink" href={`/team/${slug}`} target="_blank" rel="noopener noreferrer" title={`${teamName(t)} — team page (opens in a new tab)`}>{label}</a> : label;
                })()}
              </div>
              {slateGame?.[side]?.record && <div className="wdl-mu-rec">{slateGame[side].record}</div>}
            </div>
          );
        };
        const score = (side) => {
          const t = headG[side] || {};
          return (
            <div className={`wdl-mu-score ${side}${loser === side ? " lose" : ""}${loser && loser !== side ? " win" : ""}`}>
              {headLive && ballSide === side && <FootballIcon side={side} />}
              {t.points != null
                ? <ScoreNum value={holdPts?.[side] ?? t.points} bump={headG[side]?.color2 || extras[headG[side]?.school]?.color2 || "#fff"} />
                : <b className="pre">–</b>}
            </div>
          );
        };
        // Before kickoff: no scores yet, so instead of two "–" columns the
        // middle shows the game's info — its tag, day and date, the kickoff
        // time (local), a countdown, TV and the week.
        const pregame = headG.status === "scheduled";
        const preMid = pregame ? (() => {
          const at = headG.startDate ? new Date(headG.startDate) : null;
          const ok = at && !isNaN(at);
          const ms = ok ? at.getTime() - Date.now() : null;
          const count = ms == null || ms <= 0 ? null
            : ms < 3600e3 ? `Kickoff in ${Math.max(1, Math.round(ms / 60e3))} min`
              : ms < 86400e3 ? `Kickoff in ${Math.floor(ms / 3600e3)}h ${Math.round((ms % 3600e3) / 60e3)}m`
                : `Kickoff in ${Math.round(ms / 86400e3)} day${Math.round(ms / 86400e3) === 1 ? "" : "s"}`;
          const wk = headG.week ?? (headG.wedraftWeek ? Number(/\d+/.exec(headG.wedraftWeek)?.[0]) : null);
          return (
            <div className="wdl-mu-mid wdl-mu-pre">
              {headG.gameOfWeek ? <span className="wdl-mu-tag gotw">Game of the Week</span> : headG.featured ? <span className="wdl-mu-tag feat">Featured</span> : null}
              {ok && <div className="wdl-mu-day">{at.toLocaleDateString([], { weekday: "long" })}<small>{at.toLocaleDateString([], { month: "short", day: "numeric" })}</small></div>}
              <div className="wdl-mu-kick">{ok && !headG.startTimeTBD ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "Time TBA"}</div>
              {count && <div className="wdl-mu-count">{count}</div>}
              <div className="wdl-mu-meta">
                {headG.tv && <span className="wdl-mu-tv">📺 {tvShort(headG.tv)}</span>}
                {wk != null && <span>Week {wk}</span>}
                {headG.neutralSite && <span>Neutral site</span>}
              </div>
            </div>
          );
        })() : null;
        return (
          <div ref={inWidget ? undefined : boardRef} className={`wdl-mu${pregame ? " pre" : ""}${heat ? " clutch" : ""}${isFinal ? " final" : ""}${takeover ? ` tk-${takeover.side}` : ""}${!inWidget && boardFull ? " full" : ""}`}
            style={{
              // a takeover morphs both halves into the team's color
              "--ac": (takeover && headG[takeover.side]?.color) || headG.away?.color || "#2a4a7a",
              "--hc": (takeover && headG[takeover.side]?.color) || headG.home?.color || "#7a2a2a",
              ...(heat ? { "--heat": heat.toFixed(2) } : {}),
            }}>
            {team("away")}
            {!pregame && score("away")}
            {pregame ? preMid : <div className="wdl-mu-mid">
              <div className={`wdl-mu-status${headLive ? " live" : ""}`}>{headLive && <span className="wdl-dot" />}{statusLabel(headG)}</div>
              {/* Down & distance, scoreboard style (the spot is on the field
                  strip below); a break (halftime …) as plain text. */}
              {/* One fixed-height box whatever it holds — down & distance, a
                  break, or nothing (after a score) — so the board never
                  changes size mid-game. The hidden copy sets the height. */}
              {headLive && (
                <div className="wdl-mu-ddbox">
                  <div className="wdl-mu-dd wdl-mu-sizer" aria-hidden="true"><div><span>Down</span><b>1st</b></div><div><span>To go</span><b>10</b></div></div>
                  {snapNext?.down ? (
                    <div className="wdl-mu-dd" style={{ "--pc": headG[headNext.offense]?.color || "#1d2840" }}>
                      <div><span>Down</span><b>{["", "1st", "2nd", "3rd", "4th"][headNext.down]}</b></div>
                      <div><span>To go</span><b className={headNext.distance === "Goal" ? "goal" : ""}>{headNext.distance}</b></div>
                    </div>
                  ) : headNext?.brk?.label ? <div className="wdl-mu-next">{headNext.brk.label}</div> : null}
                  {snapNext?.down && snapNext.brk && <div className="wdl-mu-tobadge">{snapNext.brk.label}</div>}
                </div>
              )}
              {!isFinal && headG.tv && <div className="wdl-mu-tv">📺 {tvShort(headG.tv)}</div>}
            </div>}
            {!pregame && score("home")}
            {team("home")}
            {/* Field strip: where the ball is for the next snap. */}
            {headLive && <LiveField game={headG} next={snapNext?.offense && snapNext.ytg != null ? snapNext : null} />}
            {((inWidget && inWidget !== "log") || boardFull) && widgetPlay &&<div key={widgetPlay} className="wdl-mu-play">{widgetPlay}</div>}
            {!inWidget && boardFull && (
              <div className="wdl-mu-rotate" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M10.5 18h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                Rotate your phone for the best view
              </div>
            )}
            {inWidget && inWidget !== "log" && (
              <button type="button" className="wdl-mu-popicon wdl-wfull" title="Full screen" aria-label="Full screen">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
            {!inWidget && headLive && (() => {
              if (boardFull) {
                return (
                  <button type="button" className="wdl-mu-popicon close" onClick={exitFull} title="Exit full screen" aria-label="Exit full screen">
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  </button>
                );
              }
              const pop = canWidget && !touchish();
              return (
                <button type="button" className={`wdl-mu-popicon${widgetWin ? " on" : ""}`}
                  onClick={pop ? (widgetWin ? () => widgetWin.close() : openWidget) : enterFull}
                  title={pop ? (widgetWin ? "Close the pop-out scoreboard" : "Pop out — float this scoreboard over your other windows") : "Full screen scoreboard"}
                  aria-label={pop ? "Pop out scoreboard" : "Full screen scoreboard"}>
                  {pop
                    ? <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9 3h8v8M17 3l-7.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
              );
            })()}
            {takeover && (
              <HeaderTakeover key={takeover.key} kind={takeover.kind} side={takeover.side} onDone={clearTakeover} game={{
                away: { ...headG.away, color2: headG.away?.color2 || extras[headG.away?.school]?.color2, mascot: headG.away?.mascot || extras[headG.away?.school]?.mascot },
                home: { ...headG.home, color2: headG.home?.color2 || extras[headG.home?.school]?.color2, mascot: headG.home?.mascot || extras[headG.home?.school]?.mascot },
              }} />
            )}
          </div>
        );
  };

  // The live log: the top slot, then the plays newest first. The page's
  // Play-by-play tab shows it, and so does the play-by-play pop-out.
  const renderPlays = () => <>
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
        ) : activeBreak ? (
          <div key={`slot-break-${activeBreak.key}`} className="wdl-slot-swap">
            <LiveBreakCard brk={activeBreak} game={g} rotate live pick={breakPick} onChat={() => pickTab("chat")} trivia={trivia} />
          </div>
        ) : (
          <div key="slot-next" className="wdl-slot-swap">
            <PendingPlayCard game={g} situation={next} tip={next?.brk?.kind === "timeout"
              ? <TimeoutTip game={g} tip={pickTimeoutTip({ situation: next, game: g, teamNow: live?.teamNow, prospects: live?.prospects, trivia, seed: shown[0]?.id })} />
              : null} />
          </div>
        )}
      </div>
    )}
    {newestListed.length || slot ? newestListed.filter((p, i) => !(isFinal && p.presentation?.type === "period" && p.period >= 4)
      // the timeout the next-play card is showing right now isn't repeated under it
      && !(i === 0 && !slot && next?.brk?.kind === "timeout" && p.presentation?.type === "timeout")).flatMap((p) => [
      // a break's recap, above its end-of-period play (not while it's the
      // break on now — that one is in the slot); a preview rotates it
      ...(devTimeouts.has(p.id) ? [(() => {
        const t = devTimeouts.get(p.id);
        return (
          <div key={`dev-timeout-${p.id}`} style={{ opacity: 0.95 }}>
            <PendingPlayCard game={g} situation={{ ...t.situation, brk: { kind: "timeout", label: "TIMEOUT", detail: timeoutSide(p, g) ? teamName(g[timeoutSide(p, g)]) : "" } }}
              tip={<TimeoutTip game={g} tip={pickTimeoutTip({ situation: t.situation, game: g, teamNow: t.teamNow, prospects: t.prospects, trivia, seed: p.id })} />} />
          </div>
        );
      })()] : []),
      ...(breakByPlay.has(p.id) && breakByPlay.get(p.id) !== activeBreak ? [
        <LiveBreakCard key={`break-${breakByPlay.get(p.id).key}`} brk={breakByPlay.get(p.id)} game={g} rotate={!!devPreview} pick={breakPick} onChat={() => pickTab("chat")} trivia={trivia} />,
      ] : []),
      // this play's insights, just above it (newest first)
      ...(insightsByPlay.get(p.id) || []).map(({ insight, fresh }) => (
        <LiveInsightCard key={`ins-${insight.id}`} insight={insight} fresh={fresh} team={g[insight.side]} />
      )),
      <div key={p.id} id={`play-${p.id}`}>
        <LivePlayCard variant="detailed" highlight={p.id === focusPlayId} fresh={p.id === justListed} {...cardProps(p)} />
        {withTwo(p)}
      </div>,
    ]) : (
      <div className="wdl-empty">
        {g.status === "scheduled" ? `Kickoff ${statusLabel(g)}. Plays will stream in here once it starts.` : "No plays available for this game yet."}
      </div>
    )}
  </>;

  return (
    <div>
      {(() => {
        const wk = g.week ?? (g.wedraftWeek ? Number(/\d+/.exec(g.wedraftWeek)?.[0]) : null);
        return (
          <div className="wdl-mu-above">
            {wk != null && onWeek && <button className="wdl-mu-week" onClick={() => onWeek(wk)}>‹ Week {wk} slate</button>}
            <ShareGame game={g} />
          </div>
        );
      })()}
      {renderBoard(false)}
      {widgetWin && createPortal(
        <div className="wdl wdl-widget">{renderBoard(true)}</div>,
        widgetWin.document.body,
      )}
      {logWin && createPortal(
        <div className="wdl wdl-logwin">
          <div className="wdl-logwin-board">{renderBoard("log")}</div>
          <div className="wdl-logwin-plays">{renderPlays()}</div>
        </div>,
        logWin.document.body,
      )}
      {showRecap && isFinal && <div className="wdl-recap-inline"><div className="wdl-h">Game Recap</div><GameRecap game={g} gameId={gameId} slateGame={slateGame} /></div>}
      {g.status === "scheduled" && <>
        {showRecap && <div className="wdl-recap-inline"><PreviewPickCard game={g} withInfo /></div>}
        <PreviewView game={g} slateGame={slateGame} />
      </>}
      {g.status !== "scheduled" && <>
      <div className="wdl-gtabs">
        {isFinal ? <>
          <button className={`wdl-gtab${tab === "stats" ? " on" : ""}`} onClick={() => pickTab("stats")}>Stats</button>
          <button className={`wdl-gtab${tab === "plays" ? " on" : ""}`} onClick={() => pickTab("plays")}>Play-by-play</button>
        </> : <>
          <button className={`wdl-gtab${tab === "plays" ? " on" : ""}`} onClick={() => pickTab("plays")}>{isLive ? "Live play-by-play" : "Play-by-play"}</button>
          <button className={`wdl-gtab${tab === "stats" ? " on" : ""}`} onClick={() => pickTab("stats")}>{isLive ? "Live stats" : "Stats"}</button>
        </>}
        {!isFinal && ["away", "home"].map((side) => (
          <button key={side} className={`wdl-gtab${tab === `roster-${side}` ? " on" : ""}`} onClick={() => pickTab(`roster-${side}`)}>{teamShort(g[side])} roster</button>
        ))}
        <button className={`wdl-gtab${tab === "chat" ? " on" : ""}`} onClick={() => pickTab("chat")}>💬 Chat</button>
        {isLive && tab === "plays" && canWidget && !touchish() && (
          <button type="button" className={`wdl-gtab-pop${logWin ? " on" : ""}`} onClick={logWin ? () => logWin.close() : openLog}
            title={logWin ? "Close the pop-out play-by-play" : "Pop out the play-by-play — float it over your other windows"} aria-label="Pop out play-by-play">
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9 3h8v8M17 3l-7.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {logWin ? "Popped out" : "Pop out"}
          </button>
        )}
      </div>
      {tab.startsWith("roster-") && !isFinal ? <GameRoster game={g} side={tab.slice(7)} />
        : tab === "chat" ? <LiveChat gameId={gameId} game={g} />
        : tab === "stats" ? <LiveGameStats gameId={gameId} game={{
          ...g,
          away: { ...g.away, color2: g.away?.color2 || extras[g.away?.school]?.color2 },
          home: { ...g.home, color2: g.home?.color2 || extras[g.home?.school]?.color2 },
        }} />
        // (a local insight preview reads a finished game as the live feed)
        : isFinal && !focusPlayId && !devInsights ? <>
          <DriveSummary plays={plays} game={g} cardProps={cardProps} withTwo={withTwo} />
          <FinalCard game={g} />
        </> : renderPlays()}
      </>}
    </div>
  );
}

// My Feed's settings panel (opened by the rail's Customize button).
// Follow a team: search every school linked to a CFBD team (by school,
// mascot or abbreviation) and tap to follow / unfollow.
function TeamSearch({ schools, followed, onToggle, placeholder, labels = ["★ Following", "+ Follow"] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hits = needle.length < 2 ? [] : schools.filter((t) =>
    [t.name, t.short, t.mascot, t.alt, `${t.name} ${t.mascot}`].some((v) => v && v.toLowerCase().includes(needle))).slice(0, 8);
  return (
    <div className="wdl-search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || "Search teams to follow — e.g. Ohio State, Ducks, LSU"} aria-label="Search teams" />
      {needle.length >= 2 && (
        <div className="wdl-search-list">
          {hits.length ? hits.map((t) => {
            const on = followed.includes(t.id);
            return (
              <button key={t.id} className={`wdl-search-hit${on ? " on" : ""}`} onClick={() => onToggle(t.id)}>
                {t.logo ? <img src={t.logo} alt="" /> : <span className="wdl-search-noimg" />}
                <span className="wdl-search-name">{t.name}<small>{[t.mascot, t.conference].filter(Boolean).join(" · ")}</small></span>
                <b>{on ? labels[0] : labels[1]}</b>
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
function PlayerSearch({ followedIds, onToggle, placeholder, labels = ["★ Following", "+ Follow"] }) {
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
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || "Search players to follow — e.g. Julian Sayin"} aria-label="Search players" />
      {q.trim().length >= 2 && (
        <div className="wdl-search-list">
          {hits.length ? hits.map((p) => {
            const on = followedIds.has(p.id);
            return (
              <button key={p.id} className={`wdl-search-hit${on ? " on" : ""}`} onClick={() => onToggle(p)}>
                <span className="wdl-search-pos">{p.position || "—"}</span>
                <span className="wdl-search-name">{p.name}<small>{[p.team, p.jersey != null && `#${p.jersey}`].filter(Boolean).join(" · ")}</small></span>
                <b>{on ? labels[0] : labels[1]}</b>
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
      <Row disabled={allGames} checked={prefs.games.close} onToggle={(v) => setGames("close", v)} label="Close games in the 4th"
        note="Big plays from any game within one score in the 4th quarter or OT" />
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
// Full screen (hides the browser bars) — standard API with the WebKit
// prefix as a fallback. iPhone Safari offers neither for a page, so the
// button only shows where it works (Android, iPad, desktop browsers).
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const fsEnabled = () => typeof document !== "undefined" && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFullscreen() {
  try {
    if (fsElement()) { const r = (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); if (r?.catch) r.catch(() => {}); return; }
    const el = document.documentElement;
    const r = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    if (r?.catch) r.catch(() => {});
  } catch { /* not allowed here */ }
}
function useFullscreen() {
  const [on, setOn] = useState(() => typeof document !== "undefined" && !!fsElement());
  useEffect(() => {
    const sync = () => setOn(!!fsElement());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => { document.removeEventListener("fullscreenchange", sync); document.removeEventListener("webkitfullscreenchange", sync); };
  }, []);
  return on;
}
function tryPortrait() {
  try { const p = window.screen?.orientation?.lock?.("portrait"); if (p?.catch) p.catch(() => {}); } catch { /* not supported */ }
}
function unlockOrientation() {
  try { window.screen?.orientation?.unlock?.(); } catch { /* not supported */ }
}
const LIVE_URL = "https://we-draft.com/live";
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
  const [params, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // We-Pick has its own path (/live/we-pick…, utils/wePickRoutes.js), and
  // so does each game (/live/{slug} — its own indexable page, the slug
  // shared with its old /game/{slug} page); every other view is
  // /live?view=…. Leaving either for another view goes back to /live with
  // that query.
  const onWePickPath = isWePickPath(location.pathname);
  const pathSlug = !onWePickPath && location.pathname.startsWith("/live/")
    ? decodeURIComponent(location.pathname.slice("/live/".length).split("/")[0] || "") || null : null;
  const onPath = onWePickPath || !!pathSlug;
  const setParams = useCallback((next, opts) => {
    if (!onPath) { setSearchParams(next, opts); return; }
    const q = new URLSearchParams(next).toString();
    navigate(`/live${q ? `?${q}` : ""}`, opts);
  }, [onPath, navigate, setSearchParams]);
  const compact = useCompact();
  // Scores pop-out (desktop Chrome / Edge): the chooser, the selection
  // (kept in this browser), and the open window.
  const canScoresPop = typeof window !== "undefined" && "documentPictureInPicture" in window
    && !window.matchMedia("(pointer: coarse)").matches && window.innerWidth >= 1000;
  const [scoresPicker, setScoresPicker] = useState(false);
  const [scoresSel, setScoresSel] = useState(loadScoresPick);
  const [scoresWin, setScoresWin] = useState(null);
  const pageTvShort = useTvShort();
  const updateScoresSel = (next) => { setScoresSel(next); try { localStorage.setItem(SCORES_PICK_KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  const openScores = async () => {
    const win = await openPipWindow({ width: 380, height: 560, title: "We-Draft Live · Scores", scroll: true });
    if (!win) return;
    win.addEventListener("pagehide", () => setScoresWin(null));
    setScoresWin(win);
    setScoresPicker(false);
  };
  useEffect(() => () => { if (scoresWin && !scoresWin.closed) scoresWin.close(); }, [scoresWin]);
  const canFullscreen = fsEnabled();
  const isFullscreen = useFullscreen();
  // My Teams / My Players live inside Customize now — old links land there.
  const [slate, setSlate] = useState(null);
  // The week's mode (utils/live.js slatePhase): preview → live → review,
  // with the server holding a finished week until Monday 6 AM ET.
  const phase = slate ? slatePhase(slate.games) : null;
  // My Feed is only offered around game time (utils/live.js myFeedWindow):
  // from an hour before the day's first kickoff until the day's games end.
  // (Re-checked on every render — useNow below ticks every 15s.)
  const feedWindow = slate ? myFeedWindow(slate.games) : { open: false, opensAt: null };
  const rawView = onWePickPath ? "wepick" : pathSlug ? "game" : params.get("view");
  const asked = rawView === "teams" || rawView === "players" ? "customize" : rawView === "big" ? "feed" : rawView;
  // Phones/tablets open on My Feed while it's open; otherwise All Games.
  const view = asked === "feed" && slate && !feedWindow.open ? "all" : asked || (compact && feedWindow.open ? "feed" : "all");
  const [error, setError] = useState(false);
  // Follows, Feed settings and weekly adds need an account — a signed-out
  // visitor has none (the whole slate) until they log in.
  const [followedTeams, setFollowedTeams] = useState([]);
  const [followedPlayers, setFollowedPlayers] = useState([]);
  // This week's changes to the follows (utils/live.js "This week") — kept
  // raw and matched to the slate's week when used, so last week's simply
  // reads as empty.
  const [weekRaw, setWeekRaw] = useState(null);
  const [prevWeekRaw, setPrevWeekRaw] = useState(null);
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

  // /live/{slug}: the game — this week's from the slate, any other from one
  // liveGames query by slug (a future week's not ingested yet: its schedule26
  // row). slugGame.missing: no such game.
  const slateSlugGame = pathSlug ? (slate?.games || []).find((g) => g.slug === pathSlug) : null;
  const [slugGame, setSlugGame] = useState(null);
  useEffect(() => {
    if (!pathSlug || !slate || slateSlugGame) return undefined;
    if (slugGame?.slug === pathSlug) return undefined;
    let alive = true;
    (async () => {
      const snap = await getDocs(query(collection(db, "liveGames"), where("slug", "==", pathSlug), limit(1)));
      if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
      // Not ingested yet (a future week): its schedule26 row, if it has a
      // CFBD match — GameView builds the preview from that id.
      const row = (await getDocs(query(collection(db, "schedule26"), where("Slug", "==", pathSlug), limit(1)))).docs[0];
      return row && row.data().CFBDGameId != null ? scheduledGameFrom(row.id, row.data(), {}) : null;
    })()
      .then((game) => { if (alive) setSlugGame(game ? { slug: pathSlug, game } : { slug: pathSlug, missing: true }); })
      .catch(() => { if (alive) setSlugGame({ slug: pathSlug, missing: true }); });
    return () => { alive = false; };
  }, [pathSlug, slate, slateSlugGame, slugGame]);
  const pathGame = pathSlug ? slateSlugGame || (slugGame?.slug === pathSlug ? slugGame.game : null) : null;
  const pathMissing = !!pathSlug && !slateSlugGame && slugGame?.slug === pathSlug && !!slugGame.missing;
  const gameParam = pathSlug ? (pathGame ? String(pathGame.id) : null) : params.get("game");
  // Old links (/live?view=game&game=ID) move to the game's own path — the
  // slug from the slate, else from its liveGames doc.
  useEffect(() => {
    if (pathSlug || params.get("view") !== "game" || !params.get("game")) return undefined;
    const id = params.get("game");
    const hit = (slate?.games || []).find((g) => String(g.id) === id);
    if (hit?.slug) { navigate(liveGameHref(hit), { replace: true }); return undefined; }
    if (!slate) return undefined;
    let alive = true;
    getDoc(doc(db, "liveGames", id)).then((d) => { const slug = d.exists() ? d.data().slug : null; if (alive && slug) navigate(`/live/${slug}`, { replace: true }); }).catch(() => {});
    return () => { alive = false; };
  }, [pathSlug, params, slate, navigate]);

  // Keep the active top tab visible when the row scrolls (phones).
  const tabsRef = useRef(null);
  useEffect(() => { scrollActiveTabIntoView(tabsRef.current); }, [view]);
  const setView = (v, extra = {}) => (v === "wepick" ? navigate(wePickHref()) : setParams({ view: v, ...extra }));
  // All Games for any week (?view=all&week=N); the slate's own week drops the param.
  const goWeek = (wk) => setParams(slate && Number(wk) === Number(slate.week) ? { view: "all" } : { view: "all", week: String(wk) });
  // Links from before We-Pick had its own path (/live?view=wepick&wp=…&wk=…).
  useEffect(() => {
    if (!onWePickPath && params.get("view") === "wepick") navigate(wePickHref(params.get("wp") || "picks", params.get("wk")), { replace: true });
  }, [onWePickPath, params, navigate]);
  const openGame = (id) => {
    const g = (slate?.games || []).find((x) => String(x.id) === String(id));
    if (g?.slug) navigate(liveGameHref(g)); else setView("game", { game: id });
  };
  // Following needs an account: signed out, any follow opens log in.
  const requireAccount = () => {
    if (uidRef.current) return true;
    login();
    return false;
  };
  const toggleTeam = (id) => {
    if (!requireAccount()) return;
    setFollowedTeams((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const togglePlayer = (a) => {
    if (!requireAccount()) return;
    // Signed in: mirror onto the player's We-Draft profile follow too
    // (utils/liveFollowSync.js), so his player page shows Following.
    const on = !followedPlayers.some((p) => String(p.id) === String(a.id));
    syncProfileFollow(uidRef.current, a.id, on).catch(() => {});
    setFollowedPlayers((prev) => {
      const same = (p) => String(p.id) === String(a.id);
      return prev.some(same) ? prev.filter((p) => !same(p))
        : [...prev, { id: a.id, name: a.name, ...(a.teamId != null ? { teamId: a.teamId, team: a.team || null, position: a.position || null } : {}) }];
    });
  };
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
          return prev.map((p) => {
            if (!info.has(String(p.id))) return p;
            const d = info.get(String(p.id));
            return { ...p, lookedUp: true, ...(d ? { teamId: d.teamId ?? null, team: d.team || null, position: d.position || null } : {}) };
          });
        });
      });
    return () => { alive = false; };
  }, [followedPlayers]);

  const games = useMemo(() => [...(slate?.games || [])].sort(sortGames), [slate]);
  const bigPlays = useMemo(() => slate?.bigPlays || [], [slate]);
  const liveCount = games.filter((g) => g.status === "in_progress").length;
  const updatedMs = slate?.updatedAt?.toMillis ? slate.updatedAt.toMillis() : null;
  const updatedAgo = updatedMs != null ? Math.max(0, Math.round((now - updatedMs) / 60000)) : null;
  // Minutes for the first hour; after that just the day ("today",
  // "yesterday", else the date) — "347m ago" reads like something's broken.
  const updatedLabel = (() => {
    if (updatedAgo == null) return null;
    if (updatedAgo === 0) return "just now";
    if (updatedAgo < 60) return `${updatedAgo}m ago`;
    const day = (ms) => new Date(ms).toDateString();
    if (day(updatedMs) === day(now)) return "today";
    if (day(updatedMs) === day(now - 86400000)) return "yesterday";
    return new Date(updatedMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  })();

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
  const [feedPrefs, setFeedPrefs] = useState(DEFAULT_FEED_PREFS);
  const updatePrefs = (next) => { if (requireAccount()) setFeedPrefs(next); };

  // ── Account sync ──
  // Follows + Feed settings live on the account (users/{uid}/liveSettings/
  // main, owner-only) and follow you across devices. Signed out: none — an
  // account is required. The first sign-in brings over anything this
  // browser saved back when guests could follow.
  useEffect(() => {
    synced.current = { uid, json: null, ready: false };
    if (!uid) {
      setFollowedTeams([]);
      setFollowedPlayers([]);
      setFeedPrefs(DEFAULT_FEED_PREFS);
      setWeekRaw(null);
      setPrevWeekRaw(null);
      return undefined;
    }
    const ref = doc(db, "users", uid, "liveSettings", "main");
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setDoc(ref, {
          teams: loadFollows(FOLLOW_TEAMS_KEY), players: loadFollows(FOLLOW_PLAYERS_KEY),
          feedPrefs: loadFeedPrefs(), week: loadWeekFollows(), prevWeek: null, updatedAt: serverTimestamp(),
        }).catch(() => { synced.current.ready = true; });
        return;
      }
      const d = snap.data();
      const next = { teams: d.teams || [], players: d.players || [], feedPrefs: normalizeFeedPrefs(d.feedPrefs), week: d.week || null, prevWeek: d.prevWeek || null };
      synced.current = { uid, json: JSON.stringify(next), ready: true };
      setFollowedTeams(next.teams);
      setFollowedPlayers(next.players);
      setFeedPrefs(next.feedPrefs);
      setWeekRaw(next.week);
      setPrevWeekRaw(next.prevWeek);
    }, () => { synced.current.ready = true; });
  }, [uid]);
  useEffect(() => {
    if (!uid || !synced.current.ready || synced.current.uid !== uid) return;
    const next = { teams: followedTeams, players: followedPlayers, feedPrefs, week: weekRaw || null, prevWeek: prevWeekRaw || null };
    const json = JSON.stringify(next);
    if (json === synced.current.json) return;
    synced.current.json = json;
    setDoc(doc(db, "users", uid, "liveSettings", "main"), { ...next, updatedAt: serverTimestamp() }).catch(() => {});
  }, [uid, followedTeams, followedPlayers, feedPrefs, weekRaw, prevWeekRaw]);

  // ── This week ── what the Feed actually follows: your teams and players
  // with this week's additions and drops applied.
  const weekKey = slateWeekKey(slate);
  const week = useMemo(() => normalizeWeek(weekRaw, weekKey), [weekRaw, weekKey]);
  const feedTeams = useMemo(() => weekTeams(followedTeams, week), [followedTeams, week]);
  const feedPlayers = useMemo(() => weekPlayers(followedPlayers, week), [followedPlayers, week]);
  const feedPlayerIds = useMemo(() => playerIdSet(feedPlayers), [feedPlayers]);
  const updateWeek = (next) => {
    if (!requireAccount()) return;
    // The first change in a new week: the old week's set moves to prevWeek.
    if (weekRaw?.key && weekRaw.key !== next.key) setPrevWeekRaw(weekRaw);
    setWeekRaw(next);
  };
  // Last week's adds/drops (Your Week's Last week view): still in weekRaw
  // if nothing's changed this week, else kept in prevWeek.
  const lastWeekKey = slate?.week != null ? slateWeekKey({ ...slate, week: Number(slate.week) - 1 }) : null;
  const lastWeekFollows = useMemo(() => normalizeWeek(weekRaw?.key === lastWeekKey ? weekRaw : prevWeekRaw, lastWeekKey), [weekRaw, prevWeekRaw, lastWeekKey]);
  const toggleWeekTeamId = (id) => updateWeek(toggleWeekTeam(week, followedTeams, id));
  const toggleWeekPlayerObj = (p) => updateWeek(toggleWeekPlayer(week, followedPlayers, p));
  const onFeed = view === "feed";
  const rankedIds = useRankedSixIds(onFeed || view === "week" || feedPrefs.strip === "mine" ? user?.uid : null, games.map((g) => g.wedraftWeek));
  const rankedGames = games.filter((g) => g.wedraftGameId && rankedIds.has(g.wedraftGameId));
  const rankedRows = useRankedPicks(view === "week" ? user?.uid : null, rankedGames.map((g) => g.wedraftGameId));
  // The slate's We-Pick week label ("Week 6") — the most common one on it.
  const wePickWeek = useMemo(() => {
    const n = {};
    games.forEach((g) => { if (g.wedraftWeek) n[g.wedraftWeek] = (n[g.wedraftWeek] || 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }, [games]);
  const weekStanding = useWeekStanding(view === "week" ? user?.uid : null, wePickWeek);
  // Your Week's This week / Last week toggle.
  const [ywWhich, setYwWhich] = useState("this");
  // All games | Completed on the week's games — null until picked: then
  // Completed once every game is final, else All games.
  const [allSub, setAllSub] = useState(null);
  // Games the feed follows (unless "All games"): union of the checked sources.
  const feedGameIds = useMemo(() => {
    if (feedPrefs.games.all) return [];
    const ids = new Set();
    for (const g of games) {
      if (feedPrefs.games.wepick && g.wedraftGameId && rankedIds.has(g.wedraftGameId)) ids.add(g.id);
      if (feedPrefs.games.myTeams && (feedTeams.includes(g.home.providerTeamId) || feedTeams.includes(g.away.providerTeamId))) ids.add(g.id);
      if (feedPrefs.games.featured && (g.featured || g.gameOfWeek)) ids.add(g.id);
    }
    return [...ids];
  }, [feedPrefs, games, rankedIds, feedTeams]);
  // Each followed game's complete Feed list (liveGames/{id}.feedPlays).
  const feedDocs = useLiveGameDocs(onFeed ? feedGameIds : []);
  // "Every play" modes (Customize): the full play-by-play of followed
  // teams' games, and every play a followed player is in.
  const teamEvery = !feedPrefs.games.all && feedPrefs.games.myTeams && feedPrefs.teamPlays === "all";
  const playerEvery = feedPrefs.players && feedPrefs.playerPlays === "all" && feedPlayers.length > 0;
  const everyGameIds = useMemo(() => {
    const teamGame = (g) => feedTeams.includes(g.home.providerTeamId) || feedTeams.includes(g.away.providerTeamId);
    const playerTeams = new Set(feedPlayers.map((p) => p.teamId).filter((x) => x != null).map(String));
    const playerGame = (g) => playerTeams.has(String(g.home.providerTeamId)) || playerTeams.has(String(g.away.providerTeamId));
    return games
      .filter((g) => (g.status === "in_progress" || g.status === "final") && ((teamEvery && teamGame(g)) || (playerEvery && playerGame(g))))
      .sort((a, b) => (a.status === "in_progress" ? 0 : 1) - (b.status === "in_progress" ? 0 : 1))
      .map((g) => g.id);
  }, [games, feedTeams, feedPlayers, teamEvery, playerEvery]);
  const everyPlays = useGamePlays(onFeed ? everyGameIds : []);
  // Nothing to follow yet → the whole slate's Feed, with a nudge to follow.
  const closeOn = !feedPrefs.games.all && feedPrefs.games.close;
  const followsNothing = !feedPrefs.games.all && !closeOn && !feedGameIds.length && !(feedPrefs.players && feedPlayers.length);
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
      const wholeGame = teamEvery && (feedTeams.includes(g.home.providerTeamId) || feedTeams.includes(g.away.providerTeamId));
      for (const p of plays) {
        if (p.removed || EVERY_SKIP.has(p.presentation?.type)) continue;
        const item = feedItemFromPlay(gid, g, p);
        if (wholeGame || (playerEvery && item.athletes.some((a) => feedPlayerIds.has(a.id)))) every.push(item);
      }
    }
    // Followed games: each one's plays plus its FINAL entry once it ends.
    let items = feedPrefs.games.all ? bigPlays
      : [...feedDocs.values()].flatMap((d) => [...(d.feedPlays || []), ...(d.finalFeed ? [d.finalFeed] : [])]);
    if (!feedPrefs.games.all && feedPrefs.players) {
      items = items.concat(bigPlays.filter((b) => (b.athletes || []).some((a) => feedPlayerIds.has(a.id))));
    }
    // Close games (Customize): big plays from any game within one score in the 4th / OT.
    if (closeOn) items = items.concat(bigPlays.filter(isCloseLatePlay));
    const byKey = new Map([...every, ...items.filter(typeOn)].map((b) => [b.key, b]));
    return dedupeFeed([...byKey.values()].sort((a, b) => b.at - a.at));
  }, [feedPrefs, closeOn, bigPlays, feedDocs, feedPlayerIds, followsNothing, everyPlays, games, teamEvery, playerEvery, feedTeams]);
  const feedMax = teamEvery || playerEvery ? 80 : 30;
  // Top scoreboard (Customize): every game, or just "my games" — followed
  // teams, followed players' teams, the We-Pick Ranked 6, and featured games
  // when the Feed includes them. Nothing of yours on → every game.
  const stripGames = useMemo(() => {
    if (feedPrefs.strip !== "mine") return games;
    const playerTeams = new Set(feedPlayers.map((p) => p.teamId).filter((x) => x != null).map(String));
    const mine = games.filter((g) => feedTeams.includes(g.home.providerTeamId) || feedTeams.includes(g.away.providerTeamId)
      || playerTeams.has(String(g.home.providerTeamId)) || playerTeams.has(String(g.away.providerTeamId))
      || (g.wedraftGameId && rankedIds.has(g.wedraftGameId))
      || (feedPrefs.games.featured && (g.featured || g.gameOfWeek)));
    return mine.length ? mine : games;
  }, [feedPrefs, games, feedTeams, feedPlayers, rankedIds]);
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
    ...(feedWindow.open ? [{ key: "feed", label: "My Feed" }] : []),
    // While next week is in preview, last week's recap takes this spot.
    phase === "preview" ? { key: "lastweek", label: "Last Week" } : { key: "perf", label: "Top Performances" },
    { key: "week", label: "Your Week" },
    { key: "wepick", label: "🔮 We-Pick" },
    { key: "customize", label: "⚙ Customize" },
    ...(view === "game" ? [{ key: "game", label: "Game" }] : []),
  ];

  // The right rail. On My Feed it's personalized (Customize) and clicking a
  // play loads it on the left; elsewhere it's the whole slate's Feed.
  const sourceSummary = feedPrefs.games.all ? "All games" : [
    feedPrefs.games.wepick && "We-Pick", feedPrefs.games.myTeams && "My teams", feedPrefs.games.featured && "Featured",
    feedPrefs.games.close && "Close games",
    feedPrefs.players && feedPlayers.length > 0 && "My players",
  ].filter(Boolean).join(" · ") || "Nothing selected";
  const feedRail = onFeed ? (
    <aside className="wdl-rail">
      <div className="wdl-railhead">
        <div className="wdl-h" style={{ margin: 0 }}>Feed <span className="wdl-railsub">{sourceSummary}</span></div>
        <button className="wdl-iconbtn" onClick={() => setView("customize")}>⚙ Customize</button>
      </div>
      {followsNothing && !compact && (
        <div className="wdl-feed-nudge">Showing the whole slate. <button onClick={() => (user ? setView("customize") : login())}>{user ? "Follow teams and players" : "Log in to follow teams and players"}</button> to make this your Feed.</div>
      )}
      {myFeed.length
        ? <div className="wdl-feedcols"><FeedList items={myFeed.filter((p) => !notYetShown(p)).slice(0, feedMax)} render={(p) => (
          <BigPlayItem play={p} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer}
            onSelect={selectFeedPlay} selected={p.key === selectedFeedKey && p.gameId === feedGameId} />
        )} /></div>
        : <div className="wdl-empty">{phase === "preview" ? `Week ${slate?.week ?? ""} hasn't kicked off yet. Plays from your teams and players land here once it does — set them up with ⚙ Customize.` : feedPrefs.games.all || feedGameIds.length || closeOn
          ? `Scoring plays, turnovers and big gains from your games${closeOn ? " and close 4th-quarter games" : ""} show up here.`
          : "Pick games for your feed with ⚙ Customize — your We-Pick games, teams you follow, or featured games."}</div>}
    </aside>
  ) : (
    <aside className="wdl-rail">
      <div className="wdl-h">Feed</div>
      {bigPlays.length
        ? <FeedList items={bigPlays.filter((p) => !notYetShown(p)).slice(0, 12)} render={(p) => <BigPlayItem play={p} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer} onOpenGame={openGame} />} />
        : <div className="wdl-empty">{phase === "preview" ? "The Feed comes alive at kickoff — touchdowns, turnovers and big plays from across the slate." : "Touchdowns, turnovers and explosive plays from across the slate show up here."}</div>}
    </aside>
  );

  const grid = (list, empty) => (list.length
    ? <div className="wdl-grid">{list.map((g) => <GameTile key={g.id} game={g} followedTeams={followedTeams} onToggleTeam={toggleTeam} onOpen={openGame} />)}</div>
    : <div className="wdl-empty">{empty}</div>);

  let body;
  if (!slate) body = <div className="wdl-empty">{error ? "We-Draft Live is temporarily unavailable." : "Loading the slate…"}</div>;
  else if (pathSlug && !gameParam) body = (
    <div className="wdl-empty">{pathMissing ? <>We couldn't find that game. <Link to="/live" style={{ color: GOLD }}>See this week's games →</Link></> : "Loading the game…"}</div>
  );
  // keyed by game: switching games (the schedule strip up top) starts the
  // new one fresh — its first tab, its own picks and reveal state.
  else if (view === "game" && gameParam) body = <GameView key={gameParam} gameId={gameParam} slateGame={games.find((g) => g.id === gameParam)} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer} onQueueChange={onQueueChange} showRecap={compact} onWeek={goWeek} />;
  else if (compact && (view === "game" || onFeed) && gameParam) body = (
    <div className="wdl-solo">
      <button className="wdl-back" onClick={() => { unlockOrientation(); setParams({ view: "feed" }); window.scrollTo(0, 0); }}>← Feed</button>
      <div className="wdl-rotate"><b>↻</b> Turn your device upright for the full game view</div>
      <GameView key={gameParam} gameId={gameParam} slateGame={games.find((g) => g.id === gameParam)} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer} onQueueChange={onQueueChange} showRecap onWeek={goWeek} />
    </div>
  );
  else if (compact && onFeed) body = feedRail;
  else if (onFeed) body = feedGameId
    ? <GameView key={feedGameId} gameId={feedGameId} slateGame={games.find((g) => g.id === feedGameId)} followedPlayers={followedPlayers} onTogglePlayer={togglePlayer} focusPlayId={focusPlay} onQueueChange={onQueueChange} />
    : <div className="wdl-empty">Your feed's games will play out here. Use ⚙ Customize on the right to choose them.</div>;
  else if (view === "wepick") body = (
    <Suspense fallback={<div className="wdl-empty">Loading We-Pick…</div>}>
      <WePickHub liveWeek={wePickWeek} livePhase={phase} nextWeekAt={slate.nextWeekAt || null} />
    </Suspense>
  );
  else if (view === "week") {
    // In preview / review, a This week | Last week toggle (This week first).
    const lastWeek = Number(slate.week) - 1;
    const canLast = (phase === "preview" || phase === "review") && lastWeek > 0;
    const showLast = canLast && ywWhich === "last";
    const toggle = canLast && (
      <div className="wdl-gtabs" style={{ marginTop: 0 }}>
        <button className={`wdl-gtab${!showLast ? " on" : ""}`} onClick={() => setYwWhich("this")}>This week · Week {slate.week}</button>
        <button className={`wdl-gtab${showLast ? " on" : ""}`} onClick={() => setYwWhich("last")}>Last week · Week {lastWeek}</button>
      </div>
    );
    const shared = { signedIn: !!user, login, grid, onOpen: openGame, onCustomize: () => setView("customize"), onWePick: () => setView("wepick"), toggle };
    body = showLast
      ? <YourLastWeek key={lastWeek} season={games.find((x) => x.season)?.season || new Date().getFullYear()} week={lastWeek} uid={user?.uid || null}
          followedTeams={followedTeams} followedPlayers={followedPlayers} weekFollows={lastWeekFollows} {...shared} />
      : (<YourWeek week={slate.week} signedIn={!!user} login={login} rankedGames={rankedGames} rankedRows={rankedRows} standing={weekStanding}
      teamGames={games.filter((g) => feedTeams.includes(g.home.providerTeamId) || feedTeams.includes(g.away.providerTeamId))}
      players={feedPlayers} games={games} grid={grid} onOpen={openGame} onCustomize={() => setView("customize")} onWePick={() => setView("wepick")} toggle={toggle} />
  );
  }
  else if (view === "perf") body = (
    <LivePerformances games={games} followedIds={followedIds} onTogglePlayer={togglePlayer}
      onOpenGame={(id) => { openGame(id); if (compact) tryPortrait(); window.scrollTo(0, 0); }} />
  );
  else if (view === "lastweek") body = (
    <LastWeek season={games.find((x) => x.season)?.season || new Date().getFullYear()} week={Number(slate.week) - 1} grid={grid}
      followedIds={followedIds} onTogglePlayer={togglePlayer}
      onOpenGame={(id) => { openGame(id); if (compact) tryPortrait(); window.scrollTo(0, 0); }} />
  );
  else if (view === "customize" && !user) body = (
    <div className="wdl-custpage">
      <div className="wdl-h">Customize your Feed</div>
      <div className="wdl-cust-sub"><button className="wdl-yw-cta" onClick={login}>Log in</button> to follow teams and players and build your own Feed. It's free.</div>
    </div>
  );
  else if (view === "customize") body = (
    <div className="wdl-custpage">
      <div className="wdl-h">Customize your Feed</div>
      {!feedWindow.open && (
        <div className="wdl-feed-nudge">
          My Feed opens an hour before kickoff{feedWindow.opensAt ? ` — today at ${new Date(feedWindow.opensAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : " on game days"}. Set it up now and it'll be ready.
        </div>
      )}
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
      {/* This week: starts as your teams and players above; add or drop
          some just for this week — it starts over next week. */}
      <div className="wdl-follow-sec wdl-week">
        <div className="wdl-cust-h">This week{slate?.week ? ` · Week ${slate.week}` : ""}</div>
        <div className="wdl-cust-sub">What your Feed follows this week. Starts as your teams and players — add or drop any just for this week; it resets next week.</div>
        {feedTeams.length || feedPlayers.length ? (
          <div className="wdl-athletes" style={{ marginBottom: 12 }}>
            {feedTeams.map((id) => {
              const t = teamInfo(id);
              return (
                <button key={`t${id}`} className={`wdl-ath on wdl-chip${week.addTeams.includes(id) ? " wk" : ""}`} onClick={() => toggleWeekTeamId(id)} title="Drop for this week">
                  {t.logo && <img src={t.logo} alt="" />}{t.name}{week.addTeams.includes(id) && <span className="wdl-chip-sub"> this week</span>} ✕
                </button>
              );
            })}
            {feedPlayers.map((p) => (
              <button key={`p${p.id}`} className={`wdl-ath on${week.addPlayers.some((x) => String(x.id) === String(p.id)) ? " wk" : ""}`} onClick={() => toggleWeekPlayerObj(p)} title="Drop for this week">
                {p.name}{p.team && <span className="wdl-chip-sub"> {[p.position, p.team].filter(Boolean).join(" · ")}</span>} ✕
              </button>
            ))}
          </div>
        ) : <div className="wdl-cust-sub">Nothing this week yet — add a team or player here or above.</div>}
        {(week.dropTeams.length > 0 || week.dropPlayers.length > 0) && (
          <div className="wdl-athletes" style={{ marginBottom: 12 }}>
            {week.dropTeams.filter((id) => followedTeams.includes(id)).map((id) => {
              const t = teamInfo(id);
              return <button key={`dt${id}`} className="wdl-ath off wdl-chip" onClick={() => toggleWeekTeamId(id)} title="Add back this week">{t.logo && <img src={t.logo} alt="" />}+ {t.name}</button>;
            })}
            {followedPlayers.filter((p) => week.dropPlayers.includes(String(p.id))).map((p) => (
              <button key={`dp${p.id}`} className="wdl-ath off" onClick={() => toggleWeekPlayerObj(p)} title="Add back this week">+ {p.name}</button>
            ))}
          </div>
        )}
        <TeamSearch schools={schools} followed={feedTeams} onToggle={toggleWeekTeamId} placeholder="Add a team for this week only" labels={["✓ This week", "+ This week"]} />
        <PlayerSearch followedIds={feedPlayerIds} onToggle={toggleWeekPlayerObj} placeholder="Add a player for this week only" labels={["✓ This week", "+ This week"]} />
      </div>
      <FeedCustomize prefs={feedPrefs} onChange={updatePrefs} onClose={() => setView(feedWindow.open ? "feed" : "all")}
        signedIn={!!user} rankedCount={rankedGames.length} teamCount={followedTeams.length} playerCount={followedPlayers.length} />
    </div>
  );
  else if (view === "all" && params.get("week") && Number(params.get("week")) !== Number(slate.week)) body = (
    <WeekSlate season={games.find((x) => x.season)?.season || new Date().getFullYear()} week={Number(params.get("week"))} current={slate.week} onWeek={goWeek} grid={grid} />
  );
  else if (phase === "preview") body = (
    <div>
      {gamesByDay(games).map(([day, list]) => (
        <div key={day} className="wdl-day">
          <div className="wdl-h">{day} · {list.length} game{list.length === 1 ? "" : "s"}</div>
          {grid(list, "")}
        </div>
      ))}
      {!games.length && <div className="wdl-empty">No games on the slate yet.</div>}
    </div>
  );
  else body = (() => {
    const done = games.filter((g) => g.status === "final");
    const sub = done.length ? allSub || (phase === "review" ? "completed" : "all") : "all";
    const list = sub === "completed" ? done : games;
    return (
      <div>
        {slate.week != null && <WeekNav week={Number(slate.week)} current={null} onWeek={goWeek} />}
        {done.length > 0 && (
          <div className="wdl-gtabs" style={{ marginTop: 0 }}>
            <button className={`wdl-gtab${sub === "all" ? " on" : ""}`} onClick={() => setAllSub("all")}>All games · {games.length}</button>
            <button className={`wdl-gtab${sub === "completed" ? " on" : ""}`} onClick={() => setAllSub("completed")}>Completed · {done.length}</button>
          </div>
        )}
        <div className="wdl-h">{slate.week ? `Week ${slate.week}` : "This week"} · {sub === "completed" ? `${done.length} final${done.length === 1 ? "" : "s"}` : `${games.length} games`}</div>
        {grid(feedWindow.open && sub === "all" ? list : [...list].sort(byTop25), "No games on the slate right now.")}
      </div>
    );
  })();

  const split = !compact && ((view === "all" && feedWindow.open) || view === "game" || onFeed);

  // ── SEO ── one canonical /live page (views and picked games are just
  // state on it). The title names the open game when there is one; the
  // structured data lists the slate as SportsEvents.
  const seo = (() => {
    // A game's own page (/live/{slug}): its title follows the game —
    // preview, live score, final — and it's its own canonical.
    if (pathSlug) {
      const g = pathGame;
      if (!g) return { title: pathMissing ? "Game not found | We-Draft Live" : "We-Draft Live", description: "", url: `${LIVE_URL}/${pathSlug}`, noindex: pathMissing, jsonLd: null };
      const a = g.away?.school || g.away?.name || "Away";
      const h = g.home?.school || g.home?.name || "Home";
      const year = g.season || (g.startDate ? new Date(g.startDate).getFullYear() : "");
      const when = g.startDate ? new Date(g.startDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
      const final = g.status === "final";
      const live = g.status === "in_progress";
      const score = `${teamShort(g.away)} ${g.away?.points ?? 0}, ${teamShort(g.home)} ${g.home?.points ?? 0}`;
      const title = final ? `${a} vs ${h} Final Score (${g.away?.points ?? 0}-${g.home?.points ?? 0}): Box Score & Stats ${year} | We-Draft Live`
        : live ? `${a} vs ${h} Live Score & Play-by-Play | We-Draft Live`
        : `${a} vs ${h} ${year} Preview & Prediction | We-Draft Live`;
      const description = final ? `${a} vs ${h} final score: ${score}${when ? ` (${when})` : ""}. Box score, team and player stats, play-by-play, drive summary and game recap on We-Draft Live.`
        : live ? `Follow ${a} vs ${h} live: ${score}, ${statusLabel(g)}. Live play-by-play, drive-by-drive updates, game stats and live chat on We-Draft Live.`
        : `${a} vs ${h} preview${when ? ` — ${when}` : ""}: tale of the tape with team stats and national ranks, team leaders, NFL Draft prospects to watch and community picks. Live scores and play-by-play on game day.`;
      const url = `${LIVE_URL}/${pathSlug}`;
      const team = (t) => ({ "@type": "SportsTeam", name: t?.school || t?.name });
      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        name: `${a} vs ${h}`,
        sport: "American football",
        url,
        description,
        startDate: g.startDate || undefined,
        eventStatus: final ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        awayTeam: team(g.away),
        homeTeam: team(g.home),
        competitor: [team(g.away), team(g.home)],
        ...(g.venue ? { location: { "@type": "Place", name: g.venue } } : {}),
      };
      // Link previews (texts, social): the home team's logo, else the away's.
      const image = g.home?.logo || g.away?.logo || g.home?.logoDark || g.away?.logoDark || null;
      return { title, description, url, jsonLd: { ...jsonLd, ...(image ? { image } : {}) }, image, h1: `${a} vs ${h}${final ? " Final Score" : live ? " Live Score" : " Preview"}` };
    }
    const openId = gameParam || null;
    const og = openId ? games.find((g) => g.id === openId) : null;
    const title = og
      ? `${og.away.school || og.away.name} vs ${og.home.school || og.home.name} Live Score & Play-by-Play | We-Draft Live`
      : `College Football Live Scores, Play-by-Play & Big Plays${slate?.week ? ` — Week ${slate.week}` : ""} | We-Draft Live`;
    const description = og
      ? `Follow ${og.away.school || og.away.name} vs ${og.home.school || og.home.name} live: score, play-by-play, drive-by-drive updates and game stats on We-Draft Live.`
      : `Live college football scores, play-by-play, scoring plays, turnovers and big plays across the FBS slate${liveCount ? ` — ${liveCount} game${liveCount === 1 ? "" : "s"} live now` : ""}. Follow your teams and players on We-Draft Live.`;
    const statusOf = (g) => (g.status === "final" ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled");
    const team = (t) => ({ "@type": "SportsTeam", name: t.school || t.name });
    const events = games.slice(0, 60).map((g) => ({
      "@type": "SportsEvent",
      name: `${g.away.school || g.away.name} vs ${g.home.school || g.home.name}`,
      sport: "American football",
      startDate: g.startDate || undefined,
      eventStatus: statusOf(g),
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      awayTeam: team(g.away),
      homeTeam: team(g.home),
      competitor: [team(g.away), team(g.home)],
      url: g.slug ? `${LIVE_URL}/${g.slug}` : `${LIVE_URL}?view=game&game=${g.id}`,
    }));
    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "@id": LIVE_URL,
          url: LIVE_URL,
          name: "We-Draft Live — College Football Live Scores & Play-by-Play",
          description,
          isPartOf: { "@type": "WebSite", name: "We-Draft", url: "https://we-draft.com/" },
          about: { "@type": "Thing", name: "College football" },
        },
        ...(events.length ? [{ "@type": "ItemList", name: slate?.week ? `Week ${slate.week} college football games` : "College football games", itemListElement: events.map((e, i) => ({ "@type": "ListItem", position: i + 1, item: e })) }] : []),
      ],
    };
    return { title, description, jsonLd, url: LIVE_URL, h1: "College Football Live Scores & Play-by-Play" };
  })();

  // Prerender: snapshot once the slate (and, on a game's page, the game)
  // is in, with a moment for the game view to fill.
  const seoReady = !!slate && (!pathSlug || !!pathGame || pathMissing);
  useEffect(() => {
    if (!seoReady) return undefined;
    const t = setTimeout(() => { window.prerenderReady = true; }, pathSlug ? 2500 : 800);
    return () => clearTimeout(t);
  }, [seoReady, pathSlug]);

  return (
    <div className={`wdl${compact ? " wdl-compact" : ""}`}>
      <Helmet>
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={seo.url} />
        <meta name="robots" content={seo.noindex ? "noindex, follow" : "index, follow, max-image-preview:large"} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="We-Draft" />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:url" content={seo.url} />
        <meta property="og:image" content={seo.image || "https://we-draft.com/logo512.png"} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={seo.title} />
        <meta name="twitter:description" content={seo.description} />
        <meta name="twitter:image" content={seo.image || "https://we-draft.com/logo512.png"} />
        {seo.jsonLd && <script type="application/ld+json">{JSON.stringify(seo.jsonLd)}</script>}
      </Helmet>
      <style>{STYLE}</style>
      {/* The page's H1 — screen-reader / crawler only (the board shows the
          matchup visually). */}
      {seo.h1 && <h1 className="wdl-sr">{seo.h1}</h1>}
      <header className="wdl-top">
        <Link to="/" target="_blank" rel="noopener noreferrer" className="wdl-brand" aria-label="We-Draft.com home (opens in a new tab)"><img src={Logo2} alt="We-Draft.com" /><span>LIVE</span></Link>
        <nav className="wdl-tabs" ref={tabsRef}>
          {tabs.map((t) => (
            <button key={t.key} className={`wdl-tab${view === t.key ? " on" : ""}`} onClick={() => (t.key === "game" ? null : setView(t.key))}>{t.label}</button>
          ))}
          {compact && canFullscreen && (
            <button className="wdl-tab wdl-fs" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit full screen" : "Full screen"}>
              {isFullscreen ? "✕ Exit full screen" : "⛶ Full screen"}
            </button>
          )}
        </nav>
        <div className="wdl-meta">
          {updatedLabel && <span>Updated {updatedLabel}</span>}
          <button className="wdl-iconbtn" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {})}>⛶ Full screen</button>
        </div>
        {user
          ? <span className="wdl-auth on" title="Your follows and Feed settings are saved to your account">✓ Signed in</span>
          : <button className="wdl-auth" onClick={login} title="Log in to save your teams, players and Feed to your account">Log in</button>}
      </header>
      <AuthModal />
      {slate && view !== "all" && (
        <ScoreStrip games={stripGames} phase={phase} current={onFeed && !compact ? feedGameId : gameParam}
          onPick={(id) => { if (onFeed) setParams({ view: "feed", game: id }); else openGame(id); if (compact) { tryPortrait(); window.scrollTo(0, 0); } }}
          onPopout={canScoresPop ? () => (scoresWin ? scoresWin.close() : setScoresPicker((v) => !v)) : undefined} popped={!!scoresWin} />
      )}
      {/* All Games has no score strip — its own pop-out scores button. */}
      {slate && view === "all" && canScoresPop && (
        <div className="wdl-sw-row">
          <button type="button" className={`wdl-sw-btn${scoresWin ? " on" : ""}`} onClick={() => (scoresWin ? scoresWin.close() : setScoresPicker((v) => !v))}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9 3h8v8M17 3l-7.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {scoresWin ? "Scores popped out · Close" : "Pop out scores"}
          </button>
        </div>
      )}
      {scoresPicker && slate && (
        <ScoresPicker games={games} sel={scoresSel} onChange={updateScoresSel} onOpen={openScores} onClose={() => setScoresPicker(false)} />
      )}
      {scoresWin && slate && createPortal(
        <ScoresWidget games={games} week={slate.week} picked={scoresSel.mode === "pick" ? scoresSel.ids : null} tvShort={pageTvShort} />,
        scoresWin.document.body,
      )}
      {slate && (phase === "preview" || phase === "review") && ["all", "feed", "perf", "week"].includes(view) && !(compact && gameParam) && (
        <PhaseBanner phase={phase} slate={slate} games={games} setView={setView} />
      )}
      <main className={`wdl-main${split ? " split" : ""}${onFeed ? " feed" : ""}${compact ? " compact" : ""}`}>
        <section>{body}</section>
        {split && slate && (view === "game" && gameParam ? <GameRecapRail key={gameParam} gameId={gameParam} slateGame={games.find((g) => g.id === gameParam)} fallback={feedRail} /> : feedRail)}
      </main>
    </div>
  );
}
