// src/components/SimRoute.js
import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "./LoadingSpinner";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Admins, plus users granted Sim Beta (users/{uid}.simBeta, toggled from
// AdminPanel.js's Users section). (The Draft Sim launched — it's open to
// everyone; this gates the Football Sim Lab.)
export const canUseSim = (user, profile) => !!user && (profile?.role === "admin" || profile?.simBeta === true);

// ── Gate for /sim (Football Sim Lab) — see canUseSim. Same authReady wait as
// AdminRoute.js, same `profile` read off AuthContext.
//   signInPrompt  signed out → a sign-in prompt (the sign-in modal opens
//                 on its own) instead of a redirect; once they're in, the
//                 gate re-checks.
//   deniedTo      where a signed-in user without access goes (default "/").
export default function SimRoute({ children, signInPrompt = false, deniedTo = "/" }) {
  const { user, profile, authReady, login } = useAuth();

  if (!authReady) {
    return <LoadingSpinner size={48} minHeight="calc(60vh / var(--pz, 1))" />;
  }
  if (!user && signInPrompt) return <SignInPrompt login={login} />;
  // Just signed in from the modal: the users doc lands a beat after the
  // auth user does — wait for it rather than bounce them.
  if (signInPrompt && user && !profile) {
    return <LoadingSpinner size={48} minHeight="calc(60vh / var(--pz, 1))" />;
  }
  if (!canUseSim(user, profile)) return <Navigate to={deniedTo} replace />;
  return children;
}

function SignInPrompt({ login }) {
  // Open the sign-in modal once on arrival; the button reopens it.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    login();
  }, [login]);
  return (
    <div style={{ minHeight: "calc(60vh / var(--pz, 1))", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
      <div style={{ maxWidth: 440, width: "100%", textAlign: "center", border: `2px solid ${BLUE}`, borderRadius: 16, padding: "28px 22px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        <div style={{ color: GOLD, fontSize: 12, fontWeight: 900, letterSpacing: "0.16em" }}>BETA</div>
        <div style={{ color: BLUE, fontSize: 24, fontWeight: 900, textTransform: "uppercase", margin: "6px 0 10px" }}>Sign in to continue</div>
        <p style={{ color: "#555", fontSize: 14, lineHeight: 1.5, fontFamily: "Arial, sans-serif", margin: "0 0 18px" }}>
          This is in beta for We-Draft.com accounts with beta access. Sign in to see if you&apos;re in.
        </p>
        <button onClick={login} style={{ border: `2px solid ${GOLD}`, background: BLUE, color: "#fff", borderRadius: 8, padding: "12px 26px", fontWeight: 900, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
          Sign In
        </button>
      </div>
    </div>
  );
}
