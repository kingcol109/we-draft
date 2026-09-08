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
import { WatchFullscreenFeed, loadYouTubeIframeApi } from "./PlayerProfile";
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

  // Kicked off immediately, in parallel with the Firestore fetch below, not
  // awaited here — this is what WatchFullscreenFeed's own player-creation
  // effect will also call once it mounts, but by then this external script
  // (https://www.youtube.com/iframe_api) is either already loaded or
  // already in flight either way, since loadYouTubeIframeApi caches the one
  // promise on window.__wdYouTubeApiPromise. Opened from a player page this
  // cost is invisible because the visitor's already been on the site for a
  // while by the time they click Watch; landing straight on /watch has
  // nothing else competing for that time, so starting it here instead of
  // only after both Firestore round trips resolve measurably shortens time
  // to first frame.
  useEffect(() => { loadYouTubeIframeApi(); }, []);

  useEffect(() => {
    let cancelled = false;
    const toMs = (ts) => ts?.toDate?.() ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0;
    (async () => {
      try {
        const [snap, trendSnap] = await Promise.all([
          getDocs(query(collection(db, "videos"), where("Short", "==", true))),
          // Same trend-priority WatchFullscreenFeed's own feed-extension
          // fetch uses (see PlayerProfile.js's copy of this comment) — the
          // very first thing /watch plays should follow the same
          // ordering as everywhere else in the feed: top-5 trending, then
          // trending, then most recent.
          getDocs(collection(db, "trends")),
        ]);
        const trendOrderBySlug = {};
        trendSnap.docs.forEach((d) => {
          const data = d.data();
          if (data.Shown === true) trendOrderBySlug[d.id] = data.Order ?? 0;
        });

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

        // playerSlug isn't known yet at this point (that's the whole reason
        // for the second, player-lookup round trip below) so trend tiering
        // has to key off playerId here instead of slug — trends docs are
        // keyed by slug, so this resolves each row's playerId to its slug
        // first via a batched "in" lookup, same players fetch that already
        // has to happen anyway, just widened to every distinct playerId in
        // `rows` instead of only the single eventual winner.
        const playerIds = [...new Set(rows.map((r) => r.playerId))];
        const idChunks = [];
        for (let i = 0; i < playerIds.length; i += 10) idChunks.push(playerIds.slice(i, i + 10));
        const playerSnaps = await Promise.all(
          idChunks.map((chunk) => getDocs(query(collection(db, "players"), where(documentId(), "in", chunk))))
        );
        const playersById = {};
        playerSnaps.forEach((pSnap) => pSnap.docs.forEach((d) => { playersById[d.id] = d.data(); }));

        const top5Slugs = new Set(
          Object.entries(trendOrderBySlug).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([slug]) => slug)
        );
        const tierOf = (slug) => (top5Slugs.has(slug) ? 0 : slug in trendOrderBySlug ? 1 : 2);
        rows.sort((a, b) => {
          const slugA = playersById[a.playerId]?.Slug || "";
          const slugB = playersById[b.playerId]?.Slug || "";
          const ta = tierOf(slugA), tb = tierOf(slugB);
          if (ta !== tb) return ta - tb;
          return ta === 0 ? trendOrderBySlug[slugA] - trendOrderBySlug[slugB] : 0;
        });

        const first = rows[0] || null;
        if (!first) { if (!cancelled) setSeedClip(false); return; }
        const p = playersById[first.playerId] || null;
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
