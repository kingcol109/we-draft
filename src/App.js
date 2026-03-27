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

// 🆕 ARTICLES SYSTEM
import AdminArticles from "./pages/AdminArticles";
import EditArticle from "./pages/EditArticle";     // 🔥 NEW
import ArticlePage from "./pages/ArticlePage";     // 🔥 NEW (public)

function App() {
  return (
    <HelmetProvider>
      <Router>
        <Navbar />

        <div style={{ paddingTop: "25px" }}>
          <Routes>
            <Route path="/" element={<Home />} />

            {/* College Football */}
            <Route path="/cfb" element={<CFBPage />} />

            {/* News */}
            <Route path="/news" element={<News />} />
            <Route path="/news/:id" element={<NewsArticle />} />

            <Route path="/community" element={<CommunityBoard />} />

            {/* Players */}
            <Route path="/player/:slug" element={<PlayerProfile />} />
            <Route path="/player2/:slug" element={<PlayerPage2 />} />

            {/* Teams */}
            <Route path="/team/:teamId" element={<TeamPage />} />
            <Route path="/nfl/:teamId" element={<NFLTeamPage />} />

            {/* User */}
            <Route path="/boards" element={<UserBoards />} />
            <Route path="/profile" element={<UserProfile />} />

            {/* Mock Draft */}
            <Route path="/mocks" element={<MockDraftHub />} />
            <Route path="/mocks/my" element={<MyMocksPage />} />
            <Route path="/mocks/create" element={<CreateMock />} />
            <Route path="/mocks/:mockId" element={<CreateMock />} />

            {/* Whiteboard */}
            <Route path="/whiteboard" element={<Whiteboard />} />

            {/* 🆕 ADMIN CMS */}
            <Route path="/admin/articles" element={<AdminArticles />} />
            <Route path="/admin/articles/:id" element={<EditArticle />} />

            {/* 🆕 PUBLIC ARTICLES */}
            <Route path="/article/:slug" element={<ArticlePage />} />

            {/* 404 */}
            <Route
              path="*"
              element={
                <div
                  style={{
                    textAlign: "center",
                    color: "red",
                    fontWeight: "bold",
                  }}
                >
                  404 – Route not found
                </div>
              }
            />
          </Routes>
        </div>

        <Analytics />
      </Router>
    </HelmetProvider>
  );
}

export default App;