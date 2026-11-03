// src/components/AdminInstagramAnalytics.jsx
//
// Admin → Content → Instagram Analytics: how @wedraftsite is doing, and
// each post. Admin-only; nothing here is shown on the public site. A
// separate tab from the Post Manager (AdminInstagram.jsx), which makes and
// publishes the posts — posts published from there are linked here to
// their We-Draft post and players.
//
//   Account   followers, posts; Sync and the scheduled sync
//   Overview  the range's totals against the period before it
//   Trend     one metric a day (or a week), this period and the last
//   Audience  follower and engaged-audience demographics
//   Posts     every post, sortable and filterable → a post's detail
//
// Data (Firestore, admin read; written only by server/instagram/sync.js and
// publish.js, through api/instagram.js):
//   igAnalytics/{status, account, demographics}, igAccountDaily/{day},
//   igMedia/{mediaId} (+ /daily/{day} snapshots), players (names for links).
// Numbers are marked by source: META as Meta reports them; CALC worked out
// by We-Draft — the engagement rate, (likes + comments + saves + shares) ÷
// reach, and the follower history (the count as seen at each sync).
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { igApi } from "../utils/instagram/api";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
// The comparison period's line — a darker amber than GOLD, which is too
// light to read as a line on white (validated with BLUE as a pair).
const PREV = "#b86e00";
const INK = "#1d2433";
const MUTED = "#5b6b84";
const FAINT = "#8a97ab";
const LINE = "#e3e8ef";
const RED = "#a52a1e";
const GREEN = "#15803d";

const card = { border: `1px solid ${LINE}`, borderRadius: "10px", background: "#fff", padding: "12px 14px" };
const label = { fontSize: "10px", fontWeight: 900, color: FAINT, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "4px" };
const btn = (on) => ({
  border: on ? "none" : `1px solid #d5dce6`, borderRadius: "999px", padding: "5px 12px", fontWeight: 900, fontSize: "12px",
  background: on ? BLUE : "#fff", color: on ? "#fff" : "#33415a", cursor: "pointer",
});
const field = { padding: "5px 8px", border: "1px solid #d5dce6", borderRadius: "6px", fontSize: "12px", fontWeight: 700 };
const Src = ({ calc }) => (
  <span title={calc ? "Calculated by We-Draft" : "As reported by Meta"} style={{ fontSize: "9px", fontWeight: 900, letterSpacing: "0.06em", padding: "1px 4px", borderRadius: "3px", marginLeft: "4px", verticalAlign: "1px", color: calc ? "#7a4b00" : BLUE, background: calc ? "#fdf0d9" : "#e6eef8" }}>
    {calc ? "CALC" : "META"}
  </span>
);

