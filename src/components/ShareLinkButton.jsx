// src/components/ShareLinkButton.jsx
//
// The Weekly Mock's Share (ViewMock.js's class page, WeeklyTeamMock.jsx's
// team pages): sends the page's link, not the picks — the link's own
// preview (og:image, api/mock-og.js) carries the picture, so a text shows
// the mock's card under it. Phones get the system share sheet (Messages,
// WhatsApp…) with just the title and link; elsewhere a dialog with the
// link, Copy Link, Text, Email, X and Facebook — no image of its own. The
// user mocks' Share (ShareMockButton.jsx) still builds its own image.
import { useState } from "react";

const BLUE = "#0055a5";

// A phone or tablet: its share sheet is the way to text a link.
const touchShare = () => typeof navigator !== "undefined" && !!navigator.share
  && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

// url: the page's canonical address; title: what the dialog and the email
// subject call it; ink / bg: the header's text and background colors (an
// outline in ink).
export default function ShareLinkButton({ url, title, ink = "#fff", bg = BLUE, isMobile }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    if (touchShare()) {
      try { await navigator.share({ title, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    setOpen(true);
  };
  const copyLink = () => {
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  const shareBtn = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 8, padding: 10, color: BLUE, fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "pointer", fontFamily: "inherit" };

  return (
    <>
      <button onClick={onClick} style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "transparent", color: ink,
        border: `2px solid ${ink}`, borderRadius: 999, padding: isMobile ? "6px 14px" : "7px 18px", fontSize: isMobile ? 11 : 12,
        fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
      }} onMouseEnter={(e) => { e.currentTarget.style.background = ink; e.currentTarget.style.color = bg; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = ink; }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" />
        </svg>
        Share
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 16, maxWidth: 480, width: "100%", maxHeight: "calc(90vh / var(--pz, 1))", overflowY: "auto", padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.5)", textAlign: "left", color: "#2a313d" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ color: BLUE, fontWeight: 900, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>Share Mock Draft</div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "#999", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f4f6fa", border: "1px solid #d8dee8", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: "#3b4756", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url.replace(/^https?:\/\//, "")}</span>
              <button onClick={copyLink} style={{ border: "none", background: BLUE, color: "#fff", borderRadius: 6, padding: "5px 10px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{copied ? "✓ Copied" : "Copy Link"}</button>
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", margin: "4px 0 8px" }}>Share to</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <a href={`sms:?&body=${encodeURIComponent(url)}`} style={shareBtn}>💬 Text</a>
              <a href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n\n${url}`)}`} style={shareBtn}>📧 Email</a>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" style={shareBtn}>𝕏 X</a>
              <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" style={shareBtn}>Facebook</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
