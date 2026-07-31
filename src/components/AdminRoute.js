// src/components/AdminRoute.js
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// ── Wrap any route with <AdminRoute>...</AdminRoute> to gate it to
// users whose Firestore users/{uid} doc has role === "admin".
//
// Waits on AuthContext's `authReady` before deciding anything — on a fresh
// load, `user` starts null and only resolves once onAuthStateChanged fires,
// so checking role before authReady is true would misread a signed-in admin
// as signed-out and redirect them home. Reads role off `profile` (already
// fetched by AuthContext on sign-in) rather than doing a second Firestore
// read here. ──
export default function AdminRoute({ children }) {
  const { user, profile, authReady } = useAuth();

  if (!authReady) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        <div style={{ position: "relative", width: "48px", height: "48px" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `4px solid ${BLUE}`, opacity: 0.15 }} />
          <div style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            border: "4px solid transparent", borderTopColor: BLUE, borderRightColor: GOLD,
            animation: "wdAdminSpin 0.9s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite",
          }} />
          <style>{`@keyframes wdAdminSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const isAdmin = !!user && profile?.role === "admin";

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}