// src/App.js
import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from "react-router-dom";
import { wePickHref } from "./utils/wePickRoutes";
import { Analytics } from "@vercel/analytics/react";
import { HelmetProvider, Helmet } from "react-helmet-async";
// Components — small and needed on every route regardless of which page
// loads, so these stay eagerly bundled rather than lazy.
import AuthModal from "./components/AuthModal";
import AdminRoute from "./components/AdminRoute";
import SimRoute from "./components/SimRoute";
import DraftSimMeta from "./components/draftSim/DraftSimMeta";
import PortalSimMeta from "./components/portalSim/PortalSimMeta";
import { useStuckSpinnerWatchdog } from "./hooks/useStuckSpinnerWatchdog";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import LoadingSpinner from "./components/LoadingSpinner";
import PlayerHeaderShell from "./components/PlayerHeaderShell";
import { NFL_PLAYER_PAGES } from "./utils/nflPlayerSlugs";
import { prefetchPlayerFromUrl } from "./utils/playerPrefetch";
import { isUnreleasedYear, isUnreleasedSlug, useIsAdmin } from "./utils/prospectYears";
import { PreviewContext, usePreviewLink } from "./utils/previewLinks";
import { WEEKLY_YEARS, MAIN_WEEKLY_YEAR, weeklyMockHref, weeklyYearHref, hasTeamPages } from "./utils/weeklyMockNews";

// A cold landing on /player/:slug starts its player query now, alongside
// the PlayerProfile chunk download rather than after it.
prefetchPlayerFromUrl();

// Pages — lazy-loaded per route instead of one bundle everyone downloads
// upfront. Before this, a first-time visitor to any page (say, a team page)
// paid the full weight of every page in the app, including AdminPanel's
// rich-text editor, drag-and-drop mock draft builder, and image-export
// libraries — code they'd never run. Each of these now ships as its own
// chunk, fetched only when its route is actually visited.
const Home = lazy(() => import("./pages/Home"));
const News = lazy(() => import("./pages/News"));
const NewsArticle = lazy(() => import("./pages/NewsArticle"));
const CommunityBoard = lazy(() => import("./pages/CommunityBoard"));
const PlayerProfile = lazy(() => import("./pages/PlayerProfile"));
// NFL player pages (concept) — a drafted player at his prospect slug; which
// slugs: utils/nflPlayerSlugs.js.
const NflPlayerPage = lazy(() => import("./pages/NflPlayerPage"));
// Public Find Comparison calculator — gated behind config/features
// .comparisonEnabled itself (see Comparison.js), so it's routed like any
// other public page rather than wrapped in AdminRoute.
const Comparison = lazy(() => import("./pages/Comparison"));
const UserBoards = lazy(() => import("./pages/UserBoards"));
const UserProfile = lazy(() => import("./pages/UserProfile"));

// CFB
const CFBPage = lazy(() => import("./pages/CFBPage"));

// Teams
const TeamPage = lazy(() => import("./pages/TeamPage"));
const NFLTeamPage = lazy(() => import("./pages/NFLTeamPage"));
// /staff/{slug} — current head coaches' and GMs' draft histories.
const StaffPage = lazy(() => import("./pages/StaffPage"));
// High school team pages — in development, deliberately unlisted (see that
// file's own top comment): noindexed and never linked from anywhere else
// on the site, reachable only via a direct URL.
const HighSchoolTeamPage = lazy(() => import("./pages/HighSchoolTeamPage"));
// /portalsim (/portalsim/:team) — the Transfer Portal Sim. Public (user, 2026-11-18: out of beta).
const PortalSim = lazy(() => import("./pages/PortalSim"));
// /recruitsim — Recruit Sim (recruiting season game). Beta: admins + Sim Beta users (SimRoute).
const RecruitSim = lazy(() => import("./pages/RecruitSim"));
// /portal, /portal/:position, /portal/news/updates, /portal/:team(/:tab) — the Transfer Portal.
// (The updates feed moved from /portal/updates to /portal/news/updates — user, 2026-11-19; the old URL redirects, here and in vercel.json.)
const TransferPortal = lazy(() => import("./pages/TransferPortal"));
// /portal/news (+ /in, /out, /{pos}, /{pos}/in|out, /updates) — Portal News (utils/portalNews.js): the portal's editorial pages; an empty page is noindexed.
const PortalNews = lazy(() => import("./pages/PortalNews"));
// /hs/rankings — the high school leaderboards (also unlisted; admin link).
const HighSchoolRankings = lazy(() => import("./pages/HighSchoolRankings"));

