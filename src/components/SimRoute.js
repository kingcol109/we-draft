// src/components/SimRoute.js
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "./LoadingSpinner";

// ── Gate for /sim — admins, plus users granted Football Sim beta access
// (users/{uid}.simBeta, toggled from AdminPanel.js's Users section). Same
// authReady wait as AdminRoute.js, same `profile` read off AuthContext. ──
export default function SimRoute({ children }) {
  const { user, profile, authReady } = useAuth();

  if (!authReady) {
    return <LoadingSpinner size={48} minHeight="calc(60vh / var(--pz, 1))" />;
  }

  const allowed = !!user && (profile?.role === "admin" || profile?.simBeta === true);

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return children;
}
