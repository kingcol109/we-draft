import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import Logo1 from "../assets/Logo1.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function AuthModal() {
  const { authModalOpen, closeAuthModal, loginWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();

  const [mode, setMode] = useState("signin"); // "signin" | "signup" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!authModalOpen) return null;

  const reset = () => {
    setEmail(""); setPassword(""); setConfirmPassword("");
    setError(""); setResetSent(false); setLoading(false);
  };

  const switchMode = (m) => { reset(); setMode(m); };

  const handleGoogle = async () => {
    setLoading(true); setError("");
    try {
      await loginWithGoogle();
      closeAuthModal();
    } catch (e) {
      setError("Google sign-in failed. Please try again.");
    } finally { setLoading(false); }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      if (mode === "reset") {
        await resetPassword(email);
        setResetSent(true);
      } else if (mode === "signup") {
        if (password !== confirmPassword) { setError("Passwords don't match."); return; }
        if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
        await signUpWithEmail(email, password);
        closeAuthModal();
      } else {
        await signInWithEmail(email, password);
        closeAuthModal();
      }
    } catch (e) {
      const msg = {
        "auth/email-already-in-use": "An account with this email already exists.",
        "auth/user-not-found": "No account found with this email.",
        "auth/wrong-password": "Incorrect password.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/too-many-requests": "Too many attempts. Please try again later.",
        "auth/invalid-credential": "Incorrect email or password.",
      }[e.code] || "Something went wrong. Please try again.";
      setError(msg);
    } finally { setLoading(false); }
  };

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    border: `2px solid #ddd`, borderRadius: "8px",
    padding: "11px 14px", fontSize: "15px", fontWeight: 600,
    fontFamily: "inherit", outline: "none", marginBottom: "12px",
    transition: "border-color 0.15s",
  };

  const titles = { signin: "Welcome Back", signup: "Create Account", reset: "Reset Password" };
  const subtitles = {
    signin: "Sign in to submit evaluations and build your board.",
    signup: "Join the community. Free account, no spam.",
    reset: "Enter your email and we'll send a reset link.",
  };

  return (
    <>
      {/* Overlay */}
      <div
        onClick={closeAuthModal}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          zIndex: 99998, backdropFilter: "blur(2px)",
        }}
      />

      {/* Modal */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 99999, width: "min(440px, 94vw)",
        background: "#fff", borderRadius: "14px",
        boxShadow: "0 24px 80px rgba(0,0,0,0.3)",
        overflow: "hidden",
        fontFamily: "'Arial Black', Arial, sans-serif",
      }}>

        {/* Header */}
        <div style={{ background: BLUE, padding: "20px 24px 16px", position: "relative" }}>
          <button
            onClick={closeAuthModal}
            style={{
              position: "absolute", top: "12px", right: "16px",
              background: "rgba(255,255,255,0.15)", border: "none",
              color: "#fff", borderRadius: "6px", padding: "4px 10px",
              fontSize: "16px", cursor: "pointer", fontWeight: 900, lineHeight: 1,
            }}
          >✕</button>
          <img src={Logo1} alt="We-Draft.com" style={{ height: "28px", filter: "brightness(0) invert(1)", marginBottom: "10px" }} />
          <div style={{ fontSize: "22px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1 }}>
            {titles[mode]}
          </div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.75)", marginTop: "5px" }}>
            {subtitles[mode]}
          </div>
        </div>
        <div style={{ height: "4px", background: GOLD }} />

        <div style={{ padding: "24px" }}>

          {/* Reset sent confirmation */}
          {resetSent ? (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>📧</div>
              <div style={{ fontWeight: 900, fontSize: "16px", color: BLUE, marginBottom: "8px", textTransform: "uppercase" }}>Check Your Email</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#666", marginBottom: "20px" }}>
                A password reset link has been sent to <strong>{email}</strong>.
              </div>
              <button onClick={() => switchMode("signin")} style={{ color: BLUE, fontWeight: 900, background: "none", border: "none", cursor: "pointer", fontSize: "14px", textDecoration: "underline" }}>
                Back to Sign In
              </button>
            </div>
          ) : (
            <>
              {/* Google button — only on signin/signup, not reset */}
              {mode !== "reset" && (
                <>
                  <button
                    onClick={handleGoogle}
                    disabled={loading}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                      padding: "13px", borderRadius: "8px", cursor: loading ? "default" : "pointer",
                      border: `2px solid #ddd`, background: "#fff",
                      fontWeight: 900, fontSize: "15px", fontFamily: "inherit",
                      color: "#333", transition: "background 0.15s",
                      opacity: loading ? 0.6 : 1,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f5f5"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                  >
                    {/* Google G icon */}
                    <svg width="20" height="20" viewBox="0 0 48 48">
                      <path fill="#4285F4" d="M47.5 24.6c0-1.6-.1-3.1-.4-4.6H24v8.7h13.2c-.6 3-2.4 5.6-5 7.3v6h8.1c4.7-4.4 7.2-10.8 7.2-17.4z"/>
                      <path fill="#34A853" d="M24 48c6.5 0 12-2.2 16-5.9l-8.1-6c-2.2 1.5-5 2.4-7.9 2.4-6.1 0-11.2-4.1-13-9.6H2.7v6.2C6.7 42.8 14.8 48 24 48z"/>
                      <path fill="#FBBC05" d="M11 28.9c-.5-1.5-.8-3-.8-4.9s.3-3.4.8-4.9v-6.2H2.7C1 16.4 0 20.1 0 24s1 7.6 2.7 11.1L11 28.9z"/>
                      <path fill="#EA4335" d="M24 9.5c3.4 0 6.5 1.2 8.9 3.5l6.6-6.6C35.9 2.2 30.4 0 24 0 14.8 0 6.7 5.2 2.7 12.9l8.3 6.2C12.8 13.6 17.9 9.5 24 9.5z"/>
                    </svg>
                    Continue with Google
                  </button>

                  {/* Divider */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "18px 0" }}>
                    <div style={{ flex: 1, height: "1px", background: "#eee" }} />
                    <span style={{ fontSize: "12px", fontWeight: 900, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em" }}>or</span>
                    <div style={{ flex: 1, height: "1px", background: "#eee" }} />
                  </div>
                </>
              )}

              {/* Email/password form */}
              <form onSubmit={handleEmailSubmit}>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address" required autoComplete="email"
                  style={inputStyle}
                  onFocus={(e) => { e.target.style.borderColor = BLUE; }}
                  onBlur={(e) => { e.target.style.borderColor = "#ddd"; }}
                />
                {mode !== "reset" && (
                  <input
                    type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password" required autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    style={inputStyle}
                    onFocus={(e) => { e.target.style.borderColor = BLUE; }}
                    onBlur={(e) => { e.target.style.borderColor = "#ddd"; }}
                  />
                )}
                {mode === "signup" && (
                  <input
                    type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password" required autoComplete="new-password"
                    style={{ ...inputStyle, marginBottom: "6px" }}
                    onFocus={(e) => { e.target.style.borderColor = BLUE; }}
                    onBlur={(e) => { e.target.style.borderColor = "#ddd"; }}
                  />
                )}

                {error && (
                  <div style={{ color: "#c0392b", fontSize: "13px", fontWeight: 700, marginBottom: "10px", padding: "8px 12px", background: "#fef0ee", borderRadius: "6px", border: "1px solid #f5c6c0" }}>
                    {error}
                  </div>
                )}

                {mode === "signin" && (
                  <div style={{ textAlign: "right", marginBottom: "12px", marginTop: "-4px" }}>
                    <button type="button" onClick={() => switchMode("reset")} style={{ background: "none", border: "none", color: BLUE, fontWeight: 700, fontSize: "13px", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: "100%", padding: "13px", borderRadius: "8px",
                    background: BLUE, color: "#fff",
                    border: `2px solid ${GOLD}`,
                    fontWeight: 900, fontSize: "15px", fontFamily: "inherit",
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? "Please wait..." : mode === "signin" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Link"}
                </button>
              </form>

              {/* Mode switcher */}
              <div style={{ textAlign: "center", marginTop: "18px", fontSize: "13px", fontWeight: 700, color: "#888" }}>
                {mode === "signin" ? (
                  <>Don't have an account?{" "}
                    <button onClick={() => switchMode("signup")} style={{ background: "none", border: "none", color: BLUE, fontWeight: 900, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: "13px" }}>
                      Create one
                    </button>
                  </>
                ) : (
                  <>Already have an account?{" "}
                    <button onClick={() => switchMode("signin")} style={{ background: "none", border: "none", color: BLUE, fontWeight: 900, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: "13px" }}>
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {mode === "reset" && !resetSent && (
            <div style={{ textAlign: "center", marginTop: "14px" }}>
              <button onClick={() => switchMode("signin")} style={{ background: "none", border: "none", color: "#aaa", fontWeight: 700, fontSize: "13px", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>
                Back to Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
