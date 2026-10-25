// src/components/ShareMockButton.jsx
//
// "Share Mock Draft" — same share-modal pattern as WePickHub.js's Share
// Picks/Report Card buttons and PlayerProfile.js's Share Evaluation button:
// build a branded image first, show it in a preview dialog, then offer
// Email/X/Text/Save Image/Copy Link from there, instead of firing the
// native share sheet (or downloading a file) the instant the button's
// clicked. The image is MockShareCard.jsx; the text and the link point at
// the mock's own page (mockUrl — /mocks/{id}/view), which only opens for
// others once the mock's public, so a private one says so.
//
// Used from both CreateMock.jsx (the editor, for the owner's own in-
// progress mock) and ViewMock.js (the read-only viewer) — each of those
// pages has picks/players in a different shape (editor: separate `picks`
// array + `assignedPlayers` map; viewer: a saved mock's `picks` map with
// `.selection` already embedded), so this component takes an already-
// normalized `picks` array rather than reaching into either page's own
// state shape itself. Callers are expected to only render this for the
// mock's own owner — it doesn't check ownership itself, since "own mocks
// only" already gates which pages/branches render it at all.
import { useRef, useState } from "react";
import * as htmlToImage from "html-to-image";
import { withoutPageZoom } from "../utils/pageZoom";
import MockShareCard, { shareRow } from "./MockShareCard";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// The image holds a full 32-pick round; the text lists every pick.
const GRID_CAP = 32;

export default function ShareMockButton({
  mockName, ownerLabel, roundLabel, totalRounds, visibility, picks, teams, filenamePrefix, draftClass, mockUrl,
  // "dark" (default) matches ViewMock.js's dark hero background — a
  // translucent-white outline button. CreateMock.jsx's editor toolbar sits
  // on a plain white page instead, so it passes variant="light" for a
  // blue-outlined button that's actually visible there.
  variant = "dark",
}) {
  const cardRef = useRef(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const rows = (picks || []).map((p) => {
    const team = teams?.[p.currentTeam];
    return { ...p, teamName: team ? `${team.City} ${team.Team}` : p.currentTeam };
  });
  const cardRows = rows.slice(0, GRID_CAP).map((r) => shareRow(teams, { pickNumber: r.pickNumber, team: r.currentTeam, player: r.player, via: r.tradedFrom }));
  const hiddenCount = rows.length - cardRows.length;
  const link = mockUrl || "https://we-draft.com/mocks";
  const isPrivate = visibility !== "public";

  const shareText = [
    `🏈 ${mockName || "My Mock Draft"} — ${roundLabel}`,
    "",
    ...rows.filter((r) => r.player).map((r) => `${r.pickNumber}. ${r.teamName} — ${r.player.First} ${r.player.Last}, ${r.player.Position}${r.player.School ? `, ${r.player.School}` : ""}`),
    "",
    `Full mock: ${link}`,
  ].join("\n");

  const handleShare = async () => {
    if (!cardRef.current) return;
    try {
      const dataUrl = await withoutPageZoom(() => htmlToImage.toPng(cardRef.current, {
        pixelRatio: 2, backgroundColor: "#071a33", skipFonts: true,
        filter: (node) => node.tagName !== "IMG",
      }));
      setImageUrl(dataUrl);
      setOpen(true);
    } catch (e) {
      alert("Failed to build the share image. Please try again.");
    }
  };

  const handleSaveImage = () => {
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.download = `${filenamePrefix || "WeDraft_MockDraft"}.png`;
    a.href = imageUrl;
    a.click();
  };
  const copyLink = () => {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  const shareBtn = { display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px", color: BLUE, fontWeight: 800, fontSize: "13px", textDecoration: "none", cursor: "pointer", fontFamily: "inherit" };
  const eyebrow = [draftClass && `${draftClass} NFL MOCK DRAFT`, roundLabel?.toUpperCase(), totalRounds > 1 ? `${totalRounds} ROUNDS` : null].filter(Boolean).join(" · ");

  return (
    <>
      <button
        onClick={handleShare}
        style={variant === "light" ? {
          background: "#fff", color: BLUE, border: `2px solid ${GOLD}`, borderRadius: "8px",
          padding: "7px 14px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase",
          letterSpacing: "0.04em", cursor: "pointer",
        } : {
          background: "rgba(255,255,255,0.12)", color: "#fff", border: "2px solid #fff", borderRadius: "8px",
          padding: "8px 18px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase",
          letterSpacing: "0.04em", cursor: "pointer",
        }}
      >
        🔗 Share
      </button>

      {/* The share image, drawn off screen. */}
      <div style={{ position: "absolute", left: "-9999px", top: 0 }} aria-hidden="true">
        <MockShareCard ref={cardRef} eyebrow={eyebrow} title={mockName || "Untitled Mock Draft"} byline={ownerLabel} rows={cardRows}
          footer="Build yours at we-draft.com/mocks"
          moreNote={hiddenCount > 0 ? `+ ${hiddenCount} more pick${hiddenCount !== 1 ? "s" : ""} in this round` : null} />
      </div>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "16px", maxWidth: "480px", width: "100%", maxHeight: "calc(90vh / var(--pz, 1))", overflowY: "auto", padding: "20px", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ color: BLUE, fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Share Mock Draft</div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "#999", fontSize: "22px", cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid #eee", marginBottom: "14px", background: "#071a33" }}>
              {imageUrl && <img src={imageUrl} alt="Mock draft preview" style={{ width: "100%", display: "block" }} />}
            </div>
            {mockUrl && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f4f6fa", border: "1px solid #d8dee8", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: "#3b4756", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{link.replace(/^https?:\/\//, "")}</span>
                <button onClick={copyLink} style={{ border: "none", background: BLUE, color: "#fff", borderRadius: 6, padding: "5px 10px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{copied ? "✓ Copied" : "Copy Link"}</button>
              </div>
            )}
            {mockUrl && isPrivate && (
              <div style={{ fontSize: 12, fontWeight: 700, color: "#8a5a00", background: "#fff7e6", border: "1px solid #f3d9a4", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
                This mock is private — only you can open the link. Make it public (and save) so others can see it.
              </div>
            )}
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", margin: "4px 0 8px" }}>Share to</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <a href={`mailto:?subject=${encodeURIComponent(`${mockName || "My Mock Draft"} — We-Draft.com`)}&body=${encodeURIComponent(shareText)}`} style={shareBtn}>📧 Email</a>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🏈 ${mockName || "My Mock Draft"} — ${roundLabel}`)}&url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer" style={shareBtn}>𝕏 X</a>
              <a href={`sms:?&body=${encodeURIComponent(shareText)}`} style={shareBtn}>💬 Text</a>
              <button onClick={handleSaveImage} disabled={!imageUrl} style={{ ...shareBtn, background: BLUE, color: "#fff", opacity: imageUrl ? 1 : 0.6 }}>💾 Save Image</button>
            </div>
            <div style={{ color: "#888", fontSize: 11, marginTop: 10 }}>Save the image, then attach it to your post or message.</div>
          </div>
        </div>
      )}
    </>
  );
}
