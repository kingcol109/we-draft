// src/components/AdminRoute.js
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "./LoadingSpinner";

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
    return <LoadingSpinner size={48} minHeight="60vh" />;
  }

  const isAdmin = !!user && profile?.role === "admin";

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}
