// src/pages/HomeHero.js
//
// The Home page's top (shared by both designs) and its <Helmet> tags: the
// hero (logo, headline, the Draft Sim front and center, sign-up), the
// community's No. 1 prospect beside it, then the quick-link cards. Home.js
// renders this immediately, before config/home has said which design is
// live, so the page has its header on the first paint. Only one quick link
// depends on the mode: in-season swaps We-Pick in for Watch. Until the mode
// resolves, Home.js passes its best guess. Styles: homeStyle.js (.hx-*).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import logo from "../assets/Logo2.png";
import { SIM_YEAR } from "../utils/draftSim/years";
import { wePickHref } from "../utils/wePickRoutes";
import { useAuth } from "../context/AuthContext";
import { topProspects, gradeLabel, gradeLook } from "../utils/communityGrades";
import { loadPhotos } from "../utils/profileHub";

const SITE_TITLE = "We-Draft.com - NFL Draft Scouting Reports, Rankings & Mock Drafts";
const SITE_DESCRIPTION = "Build your NFL Draft board, read scouting reports, compare community evaluations, create mock drafts, and follow thousands of college football prospects with rankings, film links, measurable data, and the latest draft news.";
const SITE_URL = "https://we-draft.com/";

// 24px line icons for the quick links.
const I = {
  sim: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9.5 2.5h5M12 2.5V5" /></>,
  eval: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5M8.5 11l2 2 4-4M8.5 17h7" /></>,
  mocks: <><path d="M4 6h10M4 12h16M4 18h12" /><circle cx="18" cy="6" r="2" /></>,
  nfl: <><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="M9 12h6M12 9v6" /></>,
  cfb: <><path d="M2 9 12 4l10 5-10 5z" /><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v5" /></>,
  watch: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>,
  pick: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5 11 15l5-6" /></>,
};
const Icon = ({ name }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[name]}</svg>
);

function quickLinks(inSeason) {
  return [
    { label: "Draft Simulator", sub: "Make every pick, live", to: "/draftsim", icon: "sim", hot: true },
    { label: "Evaluate Players", sub: "Grade every prospect", to: "/community", icon: "eval" },
    { label: "Mock Drafts", sub: "Weekly mocks and yours", to: "/mocks", icon: "mocks" },
    { label: "NFL Teams", sub: "Rosters, needs and picks", to: "/nfl", icon: "nfl" },
    { label: "Colleges", sub: "Prospects by school", to: "/cfb", icon: "cfb" },
    inSeason
      ? { label: "We-Pick", sub: "Predict this week's games", to: wePickHref(), icon: "pick" }
      : { label: "Watch", sub: "Player film, one after another", to: "/watch", icon: "watch" },
  ];
}

// The community's No. 1 prospect in the sim's class, with his headshot.
function useFeatured() {
  const [p, setP] = useState(undefined);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const top = (await topProspects([String(SIM_YEAR)]))?.[0];
        if (!top) { if (alive) setP(null); return; }
        const photos = await loadPhotos([top.id]).catch(() => ({}));
        if (alive) setP({ ...top, headshot: photos[top.id]?.headshot || "" });
      } catch {
        if (alive) setP(null);
      }
    })();
    return () => { alive = false; };
  }, []);
  return p;
}

function Featured() {
  const p = useFeatured();
  const [imgOk, setImgOk] = useState(true);
  if (p === undefined) return <div className="hx-feature-skel" aria-hidden="true" />;
  if (p === null) return null;
  const grade = gradeLabel(p.avgGrade);
  const look = grade ? gradeLook(grade) : null;
  return (
    <Link to={`/player/${p.Slug}`} className="hx-feature" aria-label={`${p.First} ${p.Last}, No. 1 on the ${SIM_YEAR} community board`}>
      <div className="hx-feature-body">
        <div className="hx-feature-top">
          <span className="hx-feature-num">#1</span>
          <span className="hx-feature-tag">{SIM_YEAR} Community<br />Big Board</span>
        </div>
        <div className="hx-feature-name">{p.First} {p.Last}</div>
        <div className="hx-feature-meta">
          {p.Position && <span className="hx-pos">{p.Position}</span>}
          <span>{p.School}</span>
        </div>
        <div className="hx-feature-foot">
          {look && <span className="hx-feature-grade" style={{ background: look.bg }}>{grade}</span>}
          <span className="hx-feature-cta">See his evaluations →</span>
        </div>
      </div>
      <div className="hx-feature-photo">
        {p.headshot && imgOk && <img className="hx-feature-img" src={p.headshot} alt="" onError={() => setImgOk(false)} />}
      </div>
    </Link>
  );
}

export default function HomeHero({ mode }) {
  const inSeason = mode === "inseason";
  const { user, login } = useAuth();

  return (
    <>
      <Helmet>
        <title>{SITE_TITLE}</title>
        <meta name="description" content={SITE_DESCRIPTION} />
        <link rel="canonical" href={SITE_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={SITE_TITLE} />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={SITE_TITLE} />
        <meta name="twitter:description" content={SITE_DESCRIPTION} />
      </Helmet>

      <section className="hx-hero">
        <div>
          <img src={logo} alt="We-Draft.com" className="hx-logo" />
          <div><Link to="/draftsim" className="hx-eyebrow"><b>Live</b> The {SIM_YEAR} Mock Draft Simulator →</Link></div>
          <h1 className="hx-h1">Football. <span>Your way.</span></h1>
          <p className="hx-lede">
            Grade every prospect, build your own big board, run the {SIM_YEAR} NFL Draft pick by pick, and see how your rankings stack up against the We-Draft community.
          </p>
          <div className="hx-ctas">
            <Link to="/draftsim" className="hx-btn hx-btn-gold">Run the Mock Draft Simulator</Link>
            {user
              ? <Link to="/boards" className="hx-btn hx-btn-ghost">My Boards</Link>
              : <button type="button" onClick={login} className="hx-btn hx-btn-ghost">Join free</button>}
          </div>
          <div className="hx-fine">
            {user
              ? <>Welcome back. Pick up where you left off on the <Link to="/community">Community Board</Link>.</>
              : "Free with Google or email. No spam."}
          </div>
        </div>
        <Featured />
      </section>

      <nav className="hx-quick" aria-label="Explore We-Draft">
        {quickLinks(inSeason).map((q) => (
          <Link key={q.label} to={q.to} className={`hx-ql${q.hot ? " hot" : ""}`}>
            <span className="hx-ql-icon"><Icon name={q.icon} /></span>
            <span className="hx-ql-title">{q.label}{q.hot && <span className="hx-new">NEW</span>}</span>
            <span className="hx-ql-sub">{q.sub}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
