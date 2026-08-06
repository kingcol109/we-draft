// src/pages/GamePage.js
//
// Public page for a single game, authored from the Admin Panel's CFB
// Schedule editor (see AdminPanel.js's CFBScheduleSection). Renders one of
// two states off the same schedule26 doc: pregame (matchup + key players +
// preview notes) and final (score + review notes + each team's top
// performances — key players step aside once there's real performance data
// to show instead). The "AWAY"/"HOME" tags plus each side's own logo do the
// work of identifying the matchup, so nothing here restates a school's full
// name a second time next to it.
import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import Logo1 from "../assets/Logo1.png";
import LoadingSpinner from "../components/LoadingSpinner";
import GameMarginSidebars from "../components/GameMarginSidebars";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
// Fallback tint for a side whose school doc has no Color1 on file.
const NEUTRAL_TEAM_COLOR = "#243447";

const GRADE_PRIORITY = { Dominant: 0, Great: 1, Good: 2, Productive: 3, Average: 4, Bad: 5 };
const gradePriority = (grade) => (grade in GRADE_PRIORITY ? GRADE_PRIORITY[grade] : 6);

// Same tiered "pop" effect as PerformancePage.js's sidebar rows — Dominant
// really pops, Great a little less, Good just a hint, Productive/Average/
// Bad get nothing.
const gradeGlowClass = (grade) => {
  if (grade === "Dominant") return "wd-perf-glow-dominant";
  if (grade === "Great") return "wd-perf-glow-great";
  if (grade === "Good") return "wd-perf-glow-good";
  return "";
};

const GRADE_GLOW_STYLE = `
  @keyframes wdPerfGlowDominant {
    0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.45), 0 0 10px 3px rgba(246,162,29,0.55); }
    50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.7), 0 0 20px 7px rgba(246,162,29,0.9); }
  }
  .wd-perf-glow-dominant { animation: wdPerfGlowDominant 1.6s ease-in-out infinite; border-radius: 8px; margin: 3px 4px; }
  @keyframes wdPerfGlowGreat {
    0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.2), 0 0 5px 1px rgba(246,162,29,0.22); }
    50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.32), 0 0 9px 2px rgba(246,162,29,0.38); }
  }
  .wd-perf-glow-great { animation: wdPerfGlowGreat 2.6s ease-in-out infinite; border-radius: 8px; margin: 3px 4px; }
  .wd-perf-glow-good { box-shadow: 0 0 0 1px rgba(246,162,29,0.18); border-radius: 8px; margin: 3px 4px; }
  .wd-perf-row-link { transition: background 0.15s ease, padding-left 0.15s ease; }
  .wd-perf-row-link:hover { background: #eaf1ff; padding-left: 20px; }
  .wd-perf-row-chevron { opacity: 0; transform: translateX(-6px); transition: opacity 0.15s ease, transform 0.15s ease; }
  .wd-perf-row-link:hover .wd-perf-row-chevron { opacity: 1; transform: translateX(0); }
  @keyframes wdFeaturedShimmer {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  .wd-featured-ribbon { animation: wdFeaturedShimmer 3.5s linear infinite; }
`;

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

// Imgur happily serves raw image bytes from imgur.com itself (which is why
// a plain <img> works), but caps that host's CORS header to imgur.com — the
// canvas read useTrimmedImage needs below requires the i.imgur.com CDN
// subdomain's more permissive header instead. Same fix AdminPanel.js's
// clipboard-copy feature uses for the same underlying reason.
function corsFriendlyImageUrl(url) {
  return url.replace(/^(https?:\/\/)imgur\.com\//i, "$1i.imgur.com/");
}

// Every school's Wordmark is exported at the same canvas size, but the
// actual logotype fills wildly different fractions of that canvas from one
// school to the next — displayed at a shared height with no further work,
// a tightly-cropped wordmark reads much bigger than one sitting in a sea of
// transparent padding. This auto-crops each wordmark down to just its
// non-transparent pixels (via an offscreen canvas scan) so a shared display
// height actually means a shared *visual* size. Shows the untouched
// original immediately, then swaps in the trimmed version once the crop
// finishes (or leaves the original in place if the canvas read fails, e.g.
// a non-CORS-friendly host).
function useTrimmedImage(url) {
  const [src, setSrc] = useState(url || null);

  useEffect(() => {
    if (!url) { setSrc(null); return; }
    setSrc(url);
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        const ALPHA_THRESHOLD = 12;
        let top = h, bottom = -1, left = w, right = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
              if (y < top) top = y;
              if (y > bottom) bottom = y;
              if (x < left) left = x;
              if (x > right) right = x;
            }
          }
        }
        if (right < left || bottom < top) return; // fully transparent — keep original
        const cropW = right - left + 1, cropH = bottom - top + 1;
        if (cropW === w && cropH === h) return; // already tight — nothing to gain
        const out = document.createElement("canvas");
        out.width = cropW;
        out.height = cropH;
        out.getContext("2d").drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);
        if (!cancelled) setSrc(out.toDataURL("image/png"));
      } catch (e) { /* CORS-tainted canvas or decode failure — keep the untrimmed original */ }
    };
    img.src = corsFriendlyImageUrl(url);
    return () => { cancelled = true; };
  }, [url]);

  return src;
}

