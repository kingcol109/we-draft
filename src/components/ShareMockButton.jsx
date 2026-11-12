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
import { renderShareImage } from "../utils/exportImages";
import MockShareCard, { shareRow } from "./MockShareCard";
import ShareSheet, { ShareIcon, ShareImagePreview, shareActions } from "./ShareSheet";

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
      const dataUrl = await renderShareImage(cardRef.current, { pixelRatio: 2, backgroundColor: "#071a33" });
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ShareIcon name="share" size={14} />Share</span>
      </button>

      {/* The share image, drawn off screen. */}
      <div style={{ position: "absolute", left: "-9999px", top: 0 }} aria-hidden="true">
        <MockShareCard ref={cardRef} eyebrow={eyebrow} title={mockName || "Untitled Mock Draft"} byline={ownerLabel} rows={cardRows}
          footer="Build yours at we-draft.com/mocks"
          moreNote={hiddenCount > 0 ? `+ ${hiddenCount} more pick${hiddenCount !== 1 ? "s" : ""} in this round` : null} />
      </div>

      <ShareSheet open={open} onClose={() => setOpen(false)} title="Share mock draft" subtitle={mockName || undefined}
        preview={<ShareImagePreview src={imageUrl} alt="Mock draft preview" aspect={1} />}
        below={mockUrl && isPrivate ? (
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8a5a00", background: "#fff7e6", borderRadius: 12, padding: "9px 12px", marginBottom: 14 }}>
            This mock is private — only you can open the link. Make it public (and save) so others can see it.
          </div>
        ) : null}
        link={mockUrl ? link : undefined}
        primary={[{ label: "Save image", icon: "download", onClick: handleSaveImage, disabled: !imageUrl }]}
        actions={[
          shareActions.text(shareText),
          shareActions.email(`${mockName || "My Mock Draft"} — We-Draft.com`, shareText),
          shareActions.x(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🏈 ${mockName || "My Mock Draft"} — ${roundLabel}`)}&url=${encodeURIComponent(link)}`),
        ]}
        note="Save the image, then attach it to your post or message." />
    </>
  );
}
