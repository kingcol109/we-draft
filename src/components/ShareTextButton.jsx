// src/components/ShareTextButton.jsx
//
// Share as a message, not an image: the player page's Share (in the hero
// toolbar, where Like was) and Share Evaluation (PlayerProfile.js) — the
// text is a few lines about the player, ending with the page's link.
// Phones get the system share sheet (Messages, WhatsApp…) with that text;
// elsewhere a dialog showing the caller's card of it (preview — the text
// itself isn't shown), then Copy, Text and Email. The button's
// look is the caller's (style / className); this only adds the behavior.
import { useState } from "react";

// A phone or tablet: its share sheet is the way to send a message.
const touchShare = () => typeof navigator !== "undefined" && !!navigator.share
  && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

// text: the whole message, link last; preview: what the dialog shows of it;
// subject: the email's subject and the dialog's heading; color: the
// dialog's accent.
export default function ShareTextButton({ text, preview, subject, color = "#0055a5", style, className, title, children }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    if (touchShare()) {
      try { await navigator.share({ text }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    setOpen(true);
  };
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  const shareBtn = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", border: `2px solid ${color}`, borderRadius: 8, padding: 10, color, fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "pointer", fontFamily: "inherit" };

  return (
    <>
      <button onClick={onClick} title={title} className={className} style={style}>{children}</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div role="dialog" aria-label={subject} onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: `2px solid ${color}`, borderRadius: 16, maxWidth: 460, width: "100%", maxHeight: "calc(90vh / var(--pz, 1))", overflowY: "auto", padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.5)", textAlign: "left" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ color, fontWeight: 900, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>{subject}</div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "#999", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ marginBottom: 14, fontWeight: 400, textTransform: "none", letterSpacing: "normal" }}>{preview}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <button onClick={copy} style={{ ...shareBtn, background: color, color: "#fff" }}>{copied ? "✓ Copied" : "📋 Copy"}</button>
              <a href={`sms:?&body=${encodeURIComponent(text)}`} style={shareBtn}>💬 Text</a>
              <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`} style={shareBtn}>📧 Email</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
