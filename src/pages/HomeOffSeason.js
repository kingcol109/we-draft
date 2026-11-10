// src/pages/HomeOffSeason.js
//
// The Home page design shown outside the CFB season. Home.js (a thin router,
// not this file) reads config/home.mode in Firestore (toggled in
// AdminPanel.js's Misc Branding tab) and renders this or HomeInSeason.js.
// Below the shared hero (HomeHero.js), three columns: recent public
// evaluations on the left, the community big board (2027 / 2028 tabs) in
// the middle, the latest news on the right. On a wide screen Home.js moves
// the evaluations and the news out into the page's side margins instead
// (rails) and the board takes the middle. Then the newest videos, @wedraftsite's Instagram (HomeInstagram.jsx) and, for visitors
// who aren't signed in, a sign-up band. Styles: homeStyle.js (.hx-*).
import { useEffect, useState } from "react";
import { getDoc, doc, getDocs, collection, query, where, orderBy, limit } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import verifiedBadge from "../assets/verified.png";
import { topProspects, gradeLabel, gradeLook } from "../utils/communityGrades";
import { fetchRecentPublicEvals } from "../utils/recentEvaluations";
import { loadWeeklyMockNews } from "../utils/weeklyMockNews";
import { loadPhotos } from "../utils/profileHub";
import { useAuth } from "../context/AuthContext";
import HomeInstagram from "./HomeInstagram";

const BOARD_YEARS = ["2027", "2028"];
const boardHref = (year) => (year === BOARD_YEARS[0] ? "/community" : `/community/${year}`);
const ytId = (url = "") => (url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/) || [])[1] || "";
const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);
const initials = (name = "") => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function Grade({ label }) {
  if (!label) return null;
  const g = gradeLook(label);
  return (
    <span className="hx-grade" style={{ background: g.bg }} title={label}>
      <small>{g.qualifier || (label === "UDFA" ? "UNDRAFTED" : "ROUND")}</small>
      <b>{g.short}</b>
    </span>
  );
}

function Avatar({ src, name }) {
  const [ok, setOk] = useState(true);
  return (
    <span className="hx-avatar" aria-hidden="true">
      {src && ok ? <img src={src} alt="" loading="lazy" onError={() => setOk(false)} /> : initials(name)}
    </span>
  );
}

