// src/components/MarginAds.js
//
// Sponsored margin ads — the fixed-position "Homage throwback gear" side
// rails that live in the empty gutters beside the main content on wide
// viewports. Extracted from PlayerProfile.js (the original, more elaborate
// version there prioritizes a drafted/affiliate team before falling back to
// random) so ArticlePage/NewsArticle can reuse the exact same visual
// system without duplicating ~250 lines of ad-card markup a second time.
// Those pages have no "this player's team" concept to prioritize
// anyway, so team selection here is always random — pass a contentRef to
// whatever element the ads should center themselves around and this handles
// the rest (fetch, layout measurement, resize, hover states).
//
// preferSchool (team pages) defaults the cards to that school's CFB ad
// (cfbAds, edited in AdminAdsManager.js) — the cards then wear the school's
// colors. The bottom NFL team grid stays the visitor's way to switch, and
// only ever lists NFL ads; the school is a default, not a 33rd option.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import HomageLogo from "../assets/homagelogo.png";
import { fetchAds, fetchCfbAds, fetchAdTeamLogos } from "../utils/siteSnapshots";
import { cssRect, viewportCssWidth, viewportCssHeight } from "../utils/pageZoom";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export const NFL_TEAM_ABBRS = [
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE",
  "DAL","DEN","DET","GB","HOU","IND","JAX","KC",
  "LV","LAC","LAR","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS",
];

export function teamNameFromAbbr(abbr) {
  const map = {
    ARI:"Arizona Cardinals",ATL:"Atlanta Falcons",BAL:"Baltimore Ravens",BUF:"Buffalo Bills",
    CAR:"Carolina Panthers",CHI:"Chicago Bears",CIN:"Cincinnati Bengals",CLE:"Cleveland Browns",
    DAL:"Dallas Cowboys",DEN:"Denver Broncos",DET:"Detroit Lions",GB:"Green Bay Packers",
    HOU:"Houston Texans",IND:"Indianapolis Colts",JAX:"Jacksonville Jaguars",KC:"Kansas City Chiefs",
    LV:"Las Vegas Raiders",LAC:"Los Angeles Chargers",LAR:"Los Angeles Rams",MIA:"Miami Dolphins",
    MIN:"Minnesota Vikings",NE:"New England Patriots",NO:"New Orleans Saints",NYG:"New York Giants",
    NYJ:"New York Jets",PHI:"Philadelphia Eagles",PIT:"Pittsburgh Steelers",SF:"San Francisco 49ers",
    SEA:"Seattle Seahawks",TB:"Tampa Bay Buccaneers",TEN:"Tennessee Titans",WAS:"Washington Commanders",
  };
  return map[abbr] || abbr;
}

// A cfbAds row carries School instead of Team.
export const isCfbAd = (ad) => !!ad?.School && !ad?.Team;
export const adTeamLabel = (ad) => (isCfbAd(ad) ? ad.School : teamNameFromAbbr(ad.Team) || ad.Team);

