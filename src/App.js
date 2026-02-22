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
import UserBoards from "./pages/UserBoards";
import UserProfile from "./pages/UserProfile";

// College Teams
import TeamPage from "./pages/TeamPage";

// NFL Teams
import NFLTeamPage from "./pages/NFLTeamPage";

// Mock Draft Pages
import MockDraftHub from "./pages/MockDraftHub";
import MyMocksPage from "./pages/MyMocksPage";
import CreateMock from "./pages/CreateMock";

// 🆕 Whiteboard Page
import Whiteboard from "./pages/Whiteboard";

function App() {
  return (
    <HelmetProvider>
      <Router>
        {/* Navbar always visible */}
        <Navbar />

        {/* Offset for fixed navbar + ticker */}
        <div style={{ paddingTop: "25px" }}>
          <Routes>
            <Route path="/" element={<Home />} />

            {/* News */}
            <Route path="/news" element={<News />} />
            <Route path="/news/:id" element={<NewsArticle />} />

            <Route path="/community" element={<CommunityBoard />} />

            {/* Dynamic player profile */}
            <Route path="/player/:slug" element={<PlayerProfile />} />

            {/* College Team Pages */}
            <Route path="/team/:teamId" element={<TeamPage />} />

            {/* NFL Team Pages */}
            <Route path="/nfl/:teamId" element={<NFLTeamPage />} />

            <Route path="/boards" element={<UserBoards />} />
            <Route path="/profile" element={<UserProfile />} />

            {/* Mock Drafts */}
            <Route path="/mocks" element={<MockDraftHub />} />
            <Route path="/mocks/my" element={<MyMocksPage />} />
            <Route path="/mocks/create" element={<CreateMock />} />
            <Route path="/mocks/:mockId" element={<CreateMock />} />

            {/* 🆕 Draft Whiteboard */}
            <Route path="/whiteboard" element={<Whiteboard />} />

            {/* Catch-all 404 */}
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

        {/* Analytics */}
        <Analytics />
      </Router>
    </HelmetProvider>
  );
}

export default App;
