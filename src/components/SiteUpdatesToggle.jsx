// src/components/SiteUpdatesToggle.jsx
//
// Settings (UserProfile.js) → My Feed: whether site updates
// (utils/siteUpdates.js) show up in the user's feed. On unless turned off;
// saved to users/{uid}.feedSiteUpdates and folded into the loaded profile
// so the feed follows right away.
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { setSiteUpdatesInFeed, siteUpdatesInFeed } from "../utils/siteUpdates";

const BLUE = "#0055a5";

export default function SiteUpdatesToggle() {
  const { user, profile, patchProfile } = useAuth();
  const on = siteUpdatesInFeed(profile);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!user) return null;

  const flip = async () => {
    const next = !on;
    setBusy(true);
    setFailed(false);
    patchProfile({ feedSiteUpdates: next });
    try {
      await setSiteUpdatesInFeed(user.uid, next);
    } catch (e) {
      console.error("Site updates setting:", e);
      patchProfile({ feedSiteUpdates: on });
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: "18px" }}>
      <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: BLUE, marginBottom: "8px" }}>My Feed</div>
      <button type="button" role="switch" aria-checked={on} onClick={flip} disabled={busy}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left", background: "#f5f7fb", border: "2px solid #eee", borderRadius: "10px", padding: "12px 14px", cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: "14px", fontWeight: 900, color: "#222" }}>Site updates</span>
          <span style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#888", fontFamily: "Arial, sans-serif", marginTop: "2px" }}>New features and changes to We-Draft.com, in your feed.</span>
        </span>
        <span aria-hidden="true" style={{ position: "relative", width: "42px", height: "24px", borderRadius: "999px", background: on ? "#22c55e" : "#cbd5e1", flexShrink: 0, transition: "background .18s" }}>
          <span style={{ position: "absolute", top: "3px", left: on ? "21px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .18s" }} />
        </span>
      </button>
      {failed && <p style={{ color: "red", fontSize: "12px", fontWeight: 700, margin: "6px 0 0" }}>Couldn't save that — try again.</p>}
    </div>
  );
}
