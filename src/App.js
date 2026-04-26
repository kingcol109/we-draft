// src/App.js
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { HelmetProvider } from "react-helmet-async";
// Components
import Navbar from "./components/Navbar";

// Pages
import Home from "./pages/Home";
import News from "./pages/News";
import NewsArticle from "./pages/NewsArticle";
import CommunityBoard from "./pages/CommunityBoard";
import PlayerProfile from "./pages/PlayerProfile";
import PlayerPage2 from "./pages/PlayerPage2";
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
import AdminArticles from "./pages/AdminArticles";
import EditArticle from "./pages/EditArticle";
import ArticlePage from "./pages/ArticlePage";

// Games
import MyDraftClass from "./pages/MyDraftClass";

function App() {
  return (
    <HelmetProvider>
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
      <div style={{ paddingTop: "25px" }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cfb" element={<CFBPage />} />
          <Route path="/nfl" element={<NFLPage />} />
          <Route path="/news" element={<News />} />
          <Route path="/news/:id" element={<NewsArticle />} />
          <Route path="/community" element={<CommunityBoard />} />
          <Route path="/player/:slug" element={<PlayerProfile />} />
          <Route path="/player2/:slug" element={<PlayerPage2 />} />
          <Route path="/team/:teamId" element={<TeamPage />} />
          <Route path="/nfl/:teamId" element={<NFLTeamPage />} />
          <Route path="/boards" element={<UserBoards />} />
          <Route path="/profile" element={<UserProfile />} />
          <Route path="/mocks" element={<MockDraftHub />} />
          <Route path="/mocks/my" element={<MyMocksPage />} />
          <Route path="/mocks/create" element={<CreateMock />} />
          <Route path="/mocks/:mockId" element={<CreateMock />} />
          <Route path="/whiteboard" element={<Whiteboard />} />
          <Route path="/draft" element={<DraftPage />} />
          <Route path="/my-draft-class" element={<MyDraftClass />} />
          <Route path="/admin/articles" element={<AdminArticles />} />
          <Route path="/admin/articles/:id" element={<EditArticle />} />
          <Route path="/article/:slug" element={<ArticlePage />} />
          <Route path="*" element={<div style={{ textAlign: "center", color: "red", fontWeight: "bold" }}>404 – Route not found</div>} />
        </Routes>
      </div>
      <Analytics />
    </>
  );
}

export default App;