// Mock Draft
const MockDraftHub = lazy(() => import("./pages/MockDraftHub"));
const MyMocksPage = lazy(() => import("./pages/MyMocksPage"));
const CreateMock = lazy(() => import("./pages/CreateMock"));
const ViewMock = lazy(() => import("./pages/ViewMock"));
const WeeklyYearPage = lazy(() => import("./pages/ViewMock").then((m) => ({ default: m.WeeklyYearPage })));
// /mocks/{team} — a team's picks in the weekly mock.
const WeeklyTeamMock = lazy(() => import("./pages/WeeklyTeamMock"));
// Draft Sim — /draftsim, /draftsim/{team} to start as that team, and
// /draftsim/2028 (/draftsim/2028/{team}) for the 2028 class.
const DraftSim = lazy(() => import("./pages/DraftSim"));
// /draftsim/live — On the Clock on the site: the broadcast frame, interactive and full-screen-able.
const DraftSimLive = lazy(() => import("./pages/DraftSimLive"));

// Whiteboard
const Whiteboard = lazy(() => import("./pages/Whiteboard"));

// Draft
const DraftPage = lazy(() => import("./pages/DraftPage"));
const DraftTracker = lazy(() => import("./pages/DraftTracker"));

// NFL Hub
const NFLPage = lazy(() => import("./pages/NFLPage"));
const DraftOrderPage = lazy(() => import("./pages/DraftOrderPage"));
// /events (was /calendar) — key pre-draft dates (utils/draftCalendar.js);
// /events/{event}/{year} — each event's page (utils/events.js).
const DraftCalendar = lazy(() => import("./pages/DraftCalendar"));
const EventPage = lazy(() => import("./pages/EventPage"));
// /risers/{year} — Draft Risers (utils/risers.js; Admin → Content → Rising Page).
const Risers = lazy(() => import("./pages/Risers"));
// /map, /map/draft, /map/{team} — interactive 3D maps (deck.gl; utils/mapData.js).
const MapPage = lazy(() => import("./pages/MapPage"));

// Articles
const ArticlePage = lazy(() => import("./pages/ArticlePage"));
const VideosPage = lazy(() => import("./pages/VideosPage"));
const WatchPage = lazy(() => import("./pages/WatchPage"));
const GamePage = lazy(() => import("./pages/GamePage"));
// We-Draft Live — full-screen "second screen" scoreboard, standalone like
// /draft-tracker (no navbar) so it can live on a TV.
// Old /we-pick URLs → We-Pick inside We-Draft Live.
function WePickRedirect({ tab = "picks" }) {
  const { week } = useParams();
  return <Navigate to={wePickHref(tab, week || null)} replace />;
}

const LivePage = lazy(() => import("./pages/LivePage"));
// The We-Draft Live broadcast renderer (a 1920×1080 frame for streaming).
const BroadcastPage = lazy(() => import("./pages/BroadcastPage"));
// …and the national one: every game on right now in one frame.
const BroadcastNationalPage = lazy(() => import("./pages/BroadcastNationalPage"));
// …and On the Clock, the nightly Draft Sim show (not beta-gated: the
// capture worker can't sign in — the show's data is public anyway).
const BroadcastOnTheClockPage = lazy(() => import("./pages/BroadcastOnTheClockPage"));
const MyFeed = lazy(() => import("./pages/MyFeed"));

