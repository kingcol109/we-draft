import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react"; // ✅ add import
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import CommunityBoard from "./pages/CommunityBoard";
import PlayerProfile from "./pages/PlayerProfile";
import UserBoards from "./pages/UserBoards";
import UserProfile from "./pages/UserProfile"; // ✅ import profile page

function App() {
  console.log("✅ App.js loaded, routes mounted");

  return (
    <Router>
      {/* Navbar always visible */}
      <Navbar />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/community" element={<CommunityBoard />} />

        {/* ✅ Dynamic route now uses slug */}
        <Route path="/player/:Slug" element={<PlayerProfile />} />

        <Route path="/boards" element={<UserBoards />} />
        <Route path="/profile" element={<UserProfile />} /> {/* ✅ new route */}

        {/* ✅ Catch-all 404 route */}
        <Route
          path="*"
          element={
            <div style={{ marginTop: "80px", textAlign: "center", color: "red" }}>
              404 – Route not found
            </div>
          }
        />
      </Routes>

      {/* ✅ Analytics active across all routes */}
      <Analytics />
    </Router>
  );
}

export default App;