const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};
const formatTime12h = (t) => {
  const mins = timeToMinutes(t);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
};

// One side of the hero matchup — AWAY/HOME tag, a big logo, and the
// school's Wordmark standing in for its name (falls back to plain text if
// the school has no wordmark asset). Logo preference: an admin-uploaded
// 8-bit version (Branding manager's "Logo (8-Bit)" field) if one's been
// set, else LogoDark (reads better against the hero's colored background
// than a school's normal logo), else the plain primary logo. The wordmark
// sits in a fixed-height box with its own auto-trimmed image (see
// useTrimmedImage) so every school's name reads at the same visual size
// regardless of how much padding its source file happens to have.
function TeamHeroSide({ side, school, schoolData, isMobile, dimmed }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [wordmarkFailed, setWordmarkFailed] = useState(false);
  const wordmarkSrc = useTrimmedImage(schoolData?.Wordmark ? sanitizeUrl(schoolData.Wordmark) : null);

  const logoSrc = schoolData?.Logo8Bit || schoolData?.LogoDark || schoolData?.Logo1 || schoolData?.Logo2 || "";
  // The 8-bit asset is deliberately low-res pixel art — force crisp,
  // unsmoothed scaling so the browser doesn't blur its edges back out.
  const logoIsPixelArt = !!schoolData?.Logo8Bit;
  const accent = schoolData?.Color1 || NEUTRAL_TEAM_COLOR;
  const logoSize = isMobile ? 64 : 116;
  const wordmarkBoxHeight = isMobile ? 24 : 36;

  const inner = (
    <>
      <span style={{
        background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.5)",
        color: "#fff", fontSize: isMobile ? "9px" : "10px", fontWeight: 900,
        padding: "3px 12px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.12em",
        backdropFilter: "blur(2px)",
      }}>
        {side}
      </span>

      {logoSrc && !logoFailed ? (
        <img
          src={sanitizeUrl(logoSrc)} alt={school}
          style={{
            height: `${logoSize}px`, width: `${logoSize}px`, objectFit: "contain",
            filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.5))",
            imageRendering: logoIsPixelArt ? "pixelated" : "auto",
          }}
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <div style={{
          height: `${logoSize}px`, width: `${logoSize}px`, borderRadius: "50%",
          background: accent, display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: isMobile ? "22px" : "36px", fontWeight: 900,
        }}>
          {(school || "?").charAt(0)}
        </div>
      )}

      {wordmarkSrc && !wordmarkFailed ? (
        <div style={{
          background: "#fff", borderRadius: "8px", padding: isMobile ? "3px 10px" : "5px 16px",
          boxShadow: "0 3px 12px rgba(0,0,0,0.35)", height: `${wordmarkBoxHeight}px`, boxSizing: "content-box",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <img
            src={wordmarkSrc} alt={school}
            style={{ height: "100%", width: "auto", maxWidth: isMobile ? "120px" : "190px", objectFit: "contain", display: "block" }}
            onError={() => setWordmarkFailed(true)}
          />
        </div>
      ) : (
        <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "18px", textAlign: "center", lineHeight: 1.2, textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>
          {school}
        </span>
      )}
    </>
  );

  const style = {
    display: "flex", flexDirection: "column", alignItems: "center", gap: isMobile ? "8px" : "12px",
    textDecoration: "none", flex: "1 1 0", minWidth: 0,
    opacity: dimmed ? 0.55 : 1, transition: "opacity 0.3s ease",
  };

  return schoolData?.Slug ? (
    <Link to={`/team/${schoolData.Slug}`} style={style}>{inner}</Link>
  ) : (
    <div style={style}>{inner}</div>
  );
}

