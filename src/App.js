// src/App.js
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { HelmetProvider, Helmet } from "react-helmet-async";
// Components
import AuthModal from "./components/AuthModal";
import AdminRoute from "./components/AdminRoute";

import Navbar from "./components/Navbar";

// Pages
import Home from "./pages/Home";
import News from "./pages/News";
import NewsArticle from "./pages/NewsArticle";
import CommunityBoard from "./pages/CommunityBoard";
import PlayerProfile from "./pages/PlayerProfile";
import UserBoards from "./pages/UserBoards";
import UserProfile from "./pages/UserProfile";

// CFB
import CFBPage from "./pages/CFBPage";

// Teams
import TeamPage from "./pages/TeamPage";
import NFLTeamPage from "./pages/NFLTeamPage";

// Mock Draft
import MockDraftHub from "./pages/MockDraftHub";
import MyMocksPage from "./pages/MyMocksPage";
import CreateMock from "./pages/CreateMock";

// Whiteboard
import Whiteboard from "./pages/Whiteboard";

// Draft
import DraftPage from "./pages/DraftPage";
import DraftTracker from "./pages/DraftTracker";

// NFL Hub
import NFLPage from "./pages/NFLPage";

// Articles
import ArticlePage from "./pages/ArticlePage";
import PerformancePage from "./pages/PerformancePage";
import PerformancesHub from "./pages/PerformancesHub";
import GamePage from "./pages/GamePage";
import MyFeed from "./pages/MyFeed";

// Admin
import AdminPanel from "./pages/AdminPanel";

// Games
import MyDraftClass from "./pages/MyDraftClass";

// We-Pick
import WePickHub from "./pages/WePickHub";

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
        <Routes>
          {/* Standalone — no navbar, no padding */}
          <Route path="/draft-tracker" element={<DraftTracker />} />

          {/* All other routes — wrapped with Navbar */}
          <Route path="*" element={<MainLayout />} />
        </Routes>
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
          <Route path="*" element={<div style={{ textAlign: "center", color: "red", fontWeight: "bold" }}>404 – Route not found</div>} />
        </Routes>
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