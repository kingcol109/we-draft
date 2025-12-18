import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { HelmetProvider } from "react-helmet-async";

// Components
import Navbar from "./components/Navbar";

// Pages
import Home from "./pages/Home";
import CommunityBoard from "./pages/CommunityBoard";
import PlayerProfile from "./pages/PlayerProfile";
import UserBoards from "./pages/UserBoards";
import UserProfile from "./pages/UserProfile";
import TeamPage from "./pages/TeamPage";

function App() {
  return (
    <HelmetProvider>
      <Router>
        {/* Navbar always visible */}
        <Navbar />

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/community" element={<CommunityBoard />} />

          {/* Dynamic player profile by slug */}
          <Route path="/player/:slug" element={<PlayerProfile />} />

          {/* Dynamic team page */}
          <Route path="/team/:teamId" element={<TeamPage />} />

          <Route path="/boards" element={<UserBoards />} />
          <Route path="/profile" element={<UserProfile />} />

          {/* Catch-all 404 */}
          <Route
            path="*"
            element={
              <div
                style={{
                  marginTop: "80px",
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

        {/* Analytics across all routes */}
        <Analytics />
      </Router>
    </HelmetProvider>
  );
}

export default App;
