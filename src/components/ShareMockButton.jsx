// src/components/ShareMockButton.jsx
//
// "Share Mock Draft" — same share-modal pattern as WePickHub.js's Share
// Picks/Report Card buttons and PlayerProfile.js's Share Evaluation button:
// build a branded image first, show it in a preview dialog, then offer
// Email/X/Text/Save Image from there, instead of firing the native share
// sheet (or downloading a file) the instant the button's clicked.
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
import Logo1 from "../assets/Logo1.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function ShareMockButton({
  mockName, ownerLabel, roundLabel, totalRounds, visibility, picks, teams, filenamePrefix,
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
    const teamColor1 = team?.Color1 || BLUE;
    const teamColor2 = team?.Color2 || GOLD;
    const teamName = team ? `${team.City} ${team.Team}` : p.currentTeam;
    return { ...p, teamColor1, teamColor2, teamName };
  });

  // The card image caps how many picks it actually draws — a full round's
  // worth stacked one-per-line (the original design) made for a tall,
  // narrow strip that looked like a grocery receipt rather than something
  // meant for Instagram/X. 4 columns × 8 rows = a full 32-team round at
  // most, keeping the image roughly as wide as it is tall regardless of
  // round size. The text share (email/X/SMS body) below still lists every
  // pick — this cap only affects the drawn image.
  const GRID_CAP = 32;
  const gridRows = rows.slice(0, GRID_CAP);
  const hiddenCount = rows.length - gridRows.length;

  const shareText = [
    `🏈 ${mockName || "My Mock Draft"} — ${roundLabel}`,
    ...rows.filter((r) => r.player).map((r) => `${r.pickNumber}. ${r.teamName} — ${r.player.First} ${r.player.Last} (${r.player.Position})`),
    "we-draft.com/mocks",
  ].join("\n");

  const handleShare = async () => {
    if (!cardRef.current) return;
    try {
      // Text-only capture (IMG nodes skipped) — same reasoning as
      // WePickHub.js's/PlayerProfile.js's own share cards: an externally-
      // hosted team logo can taint the canvas and blank out the whole
      // export, so this card only ever uses flat colors/text, never a
      // logo image, and this filter is just belt-and-suspenders.
      const dataUrl = await htmlToImage.toPng(cardRef.current, {
        pixelRatio: 2, backgroundColor: "#06162c", skipFonts: true,
        filter: (node) => node.tagName !== "IMG",
      });
      setImageUrl(dataUrl);
      setOpen(true);
    } catch (e) {
      alert("Failed to build the share image. Please try again.");
    }
  };

  const handleSaveImage = () => {
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.download = `${filenamePrefix || "WeDraft_MockDraft"}.png`;
    link.href = imageUrl;
    link.click();
  };

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

      {/* ===== Hidden Share Card ===== */}
      <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
        <div ref={cardRef} style={{ width: "640px", background: "linear-gradient(180deg, #06162c, #0d2544)", border: `3px solid ${GOLD}`, borderRadius: "22px", fontFamily: "'Arial Black', Arial, sans-serif", overflow: "hidden" }}>
          <div style={{ padding: "26px 32px 0", textAlign: "center" }}>
            <div style={{ fontSize: "30px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.05em" }}>WE-DRAFT.COM</div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.14em", marginTop: "4px" }}>Mock Draft</div>
          </div>

          <div style={{ padding: "18px 32px 4px", textAlign: "center" }}>
            <div style={{ fontSize: "26px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.02em", textShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>
              {mockName || "Untitled Mock Draft"}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
              <span style={{ display: "inline-block", background: GOLD, color: "#1a1005", fontSize: "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 14px", borderRadius: "20px" }}>
                {roundLabel}
              </span>
              {totalRounds && (
                <span style={{ display: "inline-block", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: "12px", fontWeight: 800, padding: "4px 14px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {totalRounds} Round{totalRounds !== 1 ? "s" : ""}
                </span>
              )}
              {visibility === "public" && (
                <span style={{ display: "inline-block", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", fontSize: "12px", fontWeight: 800, padding: "4px 14px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  🌍 Public
                </span>
              )}
            </div>
            {ownerLabel && (
              <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.55)", marginTop: "10px" }}>
                By <span style={{ color: "#fff", fontWeight: 900 }}>{ownerLabel}</span>
              </div>
            )}
          </div>

          <div style={{ padding: "20px 24px 26px" }}>
            {gridRows.length === 0 ? (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: "14px", fontStyle: "italic", padding: "14px 0" }}>
                No picks made yet.
              </div>
            ) : (
              // A 4-column grid of compact list rows, not centered "chip"
              // cards and not one pick per full-width line either — the
              // latter made for a tall, narrow strip (a "receipt"), not
              // something square enough to actually post. 4×8 covers a
              // full 32-team round.
              //
              // Fill order is column-by-column (pick 1 down the top of
              // column 1, then column 2, etc.) rather than CSS Grid's
              // row-major default — done by giving the grid an explicit
              // row count and `gridAutoFlow: "column"`, which makes it
              // place items down each row-track before wrapping to the
              // next column. An incomplete final round (not a multiple of
              // 4) then leaves gaps in the last COLUMN rather than a
              // half-empty last ROW, and since every column still has the
              // same explicit row count, nothing collapses/short-sizes to
              // cause a row to get clipped by the card's rounded corners.
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: `repeat(${Math.ceil(gridRows.length / 4) || 1}, 1fr)`,
                  gridAutoFlow: "column",
                  gridAutoColumns: "1fr",
                  gap: "6px",
                  justifyContent: "center",
                }}
              >
                {gridRows.map((r) => (
                  <div
                    key={r.pickNumber}
                    style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      background: r.player ? r.teamColor1 : "rgba(255,255,255,0.06)",
                      border: `1px solid ${r.player ? r.teamColor2 : "rgba(255,255,255,0.14)"}`,
                      borderRadius: "6px", padding: "6px 8px",
                    }}
                  >
                    <span style={{ flexShrink: 0, width: "16px", fontSize: "9px", fontWeight: 900, color: "#fff", opacity: 0.75 }}>
                      {r.pickNumber}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "8px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: r.player ? "0 1px 3px rgba(0,0,0,0.3)" : "none" }}>
                        {r.teamName}
                      </div>
                      <div style={{ fontSize: "10px", fontWeight: 900, color: r.player ? "#fff" : "rgba(255,255,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.player ? `${r.player.First} ${r.player.Last}` : "TBD"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hiddenCount > 0 && (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: "12px", fontWeight: 700, marginTop: "12px" }}>
                + {hiddenCount} more pick{hiddenCount !== 1 ? "s" : ""} in this round
              </div>
            )}
          </div>

          <div style={{ height: "3px", background: GOLD }} />
          <div style={{ padding: "16px 28px", textAlign: "center", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
            <img src={Logo1} alt="" style={{ height: "18px", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
            <div style={{ color: GOLD, fontSize: "16px", fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              we-draft.com/mocks
            </div>
          </div>
        </div>
      </div>

      {/* ===== Share Modal ===== */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "16px", maxWidth: "460px", width: "100%", maxHeight: "90vh", overflowY: "auto", padding: "20px", boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ color: BLUE, fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Share Mock Draft</div>
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: "#999", fontSize: "22px", cursor: "pointer", lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid #eee", marginBottom: "16px", background: "#06162c", minHeight: "160px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {imageUrl ? (
                <img src={imageUrl} alt="Mock draft preview" style={{ width: "100%", display: "block" }} />
              ) : (
                <div style={{ padding: "50px 0", color: "#999", fontSize: "13px", fontWeight: 700 }}>Building image…</div>
              )}
            </div>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
              Share to
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <a
                href={`mailto:?subject=${encodeURIComponent(`${mockName || "My Mock Draft"} — We-Draft.com`)}&body=${encodeURIComponent(shareText)}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px", color: BLUE, fontWeight: 800, fontSize: "13px", textDecoration: "none" }}
              >
                📧 Email
              </a>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px", color: BLUE, fontWeight: 800, fontSize: "13px", textDecoration: "none" }}
              >
                𝕏 X
              </a>
              <a
                href={`sms:?&body=${encodeURIComponent(shareText)}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px", color: BLUE, fontWeight: 800, fontSize: "13px", textDecoration: "none" }}
              >
                💬 Text
              </a>
              <button
                onClick={handleSaveImage}
                disabled={!imageUrl}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: BLUE, border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px", color: "#fff", fontWeight: 800, fontSize: "13px", cursor: imageUrl ? "pointer" : "default", opacity: imageUrl ? 1 : 0.6 }}
              >
                💾 Save Image
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
