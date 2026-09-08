// src/pages/WatchPage.jsx
//
// we-draft.com/watch — the fullscreen Shorts feed (WatchFullscreenFeed, see
// PlayerProfile.js) as a standalone destination, not opened from any one
// player's own page. Seeds the feed with the single most recently added
// Short site-wide (any player) and plays that first; WatchFullscreenFeed's
// own "extends itself with more Shorts" effect takes it from there exactly
// like it does when opened via a player's Watch button.
//
// No originPlayer here — there's no "back to the page this opened from" to
// return to, so originPlayerSlug is left at its default (View Full Profile
// always navigates normally, never just closes) and onClose sends the
// visitor back in history (or home, if they landed here directly with
// nothing to go back to).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactDOM from "react-dom";
import { Helmet } from "react-helmet-async";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { WatchFullscreenFeed } from "./PlayerProfile";
import LoadingSpinner from "../components/LoadingSpinner";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function WatchPage() {
  const navigate = useNavigate();
  const [seedClip, setSeedClip] = useState(null); // null = loading, false = nothing to play
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const toMs = (ts) => ts?.toDate?.() ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "videos"), where("Short", "==", true)));
        const rows = snap.docs
          .map((d) => {
            const data = d.data();
            const items = Array.isArray(data.items) ? data.items : [];
            const playerItem = items.find((it) => it.type === "player" && it.playerId) || null;
            return {
              video: data.Video || "",
              date: data.Date || null,
              isDraft: Array.isArray(data.Tags) && data.Tags.includes("Draft"),
              playerId: playerItem?.playerId || "",
              publishAt: data.PublishAt || null,
            };
          })
          // publishAt (AdminPanel.js's "Publish At" scheduling field) hides
          // a Short here until that moment passes, same as everywhere else
          // Shorts are read — see PlayerProfile.js's own copy of this
          // comment for the full reasoning.
          .filter((v) => v.video && v.playerId && (!v.publishAt || toMs(v.publishAt) <= Date.now()))
          .sort((a, b) => toMs(b.date) - toMs(a.date));

        const first = rows[0] || null;
        if (!first) { if (!cancelled) setSeedClip(false); return; }

        const pSnap = await getDocs(query(collection(db, "players"), where(documentId(), "in", [first.playerId])));
        const p = pSnap.docs[0]?.data() || null;
        if (!p?.Slug) { if (!cancelled) setSeedClip(false); return; }

        if (!cancelled) {
          setSeedClip({
            video: first.video,
            isDraft: first.isDraft,
            isOrigin: true, // keeps this player out of their own "Watch Next" recommendations
            gameInfo: null,
            playerId: first.playerId,
            playerName: `${p.First || ""} ${p.Last || ""}`.trim(),
            playerSlug: p.Slug,
            playerPosition: p.Position || "",
            playerSchool: p.School || "",
            playerEligible: p.Eligible || "",
          });
        }
      } catch (e) {
        console.error("WatchPage seed fetch error:", e);
        if (!cancelled) setSeedClip(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Nothing to go "back" to if someone lands here directly (a shared link,
  // typed URL) — history.length of 1 means this tab has no prior page, so
  // send them home instead of navigate(-1) leaving them stuck.
  const handleClose = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <>
      <Helmet>
        <title>Watch — we-draft</title>
        <meta name="description" content="Watch the latest college football Shorts on we-draft." />
      </Helmet>
      {seedClip === null && (
        <div style={{ position: "fixed", inset: 0, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingSpinner label="Loading" size={48} />
        </div>
      )}
      {seedClip === false && (
        <div style={{ position: "fixed", inset: 0, background: "#000", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", padding: "20px", textAlign: "center" }}>
          <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase" }}>Nothing to watch yet</div>
          <button
            onClick={() => navigate("/")}
            style={{ background: SITE_BLUE, color: "#fff", border: `2px solid ${SITE_GOLD}`, borderRadius: "8px", padding: "10px 20px", fontWeight: 900, textTransform: "uppercase", cursor: "pointer" }}
          >
            Back to we-draft
          </button>
        </div>
      )}
      {seedClip && ReactDOM.createPortal(
        <WatchFullscreenFeed
          initialClips={[seedClip]}
          excludeVideoUrls={[seedClip.video]}
          onClose={handleClose}
          color1={SITE_BLUE}
          color2={SITE_GOLD}
          isMobile={isMobile}
        />,
        document.body
      )}
    </>
  );
}
