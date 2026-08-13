// src/App.js
import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { HelmetProvider, Helmet } from "react-helmet-async";
// Components — small and needed on every route regardless of which page
// loads, so these stay eagerly bundled rather than lazy.
import AuthModal from "./components/AuthModal";
import AdminRoute from "./components/AdminRoute";
import Navbar from "./components/Navbar";
import LoadingSpinner from "./components/LoadingSpinner";

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
const UserBoards = lazy(() => import("./pages/UserBoards"));
const UserProfile = lazy(() => import("./pages/UserProfile"));

// CFB
const CFBPage = lazy(() => import("./pages/CFBPage"));

// Teams
const TeamPage = lazy(() => import("./pages/TeamPage"));
const NFLTeamPage = lazy(() => import("./pages/NFLTeamPage"));

// Mock Draft
const MockDraftHub = lazy(() => import("./pages/MockDraftHub"));
const MyMocksPage = lazy(() => import("./pages/MyMocksPage"));
const CreateMock = lazy(() => import("./pages/CreateMock"));
const ViewMock = lazy(() => import("./pages/ViewMock"));

// Whiteboard
const Whiteboard = lazy(() => import("./pages/Whiteboard"));

// Draft
const DraftPage = lazy(() => import("./pages/DraftPage"));
const DraftTracker = lazy(() => import("./pages/DraftTracker"));

// NFL Hub
const NFLPage = lazy(() => import("./pages/NFLPage"));

// Articles
const ArticlePage = lazy(() => import("./pages/ArticlePage"));
const PerformancePage = lazy(() => import("./pages/PerformancePage"));
const PerformancesHub = lazy(() => import("./pages/PerformancesHub"));
const GamePage = lazy(() => import("./pages/GamePage"));
const MyFeed = lazy(() => import("./pages/MyFeed"));

// Admin — the single biggest chunk to keep out of everyone else's download
// (TipTap editor + extensions, html2canvas, and every admin manager panel).
const AdminPanel = lazy(() => import("./pages/AdminPanel"));

// Games
const MyDraftClass = lazy(() => import("./pages/MyDraftClass"));

// We-Pick
const WePickHub = lazy(() => import("./pages/WePickHub"));

// Shared fallback while a route's chunk downloads — same full-page spinner
// convention every page already uses for its own data loading, so a route
// switch doesn't introduce a visually distinct new "loading" look.
const RouteFallback = () => <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;

function App() {
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
      </Helmet>
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Standalone — no navbar, no padding */}
            <Route path="/draft-tracker" element={<DraftTracker />} />

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
            <Route path="/nfl" element={<NFLPage />} />
            <Route path="/news" element={<News />} />
            <Route path="/news/:id" element={<NewsArticle />} />
            <Route path="/community" element={<CommunityBoard />} />
            <Route path="/community/:year" element={<CommunityBoard />} />
            {/* Position-specific rankings pages, e.g. /community/2027/qb —
                distinct from the year-only route above since it's a separate
                two-segment path shape; React Router matches by segment count/
                literal-vs-dynamic parts, not route order, so this coexists
                cleanly with /community/:year. */}
            <Route path="/community/:year/:position" element={<CommunityBoard />} />
            <Route path="/player/:slug" element={<PlayerProfile />} />
            {/* Redirect old /player2 URLs to canonical /player URLs */}
            <Route path="/player2/:slug" element={<RedirectPlayer2 />} />
            <Route path="/team/:teamId" element={<TeamPage />} />
            <Route path="/nfl/:teamId" element={<NFLTeamPage />} />
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
            <Route path="/mocks/:mockId" element={<CreateMock />} />
            <Route path="/whiteboard" element={<Whiteboard />} />
            <Route path="/draft" element={<DraftPage />} />
            <Route path="/my-draft-class" element={<MyDraftClass />} />
            <Route path="/admin" element={<AdminRoute><AdminPanel /></AdminRoute>} />
            <Route path="/article/:slug" element={<ArticlePage />} />
            <Route path="/performances" element={<PerformancesHub />} />
            {/* Trends is a literal path, ranked ahead of the dynamic :week
                route below by React Router regardless of declaration order —
                same page, its own tab. */}
            <Route path="/performances/trends" element={<PerformancesHub />} />
            {/* A specific week's slate — same page, just deep-linkable to one
                week instead of always landing on "current" (see GamePage.js's
                back-navigation, which points here rather than the bare hub). */}
            <Route path="/performances/:week" element={<PerformancesHub />} />
            <Route path="/performance/:slug" element={<PerformancePage />} />
            <Route path="/game/:slug" element={<GamePage />} />
            <Route path="/we-pick" element={<WePickHub />} />
            {/* Standings — same page component, tab + optional week param
                (see WePickHub.js's own activeTab/useParams handling), mirroring
                how /performances and /performances/:week share PerformancesHub. */}
            <Route path="/we-pick/standings" element={<WePickHub />} />
            <Route path="/we-pick/standings/:week" element={<WePickHub />} />
            {/* My Stats — same page component, third tab (see WePickHub.js's
                own activeTab handling). */}
            <Route path="/we-pick/stats" element={<WePickHub />} />
            {/* Friends — fourth tab: friend code, add-by-code, requests,
                friend list (see WePickHub.js's own activeTab handling). */}
            <Route path="/we-pick/friends" element={<WePickHub />} />
            <Route path="*" element={<div style={{ textAlign: "center", color: "red", fontWeight: "bold" }}>404 – Route not found</div>} />
          </Routes>
        </Suspense>
      </div>
      <Analytics />
    </>
  );
}

// Redirect /player2/:slug → /player/:slug
function RedirectPlayer2() {
  const { slug } = useParams();
  return <Navigate to={`/player/${slug}`} replace />;
}

export default App;