// ── Formatting ──
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmtNum = (v) => (isNum(v) ? Math.round(v).toLocaleString() : "—");
const fmtCompact = (v) => (!isNum(v) ? "—" : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : Math.round(v).toLocaleString());
const fmtPct = (v, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : "—");
const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—");
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const fmtSec = (ms) => (isNum(ms) ? `${(ms / 1000).toFixed(1)}s` : "—");
// Days are Pacific, as Meta's are (server/instagram/metrics.js).
const pacificToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const addDays = (day, n) => { const t = new Date(`${day}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400e3);
const TYPE_LABEL = { IMAGE: "Image", CAROUSEL_ALBUM: "Carousel", VIDEO: "Video", REELS: "Reel" };
const typeOf = (m) => (m.productType === "REELS" ? "REELS" : m.mediaType || "IMAGE");

// The account's daily metrics (igAccountDaily .meta, except followers:
// We-Draft's own observation, .calc). sum: added up over a range; last: the
// latest value in it.
const METRICS = [
  { key: "reach", label: "Reach", note: "Accounts reached each day, added up — not unique across the range.", sum: true },
  { key: "views", label: "Views", sum: true },
  { key: "total_interactions", label: "Interactions", sum: true },
  { key: "accounts_engaged", label: "Accounts engaged", note: "Each day's, added up.", sum: true },
  { key: "profile_views", label: "Profile views", sum: true },
  { key: "profile_links_taps", label: "Link taps", sum: true },
  { key: "netFollows", label: "Net follows", note: "Follows minus unfollows.", sum: true },
  { key: "followers", label: "Followers", note: "The count as seen at each sync — We-Draft's history, not Meta's.", calc: true, last: true },
];
const metricValue = (row, key) => {
  if (!row) return null;
  if (key === "followers") return row.calc?.followers ?? null;
  if (key === "netFollows") return isNum(row.meta?.follows) || isNum(row.meta?.unfollows) ? (row.meta?.follows || 0) - (row.meta?.unfollows || 0) : null;
  return row.meta?.[key] ?? null;
};
// A range [from, to] of days → the metric's total (or last value) and how
// many of its days have data.
function rangeStat(rows, from, to, m) {
  let total = 0, have = 0, last = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = metricValue(rows[d], m.key);
    if (isNum(v)) { total += v; have++; last = v; }
  }
  return { value: m.last ? last : have ? total : null, have, days: daysBetween(from, to) + 1 };
}

// ── The trend chart: one line for the range, a dashed one for the period
// before it, aligned day for day (or week for week). Hover: a crosshair and
// both periods' values.
function TrendChart({ cur, prev, fmt, height = 220 }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 760, H = height, L = 46, R = 12, T = 12, B = 26;
  const n = cur.length;
  const vals = [...cur, ...prev].map((p) => p.v).filter(isNum);
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const path = (pts) => {
    let d = "", pen = false;
    pts.forEach((p, i) => { if (!isNum(p.v)) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`; pen = true; });
    return d;
  };
  const ticks = [0, 0.5, 1].map((k) => min + k * (max - min));
  const every = Math.max(1, Math.ceil(n / 8));
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  const hp = hover != null ? cur[hover] : null;
  return (
    <div style={{ position: "relative" }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label="Trend for the selected range and the period before it">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth="1" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={FAINT}>{fmtCompact(t)}</text>
          </g>
        ))}
        {cur.map((p, i) => (i % every === 0 || i === n - 1 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={FAINT}>{p.label}</text> : null))}
        <path d={path(prev)} fill="none" stroke={PREV} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path(cur)} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" />
            {isNum(prev[hover]?.v) && <circle cx={x(hover)} cy={y(prev[hover].v)} r="4" fill={PREV} stroke="#fff" strokeWidth="2" />}
            {isNum(hp.v) && <circle cx={x(hover)} cy={y(hp.v)} r="4" fill={BLUE} stroke="#fff" strokeWidth="2" />}
          </g>
        )}
        {/* A wide hit area over the plot. */}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" />
      </svg>
      {hp && (
        <div style={{ position: "absolute", top: 6, left: `${Math.min(70, (x(hover) / W) * 100)}%`, transform: "translateX(8px)", background: "#fff", border: `1px solid ${LINE}`, borderRadius: "6px", padding: "5px 8px", fontSize: "11px", fontWeight: 700, color: INK, pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,.08)", whiteSpace: "nowrap" }}>
          <div><span style={{ display: "inline-block", width: 10, height: 2, background: BLUE, marginRight: 5, verticalAlign: "middle" }} />{hp.label}: {fmt(hp.v)}</div>
          {prev[hover] && <div style={{ color: MUTED }}><span style={{ display: "inline-block", width: 10, height: 0, borderTop: `2px dashed ${PREV}`, marginRight: 5, verticalAlign: "middle" }} />{prev[hover].label}: {fmt(prev[hover].v)}</div>}
        </div>
      )}
    </div>
  );
}