function sanitizeImgur(url) {
  if (!url) return "";
  if (/^https?:\/\/i\.imgur\.com\/.+\.(png|jpe?g|gif|webp)$/i.test(url)) return url;
  // imgur.com/xxxx.png (how most logos/wordmarks are stored) only 302s to
  // the i.imgur.com CDN — go straight there and skip the redirect.
  const directMatch = url.match(/^https?:\/\/imgur\.com\/([A-Za-z0-9]+\.(png|jpe?g|gif|webp))$/i);
  if (directMatch) return `https://i.imgur.com/${directMatch[1]}`;
  const singleMatch = url.match(/^https?:\/\/imgur\.com\/(?!a\/|gallery\/)([A-Za-z0-9]+)$/i);
  if (singleMatch) return `https://i.imgur.com/${singleMatch[1]}.png`;
  if (/^https?:\/\/imgur\.com\/(a|gallery)\//i.test(url)) return "";
  return url;
}
function sanitizeGoogleDrive(url) {
  if (!url) return "";
  const m = url.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//i);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}
export function sanitizeUrl(url) {
  let u = (url || "").trim();
  if (!u) return "";
  if (u.includes("imgur.com")) u = sanitizeImgur(u);
  if (u.includes("drive.google.com")) u = sanitizeGoogleDrive(u);
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

// Logo for one picker button, falling back to the abbreviation when there's
// no logo (or it fails to load).
function PickerMark({ abbr, logo, dim }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) return abbr;
  return (
    <img
      src={sanitizeUrl(logo)} alt={abbr}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{ display:"block", width:"100%", height:"20px", objectFit:"contain", filter: dim ? "grayscale(1)" : "none", opacity: dim ? 0.35 : 1 }}
    />
  );
}

// The 8×4 grid of all 32 NFL teams under the left card's product shot —
// shared with PlayerProfile.js's own copy of these cards. teamLogos comes
// from the _ads snapshot (fetchAdTeamLogos); teams without an ad stay
// disabled. Active is outlined rather than filled so the logo stays legible.
export function NflTeamPicker({ allAds, activeTeam, teamLogos = {}, onPick }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"5px" }}>
      {NFL_TEAM_ABBRS.map((abbr) => {
        const teamAd = allAds.find((a) => a.Team === abbr);
        const isActive = activeTeam === abbr;
        const logo = teamLogos[abbr];
        return (
          <button
            key={abbr}
            type="button"
            disabled={!teamAd}
            title={teamNameFromAbbr(abbr)}
            aria-label={teamNameFromAbbr(abbr)}
            className={teamAd ? "wd-team-btn" : ""}
            onClick={() => { if (teamAd) onPick(teamAd); }}
            style={{
              fontSize:"8.5px", fontWeight:900,
              padding: logo ? "3px 2px" : "5px 0", borderRadius:"4px",
              display:"flex", alignItems:"center", justifyContent:"center",
              minHeight:"28px",
              border:`1px solid ${isActive ? "#c8102e" : "#eee"}`,
              boxShadow: isActive ? "0 0 0 1px #c8102e" : "none",
              background: isActive ? "#fdecef" : teamAd ? "#fff" : "#f6f6f6",
              color: teamAd ? "#333" : "#ccc",
              cursor: teamAd ? "pointer" : "not-allowed",
              transition: "transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease",
            }}
          >
            <PickerMark abbr={abbr} logo={logo} dim={!teamAd} />
          </button>
        );
      })}
    </div>
  );
}

// ── Sizing for the two fixed rail cards, shared with PlayerProfile.js's own
// copy of them. Each card is laid out at AD_BASE_WIDTH and then scaled as a
// whole (transform, so type, logos, buttons and images all grow together)
// to the largest size that fits both the gutter's width and the viewport's
// height — on a big monitor the cards fill the empty gutters instead of
// sitting at a fixed 240px, and a short window shrinks them rather than
// cutting the taller (right) card off. Both cards share one scale so they
// stay a matched pair; each is centered vertically on its own height.
//
// offsetHeight (layout height, unaffected by the transform) is what's
// measured, so scaling never feeds back into the measurement. Callback refs
// (refFor) re-attach the ResizeObserver whenever a card's node is replaced
// — both callers define the cards as inner components, which remount on
// re-render — and pick up height changes from switching teams (1 vs 2
// gallery images, logo or not).
const AD_BASE_WIDTH = 200;
const AD_MIN_SCALE = 0.7;   // 140px — the old minimum width
const AD_MAX_SCALE = 1.75;  // 350px — past this the product shots get soft
const AD_MIN_GUTTER = 160;  // below this, no room for a card at all
const AD_VIEWPORT_MARGIN = 20;

