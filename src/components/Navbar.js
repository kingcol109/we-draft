import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useEffect, useRef, useState } from "react";
import Logo2 from "../assets/Logo2.png";
import SiteFullscreenButton, { useSiteFullscreen } from "./SiteFullscreenButton";
import NavMenu, { NavMenuItem } from "./NavMenu";

import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { doc as fsDoc, onSnapshot as fsOnSnapshot } from "firebase/firestore";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { fetchNflBranding } from "../utils/draftProfileData";
import { NFL_DIVISIONS } from "./NFLTeamRail";
import { countNewFeed } from "../utils/profileFeed";
import { countUnreadMessages } from "../utils/userMessages";

const FALLBACK_MESSAGE =
  "WELCOME TO WE-DRAFT.COM - CREATE DRAFT EVALUATIONS, VIEW COMMUNITY GRADES, DISCOVER HIDDEN GEMS, AND MORE - FOLLOW US ON INSTAGRAM AND X @WEDRAFTSITE FOR DAILY DRAFT CONTENT";

const conferenceOrder = [
  "ACC", "Big 10", "Big 12", "SEC", "Pac 12", "Independent",
  "AAC", "CUSA", "MAC", "Mountain West", "Sun Belt",
];

const COMMUNITY_YEARS = [
  { label: "2027 Draft Class", path: "/community",      tile: "'27", note: "This year's class" },
  { label: "2028 Draft Class", path: "/community/2028", tile: "'28", note: "Next year's class" },
  { label: "2029 Draft Class", path: "/community/2029", tile: "'29", note: "The way-early look" },
  { label: "2026 Archive",     path: "/community/2026", icon: "archive", note: "Last year's evaluations" },
];

