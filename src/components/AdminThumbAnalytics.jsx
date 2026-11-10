// src/components/AdminThumbAnalytics.jsx
//
// Admin → Videos → Graphics → Thumb Analytics: how the saved thumbnails
// (ytThumbnails — ThumbLibrary.jsx) did on the videos they went up on. Each
// thumbnail's run is the days it was up (to the next thumbnail on the same
// video — utils/youtube/thumbStore.js thumbRuns); its impressions,
// click-through rate, views and watch time (average view duration, % viewed)
// are that video's daily rows over those days
// (ytVideos/{id}/daily, from the YouTube Analytics syncs — impressions and CTR
// from the Reporting API, so they start when its job did). Then the same
// totals grouped by template, headline style, photo and layout, against the
// channel's own CTR over the last 28 days (ytChannelDaily).
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { BLUE, label, btn } from "./SocialMakerKit";
import { loadThumbs, thumbRuns, runTotals, dayOf } from "../utils/youtube/thumbStore";

const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (v) => (v == null ? "—" : Math.round(v).toLocaleString());
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dur = (sec) => (sec == null ? "—" : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`);
const pctOf = (v) => (v == null ? "—" : `${Math.round(v)}%`);
const TEMPLATE_NAMES = { gamereview: "Game Review", icecold: "Ice Cold", portal: "Transfer Portal" };

// A group's totals: CTR weighted by impressions, watch time by views.
function rollup(list) {
  const imp = list.reduce((s, r) => s + (r.t.impressions || 0), 0);
  const clicks = list.reduce((s, r) => s + (r.t.impressions || 0) * (r.t.ctr || 0), 0);
  const views = list.reduce((s, r) => s + (r.t.views || 0), 0);
  const minutes = list.reduce((s, r) => s + (r.t.minutes || 0), 0);
  const pctW = list.filter((r) => r.t.avgViewPct != null);
  const pctViews = pctW.reduce((s, r) => s + (r.t.views || 0), 0);
  return {
    n: list.length, impressions: imp, ctr: imp ? clicks / imp : null, views,
    avgViewSec: views ? (minutes * 60) / views : null,
    avgViewPct: pctViews ? pctW.reduce((s, r) => s + r.t.avgViewPct * (r.t.views || 0), 0) / pctViews : null,
  };
}

const GROUPS = [
  ["Template", (r) => TEMPLATE_NAMES[r.thumb.template] || r.thumb.template],
  ["Headline", (r) => (r.thumb.meta?.question ? "Asks a question" : "No question")],
  ["Headline length", (r) => { const w = r.thumb.meta?.headlineWords || 0; return w <= 3 ? "1–3 words" : w <= 5 ? "4–5 words" : "6+ words"; }],
  ["Photo", (r) => ({ action: "Action shot", headshot: "Headshot", upload: "Uploaded", link: "Linked image", none: "No photo" }[r.thumb.meta?.photoKind] || "—")],
  ["Player", (r) => (r.thumb.template !== "gamereview" ? "—" : r.thumb.meta?.photoBehind ? "Behind the words" : "In front of the words")],
];

export default function AdminThumbAnalytics() {
  const [rows, setRows] = useState(null);
  const [channel, setChannel] = useState(null);
  const [msg, setMsg] = useState("");
  const [sort, setSort] = useState("ctr");
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    let alive = true;
    setRows(null);
    (async () => {
      try {
        const thumbs = await loadThumbs();
        const runs = thumbRuns(thumbs);
        const linked = thumbs.filter((t) => runs[t.id]);
        const perVideo = {};
        linked.forEach((t) => { (perVideo[t.videoId] ||= []).push(t); });
        const out = [];
        await Promise.all(Object.entries(perVideo).map(async ([videoId, list]) => {
          const from = dayOf(Math.min(...list.map((t) => runs[t.id].from)));
          const [vSnap, daily] = await Promise.all([
            getDoc(doc(db, "ytVideos", videoId)),
            getDocs(query(collection(db, "ytVideos", videoId, "daily"), where("date", ">=", from))),
          ]);
          const video = vSnap.exists() ? vSnap.data() : {};
          const days = daily.docs.map((d) => ({ date: d.id, ...d.data() }));
          list.forEach((thumb) => {
            let t = runTotals(days, runs[thumb.id]);
            // The video's only thumbnail, up since it published, but no daily
            // impressions in its run: the video's lifetime reach (it includes
            // a YouTube Studio import, when there is one).
            const pub = video.yt?.publishedAt ? Date.parse(video.yt.publishedAt) : 0;
            const lifetime = !t.impressions && list.length === 1 && video.reach?.impressions && (!pub || runs[thumb.id].from <= pub + 864e5);
            if (lifetime) t = { ...t, impressions: video.reach.impressions, ctr: video.reach.ctr ?? null, lifetime: true };
            // No daily views in its run either: the video's lifetime watch time.
            const life = video.analytics?.lifetime;
            if (!t.views && life?.views && list.length === 1) {
              t = { ...t, views: life.views, minutes: life.minutesWatched || 0, avgViewSec: life.avgViewDurationSec ?? null, avgViewPct: life.avgViewPct ?? null, watchLifetime: true };
            }
            out.push({ thumb, video: { id: videoId, title: video.yt?.title || videoId }, run: runs[thumb.id], t });
          });
        }));
        const since = dayOf(Date.now() - 28 * 864e5);
        const ch = await getDocs(query(collection(db, "ytChannelDaily"), where("date", ">=", since))).catch(() => null);
        const chRows = ch ? ch.docs.map((d) => d.data()) : [];
        const imp = chRows.reduce((s, r) => s + (r.impressions || 0), 0);
        const clicks = chRows.reduce((s, r) => s + (r.impressions || 0) * (r.impressionsCtr || 0), 0);
        if (!alive) return;
        setChannel(imp ? { impressions: imp, ctr: clicks / imp } : null);
        setRows(out);
        if (!thumbs.length) setMsg("No saved thumbnails yet. Save one in the Thumbnail tab and put it on its video.");
        else if (!linked.length) setMsg("None of the saved thumbnails is on a video yet. Open one in the Thumbnail tab and pick the video it went up on.");
        else setMsg("");
      } catch (e) {
        if (alive) { setRows([]); setMsg(`Couldn't load the analytics: ${e.message}`); }
      }
    })();
    return () => { alive = false; };
  }, [stamp]);

  const sorted = useMemo(() => {
    const key = { ctr: (r) => r.t.ctr ?? -1, impressions: (r) => r.t.impressions || 0, views: (r) => r.t.views || 0, watch: (r) => r.t.avgViewSec ?? -1, recent: (r) => r.run.from }[sort];
    return [...(rows || [])].sort((a, b) => key(b) - key(a));
  }, [rows, sort]);
  const vsChannel = (ctr) => (ctr == null || !channel?.ctr ? null : ctr / channel.ctr - 1);
  const th = { textAlign: "left", fontSize: "10px", fontWeight: 900, color: "#7a8597", letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e3e8ef", whiteSpace: "nowrap" };
  const td = { padding: "8px", borderBottom: "1px solid #eef1f5", fontSize: "13px", fontWeight: 700, color: "#1d2433", verticalAlign: "middle" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "13px", fontWeight: 800, color: "#33415a" }}>
          Channel CTR, last 28 days: <b style={{ color: BLUE }}>{channel ? pct(channel.ctr) : "—"}</b>{channel && <span style={{ color: "#8a97ab" }}> on {num(channel.impressions)} impressions</span>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
          {[["ctr", "CTR"], ["impressions", "Impressions"], ["views", "Views"], ["watch", "Watch time"], ["recent", "Newest"]].map(([k, t]) => <button key={k} onClick={() => setSort(k)} style={{ ...btn(sort === k), padding: "4px 10px" }}>{t}</button>)}
          <button onClick={() => setStamp((n) => n + 1)} style={{ ...btn(false), padding: "4px 10px" }}>Refresh</button>
        </div>
      </div>
      {msg && <div style={{ fontSize: "12px", fontWeight: 800, color: "#5b6b84" }}>{msg}</div>}
      {!rows && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>Loading…</div>}

      {rows?.length > 0 && (
        <>
          <div style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: "10px", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Thumbnail", "Video", "Up", "Impressions", "CTR", "vs channel", "Views", "Avg watch", "Avg % viewed"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {sorted.map((r) => {
                  const d = vsChannel(r.t.ctr);
                  return (
                    <tr key={r.thumb.id} data-thumb-row={r.thumb.name}>
                      <td style={{ ...td, minWidth: "250px" }}>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          {r.thumb.thumb && <img src={r.thumb.thumb} alt="" style={{ width: "112px", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: "6px", border: "1px solid #e3e8ef" }} />}
                          <div style={{ minWidth: 0 }}>
                            <div>{r.thumb.name}</div>
                            <div style={{ fontSize: "11px", color: "#8a97ab" }}>{TEMPLATE_NAMES[r.thumb.template] || r.thumb.template}{r.thumb.meta?.headline ? ` · “${r.thumb.meta.headline}”` : ""}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...td, maxWidth: "260px" }}><a href={`https://youtu.be/${r.video.id}`} target="_blank" rel="noreferrer" style={{ color: BLUE }}>{r.video.title}</a></td>
                      <td style={{ ...td, whiteSpace: "nowrap", fontSize: "12px" }}>
                        {fmtDay(dayOf(r.run.from))} – {r.run.to ? fmtDay(dayOf(r.run.to)) : "now"}
                        <div style={{ fontSize: "11px", color: "#8a97ab" }}>{r.t.lifetime ? "video lifetime" : `${r.t.reachDays} day${r.t.reachDays === 1 ? "" : "s"} with impressions`}</div>
                      </td>
                      <td style={td}>{num(r.t.impressions)}</td>
                      <td style={{ ...td, color: BLUE, fontWeight: 900 }}>{pct(r.t.ctr)}</td>
                      <td style={{ ...td, color: d == null ? "#8a97ab" : d >= 0 ? "#15803d" : "#a52a1e" }}>{d == null ? "—" : `${d >= 0 ? "+" : ""}${Math.round(d * 100)}%`}</td>
                      <td style={td}>{num(r.t.views)}</td>
                      <td style={td} title={r.t.watchLifetime ? "The video's lifetime" : undefined}>{dur(r.t.avgViewSec)}{r.t.watchLifetime && <span style={{ color: "#8a97ab", fontSize: "11px" }}> (lifetime)</span>}</td>
                      <td style={td}>{pctOf(r.t.avgViewPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
            {GROUPS.map(([name, keyOf]) => {
              const groups = {};
              rows.forEach((r) => { (groups[keyOf(r)] ||= []).push(r); });
              const list = Object.entries(groups).filter(([k]) => k !== "—").map(([k, v]) => [k, rollup(v)]).sort((a, b) => (b[1].ctr ?? -1) - (a[1].ctr ?? -1));
              if (!list.length) return null;
              return (
                <div key={name} style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: "10px", padding: "10px 12px" }}>
                  <div style={label}>{name}</div>
                  {list.map(([k, g]) => (
                    <div key={k} style={{ display: "flex", alignItems: "baseline", gap: "8px", padding: "4px 0", borderTop: "1px solid #f1f4f8", fontSize: "13px", fontWeight: 700 }}>
                      <span style={{ flex: 1 }}>{k} <span style={{ color: "#8a97ab", fontSize: "11px" }}>· {g.n}</span></span>
                      <span style={{ color: BLUE, fontWeight: 900 }}>{pct(g.ctr)}</span>
                      <span style={{ color: "#33415a", fontSize: "11px", width: "44px", textAlign: "right" }} title="Average watch time">{dur(g.avgViewSec)}</span>
                      <span style={{ color: "#8a97ab", fontSize: "11px", width: "80px", textAlign: "right" }}>{num(g.impressions)} impr.</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>
            Average watch is minutes watched ÷ views and % viewed is weighted by views, both over the same days. They say more about the video than the thumbnail, but next to CTR they show whether a thumbnail&apos;s clicks stay to watch. CTR is clicks ÷ impressions over each thumbnail&apos;s own days, from YouTube Analytics&apos; daily rows (run Sync Historical Data there to bring them up to date). Impressions start when the Reporting API&apos;s job did; a thumbnail that was up before then counts only the days since.
          </div>
        </>
      )}
    </div>
  );
}
