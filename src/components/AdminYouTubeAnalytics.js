// src/components/AdminYouTubeAnalytics.js
//
// Admin → YouTube Analytics. Channel and per-video YouTube performance,
// joined to We-Draft's own video records and players. Admin-only: private
// channel analytics are never shown on the public site.
//
//   Connection   OAuth (yt-analytics.readonly, server-side) + which channel
//   Sync         Sync Videos / Sync Analytics / Sync Historical Data, with
//                progress, last success, counts and errors; scheduled sync
//   Summary      tracked videos, current views, last-7-day views, subscribers
//   Videos       sortable/filterable table → detail (daily chart, traffic
//                sources, player tags, add to site)
//   Unassociated videos with no player tags — suggestions, tag, or ignore
//   Research     CTR / watch time / views for any filtered set of videos,
//                grouped (draft class, position, type, tag, month, length)
//   Channel      channel daily views + traffic sources
//
// Data sources, kept apart on screen:
//   PUBLIC     YouTube Data API counts (views/likes/comments) — current as of
//              the last Sync Videos.
//   ANALYTICS  YouTube Analytics/Reporting API — processed per Pacific day,
//              usually 1–3 days behind ("through <date>").
//
// Reads come straight from Firestore (admin read in firestore.rules):
// ytVideos, ytAnalytics/*, ytChannelDaily, ytPlayerStats and the legacy
// videos collection (the editorial record: custom titles/thumbnails and
// player tags win over YouTube's). Every write goes through
// api/youtube-analytics.js.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const RED = "#c0392b";
const GREEN = "#2e9e4f";
const AMBER = "#e0a100";
const MUTED = "#667";
const LINE = "#e3e8ef";

async function api(action, payload = {}) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/youtube-analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error("the YouTube Analytics API isn't deployed here (it runs on the live site, or locally under `vercel dev`).");
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, code: j.code });
  return j;
}

// ── Formatting ──
const ms = (v) => (v?.toMillis ? v.toMillis() : typeof v === "number" ? v : Date.parse(v) || null);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmtNum = (v) => (isNum(v) ? Math.round(v).toLocaleString() : "—");
const fmtCompact = (v) => (!isNum(v) ? "—" : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : Math.round(v).toLocaleString());
const fmtPct = (v, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : "—");
const fmtHours = (min) => (isNum(min) ? (min >= 600 ? `${Math.round(min / 60).toLocaleString()}h` : `${(min / 60).toFixed(1)}h`) : "—");
const fmtDur = (sec) => (isNum(sec) ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "—");
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "—");
const fmtWhen = (t) => (t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
function timeAgo(t) {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const playerName = (p) => (p ? `${p.First || ""} ${p.Last || ""}`.trim() : "Unknown player");
const norm = (s) => ` ${String(s || "").toLowerCase().replace(/['’`.]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

const btn = (color = BLUE, solid = true, disabled = false) => ({
  padding: "8px 14px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${disabled ? "#ccc" : color}`, borderRadius: "8px", cursor: disabled ? "default" : "pointer",
  background: disabled ? "#f2f2f2" : solid ? color : "#fff", color: disabled ? "#aaa" : solid ? "#fff" : color, whiteSpace: "nowrap",
});
const input = { padding: "8px 10px", border: "2px solid #dde3ea", borderRadius: "8px", fontSize: "13px", fontFamily: "Arial, sans-serif", boxSizing: "border-box" };
const label = { fontSize: "11px", fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" };
const card = { border: `2px solid ${LINE}`, borderRadius: "10px", background: "#fff", padding: "16px", marginBottom: "16px" };

function Dot({ color }) {
  return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: color, marginRight: 8, flexShrink: 0 }} />;
}
function SourceTag({ kind }) {
  const s = kind === "public"
    ? { t: "Public", c: "#2e6fb7", tip: "YouTube Data API public count — current as of the last Sync Videos." }
    : { t: "Analytics", c: "#7b5ea7", tip: "YouTube Analytics API — processed per Pacific day, usually 1–3 days behind." };
  return <span title={s.tip} style={{ fontSize: "9px", fontWeight: 900, color: s.c, border: `1px solid ${s.c}`, borderRadius: 10, padding: "1px 6px", textTransform: "uppercase", letterSpacing: "0.05em", marginLeft: 6, verticalAlign: "middle" }}>{s.t}</span>;
}
function Panel({ title, right, children }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ color: BLUE, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>{right}</div>
      </div>
      {children}
    </div>
  );
}

