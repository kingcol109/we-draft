// src/components/DraftSideRails.jsx
//
// In-flow side columns for draft landing pages (DraftOrderPage.jsx): the
// Community Board's top prospects on the left (with school logos), the
// newest Draft-tagged videos on the right — the player pages' own Videos
// card (PlayerSidebars.js), so the two look identical.
// They sit in columns beside the centered page — not the fixed gutter
// cards MarginSidebars.js uses — so the margin ads (MarginAds.js) can take
// the far outer edges, same arrangement as the player and team pages.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { topProspects } from "../utils/communityGrades";
import { PlayerVideosCard } from "./PlayerSidebars";
import { useSchoolLogos } from "./DraftArchiveList";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const PROSPECTS_SHOWN = 15;
// Draft-tagged videos fetched (the card shows 6, "Show More" adds 3) —
// a few extra to cover Shorts / scheduled ones filtered out below.
const VIDEOS_SHOWN = 6;
const VIDEO_FETCH = 12;
// Fallback scan when the Tags + Date index isn't deployed yet
// (firestore.indexes.json): the newest videos, filtered to Draft here.
const VIDEO_SCAN = 30;

const shell = { background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2" };
const toMs = (ts) => (ts?.toDate ? ts.toDate().getTime() : ts ? Date.parse(ts) || 0 : 0);

function Header({ title, to }) {
  return (
    <>
      <div style={{ background: BLUE, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: GOLD, fontWeight: 900, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>{title}</span>
        {to && <Link to={to} style={{ color: "#fff", fontSize: 10, fontWeight: 800, textDecoration: "underline" }}>All →</Link>}
      </div>
      <div style={{ height: 3, background: GOLD }} />
    </>
  );
}

// Top prospects in a class by community grade (compSnapshots/_top — one
// read), each with their school's logo; the top three get gold rank badges.
export function TopProspectsRail({ year }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let cancelled = false;
    topProspects([String(year)]).then((r) => { if (!cancelled) setRows((r || []).slice(0, PROSPECTS_SHOWN)); }).catch(() => setRows([]));
    return () => { cancelled = true; };
  }, [year]);
  const logos = useSchoolLogos((rows || []).map((p) => p.School));
  if (!rows?.length) return null;
  return (
    <aside style={shell}>
      <Header title={`Top ${year} Prospects`} to={`/community${String(year) === "2027" ? "" : `/${year}`}`} />
      {rows.map((p, i) => {
        const podium = i < 3;
        return (
          <Link key={p.id} to={`/player/${p.Slug}`} className="wd-rail-prospect"
            style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderTop: i ? "1px solid #f0f2f5" : "none", textDecoration: "none", background: podium ? "#fffaf0" : "#fff" }}>
            <span style={{
              width: 22, height: 22, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 900, fontVariantNumeric: "tabular-nums",
              background: podium ? GOLD : "#eef1f5", color: podium ? "#fff" : "#7a8597",
            }}>
              {i + 1}
            </span>
            <span style={{ width: 30, height: 30, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {logos[p.School] && <img src={logos[p.School]} alt={p.School} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {/* Wraps rather than cutting long names off. */}
              <span style={{ display: "block", fontSize: 12, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.01em", lineHeight: 1.2, overflowWrap: "anywhere" }}>{p.First} {p.Last}</span>
              <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#7a8597", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <b style={{ color: BLUE }}>{p.Position}</b>{p.School ? ` · ${p.School}` : ""}
              </span>
            </span>
          </Link>
        );
      })}
      <style>{".wd-rail-prospect:hover { background: #f0f5ff !important; }"}</style>
    </aside>
  );
}

// The newest Draft-tagged long-form videos (no Shorts or scheduled ones), in
// the player pages' Videos card. One small indexed query; a wider scan of
// the newest videos if the index isn't deployed yet.
// playerIds (a team's Weekly Mock page — its drafted players): their own
// videos first, newest first — any tag but Recruiting (CFB ones count),
// each with that player's own title / thumb — then the Draft ones fill out
// the card. One videos query per 30 players (array-contains-any's cap).
const live = (x) => !!x.Video && x.Short !== true && (!x.PublishAt || toMs(x.PublishAt) <= Date.now());
const toCard = (d) => {
  const x = d.data();
  const first = Array.isArray(x.items) ? x.items[0] : null;
  return {
    id: d.id, video: x.Video || "", title: x.GenTitle || first?.title || "", thumb: x.GenThumb || first?.thumb || "",
    ok: live(x) && (x.Tags || []).includes("Draft"),
  };
};
async function playerVideos(ids) {
  const idSet = new Set(ids);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map((c) => getDocs(query(collection(db, "videos"), where("playerIds", "array-contains-any", c)))));
  const seen = new Set();
  return snaps.flatMap((s) => s.docs)
    .filter((d) => !seen.has(d.id) && seen.add(d.id))
    .filter((d) => live(d.data()) && !(d.data().Tags || []).includes("Recruiting"))
    .sort((a, b) => toMs(b.data().Date) - toMs(a.data().Date))
    .map((d) => {
      const x = d.data();
      const items = Array.isArray(x.items) ? x.items : [];
      const mine = items.find((it) => idSet.has(it.playerId)) || items[0] || null;
      return { id: d.id, video: x.Video || "", title: mine?.title || x.GenTitle || "", thumb: mine?.thumb || x.GenThumb || "" };
    });
}
export function RecentVideosRail({ playerIds = null }) {
  const [videos, setVideos] = useState(null);
  const key = (playerIds || []).join(",");
  useEffect(() => {
    let cancelled = false;
    const draft = getDocs(query(collection(db, "videos"), where("Tags", "array-contains", "Draft"), orderBy("Date", "desc"), limit(VIDEO_FETCH)))
      .catch(() => getDocs(query(collection(db, "videos"), orderBy("Date", "desc"), limit(VIDEO_SCAN))))
      .then((snap) => snap.docs.map(toCard).filter((v) => v.ok))
      .catch(() => []);
    const theirs = key ? playerVideos(key.split(",")).catch(() => []) : Promise.resolve([]);
    Promise.all([theirs, draft]).then(([own, generic]) => {
      if (cancelled) return;
      const ownIds = new Set(own.map((v) => v.id));
      setVideos([...own, ...generic.filter((v) => !ownIds.has(v.id))].slice(0, Math.max(VIDEO_FETCH, own.length)));
    });
    return () => { cancelled = true; };
  }, [key]);
  if (!videos?.length) return null;
  return <PlayerVideosCard videos={videos} initialCount={VIDEOS_SHOWN} />;
}
