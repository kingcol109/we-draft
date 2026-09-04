import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import verifiedBadgeIcon from "../assets/verified.png";

// Module-level, not component state — socials for a given uid are fetched
// at most once per page load no matter how many rows/badges for that same
// person get hovered (a standings board can show the same verified user
// several times across different weeks/scopes).
const socialsCache = new Map(); // uid -> { youtube, x, instagram }

// Handles are stored as whatever the user/admin typed — this strips a
// leading "@" or a pasted full profile URL down to the bare handle before
// building the actual link, so "@handle", "handle", and a full
// youtube.com/@handle-style paste all resolve to the same place.
function toHandle(raw) {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  const afterSlash = trimmed.includes("/") ? trimmed.split("/").pop() : trimmed;
  return afterSlash.replace(/^@/, "");
}

const SOCIAL_PLATFORMS = [
  { key: "youtube", label: "YouTube", icon: "▶", href: (h) => `https://youtube.com/@${toHandle(h)}` },
  { key: "x", label: "X", icon: "𝕏", href: (h) => `https://x.com/${toHandle(h)}` },
  { key: "instagram", label: "Instagram", icon: "📷", href: (h) => `https://instagram.com/${toHandle(h)}` },
];

// ── Verified-only social hover card. Wraps a display name (plus its own
// verified checkmark) so hovering (desktop) or tapping (mobile — there's no
// hover to trigger on touch) shows a small popover linking out to whichever
// of YouTube/X/Instagram this person has added on their own profile
// (UserProfile.js) or had added for them (AdminPanel.js's Users section) —
// both write the same users/{uid}.youtube/x/instagram fields this reads.
// An unverified name renders exactly as it always did (plain text, no
// badge, no popover) — this component is meant to be dropped in anywhere a
// name+VerifiedBadge pair already exists, everywhere in the app, not just a
// single page's own list.
//
// Rendered through a portal straight onto document.body rather than as a
// child of whatever card/row the name sits in — several of those cards
// (PlayerProfile's evaluation cards, GamePage's picks feed rows) clip
// overflowing content with `overflow: hidden`, which was silently eating
// the popover any time the name was near the top of one of those cards (no
// room to open upward before hitting that clip). Position is measured
// against the anchor's real on-screen rect and re-measured against the
// popover's own actual size once it's rendered (useLayoutEffect, before
// paint) so it flips above/below/left/right as needed to always land fully
// on-screen, regardless of how many links are in it or where the name sits
// on the page. ──
export default function VerifiedNameBadge({ uid, name, verified, size = 13, fallback = "Anonymous Fan" }) {
  const [socials, setSocials] = useState(() => socialsCache.get(uid) || null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false); // click/tap-toggled — the only way in on mobile
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(null); // { top, left } — viewport (fixed) coordinates
  const anchorRef = useRef(null);
  const popoverRef = useRef(null);
  const hideTimer = useRef(null);
  const open = hoverOpen || pinnedOpen;

  const ensureSocials = async () => {
    if (!uid) return;
    // Another badge for this same uid elsewhere on the page may have
    // already populated the cache after this one mounted (with socials
    // still null) — pick that up now instead of silently staying empty
    // forever just because this instance's own fetch never ran.
    if (socialsCache.has(uid)) { setSocials(socialsCache.get(uid)); return; }
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const data = snap.exists() ? snap.data() : {};
      const s = { youtube: data.youtube || "", x: data.x || "", instagram: data.instagram || "" };
      socialsCache.set(uid, s);
      setSocials(s);
    } catch (e) {
      console.error("Verified socials fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  // First pass — a reasonable guess (top-left corner, roughly centered
  // under the name using an assumed width) before the popover's own real
  // size is known; the layout effect below corrects it to the popover's
  // actual measured size the instant it renders, before the browser paints
  // — so this guess is never actually visible, just a starting point for
  // that measurement to react to.
  const ASSUMED_WIDTH = 160;
  const guessPosition = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 - ASSUMED_WIDTH / 2 });
  };

  const handleMouseEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    guessPosition();
    setHoverOpen(true);
    ensureSocials();
  };
  // Small delay before actually closing — lets the pointer travel from the
  // name down into the popover itself (to click a link) without it
  // vanishing mid-move.
  const handleMouseLeave = () => {
    hideTimer.current = setTimeout(() => setHoverOpen(false), 150);
  };
  // Tap/click toggles independently of hover — the only way this ever
  // opens on a touch device, where "hover" never fires at all.
  const handleClick = (e) => {
    if (!verified) return;
    e.stopPropagation();
    if (!pinnedOpen) { guessPosition(); ensureSocials(); }
    setPinnedOpen((v) => !v);
  };

  // Closes a pinned (tapped-open) popover on an outside tap/click — hover-
  // opened ones already close themselves via handleMouseLeave.
  useEffect(() => {
    if (!pinnedOpen) return;
    const handleOutside = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setPinnedOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [pinnedOpen]);

  // Second, exact pass — once the popover has actually rendered (still
  // before paint, via useLayoutEffect), clamp/flip it against the real
  // viewport using its own real measured size instead of the ASSUMED_WIDTH
  // guess above. Flips above the name if there's no room below (this is
  // the actual fix for the popover getting clipped/hidden when the name
  // sits near the top of an `overflow: hidden` card — see this file's own
  // top comment), and clamps both axes so it never runs off any edge no
  // matter where the name is on the page.
  useLayoutEffect(() => {
    if (!open || !pos || !popoverRef.current || !anchorRef.current) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const popRect = popoverRef.current.getBoundingClientRect();
    const margin = 8;
    let top = anchorRect.bottom + margin;
    if (top + popRect.height > window.innerHeight - margin) {
      top = anchorRect.top - popRect.height - margin;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - popRect.height - margin));
    let left = anchorRect.left + anchorRect.width / 2 - popRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
    if (Math.abs(left - pos.left) > 1 || Math.abs(top - pos.top) > 1) {
      setPos({ top, left });
    }
  }, [open, pos]);

  const links = socials ? SOCIAL_PLATFORMS.filter((p) => socials[p.key]) : [];
  const showPopover = verified && open && (loading || links.length > 0) && pos;

  return (
    <span
      ref={anchorRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", cursor: verified ? "pointer" : "default" }}
      onMouseEnter={verified ? handleMouseEnter : undefined}
      onMouseLeave={verified ? handleMouseLeave : undefined}
      onClick={handleClick}
    >
      <span>{name || fallback}</span>
      {verified && (
        <img
          src={verifiedBadgeIcon} alt="Verified" title="Verified"
          style={{ width: size, height: size, marginLeft: "5px", flexShrink: 0, verticalAlign: "middle" }}
        />
      )}
      {showPopover && createPortal(
        <div
          ref={popoverRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            position: "fixed", top: pos.top, left: pos.left,
            zIndex: 2000, background: "#06162c", border: "2px solid #f6a21d", borderRadius: "8px",
            padding: "8px 10px", minWidth: "150px", boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
            display: "flex", flexDirection: "column", gap: "6px", whiteSpace: "nowrap",
          }}
        >
          {/* Header — makes it explicit whose links these are, since the
              popover no longer sits pinned directly against the name once
              it's had to flip/shift to stay on-screen. */}
          <div style={{
            display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 900,
            color: "#f6a21d", textTransform: "uppercase", letterSpacing: "0.04em",
            paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.15)",
          }}>
            <span>{name || fallback}</span>
            <img src={verifiedBadgeIcon} alt="" style={{ width: "11px", height: "11px" }} />
          </div>
          {loading ? (
            <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Loading…</span>
          ) : (
            links.map((p) => (
              <a
                key={p.key}
                href={p.href(socials[p.key])}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#fff", textDecoration: "none" }}
              >
                <span>{p.icon}</span>
                <span>{p.label}</span>
              </a>
            ))
          )}
        </div>,
        document.body
      )}
    </span>
  );
}