export default function Navbar() {
  const { user, login } = useAuth();
  const location = useLocation();

  const [show, setShow] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tickerText, setTickerText] = useState(FALLBACK_MESSAGE);
  const [schools, setSchools] = useState([]);
  // The dropdowns themselves are NavMenu.jsx; these just flip true the
  // first time the CFB / NFL menu opens, to load its teams (schools read;
  // NFL logos/names from the shared _nflBranding snapshot — one cached read).
  const [cfbOpen, setCfbOpen] = useState(false);
  const [nflOpen, setNflOpen] = useState(false);
  const [nflTeams, setNflTeams] = useState(null);
  // Site full screen (desktop): the navbar tucks up out of the way behind a
  // ▼ tab at the top center that drops it back down (user, 2026-11-20).
  const siteFullscreen = useSiteFullscreen();
  const [fsNavOpen, setFsNavOpen] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("wd-fs-navhide", siteFullscreen);
    if (!siteFullscreen) setFsNavOpen(false);
    return () => html.classList.remove("wd-fs-navhide");
  }, [siteFullscreen]);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("wd-fs-navopen", siteFullscreen && fsNavOpen);
    return () => html.classList.remove("wd-fs-navopen");
  }, [siteFullscreen, fsNavOpen]);
  // Going somewhere from the dropped-down navbar tucks it back up.
  useEffect(() => { setFsNavOpen(false); }, [location.pathname]);
  // Pending incoming friend request count — shown as a sticker on the
  // Profile link (see We-Pick's own Friends-tab badge for the same idea).
  // Refetches on every route change rather than just once on sign-in:
  // Navbar stays mounted across the whole app, so a page change is the
  // closest thing it has to AdminPanel's "refetch on section change"
  // pattern — it's what catches the count dropping after accepting/
  // declining a request on the Profile or We-Pick Friends page.
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0);
  // New items in the profile hub's Feed since the user last opened it
  // (utils/profileFeed.js — cached for the session, so a page change
  // rarely reads). Added to the same Profile sticker.
  const [feedNew, setFeedNew] = useState(0);
  useEffect(() => {
    if (!user) { setFeedNew(0); return undefined; }
    let live = true;
    countNewFeed(user.uid).then((n) => { if (live) setFeedNew(n); }).catch(() => {});
    return () => { live = false; };
  }, [user, location.pathname, location.search]);
  // Unread admin replies to the user's requests/reports (utils/userMessages.js).
  const [unreadMessages, setUnreadMessages] = useState(0);
  useEffect(() => {
    if (!user) { setUnreadMessages(0); return undefined; }
    let live = true;
    countUnreadMessages(user.uid).then((n) => { if (live) setUnreadMessages(n); }).catch(() => {});
    return () => { live = false; };
  }, [user, location.pathname, location.search]);
  const profileBadge = pendingFriendRequests + feedNew + unreadMessages;
  // Games in progress right now (liveSlate/status — a tiny doc the live
  // ingester only rewrites when the count changes). >0 shows the pulsing
  // LIVE button next to the logo.
  const [liveCount, setLiveCount] = useState(0);
  useEffect(() => fsOnSnapshot(
    fsDoc(db, "liveSlate", "status"),
    (snap) => setLiveCount(snap.exists() ? snap.data().liveCount || 0 : 0),
    () => setLiveCount(0),
  ), []);

  /* ======================
     MOBILE DETECTION
  ====================== */
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  /* ======================
     SCROLL HIDE (DESKTOP)
  ====================== */
  useEffect(() => {
    if (isMobile) return;
    const handleScroll = () => {
      setShow(window.scrollY < lastScrollY || window.scrollY < 10);
      setLastScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY, isMobile]);
  const showNavbar = true;

  /* ======================
     LOAD TICKER
  ====================== */
  useEffect(() => {
    const loadTicker = async () => {
      const parts = [];
      try {
        const newsQ = query(
          collection(db, "news"),
          where("active", "==", true),
          where("priority", "==", 1),
          orderBy("publishedAt", "desc")
        );
        const newsSnap = await getDocs(newsQ);
        newsSnap.forEach((d) => {
          if (d.data().title) parts.push(`NEWS: ${d.data().title.toUpperCase()}`);
        });
      } catch {}

      try {
        const featuredSnap = await getDoc(doc(db, "config", "featured"));
        if (featuredSnap.exists()) {
          const data = featuredSnap.data();
          if (Array.isArray(data.featured)) {
            parts.push("THIS WEEK'S FEATURED PLAYERS");
            data.featured.forEach((p) => {
              let line = `${p.first || ""} ${p.last || ""}`.trim().toUpperCase();
              if (p.position && p.school) line += `, ${p.position}, ${p.school.toUpperCase()}`;
              if (p.grade) line += ` | GRADE: ${p.grade.toUpperCase()}`;
              if (p.strengths?.length) line += ` | STRENGTHS: ${p.strengths.join(", ").toUpperCase()}`;
              if (p.weaknesses?.length) line += ` | WEAKNESSES: ${p.weaknesses.join(", ").toUpperCase()}`;
              if (p.nflFit) line += ` | NFL FIT: ${p.nflFit.toUpperCase()}`;
              if (line) parts.push(line);
            });
          }
        }
      } catch {}

      // Draft-pick lines: one read from the weekly snapshot (the same
      // lines, prebuilt — see utils/snapshotBuilders.js) instead of ~64
      // draftOrder docs on every fresh page load. Falls back to the live
      // query if the snapshot is missing.
      try {
        const snap = await getSiteSnapshot("_draftTicker");
        if (snap && Array.isArray(snap.parts)) {
          parts.push(...snap.parts);
        } else {
          const draftQ = query(
            collection(db, "draftOrder"),
            where("Round", "<=", 2),
            orderBy("Round"),
            orderBy("Pick")
          );
          const draftSnap = await getDocs(draftQ);
          let currentRound = null;
          draftSnap.forEach((d) => {
            const p = d.data();
            if (p.Round !== currentRound) { currentRound = p.Round; parts.push(`ROUND ${currentRound}`); }
            parts.push(p.Selection ? `PICK ${p.Pick}: ${p.Team} ${p.Selection.toUpperCase()}` : `PICK ${p.Pick}: ${p.Team}`);
          });
        }
      } catch {}

      if (parts.length > 0) setTickerText(FALLBACK_MESSAGE + "  •  " + parts.join("  •  "));
    };
    loadTicker();
  }, []);

  /* ======================
     LOAD SCHOOLS
  ====================== */
  // Only feeds the CFB hover dropdown, so it's fetched the first time that
  // opens rather than on every page load — the Navbar mounts on every
  // route, and most visitors (especially ones landing from search) never
  // open it, so an eager read of the whole schools collection was ~240
  // reads per fresh visit for nothing. Also narrowed to just the listed
  // conferences ("in" takes up to 30 values; there are 11) instead of
  // reading every school and filtering client-side.
  const schoolsRequested = useRef(false);
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  useEffect(() => {
    if (!cfbOpen || schoolsRequested.current) return;
    schoolsRequested.current = true;
    setSchoolsLoading(true);
    getDocs(query(collection(db, "schools"), where("Conference", "in", conferenceOrder)))
      .then((snapshot) => {
        const data = snapshot.docs.map((d) => d.data());
        data.sort((a, b) => a.School.localeCompare(b.School));
        setSchools(data);
      })
      .catch((err) => {
        console.error("Error loading schools:", err);
        schoolsRequested.current = false; // let a later open retry
      })
      .finally(() => setSchoolsLoading(false));
  }, [cfbOpen]);
  useEffect(() => {
    if (!nflOpen || nflTeams) return;
    fetchNflBranding().then(setNflTeams).catch((e) => console.error("Error loading NFL teams:", e));
  }, [nflOpen, nflTeams]);

  /* ======================
     PENDING FRIEND REQUESTS (Profile badge)
  ====================== */
  useEffect(() => {
    if (!user) { setPendingFriendRequests(0); return; }
    let cancelled = false;
    getDocs(query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending")))
      .then((snap) => { if (!cancelled) setPendingFriendRequests(snap.size); })
      .catch((err) => { console.error("Navbar pending-requests count error:", err); if (!cancelled) setPendingFriendRequests(0); });
    return () => { cancelled = true; };
  }, [user, location.pathname]);

  const grouped = conferenceOrder.reduce((acc, conf) => {
    acc[conf] = schools.filter((s) => s.Conference === conf);
    return acc;
  }, {});

  // Fallback only — the real link source is each school's uploaded `Slug` field
  // (TeamSlug column in the Schools sheet). This just covers schools synced
  // before that field existed.
  const toSlug = (school) =>
    school.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");

  /* ======================
     STYLES
  ====================== */
  // Desktop links: white all-caps text on the bar, the section you're in
  // underlined in gold (onSection). Sign In is the one gold pill.
  const onSection = (...prefixes) => prefixes.some((pre) => location.pathname === pre || location.pathname.startsWith(`${pre}/`));
  const navLink = (active = false) => ({
    margin: "0 2px",
    padding: "8px 12px 6px",
    color: "#ffffff",
    background: "none",
    border: "none",
    borderBottom: `3px solid ${active ? "#f6a21d" : "transparent"}`,
    textDecoration: "none",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 800,
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    transition: "border-color 0.15s ease",
  });
  const signInStyle = {
    ...navLink(), marginLeft: "14px", padding: "9px 20px", borderBottom: "none", borderRadius: "999px",
    background: "#f6a21d", color: "#0b2545", boxShadow: "0 3px 10px rgba(0,0,0,0.2)",
  };

  return (
    <>
      <style>{`
        .wd-nav-link:hover { border-bottom-color: rgba(246,162,29,0.65) !important; }
        /* Site full screen: the navbar slides up; the tab brings it back. */
        html.wd-fs-navhide .wd-navbar-wrap { transform: translateY(-100%); }
        html.wd-fs-navhide.wd-fs-navopen .wd-navbar-wrap { transform: none; }
        html.wd-fs-navhide body { padding-top: 0; }
        .wd-fs-navtab { position: fixed; left: 50%; transform: translateX(-50%); z-index: 10002; width: 64px; height: 22px;
          display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; color: #fff;
          background: linear-gradient(180deg, #0055a5, #003a78); border: 1px solid rgba(255,255,255,0.18); border-top: none;
          border-radius: 0 0 12px 12px; box-shadow: inset 0 -2px 0 #f6a21d, 0 6px 16px rgba(0,30,70,0.3);
          transition: top .25s ease, height .15s ease, opacity .2s; opacity: .55; }
        .wd-fs-navtab:hover, .wd-fs-navtab:focus-visible, .wd-fs-navtab.is-open { opacity: 1; height: 26px; outline: none; }
        /* A sim that hides the navbar itself has its own arrow. */
        html.wd-sim-navhide .wd-fs-navtab { display: none; }
        .wd-nav-signin:hover { background: #ffb43c !important; }
        /* Phone menu: full-width rows on navy, a gold arrow on each. */
        .mobile-nav-link {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 22px;
          text-decoration: none;
          font-weight: 900;
          font-size: 15px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          background: transparent;
          color: #fff;
          border: none;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          transition: background 0.12s ease;
          font-family: inherit;
        }
        .mobile-nav-link::after { content: "›"; color: #f6a21d; font-size: 24px; line-height: 1; }
        .mobile-nav-link:active { background: rgba(255,255,255,0.06); }
        .mobile-nav-signin {
          margin: 14px 22px 0; padding: 14px; border: none; border-radius: 999px; cursor: pointer;
          background: #f6a21d; color: #0b2545; font-weight: 900; font-size: 15px; text-transform: uppercase; letter-spacing: 0.1em; font-family: inherit;
        }
      `}</style>

      {/* wd-navbar-wrap: the Draft Sim slides this away on phones while a
          draft's on, with an arrow to bring it back (DraftSim.jsx). */}
      <div
        className="wd-navbar-wrap"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10000,
          opacity: showNavbar || isMobile ? 1 : 0,
          pointerEvents: showNavbar || isMobile ? "auto" : "none",
          transition: isMobile ? "none" : "transform .25s ease, opacity 0.3s ease-in-out",
        }}
      >
        {/* ================= NAVBAR ================= */}
        <nav
          style={{
            // Navy into the site blue, a gold rule along the bottom.
            background: "linear-gradient(90deg, #003a78 0%, #0055a5 55%, #0b67c2 100%)",
            boxShadow: "inset 0 -3px 0 #f6a21d, 0 4px 18px rgba(0,30,70,0.28)",
            padding: "0.75rem 1.25rem",
            // The desktop height (42px logo + padding) everywhere — the
            // phone's scaled-down logo would make it shorter, and pages
            // like the Draft Sim sit flush against this edge.
            minHeight: 66,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
            zIndex: 10001,
          }}
        >
          {/* LOGO (+ LIVE button while games are on) */}
          {/* The logo keeps its shape: as a shrinking flex item, the global
              img max-width: 100% used to squeeze it narrower at full height.
              It's ~10:1, so on a phone it scales down as a whole to leave
              room for the hamburger (which sits over it if it still runs
              long — the LIVE button beside it). */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px", flexShrink: isMobile ? 1 : 0, minWidth: 0 }}>
            <Link to="/" style={{ display: "block", flexShrink: isMobile ? 1 : 0, minWidth: 0 }}>
              <img src={Logo2} alt="We-Draft.com" style={isMobile
                ? { height: "auto", width: "auto", maxHeight: 42, maxWidth: "calc(100vw - 2.5rem - 48px)", display: "block" }
                : { height: 42, width: "auto", maxWidth: "none", objectFit: "contain", display: "block" }} />
            </Link>
            {/* Desktop only — no room beside the logo on a phone. */}
            {liveCount > 0 && !isMobile && (
              <Link to="/live" className="wd-live-btn" title={`${liveCount} game${liveCount === 1 ? "" : "s"} live — open We-Draft Live`}>
                <span className="wd-live-dot" />LIVE
                <span className="wd-live-count">{liveCount}</span>
              </Link>
            )}
            <style>{`
              .wd-live-btn { display: inline-flex; align-items: center; gap: 7px; background: #d62828; color: #fff; font-weight: 900;
                font-size: 13px; letter-spacing: 0.12em; padding: 6px 12px 6px 10px; border-radius: 999px; text-decoration: none;
                box-shadow: 0 0 0 0 rgba(214,40,40,0.6); animation: wd-live-ring 1.8s ease-out infinite; }
              .wd-live-btn:hover { background: #b81f1f; }
              .wd-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; animation: wd-live-blink 1.2s ease-in-out infinite; }
              .wd-live-count { background: rgba(255,255,255,0.22); border-radius: 999px; padding: 1px 7px; font-size: 11px; letter-spacing: 0; }
              @keyframes wd-live-ring { 0% { box-shadow: 0 0 0 0 rgba(214,40,40,0.6); } 70% { box-shadow: 0 0 0 10px rgba(214,40,40,0); } 100% { box-shadow: 0 0 0 0 rgba(214,40,40,0); } }
              @keyframes wd-live-blink { 50% { opacity: 0.3; } }
              @media (prefers-reduced-motion: reduce) { .wd-live-btn, .wd-live-dot { animation: none; } }
              /* Centered on wide screens; on laptop widths there isn't room to
                 center without running into the logo, so it sits to its right. */
              .wd-desktop-nav { position: absolute; left: 50%; transform: translateX(-50%); align-items: center; }
              @media (max-width: 1800px) { .wd-desktop-nav { position: static; transform: none; margin-left: auto; } }
            `}</style>
          </div>

          {/* DESKTOP NAV */}
          <div className="hidden md:flex wd-desktop-nav">

            <NavMenu label="Community Board" to="/community" linkStyle={navLink(onSection("/community"))}
              width={300} eyebrow="Draft Classes">
              {(close) => COMMUNITY_YEARS.map((yr) => (
                <NavMenuItem key={yr.path} to={yr.path} title={yr.label} note={yr.note} tile={yr.tile} icon={yr.icon} onClick={close} />
              ))}
            </NavMenu>

            {/* Signed-in users only. */}
            {user && (
              <NavMenu label="My Boards" to="/boards" linkStyle={navLink(onSection("/boards", "/whiteboard"))} width={300} eyebrow="My Boards">
                {(close) => (
                  <>
                    <NavMenuItem to="/boards" icon="board" title="My Draft Board" note="Your rankings and evaluations" featured onClick={close} />
                    <NavMenuItem to="/whiteboard" icon="pen" title="My Whiteboard" note="Sketch out your board" onClick={close} />
                    <NavMenuItem to="/boards/feed" icon="bell" title="My Feed" note="News on the players you follow" onClick={close} />
                  </>
                )}
              </NavMenu>
            )}

            <NavMenu label="CFB" to="/cfb" linkStyle={navLink(onSection("/cfb", "/portal", "/portalsim", "/hs"))}
              width={600} maxHeight={400} eyebrow="College Football" onOpen={() => setCfbOpen(true)}
              actions={[{ to: "/cfb/stats", label: "Stats" }, { to: "/hs", label: "High Schools" }, { to: "/cfb", label: "All Teams" }]}
              lead={(close) => (
                // The Transfer Portal's own row (user, 2026-11-20), pinned
                // above the team scroll: the live portal and Portal News.
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4, padding: "0 0 8px", marginBottom: 6, borderBottom: "1px solid #edf1f6" }}>
                  <NavMenuItem to="/portal" icon="swap" title="View the Portal" note="Every entry and commitment" featured onClick={close} />
                  <NavMenuItem to="/portal/news" icon="star" title="Top Portal Players" note="Our breakdown of the portal" onClick={close} />
                </div>
              )}>
              {(close) => (
                <>
                  {schoolsLoading && schools.length === 0 && (
                    <div style={{ padding: 18, textAlign: "center", color: "#8a96a8", fontSize: 12, fontWeight: 700 }}>Loading teams…</div>
                  )}
                  {conferenceOrder.map((conf) => {
                    const teams = grouped[conf];
                    if (!teams || teams.length === 0) return null;
                    return (
                      <div key={conf} style={{ marginBottom: 12 }}>
                        <div className="wd-menu-group">{conf}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
                          {teams.map((team) => (
                            <Link key={team.School} to={`/team/${team.Slug || toSlug(team.School)}`} className="wd-menu-team" onClick={close}>
                              {team.Logo1 && <img src={team.Logo1} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                              {team.School}
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </NavMenu>

            {/* All 32 teams by division. */}
            <NavMenu label="NFL" to="/nfl" linkStyle={navLink(onSection("/nfl", "/draftorder"))}
              width={640} maxHeight={440} eyebrow="NFL Teams" onOpen={() => setNflOpen(true)}
              actions={[{ to: "/draftorder", label: "Draft Order" }, { to: "/nfl", label: "All Teams" }]}>
              {(close) => (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 14 }}>
                  {NFL_DIVISIONS.map(([division, abbrs]) => (
                    <div key={division} style={{ marginBottom: 12 }}>
                      <div className="wd-menu-group">{division}</div>
                      {abbrs.map((abbr) => {
                        const t = nflTeams?.[abbr];
                        return (
                          <Link key={abbr} to={`/nfl/${abbr.toLowerCase()}`} className="wd-menu-team" onClick={close}>
                            {t?.Logo1 && <img src={t.Logo1} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                            {t ? `${t.City} ${t.Team}`.trim() : abbr}
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </NavMenu>

            {/* Draft (user, 2026-11-20): the events calendar, the Combine, Pro
                Days and Draft Risers — more to come. */}
            <NavMenu label="Draft" to="/events" linkStyle={navLink(onSection("/events", "/risers"))} width={320} eyebrow="NFL Draft">
              {(close) => (
                <>
                  <NavMenuItem to="/events" icon="calendar" title="Draft Calendar" note="Bowls, the Combine, pro days and more" featured onClick={close} />
                  <NavMenuItem to="/events/combine" icon="stopwatch" title="NFL Combine" note="Results, drill rankings, all-time bests" onClick={close} />
                  <NavMenuItem to="/events/pro-days" icon="shield" title="Pro Days" note="Every school's pro day date and results" onClick={close} />
                  <NavMenuItem to="/risers" icon="trend" title="Draft Risers" note="Who's climbing boards this week" onClick={close} />
                </>
              )}
            </NavMenu>

            {/* The Draft Sim first, then the written mocks. */}
            <NavMenu label="Mock Drafts" to="/mocks" linkStyle={navLink(onSection("/mocks", "/draftsim"))} width={300} eyebrow="Mock Drafts">
              {(close) => (
                <>
                  <NavMenuItem to="/draftsim" icon="bolt" title="Draft Simulator" note="Run the draft live" featured onClick={close} />
                  <NavMenuItem to="/mocks" icon="doc" title="Mock Drafts" note="Write and read mocks" onClick={close} />
                </>
              )}
            </NavMenu>

            {user ? (
              <Link to="/profile" className="wd-nav-link" style={navLink(onSection("/profile"))}>
                Profile
                {profileBadge > 0 && (
                  <span style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    minWidth: "16px", height: "16px", borderRadius: "8px", padding: "0 4px",
                    marginLeft: "6px", background: "#c0392b", color: "#fff", fontSize: "9px", fontWeight: 900,
                  }}>
                    {profileBadge > 99 ? "99+" : profileBadge}
                  </span>
                )}
              </Link>
            ) : (
              <button onClick={login} className="wd-nav-signin" style={signInStyle}>Sign In</button>
            )}
            {/* The whole site full screen (desktop) — right of Profile. */}
            <SiteFullscreenButton style={{ marginLeft: 10 }} />
          </div>

          {/* MOBILE HAMBURGER — pinned right, over the logo if it runs long. */}
          <div className="md:hidden" style={{ position: "absolute", right: "1.25rem", top: "50%", transform: "translateY(-50%)", zIndex: 2, background: "#0b67c2", paddingLeft: 6 }}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              style={{ width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 12, color: "#ffffff", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }}
            >
              {menuOpen ? "✕" : "☰"}
            </button>
          </div>
        </nav>

        {/* MOBILE MENU */}
        {isMobile && menuOpen && (
          <div
            style={{
              backgroundColor: "#06264d",
              boxShadow: "0 10px 24px rgba(0,0,0,0.3)",
              padding: "6px 0 18px",
              display: "flex",
              flexDirection: "column",
              zIndex: 10001,
              position: "relative",
            }}
          >
            {/* Kept deliberately short — just the primary destinations. The
                draft-year/position filtering lives on the Community Board
                page itself now (its own mobile dropdowns), not here. */}
            {[
              { path: "/community", label: "Community Board" },
              { path: "/cfb", label: "CFB Teams" },
              { path: "/cfb/stats", label: "CFB Stats" },
              { path: "/hs", label: "High Schools" },
              { path: "/portal", label: "Transfer Portal" },
              { path: "/portal/news", label: "Top Portal Players" },
              { path: "/nfl", label: "NFL Teams" },
              { path: "/events", label: "Draft Calendar" },
              { path: "/events/combine", label: "NFL Combine" },
              { path: "/events/pro-days", label: "Pro Days" },
              { path: "/risers", label: "Draft Risers" },
              { path: "/mocks", label: "Mock Drafts" },
            ].map((l) => (
              <Link key={l.path} to={l.path} className="mobile-nav-link" onClick={() => setMenuOpen(false)}>
                {l.label}
              </Link>
            ))}

            {user ? (
              <Link to="/profile" className="mobile-nav-link" onClick={() => setMenuOpen(false)}>
                Profile
                {profileBadge > 0 && (
                  <span style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    minWidth: "16px", height: "16px", borderRadius: "8px", padding: "0 4px",
                    marginLeft: "6px", background: "#c0392b", color: "#fff", fontSize: "9px", fontWeight: 900,
                  }}>
                    {profileBadge > 99 ? "99+" : profileBadge}
                  </span>
                )}
              </Link>
            ) : (
              <button onClick={() => { login(); setMenuOpen(false); }} className="mobile-nav-signin">
                Sign In
              </button>
            )}
          </div>
        )}

        {/* ================= TICKER — hidden for now ================= */}
        {false && (
          <div
            style={{
              background: "#ffffff",
              borderTop: "2px solid #f6a21d",
              borderBottom: "2px solid #f6a21d",
              overflow: "hidden",
              whiteSpace: "nowrap",
              position: "relative",
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: "0.55rem 0",
                fontWeight: 800,
                color: "#0055a5",
                animation: "tickerMove 300s linear infinite",
                willChange: "transform",
              }}
            >
              {tickerText}
            </div>
          </div>
        )}
      </div>

      {siteFullscreen && (
        <button type="button" className={`wd-fs-navtab${fsNavOpen ? " is-open" : ""}`} onClick={() => setFsNavOpen((o) => !o)}
          aria-label={fsNavOpen ? "Hide the menu" : "Show the menu"} aria-expanded={fsNavOpen}
          title={fsNavOpen ? "Hide the menu" : "Show the menu"} style={{ top: fsNavOpen ? 66 : 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
            style={{ transition: "transform .25s", transform: fsNavOpen ? "rotate(180deg)" : "none" }}>
            <path d="M4 7h16l-8 11z" />
          </svg>
        </button>
      )}

      <style>{`
        @keyframes tickerMove {
          0%   { transform: translateX(15%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </>
  );
}