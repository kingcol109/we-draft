// src/components/MarginAds.js
//
// Sponsored margin ads — the fixed-position "Homage throwback gear" side
// rails that live in the empty gutters beside the main content on wide
// viewports. Extracted from PlayerProfile.js (the original, more elaborate
// version there prioritizes a drafted/affiliate team before falling back to
// random) so ArticlePage/NewsArticle/PerformancePage can reuse the exact
// same visual system without duplicating ~250 lines of ad-card markup three
// times over. Those pages have no "this player's team" concept to prioritize
// anyway, so team selection here is always random — pass a contentRef to
// whatever element the ads should center themselves around and this handles
// the rest (fetch, layout measurement, resize, hover states).
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import HomageLogo from "../assets/homagelogo.png";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

const NFL_TEAM_ABBRS = [
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE",
  "DAL","DEN","DET","GB","HOU","IND","JAX","KC",
  "LV","LAC","LAR","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS",
];

function teamNameFromAbbr(abbr) {
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

function sanitizeImgur(url) {
  if (!url) return "";
  if (/^https?:\/\/i\.imgur\.com\/.+\.(png|jpe?g|gif|webp)$/i.test(url)) return url;
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
function sanitizeUrl(url) {
  let u = (url || "").trim();
  if (!u) return "";
  if (u.includes("imgur.com")) u = sanitizeImgur(u);
  if (u.includes("drive.google.com")) u = sanitizeGoogleDrive(u);
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/**
 * @param {React.RefObject} contentRef - ref on the page's main content
 *   container (the element whose left/right gutters the ads should center
 *   in). Its own horizontal padding is subtracted via horizontalPadding so
 *   the ad centers against the visible content edge, not the padding box.
 * @param {boolean} isMobile - ads never show on mobile (no gutter room).
 * @param {number} horizontalPadding - the contentRef element's own
 *   left/right padding in px (defaults to 60, matching PlayerProfile.js).
 */
export default function MarginAds({ contentRef, isMobile, horizontalPadding = 60 }) {
  const [allAds, setAllAds] = useState([]);
  const [adData, setAdData] = useState(null);
  const [adVisible, setAdVisible] = useState(false);
  const [adTeamBranding, setAdTeamBranding] = useState(null);
  const [adLayout, setAdLayout] = useState({ width: 140, leftGutter: 0, rightGutter: 0 });
  const [showMarginAds, setShowMarginAds] = useState(false);

  const recomputeAdLayout = () => {
    if (isMobile || !contentRef.current) { setShowMarginAds(false); return; }
    const rect = contentRef.current.getBoundingClientRect();
    const visibleLeftEdge = rect.left + horizontalPadding;
    const visibleRightEdge = rect.right - horizontalPadding;
    const leftGutter = Math.max(0, visibleLeftEdge);
    const rightGutter = Math.max(0, window.innerWidth - visibleRightEdge);
    const minGutter = Math.min(leftGutter, rightGutter);
    const MIN_USABLE_GUTTER = 160;
    if (minGutter < MIN_USABLE_GUTTER) { setShowMarginAds(false); return; }
    const width = Math.max(140, Math.min(240, minGutter - 16));
    setAdLayout({ width, leftGutter, rightGutter });
    setShowMarginAds(true);
  };

  useEffect(() => {
    const handler = () => recomputeAdLayout();
    window.addEventListener("resize", handler);
    // The ref has no real size until content actually renders — a couple of
    // delayed retries cover fonts/images nudging the layout after mount.
    recomputeAdLayout();
    const t1 = setTimeout(recomputeAdLayout, 200);
    const t2 = setTimeout(recomputeAdLayout, 800);
    return () => { window.removeEventListener("resize", handler); clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // Fetch ads and pick one at random — no drafted/affiliate priority here,
  // these pages have no single "this team" to prioritize.
  useEffect(() => {
    if (isMobile) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const snap = await getDocs(collection(db, "ads"));
        const ads = snap.docs.map((d) => d.data()).filter((a) => a.Link && a.Image1);
        if (!cancelled && ads.length > 0) {
          setAllAds(ads);
          setAdData(ads[Math.floor(Math.random() * ads.length)]);
        }
      } catch (e) { /* ads are non-critical — fail silently */ }
    }, 1000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isMobile]);

  useEffect(() => {
    if (!adData) return;
    const t = setTimeout(() => setAdVisible(true), 20);
    return () => clearTimeout(t);
  }, [adData]);

  useEffect(() => {
    if (!adData?.Team) { setAdTeamBranding(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "nfl", adData.Team));
        if (!cancelled) setAdTeamBranding(snap.exists() ? snap.data() : null);
      } catch (e) {
        if (!cancelled) setAdTeamBranding(null);
      }
    })();
    return () => { cancelled = true; };
  }, [adData?.Team]);

  const marginAdPositionStyle = (side) => {
    const gutter = side === "left" ? adLayout.leftGutter : adLayout.rightGutter;
    const offset = Math.max(8, (gutter - adLayout.width) / 2);
    return {
      position: "fixed",
      top: "50%",
      [side]: `${offset}px`,
      transform: "translateY(-50%)",
      width: `${adLayout.width}px`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      zIndex: 5,
      opacity: adVisible ? 1 : 0,
      transition: "opacity 0.7s ease",
    };
  };

  const MarginAd = ({ side }) => {
    if (!adData) return null;
    const teamLabel = teamNameFromAbbr(adData.Team) || adData.Team;
    return (
      <div className="wd-margin-ad" style={marginAdPositionStyle(side)}>
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
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"5px" }}>
              {NFL_TEAM_ABBRS.map((abbr) => {
                const teamAd = allAds.find((a) => a.Team === abbr);
                const isActive = adData.Team === abbr;
                return (
                  <button
                    key={abbr}
                    type="button"
                    disabled={!teamAd}
                    title={teamNameFromAbbr(abbr)}
                    className={teamAd ? "wd-team-btn" : ""}
                    onClick={() => { if (teamAd) setAdData(teamAd); }}
                    style={{
                      fontSize:"8.5px", fontWeight:900,
                      padding:"5px 0", borderRadius:"4px",
                      border:`1px solid ${isActive ? "#c8102e" : "#eee"}`,
                      background: isActive ? "#c8102e" : teamAd ? "#fff" : "#f6f6f6",
                      color: isActive ? "#fff" : teamAd ? "#333" : "#ccc",
                      cursor: teamAd ? "pointer" : "not-allowed",
                      transition: "transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease",
                    }}
                  >
                    {abbr}
                  </button>
                );
              })}
            </div>
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
            <img src={HomageLogo} alt="Homage" style={{ height:"12px", objectFit:"contain" }} />
          </div>
        </div>
      </div>
    );
  };

  const MarginAdTeamCard = ({ side }) => {
    if (!adData) return null;
    const teamLabel = teamNameFromAbbr(adData.Team) || adData.Team;
    const tColor1 = adTeamBranding?.Color1 || SITE_BLUE;
    const tColor2 = adTeamBranding?.Color2 || SITE_GOLD;
    const tLogo = adTeamBranding?.Logo1 || adTeamBranding?.Logo2 || "";
    const gallery = [adData.Image2, adData.Image3].filter(Boolean);
    const displayImages = gallery.length > 0 ? gallery : (adData.Image1 ? [adData.Image1] : []);

    return (
      <div className="wd-margin-ad" style={marginAdPositionStyle(side)}>
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
              const parts = teamLabel.split(" ");
              const nickname = parts.pop();
              const cityLine = parts.join(" ");
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
                referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.style.display="none";}}
              />
            </div>
          )}

          <div style={{ padding:"8px 10px", display:"flex", alignItems:"center", justifyContent:"center", borderTop:`1px solid ${tColor1}22` }}>
            <img src={HomageLogo} alt="Homage" style={{ height:"12px", objectFit:"contain" }} />
          </div>
        </div>
      </div>
    );
  };

  if (!showMarginAds || isMobile || !adData) return null;

  return (
    <>
      <style>{`
        .wd-margin-ad:hover .wd-margin-ad-card { box-shadow: 0 8px 26px rgba(0,0,0,0.14); transform: translateY(-2px); }
        .wd-margin-ad:hover .wd-margin-ad-cta { background: #a10d24; }
        .wd-margin-ad:hover .wd-margin-ad-cta-team { filter: brightness(0.85); }
        .wd-team-btn:hover { border-color: #c8102e !important; box-shadow: 0 2px 8px rgba(200,16,46,0.25); transform: translateY(-1px); }
        .wd-team-btn:active { transform: translateY(0) scale(0.94); }
      `}</style>
      <MarginAd side="left" />
      <MarginAdTeamCard side="right" />
    </>
  );
}
