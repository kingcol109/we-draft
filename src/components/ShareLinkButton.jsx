// src/components/ShareLinkButton.jsx
//
// The Weekly Mock's Share (ViewMock.js's class page, WeeklyTeamMock.jsx's
// team pages): sends the page's link, not the picks — the link's own
// preview (og:image, api/mock-og.js) carries the picture, so a text shows
// the mock's card under it. Phones get the system share sheet (Messages,
// WhatsApp…) with just the title and link; elsewhere the share sheet
// (ShareSheet.jsx) with the link, Copy, Messages, Email, X and Facebook —
// no image of its own. The
// user mocks' Share (ShareMockButton.jsx) still builds its own image.
import { useState } from "react";
import ShareSheet, { shareActions } from "./ShareSheet";

const BLUE = "#0055a5";

// A phone or tablet: its share sheet is the way to text a link.
const touchShare = () => typeof navigator !== "undefined" && !!navigator.share
  && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

// url: the page's canonical address; title: what the dialog and the email
// subject call it; ink / bg: the header's text and background colors (an
// outline in ink).
export default function ShareLinkButton({ url, title, ink = "#fff", bg = BLUE, isMobile }) {
  const [open, setOpen] = useState(false);

  const onClick = async () => {
    if (touchShare()) {
      try { await navigator.share({ title, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    setOpen(true);
  };

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

      <ShareSheet open={open} onClose={() => setOpen(false)} title="Share mock draft" link={url}
        actions={[
          shareActions.text(url), shareActions.email(title, `${title}

${url}`),
          shareActions.x(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`),
          shareActions.facebook(url),
        ]} />
    </>
  );
}