// Admin — the single biggest chunk to keep out of everyone else's download
// (TipTap editor + extensions, html2canvas, and every admin manager panel).
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
// Football Sim Lab — admins + beta users (users/{uid}.simBeta, see SimRoute.js);
// noindexed, disallowed in robots.txt, never linked publicly.
const SimPage = lazy(() => import("./pages/SimPage"));

// Games
const MyDraftClass = lazy(() => import("./pages/MyDraftClass"));

// We-Pick

// Legal — standalone, static content pages, linked from Footer.js and the
// signup/login modal (AuthModal.jsx).
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const CommunityGuidelines = lazy(() => import("./pages/CommunityGuidelines"));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy"));

// Shared fallback while a route's chunk downloads — same full-page spinner
// convention every page already uses for its own data loading, so a route
// switch doesn't introduce a visually distinct new "loading" look.
const RouteFallback = () => <LoadingSpinner label="Loading" size={56} minHeight="calc(60vh / var(--pz, 1))" />;

function App() {
  // Phones: a page stuck on its loading spinner for 5s gets one reload.
  useStuckSpinnerWatchdog();
  return (
    <HelmetProvider>
      {/* Site-wide default — every page overrides this via its own <Helmet>
          (nested Helmets win over this root one for same-named tags), so
          this only ever actually shows on a page that doesn't set its own
          description. Lives here instead of a static tag in public/index.html
          so it's part of the same Helmet-managed set and can be overridden;
          a raw static tag there would just sit alongside each page's tag
          rather than being replaced by it. */}
      <Helmet>
        <title>We-Draft.com — Community NFL Draft Scouting</title>
        <meta name="description" content="The community-powered NFL Draft scouting platform. Grade prospects, build your personal draft board, and see how your takes compare — free to join." />
        {/* The link-preview image for any page without its own: the WD
            logo, as the small square beside the title (a "summary" card). */}
        <meta property="og:image" content="https://we-draft.com/wd-icon-512.png" />
        <meta name="twitter:image" content="https://we-draft.com/wd-icon-512.png" />
      </Helmet>
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Standalone — no navbar, no padding */}
            <Route path="/draft-tracker" element={<DraftTracker />} />
            {/* /live/* — /live itself plus We-Pick's own paths (/live/we-pick…,
                see utils/wePickRoutes.js), one route so moving between them
                never remounts the page. */}
            <Route path="/live/*" element={<LivePage />} />
            {/* /broadcast/:slug — same slugs as /live; ?mode=stream for capture. */}
            {/* /broadcast/national — every game on now (a static segment, so
                it wins over :slug). */}
            <Route path="/broadcast/national" element={<BroadcastNationalPage />} />
            <Route path="/broadcast/ontheclock" element={<BroadcastOnTheClockPage />} />
            <Route path="/broadcast/:slug" element={<BroadcastPage />} />
            <Route path="/sim" element={<SimRoute><SimPage /></SimRoute>} />

            {/* All other routes — wrapped with Navbar */}
            <Route path="*" element={<MainLayout />} />
          </Routes>
        </Suspense>
      </Router>
    </HelmetProvider>
  );
}

