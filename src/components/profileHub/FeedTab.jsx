// src/components/profileHub/FeedTab.jsx
//
// The profile hub's Feed tab (the hub's default): what's new for the players
// and teams the user follows (utils/profileFeed.js builds it), each row
// saying which follow put it there, the ones newer than their last visit
// marked NEW. Customize feed: the topics it shows (College Football, NFL &
// Weekly Mocks, each draft class), saved to the account. Opening it clears
// the "new" count on the navbar's Profile link and the Feed tab.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import LoadingSpinner from "../LoadingSpinner";
import useHubFollowing from "./useHubFollowing";
import { buildFeed, loadHubPrefs, saveHubTopics, markFeedSeen, showsFor, HUB_TOPICS } from "../../utils/profileFeed";

const BLUE = "#0055a5";
const MUTED = "#5b6b84";
const KINDS = {
  mock: ["Weekly Mock", "#fff3dc", "#a46400"],
  game: ["Game", "#e8f6ee", "#15803d"],
  video: ["Video", "#fdecec", "#c0392b"],
  article: ["Article", "#e8f0fb", BLUE],
};
const shortDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Thumb({ thumb, isMobile }) {
  const w = isMobile ? 78 : 96;
  const h = isMobile ? 50 : 60;
  return (
    <span style={{ position: "relative", flexShrink: 0, width: w, height: h, borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: thumb.bg || "#e9eef5" }}>
      {thumb.src && (
        <img src={thumb.src} alt="" style={thumb.fit === "logo"
          ? { width: h * 0.7, height: h * 0.7, maxWidth: "none", objectFit: "contain" }
          : { width: "100%", height: "100%", maxWidth: "none", objectFit: thumb.fit === "headshot" ? "contain" : "cover", objectPosition: "bottom" }} />
      )}
      {thumb.play && <span style={{ position: "absolute", width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</span>}
    </span>
  );
}

function Customize({ topics, onChange }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", padding: "12px 16px", marginBottom: 12 }}>
      <div style={{ font: "900 11px Arial, sans-serif", letterSpacing: ".12em", textTransform: "uppercase", color: "#8a95a5", marginBottom: 6 }}>Show in my feed</div>
      {HUB_TOPICS.map(([k, label, note]) => (
        <label key={k} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderTop: "1px solid #eef1f5", cursor: "pointer" }}>
          <input type="checkbox" checked={topics[k] !== false} onChange={(e) => onChange({ ...topics, [k]: e.target.checked })} style={{ marginTop: 3, width: 16, height: 16, accentColor: BLUE }} />
          <span>
            <b style={{ display: "block", font: "900 14px Arial, sans-serif", color: "#0f1b2d" }}>{label}</b>
            <span style={{ font: "700 12px Arial, sans-serif", color: MUTED }}>{note}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export default function FeedTab({ uid, isMobile, onSeen }) {
  const data = useHubFollowing(uid);
  const [items, setItems] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    let live = true;
    loadHubPrefs(uid).then((p) => {
      if (!live) return;
      setPrefs(p);
      // Seen now — the NEW marks stay for this visit (prefs.seenAt is the last one).
      markFeedSeen(uid).then(() => onSeen && onSeen()).catch(() => {});
    });
    return () => { live = false; };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data) return undefined;
    let live = true;
    buildFeed(data).then((list) => { if (live) setItems(list); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [data]);
  const setTopics = (topics) => {
    setPrefs((p) => ({ ...p, topics }));
    saveHubTopics(uid, topics).catch(() => {});
  };

  const bar = (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
      <button onClick={() => setCustom((v) => !v)} aria-expanded={custom} style={{ border: "1px solid #d8e0ea", background: custom ? BLUE : "#fff", color: custom ? "#fff" : BLUE, borderRadius: 999, padding: "6px 14px", font: "900 11px Arial, sans-serif", letterSpacing: ".08em", textTransform: "uppercase", cursor: "pointer" }}>
        ⚙ Customize feed
      </button>
    </div>
  );
  if (!data || !items || !prefs) return <LoadingSpinner label="Loading your feed" size={32} minHeight="30vh" />;
  const shown = items.filter(showsFor(prefs.topics));
  const following = data.players.length + data.college.length + data.nfl.length;
  return (
    <div>
      {bar}
      {custom && <Customize topics={prefs.topics} onChange={setTopics} />}
      {!shown.length ? (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", padding: "22px 18px", font: "700 14px/1.5 Arial, sans-serif", color: MUTED }}>
          {!following
            ? <>Follow players and teams to fill your feed: hit <b>Follow</b> on a player&apos;s page, a college team&apos;s page or an <Link to="/nfl" style={{ color: BLUE }}>NFL team&apos;s page</Link>.</>
            : items.length ? "Nothing here with the topics you've picked. Turn more on under Customize feed."
              : "Nothing new for the players and teams you follow yet. Game lines, mock updates, videos and articles show up here as they happen."}
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)", overflow: "hidden" }}>
          {shown.map((it, i) => {
            const [label, bg, color] = KINDS[it.kind];
            const isNew = prefs.seenAt && it.at > prefs.seenAt;
            const body = (
              <div style={{ display: "flex", gap: 12, alignItems: "center", padding: isMobile ? "12px" : "14px 16px", borderTop: i ? "1px solid #eef1f5" : "none", background: isNew ? "#fbfdff" : "transparent" }}>
                <Thumb thumb={it.thumb} isMobile={isMobile} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, font: "900 10px Arial, sans-serif", letterSpacing: ".1em", textTransform: "uppercase", color: "#8a95a5" }}>
                    {isNew && <span style={{ flexShrink: 0, background: "#c0392b", color: "#fff", borderRadius: 4, padding: "1px 5px", letterSpacing: ".08em" }}>NEW</span>}
                    {it.whyLogo && <img src={it.whyLogo} alt="" style={{ width: 14, height: 14, maxWidth: "none", objectFit: "contain" }} />}
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[it.why, shortDate(it.at)].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div style={{ font: `900 ${isMobile ? 14 : 15}px/1.25 Arial, sans-serif`, color: "#0f1b2d", marginTop: 3 }}>{it.title}</div>
                  {it.sub && <div style={{ font: "700 12px Arial, sans-serif", color: MUTED, marginTop: 3 }}>{it.sub}</div>}
                </div>
                {!isMobile && <span style={{ flexShrink: 0, font: "900 9px Arial, sans-serif", letterSpacing: ".1em", textTransform: "uppercase", borderRadius: 999, padding: "3px 8px", background: bg, color }}>{label}</span>}
              </div>
            );
            if (it.href) return <a key={it.key} href={it.href} target="_blank" rel="noopener noreferrer" style={{ display: "block", textDecoration: "none" }}>{body}</a>;
            return it.to ? <Link key={it.key} to={it.to} style={{ display: "block", textDecoration: "none" }}>{body}</Link> : <div key={it.key}>{body}</div>;
          })}
        </div>
      )}
    </div>
  );
}