// ── Charts (single series: no legend; hover gives the exact value) ──
function BarChart({ rows, valueKey = "views", height = 160, format = fmtNum, tip }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (!rows.length) return <div style={{ color: "#999", fontSize: 12, fontWeight: 700, padding: "20px 0" }}>No daily data stored yet.</div>;
  const h = hover != null ? rows[hover] : null;
  return (
    <div>
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: rows.length > 120 ? 0 : 2, height, borderBottom: "1px solid #c9d1db", padding: "0 2px" }} onMouseLeave={() => setHover(null)}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, borderTop: "1px dashed #e6eaf0" }} />
        <div style={{ position: "absolute", top: 2, left: 4, fontSize: 10, color: "#99a", fontFamily: "Arial" }}>{format(max)}</div>
        {rows.map((r, i) => {
          const v = Number(r[valueKey]) || 0;
          return (
            <div key={r.date || i} onMouseEnter={() => setHover(i)} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default" }}>
              <div style={{ width: "100%", height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0, background: hover === i ? INK : BLUE, borderRadius: "4px 4px 0 0" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#99a", marginTop: 4, fontFamily: "Arial" }}>
        <span>{fmtDay(rows[0]?.date)}</span>
        <span style={{ fontWeight: 700, color: INK }}>{h ? (tip ? tip(h) : `${fmtDay(h.date)} · ${format(Number(h[valueKey]) || 0)}`) : "Hover a bar for the day's value"}</span>
        <span>{fmtDay(rows[rows.length - 1]?.date)}</span>
      </div>
    </div>
  );
}
const TRAFFIC_LABELS = {
  YT_SEARCH: "YouTube search", SUBSCRIBER: "Browse / subscriptions", RELATED_VIDEO: "Suggested videos", EXT_URL: "External",
  NO_LINK_OTHER: "Direct / unknown", PLAYLIST: "Playlists", YT_CHANNEL: "Channel pages", SHORTS: "Shorts feed", NOTIFICATION: "Notifications",
  YT_OTHER_PAGE: "Other YouTube pages", END_SCREEN: "End screens", ANNOTATION: "Annotations", CAMPAIGN_CARD: "Campaign cards",
  HASHTAGS: "Hashtags", LIVE_REDIRECT: "Live redirect", SOUND_PAGE: "Sound pages", VIDEO_REMIXES: "Remixes", YT_PLAYLIST_PAGE: "Playlist pages",
  ADVERTISING: "Advertising", PRODUCT_PAGE: "Product pages", IMMERSIVE_LIVE: "Immersive live",
};
function HBars({ rows }) {
  const total = rows.reduce((s, r) => s + r.views, 0) || 1;
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.source} title={`${TRAFFIC_LABELS[r.source] || r.source}: ${fmtNum(r.views)} views · ${fmtHours(r.minutesWatched)} watched`} style={{ display: "grid", gridTemplateColumns: "170px 1fr 110px", alignItems: "center", gap: 10, padding: "3px 0", fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{TRAFFIC_LABELS[r.source] || r.source}</span>
          <div style={{ height: 10, background: "#f0f3f7", borderRadius: 5 }}><div style={{ width: `${(r.views / max) * 100}%`, height: "100%", background: BLUE, borderRadius: 5 }} /></div>
          <span style={{ textAlign: "right", color: MUTED, fontFamily: "Arial" }}>{fmtNum(r.views)} · {((r.views / total) * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ title, value, sub, source }) {
  return (
    <div style={{ ...card, marginBottom: 0, padding: "14px 16px" }}>
      <div style={label}>{title}{source && <SourceTag kind={source} />}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: INK, marginTop: 6, fontFamily: "Arial Black, Arial" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Player search ──
function PlayerPicker({ players, exclude = [], onPick, placeholder = "Search players to tag…" }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const t = norm(q).trim();
    if (t.length < 2) return [];
    return players.filter((p) => !exclude.includes(p.id) && norm(`${p.First} ${p.Last} ${p.School || ""}`).includes(t)).slice(0, 8);
  }, [q, players, exclude]);
  return (
    <div style={{ position: "relative" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} style={{ ...input, width: "100%" }} />
      {matches.length > 0 && (
        <div style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, background: "#fff", border: `2px solid ${LINE}`, borderRadius: 8, marginTop: 2, boxShadow: "0 6px 18px rgba(0,0,0,.08)" }}>
          {matches.map((p) => (
            <button key={p.id} type="button" onClick={() => { onPick(p); setQ(""); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", background: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, color: INK }}>
              {playerName(p)} <span style={{ color: MUTED, fontWeight: 400 }}>{[p.Position, p.School, p.Eligible].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ children, onRemove, color = BLUE, title }) {
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 14, background: "#eaf1ff", color, fontSize: 11, fontWeight: 900, margin: "0 4px 4px 0" }}>
      {children}
      {onRemove && <button type="button" onClick={onRemove} aria-label="Remove" style={{ border: "none", background: "transparent", color, cursor: "pointer", fontWeight: 900, padding: 0, fontSize: 12 }}>×</button>}
    </span>
  );
}

// Suggested players for a video: a we-draft.com/player/<slug> link in the
// description (strongest), then the full name in the title or description.
// Suggestions only — nothing is tagged until an admin clicks.
function suggestPlayers(v, nameIndex, bySlug, exclude) {
  const out = new Map();
  const desc = v.yt?.description || "";
  for (const m of desc.matchAll(/we-draft\.com\/player\/([a-z0-9-]+)/gi)) {
    const p = bySlug.get(m[1].toLowerCase());
    if (p) out.set(p.id, { p, score: 100, why: "linked in description" });
  }
  const t = norm(v.yt?.title), d = norm(desc);
  for (const { p, key } of nameIndex) {
    if (out.has(p.id)) continue;
    if (t.includes(key)) out.set(p.id, { p, score: 50, why: "name in title" });
    else if (d.includes(key)) out.set(p.id, { p, score: 20, why: "name in description" });
  }
  return [...out.values()].filter((s) => !exclude.includes(s.p.id)).sort((a, b) => b.score - a.score).slice(0, 6);
}

// ── Sync controls ──
const OPS = [
  { op: "videos", label: "Sync Videos", what: "Uploads, metadata, public views/likes/comments. Matches site videos by YouTube ID." },
  { op: "analytics", label: "Sync Analytics", what: "Processed totals, last 7/28 days, recent daily rows, traffic sources, player rollup." },
  { op: "history", label: "Sync Historical Data", what: "Daily history from each video's publish day + impressions/CTR reports. Continues automatically until done." },
];
const COUNT_LABELS = {
  processed: "processed", new: "new", newUnlinked: "new (not on site)", updated: "updated", linked: "linked to site", newlyLinked: "newly linked",
  unavailable: "unavailable", notInUploads: "not in uploads", snapshots: "snapshots", probed: "Shorts checked", legacyNotOnChannel: "site videos not on this channel",
  legacyUnparsed: "site videos without a YouTube URL", channelDays: "channel days", discovered: "found via analytics", videos: "videos", dailyRows: "daily rows",
  players: "players", videosBackfilled: "videos backfilled", reportsImported: "reach reports imported", reachRows: "reach rows", reportsAvailable: "reach reports available", errors: "errors",
};

function SyncCard({ def, run, locked, busy, onRun }) {
  const r = run || {};
  const running = r.state === "running";
  const p = r.progress;
  const color = running ? AMBER : r.state === "error" ? RED : r.state === "partial" ? AMBER : r.state === "ok" ? GREEN : "#b8c2cf";
  const pct = p?.total ? Math.min(100, Math.round(((p.done || 0) / p.total) * 100)) : null;
  return (
    <div style={{ border: `2px solid ${LINE}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Dot color={color} />
        <div style={{ fontWeight: 900, color: INK, fontSize: 13 }}>{def.label}</div>
        <button style={{ ...btn(BLUE, true, busy || locked), marginLeft: "auto" }} disabled={busy || locked} onClick={onRun}>{running || busy ? "Running…" : "Run"}</button>
      </div>
      <div style={{ fontSize: 11, color: MUTED }}>{def.what}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: INK }}>
        Last success: {r.lastSuccessAt ? `${fmtWhen(r.lastSuccessAt)} (${timeAgo(r.lastSuccessAt)})` : "never"}
        {r.trigger && <span style={{ color: MUTED }}> · last run {r.trigger}</span>}
      </div>
      {running && (
        <div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{p?.step ? `${p.step}${p.total ? ` ${p.done || 0}/${p.total}` : p.found != null ? ` — ${p.found} found` : ""}` : "starting…"}</div>
          <div style={{ height: 6, background: "#f0f3f7", borderRadius: 3 }}><div style={{ width: `${pct ?? 15}%`, height: "100%", background: AMBER, borderRadius: 3, transition: "width .4s" }} /></div>
        </div>
      )}
      {!running && r.counts && Object.keys(r.counts).length > 0 && (
        <div style={{ fontSize: 11, color: INK, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
          {Object.entries(r.counts).map(([k, v]) => <span key={k}><b>{fmtNum(v)}</b> {COUNT_LABELS[k] || k}</span>)}
        </div>
      )}
      {r.message && <div style={{ fontSize: 11, color: r.state === "error" ? RED : MUTED, fontWeight: 700 }}>{r.message}</div>}
      {r.errors?.length > 0 && (
        <details style={{ fontSize: 11, color: RED }}>
          <summary style={{ cursor: "pointer", fontWeight: 900 }}>{r.errors.length} error{r.errors.length === 1 ? "" : "s"}</summary>
          <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// ── Main ──
export default function AdminYouTubeAnalytics() {
  const [status, setStatus] = useState(null);
  const [lock, setLock] = useState(null);
  const [ytVideos, setYtVideos] = useState(null);
  const [legacyById, setLegacyById] = useState(new Map());
  const [players, setPlayers] = useState([]);
  const [recruitsById, setRecruitsById] = useState(new Map());
  const [channelDaily, setChannelDaily] = useState([]);
  const [channelDoc, setChannelDoc] = useState(null);
  const [config, setConfig] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState("videos");
  const [period, setPeriod] = useState(28);
  const [selectedId, setSelectedId] = useState(null);
  const [channelInput, setChannelInput] = useState("");
  const stopHistory = useRef(false);

  const flash = (kind, text) => setBanner({ kind, text });

  // Back from Google's consent screen.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get("yta");
    if (!r) return;
    if (r === "connected") flash(p.get("warn") ? "warn" : "ok", p.get("warn") ? "YouTube connected — but this sign-in can't read the configured channel's analytics. See Connection." : "YouTube connected.");
    else flash("error", `YouTube connection failed: ${p.get("msg") || "unknown error"}`);
    window.history.replaceState(null, "", "/admin?section=youtube");
  }, []);

  useEffect(() => {
    const u1 = onSnapshot(doc(db, "ytAnalytics", "status"), (s) => setStatus(s.data() || {}), (e) => flash("error", `Can't read status: ${e.message}`));
    const u2 = onSnapshot(doc(db, "ytAnalytics", "lock"), (s) => setLock(s.exists() ? s.data() : null), () => {});
    const u3 = onSnapshot(collection(db, "ytVideos"), (s) => setYtVideos(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => flash("error", `Can't read videos: ${e.message}`));
    const u4 = onSnapshot(doc(db, "ytAnalytics", "channel"), (s) => setChannelDoc(s.data() || null), () => {});
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const loadLegacy = useCallback(async () => {
    const s = await getDocs(collection(db, "videos"));
    setLegacyById(new Map(s.docs.map((d) => [d.id, d.data()])));
  }, []);
  const loadRollups = useCallback(async () => {
    const from = addDays(new Date().toISOString().slice(0, 10), -400);
    const cd = await getDocs(query(collection(db, "ytChannelDaily"), where("date", ">=", from)));
    setChannelDaily(cd.docs.map((d) => d.data()).sort((a, b) => (a.date < b.date ? -1 : 1)));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [pl, rc] = await Promise.all([getDocs(collection(db, "players")), getDocs(collection(db, "recruits"))]);
        setPlayers(pl.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First || p.Last).sort((a, b) => (a.Last || "").localeCompare(b.Last || "")));
        setRecruitsById(new Map(rc.docs.map((d) => [d.id, d.data()])));
        await Promise.all([loadLegacy(), loadRollups()]);
      } catch (e) { flash("error", `Load failed: ${e.message}`); }
    })();
    api("config").then(setConfig).catch((e) => setConfig({ error: e.message }));
  }, [loadLegacy, loadRollups]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const bySlug = useMemo(() => new Map(players.filter((p) => p.Slug).map((p) => [p.Slug.toLowerCase(), p])), [players]);
  const nameIndex = useMemo(() => players.filter((p) => p.First && p.Last).map((p) => ({ p, key: norm(`${p.First} ${p.Last}`) })).filter((x) => x.key.trim().length >= 6), [players]);

  // One row per tracked video, joined to its legacy record.
  const rows = useMemo(() => (ytVideos || []).map((v) => {
    const leg = v.legacyDocId ? legacyById.get(v.legacyDocId) : null;
    const items = Array.isArray(leg?.items) ? leg.items : [];
    const customThumb = leg?.GenThumb || items.find((it) => it.thumb)?.thumb || null;
    const ytThumb = v.yt?.thumbnails?.medium || v.yt?.thumbnails?.high || v.yt?.thumbnails?.default || null;
    const playerIds = leg ? (leg.playerIds || []) : (v.playerIds || []);
    const recruitIds = leg ? (leg.recruitIds || []) : [];
    const ignored = v.review?.status === "ignored";
    const tagged = playerIds.map((id) => playersById.get(id)).filter(Boolean);
    return {
      ...v, leg,
      title: (leg && (leg.GenTitle || items[0]?.title)) || v.yt?.title || v.id,
      thumb: customThumb || ytThumb, customThumb: !!customThumb,
      playerIds, recruitIds,
      assoc: ignored ? "ignored" : playerIds.length || recruitIds.length ? "associated" : "unassociated",
      publishedMs: ms(v.yt?.publishedAt),
      // A video tagged with players from several classes/positions belongs to each.
      classes: [...new Set(tagged.map((p) => p.Eligible).filter(Boolean))].sort(),
      positions: [...new Set(tagged.map((p) => p.Position).filter(Boolean))].sort(),
      tags: Array.isArray(leg?.Tags) ? leg.Tags : [],
    };
  }), [ytVideos, legacyById, playersById]);

  const through = status?.analyticsSummary?.through || null;
  const summary = useMemo(() => {
    const views = rows.reduce((s, r) => s + (r.stats?.views || 0), 0);
    const v7 = rows.reduce((s, r) => s + (r.analytics?.last7?.views || 0), 0);
    let gained = null, lost = null, days = 0;
    if (through) {
      const from = addDays(through, -(period - 1));
      const inRange = channelDaily.filter((d) => d.date >= from && d.date <= through && isNum(d.subsGained));
      days = inRange.length;
      gained = inRange.reduce((s, d) => s + d.subsGained, 0);
      lost = inRange.reduce((s, d) => s + (d.subsLost || 0), 0);
    }
    return { views, v7, gained, lost, days };
  }, [rows, channelDaily, through, period]);

  // ── Actions ──
  const runSync = async (op) => {
    setBusy(op);
    stopHistory.current = false;
    try {
      let r = await api("sync", { op });
      let rounds = 1;
      // History backfill runs in time-boxed batches; keep going until done.
      while (op === "history" && r.more && !stopHistory.current && rounds < 60) {
        r = await api("sync", { op });
        rounds++;
      }
      flash(r.state === "partial" ? "warn" : "ok", `${OPS.find((o) => o.op === op).label}: ${r.message || r.state}${r.errors?.length ? ` — ${r.errors.length} error(s), see the card.` : ""}`);
      await Promise.all([loadLegacy(), loadRollups()]);
    } catch (e) {
      flash("error", e.message);
    } finally { setBusy(null); }
  };
  const act = async (fn, okText) => {
    try { const r = await fn(); if (okText) flash("ok", typeof okText === "function" ? okText(r) : okText); return r; } catch (e) { flash("error", e.message); return null; }
  };
  const associate = async (videoId, add = [], remove = []) => {
    const r = await act(() => api("associate", { videoId, add, remove }), null);
    if (r?.where === "site") await loadLegacy();
    return r;
  };

  const conn = status?.connection || {};
  const channel = status?.channel;
  const connected = !!conn.connected && !conn.needsReconnect;
  const anyRunning = !!(lock && lock.expiresAt > Date.now());
  const selected = rows.find((r) => r.id === selectedId) || null;
  const unassoc = rows.filter((r) => r.assoc === "unassociated");

  return (
    <div style={{ fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "'Arial Black', Arial" }}>YouTube Analytics</div>
        <div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>
          Admin only. <SourceTag kind="public" /> counts are current as of the last video sync; <SourceTag kind="analytics" /> numbers are processed by YouTube per Pacific day and usually run 1–3 days behind{through ? ` (currently through ${fmtDay(through)})` : ""}.
        </div>
      </div>

      {banner && (
        <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontWeight: 700, fontSize: 13, display: "flex", gap: 10,
          background: banner.kind === "error" ? "#fdecea" : banner.kind === "warn" ? "#fff6e0" : "#e9f7ee", color: banner.kind === "error" ? RED : banner.kind === "warn" ? "#8a5a00" : GREEN }}>
          <span style={{ flex: 1 }}>{banner.text}</span>
          <button onClick={() => setBanner(null)} style={{ border: "none", background: "transparent", cursor: "pointer", fontWeight: 900, color: "inherit" }}>×</button>
        </div>
      )}

      {/* Connection */}
      <Panel title="Connection" right={
        <>
          {(conn.connected || conn.needsReconnect) && <button style={btn(RED, false, !!busy)} disabled={!!busy} onClick={async () => { if (!window.confirm("Disconnect YouTube Analytics? Stored data stays; syncs stop until you reconnect.")) return; setBusy("conn"); await act(() => api("disconnect"), "Disconnected."); setBusy(null); }}>Disconnect</button>}
          <button style={btn(BLUE, true, !!busy)} disabled={!!busy} onClick={async () => { setBusy("conn"); const r = await act(() => api("connect")); setBusy(null); if (r?.url) window.location.href = r.url; }}>
            {conn.connected ? "Reconnect YouTube" : "Connect YouTube"}
          </button>
        </>
      }>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ fontSize: 13, color: INK }}>
            <div style={{ display: "flex", alignItems: "center", fontWeight: 900, marginBottom: 6 }}>
              <Dot color={connected ? (conn.channelVerified === false ? AMBER : GREEN) : conn.needsReconnect ? RED : "#b8c2cf"} />
              {conn.needsReconnect ? "Authorization expired — reconnect" : connected ? `Connected${conn.tokenSource === "env" ? " (YOUTUBE_REFRESH_TOKEN)" : ""}` : "Not connected"}
            </div>
            {conn.connectedAt && <div style={{ fontSize: 12, color: MUTED }}>Connected {fmtWhen(conn.connectedAt)}</div>}
            {conn.lastError && <div style={{ fontSize: 12, color: RED, fontWeight: 700, marginTop: 6 }}>{conn.lastError}</div>}
            <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
              Scope: <code>yt-analytics.readonly</code> (read-only analytics). On Google's screen, pick the channel (or its Brand Account) whose analytics you want — this is separate from Stream Manager's channel.
            </div>
          </div>
          <div>
            <div style={label}>Channel</div>
            <div style={{ fontSize: 13, fontWeight: 900, color: INK, margin: "6px 0" }}>
              {channel?.title ? `${channel.title}${channel.customUrl ? ` (${channel.customUrl})` : ""}` : status?.channelId || config?.envChannelId || "Not set"}
              {status?.channelId && <span style={{ fontWeight: 400, color: MUTED, fontSize: 11 }}> · {status.channelId}</span>}
              {conn.channelVerified === true && <span style={{ color: GREEN, fontSize: 11 }}> · analytics access verified</span>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={channelInput} onChange={(e) => setChannelInput(e.target.value)} placeholder="@handle, channel URL or UC… ID" style={{ ...input, flex: 1 }} />
              <button style={btn(BLUE, false, !channelInput.trim() || !!busy)} disabled={!channelInput.trim() || !!busy} onClick={async () => {
                setBusy("conn");
                const r = await act(() => api("set-channel", { channel: channelInput.trim() }));
                setBusy(null);
                if (r) { setChannelInput(""); flash(r.verified === false ? "warn" : "ok", r.verified === false ? `Channel set to ${r.channel.title}, but the connected sign-in can't read its analytics.` : `Channel set to ${r.channel.title}.`); }
              }}>Set</button>
            </div>
          </div>
        </div>
        {config && (
          <details style={{ marginTop: 12, fontSize: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 900, color: MUTED }}>Server setup check</summary>
            {config.error ? <div style={{ color: RED, marginTop: 6 }}>{config.error}</div> : (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {[["OAuth client ID", config.clientId], ["OAuth client secret", config.clientSecret], ["YOUTUBE_API_KEY", config.apiKey], ["Token encryption key", config.tokenKey], ["CRON_SECRET (scheduled sync)", config.cronSecret], ["YOUTUBE_REFRESH_TOKEN (optional)", config.envRefreshToken]].map(([k, ok]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center" }}><Dot color={ok ? GREEN : k.includes("optional") ? "#b8c2cf" : RED} />{k}</div>
                ))}
                <div style={{ gridColumn: "1 / -1", color: MUTED }}>Authorized redirect URI for this site: <code>{config.redirectUri}</code></div>
              </div>
            )}
          </details>
        )}
      </Panel>

      {/* Sync */}
      <Panel title="Synchronization" right={
        <>
          {busy === "history" && <button style={btn(RED, false)} onClick={() => { stopHistory.current = true; }}>Stop after this batch</button>}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: INK, cursor: "pointer" }} title="Hourly Vercel Cron: videos every 3h, analytics and history daily. Off by default.">
            <input type="checkbox" checked={!!status?.auto?.enabled} onChange={(e) => act(() => api("set-auto", { enabled: e.target.checked }), e.target.checked ? "Scheduled sync on." : "Scheduled sync off.")} />
            Scheduled sync
          </label>
        </>
      }>
        {anyRunning && <div style={{ fontSize: 12, color: "#8a5a00", fontWeight: 700, marginBottom: 10 }}>A {lock.op} sync ({lock.trigger}) is running — other syncs wait until it finishes.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {OPS.map((d) => <SyncCard key={d.op} def={d} run={status?.sync?.[d.op]} locked={anyRunning || !!busy} busy={busy === d.op} onRun={() => runSync(d.op)} />)}
        </div>
        {status?.videosSummary?.legacyNotOnChannelCount > 0 && (
          <div style={{ fontSize: 11, color: MUTED, marginTop: 10 }}>
            {status.videosSummary.legacyNotOnChannelCount} site video{status.videosSummary.legacyNotOnChannelCount === 1 ? "" : "s"} link to YouTube videos that aren't public uploads of this channel (another channel, private, or deleted) — they stay on the site unchanged; analytics only covers this channel's videos.
          </div>
        )}
        {status?.backfill?.total > 0 && (
          <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>History backfill: {status.backfill.done}/{status.backfill.total} videos{status.backfill.remaining ? ` — ${status.backfill.remaining} left` : " — complete"}.</div>
        )}
      </Panel>

      {/* Summary */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={label}>Period for subscribers</div>
        {[7, 28, 90, 365].map((d) => <button key={d} onClick={() => setPeriod(d)} style={{ ...btn(BLUE, period === d), padding: "4px 10px", fontSize: 11 }}>{d}d</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Stat title="Tracked videos" value={ytVideos ? fmtNum(rows.length) : "…"} sub={`${rows.filter((r) => r.legacyDocId).length} on the site · ${unassoc.length} unassociated`} />
        <Stat title="Total current views" source="public" value={fmtCompact(summary.views)} sub="Sum of public view counts" />
        <Stat title="Views, last 7 days" source="analytics" value={through ? fmtCompact(summary.v7) : "—"} sub={through ? `${fmtDay(addDays(through, -6))} – ${fmtDay(through)} (Pacific)` : "Run Sync Analytics"} />
        <Stat title={`Subscribers, ${period}d`} source="analytics" value={summary.gained == null ? "—" : `+${fmtNum(summary.gained)}`}
          sub={summary.gained == null ? "Run Sync Analytics" : `−${fmtNum(summary.lost)} lost · net ${fmtNum(summary.gained - summary.lost)} · ${summary.days} of ${period} days reported`} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[["videos", "Videos"], ["unassociated", `Unassociated (${unassoc.length})`], ["research", "Research"], ["channel", "Channel"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...btn(BLUE, tab === k), borderRadius: 20 }}>{l}</button>
        ))}
      </div>

      {ytVideos == null ? <div style={{ color: MUTED, fontWeight: 700, padding: 20 }}>Loading…</div> : <>
        {tab === "videos" && <VideoTable rows={rows} playersById={playersById} onSelect={setSelectedId} selectedId={selectedId} />}
        {tab === "unassociated" && <Unassociated rows={rows} players={players} playersById={playersById} nameIndex={nameIndex} bySlug={bySlug} associate={associate} act={act} onSelect={(id) => { setSelectedId(id); }} />}
        {tab === "research" && <Research rows={rows} playersById={playersById} through={through} onSelect={setSelectedId} studioImport={status?.studioImport} />}
        {tab === "channel" && <ChannelTab channelDaily={channelDaily} channelDoc={channelDoc} through={through} period={period} />}
      </>}

      {selected && (
        <VideoDetail key={selected.id} v={selected} players={players} playersById={playersById} recruitsById={recruitsById} nameIndex={nameIndex} bySlug={bySlug}
          associate={associate} act={act} onClose={() => setSelectedId(null)} reloadLegacy={loadLegacy} />
      )}
    </div>
  );
}

// ── Videos table ──
const TYPE_LABEL = { short: "Short", long: "Long-form", live: "Live", upcoming: "Upcoming" };
const COLS = [
  { k: "title", l: "Video", sort: (r) => r.title.toLowerCase() },
  { k: "players", l: "Players", sort: (r) => r.playerIds.length },
  { k: "published", l: "Published", sort: (r) => r.publishedMs || 0 },
  { k: "type", l: "Type", sort: (r) => r.type || "" },
  { k: "views", l: "Views", src: "public", sort: (r) => r.stats?.views ?? -1, num: true },
  { k: "likes", l: "Likes", src: "public", sort: (r) => r.stats?.likes ?? -1, num: true },
  { k: "comments", l: "Comments", src: "public", sort: (r) => r.stats?.comments ?? -1, num: true },
  { k: "v7", l: "Views 7d", src: "analytics", sort: (r) => r.analytics?.last7?.views ?? -1, num: true },
  { k: "watch", l: "Watch time", src: "analytics", sort: (r) => r.analytics?.lifetime?.minutesWatched ?? -1, num: true },
  { k: "subs", l: "Subs gained", src: "analytics", sort: (r) => r.analytics?.lifetime?.subsGained ?? -1, num: true },
  { k: "updated", l: "Analytics updated", sort: (r) => r.analytics?.fetchedAt || 0 },
];

function VideoTable({ rows, playersById, onSelect, selectedId }) {
  const [sort, setSort] = useState({ k: "published", dir: -1 });
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [assoc, setAssoc] = useState("all");
  const [site, setSite] = useState("all");
  const [player, setPlayer] = useState("");
  const [cls, setCls] = useState("");
  const [pos, setPos] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const taggedPlayers = useMemo(() => {
    const ids = new Set(rows.flatMap((r) => r.playerIds));
    return [...ids].map((id) => playersById.get(id)).filter(Boolean).sort((a, b) => (a.Last || "").localeCompare(b.Last || ""));
  }, [rows, playersById]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const col = COLS.find((c) => c.k === sort.k);
    return rows.filter((r) => {
      if (type !== "all" && (type === "unknown" ? r.type : r.type !== type)) return false;
      if (assoc !== "all" && r.assoc !== assoc) return false;
      if (site === "on" && !r.legacyDocId) return false;
      if (site === "off" && r.legacyDocId) return false;
      if (player && !r.playerIds.includes(player)) return false;
      if (!matchesList(r.classes, cls) || !matchesList(r.positions, pos)) return false;
      if (from && (!r.publishedMs || r.publishedMs < Date.parse(from))) return false;
      if (to && (!r.publishedMs || r.publishedMs > Date.parse(to) + 86400e3)) return false;
      if (t && !(`${r.title} ${r.yt?.title || ""} ${r.id}`.toLowerCase().includes(t) || r.playerIds.some((id) => playerName(playersById.get(id)).toLowerCase().includes(t)))) return false;
      return true;
    }).sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [rows, q, type, assoc, site, player, cls, pos, from, to, sort, playersById]);
  const { classes, positions } = useMemo(() => optionLists(rows), [rows]);

  const th = { padding: "8px 8px", fontSize: 10, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", cursor: "pointer", whiteSpace: "nowrap", borderBottom: `2px solid ${LINE}`, background: "#f8fafc", position: "sticky", top: 0 };
  const td = { padding: "6px 8px", fontSize: 12, borderBottom: "1px solid #f0f2f5", color: INK, verticalAlign: "middle" };
  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 12, borderBottom: `1px solid ${LINE}` }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, video ID, player…" style={{ ...input, flex: "1 1 220px" }} />
        <ClassSelect value={cls} onChange={setCls} classes={classes} />
        <PosSelect value={pos} onChange={setPos} positions={positions} />
        <select value={player} onChange={(e) => setPlayer(e.target.value)} style={input}>
          <option value="">All players</option>
          {taggedPlayers.map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} style={input}>
          <option value="all">All types</option><option value="long">Long-form</option><option value="short">Shorts</option><option value="live">Live</option><option value="unknown">Unknown type</option>
        </select>
        <select value={assoc} onChange={(e) => setAssoc(e.target.value)} style={input}>
          <option value="all">Any association</option><option value="associated">Associated</option><option value="unassociated">Unassociated</option><option value="ignored">Ignored</option>
        </select>
        <select value={site} onChange={(e) => setSite(e.target.value)} style={input}>
          <option value="all">On site or not</option><option value="on">On the site</option><option value="off">Not on the site</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} title="Published from" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} title="Published to" />
      </div>
      <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, padding: "8px 12px" }}>{shown.length} of {rows.length} videos · click a row for details</div>
      <div style={{ maxHeight: 640, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, cursor: "default" }} />
              {COLS.map((c) => (
                <th key={c.k} style={{ ...th, textAlign: c.num ? "right" : "left" }} onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? -s.dir : c.num || c.k === "published" || c.k === "updated" ? -1 : 1 }))}
                  title={c.src === "public" ? "Public count (Data API)" : c.src === "analytics" ? "Processed analytics (Analytics API)" : undefined}>
                  {c.l}{c.src === "analytics" ? " ᴬ" : ""}{sort.k === c.k ? (sort.dir < 0 ? " ▾" : " ▴") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} onClick={() => onSelect(r.id)} style={{ cursor: "pointer", background: selectedId === r.id ? "#eef4ff" : r.assoc === "ignored" ? "#fafafa" : "#fff", opacity: r.unavailable ? 0.6 : 1 }}>
                <td style={{ ...td, width: 96 }}>
                  {r.thumb ? <img src={r.thumb} alt="" style={{ width: 88, height: 50, objectFit: "cover", borderRadius: 4, display: "block" }} /> : <div style={{ width: 88, height: 50, background: "#eee", borderRadius: 4 }} />}
                </td>
                <td style={{ ...td, maxWidth: 280 }}>
                  <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.title}</div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                    {r.legacyDocId ? "On site" : "Not on site"}{r.customThumb ? " · custom thumbnail" : ""}{r.unavailable ? " · unavailable on YouTube" : ""}{r.assoc === "ignored" ? " · ignored" : ""}
                  </div>
                </td>
                <td style={{ ...td, maxWidth: 180, fontSize: 11 }}>
                  {r.playerIds.length ? r.playerIds.map((id) => playerName(playersById.get(id))).join(", ") : r.recruitIds.length ? `${r.recruitIds.length} recruit tag(s)` : <span style={{ color: "#aaa" }}>—</span>}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDate(r.publishedMs)}</td>
                <td style={td}>{TYPE_LABEL[r.type] || <span style={{ color: "#aaa" }}>?</span>}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtNum(r.stats?.views)}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtNum(r.stats?.likes)}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtNum(r.stats?.comments)}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtNum(r.analytics?.last7?.views)}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtHours(r.analytics?.lifetime?.minutesWatched)}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtNum(r.analytics?.lifetime?.subsGained)}</td>
                <td style={{ ...td, fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{r.analytics?.fetchedAt ? timeAgo(r.analytics.fetchedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Unassociated ──
function Unassociated({ rows, players, playersById, nameIndex, bySlug, associate, act, onSelect }) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [pending, setPending] = useState(null);
  const list = rows.filter((r) => (showIgnored ? r.assoc === "ignored" : r.assoc === "unassociated")).sort((a, b) => (b.publishedMs || 0) - (a.publishedMs || 0));
  const add = async (r, p) => { setPending(r.id); await associate(r.id, [p.id]); setPending(null); };
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: MUTED, fontWeight: 700 }}>
          {showIgnored ? "Ignored videos — they don't come back as unassociated on later syncs." : "Videos with no player or recruit tags. Suggestions are only suggestions — nothing is tagged until you click."}
        </div>
        <label style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} /> Show ignored
        </label>
      </div>
      {list.length === 0 && <div style={{ color: "#999", fontWeight: 700, padding: 20, textAlign: "center" }}>{showIgnored ? "Nothing ignored." : "Every tracked video has a player tag or is ignored."}</div>}
      {list.map((r) => {
        const sugg = suggestPlayers(r, nameIndex, bySlug, r.playerIds);
        return (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "128px 1fr 300px", gap: 14, padding: "12px 0", borderTop: `1px solid ${LINE}`, opacity: pending === r.id ? 0.5 : 1 }}>
            {r.thumb ? <img src={r.thumb} alt="" style={{ width: 128, height: 72, objectFit: "cover", borderRadius: 6, cursor: "pointer" }} onClick={() => onSelect(r.id)} /> : <div style={{ width: 128, height: 72, background: "#eee", borderRadius: 6 }} />}
            <div>
              <div style={{ fontWeight: 900, fontSize: 13, color: INK, cursor: "pointer" }} onClick={() => onSelect(r.id)}>{r.title}</div>
              <div style={{ fontSize: 11, color: MUTED, margin: "3px 0 8px" }}>{fmtDate(r.publishedMs)} · {TYPE_LABEL[r.type] || "type unknown"} · {fmtNum(r.stats?.views)} views · {r.legacyDocId ? "on site" : "not on site"}</div>
              {sugg.length > 0 && (
                <div>
                  <span style={{ ...label, marginRight: 6 }}>Suggested</span>
                  {sugg.map((s) => (
                    <button key={s.p.id} type="button" title={s.why} disabled={pending === r.id} onClick={() => add(r, s.p)} style={{ border: `1px dashed ${BLUE}`, background: "#fff", color: BLUE, borderRadius: 14, padding: "3px 9px", fontSize: 11, fontWeight: 900, cursor: "pointer", margin: "0 4px 4px 0" }}>
                      + {playerName(s.p)} <span style={{ fontWeight: 400, color: MUTED }}>({s.why})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {!showIgnored && <PlayerPicker players={players} exclude={r.playerIds} onPick={(p) => add(r, p)} />}
              <button style={btn(showIgnored ? BLUE : "#8a94a3", false)} onClick={() => act(() => api("ignore", { videoId: r.id, ignored: !showIgnored }), showIgnored ? "Restored." : "Ignored — it won't show here again.")}>
                {showIgnored ? "Un-ignore" : "Ignore"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Shared filters: draft class / position ──
// "" = any; "__none" = videos with no tagged player.
const matchesList = (list, v) => !v || (v === "__none" ? list.length === 0 : list.includes(v));
const POS_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K", "P"];
function optionLists(rows) {
  const classes = [...new Set(rows.flatMap((r) => r.classes))].sort();
  const positions = [...new Set(rows.flatMap((r) => r.positions))].sort((a, b) => (POS_ORDER.indexOf(a) + 1 || 99) - (POS_ORDER.indexOf(b) + 1 || 99));
  return { classes, positions };
}
function ClassSelect({ value, onChange, classes }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={input} title="Draft class of the tagged players">
      <option value="">All draft classes</option>
      {classes.map((c) => <option key={c} value={c}>{c} class</option>)}
      <option value="__none">No player tagged</option>
    </select>
  );
}
function PosSelect({ value, onChange, positions }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={input} title="Position of the tagged players">
      <option value="">All positions</option>
      {positions.map((p) => <option key={p} value={p}>{p}</option>)}
      <option value="__none">No player tagged</option>
    </select>
  );
}

// ── YouTube Studio CTR import ──
// The API only has impressions/CTR from ~30 days before the reporting job
// was created; Studio can export much longer. Parsed and checked on the
// server (server/youtube-analytics/studio.js); Preview saves nothing.
const localDay = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
function StudioImport({ last }) {
  const [open, setOpen] = useState(!last);
  const [lifetime, setLifetime] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(localDay());
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const payload = () => ({ csv: file.text, fileName: file.name, from: lifetime ? null : from || null, to });
  const pick = (f) => {
    setPreview(null); setMsg(null); setFile(null);
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { setMsg({ err: true, t: "That file is over 3 MB — export just the Content table." }); return; }
    const rd = new FileReader();
    rd.onload = () => setFile({ name: f.name, text: String(rd.result || "") });
    rd.onerror = () => setMsg({ err: true, t: "Couldn't read that file." });
    rd.readAsText(f);
  };
  const run = async (save) => {
    setBusy(true); setMsg(null);
    try {
      const r = await api("studio-import", { ...payload(), preview: !save });
      if (save) { setMsg({ t: r.message || "Imported." }); setPreview(null); setFile(null); }
      else setPreview(r);
    } catch (e) { setMsg({ err: true, t: e.message }); }
    setBusy(false);
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <div style={{ color: BLUE, fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em" }}>Older CTR from YouTube Studio</div>
        <div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>
          {last ? `Imported ${fmtWhen(last.at)}: ${last.matched} videos, ${last.from ? `${fmtDay(last.from)}` : "since upload"} → ${fmtDay(last.to)} · ${fmtNum(last.impressions)} impressions · ${fmtPct(last.ctr)} CTR` : "Not imported yet — the API only has CTR from about 30 days before the first history sync."}
        </div>
        <span style={{ marginLeft: "auto", color: BLUE, fontWeight: 900, fontSize: 11 }}>{open ? "Hide ▴" : "Show ▾"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: INK, lineHeight: 1.6 }}>
            <li>In <b>YouTube Studio</b> (King Cold Sports) open <b>Analytics → Advanced mode</b>.</li>
            <li>Set the date range — <b>Lifetime</b> gets everything.</li>
            <li>Keep the table grouped by <b>Content</b>, and add the metrics <b>Impressions</b> and <b>Impressions click-through rate</b>.</li>
            <li><b>Export current view → Comma-separated values (.csv)</b>, unzip the download, and pick <b>Table data.csv</b> here.</li>
            <li>Enter the same date range you exported, Preview, then Import.</li>
          </ol>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={lifetime} onChange={(e) => { setLifetime(e.target.checked); setPreview(null); }} /> Lifetime export (since each video's upload)
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {!lifetime && <><span style={label}>From</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} style={input} /></>}
              <span style={label}>Through</span>
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} style={input} title="The last day of the range you exported in Studio" />
            </div>
            <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} style={{ fontSize: 12 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btn(BLUE, false, busy || !file || !to)} disabled={busy || !file || !to} onClick={() => run(false)}>Preview</button>
              <button style={btn(BLUE, true, busy || !preview || !preview.matched)} disabled={busy || !preview || !preview.matched}
                onClick={() => { if (window.confirm(`Import Studio CTR for ${preview.matched} videos? This replaces any earlier Studio import.`)) run(true); }}>Import</button>
            </div>
            {preview && (
              <div style={{ fontSize: 12, color: INK, background: "#f8fafc", borderRadius: 8, padding: 10 }}>
                <div><b>{preview.matched}</b> videos matched · {preview.unmatched} not tracked here · {preview.skipped} rows skipped (Total row, blanks)</div>
                <div>{fmtNum(preview.impressions)} impressions · {fmtPct(preview.ctr)} CTR across matched videos</div>
                <div style={{ color: MUTED, fontSize: 11 }}>Columns used: “{preview.columns?.id}”, “{preview.columns?.impressions}”, “{preview.columns?.ctr}”</div>
                {preview.unmatchedSample?.length > 0 && <div style={{ color: MUTED, fontSize: 11 }}>Not tracked (e.g. private/deleted): {preview.unmatchedSample.map((u) => u.title || u.videoId).join(", ")}</div>}
              </div>
            )}
            {msg && <div style={{ fontSize: 12, fontWeight: 700, color: msg.err ? RED : GREEN }}>{msg.t}</div>}
            <div style={{ fontSize: 10, color: MUTED }}>
              Each video's Studio total is kept as one number for that range (no daily breakdown), and only API days after the export's end date are added on top — so no day counts twice. It feeds Research's Lifetime CTR; the 7/28-day views use API data only.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Research ──
// Every number here is computed from what the syncs already stored — no
// extra YouTube calls. For the chosen basis:
//   views, watch time     Analytics API totals for the window
//   avg view duration     YouTube's averageViewDuration for the window
//   watch %               avg view duration ÷ video length (Shorts that loop
//                         can pass 100%); a group's watch % weights each
//                         video by its views = total time watched ÷ total
//                         runtime of every view
//   impressions, CTR      Reporting API (thumbnail impressions on YouTube);
//                         a group's CTR = views from impressions ÷ impressions
const BASES = [
  { k: "lifetime", l: "Lifetime" },
  { k: "last28", l: "Last 28 days" },
  { k: "last7", l: "Last 7 days" },
];
const GROUPS = [
  { k: "class", l: "Draft class", of: (r) => (r.classes.length ? r.classes.map((c) => `${c} class`) : ["No player tagged"]) },
  { k: "position", l: "Position", of: (r) => (r.positions.length ? r.positions : ["No player tagged"]) },
  { k: "type", l: "Video type", of: (r) => [TYPE_LABEL[r.type] || "Unknown type"] },
  { k: "tag", l: "Site tag", of: (r) => (r.tags.length ? r.tags : [r.legacyDocId ? "Untagged" : "Not on site"]) },
  { k: "month", l: "Publish month", of: (r) => [r.publishedMs ? new Date(r.publishedMs).toISOString().slice(0, 7) : "Unknown"] },
  { k: "length", l: "Video length", of: (r) => [lengthBucket(r.yt?.durationSec)] },
];
const LENGTHS = ["Under 1 min", "1–3 min", "3–8 min", "8–15 min", "15–30 min", "30 min +", "Unknown length"];
function lengthBucket(sec) {
  if (!isNum(sec) || sec <= 0) return "Unknown length";
  const m = sec / 60;
  return m < 1 ? LENGTHS[0] : m < 3 ? LENGTHS[1] : m < 8 ? LENGTHS[2] : m < 15 ? LENGTHS[3] : m < 30 ? LENGTHS[4] : LENGTHS[5];
}
const MIN_IMPRESSIONS = 100; // a video needs this many impressions before its own CTR counts in medians / the scatter
// Lifetime impressions/CTR: the YouTube Studio import (through its end date)
// plus only the API days after it, so no day counts twice. Same rule as
// server/youtube-analytics/metrics.js combinedReach.
function combinedReach(reach, studio) {
  const api = reach && reach.impressions > 0 ? reach : null;
  if (!studio) return api ? { impressions: api.impressions, clicks: api.clicks, ctr: api.ctr, from: api.firstDay, to: api.lastDay, sources: ["api"] } : null;
  const after = reach?.after && reach.after.cutoff === studio.to ? reach.after : null;
  const impressions = studio.impressions + (after?.impressions || 0);
  const clicks = studio.clicks + (after?.clicks || 0);
  return {
    impressions, clicks, ctr: impressions ? clicks / impressions : null,
    from: studio.from || null, to: after?.impressions && reach.lastDay > studio.to ? reach.lastDay : studio.to,
    sources: after?.impressions ? ["studio", "api"] : ["studio"],
  };
}
function reachFor(r, basis, through) {
  if (basis === "lifetime") { const c = combinedReach(r.reach, r.studioReach); return c && c.impressions > 0 ? c : null; }
  const reach = r.reach;
  if (!reach || !through) return null;
  const from = addDays(through, basis === "last7" ? -6 : -27);
  let impressions = 0, clicks = 0;
  for (const [d, [i, c]] of Object.entries(reach.days || {})) if (d >= from && d <= through) { impressions += i; clicks += c; }
  return impressions > 0 ? { impressions, clicks, ctr: clicks / impressions } : null;
}
function median(xs) {
  const a = xs.filter(isNum).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
// One row of numbers per video for the basis.
function researchMetrics(r, basis, through) {
  const w = r.analytics?.[basis] || null;
  const views = isNum(w?.views) ? w.views : null;
  const minutes = isNum(w?.minutesWatched) ? w.minutesWatched : null;
  const avgDur = isNum(w?.avgViewDurationSec) ? w.avgViewDurationSec : views ? (minutes * 60) / views : null;
  const len = isNum(r.yt?.durationSec) && r.yt.durationSec > 0 ? r.yt.durationSec : null;
  const reach = reachFor(r, basis, through);
  return {
    views, minutes, avgDur, len,
    watchPct: avgDur != null && len ? avgDur / len : null,
    ytPct: isNum(w?.avgViewPct) ? w.avgViewPct / 100 : null,
    impressions: reach?.impressions ?? null,
    clicks: reach?.clicks ?? null,
    ctr: reach && reach.impressions >= MIN_IMPRESSIONS ? reach.ctr : null,
  };
}
function aggregate(list) {
  let views = 0, minutes = 0, watched = 0, runtime = 0, imp = 0, clicks = 0, withData = 0;
  for (const { m } of list) {
    if (m.impressions) { imp += m.impressions; clicks += m.clicks || 0; }
    if (m.views == null) continue;
    withData++;
    views += m.views; minutes += m.minutes || 0;
    if (m.avgDur != null && m.len && m.views) { watched += m.avgDur * m.views; runtime += m.len * m.views; }
  }
  return {
    videos: list.length, withData, views, minutes,
    avgViews: withData ? views / withData : null,
    medianViews: median(list.map(({ m }) => m.views)),
    avgDur: views ? (minutes * 60) / views : null,
    watchPct: runtime ? watched / runtime : null,
    medianWatchPct: median(list.map(({ m }) => m.watchPct)),
    impressions: imp || null,
    ctr: imp ? clicks / imp : null,
    medianCtr: median(list.map(({ m }) => m.ctr)),
  };
}

const VCOLS = [
  { k: "views", l: "Views", v: (m) => m.views, f: fmtNum },
  { k: "minutes", l: "Watch time", v: (m) => m.minutes, f: fmtHours },
  { k: "avgDur", l: "Avg view", v: (m) => m.avgDur, f: fmtDur },
  { k: "len", l: "Length", v: (m) => m.len, f: fmtDur },
  { k: "watchPct", l: "Watch %", v: (m) => m.watchPct, f: (x) => fmtPct(x, 0) },
  { k: "ytPct", l: "YT avg % viewed", v: (m) => m.ytPct, f: (x) => fmtPct(x, 0) },
  { k: "impressions", l: "Impressions", v: (m) => m.impressions, f: fmtNum },
  { k: "ctr", l: "CTR", v: (m) => m.ctr, f: (x) => fmtPct(x, 1) },
];

function Research({ rows, playersById, through, onSelect, studioImport }) {
  const [basis, setBasis] = useState("lifetime");
  const [cls, setCls] = useState("");
  const [pos, setPos] = useState("");
  const [type, setType] = useState("all");
  const [tag, setTag] = useState("");
  const [site, setSite] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [minViews, setMinViews] = useState("");
  const [groupBy, setGroupBy] = useState("class");
  const [sort, setSort] = useState({ k: "views", dir: -1 });
  const { classes, positions } = useMemo(() => optionLists(rows), [rows]);

  const picked = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.assoc === "ignored") return false;
      if (!matchesList(r.classes, cls) || !matchesList(r.positions, pos)) return false;
      if (type !== "all" && (type === "unknown" ? r.type : r.type !== type)) return false;
      if (tag && (tag === "__none" ? r.tags.length : !r.tags.includes(tag))) return false;
      if (site === "on" && !r.legacyDocId) return false;
      if (site === "off" && r.legacyDocId) return false;
      if (from && (!r.publishedMs || r.publishedMs < Date.parse(from))) return false;
      if (to && (!r.publishedMs || r.publishedMs > Date.parse(to) + 86400e3)) return false;
      if (t && !(`${r.title} ${r.yt?.title || ""}`.toLowerCase().includes(t) || r.playerIds.some((id) => playerName(playersById.get(id)).toLowerCase().includes(t)))) return false;
      return true;
    }).map((r) => ({ r, m: researchMetrics(r, basis, through) }))
      .filter(({ m }) => !minViews || (m.views || 0) >= Number(minViews));
  }, [rows, basis, through, cls, pos, type, tag, site, from, to, q, minViews, playersById]);

  const total = useMemo(() => aggregate(picked), [picked]);
  const groups = useMemo(() => {
    const g = GROUPS.find((x) => x.k === groupBy);
    const by = new Map();
    for (const it of picked) for (const key of g.of(it.r)) by.set(key, [...(by.get(key) || []), it]);
    const out = [...by.entries()].map(([key, list]) => ({ key, ...aggregate(list) }));
    if (groupBy === "length") return out.sort((a, b) => LENGTHS.indexOf(a.key) - LENGTHS.indexOf(b.key));
    if (groupBy === "month" || groupBy === "class") return out.sort((a, b) => (a.key < b.key ? 1 : -1));
    return out.sort((a, b) => b.views - a.views);
  }, [picked, groupBy]);
  const multi = ["class", "position", "tag"].includes(groupBy);
  const maxGroupViews = Math.max(1, ...groups.map((g) => g.views));

  const sortedVideos = useMemo(() => {
    const col = VCOLS.find((c) => c.k === sort.k);
    const val = (x) => (col ? col.v(x.m) : x.r.publishedMs);
    return [...picked].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * sort.dir;
    });
  }, [picked, sort]);

  const noReach = !picked.some(({ m }) => m.impressions);
  const hasStudio = basis === "lifetime" && picked.some(({ r }) => r.studioReach);
  const reachSince = picked.map(({ r }) => r.reach?.firstDay).filter(Boolean).sort()[0];
  const ctrSource = hasStudio
    ? ` (lifetime CTR = your YouTube Studio export ${studioImport?.from ? `from ${fmtDay(studioImport.from)}` : "since upload"} through ${fmtDay(studioImport?.to)}, plus API days after it)`
    : reachSince ? ` (impressions imported since ${fmtDay(reachSince)})` : "";
  const th = { padding: "7px 8px", fontSize: 10, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right", whiteSpace: "nowrap", borderBottom: `2px solid ${LINE}`, background: "#f8fafc", position: "sticky", top: 0 };
  const td = { padding: "6px 8px", fontSize: 12, borderBottom: "1px solid #f0f2f5", color: INK, textAlign: "right", whiteSpace: "nowrap" };
  const basisLabel = basis === "lifetime" ? `lifetime${through ? ` through ${fmtDay(through)}` : ""}` : `${BASES.find((b) => b.k === basis).l.toLowerCase()}${through ? ` ending ${fmtDay(through)}` : ""}`;

  return (
    <>
      <StudioImport last={studioImport} />
      <div style={card}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
            {BASES.map((b) => <button key={b.k} onClick={() => setBasis(b.k)} style={{ ...btn(BLUE, basis === b.k), padding: "6px 10px", fontSize: 11 }}>{b.l}</button>)}
          </div>
          <ClassSelect value={cls} onChange={setCls} classes={classes} />
          <PosSelect value={pos} onChange={setPos} positions={positions} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={input}>
            <option value="all">All types</option><option value="long">Long-form</option><option value="short">Shorts</option><option value="live">Live</option><option value="unknown">Unknown type</option>
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)} style={input} title="Tag on the site's video record">
            <option value="">Any site tag</option><option value="Draft">Draft</option><option value="CFB">CFB</option><option value="Recruiting">Recruiting</option><option value="__none">No tag / not on site</option>
          </select>
          <select value={site} onChange={(e) => setSite(e.target.value)} style={input}>
            <option value="all">On site or not</option><option value="on">On the site</option><option value="off">Not on the site</option>
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} title="Published from" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} title="Published to" />
          <input type="number" min="0" value={minViews} onChange={(e) => setMinViews(e.target.value)} placeholder="Min views" style={{ ...input, width: 100 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or player…" style={{ ...input, flex: "1 1 160px" }} />
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
          {picked.length} videos ({total.withData} with analytics) · {basisLabel} · ignored videos excluded.
          {" "}Watch % = average view duration ÷ video length. CTR comes from YouTube's Reporting API{ctrSource}; a video needs {MIN_IMPRESSIONS}+ impressions for its own CTR to count in medians and the chart.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <Stat title="Views" source="analytics" value={fmtCompact(total.views)} sub={`avg ${fmtNum(total.avgViews)} · median ${fmtNum(total.medianViews)} per video`} />
        <Stat title="Watch time" source="analytics" value={fmtHours(total.minutes)} sub={`avg view ${fmtDur(total.avgDur)}`} />
        <Stat title="Watch %" source="analytics" value={fmtPct(total.watchPct, 0)} sub={`median video ${fmtPct(total.medianWatchPct, 0)} · big value weights by views`} />
        <Stat title="Impressions" source="analytics" value={fmtCompact(total.impressions)} sub={noReach ? "none imported yet — Sync Historical Data" : "thumbnail impressions on YouTube"} />
        <Stat title="CTR" source="analytics" value={fmtPct(total.ctr, 1)} sub={`median video ${fmtPct(total.medianCtr, 1)}`} />
      </div>

      <Panel title="CTR vs watch %" right={<span style={{ fontSize: 11, color: MUTED }}>one dot per video · dashed lines = medians</span>}>
        <Scatter points={picked.filter(({ m }) => m.ctr != null && m.watchPct != null)} medX={total.medianWatchPct} medY={total.medianCtr} onSelect={onSelect} />
      </Panel>

      <Panel title="Breakdown" right={
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} style={input}>
          {GROUPS.map((g) => <option key={g.k} value={g.k}>By {g.l.toLowerCase()}</option>)}
        </select>
      }>
        {multi && <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>A video tagged with more than one {groupBy === "tag" ? "site tag" : groupBy === "class" ? "draft class" : "position"} counts in each, so the groups can add up to more than the total.</div>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>{GROUPS.find((g) => g.k === groupBy).l}</th>
              {["Videos", "Views", "Avg views / video", "Watch time", "Avg view", "Watch %", "Median watch %", "Impressions", "CTR", "Median CTR"].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 900 }}>{g.key}</td>
                  <td style={td}>{fmtNum(g.videos)}</td>
                  <td style={{ ...td, minWidth: 140 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <div style={{ flex: 1, height: 8, background: "#f0f3f7", borderRadius: 4, maxWidth: 80 }}><div style={{ width: `${(g.views / maxGroupViews) * 100}%`, height: "100%", background: BLUE, borderRadius: 4 }} /></div>
                      {fmtNum(g.views)}
                    </div>
                  </td>
                  <td style={td}>{fmtNum(g.avgViews)}</td>
                  <td style={td}>{fmtHours(g.minutes)}</td>
                  <td style={td}>{fmtDur(g.avgDur)}</td>
                  <td style={td}>{fmtPct(g.watchPct, 0)}</td>
                  <td style={td}>{fmtPct(g.medianWatchPct, 0)}</td>
                  <td style={td}>{fmtNum(g.impressions)}</td>
                  <td style={td}>{fmtPct(g.ctr, 1)}</td>
                  <td style={td}>{fmtPct(g.medianCtr, 1)}</td>
                </tr>
              ))}
              {groups.length === 0 && <tr><td colSpan={11} style={{ ...td, textAlign: "center", color: "#999" }}>No videos match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Videos" right={<span style={{ fontSize: 11, color: MUTED }}>click a column to sort · click a row for details</span>}>
        <div style={{ maxHeight: 560, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left", cursor: "pointer" }} onClick={() => setSort((s) => ({ k: "published", dir: s.k === "published" ? -s.dir : -1 }))}>Video{sort.k === "published" ? (sort.dir < 0 ? " ▾" : " ▴") : ""}</th>
              {VCOLS.map((c) => <th key={c.k} style={{ ...th, cursor: "pointer" }} onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? -s.dir : -1 }))}>{c.l}{sort.k === c.k ? (sort.dir < 0 ? " ▾" : " ▴") : ""}</th>)}
            </tr></thead>
            <tbody>
              {sortedVideos.slice(0, 300).map(({ r, m }) => (
                <tr key={r.id} onClick={() => onSelect(r.id)} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, textAlign: "left", whiteSpace: "normal", maxWidth: 320 }}>
                    <div style={{ fontWeight: 900 }}>{r.title}</div>
                    <div style={{ fontSize: 10, color: MUTED }}>{fmtDate(r.publishedMs)} · {TYPE_LABEL[r.type] || "type ?"}{r.classes.length ? ` · ${r.classes.join("/")} class` : ""}{r.positions.length ? ` · ${r.positions.join("/")}` : ""}</div>
                  </td>
                  {VCOLS.map((c) => <td key={c.k} style={td}>{c.f(c.v(m))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {sortedVideos.length > 300 && <div style={{ fontSize: 11, color: MUTED, padding: 8 }}>Showing the first 300 of {sortedVideos.length} — narrow the filters to see the rest.</div>}
        </div>
      </Panel>
    </>
  );
}

// CTR (y) against watch % (x), one dot per video. Single series: no legend;
// hover names the video. Dashed lines at the medians split it into four
// quadrants (e.g. high CTR + low watch % = the thumbnail over-promises).
function Scatter({ points, medX, medY, onSelect }) {
  const [hover, setHover] = useState(null);
  if (points.length < 2) return <div style={{ color: "#999", fontSize: 12, fontWeight: 700, padding: "16px 0" }}>Needs at least 2 videos with {MIN_IMPRESSIONS}+ impressions and watch data. Impressions come from Sync Historical Data; YouTube's first reach reports arrive about 48 hours after the first run.</div>;
  const W = 800, H = 300, L = 48, R = 12, T = 12, B = 32;
  const xMax = Math.max(0.2, ...points.map(({ m }) => m.watchPct)) * 1.05;
  const yMax = Math.max(0.02, ...points.map(({ m }) => m.ctr)) * 1.1;
  const x = (v) => L + (v / xMax) * (W - L - R);
  const y = (v) => H - B - (v / yMax) * (H - T - B);
  const ticks = (max, n = 4) => Array.from({ length: n + 1 }, (_, i) => (max * i) / n);
  const h = hover != null ? points[hover] : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Click-through rate against watch percentage, one dot per video">
        {ticks(yMax).map((t) => (
          <g key={`y${t}`}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eef1f5" />
            <text x={L - 6} y={y(t) + 3} fontSize="10" fill="#99a" textAnchor="end" fontFamily="Arial">{(t * 100).toFixed(1)}%</text>
          </g>
        ))}
        {ticks(xMax).map((t) => <text key={`x${t}`} x={x(t)} y={H - B + 14} fontSize="10" fill="#99a" textAnchor="middle" fontFamily="Arial">{Math.round(t * 100)}%</text>)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#c9d1db" />
        <text x={(L + W - R) / 2} y={H - 4} fontSize="10" fill={MUTED} textAnchor="middle" fontFamily="Arial" fontWeight="700">Watch % (avg view ÷ length)</text>
        <text x={10} y={(T + H - B) / 2} fontSize="10" fill={MUTED} textAnchor="middle" fontFamily="Arial" fontWeight="700" transform={`rotate(-90 10 ${(T + H - B) / 2})`}>CTR</text>
        {isNum(medX) && <line x1={x(medX)} x2={x(medX)} y1={T} y2={H - B} stroke="#b8c2cf" strokeDasharray="4 4" />}
        {isNum(medY) && <line x1={L} x2={W - R} y1={y(medY)} y2={y(medY)} stroke="#b8c2cf" strokeDasharray="4 4" />}
        {points.map(({ r, m }, i) => (
          <circle key={r.id} cx={x(m.watchPct)} cy={y(m.ctr)} r={hover === i ? 7 : 5} fill={hover === i ? INK : BLUE} fillOpacity={hover === i ? 1 : 0.75} stroke="#fff" strokeWidth="2"
            style={{ cursor: "pointer" }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSelect(r.id)}>
            <title>{r.title}</title>
          </circle>
        ))}
      </svg>
      <div style={{ fontSize: 11, color: h ? INK : "#99a", fontWeight: 700, minHeight: 16, marginTop: 4 }}>
        {h ? `${h.r.title} — CTR ${fmtPct(h.m.ctr)} · watch ${fmtPct(h.m.watchPct, 0)} · ${fmtNum(h.m.views)} views · ${fmtNum(h.m.impressions)} impressions` : "Hover a dot for the video; click to open it."}
      </div>
    </div>
  );
}

// ── Channel ──
function ChannelTab({ channelDaily, channelDoc, through, period }) {
  if (!through) return <div style={card}><div style={{ color: "#999", fontWeight: 700, padding: 20, textAlign: "center" }}>Run Sync Analytics to load channel data.</div></div>;
  const from = addDays(through, -(period - 1));
  const rows = channelDaily.filter((d) => d.date >= from && d.date <= through);
  const tot = rows.reduce((a, d) => ({ views: a.views + (d.views || 0), min: a.min + (d.minutesWatched || 0), imp: a.imp + (d.impressions || 0), clicks: a.clicks + (d.impressions || 0) * (d.impressionsCtr || 0) }), { views: 0, min: 0, imp: 0, clicks: 0 });
  const ts = channelDoc?.trafficSources;
  return (
    <>
      <Panel title={`Channel daily views · ${fmtDay(from)} – ${fmtDay(through)}`} right={<SourceTag kind="analytics" />}>
        <div style={{ display: "flex", gap: 24, fontSize: 12, color: INK, marginBottom: 12, fontWeight: 700 }}>
          <span>{fmtNum(tot.views)} views</span><span>{fmtHours(tot.min)} watched</span>
          <span>{tot.imp ? `${fmtNum(tot.imp)} impressions · ${fmtPct(tot.clicks / tot.imp)} CTR` : "Impressions: none imported for this period yet (Reporting API)"}</span>
        </div>
        <BarChart rows={rows} />
      </Panel>
      <Panel title="Traffic sources (channel)" right={ts ? <span style={{ fontSize: 11, color: MUTED }}>{fmtDay(ts.from)} – {fmtDay(ts.to)}</span> : null}>
        {ts?.rows?.length ? <HBars rows={ts.rows} /> : <div style={{ color: "#999", fontSize: 12, fontWeight: 700 }}>None yet — run Sync Analytics.</div>}
      </Panel>
    </>
  );
}

// ── Video detail ──
function VideoDetail({ v, players, playersById, recruitsById, nameIndex, bySlug, associate, act, onClose, reloadLegacy }) {
  const [daily, setDaily] = useState(null);
  const [range, setRange] = useState(90);
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState([]);
  const a = v.analytics || {};
  const perf = v.perf || {};

  useEffect(() => {
    getDocs(collection(db, "ytVideos", v.id, "daily"))
      .then((s) => setDaily(s.docs.map((d) => d.data()).sort((x, y) => (x.date < y.date ? -1 : 1))))
      .catch(() => setDaily([]));
  }, [v.id]);

  // Fill missing days with 0 inside the stored range (no row = no activity).
  const series = useMemo(() => {
    if (!daily?.length) return [];
    const byDate = new Map(daily.map((d) => [d.date, d]));
    const end = daily[daily.length - 1].date;
    const start = [daily[0].date, addDays(end, -(range - 1))].sort().pop();
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(byDate.get(d) || { date: d, views: 0 });
    return out;
  }, [daily, range]);

  const sugg = suggestPlayers(v, nameIndex, bySlug, v.playerIds);
  const run = async (fn) => { setBusy(true); await fn(); setBusy(false); };
  const remove = (id) => run(() => associate(v.id, [], [id]));
  const add = (p) => run(() => associate(v.id, [p.id]));
  const metric = (l, val, sub) => (
    <div style={{ padding: "8px 10px", background: "#f8fafc", borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color: INK, marginTop: 2 }}>{val}</div>
      {sub && <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{sub}</div>}
    </div>
  );
  const firstN = (n) => {
    const w = perf[`first${n}`];
    if (!w) return metric(`First ${n} day${n > 1 ? "s" : ""}`, "—", "needs history");
    if (!w.complete) return metric(`First ${n} day${n > 1 ? "s" : ""}`, "—", "not complete yet");
    return metric(`First ${n} day${n > 1 ? "s" : ""}`, fmtNum(w.views), `${fmtDay(w.from)} – ${fmtDay(w.to)} · +${fmtNum(w.subsGained)} subs`);
  };
  const imp = daily?.filter((d) => isNum(d.impressions)) || [];
  const recentTable = (daily || []).slice(-14).reverse();

  return (
    <div style={{ ...card, borderColor: BLUE, marginTop: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {v.thumb && <img src={v.thumb} alt="" style={{ width: 200, height: 112, objectFit: "cover", borderRadius: 8 }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: INK }}>{v.title}</div>
          {v.leg && v.title !== v.yt?.title && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>On YouTube: {v.yt?.title}</div>}
          <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
            {fmtDate(v.publishedMs)} · {TYPE_LABEL[v.type] || "type unknown"}{v.typeSource ? ` (${v.typeSource})` : ""} · {fmtDur(v.yt?.durationSec)} · {v.yt?.privacyStatus || "?"}
            {" · "}<a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" style={{ color: BLUE, fontWeight: 900 }}>YouTube ↗</a>
          </div>
          <div style={{ fontSize: 12, marginTop: 4, color: v.legacyDocId ? GREEN : MUTED, fontWeight: 700 }}>
            {v.legacyDocId ? `On the site (videos/${v.legacyDocId}) — custom title/thumbnail and tags there are kept and shown here.` : "Not on the site."}
            {v.customThumb && " Using the site's custom thumbnail."}
          </div>
        </div>
        <button onClick={onClose} style={btn(MUTED, false)}>Close</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Current public stats <SourceTag kind="public" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {metric("Views", fmtNum(v.stats?.views))}{metric("Likes", fmtNum(v.stats?.likes))}{metric("Comments", fmtNum(v.stats?.comments))}
            {metric("≈ last 24h", v.stats?.delta24h ? `+${fmtNum(v.stats.delta24h.views)}` : "—", v.stats?.delta24h ? `between snapshots ${v.stats.delta24h.hours.toFixed(1)}h apart` : "needs snapshots ~24h apart")}
            {metric("≈ last 48h", v.stats?.delta48h ? `+${fmtNum(v.stats.delta48h.views)}` : "—", v.stats?.delta48h ? `between snapshots ${v.stats.delta48h.hours.toFixed(1)}h apart` : "needs snapshots ~48h apart")}
            {metric("Fetched", v.stats?.fetchedAt ? timeAgo(v.stats.fetchedAt) : "—")}
          </div>
        </div>
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Processed analytics <SourceTag kind="analytics" /> {a.through && <span style={{ textTransform: "none", fontWeight: 700 }}>through {fmtDay(a.through)}</span>}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {metric("Lifetime views", fmtNum(a.lifetime?.views))}
            {metric("Watch time", fmtHours(a.lifetime?.minutesWatched))}
            {metric("Avg view", fmtDur(a.lifetime?.avgViewDurationSec), isNum(a.lifetime?.avgViewPct) ? `${a.lifetime.avgViewPct.toFixed(1)}% viewed` : null)}
            {metric("Subscribers", a.lifetime ? `+${fmtNum(a.lifetime.subsGained)} / −${fmtNum(a.lifetime.subsLost)}` : "—")}
            {metric("Latest day", fmtNum(a.last1?.views), a.last1 ? fmtDay(a.last1.to) : null)}
            {metric("Latest 2 days", fmtNum(a.last2?.views))}
            {metric("Last 7 days", fmtNum(a.last7?.views), isNum(a.growth7) ? `${a.growth7 >= 0 ? "+" : ""}${fmtPct(a.growth7, 0)} vs prior 7` : "prior 7: " + fmtNum(a.prev7?.views))}
            {metric("Last 28 days", fmtNum(a.last28?.views))}
            {metric("Views / day (7d)", isNum(a.viewsPerDay7) ? a.viewsPerDay7.toFixed(1) : "—")}
            {firstN(1)}{firstN(2)}{firstN(7)}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>
            "Days" are Pacific calendar days as YouTube reports them; "first day" is the publish day (part of a day), not an exact 24 hours.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={label}>Daily views <SourceTag kind="analytics" /></div>
          <span style={{ fontSize: 11, color: MUTED }}>{v.history?.complete ? `history from ${fmtDay(v.history.from)}` : "history not backfilled yet — run Sync Historical Data"}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {[30, 90, 365, 3650].map((d) => <button key={d} onClick={() => setRange(d)} style={{ ...btn(BLUE, range === d), padding: "3px 9px", fontSize: 10 }}>{d === 3650 ? "All" : `${d}d`}</button>)}
          </div>
        </div>
        {daily == null ? <div style={{ color: MUTED, fontSize: 12 }}>Loading…</div> : (
          <BarChart rows={series} tip={(d) => `${fmtDay(d.date)} · ${fmtNum(d.views)} views · ${fmtHours(d.minutesWatched)} watched${isNum(d.impressions) ? ` · ${fmtNum(d.impressions)} impr. · ${fmtPct(d.impressionsCtr)} CTR` : ""}`} />
        )}
        {recentTable.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 900, color: MUTED }}>Table: latest {recentTable.length} stored days{imp.length ? "" : " (no impressions imported yet)"}</summary>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 6 }}>
              <thead><tr>{["Day", "Views", "Watch time", "Avg view", "Subs +/−", "Impressions", "CTR"].map((h) => <th key={h} style={{ textAlign: h === "Day" ? "left" : "right", padding: 4, color: MUTED }}>{h}</th>)}</tr></thead>
              <tbody>{recentTable.map((d) => (
                <tr key={d.date} title={d.firstObserved ? `Revised by YouTube; first observed ${fmtNum(d.firstObserved.views)} views` : undefined}>
                  <td style={{ padding: 4 }}>{fmtDay(d.date)}{d.firstObserved ? " *" : ""}</td>
                  <td style={{ padding: 4, textAlign: "right" }}>{fmtNum(d.views)}</td>
                  <td style={{ padding: 4, textAlign: "right" }}>{fmtHours(d.minutesWatched)}</td>
                  <td style={{ padding: 4, textAlign: "right" }}>{fmtDur(d.avgViewDurationSec)}</td>
                  <td style={{ padding: 4, textAlign: "right" }}>{isNum(d.subsGained) ? `+${d.subsGained} / −${d.subsLost || 0}` : "—"}</td>
                  <td style={{ padding: 4, textAlign: "right" }}>{fmtNum(d.impressions)}</td>
                  <td style={{ padding: 4, textAlign: "right" }}>{fmtPct(d.impressionsCtr)}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 18 }}>
        <div>
          <div style={{ ...label, marginBottom: 8 }}>Players</div>
          <div style={{ marginBottom: 8 }}>
            {v.playerIds.map((id) => {
              const item = v.leg?.items?.find((it) => it.type !== "recruit" && it.playerId === id);
              const locked = !!(item && ((item.title || "").trim() || (item.thumb || "").trim()));
              return <Chip key={id} onRemove={busy || locked ? null : () => remove(id)} title={locked ? "Has a custom title/thumbnail on the site — edit in Videos → Video Management" : undefined}>{playerName(playersById.get(id))}{locked ? " 🔒" : ""}</Chip>;
            })}
            {v.recruitIds.map((id) => <Chip key={id} color="#7b5ea7" title="Recruit tag — edit in Video Management">{playerName(recruitsById.get(id))} (recruit)</Chip>)}
            {!v.playerIds.length && !v.recruitIds.length && <span style={{ fontSize: 12, color: "#999" }}>No players tagged.</span>}
          </div>
          <PlayerPicker players={players} exclude={v.playerIds} onPick={add} />
          {sugg.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {sugg.map((s) => (
                <button key={s.p.id} type="button" disabled={busy} title={s.why} onClick={() => add(s.p)} style={{ border: `1px dashed ${BLUE}`, background: "#fff", color: BLUE, borderRadius: 14, padding: "3px 9px", fontSize: 11, fontWeight: 900, cursor: "pointer", margin: "0 4px 4px 0" }}>+ {playerName(s.p)}</button>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>
            {v.legacyDocId ? "Changes save to the site's video record (same tags Video Management edits) and show on player pages." : "Saved for analytics only — this video isn't on the site."}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button style={btn("#8a94a3", false, busy)} disabled={busy} onClick={() => run(() => act(() => api("ignore", { videoId: v.id, ignored: v.assoc !== "ignored" }), v.assoc === "ignored" ? "Restored." : "Ignored."))}>
              {v.assoc === "ignored" ? "Un-ignore" : "Ignore"}
            </button>
          </div>
          {!v.legacyDocId && (
            <div style={{ marginTop: 14, padding: 12, border: `2px dashed ${GOLD}`, borderRadius: 8 }}>
              <div style={{ ...label, color: "#8a5a00", marginBottom: 6 }}>Add to We-Draft site</div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>Creates a public video record (Videos → Video Management) with this YouTube title and the tagged players. It appears on the site immediately.</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {["Draft", "Recruiting", "CFB"].map((t) => (
                  <label key={t} style={{ fontSize: 12, fontWeight: 700, display: "flex", gap: 4 }}>
                    <input type="checkbox" checked={tags.includes(t)} onChange={(e) => setTags((x) => (e.target.checked ? [...x, t] : x.filter((y) => y !== t)))} />{t}
                  </label>
                ))}
                <button style={btn(GOLD, true, busy)} disabled={busy} onClick={() => run(async () => {
                  if (!window.confirm(`Add "${v.yt?.title}" to the public site now?`)) return;
                  const r = await act(() => api("publish", { videoId: v.id, confirm: true, tags }), (x) => (x.alreadyOnSite ? "It was already on the site — linked." : "Added to the site."));
                  if (r) await reloadLegacy();
                })}>Add to site</button>
              </div>
            </div>
          )}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={label}>Traffic sources <SourceTag kind="analytics" /></div>
            <button style={{ ...btn(BLUE, false, busy), padding: "3px 9px", fontSize: 10, marginLeft: "auto" }} disabled={busy} onClick={() => run(() => act(() => api("traffic", { videoId: v.id }), null))}>{v.trafficSources ? "Refresh" : "Load"}</button>
          </div>
          {v.trafficSources?.rows?.length ? (
            <>
              <div style={{ fontSize: 10, color: MUTED, marginBottom: 6 }}>{fmtDay(v.trafficSources.from)} – {fmtDay(v.trafficSources.to)} · fetched {timeAgo(v.trafficSources.fetchedAt)}</div>
              <HBars rows={v.trafficSources.rows} />
            </>
          ) : <div style={{ fontSize: 12, color: "#999" }}>{v.trafficSources ? "No traffic data for this video." : "Not loaded (one Analytics API query)."}</div>}
          {imp.length > 0 && (() => {
            const t = imp.reduce((s, d) => ({ i: s.i + d.impressions, c: s.c + d.impressions * (d.impressionsCtr || 0) }), { i: 0, c: 0 });
            return <div style={{ fontSize: 12, color: INK, marginTop: 12, fontWeight: 700 }}>Impressions (Reporting API, {imp.length} days imported): {fmtNum(t.i)} · CTR {fmtPct(t.i ? t.c / t.i : null)}</div>;
          })()}
          {v.studioReach && (() => {
            const c = combinedReach(v.reach, v.studioReach);
            return (
              <div style={{ fontSize: 12, color: INK, marginTop: 8, fontWeight: 700 }}>
                Lifetime impressions: {fmtNum(c?.impressions)} · CTR {fmtPct(c?.ctr)}
                <div style={{ fontSize: 10, color: MUTED, fontWeight: 400 }}>YouTube Studio export {v.studioReach.from ? `from ${fmtDay(v.studioReach.from)}` : "since upload"} through {fmtDay(v.studioReach.to)} ({fmtNum(v.studioReach.impressions)} impressions, {fmtPct(v.studioReach.ctr)}){c?.sources.includes("api") ? " + API days after it" : ""}</div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