function MainLayout() {
  return (
    <>
      <Navbar />
      <AuthModal />
      <div style={{ paddingTop: "25px" }}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/cfb" element={<CFBPage />} />
            {/* Schedule gets its own addressable path (and optionally a
                specific week) instead of living behind in-page tab state that
                resets to Teams on every reload/navigation. */}
            <Route path="/cfb/schedule" element={<CFBPage />} />
            <Route path="/cfb/schedule/:week" element={<CFBPage />} />
            <Route path="/cfb/stats" element={<CFBPage />} />
            <Route path="/cfb/stats/:cat" element={<CFBPage />} />
            <Route path="/nfl" element={<NFLPage />} />
            {/* The upcoming drafts' full projected order. */}
            <Route path="/draftorder" element={<DraftOrderPage />} />
            <Route path="/events" element={<DraftCalendar />} />
            {/* Admin-only until released (user, 2026-11-18): no sitemap, no links. */}
            <Route path="/map" element={<AdminRoute><MapPage /></AdminRoute>} />
            <Route path="/map/:team" element={<AdminRoute><MapPage /></AdminRoute>} />
            <Route path="/calendar" element={<Navigate to="/events" replace />} />
            {/* The transfer window has no event page — the portal is its page. */}
            <Route path="/events/portal/*" element={<Navigate to="/portal" replace />} />
            {/* The Combine's all-time hub (averages, every year); other events → their current year. */}
            <Route path="/events/combine" element={<EventPage hub />} />
            <Route path="/events/:event" element={<EventLatestYear />} />
            <Route path="/events/:event/:year/:tab?/:pos?" element={<EventPage />} />
            <Route path="/risers" element={<Navigate to="/risers/2027" replace />} />
            <Route path="/risers/:year" element={<Risers />} />
            <Route path="/risers/:year/:edition" element={<Risers />} />
            <Route path="/news" element={<News />} />
            <Route path="/news/:id" element={<NewsArticle />} />
            {/* Same gate as the year/position routes (it passes the
                current class through) so a position chip doesn't remount the page. */}
            <Route path="/community" element={<UnreleasedGate><CommunityBoard /></UnreleasedGate>} />
            <Route path="/community/:year" element={<UnreleasedGate><CommunityBoard /></UnreleasedGate>} />
            {/* Position-specific rankings pages, e.g. /community/2027/qb —
                distinct from the year-only route above since it's a separate
                two-segment path shape; React Router matches by segment count/
                literal-vs-dynamic parts, not route order, so this coexists
                cleanly with /community/:year. */}
            <Route path="/community/:year/:position" element={<UnreleasedGate><CommunityBoard /></UnreleasedGate>} />
            <Route path="/player/:slug" element={<UnreleasedGate><PlayerRoute /></UnreleasedGate>} />
            <Route path="/comparison" element={<Comparison />} />
            {/* /comparison/:slug preloads that prospect — same Slug format
                /player/:slug uses (e.g. "jeremiah-smith-2027-wr"). */}
            <Route path="/comparison/:slug" element={<UnreleasedGate><Comparison /></UnreleasedGate>} />
            {/* Redirect old /player2 URLs to canonical /player URLs */}
            <Route path="/player2/:slug" element={<RedirectPlayer2 />} />
            <Route path="/team/:teamId" element={<TeamPage />} />
            {/* SEO tags: components/portalSim/PortalSimMeta.jsx. My Classes and
                Community (Insights, Recent Classes) set their own. */}
            <Route path="/portalsim" element={<><PortalSimMeta /><PortalSim /></>} />
            <Route path="/portalsim/classes" element={<PortalSim page="classes" />} />
            <Route path="/portalsim/community" element={<PortalSim page="community" />} />
            <Route path="/portalsim/recent" element={<PortalSim page="recent" />} />
            <Route path="/portalsim/:team" element={<><PortalSimMeta /><PortalSim /></>} />
            <Route path="/recruitsim" element={<SimRoute signInPrompt><RecruitSim /></SimRoute>} />
            <Route path="/portal" element={<TransferPortal />} />
            <Route path="/portal/updates" element={<Navigate to="/portal/news/updates" replace />} />
            <Route path="/portal/news" element={<PortalNews />} />
            {/* Latest Moves: a tab of Portal News (the portal's updates feed inside it). */}
            <Route path="/portal/news/updates" element={<PortalNews view="updates" />} />
            <Route path="/portal/news/:pos" element={<PortalNews />} />
            <Route path="/portal/news/:pos/:side" element={<PortalNews />} />
            <Route path="/portal/:position" element={<TransferPortal />} />
            <Route path="/portal/:position/:tab" element={<TransferPortal />} />
            <Route path="/hs/rankings" element={<HighSchoolRankings />} />
            <Route path="/hs/:slug" element={<HighSchoolTeamPage />} />
            <Route path="/nfl/:teamId/:tab?" element={<NFLTeamPage />} />
            <Route path="/staff/:slug/:tab?" element={<StaffPage />} />
            <Route path="/boards" element={<UserBoards />} />
            <Route path="/boards/feed" element={<MyFeed />} />
            <Route path="/profile" element={<UserProfile />} />
            <Route path="/mocks" element={<MockDraftHub />} />
            <Route path="/mocks/my" element={<MyMocksPage />} />
            <Route path="/mocks/create" element={<CreateMock />} />
            {/* Read-only presentation view (ViewMock.js) — was already
                fully built but never actually routed anywhere, so a mock's
                own owner had no way to see it without landing straight in
                the editor at the plain /mocks/:mockId path below. */}
            <Route path="/mocks/:mockId/view" element={<ViewMock />} />
            <Route path="/mocks/:mockId" element={<MockOrTeam />} />
            <Route path="/mocks/:mockId/:year" element={<TeamMockYear />} />
            {/* Open to everyone, no account needed (saving and My Board
                ask for one). SEO tags: DraftSimMeta.jsx. */}
            <Route path="/draftsim" element={<><DraftSimMeta /><DraftSim /></>} />
            {/* Recent Drafts (public one-team saved sims) and the Sim Profile — ahead of :team. */}
            <Route path="/draftsim/live" element={<DraftSimLive />} />
            <Route path="/draftsim/community" element={<DraftSim page="community" />} />
            <Route path="/draftsim/recent" element={<DraftSim page="recent" />} />
            <Route path="/draftsim/profile" element={<DraftSim page="profile" />} />
            <Route path="/draftsim/:team" element={<><DraftSimMeta /><DraftSim /></>} />
            <Route path="/draftsim/:year/:team" element={<><DraftSimMeta /><DraftSim /></>} />
            <Route path="/whiteboard" element={<Whiteboard />} />
            <Route path="/draft" element={<DraftPage />} />
            <Route path="/my-draft-class" element={<MyDraftClass />} />
            <Route path="/admin" element={<AdminRoute><AdminPanel /></AdminRoute>} />
            <Route path="/article/:slug" element={<ArticlePage />} />
            <Route path="/videos" element={<VideosPage />} />
            <Route path="/watch" element={<WatchPage />} />
            <Route path="/game/:slug" element={<GamePage />} />
            {/* We-Pick lives in We-Draft Live now (/live/we-pick — see
                utils/wePickRoutes.js); the old URLs redirect there, tab and
                standings week included. */}
            <Route path="/we-pick" element={<WePickRedirect />} />
            <Route path="/we-pick/standings" element={<WePickRedirect tab="standings" />} />
            <Route path="/we-pick/standings/:week" element={<WePickRedirect tab="standings" />} />
            <Route path="/we-pick/stats" element={<WePickRedirect tab="stats" />} />
            <Route path="/we-pick/friends" element={<WePickRedirect tab="friends" />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/guidelines" element={<CommunityGuidelines />} />
            <Route path="/cookies" element={<CookiePolicy />} />
            <Route path="*" element={<RouteNotFound />} />
          </Routes>
        </Suspense>
      </div>
      {/* Site-wide now — this component previously wasn't imported/rendered
          anywhere at all, so no page actually had a footer. Carries the
          Terms/Privacy/Guidelines/Cookie Policy links referenced from
          AuthModal.jsx's signup disclosure. */}
      <Footer />
      <Analytics />
    </>
  );
}

// /mocks/:mockId is the mock editor — unless it's a Weekly Mock class
// ("2027"), that class's whole mock (ViewMock.js WeeklyYearPage), or a team
// code ("nyj"), that team's weekly mock page (WeeklyTeamMock checks it's a
// real team).
// Mock IDs are 20-character Firestore IDs, so the two never collide. A
// team code in capitals (/mocks/MIA) goes to the lowercase URL, the one
// canonical and in the sitemap.
function MockOrTeam() {
  const { mockId } = useParams();
  if (WEEKLY_YEARS.includes(mockId)) return <WeeklyYearPage key={mockId} year={mockId} />;
  if (!/^[a-z]{2,3}$/i.test(mockId || "")) return <CreateMock />;
  if (mockId !== mockId.toLowerCase()) return <Navigate to={`/mocks/${mockId.toLowerCase()}`} replace />;
  return <WeeklyTeamMock key={mockId} team={mockId.toUpperCase()} />;
}

// /mocks/{team}/2028 — a team's page in the next class's Weekly Mock. The
// main class has no year in its URL (/mocks/nyj/2027 goes there); a class
// with no team pages (2029) goes to its whole mock; any other year, or a
// non-team, is WeeklyTeamMock's not found.
function TeamMockYear() {
  const { mockId, year } = useParams();
  const team = String(mockId || "").toLowerCase();
  if (WEEKLY_YEARS.includes(year) && !hasTeamPages(year)) return <Navigate to={weeklyYearHref(year)} replace />;
  if (year === MAIN_WEEKLY_YEAR || (mockId !== team && WEEKLY_YEARS.includes(year))) return <Navigate to={weeklyMockHref(team, year)} replace />;
  return <WeeklyTeamMock key={`${team}-${year}`} team={WEEKLY_YEARS.includes(year) && /^[a-z]{2,3}$/.test(team) ? team.toUpperCase() : ""} year={year} />;
}

// /player/:slug — the prospect page, or the NFL player page for a slug in
// NFL_PLAYER_PAGES.
function PlayerRoute() {
  const { slug } = useParams();
  if (NFL_PLAYER_PAGES[slug]) return <NflPlayerPage key={slug} slug={slug} />;
  return <Suspense fallback={<PlayerHeaderShell />}><PlayerProfile /></Suspense>;
}

const RouteNotFound = () => <div style={{ textAlign: "center", color: "red", fontWeight: "bold" }}>404 – Route not found</div>;

// An unreleased class (utils/prospectYears.js UNRELEASED_YEARS) is admin-only:
// its board (/community/:year), player pages and comparison pages (slug
// carries the class) 404 for everyone else. Waits on auth so a signed-in
// admin isn't turned away on a fresh load. A private preview link
// (?preview=<token>, utils/previewLinks.js) opens its player's page for
// anyone, and puts the page in preview mode (PreviewContext).
function UnreleasedGate({ children }) {
  const { year, slug } = useParams();
  const { isAdmin, authReady } = useIsAdmin();
  const preview = usePreviewLink(slug);
  const hidden = (year && isUnreleasedYear(year)) || (slug && isUnreleasedSlug(slug));
  // Always the same Provider, so a link that checks out after the first
  // render doesn't remount the page.
  const wrap = (node) => <PreviewContext.Provider value={preview.status === "ok" ? preview.link : null}>{node}</PreviewContext.Provider>;
  if (!hidden || isAdmin || preview.status === "ok") return wrap(children);
  if (!authReady || preview.status === "checking") return <LoadingSpinner size={48} minHeight="calc(60vh / var(--pz, 1))" />;
  return <RouteNotFound />;
}

// /events/{event} → that event's current year.
function EventLatestYear() {
  const { event } = useParams();
  return <Navigate to={`/events/${event}/2027`} replace />;
}

// Redirect /player2/:slug → /player/:slug
function RedirectPlayer2() {
  const { slug } = useParams();
  return <Navigate to={`/player/${slug}`} replace />;
}

export default App;
