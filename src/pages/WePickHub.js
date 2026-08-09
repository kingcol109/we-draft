// src/pages/WePickHub.js
//
// We-Pick hub — a home for everything pick-related that isn't tied to one
// game's own page. Organized by week, dark-themed to feel distinct from
// the rest of the site (same dark-card language GamePage.js's hero
// established). A game sorts into one of three sections purely off pick
// state: "Games" (no prediction yet), "Unranked" (a score prediction
// exists but isn't marked to count), or "Ranked" (a score prediction
// exists AND is starred to count, on a still-qualified game). The star is
// a per-game toggle, not a batch "save my 6" step — there's still no
// separate save button, a status line just reports whether the current
// starred set satisfies the week's requirement (1 Game of the Week, at
// least 2 Featured, 6 total) and what's still missing.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import * as htmlToImage from "html-to-image";
import { db } from "../firebase";
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import LoadingSpinner from "../components/LoadingSpinner";
import { useAuth } from "../context/AuthContext";

// One doc per leaderboard: "season" for the 2026 season-long standings, or
// a week label ("Week 1") for that week alone. See firestore.rules for why
// this is admin-write-only — nothing populates it yet, scoring logic is
// still TBD, but the page is built to read it the moment something does.
const STANDINGS_COLLECTION = "wePickStandings2026";

// A user's locked-in Ranked 6 for a given week: wePickSubmissions/{week}/
// entries/{uid} → { uid, displayName, gameIds, submittedAt }. Distinct from
// the per-game `ranked` star toggle (which can keep changing right up until
// kickoff) — this is the explicit "submit for ranking" snapshot the
// eventual scoring job reads to know exactly which 6 games counted, so a
// last-second unstar/restar after submitting doesn't quietly change what
// someone's being scored on. Public read (same reasoning as schedule26's
// picks subcollection — the scoring job and any future public "who's
// submitted" UI both need to read across users), write locked to the
// submission's own owner.
const SUBMISSIONS_COLLECTION = "wePickSubmissions";

// Row caps for Ranked Standings — season shows a Top 10 by default,
// expandable to a Top 100; a single week's board is smaller so its ceiling
// is lower, Top 10 expanding to Top 25.
const STANDINGS_LIMITS = {
  season: { default: 10, max: 100 },
  week: { default: 10, max: 25 },
};

// ── Ranked Standings scoring — locked-in spec, not computed anywhere yet ──
// Per graded pick, once its game has gone Final:
//   - Wrong winner  → 0 points, full stop. No credit for a close score on
//     a game you called for the wrong team — the winner call comes first.
//   - Right winner  → 100 points, plus up to 200 more for how close the
//     final score was:
//       + max(0, 100 - 10 * |actual home score - predicted home score|)
//       + max(0, 100 - 10 * |actual away score - predicted away score|)
//     A dead-on final score is worth the full 300; each point of miss on
//     either side costs 10, down to a floor of 0 once you're 10+ off.
// A week's total is the sum of that across the week's Ranked 6 — but ONLY
// if the week is actually "qualified" (rankedStatus() above: 6 games, 1
// Game of the Week, 2+ Featured). Falling short zeroes that week for
// standings purposes, same as not having played it — the composition rule
// has to actually matter, not just be a badge on the My Picks tab.
// Season standings = the sum of every qualified week's total (more weeks
// played well is strictly better, same as a real season), shown alongside
// points-per-qualified-week as a secondary "Avg/Wk" stat — informational
// only, nothing is ranked by it. See compareStandingsEntries below for how
// ties in the summed total get broken.

// Tiebreak for two entries with an equal points total: most correct
// winners wins first (rewards prediction skill even when a different mix
// of winner-calls vs. score-accuracy produced the same sum), then lowest
// cumulative score differential as a fine-grained last resort — that's a
// real-valued sum of raw |actual - predicted| across every graded pick, so
// it essentially never ties itself the way the by-10s points total can.
function compareStandingsEntries(a, b) {
  const points = (b.points ?? 0) - (a.points ?? 0);
  if (points !== 0) return points;
  const correct = (b.correct ?? 0) - (a.correct ?? 0);
  if (correct !== 0) return correct;
  return (a.diffTotal ?? Infinity) - (b.diffTotal ?? Infinity);
}

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const PAGE_BG = "linear-gradient(180deg, #06162c, #0d2544)";
const CARD_BG = "rgba(255,255,255,0.05)";
const CARD_BORDER = "rgba(255,255,255,0.18)";

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

// Same "Monday-to-Sunday, computed in UTC" boundary math as GamePage.js's
// own mondayOfWeekUtc — duplicated per this codebase's convention of not
// importing small shared helpers cross-page.
const mondayOfWeekUtc = (ms) => {
  const d = new Date(ms);
  const utcDay = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (utcDay === 0 ? -6 : 1) - utcDay;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday, 0, 0, 0, 0);
};

const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

const formatOpensDate = (ms) => {
  const d = new Date(ms);
  const month = d.toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });
  return `${month} ${ordinal(d.getUTCDate())}`;
};

// Which side a pick calls to win — same fallback-to-score-comparison shape
// as GamePage.js's own pickedSideOf, for picks written before the explicit
// pickedTeam field existed.
const pickedSideOf = (p) => {
  if (p.pickedTeam === "away" || p.pickedTeam === "home") return p.pickedTeam;
  if (p.awayScore == null || p.homeScore == null) return null;
  if (p.awayScore > p.homeScore) return "away";
  if (p.homeScore > p.awayScore) return "home";
  return null;
};

const isGameFinal = (g) => g.Final && g.HomeScore != null && g.AwayScore != null;
const hasScorePick = (p) => !!p && p.awayScore != null && p.homeScore != null;

// ── My Stats — per-user performance tracking ──
// Winner/loser accuracy (both ranked and unranked) is fully derivable from
// a user's own pick history + each game's real result, so it's computed
// live below rather than stored anywhere. "Best Ranked Score" is the same
// story — it's the Ranked Standings scoring formula (see the spec further
// up) applied to this user's own graded Ranked 6 picks, maxed across
// weeks — also live-computed, no storage needed. "Highest Leaderboard
// Ranking" is the one exception: knowing where you stood requires
// everyone else's results too, which nothing computes yet (see
// STANDINGS_COLLECTION) — so it's read from a small per-user doc instead,
// admin-write-only same as standings itself, since a user shouldn't be
// able to just write themselves a #1 finish. Missing/placeholder either
// way, everything here falls back to sample data (flagged, never silently
// passed off as real) so this tab has something to look at before anyone
// has graded history yet.
const MYSTATS_COLLECTION = "wePickStats"; // users/{uid}/wePickStats/{season}
const MYSTATS_SEASON_DOC = "season2026";

// Winner-only accuracy tally for a list of {pick, game} pairs — correct vs.
// incorrect based purely on who won, no score-precision credit (that's what
// scoreGamePick below is for). Only counts pairs whose game has actually
// gone Final with a resolvable winner and a resolvable picked side.
function tallyAccuracy(rows) {
  let correct = 0;
  let incorrect = 0;
  rows.forEach(({ pick, game }) => {
    if (!game || !isGameFinal(game) || !pick) return;
    const side = pickedSideOf(pick);
    if (!side) return;
    const actualWinner = game.AwayScore > game.HomeScore ? "away" : game.HomeScore > game.AwayScore ? "home" : null;
    if (!actualWinner) return;
    if (side === actualWinner) correct++; else incorrect++;
  });
  return { correct, incorrect, total: correct + incorrect };
}

// The Ranked Standings scoring formula (see the spec further up), applied
// to one pick — 0 for a wrong winner, otherwise 100 plus up to 200 more
// for how close the final score was on each side.
function scoreGamePick(pick, game) {
  if (!game || !isGameFinal(game) || !hasScorePick(pick)) return 0;
  const side = pickedSideOf(pick);
  const actualWinner = game.AwayScore > game.HomeScore ? "away" : game.HomeScore > game.AwayScore ? "home" : null;
  if (!actualWinner || side !== actualWinner) return 0;
  const awayAcc = Math.max(0, 100 - 10 * Math.abs(game.AwayScore - pick.awayScore));
  const homeAcc = Math.max(0, 100 - 10 * Math.abs(game.HomeScore - pick.homeScore));
  return 100 + awayAcc + homeAcc;
}

// Minutes-since-midnight, for actually chronological sorting — a game's
// Date field is UTC midnight regardless of kickoff, so every game on the
// same calendar day ties on Date alone; Time has to be the real tiebreaker,
// and comparing formatted 12-hour strings ("10:00 PM" < "12:00 PM" < "7:00
// PM" alphabetically) sorts them wrong.
const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};

// Admin enters Kickoff Time as a plain "HH:MM" with no timezone attached —
// CFB kickoffs are always quoted in US Eastern (see AdminPanel.js's
// "Kickoff Time" field), so that's the zone assumed here. Reads the actual
// UTC offset for America/New_York on the game's own date via Intl (rather
// than hardcoding UTC-5) so this stays correct across the EDT/EST switch
// partway through the season instead of drifting an hour on one side of it.
const ET_OFFSET_FALLBACK_MIN = -300; // EST — only used if Intl's parse ever fails
const etOffsetMinutesAt = (ms) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(ms));
    const tz = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(tz);
    if (!m) return ET_OFFSET_FALLBACK_MIN;
    const h = parseInt(m[1], 10);
    const mins = m[2] ? parseInt(m[2], 10) : 0;
    return h * 60 + (h < 0 ? -mins : mins);
  } catch {
    return ET_OFFSET_FALLBACK_MIN;
  }
};

// The actual UTC instant a game kicks off, combining Date (UTC midnight)
// with Time (ET wall-clock) — null when either is missing, since Kickoff
// Time is optional in the admin form and there's no hour to lock at
// without one (isPickable falls back to Final-only locking in that case,
// same as before kickoff-locking existed).
const kickoffMs = (g) => {
  const dateMs = toMs(g.Date);
  const mins = timeToMinutes(g.Time);
  if (!dateMs || mins == null) return null;
  return dateMs + mins * 60000 - etOffsetMinutesAt(dateMs) * 60000;
};

// A game is open for picks once its own week's Monday (00:00 UTC) has
// passed, or an admin has force-opened it — same rule GamePage.js enforces
// for the single-game pick form. Week 0 is opened unconditionally instead
// of waiting on its own Monday — it kicks off before every other week and
// has no games flagged Game of the Week/Featured to build a normal Ranked
// 6 around (see rankedStatus's own Week 0 branch below), so there's no
// reason to make people wait on the calendar for it specifically. None of
// that overrides kickoff, though — once the ball's in the air, picks lock
// for good regardless of PicksForceOpen or which week this is (Final only
// covers a game *after* it's over; kickoff is what actually stops new or
// changed picks on a live one).
const isPickable = (g) => {
  if (isGameFinal(g)) return false;
  const kickoff = kickoffMs(g);
  if (kickoff != null && Date.now() >= kickoff) return false;
  if (g.PicksForceOpen) return true;
  if (g.Week === "Week 0") return true;
  const dateMs = toMs(g.Date);
  if (!dateMs) return true;
  return Date.now() >= mondayOfWeekUtc(dateMs);
};

