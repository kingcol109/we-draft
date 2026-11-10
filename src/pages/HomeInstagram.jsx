// src/pages/HomeInstagram.jsx
//
// The Home page's Instagram section: @wedraftsite's latest posts, from
// config/instagramFeed — written every hour by the Instagram cron
// (server/instagram/feed.js), never fetched from Instagram in the browser.
// One read. Instagram's image links expire after a few days, so a tile
// whose image fails is dropped; the section hides itself if none are left.
// Styles: homeStyle.js (.hx-ig*).
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

const PROFILE = "https://www.instagram.com/wedraftsite";

const KindIcon = ({ kind }) => {
  if (kind === "carousel") return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-label="Carousel"><path d="M7 3h11a3 3 0 0 1 3 3v11h-2V6a1 1 0 0 0-1-1H7z" /><rect x="3" y="7" width="14" height="14" rx="2.5" /></svg>
  );
  if (kind === "reel" || kind === "video") return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-label="Video"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
  );
  return null;
};

const fmtFollowers = (n) => (n == null ? null : n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : n.toLocaleString());

export default function HomeInstagram({ max = 12 }) {
  const [feed, setFeed] = useState(null);
  const [broken, setBroken] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    getDoc(doc(db, "config", "instagramFeed"))
      .then((s) => { if (alive) setFeed(s.exists() ? s.data() : { items: [] }); })
      .catch(() => { if (alive) setFeed({ items: [] }); });
    return () => { alive = false; };
  }, []);

  const items = (feed?.items || []).filter((m) => m.image && !broken.has(m.id)).slice(0, max);
  if (feed && !items.length) return null;

  const handle = feed?.username || "wedraftsite";
  const followers = fmtFollowers(feed?.followers);

  return (
    <section className="hx-section" aria-labelledby="hx-ig-title">
      <div className="hx-sechead">
        <div className="hx-ighead">
          <a href={PROFILE} target="_blank" rel="noopener noreferrer" className="hx-igpic" aria-label={`@${handle} on Instagram`}>
            {feed?.picture ? <img src={feed.picture} alt="" loading="lazy" /> : <span />}
          </a>
          <div>
            <div className="hx-kicker">On Instagram</div>
            <h2 className="hx-h2" id="hx-ig-title" style={{ margin: 0 }}>
              <a href={PROFILE} target="_blank" rel="noopener noreferrer">@{handle}</a>
            </h2>
            {followers && <div className="hx-igmeta">{followers} followers · mock drafts, film and prospect breakdowns</div>}
          </div>
        </div>
        <a href={PROFILE} target="_blank" rel="noopener noreferrer" className="hx-btn hx-btn-ig hx-btn-sm">Follow on Instagram</a>
      </div>

      <div className="hx-iggrid">
        {feed ? items.map((m) => (
          <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" className="hx-igtile" aria-label={m.caption ? `Instagram post: ${m.caption}` : "Instagram post"}>
            <img src={m.image} alt="" loading="lazy" referrerPolicy="no-referrer"
              onError={() => setBroken((b) => new Set(b).add(m.id))} />
            <span className="hx-igkind"><KindIcon kind={m.kind} /></span>
            {m.caption && <span className="hx-igcap"><span>{m.caption}</span></span>}
          </a>
        )) : Array.from({ length: 6 }, (_, i) => <div key={i} className="hx-igtile hx-skel" />)}
      </div>
    </section>
  );
}