export function useMarginAdFit({ contentRef, horizontalPadding, isMobile, watch = [] }) {
  const [gutters, setGutters] = useState(null); // { left, right } in CSS px, null = hidden
  const [heights, setHeights] = useState({ left: 0, right: 0 });
  const [viewH, setViewH] = useState(() => viewportCssHeight());
  // Bottom edge of the fixed site navbar — the cards fit (and center) in
  // the space below it, not the whole viewport.
  const [topInset, setTopInset] = useState(0);
  const nodes = useRef({ left: null, right: null });
  const ro = useRef(null);

  const measureHeights = useCallback(() => {
    const next = { left: nodes.current.left?.offsetHeight || 0, right: nodes.current.right?.offsetHeight || 0 };
    setHeights((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  const refs = useMemo(() => {
    const make = (side) => (el) => {
      const prev = nodes.current[side];
      if (prev === el) return;
      if (!ro.current) ro.current = new ResizeObserver(measureHeights);
      if (prev) ro.current.unobserve(prev);
      nodes.current[side] = el;
      // observe() fires once right away, measuring the new node. No
      // measuring on detach: a remount detaches then re-attaches in the same
      // commit, and a 0 height in between would re-render (remount) again.
      if (el) ro.current.observe(el);
    };
    return { left: make("left"), right: make("right") };
  }, [measureHeights]);
  useEffect(() => () => ro.current?.disconnect(), []);

  const recompute = () => {
    setViewH(viewportCssHeight());
    const nav = document.querySelector("nav");
    setTopInset(nav ? Math.max(0, Math.round(cssRect(nav).bottom)) : 0);
    if (isMobile || !contentRef.current) { setGutters(null); return; }
    const rect = cssRect(contentRef.current);
    const left = Math.max(0, rect.left + horizontalPadding);
    const right = Math.max(0, viewportCssWidth() - (rect.right - horizontalPadding));
    if (Math.min(left, right) < AD_MIN_GUTTER) { setGutters(null); return; }
    setGutters((prev) => (prev && prev.left === left && prev.right === right ? prev : { left, right }));
  };

  useEffect(() => {
    const handler = () => recompute();
    window.addEventListener("resize", handler);
    window.addEventListener("pagezoomchange", handler);
    // The content ref has no real size until it renders — a couple of
    // delayed retries cover fonts/images nudging the layout after mount.
    recompute();
    const t1 = setTimeout(recompute, 200);
    const t2 = setTimeout(recompute, 800);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("pagezoomchange", handler);
      clearTimeout(t1); clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, ...watch]);

  let scale = 1;
  if (gutters) {
    const minGutter = Math.min(gutters.left, gutters.right);
    // Breathing room either side grows with the gutter (8px → 40px).
    const pad = Math.max(8, Math.min(40, minGutter * 0.1));
    const byWidth = (minGutter - 2 * pad) / AD_BASE_WIDTH;
    const tallest = Math.max(heights.left, heights.right);
    const byHeight = tallest ? (viewH - topInset - 2 * AD_VIEWPORT_MARGIN) / tallest : byWidth;
    scale = Math.max(AD_MIN_SCALE, Math.min(AD_MAX_SCALE, byWidth, byHeight));
  }

  // Hidden (opacity 0) until the card's height is known, so it never
  // flashes at a guessed position first.
  const styleFor = (side, visible) => {
    const h = heights[side];
    const offset = Math.max(8, ((gutters?.[side] || 0) - AD_BASE_WIDTH * scale) / 2);
    const top = h ? topInset + Math.max(AD_VIEWPORT_MARGIN, (viewH - topInset - h * scale) / 2) : 0;
    return {
      position: "fixed",
      top: `${top}px`,
      [side]: `${offset}px`,
      width: `${AD_BASE_WIDTH}px`,
      transform: `scale(${scale})`,
      transformOrigin: `top ${side}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      zIndex: 5,
      opacity: visible && h ? 1 : 0,
      transition: "opacity 0.7s ease",
    };
  };

  return { show: !!gutters, refFor: (side) => refs[side], styleFor, recompute };
}

/**
 * @param {React.RefObject} contentRef - ref on the page's main content
 *   container (the element whose left/right gutters the ads should center
 *   in). Its own horizontal padding is subtracted via horizontalPadding so
 *   the ad centers against the visible content edge, not the padding box.
 * @param {boolean} isMobile - ads never show on mobile (no gutter room).
 * @param {number} horizontalPadding - the contentRef element's own
 *   left/right padding in px (defaults to 60, matching PlayerProfile.js).
 * @param {string} [preferTeam] - optional NFL abbreviation to show first
 *   (e.g. a college's NFL affiliate on a player-scoped page, same idea as
 *   PlayerProfile.js's own drafted-team/affiliate priority). Falls back to
 *   random when that team has no ad; switching it later (a different
 *   player loaded in place) switches the ad too.
 * @param {string} [preferSchool] - optional schools-doc School name whose
 *   CFB ad (if it has one) wins over preferTeam and random.
 * @param {object} [schoolBranding] - that school's doc (Color1/Color2/
 *   Logo1/Mascot) if the page already has it, saving a read.
 */
// ── Which ad to show, shared by MarginAds (the desktop rails) and pages
// that show the phone card themselves (Comparison.js → AdBanner.js
// MobileAdCard). Priority: preferSchool's CFB ad, then preferTeam's NFL ad,
// then random; setAdData is the visitor's own pick (the rails' logo grid,
// the phone card's dropdown). Nothing is fetched while !enabled.
// adTeamBranding is the selected team's nfl/schools doc, tagged with the
// team it belongs to so brandingReady can tell a stale one (still the
// previous team's colors) from the current one. ──
export function useAdSelection({ enabled = true, preferTeam = "", preferSchool = "", schoolBranding = null }) {
  const [allAds, setAllAds] = useState([]);
  const [adData, setAdData] = useState(null);
  const [schoolAd, setSchoolAd] = useState(null);
  const [adTeamLogos, setAdTeamLogos] = useState({});
  const [adVisible, setAdVisible] = useState(false);
  const [adTeamBranding, setAdTeamBranding] = useState(null);

  // Fetch ads and pick one — preferTeam's if it has one, otherwise random.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        // One read from the weekly ads snapshot (utils/siteSnapshots.js),
        // falling back to the ads collection if it's missing.
        const [ads, logos] = await Promise.all([fetchAds(), fetchAdTeamLogos()]);
        if (!cancelled) setAdTeamLogos(logos);
        if (!cancelled && ads.length > 0) {
          setAllAds(ads);
          const preferred = preferTeam ? ads.find((a) => a.Team === preferTeam) : null;
          // A school ad that already landed (effect below) keeps its spot.
          setAdData((cur) => cur || preferred || ads[Math.floor(Math.random() * ads.length)]);
        }
      } catch (e) { /* ads are non-critical — fail silently */ }
    }, 1000);
    return () => { cancelled = true; clearTimeout(t); };
    // preferTeam changes after the fetch are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // preferTeam resolving (or changing) after the ads are already loaded —
  // e.g. the page's school doc arriving a beat after this fetch, or a
  // different player loaded in place. Leaves the current ad alone when the
  // new team has none.
  useEffect(() => {
    if (schoolAd || !preferTeam || !allAds.length) return;
    const preferred = allAds.find((a) => a.Team === preferTeam);
    if (preferred) setAdData(preferred);
  }, [preferTeam, allAds, schoolAd]);

  // preferSchool's CFB ad, whenever the school resolves or changes.
  useEffect(() => {
    if (!enabled || !preferSchool) { setSchoolAd(null); return; }
    let cancelled = false;
    fetchCfbAds().then((rows) => {
      if (!cancelled) setSchoolAd(rows.find((a) => a.School === preferSchool) || null);
    });
    return () => { cancelled = true; };
  }, [enabled, preferSchool]);

  // Show it — or, when the page moved on to a school with no ad, drop the
  // previous school's ad back to an NFL one.
  useEffect(() => {
    if (schoolAd) { setAdData(schoolAd); return; }
    setAdData((cur) => {
      if (!isCfbAd(cur) || !allAds.length) return cur;
      return (preferTeam && allAds.find((a) => a.Team === preferTeam)) || allAds[Math.floor(Math.random() * allAds.length)];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolAd]);

  useEffect(() => {
    if (!adData) return;
    const t = setTimeout(() => setAdVisible(true), 20);
    return () => clearTimeout(t);
  }, [adData]);

  useEffect(() => {
    if (!adData?.Team && !isCfbAd(adData)) { setAdTeamBranding(null); return; }
    const key = adData.Team || adData.School;
    if (isCfbAd(adData) && schoolBranding?.School === adData.School) { setAdTeamBranding({ ...schoolBranding, _for: key }); return; }
    let cancelled = false;
    (async () => {
      try {
        if (isCfbAd(adData)) {
          const snap = await getDocs(query(collection(db, "schools"), where("School", "==", adData.School), limit(1)));
          if (!cancelled) setAdTeamBranding(snap.empty ? { _for: key } : { ...snap.docs[0].data(), _for: key });
          return;
        }
        const snap = await getDoc(doc(db, "nfl", adData.Team));
        if (!cancelled) setAdTeamBranding(snap.exists() ? { ...snap.data(), _for: key } : { _for: key });
      } catch (e) {
        // Still tagged, so a waiting card shows (in site colors) instead of never.
        if (!cancelled) setAdTeamBranding({ _for: key });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adData?.Team, adData?.School, schoolBranding]);

  const brandingReady = !!adData && adTeamBranding?._for === (adData.Team || adData.School);
  return { allAds, adData, setAdData, adTeamLogos, adVisible, adTeamBranding, brandingReady };
}

// The plain (picker) card — the left fixed rail, and on its own the inline
// column ad (SideRailAd below).
function PickerAdCard({ adData, allAds, adTeamLogos, setAdData, rootRef, style }) {
  const teamLabel = adTeamLabel(adData);
  return (
    <div className="wd-margin-ad" ref={rootRef} style={style}>
      <div style={{ fontSize:"9px", fontWeight:800, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:"6px" }}>
        Sponsored
      </div>
      <div
        className="wd-margin-ad-card"
        style={{
          width:"100%", borderRadius:"14px", overflow:"hidden",
          border:"1px solid #eee", background:"#fff",
          boxShadow:"0 4px 18px rgba(0,0,0,0.08)",
          transition:"box-shadow 0.2s ease, transform 0.2s ease",
        }}
      >
        <div style={{ padding:"9px 10px", borderBottom:"1px solid #f3f3f3" }}>
          <div style={{ fontSize:"9px", fontWeight:900, color:"#c8102e", textTransform:"uppercase", letterSpacing:"0.06em", textAlign:"center" }}>
            {teamLabel}
          </div>
        </div>

        <a href={sanitizeUrl(adData.Link)} target="_blank" rel="sponsored noopener noreferrer" style={{ display:"block" }}>
          <img
            src={sanitizeUrl(adData.Image1)}
            alt={`${teamLabel} throwback gear`}
            style={{ width:"100%", display:"block", aspectRatio:"1600 / 1920", objectFit:"cover", background:"#fafafa" }}
            loading="lazy" fetchpriority="low" referrerPolicy="no-referrer"
            onError={(e)=>{e.currentTarget.style.display="none";}}
          />
        </a>

        <div style={{ padding:"10px 10px 6px", borderTop:"1px solid #f3f3f3" }}>
          <NflTeamPicker allAds={allAds} activeTeam={adData.Team} teamLogos={adTeamLogos} onPick={setAdData} />
        </div>

        <a href={sanitizeUrl(adData.Link)} target="_blank" rel="sponsored noopener noreferrer" style={{ display:"block", textDecoration:"none" }}>
          <div style={{ padding:"9px 12px 12px", textAlign:"center", borderTop:"1px solid #f3f3f3" }}>
            <div style={{ fontSize:"10px", fontWeight:900, color:"#111", textTransform:"uppercase", letterSpacing:"0.02em", marginBottom:"3px" }}>
              Officially Licensed Throwback Apparel
            </div>
            <div style={{ fontSize:"9px", fontWeight:700, color:"#888", lineHeight:1.35, marginBottom:"9px" }}>
              All 32 NFL Teams + MLB, NBA, NHL &amp; More
            </div>
            <div
              className="wd-margin-ad-cta"
              style={{
                display:"inline-flex", alignItems:"center", gap:"4px",
                background:"#c8102e", color:"#fff",
                fontSize:"10px", fontWeight:900,
                padding:"7px 16px", borderRadius:"20px",
                textTransform:"uppercase", letterSpacing:"0.05em",
                transition:"background 0.15s ease",
              }}
            >
              Shop Now →
            </div>
          </div>
        </a>

        <div style={{ padding:"8px 10px", display:"flex", alignItems:"center", justifyContent:"center", borderTop:"1px solid #f3f3f3" }}>
          <img src={HomageLogo} alt="Homage" style={{ height:"12px", objectFit:"contain" }} loading="lazy" />
        </div>
      </div>
    </div>
  );
}

const AD_HOVER_CSS = `
  .wd-margin-ad:hover .wd-margin-ad-card { box-shadow: 0 8px 26px rgba(0,0,0,0.14); transform: translateY(-2px); }
  .wd-margin-ad:hover .wd-margin-ad-cta { background: #a10d24; }
  .wd-margin-ad:hover .wd-margin-ad-cta-team { filter: brightness(0.85); }
  .wd-team-btn:hover { border-color: #c8102e !important; box-shadow: 0 2px 8px rgba(200,16,46,0.25); transform: translateY(-1px); }
  .wd-team-btn:active { transform: translateY(0) scale(0.94); }
`;

// One ad card laid out in the page's own flow (e.g. a sidebar column)
// instead of the fixed gutter rails — fills its container's width. Same
// ad selection as MarginAds; renders nothing until an ad loads.
export function SideRailAd({ isMobile, preferTeam = "", preferSchool = "", schoolBranding = null }) {
  const { allAds, adData, setAdData, adTeamLogos, adVisible } =
    useAdSelection({ enabled: !isMobile, preferTeam, preferSchool, schoolBranding });
  if (isMobile || !adData) return null;
  return (
    <>
      <style>{AD_HOVER_CSS}</style>
      <PickerAdCard
        adData={adData} allAds={allAds} adTeamLogos={adTeamLogos} setAdData={setAdData}
        style={{ display:"flex", flexDirection:"column", alignItems:"center", opacity: adVisible ? 1 : 0, transition:"opacity 0.7s ease" }}
      />
    </>
  );
}

export default function MarginAds({ contentRef, isMobile, horizontalPadding = 60, preferTeam = "", preferSchool = "", schoolBranding = null }) {
  const { allAds, adData, setAdData, adTeamLogos, adVisible, adTeamBranding } =
    useAdSelection({ enabled: !isMobile, preferTeam, preferSchool, schoolBranding });
  const fit = useMarginAdFit({ contentRef, horizontalPadding, isMobile });
  const showMarginAds = fit.show;

  const MarginAd = ({ side }) => {
    if (!adData) return null;
    return (
      <PickerAdCard
        adData={adData} allAds={allAds} adTeamLogos={adTeamLogos} setAdData={setAdData}
        rootRef={fit.refFor(side)} style={fit.styleFor(side, adVisible)}
      />
    );
  };

  const MarginAdTeamCard = ({ side }) => {
    if (!adData) return null;
    const teamLabel = adTeamLabel(adData);
    const tColor1 = adTeamBranding?.Color1 || SITE_BLUE;
    const tColor2 = adTeamBranding?.Color2 || SITE_GOLD;
    const tLogo = adTeamBranding?.Logo1 || adTeamBranding?.Logo2 || "";
    const gallery = [adData.Image2, adData.Image3].filter(Boolean);
    const displayImages = gallery.length > 0 ? gallery : (adData.Image1 ? [adData.Image1] : []);

    return (
      <div className="wd-margin-ad" ref={fit.refFor(side)} style={fit.styleFor(side, adVisible)}>
        <div style={{ fontSize:"9px", fontWeight:800, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:"6px" }}>
          Sponsored
        </div>
        <div
          className="wd-margin-ad-card"
          style={{
            width:"100%", borderRadius:"14px", overflow:"hidden",
            border:`2px solid ${tColor1}`, background:"#fff",
            boxShadow:`0 4px 18px ${tColor1}40`,
            transition:"box-shadow 0.2s ease, transform 0.2s ease",
          }}
        >
          <div style={{ background:`linear-gradient(135deg, ${tColor1}, ${tColor1}cc)`, padding:"12px 10px", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {(() => {
              // NFL: "Arizona" / "Cardinals". CFB: school / mascot, or the
              // school alone on the big line when there's no mascot.
              const parts = teamLabel.split(" ");
              const cfb = isCfbAd(adData);
              const nickname = cfb ? (adTeamBranding?.Mascot || teamLabel) : parts.pop();
              const cityLine = cfb ? (adTeamBranding?.Mascot ? teamLabel : "") : parts.join(" ");
              return (
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", lineHeight:1.15 }}>
                  <div style={{ fontSize:"12px", fontWeight:900, color:"#fff", textTransform:"uppercase", letterSpacing:"0.06em", textAlign:"center" }}>
                    {cityLine}
                  </div>
                  <div style={{ fontSize:"16px", fontWeight:900, color:"#fff", textTransform:"uppercase", letterSpacing:"0.06em", textAlign:"center" }}>
                    {nickname}
                  </div>
                </div>
              );
            })()}
          </div>

          <a href={sanitizeUrl(adData.Link)} target="_blank" rel="sponsored noopener noreferrer" style={{ display:"block" }}>
            {displayImages.length === 2 ? (
              <div style={{ display:"flex", flexDirection:"column", gap:"2px", background:tColor2 }}>
                {displayImages.map((img, i) => (
                  <img
                    key={i} src={sanitizeUrl(img)} alt={`${teamLabel} gear ${i + 1}`}
                    style={{ width:"100%", display:"block", aspectRatio:"1600 / 1920", objectFit:"cover", background:"#fafafa" }}
                    loading="lazy" fetchpriority="low" referrerPolicy="no-referrer"
                    onError={(e)=>{e.currentTarget.style.display="none";}}
                  />
                ))}
              </div>
            ) : displayImages[0] ? (
              <img
                src={sanitizeUrl(displayImages[0])} alt={`${teamLabel} gear`}
                style={{ width:"100%", display:"block", aspectRatio:"1600 / 1920", objectFit:"cover", background:"#fafafa" }}
                loading="lazy" fetchpriority="low" referrerPolicy="no-referrer"
                onError={(e)=>{e.currentTarget.style.display="none";}}
              />
            ) : null}
          </a>

          <a href={sanitizeUrl(adData.Link)} target="_blank" rel="sponsored noopener noreferrer" style={{ display:"block", textDecoration:"none" }}>
            <div style={{ padding:"9px 12px 12px", textAlign:"center", borderTop:`1px solid ${tColor1}22` }}>
              <div style={{ fontSize:"10px", fontWeight:900, color:"#111", textTransform:"uppercase", letterSpacing:"0.02em", marginBottom:"3px" }}>
                Officially Licensed Throwback Apparel
              </div>
              <div style={{ fontSize:"9px", fontWeight:700, color:"#888", lineHeight:1.35, marginBottom:"9px" }}>
                All 32 NFL Teams + MLB, NBA, NHL &amp; More
              </div>
              <div
                className="wd-margin-ad-cta-team"
                style={{
                  display:"inline-flex", alignItems:"center", gap:"4px",
                  background:tColor1, color:"#fff",
                  fontSize:"10px", fontWeight:900,
                  padding:"7px 16px", borderRadius:"20px",
                  textTransform:"uppercase", letterSpacing:"0.05em",
                  border:`1px solid ${tColor2}`,
                  transition:"filter 0.15s ease",
                }}
              >
                Shop Now →
              </div>
            </div>
          </a>

          {tLogo && (
            <div style={{ padding:"16px 10px", display:"flex", alignItems:"center", justifyContent:"center", background:"#fff", borderTop:`1px solid ${tColor1}22` }}>
              <img
                src={sanitizeUrl(tLogo)} alt={teamLabel} style={{ height:"64px", objectFit:"contain" }}
                loading="lazy"
                referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}}
              />
            </div>
          )}

          <div style={{ padding:"8px 10px", display:"flex", alignItems:"center", justifyContent:"center", borderTop:`1px solid ${tColor1}22` }}>
            <img src={HomageLogo} alt="Homage" style={{ height:"12px", objectFit:"contain" }} loading="lazy" />
          </div>
        </div>
      </div>
    );
  };

  if (!showMarginAds || isMobile || !adData) return null;

  return (
    <>
      <style>{AD_HOVER_CSS}</style>
      <MarginAd side="left" />
      <MarginAdTeamCard side="right" />
    </>
  );
}