function SectionHead({ kicker, title, id, children }) {
  return (
    <div className="hx-sechead">
      <div>
        {kicker && <div className="hx-kicker">{kicker}</div>}
        <h2 className="hx-h2" id={id}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ── The community big board: the top 10 of a class, 1–5 down the left column, 6–10 down the right. ──
function BigBoard() {
  const [year, setYear] = useState(BOARD_YEARS[0]);
  const [boards, setBoards] = useState(null);
  const [photos, setPhotos] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const lists = await Promise.all(BOARD_YEARS.map((y) => topProspects([y]).catch(() => null)));
      const next = Object.fromEntries(BOARD_YEARS.map((y, i) => [y, (lists[i] || []).slice(0, 10)]));
      if (!alive) return;
      setBoards(next);
      const ids = Object.values(next).flat().map((p) => p.id);
      if (ids.length) loadPhotos(ids).then((ph) => alive && setPhotos(ph)).catch(() => {});
    })();
    return () => { alive = false; };
  }, []);

  const rows = boards?.[year] || [];
  return (
    <section className="hx-boardcol" aria-labelledby="hx-board-title">
      <SectionHead kicker="Community Rankings" title="The Big Board" id="hx-board-title">
        <div className="hx-tabs" role="tablist" aria-label="Draft class">
          {BOARD_YEARS.map((y) => (
            <button key={y} type="button" role="tab" aria-selected={y === year} className="hx-tab" onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
      </SectionHead>
      <div className="hx-card">
        {!boards ? (
          <div className="hx-board">{Array.from({ length: 10 }, (_, i) => <div key={i} className="hx-prow"><div className="hx-skel" style={{ height: 46, width: "100%" }} /></div>)}</div>
        ) : rows.length ? (
          <div className="hx-board" role="tabpanel" aria-label={`${year} top 10`}>
            {rows.map((p, i) => {
              const name = `${p.First || ""} ${p.Last || ""}`.trim();
              return (
                <Link key={p.id} to={`/player/${p.Slug}`} className="hx-prow">
                  <span className={`hx-rank${i < 3 ? " top" : ""}`}>{i + 1}</span>
                  <Avatar src={photos[p.id]?.headshot} name={name} />
                  <span className="hx-pmain">
                    <span className="hx-pname" style={{ display: "block" }}>{name}</span>
                    <span className="hx-psub">
                      {p.Position && <span className="hx-pos">{p.Position}</span>}
                      <span className="hx-school">{p.School || "—"}</span>
                    </span>
                  </span>
                  <Grade label={gradeLabel(p.avgGrade)} />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="hx-empty">The {year} class awaits. <Link to={boardHref(year)} className="hx-more">Be the first to grade it →</Link></div>
        )}
        <div className="hx-boardfoot">
          <span>Ranked by the community's average grade</span>
          <Link to={boardHref(year)} className="hx-btn hx-btn-blue hx-btn-sm">Full {year} board →</Link>
        </div>
      </div>
    </section>
  );
}

// ── The latest news, articles and Weekly Mocks (published date only, never last-updated). ──
export function Latest() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      getDocs(query(collection(db, "news"), where("active", "==", true), orderBy("publishedAt", "desc"), limit(6)))
        .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data(), kind: "News" }))).catch(() => []),
      getDocs(query(collection(db, "articles"), where("status", "==", "published"), orderBy("publishedAt", "desc"), limit(6)))
        .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data(), kind: "Article" }))).catch(() => []),
      loadWeeklyMockNews(6).then((w) => w.map((m) => ({ ...m, kind: "Weekly Mock" }))),
    ]).then((all) => {
      if (!alive) return;
      setItems(all.flat().sort((a, b) => tsMs(b.publishedAt) - tsMs(a.publishedAt)).slice(0, 6));
    });
    return () => { alive = false; };
  }, []);

  return (
    <section className="hx-newscol" aria-labelledby="hx-news-title">
      <SectionHead kicker="Draft News" title="Latest" id="hx-news-title">
        <Link to="/news" className="hx-more">All news →</Link>
      </SectionHead>
      <div className="hx-card hx-news">
        {!items ? Array.from({ length: 5 }, (_, i) => <div key={i} className="hx-nrow"><div className="hx-skel" style={{ height: 44, width: "100%" }} /></div>)
          : items.length ? items.map((n) => {
            const d = tsMs(n.publishedAt) ? new Date(tsMs(n.publishedAt)) : null;
            return (
              <Link key={n.id} to={n.href || `/news/${n.slug}`} className="hx-nrow">
                {d && (
                  <span className="hx-ndate"><small>{d.toLocaleDateString(undefined, { month: "short" })}</small><b>{d.getDate()}</b></span>
                )}
                <span style={{ minWidth: 0 }}>
                  <span className="hx-ntype">{n.kind}</span>
                  <span className="hx-ntitle" style={{ display: "block" }}>{n.title}</span>
                  {(n.summary || n.seoDescription) && <span className="hx-nsum">{n.summary || n.seoDescription}</span>}
                </span>
              </Link>
            );
          }) : <div className="hx-empty">No news yet</div>}
      </div>
    </section>
  );
}