// Horizontal bars, one hue (magnitude only).
function Bars({ rows, total, max = 8, fmtKey = (k) => k }) {
  if (!rows?.length) return <div style={{ fontSize: "12px", fontWeight: 700, color: FAINT }}>Not available.</div>;
  const top = rows.slice(0, max);
  const big = Math.max(...top.map((r) => r.value), 1);
  return (
    <div style={{ display: "grid", gap: "4px" }}>
      {top.map((r) => (
        <div key={r.key} title={`${fmtKey(r.key)}: ${fmtNum(r.value)}${total ? ` (${fmtPct(r.value / total)})` : ""}`} style={{ display: "grid", gridTemplateColumns: "92px 1fr 52px", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 800, color: INK }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtKey(r.key)}</span>
          <span style={{ height: "10px", background: "#eef2f7", borderRadius: "4px", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(r.value / big) * 100}%`, background: BLUE, borderRadius: "0 4px 4px 0" }} />
          </span>
          <span style={{ textAlign: "right", color: MUTED }}>{total ? fmtPct(r.value / total, 0) : fmtNum(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Posts ──
const COLUMNS = [
  { key: "timestampMs", label: "Posted", get: (m) => m.timestampMs, fmt: fmtDate },
  { key: "reach", label: "Reach", get: (m) => m.meta?.reach },
  { key: "views", label: "Views", get: (m) => m.meta?.views },
  { key: "likes", label: "Likes", get: (m) => m.meta?.likes ?? m.counts?.likes },
  { key: "comments", label: "Comments", get: (m) => m.meta?.comments ?? m.counts?.comments },
  { key: "saved", label: "Saves", get: (m) => m.meta?.saved },
  { key: "shares", label: "Shares", get: (m) => m.meta?.shares },
  { key: "engagement", label: "Engagement", get: (m) => m.calc?.engagement, calc: true },
  { key: "engagementRate", label: "Eng. rate", get: (m) => m.calc?.engagementRate, fmt: (v) => fmtPct(v), calc: true },
];

function PostDetail({ m, players, onClose }) {
  const [daily, setDaily] = useState(null);
  useEffect(() => {
    getDocs(collection(db, "igMedia", m.id, "daily")).then((s) => setDaily(s.docs.map((d) => d.data()).sort((a, b) => (a.day < b.day ? -1 : 1)))).catch(() => setDaily([]));
  }, [m.id]);
  const reel = m.productType === "REELS";
  const rows = [
    ["Reach", m.meta?.reach], ["Views", m.meta?.views], ["Likes", m.meta?.likes ?? m.counts?.likes], ["Comments", m.meta?.comments ?? m.counts?.comments],
    ["Saves", m.meta?.saved], ["Shares", m.meta?.shares], ["Total interactions", m.meta?.total_interactions],
    ...(reel ? [["Avg. watch time", m.meta?.ig_reels_avg_watch_time, fmtSec], ["Total watch time", m.meta?.ig_reels_video_view_total_time, (v) => (isNum(v) ? `${(v / 3600000).toFixed(1)}h` : "—")]]
      : [["Profile visits", m.meta?.profile_visits], ["Follows", m.meta?.follows], ["Profile activity", m.meta?.profile_activity]]),
  ];
  const series = (key) => (daily || []).map((d) => ({ label: fmtDay(d.day), v: d.meta?.[key] ?? null }));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,20,38,.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(880px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "16px" }}>
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 200px" }}>
            {m.thumb ? <img src={m.thumb} alt="" referrerPolicy="no-referrer" style={{ width: "200px", borderRadius: "8px", display: "block", background: "#0b1426" }} /> : <div style={{ width: "200px", height: "250px", borderRadius: "8px", background: "#0b1426" }} />}
            {m.permalink && <a href={m.permalink} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: "8px", color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "none" }}>View on Instagram ↗</a>}
          </div>
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 900, color: MUTED }}>{TYPE_LABEL[typeOf(m)]} · {fmtDate(m.timestampMs)}</span>
              <button onClick={onClose} style={{ ...btn(false), marginLeft: "auto", padding: "3px 10px" }}>Close</button>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: INK, whiteSpace: "pre-wrap", margin: "6px 0 10px", maxHeight: "110px", overflowY: "auto" }}>{m.caption || <span style={{ color: FAINT }}>No caption</span>}</div>
            {m.postId && (
              <div style={{ fontSize: "12px", fontWeight: 800, color: INK, marginBottom: "10px", padding: "6px 8px", background: "#f8fafc", borderRadius: "6px" }}>
                Published from We-Draft: {m.postName || m.postId}
                {m.playerIds?.length ? <> · {m.playerIds.map((id) => players[id] || id).join(", ")}</> : null}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "8px" }}>
              {rows.map(([t, v, f]) => (
                <div key={t}><div style={label}>{t}<Src /></div><div style={{ fontSize: "18px", fontWeight: 900, color: INK }}>{(f || fmtNum)(v)}</div></div>
              ))}
              <div><div style={label}>Engagement rate<Src calc /></div><div style={{ fontSize: "18px", fontWeight: 900, color: INK }}>{fmtPct(m.calc?.engagementRate)}</div></div>
            </div>
            <div style={{ fontSize: "10px", fontWeight: 700, color: FAINT, marginTop: "6px" }}>Meta's lifetime totals as of {fmtWhen(m.metricsAt)}. Engagement rate = (likes + comments + saves + shares) ÷ reach.</div>
          </div>
        </div>
        <div style={{ marginTop: "14px" }}>
          <div style={label}>Reach over time · as seen at each sync<Src /></div>
          {daily == null ? <div style={{ fontSize: "12px", color: FAINT }}>Loading…</div>
            : daily.length < 2 ? <div style={{ fontSize: "12px", fontWeight: 700, color: FAINT }}>{daily.length ? "One snapshot so far — the trend starts with the next day's sync." : "No snapshots yet."}</div>
              : <TrendChart cur={series("reach")} prev={[]} fmt={fmtNum} height={180} />}
        </div>
      </div>
    </div>
  );
}

export default function AdminInstagramAnalytics() {
  const [status, setStatus] = useState(null);
  const [account, setAccount] = useState(null);
  const [demo, setDemo] = useState(null);
  const [daily, setDaily] = useState({});
  const [media, setMedia] = useState(null);
  const [players, setPlayers] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [version, setVersion] = useState(0);
  const today = pacificToday();
  // The range: the last N days through today, or custom.
  const [preset, setPreset] = useState(28);
  const [from, setFrom] = useState(addDays(today, -27));
  const [to, setTo] = useState(today);
  const [metric, setMetric] = useState("reach");
  const [weekly, setWeekly] = useState(false);
  // Posts table.
  const [sort, setSort] = useState({ key: "timestampMs", dir: -1 });
  const [typeFilter, setTypeFilter] = useState("all");
  const [inRange, setInRange] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);

  useEffect(() => onSnapshot(doc(db, "igAnalytics", "status"), (d) => setStatus(d.data() || {}), () => setStatus({})), []);
  useEffect(() => {
    getDoc(doc(db, "igAnalytics", "account")).then((d) => setAccount(d.data() || null)).catch(() => {});
    getDoc(doc(db, "igAnalytics", "demographics")).then((d) => setDemo(d.data() || null)).catch(() => {});
    getDocs(query(collection(db, "igAccountDaily"), where("day", ">=", addDays(today, -400)))).then((s) => setDaily(Object.fromEntries(s.docs.map((d) => [d.id, d.data()])))).catch((e) => setMsg(`Couldn't load the account's days: ${e.message}`));
    getDocs(collection(db, "igMedia")).then((s) => setMedia(s.docs.map((d) => d.data()).filter((m) => m.timestampMs))).catch((e) => { setMedia([]); setMsg(`Couldn't load the posts: ${e.message}`); });
  }, [version, today]);
  // Names for the players linked to posts.
  useEffect(() => {
    const ids = [...new Set((media || []).flatMap((m) => m.playerIds || []))].filter((id) => !players[id]);
    if (!ids.length) return;
    Promise.all(ids.map((id) => getDoc(doc(db, "players", id)).then((d) => [id, d.exists() ? `${d.data().First || ""} ${d.data().Last || ""}`.trim() : id]).catch(() => [id, id])))
      .then((pairs) => setPlayers((p) => ({ ...p, ...Object.fromEntries(pairs) })));
  }, [media]); // eslint-disable-line react-hooks/exhaustive-deps

  const choosePreset = (n) => { setPreset(n); setFrom(addDays(today, -(n - 1))); setTo(today); };
  const span = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(span - 1));

  const sync = async (op) => {
    setBusy(op);
    setMsg("");
    try {
      let r;
      // A run stops before its time limit with more: true; keep going (a few rounds) while there's more.
      for (let k = 0; k < 4; k++) { r = await igApi("sync", { op }); if (!r.more) break; }
      setMsg(`${op === "account" ? "Account" : "Posts"} synced${r.errors?.length ? ` with ${r.errors.length} problem${r.errors.length === 1 ? "" : "s"}: ${r.errors[0]}` : "."}${r.more ? " More left — run it again." : ""}`);
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg(`Couldn't sync: ${e.message}`);
    } finally {
      setBusy("");
    }
  };
  const setAuto = async (enabled) => {
    try { await igApi("set-auto", { enabled }); } catch (e) { setMsg(`Couldn't change the schedule: ${e.message}`); }
  };

  // ── Overview tiles ──
  const tiles = METRICS.map((m) => {
    const c = rangeStat(daily, from, to, m);
    const p = rangeStat(daily, prevFrom, prevTo, m);
    // A comparison only when both periods are (nearly) fully covered.
    const comparable = !m.last && c.have >= c.days * 0.8 && p.have >= p.days * 0.8 && isNum(p.value) && p.value !== 0;
    const delta = m.last ? (isNum(c.value) && isNum(p.value) ? c.value - p.value : null) : comparable ? (c.value - p.value) / Math.abs(p.value) : null;
    return { ...m, cur: c, prev: p, delta };
  });
  const rangePosts = (media || []).filter((m) => { const d = new Date(m.timestampMs).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); return d >= from && d <= to; });
  const avgEr = (() => { const v = rangePosts.map((m) => m.calc?.engagementRate).filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();

  // ── Trend ──
  const metricDef = METRICS.find((m) => m.key === metric);
  const trend = useMemo(() => {
    const pts = (start) => Array.from({ length: span }, (_, i) => { const d = addDays(start, i); return { day: d, label: fmtDay(d), v: metricValue(daily[d], metric) }; });
    let cur = pts(from), prev = pts(prevFrom);
    if (weekly) {
      const fold = (arr) => {
        const out = [];
        for (let i = 0; i < arr.length; i += 7) {
          const w = arr.slice(i, i + 7);
          const vs = w.map((p) => p.v).filter(isNum);
          out.push({ label: `Wk of ${w[0].label}`, v: !vs.length ? null : metricDef.last ? vs[vs.length - 1] : vs.reduce((a, b) => a + b, 0) });
        }
        return out;
      };
      cur = fold(cur);
      prev = fold(prev);
    }
    return { cur, prev };
  }, [daily, from, prevFrom, span, metric, weekly, metricDef]);

  // ── Posts table ──
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[0];
    return (inRange ? rangePosts : media || [])
      .filter((m) => typeFilter === "all" || typeOf(m) === typeFilter || (typeFilter === "wedraft" && m.postId))
      .filter((m) => !q || (m.caption || "").toLowerCase().includes(q) || (m.postName || "").toLowerCase().includes(q) || (m.playerIds || []).some((id) => (players[id] || "").toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = col.get(a), y = col.get(b);
        if (!isNum(x) && !isNum(y)) return 0;
        if (!isNum(x)) return 1;
        if (!isNum(y)) return -1;
        return (x - y) * sort.dir;
      });
  }, [media, rangePosts, inRange, typeFilter, search, sort, players]); // eslint-disable-line react-hooks/exhaustive-deps
  // The best of the shown posts by the sorted metric — marked in the table.
  const best = useMemo(() => {
    if (sort.key === "timestampMs" || sort.dir !== -1) return new Set();
    return new Set(shown.slice(0, 3).filter((m) => isNum(COLUMNS.find((c) => c.key === sort.key).get(m))).map((m) => m.id));
  }, [shown, sort]);
  const highlights = useMemo(() => {
    const pool = rangePosts.length ? rangePosts : [];
    const top = (get) => pool.filter((m) => isNum(get(m))).sort((a, b) => get(b) - get(a))[0];
    return [
      ["Most reach", top((m) => m.meta?.reach), (m) => `${fmtNum(m.meta?.reach)} reached`],
      ["Best engagement rate", top((m) => ((m.meta?.reach || 0) >= 50 ? m.calc?.engagementRate : null)), (m) => `${fmtPct(m.calc?.engagementRate)} of ${fmtNum(m.meta?.reach)}`],
      ["Most saves", top((m) => m.meta?.saved), (m) => `${fmtNum(m.meta?.saved)} saves`],
      ["Most shares", top((m) => m.meta?.shares), (m) => `${fmtNum(m.meta?.shares)} shares`],
    ].filter(([, m]) => m);
  }, [rangePosts]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncs = status?.sync || {};
  const syncLine = (op) => {
    const s = syncs[op];
    if (!s) return "never run";
    return `${s.state === "running" ? "running…" : s.state}${s.lastSuccessAt ? ` · last ok ${fmtWhen(s.lastSuccessAt)}` : ""}${s.errors?.length ? ` · ${s.errors.length} problem${s.errors.length === 1 ? "" : "s"}` : ""}`;
  };
  const noData = media && !media.length && !Object.keys(daily).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Account + sync */}
      <div style={{ ...card, display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
        {account?.picture ? <img src={account.picture} alt="" referrerPolicy="no-referrer" style={{ width: 52, height: 52, borderRadius: "50%", border: `2px solid ${GOLD}` }} /> : <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#eef2f7" }} />}
        <div>
          <div style={{ fontSize: "16px", fontWeight: 900, color: INK }}>@{account?.username || "wedraftsite"}</div>
          <div style={{ fontSize: "12px", fontWeight: 800, color: MUTED }}>{fmtNum(account?.followers)} followers · {fmtNum(account?.mediaCount)} posts{account?.at ? ` · as of ${fmtWhen(account.at)}` : ""}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "grid", gap: "4px", fontSize: "11px", fontWeight: 700, color: MUTED }}>
          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => sync("account")} disabled={!!busy} style={{ ...btn(true), opacity: busy ? 0.5 : 1 }}>{busy === "account" ? "Syncing account…" : "Sync account"}</button>
            <button onClick={() => sync("media")} disabled={!!busy} style={{ ...btn(true), opacity: busy ? 0.5 : 1 }}>{busy === "media" ? "Syncing posts…" : "Sync posts"}</button>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 800, color: "#33415a" }} title="Hourly check; each sync runs every 6 hours">
              <input type="checkbox" checked={!!status?.auto?.enabled} onChange={(e) => setAuto(e.target.checked)} /> Scheduled sync
            </label>
          </div>
          <div>Account: {syncLine("account")}</div>
          <div>Posts: {syncLine("media")}</div>
        </div>
      </div>
      {msg && <div style={{ fontSize: "12px", fontWeight: 800, color: /^Couldn't/.test(msg) || /problem/.test(msg) ? RED : GREEN }}>{msg}</div>}
      {noData && <div style={{ ...card, fontSize: "13px", fontWeight: 700, color: MUTED }}>No Instagram data yet. Run <b>Sync account</b> and <b>Sync posts</b> to load it (the first account sync reads the last 90 days).</div>}

      {/* Range */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ ...label, marginBottom: 0 }}>Range</span>
        {[7, 28, 90].map((n) => <button key={n} onClick={() => choosePreset(n)} style={btn(preset === n)}>Last {n} days</button>)}
        <input type="date" value={from} max={to} onChange={(e) => { setPreset(0); setFrom(e.target.value); }} style={field} />
        <span style={{ fontSize: "12px", color: FAINT }}>to</span>
        <input type="date" value={to} min={from} max={today} onChange={(e) => { setPreset(0); setTo(e.target.value); }} style={field} />
        <span style={{ fontSize: "11px", fontWeight: 700, color: FAINT }}>vs {fmtDay(prevFrom)} – {fmtDay(prevTo)} · Pacific days</span>
      </div>

      {/* Overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "10px" }}>
        {tiles.map((t) => (
          <button key={t.key} onClick={() => setMetric(t.key)} title={t.note || ""} style={{ ...card, textAlign: "left", cursor: "pointer", padding: "10px 12px", borderColor: metric === t.key ? BLUE : LINE, boxShadow: metric === t.key ? `inset 0 0 0 1px ${BLUE}` : "none" }}>
            <div style={label}>{t.label}<Src calc={t.calc} /></div>
            <div style={{ fontSize: "22px", fontWeight: 900, color: INK }}>{fmtCompact(t.cur.value)}</div>
            <div style={{ fontSize: "11px", fontWeight: 800, color: !isNum(t.delta) ? FAINT : t.delta >= 0 ? GREEN : RED }}>
              {t.last ? (isNum(t.delta) ? `${t.delta >= 0 ? "▲ +" : "▼ "}${fmtNum(t.delta)} vs before` : "no earlier count")
                : isNum(t.delta) ? `${t.delta >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(t.delta), 0)} vs before` : t.cur.have < t.cur.days ? `${t.cur.have} of ${t.cur.days} days` : "no comparison"}
            </div>
          </button>
        ))}
        <div style={{ ...card, padding: "10px 12px" }}>
          <div style={label}>Avg. post eng. rate<Src calc /></div>
          <div style={{ fontSize: "22px", fontWeight: 900, color: INK }}>{fmtPct(avgEr)}</div>
          <div style={{ fontSize: "11px", fontWeight: 800, color: FAINT }}>{rangePosts.length} post{rangePosts.length === 1 ? "" : "s"} in range</div>
        </div>
      </div>

      {/* Trend */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
          <div style={{ ...label, marginBottom: 0 }}>{metricDef.label} {weekly ? "by week" : "by day"}<Src calc={metricDef.calc} /></div>
          <select value={metric} onChange={(e) => setMetric(e.target.value)} style={field}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          <div style={{ display: "flex", gap: "4px" }}>{[[false, "Daily"], [true, "Weekly"]].map(([v, t]) => <button key={t} onClick={() => setWeekly(v)} style={{ ...btn(weekly === v), padding: "4px 10px" }}>{t}</button>)}</div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "12px", fontSize: "11px", fontWeight: 800, color: MUTED }}>
            <span><span style={{ display: "inline-block", width: 14, height: 2, background: BLUE, marginRight: 5, verticalAlign: "middle" }} />{fmtDay(from)} – {fmtDay(to)}</span>
            <span><span style={{ display: "inline-block", width: 14, borderTop: `2px dashed ${PREV}`, marginRight: 5, verticalAlign: "middle" }} />period before</span>
          </div>
        </div>
        {metricDef.note && <div style={{ fontSize: "11px", fontWeight: 700, color: FAINT, marginBottom: "4px" }}>{metricDef.note}</div>}
        <TrendChart cur={trend.cur} prev={trend.prev} fmt={fmtNum} />
        <details style={{ marginTop: "6px" }}>
          <summary style={{ fontSize: "11px", fontWeight: 800, color: BLUE, cursor: "pointer" }}>Table</summary>
          <table style={{ fontSize: "11px", fontWeight: 700, color: INK, borderCollapse: "collapse", marginTop: "4px" }}>
            <thead><tr><th style={{ textAlign: "left", padding: "2px 10px 2px 0" }}>{weekly ? "Week" : "Day"}</th><th style={{ textAlign: "right", padding: "2px 10px" }}>{metricDef.label}</th><th style={{ textAlign: "right", padding: "2px 10px" }}>Before</th></tr></thead>
            <tbody>{trend.cur.map((p, i) => <tr key={i}><td style={{ padding: "1px 10px 1px 0" }}>{p.label}</td><td style={{ textAlign: "right", padding: "1px 10px" }}>{fmtNum(p.v)}</td><td style={{ textAlign: "right", padding: "1px 10px", color: MUTED }}>{fmtNum(trend.prev[i]?.v)}</td></tr>)}</tbody>
          </table>
        </details>
      </div>

      {/* Audience */}
      <div style={card}>
        <div style={{ ...label, display: "flex" }}>Audience · this month<Src /><span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontWeight: 700 }}>{demo?.at ? `as of ${fmtWhen(demo.at)}` : "not synced yet"} · Meta needs 100+ followers; top 45 only</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "16px", marginTop: "6px" }}>
          {[["Followers by age", demo?.follower?.age], ["Followers by gender", demo?.follower?.gender, (k) => ({ M: "Men", F: "Women", U: "Unknown" }[k] || k)], ["Followers by country", demo?.follower?.country], ["Followers by city", demo?.follower?.city], ["Engaged audience by age", demo?.engaged?.age], ["Engaged audience by country", demo?.engaged?.country]].map(([t, rows, fk]) => (
            <div key={t}>
              <div style={{ fontSize: "11px", fontWeight: 900, color: INK, marginBottom: "4px" }}>{t}</div>
              <Bars rows={t.includes("age") ? [...(rows || [])].sort((a, b) => (a.key < b.key ? -1 : 1)) : rows} total={(rows || []).reduce((a, r) => a + r.value, 0)} fmtKey={fk} max={t.includes("age") ? 8 : 6} />
            </div>
          ))}
        </div>
      </div>

      {/* Highlights */}
      {highlights.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "10px" }}>
          {highlights.map(([t, m, line]) => (
            <button key={t} onClick={() => setOpen(m)} style={{ ...card, display: "flex", gap: "10px", alignItems: "center", textAlign: "left", cursor: "pointer", padding: "8px 10px" }}>
              {m.thumb ? <img src={m.thumb} alt="" referrerPolicy="no-referrer" style={{ width: 44, height: 55, objectFit: "cover", borderRadius: "5px", flexShrink: 0 }} /> : <div style={{ width: 44, height: 55, background: "#0b1426", borderRadius: "5px", flexShrink: 0 }} />}
              <div style={{ minWidth: 0 }}>
                <div style={label}>{t} · in range</div>
                <div style={{ fontSize: "12px", fontWeight: 900, color: INK }}>{line(m)}</div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.caption || TYPE_LABEL[typeOf(m)]}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Posts */}
      <div style={card}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" }}>
          <div style={{ ...label, marginBottom: 0 }}>Posts · {shown.length}</div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={field}>
            <option value="all">All types</option><option value="IMAGE">Images</option><option value="CAROUSEL_ALBUM">Carousels</option><option value="REELS">Reels</option><option value="VIDEO">Videos</option><option value="wedraft">Published from We-Draft</option>
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
            <input type="checkbox" checked={inRange} onChange={(e) => setInRange(e.target.checked)} /> Posted in range only
          </label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search captions, posts, players…" style={{ ...field, minWidth: "200px", flex: "1 1 200px" }} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", fontWeight: 700, color: INK }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                <th style={{ textAlign: "left", padding: "6px 4px", ...label }}>Post</th>
                <th style={{ textAlign: "left", padding: "6px 4px", ...label }}>Type</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))} style={{ textAlign: "right", padding: "6px 4px", cursor: "pointer", whiteSpace: "nowrap", ...label, color: sort.key === c.key ? BLUE : FAINT }}>
                    {c.label}{c.calc && <Src calc />}{sort.key === c.key ? (sort.dir === -1 ? " ▼" : " ▲") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {media == null && <tr><td colSpan={COLUMNS.length + 2} style={{ padding: "8px", color: FAINT }}>Loading…</td></tr>}
              {shown.map((m) => (
                <tr key={m.id} onClick={() => setOpen(m)} style={{ borderBottom: `1px solid ${LINE}`, cursor: "pointer", background: best.has(m.id) ? "#fff8ea" : undefined }}>
                  <td style={{ padding: "5px 4px", maxWidth: "280px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {m.thumb ? <img src={m.thumb} alt="" referrerPolicy="no-referrer" loading="lazy" style={{ width: 36, height: 45, objectFit: "cover", borderRadius: "4px", flexShrink: 0 }} /> : <div style={{ width: 36, height: 45, background: "#0b1426", borderRadius: "4px", flexShrink: 0 }} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{best.has(m.id) && <span title="Top 3 by this column" style={{ color: "#b86e00" }}>★ </span>}{m.caption || <span style={{ color: FAINT }}>No caption</span>}</div>
                        {m.postId && <div style={{ fontSize: "10px", fontWeight: 800, color: BLUE, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>We-Draft · {m.playerIds?.length ? m.playerIds.map((id) => players[id] || id).join(", ") : m.postName}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "5px 4px", color: MUTED, whiteSpace: "nowrap" }}>{TYPE_LABEL[typeOf(m)]}</td>
                  {COLUMNS.map((c) => <td key={c.key} style={{ padding: "5px 4px", textAlign: "right", whiteSpace: "nowrap", color: sort.key === c.key ? INK : "#33415a" }}>{(c.fmt || fmtNum)(c.get(m))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: "10px", fontWeight: 700, color: FAINT, marginTop: "6px" }}>
          Meta's lifetime totals per post, refreshed by Sync posts (new posts every sync, older ones less often). Eng. rate = (likes + comments + saves + shares) ÷ reach — one denominator for every post. Click a post for its detail.
        </div>
      </div>
      {open && <PostDetail m={open} players={players} onClose={() => setOpen(null)} />}
    </div>
  );
}