// Same "extract the leading number" used everywhere else in this codebase
// that sorts Week labels ("Week 0", "Week 12", ...) — AdminPanel.js's own
// weekNumber, duplicated rather than imported.
const weekNumber = (w) => {
  const m = /(\d+)/.exec(w || "");
  return m ? Number(m[1]) : 999;
};

// Default sort tier — Game of the Week first, then Featured, then every
// other still-qualified game, then disqualified ones last. Date/time is
// the tiebreaker within each tier.
const gameTier = (g) => {
  if (g.RankedDisqualified) return 3;
  if (g.GameOfWeek) return 0;
  if (g.Featured) return 1;
  return 2;
};

// The games actually counting toward ranked eligibility right now — a
// score pick on a still-qualified game, nothing else (winner-only picks
// and disqualified games never count, no matter how many of them exist).
// Week 0 drops the Game of the Week/Featured requirements entirely (its
// slate has never had either flag set — see isPickable above) and just
// needs 6 ranked games, any 6, full stop.
function rankedStatus(rankedGames, week) {
  const total = rankedGames.length;
  if (week === "Week 0") {
    const isQualified = total >= 6;
    if (isQualified) return { isQualified, text: "You're qualified for Ranked this week! 🏆" };
    const remaining = 6 - total;
    return { isQualified, text: `Still need: ${remaining} more game${remaining === 1 ? "" : "s"} overall.` };
  }
  const gotwCount = rankedGames.filter((g) => g.GameOfWeek).length;
  const featuredCount = rankedGames.filter((g) => g.Featured).length;
  const isQualified = total >= 6 && gotwCount >= 1 && featuredCount >= 2;
  if (isQualified) return { isQualified, text: "You're qualified for Ranked this week! 🏆" };
  const needs = [];
  if (gotwCount < 1) needs.push("the Game of the Week");
  if (featuredCount < 2) needs.push(`${2 - featuredCount} more Featured game${2 - featuredCount === 1 ? "" : "s"}`);
  const remaining = 6 - total;
  if (remaining > 0) needs.push(`${remaining} more game${remaining === 1 ? "" : "s"} overall`);
  return { isQualified, text: `Still need: ${needs.join(", ")}.` };
}