// ── The newest public evaluations. ──
export function RecentEvals({ max = 3 }) {
  const [evals, setEvals] = useState(null);
  const [photos, setPhotos] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchRecentPublicEvals(max);
        const uids = [...new Set(list.map((e) => e.uid).filter(Boolean))];
        const users = {};
        await Promise.all(uids.map((uid) => getDoc(doc(db, "users", uid)).then((s) => {
          if (s.exists()) users[uid] = { username: s.data().username || "Anonymous User", verified: !!s.data().verified };
        }).catch(() => {})));
        if (!alive) return;
        setEvals(list.map((e) => ({ ...e, username: users[e.uid]?.username || "Anonymous User", verified: users[e.uid]?.verified || false })));
        const ids = [...new Set(list.map((e) => e.playerId).filter(Boolean))];
        if (ids.length) loadPhotos(ids).then((ph) => alive && setPhotos(ph)).catch(() => {});
      } catch {
        if (alive) setEvals([]);
      }
    })();
    return () => { alive = false; };
  }, [max]);

  if (evals && !evals.length) return null;
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return (
    <section className="hx-evalcol" aria-labelledby="hx-evals-title">
      <SectionHead kicker="From the Community" title="Recent Evals" id="hx-evals-title">
        <Link to="/community" className="hx-more">Community →</Link>
      </SectionHead>
      <div className="hx-evals">
        {!evals ? Array.from({ length: 3 }, (_, i) => <div key={i} className="hx-card hx-skel" style={{ height: 220 }} />)
          : evals.map((ev, i) => (
            <article key={`${ev.playerId}-${ev.uid}-${i}`} className="hx-card hx-eval">
              <div className="hx-evhead">
                <Avatar src={photos[ev.playerId]?.headshot} name={ev.playerName} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/player/${ev.playerSlug}`} className="hx-evplayer">{ev.playerName}</Link>
                  <div className="hx-evby">by {ev.username}{ev.verified && <img src={verifiedBadge} alt="Verified" />}</div>
                </div>
                <Grade label={ev.grade} />
              </div>
              {ev.evaluation && <p className="hx-evtext">“{ev.evaluation}”</p>}
              {(list(ev.strengths).length > 0 || list(ev.weaknesses).length > 0) && (
                <div className="hx-chips">
                  {list(ev.strengths).slice(0, 3).map((s) => <span key={`s-${s}`} className="hx-chip s">+ {s}</span>)}
                  {list(ev.weaknesses).slice(0, 1).map((w) => <span key={`w-${w}`} className="hx-chip w">− {w}</span>)}
                </div>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}

// ── The newest videos (not Shorts; a scheduled one stays hidden until its PublishAt). ──
function Videos() {
  const [videos, setVideos] = useState(null);
  useEffect(() => {
    let alive = true;
    getDocs(query(collection(db, "videos"), orderBy("Date", "desc"), limit(20))).then((snap) => {
      const now = Date.now();
      const vids = snap.docs.map((d) => {
        const v = d.data();
        const first = Array.isArray(v.items) ? v.items[0] : null;
        const id = ytId(v.Video);
        return {
          id: d.id, href: v.Video || "", date: tsMs(v.Date), short: v.Short === true,
          title: v.GenTitle || first?.title || "",
          thumb: v.GenThumb || first?.thumb || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ""),
          publishAt: tsMs(v.PublishAt),
        };
      }).filter((v) => v.href && !v.short && v.title && (!v.publishAt || v.publishAt <= now)).slice(0, 4);
      if (alive) setVideos(vids);
    }).catch(() => alive && setVideos([]));
    return () => { alive = false; };
  }, []);

  if (videos && !videos.length) return null;
  return (
    <section className="hx-section" aria-labelledby="hx-videos-title">
      <SectionHead kicker="Film Room" title="Latest Videos" id="hx-videos-title">
        <a href="https://www.youtube.com/@kingcoldsports" target="_blank" rel="noopener noreferrer" className="hx-more">YouTube channel →</a>
      </SectionHead>
      <div className="hx-videos">
        {!videos ? Array.from({ length: 4 }, (_, i) => <div key={i} className="hx-card hx-skel" style={{ aspectRatio: "16 / 12" }} />)
          : videos.map((v) => (
            <a key={v.id} href={v.href} target="_blank" rel="noopener noreferrer" className="hx-card hx-video">
              <span className="hx-vthumb">
                {v.thumb && <img src={v.thumb} alt="" loading="lazy" />}
                <span className="hx-play"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg></span>
              </span>
              <span className="hx-vbody">
                <span className="hx-vtitle">{v.title}</span>
                {v.date > 0 && <span className="hx-vdate" style={{ display: "block" }}>{new Date(v.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
              </span>
            </a>
          ))}
      </div>
    </section>
  );
}

function JoinBand() {
  const { user, login } = useAuth();
  if (user) return null;
  return (
    <section className="hx-band" aria-label="Join We-Draft">
      <div>
        <h3>Your board. <span>Your grades.</span></h3>
        <p>Join free to grade the {BOARD_YEARS[0]} class, save your big boards and mock drafts, and get your evaluations in front of the community.</p>
      </div>
      <button type="button" onClick={login} className="hx-btn hx-btn-gold">Join free</button>
    </section>
  );
}

// rails: Home.js has put Recent Evals and Latest in the page's side
// margins (wide screens), so the board has the middle to itself.
export default function HomeOffSeason({ rails = false }) {
  return (
    <>
      <div className={`hx-section hx-three${rails ? " solo" : ""}`}>
        {!rails && <RecentEvals />}
        <BigBoard />
        {!rails && <Latest />}
      </div>
      <Videos />
      <HomeInstagram />
      <JoinBand />
    </>
  );
}
