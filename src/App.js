import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";

// Components
import Navbar from "./components/Navbar";
import Footer from "./components/Footer"; // ✅ Added Footer import

// Pages
import Home from "./pages/Home";
import CommunityBoard from "./pages/CommunityBoard";
import PlayerProfile from "./pages/PlayerProfile";
import UserBoards from "./pages/UserBoards";
import UserProfile from "./pages/UserProfile";
import TeamPage from "./pages/TeamPage";

// ✅ Inner wrapper so we can conditionally render the footer
function AppContent() {
  const location = useLocation();
  const hideFooterRoutes = ["/profile"]; // hide footer on this route
  const showFooter = !hideFooterRoutes.includes(location.pathname);

  return (
    <>
      {/* Navbar always visible */}
      <Navbar />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/community" element={<CommunityBoard />} />
        <Route path="/player/:slug" element={<PlayerProfile />} />
        <Route path="/team/:teamId" element={<TeamPage />} />
        <Route path="/boards" element={<UserBoards />} />
        <Route path="/profile" element={<UserProfile />} />

        {/* Catch-all 404 route */}
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

      {/* ✅ Footer only shows on allowed routes */}
      {showFooter && <Footer />}

      {/* Analytics active across all routes */}
      <Analytics />
    </>
  );
}

// ✅ Main app with Router wrapper
function App() {
  console.log("✅ App.js loaded, routes mounted");

  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