export default function WePickHub() {
  const location = useLocation();
  // Path-based, same convention as PerformancesHub.jsx's activeTab — lets
  // /we-pick/standings (and /we-pick/standings/:week) or /we-pick/stats
  // deep-link straight into the tab instead of always landing on My Picks.
  const activeTab = location.pathname.startsWith("/we-pick/standings")
    ? "standings"
    : location.pathname.startsWith("/we-pick/stats")
    ? "stats"
    : "picks";

  const TAB_TITLES = { standings: "Ranked Standings", stats: "My Stats" };
  const pageTitle = TAB_TITLES[activeTab]
    ? `${TAB_TITLES[activeTab]} | We-Pick | We-Draft`
    : "We-Pick | Predict College Football Scores & Build Your Ranked 6";
  const pageDescription = "Make your picks, see how they stack up against your friends and the community, and track them throughout the season with We-Draft's We-Pick.";
  const canonicalUrl = `https://we-draft.com${location.pathname}`;

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="We-Draft" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
      </Helmet>

      <div
        style={{
          background: PAGE_BG, border: `2px solid ${BLUE}`, borderRadius: "16px",
          padding: "22px 22px 30px", boxShadow: "0 10px 32px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ marginBottom: "18px" }}>
          <div style={{ fontSize: "30px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.03em", textShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>
            🔮 We-Pick
          </div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "rgba(255,255,255,0.65)", marginTop: "2px" }}>
            Predict scores, build your Ranked 6, and see where you stack up.
          </div>
        </div>

        {/* Tab bar — My Picks (default), Standings, and My Stats, each its
            own URL so any of them is deep-linkable/shareable rather than
            living behind in-page-only tab state. */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px", borderBottom: "2px solid rgba(255,255,255,0.15)", flexWrap: "wrap" }}>
          {[
            { key: "picks", label: "My Picks", to: "/we-pick" },
            { key: "standings", label: "🏆 Ranked Standings", to: "/we-pick/standings" },
            { key: "stats", label: "📊 My Stats", to: "/we-pick/stats" },
          ].map((tab) => (
            <Link
              key={tab.key}
              to={tab.to}
              style={{
                padding: "10px 20px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em",
                color: activeTab === tab.key ? "#fff" : "rgba(255,255,255,0.55)",
                borderBottom: activeTab === tab.key ? `3px solid ${GOLD}` : "3px solid transparent",
                marginBottom: "-2px", textDecoration: "none",
              }}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {activeTab === "standings" ? <StandingsSection /> : activeTab === "stats" ? <MyStatsSection /> : <MyPicksSection />}
      </div>
    </div>
  );
}

function MyPicksSection() {
  const { user, profile, login } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allGames, setAllGames] = useState([]);
  const [schoolsByName, setSchoolsByName] = useState({});
  const [myPicks, setMyPicks] = useState([]); // [{id: gameId, ...pickFields}]
  const [selectedWeek, setSelectedWeek] = useState("");
  const [savingId, setSavingId] = useState("");
  const [removingId, setRemovingId] = useState("");
  // The week's locked-in Ranked 6, once submitted (see handleSubmitForRanking
  // and SUBMISSIONS_COLLECTION) — separate from the live star toggles above,
  // which can keep changing right up until kickoff. null = never submitted
  // for this week.
  const [submission, setSubmission] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // "idle" | "success" | "error" — a temporary flash confirming the Submit
  // click actually went through (the button's own "✓ Submitted for
  // Ranking" state is persistent but easy to miss right at the moment of
  // clicking; this is the immediate, hard-to-miss feedback). Auto-clears
  // after a few seconds; see handleSubmitForRanking.
  const [submitFeedback, setSubmitFeedback] = useState("idle");
  // This user's real rank on the selected week's leaderboard, once that
  // week is over — { rank, outOf } | null. Only fetched for a past week
  // (see the effect below), and stays null until a real
  // STANDINGS_COLLECTION doc exists for that week (nothing computes one
  // yet — see StandingsSection), which the Report Card treats as "pending"
  // rather than showing a made-up number on something meant to be posted
  // publicly.
  const [weekPlacement, setWeekPlacement] = useState(null);
  // Share modal — clicking either "Share Picks" or "Share Report Card"
  // (see handleSharePicks/handleShareReportCard) fills this in with the
  // card's content instead of sharing directly; the modal renders a hidden
  // branded card off-screen (shareCardRef), captures it to a PNG (see the
  // effect below), and offers Email/X/Text/Save-Image from there.
  // { heading, weekLabel, lines: string[], filename, shareText } | null
  const [shareModal, setShareModal] = useState(null);
  const [shareImageUrl, setShareImageUrl] = useState(null);
  const shareCardRef = useRef(null);

  // Waits a frame after shareModal's data lands so the hidden card (below,
  // in the render) has actually painted with that content before capturing
  // it — capturing on the same tick as setShareModal would grab whatever
  // was there before (usually nothing). skipFonts avoids inlining every
  // site font as base64 (slow, unnecessary for this card's plain system
  // stack); the IMG filter avoids CORS-tainting the canvas on an
  // externally-hosted logo, same reasoning as PlayerProfile.js's own
  // handleExportImage — this card is text-only for the same reason.
  useEffect(() => {
    if (!shareModal) { setShareImageUrl(null); return; }
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (cancelled || !shareCardRef.current) return;
        try {
          const dataUrl = await htmlToImage.toPng(shareCardRef.current, {
            pixelRatio: 2, backgroundColor: "#ffffff", skipFonts: true,
            filter: (node) => node.tagName !== "IMG",
          });
          if (!cancelled) setShareImageUrl(dataUrl);
        } catch (e) {
          console.error("We-Pick share-image render error:", e);
        }
      });
    });
    return () => { cancelled = true; };
  }, [shareModal]);

  const shareText = shareModal
    ? [`${shareModal.icon} ${shareModal.heading} — ${shareModal.weekLabel}`, ...shareModal.lines, "we-draft.com/we-pick"].join("\n")
    : "";

  const handleSaveShareImage = () => {
    if (!shareImageUrl || !shareModal) return;
    const link = document.createElement("a");
    link.download = `${shareModal.filename}.png`;
    link.href = shareImageUrl;
    link.click();
  };

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [gamesSnap, schoolsSnap, mirrorSnap] = await Promise.all([
          getDocs(collection(db, "schedule26")),
          getDocs(collection(db, "schools")),
          getDocs(collection(db, "users", user.uid, "picks")),
        ]);

        const games = gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAllGames(games);

        const schoolMap = {};
        schoolsSnap.docs.forEach((d) => { const data = d.data(); if (data.School) schoolMap[data.School] = data; });
        setSchoolsByName(schoolMap);

        setMyPicks(mirrorSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Default to the week containing right now (by its games' own
        // dates), falling back to the nearest upcoming week, then the
        // earliest week on file.
        const weeks = Array.from(new Set(games.map((g) => g.Week).filter(Boolean))).sort((a, b) => weekNumber(a) - weekNumber(b));
        const nowMs = Date.now();
        let bestWeek = weeks[0] || "";
        let bestFuture = Infinity;
        for (const w of weeks) {
          const weekGames = games.filter((g) => g.Week === w && toMs(g.Date));
          if (weekGames.length === 0) continue;
          const minDate = Math.min(...weekGames.map((g) => toMs(g.Date)));
          const monday = mondayOfWeekUtc(minDate);
          const sunday = monday + 7 * 24 * 60 * 60 * 1000 - 1;
          if (nowMs >= monday && nowMs <= sunday) { bestWeek = w; break; }
          if (minDate >= nowMs && minDate < bestFuture) { bestFuture = minDate; bestWeek = w; }
        }
        setSelectedWeek(bestWeek);
      } catch (e) {
        console.error("We-Pick fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [user]);

  // Whether the currently-selected week has already been submitted, and
  // with which games — independent of the main fetch above so switching
  // weeks doesn't require a full re-fetch of games/schools/picks.
  useEffect(() => {
    if (!user || !selectedWeek) { setSubmission(null); return; }
    let cancelled = false;
    getDoc(doc(db, SUBMISSIONS_COLLECTION, selectedWeek, "entries", user.uid))
      .then((snap) => { if (!cancelled) setSubmission(snap.exists() ? snap.data() : null); })
      .catch((e) => { console.error("We-Pick submission fetch error:", e); if (!cancelled) setSubmission(null); });
    return () => { cancelled = true; };
  }, [user, selectedWeek]);

  const gamesById = useMemo(() => {
    const map = {};
    allGames.forEach((g) => { map[g.id] = g; });
    return map;
  }, [allGames]);

  const myPicksById = useMemo(() => {
    const map = {};
    myPicks.forEach((p) => { map[p.id] = p; });
    return map;
  }, [myPicks]);

  const weekOptions = useMemo(
    () => Array.from(new Set(allGames.map((g) => g.Week).filter(Boolean))).sort((a, b) => weekNumber(a) - weekNumber(b)),
    [allGames]
  );

  const gamesForWeek = useMemo(
    () => allGames
      .filter((g) => g.Week === selectedWeek)
      .sort((a, b) => gameTier(a) - gameTier(b) || toMs(a.Date) - toMs(b.Date) || (timeToMinutes(a.Time) ?? 9999) - (timeToMinutes(b.Time) ?? 9999)),
    [allGames, selectedWeek]
  );

  const weekMonday = useMemo(() => {
    const dates = gamesForWeek.map((g) => toMs(g.Date)).filter(Boolean);
    return dates.length ? mondayOfWeekUtc(Math.min(...dates)) : 0;
  }, [gamesForWeek]);
  // "Open" for the purposes of showing the composition/status bar means at
  // least one game this week can actually be picked right now — that's
  // true either because the calendar date has arrived, or because an admin
  // force-opened it early (PicksForceOpen). Gating purely on the calendar
  // date hid the status bar behind an "opens {date}" message even for
  // weeks admins had deliberately force-opened, which was the bug.
  const weekOpen = gamesForWeek.some((g) => isPickable(g)) || gamesForWeek.some((g) => hasScorePick(myPicksById[g.id]));

  // Once every game on the slate has gone Final, this week is done — the
  // pickable/composition/Submit UI stops making sense (nothing left to
  // submit) and the view switches to a Report Card recapping what got
  // picked and how it turned out.
  const weekIsPast = gamesForWeek.length > 0 && gamesForWeek.every((g) => isGameFinal(g));

  // This user's placement on the week's real leaderboard, once the week's
  // over — reads STANDINGS_COLLECTION directly rather than assuming a
  // sample fallback (see weekPlacement's own comment for why: a report
  // card is meant to be posted publicly, so a fabricated rank here would
  // actively mislead whoever it's shared with, unlike the internal
  // "Sample Data" tags elsewhere in this file).
  useEffect(() => {
    if (!weekIsPast || !user || !selectedWeek) { setWeekPlacement(null); return; }
    let cancelled = false;
    getDoc(doc(db, STANDINGS_COLLECTION, selectedWeek))
      .then((snap) => {
        if (cancelled) return;
        const entries = Array.isArray(snap.data()?.entries) ? snap.data().entries : [];
        if (entries.length === 0) { setWeekPlacement(null); return; }
        const idx = [...entries].sort(compareStandingsEntries).findIndex((e) => e.uid === user.uid);
        setWeekPlacement(idx >= 0 ? { rank: idx + 1, outOf: entries.length } : null);
      })
      .catch((e) => { console.error("We-Pick placement fetch error:", e); if (!cancelled) setWeekPlacement(null); });
    return () => { cancelled = true; };
  }, [weekIsPast, user, selectedWeek]);

  const handleSaveScore = async (gameId, awayStr, homeStr, visibility, noteStr) => {
    if (!user) return;
    const a = Math.max(0, Math.min(99, Math.round(Number(awayStr))));
    const h = Math.max(0, Math.min(99, Math.round(Number(homeStr))));
    // Ties aren't a valid pick — every game has a winner. GameRow already
    // disables the Save button while the two boxes match; this is just the
    // same guard enforced at the actual write, in case it's ever called
    // from somewhere that skips the button.
    if (a === h) return;
    const existing = myPicksById[gameId];
    const payload = {
      uid: user.uid,
      displayName: profile?.username?.trim() || "Anonymous Fan",
      pickType: "score",
      pickedTeam: a > h ? "away" : h > a ? "home" : null,
      awayScore: a,
      homeScore: h,
      prediction: (noteStr ?? existing?.prediction ?? "").trim(),
      // Whether this pick counts toward the week's Ranked 6 (the star, see
      // handleToggleRanked) — defaults ON the moment an actual score gets
      // submitted, so counting toward Ranked is the default outcome rather
      // than something you have to remember to opt into. Only preserved
      // from the existing pick when there was already a score to have a
      // real ranked choice attached to it (a prior winner-only pick's
      // forced `ranked: false` isn't a deliberate opt-out worth keeping —
      // it never had the star shown at all — so upgrading one to a real
      // score still gets the same default-on treatment as a brand new
      // pick) — except once the week's Ranked 6 is already full, where a
      // brand new pick defaults to unranked instead of silently becoming a
      // 7th. rankedGames.length is safe to read here uncounted: a pick
      // without a score yet (which is exactly the branch this applies to)
      // can never already be one of the 6 it's being compared against.
      ranked: hasScorePick(existing) ? (existing?.ranked ?? true) : rankedGames.length < 6,
      visibility,
      updatedAt: serverTimestamp(),
    };
    setSavingId(gameId);
    try {
      await Promise.all([
        setDoc(doc(db, "schedule26", gameId, "picks", user.uid), payload),
        setDoc(doc(db, "users", user.uid, "picks", gameId), payload),
      ]);
      setMyPicks((prev) => [...prev.filter((p) => p.id !== gameId), { id: gameId, ...payload }]);
    } catch (e) {
      console.error("We-Pick save error:", e);
    } finally {
      setSavingId("");
    }
  };

  // The star button — flips whether an existing score pick counts toward
  // this week's Ranked 6. Writes immediately, same "canonical + private
  // mirror" pair as every other pick write here; no batch/save step.
  const handleToggleRanked = async (gameId, next) => {
    if (!user) return;
    const existing = myPicksById[gameId];
    if (!existing) return;
    // Turning ranked ON with the week's 6 already spoken for — rankedGames
    // can't already include this game (it's off, that's why next is true),
    // so its length is exactly the count this addition would push past 6.
    // Prompt rather than either silently no-op'ing or silently bumping
    // some other game off the list for them.
    if (next && rankedGames.length >= 6) {
      alert("Your Ranked 6 is already full for this week — remove one before adding another.");
      return;
    }
    const { id, ...rest } = existing;
    const payload = { ...rest, ranked: next, updatedAt: serverTimestamp() };
    setSavingId(gameId);
    try {
      await Promise.all([
        setDoc(doc(db, "schedule26", gameId, "picks", user.uid), payload, { merge: true }),
        setDoc(doc(db, "users", user.uid, "picks", gameId), payload, { merge: true }),
      ]);
      setMyPicks((prev) => prev.map((p) => (p.id === gameId ? { ...p, ranked: next } : p)));
    } catch (e) {
      console.error("We-Pick ranked-toggle error:", e);
    } finally {
      setSavingId("");
    }
  };

  // A quick winner-only pick — click a team's name (GameRow) instead of
  // filling in a score. No score means it can never satisfy hasScorePick,
  // so it can never be starred/counted toward Ranked (rankedStatus needs a
  // real score prediction) — it just lands in Unranked until a real score
  // gets added via handleSaveScore, which is the intended trade-off: this
  // is the fast/low-effort path, a full score is the one that can count.
  // Same immediate "canonical + private mirror" write as every other pick
  // action here, and the same full-overwrite (not merge) as handleSaveScore
  // since a winner-only pick is meant to replace whatever was there before.
  const handlePickWinner = async (gameId, teamSide) => {
    if (!user) return;
    const existing = myPicksById[gameId];
    const payload = {
      uid: user.uid,
      displayName: profile?.username?.trim() || "Anonymous Fan",
      pickType: "winner",
      pickedTeam: teamSide,
      awayScore: null,
      homeScore: null,
      prediction: existing?.prediction || "",
      ranked: false,
      visibility: existing?.visibility || "public",
      updatedAt: serverTimestamp(),
    };
    setSavingId(gameId);
    try {
      await Promise.all([
        setDoc(doc(db, "schedule26", gameId, "picks", user.uid), payload),
        setDoc(doc(db, "users", user.uid, "picks", gameId), payload),
      ]);
      setMyPicks((prev) => [...prev.filter((p) => p.id !== gameId), { id: gameId, ...payload }]);
    } catch (e) {
      console.error("We-Pick pick-winner error:", e);
    } finally {
      setSavingId("");
    }
  };

  // Locks in the current Ranked 6 as this week's official submission —
  // only callable once rankedStatus says the composition requirement is
  // met (the button itself stays disabled/hidden otherwise). Re-submitting
  // after changing which games are starred just overwrites the snapshot;
  // nothing here stops a user from starring/unstarring afterward, it just
  // means their submission is stale until they submit again (see
  // alreadySubmitted's set-comparison in the render below).
  const handleSubmitForRanking = async (rankedGameIds) => {
    if (!user || !selectedWeek) return;
    setSubmitting(true);
    setSubmitFeedback("idle");
    try {
      // Snapshotting each ranked game's actual score prediction (not just
      // which games are ranked) is what lets alreadySubmitted notice you
      // edited a score on an already-ranked game without changing the set
      // of ranked games at all — comparing gameIds alone would miss that
      // entirely and leave the button stuck showing "✓ Submitted" even
      // though what's locked in no longer matches what you actually picked.
      const predictions = {};
      rankedGameIds.forEach((id) => {
        const p = myPicksById[id];
        predictions[id] = { awayScore: p?.awayScore ?? null, homeScore: p?.homeScore ?? null };
      });
      const payload = {
        uid: user.uid,
        displayName: profile?.username?.trim() || "Anonymous Fan",
        week: selectedWeek,
        gameIds: rankedGameIds,
        predictions,
        submittedAt: serverTimestamp(),
      };
      await setDoc(doc(db, SUBMISSIONS_COLLECTION, selectedWeek, "entries", user.uid), payload);
      setSubmission(payload);
      setSubmitFeedback("success");
    } catch (e) {
      console.error("We-Pick submit-for-ranking error:", e);
      setSubmitFeedback("error");
    } finally {
      setSubmitting(false);
      setTimeout(() => setSubmitFeedback("idle"), 4000);
    }
  };

  const handleRemove = async (gameId) => {
    if (!user) return;
    setRemovingId(gameId);
    try {
      await Promise.all([
        deleteDoc(doc(db, "schedule26", gameId, "picks", user.uid)),
        deleteDoc(doc(db, "users", user.uid, "picks", gameId)),
      ]);
      setMyPicks((prev) => prev.filter((p) => p.id !== gameId));
    } catch (e) {
      console.error("We-Pick remove error:", e);
    } finally {
      setRemovingId("");
    }
  };

  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", border: `2px solid ${CARD_BORDER}`, borderRadius: "12px", background: CARD_BG }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "rgba(255,255,255,0.8)", marginBottom: "16px" }}>
          Sign in to make and manage your picks.
        </div>
        <button
          onClick={login}
          style={{ background: GOLD, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "11px 28px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer" }}
        >
          Sign In
        </button>
      </div>
    );
  }

  if (loading) return <LoadingSpinner label="Loading" size={48} minHeight="40vh" />;

  // Three buckets, purely off pick state: no prediction at all → "Games";
  // a prediction exists but isn't starred to count (or can't, because the
  // game's disqualified) → "Unranked"; a starred score prediction on a
  // still-qualified game → "Ranked". A winner-only prediction can never be
  // ranked (scores are required), but it still counts as "a prediction"
  // for landing in Unranked rather than Games.
  const rankedGames = gamesForWeek.filter((g) => {
    const p = myPicksById[g.id];
    return hasScorePick(p) && p.ranked === true && !g.RankedDisqualified;
  });
  const unrankedGames = gamesForWeek.filter((g) => {
    const p = myPicksById[g.id];
    if (!p) return false;
    return !(hasScorePick(p) && p.ranked === true && !g.RankedDisqualified);
  });
  const noPickGames = gamesForWeek.filter((g) => !myPicksById[g.id]);
  const status = rankedStatus(rankedGames, selectedWeek);

  // Same winner/loser tally My Stats uses, scoped to just this week — the
  // Report Card's (weekIsPast, computed above) headline numbers.
  const weekRankedTally = tallyAccuracy(rankedGames.map((g) => ({ pick: myPicksById[g.id], game: g })));
  const weekUnrankedTally = tallyAccuracy(unrankedGames.map((g) => ({ pick: myPicksById[g.id], game: g })));

  // Opens the share modal with this card's content — the modal (rendered
  // near the bottom of this component) captures a hidden branded version of
  // it to an image and offers Email/X/Text/Save-Image from there.
  const handleShareReportCard = () => {
    const lines = [];
    if (weekRankedTally.total > 0) {
      lines.push(`Ranked: ${weekRankedTally.correct}-${weekRankedTally.incorrect} (${Math.round((weekRankedTally.correct / weekRankedTally.total) * 100)}%)`);
    }
    if (weekUnrankedTally.total > 0) {
      lines.push(`Unranked: ${weekUnrankedTally.correct}-${weekUnrankedTally.incorrect}`);
    }
    lines.push(weekPlacement ? `Finished #${weekPlacement.rank} of ${weekPlacement.outOf} this week 🔥` : "Ranked placement pending.");
    setShareModal({
      icon: "🏆", heading: "My We-Pick Report Card", weekLabel: selectedWeek, lines,
      filename: `WePick_${selectedWeek.replace(/\s+/g, "")}_ReportCard`,
    });
  };

  // Same shape as handleShareReportCard above, but for bragging rights
  // *before* kickoff — the actual Ranked 6 predictions, not results.
  const handleSharePicks = () => {
    const lines = rankedGames.map((g) => {
      const p = myPicksById[g.id];
      if (p?.awayScore != null && p?.homeScore != null) {
        return `${g.Away} ${p.awayScore} – ${g.Home} ${p.homeScore}`;
      }
      const side = pickedSideOf(p);
      return `${side === "away" ? g.Away : side === "home" ? g.Home : "?"} to win`;
    });
    setShareModal({
      icon: "🔮", heading: "My Ranked 6", weekLabel: selectedWeek, lines,
      filename: `WePick_${selectedWeek.replace(/\s+/g, "")}_Picks`,
    });
  };
  // Has the current Ranked 6 already been locked in exactly as-is? Two
  // things have to match the last submission, not just one: which games
  // are ranked (by set, not order — swapping in a different game while
  // still qualified correctly flips this back to false), AND each of
  // those games' actual score prediction (via submission.predictions,
  // snapshotted at submit time — see handleSubmitForRanking) — editing a
  // score on a game that was already ranked doesn't change which games
  // are ranked at all, so the gameIds check alone would miss it and leave
  // the button stuck saying "✓ Submitted" for a stale prediction.
  const rankedGameIds = rankedGames.map((g) => g.id).sort();
  const submittedGameIds = (submission?.gameIds || []).slice().sort();
  const predictionsUnchanged = rankedGameIds.every((id) => {
    const current = myPicksById[id];
    const submitted = submission?.predictions?.[id];
    return !!submitted && current?.awayScore === submitted.awayScore && current?.homeScore === submitted.homeScore;
  });
  const alreadySubmitted = status.isQualified
    && rankedGameIds.length === submittedGameIds.length
    && rankedGameIds.every((id, i) => id === submittedGameIds[i])
    && predictionsUnchanged;

  const completed = myPicks
    .map((p) => ({ pick: p, game: gamesById[p.id] }))
    .filter((row) => row.game && isGameFinal(row.game))
    .sort((a, b) => toMs(b.game.Date) - toMs(a.game.Date));
  const graded = completed.filter((row) => pickedSideOf(row.pick));
  const correctCount = graded.filter((row) => {
    const g = row.game;
    const actualWinner = g.AwayScore > g.HomeScore ? "away" : g.HomeScore > g.AwayScore ? "home" : null;
    return actualWinner && pickedSideOf(row.pick) === actualWinner;
  }).length;

  return (
    <>
      {/* No-spinner score boxes and a couple of small utility classes used
          by GameRow below. */}
      <style>{`
        .wd-wepick-no-spinner::-webkit-inner-spin-button, .wd-wepick-no-spinner::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .wd-wepick-no-spinner { -moz-appearance: textfield; }
      `}</style>

      {weekOptions.length > 0 && (
        <div style={{ marginBottom: "18px" }}>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(e.target.value)}
            style={{ border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "10px 14px", fontWeight: 900, fontSize: "14px", color: "#fff", outline: "none", background: "rgba(0,0,0,0.3)" }}
          >
            {weekOptions.map((w) => <option key={w} value={w} style={{ color: "#000" }}>{w}</option>)}
          </select>
        </div>
      )}

      {weekIsPast ? (
        /* Report Card — every game's Final, so the pickable/composition/
           Submit UI (below) no longer applies. Doubles as something meant
           to be posted publicly (see handleShareReportCard), so — unlike
           the "Sample Data" tags used elsewhere in this file — placement
           is never faked here: weekPlacement stays null and shows
           "pending" until a real STANDINGS_COLLECTION doc exists for this
           week, since sharing a made-up rank would actively mislead
           whoever it's shared with. */
        <div style={{ marginBottom: "24px", border: `2px solid ${GOLD}`, borderRadius: "12px", overflow: "hidden", background: "linear-gradient(160deg, rgba(246,162,29,0.12), rgba(0,0,0,0.25))" }}>
          <div style={{ background: GOLD, padding: "10px 16px" }}>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              🏆 We-Pick Report Card — {selectedWeek}
            </div>
          </div>
          <div style={{ padding: "16px" }}>
            {weekRankedTally.total === 0 && weekUnrankedTally.total === 0 ? (
              <div style={{ fontSize: "14px", fontWeight: 800, color: "rgba(255,255,255,0.75)" }}>
                No picks on record for {selectedWeek}.
              </div>
            ) : (
              <>
                <div style={{ fontSize: "15px", fontWeight: 900, color: "#fff", marginBottom: "12px" }}>
                  {profile?.username?.trim() || "Anonymous Fan"}
                </div>
                <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "14px" }}>
                  {weekRankedTally.total > 0 && (
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 900, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.04em" }}>🏆 Ranked</div>
                      <div style={{ fontSize: "20px", fontWeight: 900, color: "#fff" }}>
                        {weekRankedTally.correct}-{weekRankedTally.incorrect}
                        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", marginLeft: "6px" }}>
                          ({Math.round((weekRankedTally.correct / weekRankedTally.total) * 100)}%)
                        </span>
                      </div>
                    </div>
                  )}
                  {weekUnrankedTally.total > 0 && (
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 900, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Unranked</div>
                      <div style={{ fontSize: "20px", fontWeight: 900, color: "#fff" }}>
                        {weekUnrankedTally.correct}-{weekUnrankedTally.incorrect}
                        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", marginLeft: "6px" }}>
                          ({Math.round((weekUnrankedTally.correct / weekUnrankedTally.total) * 100)}%)
                        </span>
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 900, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Placement</div>
                    <div style={{ fontSize: "20px", fontWeight: 900, color: weekPlacement ? GOLD : "rgba(255,255,255,0.5)" }}>
                      {weekPlacement ? `#${weekPlacement.rank} of ${weekPlacement.outOf}` : "Pending"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: "12px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 800, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    We-Draft.com
                  </div>
                  <button
                    onClick={handleShareReportCard}
                    style={{ background: GOLD, color: "#fff", border: "none", borderRadius: "8px", padding: "9px 18px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer" }}
                  >
                    🔗 Share
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Ranked status — stars still save instantly with no batch step, but
           counting toward the leaderboard now needs an explicit Submit once
           qualified (see handleSubmitForRanking); a "not open yet" message
           covers a future week instead. */
        <div style={{ marginBottom: "24px", border: `2px solid ${GOLD}`, borderRadius: "12px", overflow: "hidden" }}>
          <div style={{ background: GOLD, padding: "10px 16px" }}>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              🏆 Ranked — {selectedWeek || "—"}
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "rgba(0,0,0,0.25)" }}>
            {!weekOpen ? (
              <div style={{ fontSize: "14px", fontWeight: 800, color: "#fff" }}>
                {selectedWeek} Ranked opens {formatOpensDate(weekMonday)}.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "10px" }}>
                  <CompositionChip label="Total" value={`${rankedGames.length}/6`} ok={rankedGames.length >= 6} />
                  {/* Week 0 has no Game of the Week/Featured requirement — any
                      6 ranked games qualify (see rankedStatus's own Week 0
                      branch), so these two chips would just be permanently
                      unmet noise on that week's board. */}
                  {selectedWeek !== "Week 0" && (
                    <>
                      <CompositionChip label="Game of the Week" value={`${rankedGames.filter((g) => g.GameOfWeek).length}/1`} ok={rankedGames.some((g) => g.GameOfWeek)} />
                      <CompositionChip label="Featured" value={`${rankedGames.filter((g) => g.Featured).length}/2`} ok={rankedGames.filter((g) => g.Featured).length >= 2} />
                    </>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: status.isQualified ? "#8ef0a5" : "rgba(255,255,255,0.85)" }}>
                    {/* Being qualified doesn't count toward the leaderboard
                        on its own — Submit for Ranking still has to happen
                        (or happen again, if a score changed since the last
                        submit — see alreadySubmitted). Say so right in the
                        qualified message instead of leaving that only to
                        the button's own label, which is easy to miss. */}
                    {status.isQualified && !alreadySubmitted
                      ? `${status.text} Submit your Ranked 6 below to lock it in.`
                      : status.text}
                  </div>
                  {status.isQualified && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {/* Bragging rights before kickoff — see
                          handleSharePicks. Shown as soon as the Ranked 6
                          qualifies, whether or not it's been submitted yet,
                          since "qualified" already means all 6 picks are
                          locked in on the player's own end. */}
                      <button
                        onClick={handleSharePicks}
                        style={{
                          flexShrink: 0, border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "9px 18px",
                          fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
                          background: "rgba(246,162,29,0.12)", color: GOLD, cursor: "pointer",
                        }}
                      >
                        🔗 Share Picks
                      </button>
                      <button
                        onClick={() => handleSubmitForRanking(rankedGameIds)}
                        disabled={submitting || alreadySubmitted}
                        style={{
                          flexShrink: 0, border: "none", borderRadius: "8px", padding: "9px 18px",
                          fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
                          background: alreadySubmitted ? "rgba(142,240,165,0.18)" : GOLD,
                          color: alreadySubmitted ? "#8ef0a5" : "#fff",
                          cursor: submitting || alreadySubmitted ? "default" : "pointer",
                        }}
                      >
                        {alreadySubmitted ? "✓ Submitted for Ranking" : submitting ? "Submitting…" : "Submit for Ranking"}
                      </button>
                    </div>
                  )}
                </div>
                {/* Hard-to-miss confirmation that the click actually went
                    through — fades away on its own; the button's own
                    "✓ Submitted for Ranking" state carries the ongoing
                    status after this clears. */}
                {submitFeedback !== "idle" && (
                  <div style={{
                    marginTop: "10px", fontSize: "13px", fontWeight: 800, padding: "9px 12px", borderRadius: "8px",
                    background: submitFeedback === "success" ? "rgba(142,240,165,0.15)" : "rgba(255,138,122,0.15)",
                    color: submitFeedback === "success" ? "#8ef0a5" : "#ff8a7a",
                  }}>
                    {submitFeedback === "success"
                      ? `✅ Locked in! Your Ranked 6 for ${selectedWeek} is submitted.`
                      : "⚠️ Something went wrong submitting — try again."}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {rankedGames.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <SectionHeader label={weekIsPast ? "🏆 Ranked — Results" : "🏆 Ranked"} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {rankedGames.map((g) => (
              <GameRow
                key={g.id}
                game={g}
                schoolsByName={schoolsByName}
                pick={myPicksById[g.id] || null}
                onSaveScore={handleSaveScore}
                onPickWinner={handlePickWinner}
                onRemove={() => handleRemove(g.id)}
                onToggleRanked={handleToggleRanked}
                saving={savingId === g.id}
                removing={removingId === g.id}
              />
            ))}
          </div>
        </div>
      )}

      {unrankedGames.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <SectionHeader label={weekIsPast ? "Unranked — Results" : "Unranked"} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {unrankedGames.map((g) => (
              <GameRow
                key={g.id}
                game={g}
                schoolsByName={schoolsByName}
                pick={myPicksById[g.id] || null}
                onSaveScore={handleSaveScore}
                onPickWinner={handlePickWinner}
                onRemove={() => handleRemove(g.id)}
                onToggleRanked={handleToggleRanked}
                saving={savingId === g.id}
                removing={removingId === g.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* No point offering "games you didn't pick" once the week's over —
          nothing's actionable there anymore, so it's dropped entirely
          rather than listing dead ends. */}
      {!weekIsPast && noPickGames.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <SectionHeader label="Games" />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {noPickGames.map((g) => (
              <GameRow
                key={g.id}
                game={g}
                schoolsByName={schoolsByName}
                pick={myPicksById[g.id] || null}
                onSaveScore={handleSaveScore}
                onPickWinner={handlePickWinner}
                onRemove={() => handleRemove(g.id)}
                onToggleRanked={handleToggleRanked}
                saving={savingId === g.id}
                removing={removingId === g.id}
              />
            ))}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <SectionHeader label="Pick History" />
            {graded.length > 0 && (
              <div style={{ fontSize: "13px", fontWeight: 800, color: "rgba(255,255,255,0.75)" }}>
                {correctCount}-{graded.length - correctCount} ({Math.round((correctCount / graded.length) * 100)}%)
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {completed.map(({ pick, game }) => (
              <GameRow
                key={game.id}
                game={game}
                schoolsByName={schoolsByName}
                pick={pick}
                onRemove={() => handleRemove(game.id)}
                removing={removingId === game.id}
              />
            ))}
          </div>
        </div>
      )}

      {gamesForWeek.length === 0 && (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.6)", fontStyle: "italic", fontSize: "13px", padding: "30px" }}>
          No games found for this week.
        </div>
      )}
      {myPicks.length === 0 && gamesForWeek.length > 0 && (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,0.6)", fontStyle: "italic", fontSize: "13px", padding: "10px 0" }}>
          No picks yet — enter a score above, or browse the{" "}
          <Link to="/cfb/schedule" style={{ color: GOLD, fontWeight: 800 }}>CFB Schedule</Link>.
        </div>
      )}

      {/* ===== Hidden Share Card ===== */}
      {/* Off-screen, only rendered while the share modal is open — the
          modal's own effect (above) captures this to a PNG the instant it
          paints with shareModal's content. Text-only (no logos) so
          html-to-image never trips over an externally-hosted image tainting
          the canvas, same reasoning as PlayerProfile.js's own export card. */}
      {shareModal && (
        <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
          <div ref={shareCardRef} style={{ width: "700px", backgroundColor: "#ffffff", border: `6px solid ${BLUE}`, fontFamily: "'Arial Black', Arial, sans-serif", overflow: "hidden" }}>
            <div style={{ backgroundColor: BLUE, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ color: GOLD, fontSize: "24px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>We-Draft.com · We-Pick</div>
            </div>
            <div style={{ height: "5px", backgroundColor: GOLD }} />
            <div style={{ padding: "30px 32px 18px", textAlign: "center" }}>
              <div style={{ fontSize: "40px", lineHeight: 1 }}>{shareModal.icon}</div>
              <div style={{ fontSize: "34px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.02em", marginTop: "8px" }}>{shareModal.heading}</div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: "4px" }}>{shareModal.weekLabel}</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#666", marginTop: "10px" }}>{profile?.username?.trim() || "Anonymous Fan"}</div>
            </div>
            <div style={{ height: "2px", backgroundColor: GOLD, margin: "0 32px" }} />
            <div style={{ padding: "16px 32px 24px" }}>
              {shareModal.lines.length === 0 ? (
                <div style={{ textAlign: "center", color: "#aaa", fontSize: "14px", fontStyle: "italic", padding: "10px 0" }}>No picks on record.</div>
              ) : (
                shareModal.lines.map((line, i) => (
                  <div key={i} style={{ fontSize: "18px", fontWeight: 800, color: "#222", padding: "11px 0", borderBottom: i < shareModal.lines.length - 1 ? "1px solid #eee" : "none", textAlign: "center" }}>
                    {line}
                  </div>
                ))
              )}
            </div>
            <div style={{ height: "5px", backgroundColor: GOLD }} />
            <div style={{ backgroundColor: BLUE, padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ color: GOLD, fontSize: "15px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>we-draft.com/we-pick</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Share Modal ===== */}
      {shareModal && (
        <div
          onClick={() => setShareModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#151a22", border: `2px solid ${GOLD}`, borderRadius: "14px", maxWidth: "420px", width: "100%", maxHeight: "90vh", overflowY: "auto", padding: "20px", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Share</div>
              <button
                onClick={() => setShareModal(null)}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "22px", cursor: "pointer", lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)", marginBottom: "16px", background: "#fff", minHeight: "160px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {shareImageUrl ? (
                <img src={shareImageUrl} alt="Share preview" style={{ width: "100%", display: "block" }} />
              ) : (
                <div style={{ padding: "50px 0", color: "#999", fontSize: "13px", fontWeight: 700 }}>Building image…</div>
              )}
            </div>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
              Share to
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <a
                href={`mailto:?subject=${encodeURIComponent(`${shareModal.icon} ${shareModal.heading} — ${shareModal.weekLabel}`)}&body=${encodeURIComponent(shareText)}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "rgba(255,255,255,0.08)", border: "2px solid rgba(255,255,255,0.25)", borderRadius: "8px", padding: "10px", color: "#fff", fontWeight: 800, fontSize: "13px", textDecoration: "none" }}
              >
                📧 Email
              </a>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "rgba(255,255,255,0.08)", border: "2px solid rgba(255,255,255,0.25)", borderRadius: "8px", padding: "10px", color: "#fff", fontWeight: 800, fontSize: "13px", textDecoration: "none" }}
              >
                𝕏 X
              </a>
              <a
                href={`sms:?&body=${encodeURIComponent(shareText)}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "rgba(255,255,255,0.08)", border: "2px solid rgba(255,255,255,0.25)", borderRadius: "8px", padding: "10px", color: "#fff", fontWeight: 800, fontSize: "13px", textDecoration: "none" }}
              >
                💬 Text
              </a>
              <button
                onClick={handleSaveShareImage}
                disabled={!shareImageUrl}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: GOLD, border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "10px", color: "#fff", fontWeight: 800, fontSize: "13px", cursor: shareImageUrl ? "pointer" : "default", opacity: shareImageUrl ? 1 : 0.6 }}
              >
                💾 Save Image
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Community rankings — a 2026 season-long board plus a per-week board,
// each backed by one doc in STANDINGS_COLLECTION (see its own comment for
// the doc-id/shape convention). This is foundation only: nothing computes
// or writes those docs yet (the scoring formula is still TBD), so every
// view here renders straight into the "nobody's been ranked yet" empty
// state until that lands — the fetch, routing, and table are all real,
// just waiting on data. Unlike My Picks, this works for signed-out
// visitors too (it's a public leaderboard, not a personal list), so it
// does its own schedule26 fetch rather than relying on MyPicksSection's.
function StandingsSection() {
  const { user } = useAuth();
  const { week: weekParam } = useParams();
  const navigate = useNavigate();
  // Defaults to "week" regardless of whether a :week param is on the URL —
  // the by-week board is the one most people land on this tab wanting to
  // see (this week's standings), season is one click away via its own tab.
  const [view, setView] = useState("week"); // "season" | "week"
  const [weekOptions, setWeekOptions] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(weekParam || "");
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  // Top 10 by default; expands to each view's own ceiling (see
  // STANDINGS_LIMITS) so a season board doesn't dump 100 rows on load.
  const [expanded, setExpanded] = useState(false);
  const limits = STANDINGS_LIMITS[view];

  // Week list comes from the schedule, same as My Picks' own dropdown —
  // fetched once, independent of which board is currently showing.
  useEffect(() => {
    const loadWeeks = async () => {
      try {
        const snap = await getDocs(collection(db, "schedule26"));
        const weeks = Array.from(new Set(snap.docs.map((d) => d.data().Week).filter(Boolean)))
          .sort((a, b) => weekNumber(a) - weekNumber(b));
        setWeekOptions(weeks);
        setSelectedWeek((prev) => prev || weeks[0] || "");
      } catch (e) {
        console.error("We-Pick standings week-list error:", e);
      }
    };
    loadWeeks();
  }, []);

  // A week param arriving/changing (e.g. via browser back/forward, or a
  // shared link) always wins over whatever the tab toggle last set.
  useEffect(() => {
    if (weekParam) { setView("week"); setSelectedWeek(weekParam); }
  }, [weekParam]);

  useEffect(() => {
    const docId = view === "season" ? "season" : selectedWeek;
    setExpanded(false); // switching boards always starts back at Top 10
    if (!docId) { setEntries([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getDoc(doc(db, STANDINGS_COLLECTION, docId))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : null;
        setEntries(Array.isArray(data?.entries) ? data.entries : []);
      })
      .catch((e) => {
        console.error("We-Pick standings fetch error:", e);
        if (!cancelled) setEntries([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, selectedWeek]);

  const sortedEntries = useMemo(
    () => [...entries].sort(compareStandingsEntries),
    [entries]
  );

  const visibleCount = expanded ? limits.max : limits.default;
  const visibleEntries = sortedEntries.slice(0, visibleCount);

  // Signed-in user's own spot on this board, if any — used to highlight
  // their row (RankedRow's isMe prop), and to pin it below the visible cut
  // if they're ranked outside it, so being on the board is never invisible
  // just because it's below the fold.
  const myIndex = user ? sortedEntries.findIndex((e) => e.uid === user.uid) : -1;
  const myEntry = myIndex >= 0 ? sortedEntries[myIndex] : null;
  const myRowVisible = myIndex >= 0 && myIndex < visibleCount;

  const goSeason = () => { setView("season"); navigate("/we-pick/standings"); };
  const goWeek = (w) => { setView("week"); setSelectedWeek(w); navigate(w ? `/we-pick/standings/${w}` : "/we-pick/standings"); };

  return (
    <>
      {/* Explains the mechanics up front since the board itself is empty
          until real scoring exists — so landing here still answers "how
          does this work" instead of just showing a bare empty state.
          Bullets + imperative verbs (Star/Call/Nail/Submit) so it reads as
          a checklist of what to go do, not a wall of rules text. */}
      <div style={{ border: "2px dashed rgba(246,162,29,0.5)", borderRadius: "12px", padding: "14px 16px", marginBottom: "18px", background: "rgba(246,162,29,0.08)" }}>
        <div style={{ fontSize: "12px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
          🏆 How Ranked Works
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "7px" }}>
          {[
            ["⭐", "Star 6 picks", " each week to build your Ranked 6 — the Game of the Week plus at least 2 Featured games (Week 0: any 6, no restrictions)."],
            ["🎯", "Call the winner", " — bank 100 points for the right team, 0 for the wrong one, no matter how close the final score was."],
            ["🔟", "Nail the score", " — once you've got the winner, earn up to 100 more points per side, losing 10 for every point you're off."],
            ["🔒", "Submit before kickoff", " to lock in your Ranked 6 — your season score is the sum of every week you qualify."],
          ].map(([icon, lead, rest], i) => (
            <li key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>
              <span style={{ flexShrink: 0 }}>{icon}</span>
              <span><span style={{ color: "#fff", fontWeight: 900 }}>{lead}</span>{rest}</span>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "18px", flexWrap: "wrap" }}>
        <StandingsSubTab active={view === "season"} label="2026 Season" onClick={goSeason} />
        <StandingsSubTab active={view === "week"} label="By Week" onClick={() => goWeek(selectedWeek)} />
        {view === "week" && weekOptions.length > 0 && (
          <select
            value={selectedWeek}
            onChange={(e) => goWeek(e.target.value)}
            style={{ border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "8px 12px", fontWeight: 900, fontSize: "13px", color: "#fff", outline: "none", background: "rgba(0,0,0,0.3)" }}
          >
            {weekOptions.map((w) => <option key={w} value={w} style={{ color: "#000" }}>{w}</option>)}
          </select>
        )}
      </div>

      <div style={{ border: `2px solid ${GOLD}`, borderRadius: "12px", overflow: "hidden" }}>
        <div style={{ background: GOLD, padding: "10px 16px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            🏆 {view === "season" ? "2026 Season Standings" : `${selectedWeek || "Weekly"} Standings`}
          </div>
        </div>
        <div style={{ background: "rgba(0,0,0,0.25)" }}>
          {loading ? (
            <LoadingSpinner label="Loading" size={36} minHeight="160px" />
          ) : sortedEntries.length === 0 ? (
            <div style={{ padding: "36px 20px", textAlign: "center" }}>
              <div style={{ fontSize: "26px", marginBottom: "8px" }}>🏈</div>
              <div style={{ fontSize: "14px", fontWeight: 800, color: "rgba(255,255,255,0.85)" }}>
                {view === "season"
                  ? "Season standings haven't started yet."
                  : selectedWeek ? `No standings yet for ${selectedWeek}.` : "No weeks on the schedule yet."}
              </div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.55)", marginTop: "6px" }}>
                Rankings will fill in from everyone's Ranked 6 picks once games are graded — check back soon.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={standingsThStyle}>Rank</th>
                    <th style={{ ...standingsThStyle, textAlign: "left" }}>Player</th>
                    <th style={standingsThStyle}>Record</th>
                    <th style={standingsThStyle}>Points</th>
                    {/* Informational only — nothing is ranked by this, it's
                        just points-per-qualified-week context that a bare
                        season total (which rewards playing more weeks)
                        doesn't show on its own. Only meaningful season-side;
                        a single week's board already *is* one week. */}
                    {view === "season" && <th style={standingsThStyle}>Avg/Wk</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((e, i) => (
                    <StandingsRow key={e.uid || i} entry={e} rank={i + 1} isMe={!!user && e.uid === user.uid} showAvg={view === "season"} />
                  ))}
                  {/* Pinned own row — shown only when signed in, on the
                      board, and ranked below the current cutoff, so being
                      ranked never just silently disappears off the bottom. */}
                  {myEntry && !myRowVisible && (
                    <>
                      <tr>
                        <td colSpan={view === "season" ? 5 : 4} style={{ padding: "4px 14px", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: "12px", fontWeight: 900 }}>⋯</td>
                      </tr>
                      <StandingsRow entry={myEntry} rank={myIndex + 1} isMe showAvg={view === "season"} />
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {!loading && sortedEntries.length > limits.default && (
          <div style={{ background: "rgba(0,0,0,0.25)", borderTop: "1px solid rgba(255,255,255,0.1)", padding: "10px 16px", textAlign: "center" }}>
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{ background: "none", border: `2px solid ${GOLD}`, borderRadius: "8px", color: GOLD, fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", padding: "6px 16px", cursor: "pointer" }}
            >
              {expanded ? "Show Top 10" : `Show Top ${Math.min(limits.max, sortedEntries.length)}`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// One standings row — highlighted (gold left border + tinted background)
// when it belongs to the signed-in viewer, so finding yourself on a
// hundred-row season board doesn't mean scanning every name.
function StandingsRow({ entry, rank, isMe, showAvg }) {
  const avg = entry.weeksPlayed ? (entry.points ?? 0) / entry.weeksPlayed : null;
  return (
    <tr style={{ borderTop: "1px solid rgba(255,255,255,0.1)", background: isMe ? "rgba(246,162,29,0.18)" : "transparent", boxShadow: isMe ? `inset 3px 0 0 ${GOLD}` : "none" }}>
      <td style={standingsTdStyle}>{rank}</td>
      <td style={{ ...standingsTdStyle, textAlign: "left" }}>
        {entry.displayName || "Anonymous Fan"}
        {isMe && <span style={{ marginLeft: "6px", color: GOLD, fontSize: "11px", fontWeight: 900 }}>(You)</span>}
      </td>
      <td style={standingsTdStyle}>{entry.correct ?? 0}-{(entry.total ?? 0) - (entry.correct ?? 0)}</td>
      <td style={standingsTdStyle}>{entry.points ?? 0}</td>
      {showAvg && <td style={{ ...standingsTdStyle, color: "rgba(255,255,255,0.65)" }}>{avg != null ? avg.toFixed(1) : "—"}</td>}
    </tr>
  );
}

const standingsThStyle = {
  padding: "10px 14px", textAlign: "center", fontSize: "11px", fontWeight: 900,
  color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.05em",
};
const standingsTdStyle = {
  padding: "10px 14px", textAlign: "center", fontSize: "13px", fontWeight: 800, color: "#fff",
};

function StandingsSubTab({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "8px 16px",
        fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em",
        background: active ? GOLD : "transparent", color: "#fff", cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

// My Stats — personal performance tracking. Requires sign-in (same wall as
// My Picks) since there's nothing to show a signed-out visitor. Does its
// own schedule26 + own-picks fetch (same shape as My Picks' own fetch)
// rather than reaching into MyPicksSection's state, since only one of these
// tab sections is ever mounted at a time.
function MyStatsSection() {
  const { user, profile, login } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allGames, setAllGames] = useState([]);
  const [myPicks, setMyPicks] = useState([]);
  const [personalDoc, setPersonalDoc] = useState(null);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [gamesSnap, picksSnap, statsSnap] = await Promise.all([
          getDocs(collection(db, "schedule26")),
          getDocs(collection(db, "users", user.uid, "picks")),
          getDoc(doc(db, "users", user.uid, MYSTATS_COLLECTION, MYSTATS_SEASON_DOC)),
        ]);
        if (cancelled) return;
        setAllGames(gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setMyPicks(picksSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPersonalDoc(statsSnap.exists() ? statsSnap.data() : null);
      } catch (e) {
        console.error("My Stats fetch error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAll();
    return () => { cancelled = true; };
  }, [user]);

  const gamesById = useMemo(() => {
    const map = {};
    allGames.forEach((g) => { map[g.id] = g; });
    return map;
  }, [allGames]);

  // Every one of this user's own picks whose game has actually gone Final —
  // the raw material both accuracy tallies and Best Ranked Score are built
  // from. Split into ranked vs. unranked with the same "hasScorePick +
  // ranked flag" test MyPicksSection's own rankedGames/unrankedGames use.
  const gradedRows = useMemo(
    () => myPicks.map((p) => ({ pick: p, game: gamesById[p.id] })).filter((r) => r.game && isGameFinal(r.game)),
    [myPicks, gamesById]
  );
  const rankedRows = useMemo(() => gradedRows.filter((r) => hasScorePick(r.pick) && r.pick.ranked === true), [gradedRows]);
  const unrankedRows = useMemo(() => gradedRows.filter((r) => !(hasScorePick(r.pick) && r.pick.ranked === true)), [gradedRows]);

  const realRankedAccuracy = useMemo(() => tallyAccuracy(rankedRows), [rankedRows]);
  const realUnrankedAccuracy = useMemo(() => tallyAccuracy(unrankedRows), [unrankedRows]);

  // Best Ranked Score — this user's own Ranked 6 total (scoreGamePick,
  // summed) for each week that actually met the Ranked composition
  // requirement (rankedStatus), maxed across weeks. An unqualified week
  // doesn't count here either — same rule the real Standings would apply.
  const realBestRankedScore = useMemo(() => {
    const byWeek = {};
    rankedRows.forEach(({ pick, game }) => {
      if (!game.Week) return;
      (byWeek[game.Week] ||= []).push({ pick, game });
    });
    let best = null;
    Object.entries(byWeek).forEach(([week, rows]) => {
      if (!rankedStatus(rows.map((r) => r.game), week).isQualified) return;
      const points = rows.reduce((sum, r) => sum + scoreGamePick(r.pick, r.game), 0);
      if (!best || points > best.points) best = { points, week };
    });
    return best;
  }, [rankedRows]);

  // Highest Leaderboard Rank can't be computed client-side at all — it needs
  // everyone else's results, which nothing aggregates yet (see
  // MYSTATS_COLLECTION's own comment) — so it's null until a real
  // admin-written value exists, same as bestRankedScore before any
  // qualified week has been graded.
  const highestRank = personalDoc?.highestRank || null;

  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", border: `2px solid ${CARD_BORDER}`, borderRadius: "12px", background: CARD_BG }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "rgba(255,255,255,0.8)", marginBottom: "16px" }}>
          Sign in to track your We-Pick performance.
        </div>
        <button
          onClick={login}
          style={{ background: GOLD, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "11px 28px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer" }}
        >
          Sign In
        </button>
      </div>
    );
  }

  if (loading) return <LoadingSpinner label="Loading" size={48} minHeight="40vh" />;

  return (
    <>
      <div style={{ marginBottom: "20px" }}>
        <span style={{ display: "inline-block", background: "rgba(255,255,255,0.08)", border: `1px solid ${CARD_BORDER}`, borderRadius: "999px", padding: "5px 14px", fontSize: "12px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {profile?.username?.trim() || "Anonymous Fan"} — 2026 Season
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "28px", justifyContent: "center", marginBottom: "26px" }}>
        <AccuracyDonut label="Ranked Accuracy" correct={realRankedAccuracy.correct} incorrect={realRankedAccuracy.incorrect} />
        <AccuracyDonut label="Unranked Accuracy" correct={realUnrankedAccuracy.correct} incorrect={realUnrankedAccuracy.incorrect} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px" }}>
        <StatTile icon="🏆" label="Best Ranked Score" value={realBestRankedScore?.points} sub={realBestRankedScore ? realBestRankedScore.week : "No qualified week graded yet"} />
        <StatTile icon="📈" label="Highest Leaderboard Rank" value={highestRank ? `#${highestRank.rank}` : undefined} sub={highestRank ? highestRank.label : "Not tracked yet"} />
      </div>
    </>
  );
}

// Status colors reserved for Correct/Incorrect (same semantics as GameRow's
// own "✓ Correct"/"✗ Missed" resultBadge, kept as raw hex here since the
// donut needs them as SVG stroke colors, not CSS background/color strings).
// Deliberately brighter than the solid badge's own fill (#1a7f37/#c0392b) —
// a thin ring needs more contrast against this page's dark surface than a
// padded solid badge does; checked against the dataviz skill's validator
// for contrast and normal-vision separation. A straight red/green pair
// always fails hue-only CVD separation, which is exactly why every use
// below pairs the color with an icon and a text label rather than leaning
// on the ring's hue alone.
const STAT_GOOD = "#2fae60";
const STAT_BAD = "#e35b4b";

// A two-segment donut — correct vs. incorrect, drawn as two SVG arcs via
// stroke-dasharray/-dashoffset rather than a wedge path (rounds cleanly,
// no trig needed). The accuracy percentage sits in the hole as the actual
// headline figure; the legend row underneath carries the exact counts so
// nothing depends on reading arc length by eye, and a native <title> gives
// each arc a hover tooltip.
function AccuracyDonut({ label, correct, incorrect }) {
  const total = correct + incorrect;
  const pct = total > 0 ? Math.round((correct / total) * 100) : null;
  const size = 132;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = total > 0 ? Math.min(6, circumference * 0.015) : 0;
  const correctLen = total > 0 ? (correct / total) * circumference - gap : 0;
  const incorrectLen = total > 0 ? circumference - correctLen - gap : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
      <div style={{ fontSize: "12px", fontWeight: 900, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
          {total > 0 && (
            <>
              <circle
                cx={size / 2} cy={size / 2} r={r} fill="none" stroke={STAT_GOOD} strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={`${correctLen} ${circumference - correctLen}`}
              >
                <title>{`Correct: ${correct} (${Math.round((correct / total) * 100)}%)`}</title>
              </circle>
              <circle
                cx={size / 2} cy={size / 2} r={r} fill="none" stroke={STAT_BAD} strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={`${incorrectLen} ${circumference - incorrectLen}`}
                strokeDashoffset={-(correctLen + gap)}
              >
                <title>{`Incorrect: ${incorrect} (${Math.round((incorrect / total) * 100)}%)`}</title>
              </circle>
            </>
          )}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: "26px", fontWeight: 900, color: "#fff" }}>{pct != null ? `${pct}%` : "—"}</div>
          <div style={{ fontSize: "10px", fontWeight: 800, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>accuracy</div>
        </div>
      </div>
      {total === 0 ? (
        <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>
          No graded picks yet
        </div>
      ) : (
        /* Legend — always present for 2 series, the dependable identity
            channel so nothing here relies on color-matching alone. */
        <div style={{ display: "flex", gap: "14px" }}>
          <LegendDot color={STAT_GOOD} label={`✓ Correct (${correct})`} />
          <LegendDot color={STAT_BAD} label={`✗ Incorrect (${incorrect})`} />
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 800, color: "rgba(255,255,255,0.75)" }}>
      <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: color, flexShrink: 0 }} />
      {label}
    </div>
  );
}

function StatTile({ icon, label, value, sub }) {
  return (
    <div style={{ flex: "1 1 220px", border: `2px solid ${GOLD}`, borderRadius: "12px", padding: "16px 18px", background: "rgba(0,0,0,0.25)" }}>
      <div style={{ fontSize: "11px", fontWeight: 900, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: "30px", fontWeight: 900, color: value != null ? "#fff" : "rgba(255,255,255,0.35)", lineHeight: 1 }}>
        {value != null ? value : "—"}
      </div>
      {sub && <div style={{ fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.55)", marginTop: "4px" }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ fontSize: "16px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "5px" }}>
        {label}
      </div>
      <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
    </div>
  );
}

function CompositionChip({ label, value, ok }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "80px" }}>
      <div style={{ fontSize: "18px", fontWeight: 900, color: ok ? "#8ef0a5" : "#ffb3a7" }}>{value}</div>
      <div style={{ fontSize: "10px", fontWeight: 800, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.03em", textAlign: "center" }}>{label}</div>
    </div>
  );
}

// One game — stacked away-over-home, each row laid out box-logo-name (the
// score box sits to the left of that team, not trailing after the name).
// A/H badges and logo/team rows all live in a single 2-column CSS grid
// (badge column, content column) so each badge lines up with its own
// row's actual vertical center automatically — flexbox's "space-between"
// was pushing A/H to the container's top/bottom edges instead of each
// row's own center, which is what made them look misaligned. On a
// neutral-site game the badge column shows one "N" spanning both grid
// rows (`gridRow: "1 / 3"`, centered) instead of per-row letters — same
// column A/H would occupy, just centered across the two-row span rather
// than floating in an unrelated gap. The whole card is a click-through to
// the game's own page (a "stretched link" behind the content, with the
// inputs/buttons individually kept interactive) — no separate "view game"
// link needed. A final game renders read-only with the real score and a
// correct/incorrect badge; a not-yet-open game just shows no score slot at
// all (the week-level status card above already says when picks open).
// The star toggles whether an existing score pick counts toward the
// week's Ranked 6 — shown on any pick (never for a disqualified game), but
// only actually clickable once there's a score behind it; tapping it on a
// scoreless (winner-only) pick just explains why via an alert instead of
// silently doing nothing. Ties are blocked — Save stays disabled while
// both boxes hold the same number, since every game has a winner.
// The visibility/Save/Remove controls sit inline at the end of the Home
// row (not their own row below the grid) so adding them doesn't grow the
// card's height — see the `trailing` slot teamRow renders after the name.
// A team's name is also a quick winner-only pick: click it (onPickWinner)
// to call that team without bothering with a score at all — it can never
// count toward Ranked on its own (see handlePickWinner's own comment), it
// just parks the game in Unranked until a real score gets added. Only
// clickable while there's no score behind the pick yet (see canPickWinner
// below) — once a score's saved, the name is just text again, so the
// card's normal click-through-to-navigate takes over there instead of
// risking an accidental click quietly wiping a scored/ranked pick's score.
// The name doubles as live feedback for whichever side is currently
// implied to win — gold + a check, computed from the (possibly
// still-unsaved) score boxes if both are filled, else from a saved
// winner-only pick's side.
function GameRow({ game, schoolsByName, pick, onSaveScore, onPickWinner, onRemove, onToggleRanked, saving, removing }) {
  const [awayVal, setAwayVal] = useState(pick?.awayScore != null ? String(pick.awayScore) : "");
  const [homeVal, setHomeVal] = useState(pick?.homeScore != null ? String(pick.homeScore) : "");
  const [visibility, setVisibility] = useState(pick?.visibility || "public");
  const [noteVal, setNoteVal] = useState(pick?.prediction || "");
  // Collapsed by default (the + button below opens it) — starts open only
  // if there's already a note on file, so an existing one isn't hidden
  // behind an extra click every time this row mounts/re-renders.
  const [notesOpen, setNotesOpen] = useState(!!pick?.prediction);

  useEffect(() => {
    setAwayVal(pick?.awayScore != null ? String(pick.awayScore) : "");
    setHomeVal(pick?.homeScore != null ? String(pick.homeScore) : "");
    setVisibility(pick?.visibility || "public");
    setNoteVal(pick?.prediction || "");
  }, [pick?.awayScore, pick?.homeScore, pick?.visibility, pick?.prediction, game.id]);

  const awaySchool = schoolsByName?.[game.Away];
  const homeSchool = schoolsByName?.[game.Home];

  const final = isGameFinal(game);
  const locked = !final && !isPickable(game);
  const showInputs = !final && !locked;
  const side = pick ? pickedSideOf(pick) : null;
  // Shown for any pick, scored or not — a scoreless (winner-only) pick
  // still gets the star, it just can't be toggled on yet (see the click
  // handler below); a disqualified game never shows it at all, since no
  // pick there could ever count regardless of score.
  const showStar = typeof onToggleRanked === "function" && !!pick && !game.RankedDisqualified;
  const canToggleRanked = hasScorePick(pick);

  const savedAway = pick?.awayScore != null ? String(pick.awayScore) : "";
  const savedHome = pick?.homeScore != null ? String(pick.homeScore) : "";
  const dirty = awayVal !== savedAway || homeVal !== savedHome || visibility !== (pick?.visibility || "public") || noteVal !== (pick?.prediction || "");
  const isTie = awayVal.trim() !== "" && homeVal.trim() !== "" && Number(awayVal) === Number(homeVal);
  const canSave = showInputs && awayVal.trim() !== "" && homeVal.trim() !== "" && dirty && !isTie;

  // Whichever side is currently implied to win — the boxes' own (possibly
  // unsaved) values take priority over a saved pick, so typing over a
  // winner-only pick's scoreless state updates the highlight live instead
  // of sticking to the old pick until Save is clicked.
  const typedAway = awayVal.trim() !== "" ? Number(awayVal) : null;
  const typedHome = homeVal.trim() !== "" ? Number(homeVal) : null;
  const typedWinner = typedAway != null && typedHome != null && typedAway !== typedHome
    ? (typedAway > typedHome ? "away" : "home")
    : null;
  const savedWinnerOnlySide = pick && !hasScorePick(pick) ? pickedSideOf(pick) : null;
  const impliedWinner = !final ? (typedWinner || savedWinnerOnlySide) : null;

  const clampScore = (raw) => raw.replace(/[^0-9]/g, "").slice(0, 2);

  let resultBadge = null;
  if (final && pick) {
    const actualWinner = game.AwayScore > game.HomeScore ? "away" : game.HomeScore > game.AwayScore ? "home" : null;
    const correct = actualWinner && side === actualWinner;
    resultBadge = (
      <span style={{
        flexShrink: 0, fontWeight: 900, fontSize: "10px", padding: "2px 8px", borderRadius: "6px",
        background: correct ? "#1a7f37" : "#c0392b", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em",
      }}>
        {correct ? "✓ Correct" : "✗ Missed"}
      </span>
    );
  }

  const badge = (label) => (
    <span style={{
      flexShrink: 0, width: "18px", height: "18px", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", fontSize: "9px", fontWeight: 900,
    }}>
      {label}
    </span>
  );

  // flexWrap + the name's small (not 0) minWidth below are what make this
  // safe on narrow phones: the Home row packs score/logo/name AND the
  // trailing visibility/Save/Remove buttons onto one line (see GameRow's
  // own comment on why), and on a wide-enough screen flexbox happily
  // shrinks the name down toward that floor to fit everything. Once even
  // that isn't enough room, wrapping drops the trailing group to its own
  // line instead of the alternative — squeezing the name past legibility
  // or clipping the buttons outright.
  const teamRow = (name, schoolData, actualScore, scoreVal, setScoreVal, won, { picked, onPick, trailing } = {}) => (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", rowGap: "6px" }}>
      {final ? (
        <span style={{
          flexShrink: 0, width: "42px", textAlign: "center", fontFamily: "'Courier New', monospace", fontWeight: 900,
          fontSize: "18px", color: won ? "#fff" : "rgba(255,255,255,0.45)",
        }}>
          {actualScore}
        </span>
      ) : showInputs ? (
        <input
          type="number" min="0" max="99" inputMode="numeric" value={scoreVal}
          onChange={(e) => setScoreVal(clampScore(e.target.value))}
          className="wd-wepick-no-spinner"
          style={{
            flexShrink: 0, width: "42px", textAlign: "center", fontSize: "16px", fontWeight: 900,
            border: `2px solid ${BLUE}`, borderRadius: "6px", padding: "4px", color: BLUE, outline: "none",
            background: "#fff", pointerEvents: "auto",
          }}
        />
      ) : null}
      {(schoolData?.LogoBlack || schoolData?.LogoDark || schoolData?.Logo1) && (
        <img
          src={sanitizeUrl(schoolData.LogoBlack || schoolData.LogoDark || schoolData.Logo1)} alt=""
          style={{ width: "44px", height: "44px", objectFit: "contain", flexShrink: 0 }}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      )}
      <span
        onClick={onPick}
        title={onPick ? "Click to pick this team to win" : undefined}
        style={{
          flex: "1 1 70px", minWidth: "70px", fontWeight: 900, fontSize: "16px",
          color: final && won === false ? "rgba(255,255,255,0.5)" : picked ? GOLD : "#fff",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          cursor: onPick ? "pointer" : "default", pointerEvents: onPick ? "auto" : "inherit",
        }}
      >
        {name}
        {picked && <span style={{ marginLeft: "4px", fontSize: "11px" }}>✓</span>}
      </span>
      {trailing}
    </div>
  );

  const hasTags = game.GameOfWeek || game.Featured || game.RankedDisqualified;

  // Rendered as the Home row's trailing slot (see teamRow) instead of its
  // own row below the grid, so these controls don't add height to the card.
  const actionButtons = showInputs ? (
    <div style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0, pointerEvents: "auto" }}>
      {/* Opens the notes textarea below (see the grid's own trailing
          content) — gold once a note actually exists so there's a hint
          it's there even while collapsed, not just a bare "+". */}
      <button
        onClick={() => setNotesOpen((v) => !v)}
        title={notesOpen ? "Hide note" : pick?.prediction ? "Edit your note" : "Add a note"}
        style={{
          background: "none", border: "none", cursor: "pointer", fontSize: "15px", padding: "1px", flexShrink: 0,
          color: pick?.prediction ? GOLD : "rgba(255,255,255,0.55)", fontWeight: 900, lineHeight: 1,
        }}
      >
        {notesOpen ? "–" : "+"}
      </button>
      <button
        onClick={() => setVisibility((v) => (v === "public" ? "private" : "public"))}
        title={visibility === "public" ? "Public — click to make private" : "Private — click to make public"}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "15px", padding: "1px", flexShrink: 0 }}
      >
        {visibility === "public" ? "🌍" : "🔒"}
      </button>
      <button
        onClick={() => onSaveScore(game.id, awayVal, homeVal, visibility, noteVal)}
        disabled={!canSave || saving}
        style={{
          background: canSave ? GOLD : "rgba(255,255,255,0.12)", color: canSave ? "#fff" : "rgba(255,255,255,0.4)",
          border: `2px solid ${canSave ? GOLD : "rgba(255,255,255,0.2)"}`, borderRadius: "6px", padding: "5px 10px",
          fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: canSave && !saving ? "pointer" : "default",
        }}
      >
        {saving ? "…" : "✓ Save"}
      </button>
      {pick && (
        <button
          onClick={onRemove}
          disabled={removing}
          style={{ background: "none", color: "#ff8a7a", border: "2px solid #ff8a7a", borderRadius: "6px", padding: "5px 8px", fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: removing ? "default" : "pointer" }}
        >
          {removing ? "…" : "✕"}
        </button>
      )}
    </div>
  ) : null;

  // Only offered when there's no score behind the pick yet — once a real
  // score is saved, the name goes back to being plain (non-clickable) text
  // so it doesn't compete with the card's own click-through-to-navigate
  // (see the stretched Link below), and so an accidental click can't quietly
  // overwrite a scored, possibly-ranked pick with a scoreless winner-only
  // one (that used to both wipe the score and un-rank the game).
  const canPickWinner = showInputs && !saving && !hasScorePick(pick) && typeof onPickWinner === "function";

  return (
    <div style={{ position: "relative", border: `2px solid ${CARD_BORDER}`, borderRadius: "10px", overflow: "hidden", background: CARD_BG }}>
      {/* Stretched-link background, but only across the right two-thirds of
          the card — the left third is where the score inputs/logos sit, so
          a click meant for one of those (but just off-target) no longer
          accidentally navigates away instead of doing nothing. Doesn't
          affect any individual input/button elsewhere on the card, which
          already sit above this (pointerEvents: "auto") regardless of
          where this box ends. */}
      <Link to={`/game/${game.Slug}`} aria-label={`${game.Away} at ${game.Home}`} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: "33.333%", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1, padding: "8px 12px", pointerEvents: "none" }}>
        {(hasTags || showStar) && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "5px" }}>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {game.GameOfWeek && <RowTag label="Game of the Week" bg="#7c3aed" />}
              {game.Featured && <RowTag label="Featured" bg={GOLD} />}
              {game.RankedDisqualified && <RowTag label="Not Qualified" bg="#555" />}
            </div>
            {showStar && (
              <button
                onClick={() => {
                  if (!canToggleRanked) {
                    alert("Add a score to this pick before it can count toward Ranked.");
                    return;
                  }
                  onToggleRanked(game.id, !pick.ranked);
                }}
                title={canToggleRanked
                  ? (pick.ranked ? "Counts toward Ranked — click to remove" : "Click to count this pick toward Ranked")
                  : "Add a score to count this pick toward Ranked"}
                style={{
                  pointerEvents: "auto", background: "none", border: "none",
                  cursor: canToggleRanked ? "pointer" : "not-allowed", fontSize: "18px",
                  padding: "0", flexShrink: 0, lineHeight: 1, filter: pick.ranked ? "none" : "grayscale(1) opacity(0.45)",
                }}
              >
                ⭐
              </button>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gridTemplateRows: "auto auto", columnGap: "8px", rowGap: "5px" }}>
          {game.Neutral ? (
            <div style={{ gridColumn: "1", gridRow: "1 / 3", alignSelf: "center", justifySelf: "center" }}>{badge("N")}</div>
          ) : (
            <>
              <div style={{ gridColumn: "1", gridRow: "1", alignSelf: "center", justifySelf: "center" }}>{badge("A")}</div>
              <div style={{ gridColumn: "1", gridRow: "2", alignSelf: "center", justifySelf: "center" }}>{badge("H")}</div>
            </>
          )}
          <div style={{ gridColumn: "2", gridRow: "1", minWidth: 0 }}>
            {teamRow(game.Away, awaySchool, game.AwayScore, awayVal, setAwayVal, final ? game.AwayScore > game.HomeScore : null, {
              picked: impliedWinner === "away",
              onPick: canPickWinner ? () => onPickWinner(game.id, "away") : undefined,
            })}
          </div>
          <div style={{ gridColumn: "2", gridRow: "2", minWidth: 0 }}>
            {teamRow(game.Home, homeSchool, game.HomeScore, homeVal, setHomeVal, final ? game.HomeScore > game.AwayScore : null, {
              picked: impliedWinner === "home",
              onPick: canPickWinner ? () => onPickWinner(game.id, "home") : undefined,
              trailing: actionButtons,
            })}
          </div>
        </div>

        {isTie && (
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffb3a7", marginTop: "4px" }}>
            Scores can't tie — every game has a winner.
          </div>
        )}

        {showInputs && notesOpen && (
          <div style={{ marginTop: "6px", pointerEvents: "auto" }}>
            <textarea
              value={noteVal}
              onChange={(e) => setNoteVal(e.target.value)}
              placeholder="Why do you like this pick? (optional)"
              rows={2}
              style={{
                width: "100%", boxSizing: "border-box", resize: "vertical", border: `2px solid ${BLUE}`,
                borderRadius: "6px", padding: "6px 8px", fontFamily: "inherit", fontSize: "12px", fontWeight: 600,
                color: "#222", outline: "none", lineHeight: 1.4,
              }}
            />
          </div>
        )}

        {final && pick && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.55)" }}>
              your pick: {pick.awayScore != null ? `${pick.awayScore}-${pick.homeScore}` : (side === "away" ? game.Away : side === "home" ? game.Home : "—")}
            </span>
            {resultBadge}
          </div>
        )}
      </div>
    </div>
  );
}

function RowTag({ label, bg }) {
  return (
    <span style={{ display: "inline-block", background: bg, color: "#fff", fontSize: "9px", fontWeight: 900, padding: "2px 7px", borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
      {label}
    </span>
  );
}