// Small inline identity for a content-section column — a mini team logo
// plus the AWAY/HOME tag, instead of restating the school's full name a
// second time (already established, big, at the top of the page).
function SideTag({ tag, schoolData }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
      {schoolData?.Logo1 ? (
        <img src={sanitizeUrl(schoolData.Logo1)} alt="" style={{ width: "22px", height: "22px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      ) : null}
      <span style={{ fontSize: "11px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>{tag}</span>
    </div>
  );
}

// One team's content column — Key Players pregame, Top Performances once
// Final (never both; Key Players steps aside for real performance data the
// moment there's some to show).
function TeamColumn({ tag, schoolData, keyPlayers, performances, mode }) {
  return (
    <div>
      <SideTag tag={tag} schoolData={schoolData} />
      {mode === "final" ? (
        performances.length === 0 ? (
          <div style={{ color: "#bbb", fontSize: "12px", fontStyle: "italic", padding: "8px 0" }}>No performances written up yet.</div>
        ) : (
          <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
            {/* Just the player and their stat line — the title/grade text
                lives on the performance's own page; the grade still shows
                up here as the row's glow (see gradeGlowClass), not as text. */}
            {performances.map((perf, i) => (
              <Link
                key={perf.id}
                to={`/performance/${perf.slug}`}
                className={`wd-perf-row-link ${gradeGlowClass(perf.grade)}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 14px", textDecoration: "none", borderBottom: i < performances.length - 1 ? "1px solid #f0f0f0" : "none" }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#222", fontWeight: 900, fontSize: "14px", lineHeight: 1.3 }}>
                    {perf.playerName || perf.titleShort}
                  </div>
                  {perf.statLine && (
                    <div style={{ color: "#555", fontWeight: 700, fontSize: "12px", fontFamily: "'Courier New', monospace", letterSpacing: "0.02em", marginTop: "3px" }}>
                      {perf.statLine}
                    </div>
                  )}
                </div>
                <span className="wd-perf-row-chevron" style={{ color: BLUE, fontSize: "18px", fontWeight: 900, flexShrink: 0 }}>›</span>
              </Link>
            ))}
          </div>
        )
      ) : keyPlayers.length === 0 ? (
        <div style={{ color: "#bbb", fontSize: "12px", fontStyle: "italic", padding: "8px 0" }}>None selected yet.</div>
      ) : (
        <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
          {keyPlayers.map((p, i) => (
            <Link
              key={p.id}
              to={`/player/${p.Slug}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 14px", textDecoration: "none", borderBottom: i < keyPlayers.length - 1 ? "1px solid #f0f0f0" : "none" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <span style={{ color: BLUE, fontWeight: 900, fontSize: "13px" }}>{p.First} {p.Last}</span>
              <span style={{ color: "#999", fontWeight: 700, fontSize: "11px", textTransform: "uppercase", flexShrink: 0 }}>{p.Position || "—"}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GamePage() {
  const { slug } = useParams();
  const [game, setGame] = useState(null);
  const [awaySchool, setAwaySchool] = useState(null);
  const [homeSchool, setHomeSchool] = useState(null);
  const [keyPlayersAway, setKeyPlayersAway] = useState([]);
  const [keyPlayersHome, setKeyPlayersHome] = useState([]);
  const [performancesAway, setPerformancesAway] = useState([]);
  const [performancesHome, setPerformancesHome] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const contentRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    setGame(null);
    setAwaySchool(null);
    setHomeSchool(null);
    setKeyPlayersAway([]);
    setKeyPlayersHome([]);
    setPerformancesAway([]);
    setPerformancesHome([]);
    setNotFound(false);
    setLoading(true);

    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db, "schedule26"), where("Slug", "==", slug)));
        if (snap.empty) {
          setNotFound(true);
          return;
        }
        const g = { id: snap.docs[0].id, ...snap.docs[0].data() };
        setGame(g);

        const isFinal = g.Final && g.HomeScore != null && g.AwayScore != null;
        const keyAwayIds = isFinal ? [] : (g.KeyPlayersAway || []);
        const keyHomeIds = isFinal ? [] : (g.KeyPlayersHome || []);

        const [awaySchoolSnap, homeSchoolSnap, keyAwaySnaps, keyHomeSnaps, perfSnap] = await Promise.all([
          g.Away ? getDocs(query(collection(db, "schools"), where("School", "==", g.Away))) : null,
          g.Home ? getDocs(query(collection(db, "schools"), where("School", "==", g.Home))) : null,
          Promise.all(keyAwayIds.map((id) => getDoc(doc(db, "players", id)))),
          Promise.all(keyHomeIds.map((id) => getDoc(doc(db, "players", id)))),
          isFinal ? getDocs(query(collection(db, "performances"), where("gameId", "==", g.id), where("status", "==", "published"))) : null,
        ]);

        if (awaySchoolSnap && !awaySchoolSnap.empty) setAwaySchool({ id: awaySchoolSnap.docs[0].id, ...awaySchoolSnap.docs[0].data() });
        if (homeSchoolSnap && !homeSchoolSnap.empty) setHomeSchool({ id: homeSchoolSnap.docs[0].id, ...homeSchoolSnap.docs[0].data() });
        setKeyPlayersAway(keyAwaySnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
        setKeyPlayersHome(keyHomeSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));

        if (perfSnap) {
          const all = perfSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const sortByGrade = (a, b) => gradePriority(a.grade) - gradePriority(b.grade);
          setPerformancesAway(all.filter((p) => p.school === g.Away).sort(sortByGrade).slice(0, 5));
          setPerformancesHome(all.filter((p) => p.school === g.Home).sort(sortByGrade).slice(0, 5));
        }
      } catch (e) {
        console.error("Game page load error:", e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [slug]);

  if (loading) return <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;

  if (notFound || !game) {
    return (
      <div style={{ textAlign: "center", marginTop: "80px", color: "#999", fontStyle: "italic", fontSize: "16px" }}>
        Game not found.
      </div>
    );
  }

  const isFinal = game.Final && game.HomeScore != null && game.AwayScore != null;
  const gameDateMs = game.Date?.toDate ? game.Date.toDate().getTime() : (game.Date ? new Date(game.Date).getTime() : 0);
  // Date-only field is stored as UTC midnight — format in UTC too, or a
  // viewer west of it sees the game roll back a calendar day.
  const dateStr = gameDateMs ? new Date(gameDateMs).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
  const timeStr = formatTime12h(game.Time);
  const awayWon = isFinal && game.AwayScore > game.HomeScore;
  const homeWon = isFinal && game.HomeScore > game.AwayScore;
  const awayColor = awaySchool?.Color1 || NEUTRAL_TEAM_COLOR;
  const homeColor = homeSchool?.Color1 || NEUTRAL_TEAM_COLOR;
  // "Back" always means this game's week slate — the CFB schedule for that
  // week (every game, not just the ones with performances) — not the
  // Performances hub. Only falls back to the CFB schedule's own default
  // (current week) if this game somehow has no Week on file.
  const weekSlateUrl = game.Week ? `/cfb/schedule/${encodeURIComponent(game.Week)}` : "/cfb/schedule";
  const weekSlateLabel = game.Week ? `← ${game.Week} Slate` : "← Full Schedule";

  const canonicalUrl = `https://we-draft.com/game/${game.Slug}`;
  const seoTitle = isFinal
    ? `Final: ${game.Away} ${game.AwayScore}, ${game.Home} ${game.HomeScore} | We-Draft`
    : `${game.Away} at ${game.Home} — ${game.Week || "Preview"} | We-Draft`;
  const seoDescription = (game.Notes || "").replace(/\s+/g, " ").trim().slice(0, 160)
    || (isFinal
      ? `${game.Away} ${game.AwayScore}, ${game.Home} ${game.HomeScore} — final score, top prospect performances, and more on We-Draft.com.`
      : `${game.Away} at ${game.Home} preview — key draft prospects to watch on We-Draft.com.`);

  return (
    <>
      <style>{GRADE_GLOW_STYLE}</style>
      <Helmet>
        <title>{seoTitle}</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={seoDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="We-Draft" />
      </Helmet>

      <div ref={contentRef} style={{ maxWidth: "1000px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* Page header */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "16px" : "20px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              Game
            </div>
            <Link to={weekSlateUrl} style={{ marginLeft: "auto", color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "underline" }}>
              {weekSlateLabel}
            </Link>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        <div style={{ border: `2px solid ${BLUE}`, borderRadius: "14px", overflow: "hidden" }}>

          {/* Featured ribbon — a proud, branded banner rather than a small
              pill buried in the status strip, with a slow shimmer sweep for
              a bit of showcase energy. */}
          {game.Featured && (
            <div
              className="wd-featured-ribbon"
              style={{
                background: `linear-gradient(90deg, ${GOLD}, #ffe08a, ${GOLD}, #ffe08a, ${GOLD})`,
                backgroundSize: "200% 100%",
                padding: isMobile ? "8px 12px" : "10px 16px",
                textAlign: "center",
              }}
            >
              <span style={{ color: "#3a2900", fontWeight: 900, fontSize: isMobile ? "11px" : "13px", textTransform: "uppercase", letterSpacing: "0.14em" }}>
                🏈 We-Draft.com's Featured Game
              </span>
            </div>
          )}

          {/* Hero — status strip + big branded matchup. Background is split
              between each team's own Color1 (a flat dark overlay layered on
              top keeps white text/logos legible no matter how light either
              team's color happens to be). */}
          <div style={{
            background: `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), linear-gradient(90deg, ${awayColor} 0%, ${awayColor} 46%, ${homeColor} 54%, ${homeColor} 100%)`,
            padding: isMobile ? "18px 14px 28px" : "22px 32px 40px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: isMobile ? "20px" : "32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ background: isFinal ? "#1a7f37" : "#7c3aed", color: "#fff", fontSize: "9px", fontWeight: 900, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {isFinal ? "Final" : "Preview"}
                </span>
                {game.Week && (
                  <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "12px", fontWeight: 700 }}>{game.Week}</span>
                )}
              </div>
              {dateStr && (
                <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "12px", fontWeight: 700 }}>
                  {dateStr}{timeStr ? ` · ${timeStr}` : ""}
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: isMobile ? "10px" : "28px" }}>
              <TeamHeroSide key={`${game.id}-away`} side="Away" school={game.Away} schoolData={awaySchool} isMobile={isMobile} dimmed={isFinal && homeWon} />

              <div style={{ textAlign: "center", flexShrink: 0, paddingTop: isMobile ? "16px" : "34px" }}>
                {isFinal ? (
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "6px" : "10px" }}>
                    <span style={{ fontSize: isMobile ? "26px" : "44px", fontWeight: 900, color: awayWon ? "#fff" : "rgba(255,255,255,0.4)" }}>{game.AwayScore}</span>
                    <span style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: 900, color: "rgba(255,255,255,0.3)" }}>–</span>
                    <span style={{ fontSize: isMobile ? "26px" : "44px", fontWeight: 900, color: homeWon ? "#fff" : "rgba(255,255,255,0.4)" }}>{game.HomeScore}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: 900, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>
                    {game.Neutral ? "vs" : "@"}
                  </span>
                )}
                {game.Neutral && (
                  <div style={{ fontSize: "9px", fontWeight: 900, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "4px" }}>Neutral Site</div>
                )}
              </div>

              <TeamHeroSide key={`${game.id}-home`} side="Home" school={game.Home} schoolData={homeSchool} isMobile={isMobile} dimmed={isFinal && awayWon} />
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {/* Body */}
          <div style={{ background: "#fff", padding: isMobile ? "20px 16px" : "32px 32px" }}>

            {/* Notes — relabeled Preview/Recap depending on game state, styled
                as a pulled-quote card (colored spine + icon) rather than a
                flat gray box. */}
            {game.Notes && (
              <div style={{ marginBottom: "28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "17px" }}>{isFinal ? "📰" : "🔮"}</span>
                  <span style={{ fontSize: "13px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {isFinal ? "The Recap" : "The Preview"}
                  </span>
                </div>
                <div style={{
                  fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 700,
                  fontSize: isMobile ? "14.5px" : "16.5px", letterSpacing: "0.01em",
                  lineHeight: 1.6, color: "#161616", whiteSpace: "pre-wrap", wordWrap: "break-word",
                  background: "#fff", borderLeft: `4px solid ${GOLD}`, borderRadius: "4px 10px 10px 4px",
                  padding: isMobile ? "16px 18px" : "20px 26px",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.07)",
                }}>
                  {game.Notes}
                </div>
              </div>
            )}

            {/* Key Players (pregame) or Top Performances (final) — never both */}
            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
                {isFinal ? "Top Performances" : "Key Players"}
              </div>
              <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
              <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "24px" : "32px" }}>
              <TeamColumn
                tag="Away"
                schoolData={awaySchool}
                keyPlayers={keyPlayersAway}
                performances={performancesAway}
                mode={isFinal ? "final" : "pregame"}
              />
              <TeamColumn
                tag="Home"
                schoolData={homeSchool}
                keyPlayers={keyPlayersHome}
                performances={performancesHome}
                mode={isFinal ? "final" : "pregame"}
              />
            </div>

            {/* Footer */}
            <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: "2px solid #eee", display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: "10px" }}>
              <Link to={weekSlateUrl} style={{ background: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "6px", padding: "7px 18px", fontWeight: 900, fontSize: "12px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {weekSlateLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <GameMarginSidebars contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} excludeGameId={game.id} />
    </>
  );
}
