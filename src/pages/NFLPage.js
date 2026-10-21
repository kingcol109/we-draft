import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginAds from "../components/MarginAds";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

const DIVISION_ORDER = [
  { conf: "AFC", divisions: ["AFC East", "AFC North", "AFC South", "AFC West"] },
  { conf: "NFC", divisions: ["NFC East", "NFC North", "NFC South", "NFC West"] },
];
const CONFS = DIVISION_ORDER.map((c) => c.conf);

// One team — same card as CFBPage.js's Teams tab: team-color panel with the
// logo (dark variant, since it sits on the team's color), a second-color
// rule, and the name on a white footer.
function TeamCard({ team, isMobile }) {
  const primary = team.Color1 || SITE_BLUE;
  const secondary = team.Color2 || SITE_GOLD;
  const abbr = team.Abbreviation || team.id;
  const logoSrc = team.LogoDark || team.Logo1 || "";
  const logoSize = isMobile ? "46px" : "72px";
  return (
    <Link to={`/nfl/${abbr.toLowerCase()}`} className="wd-tc">
      <div
        className="wd-tc-panel"
        style={{
          position: "relative", overflow: "hidden",
          height: isMobile ? "64px" : "100px",
          display: "flex", alignItems: "center", justifyContent: "center",
          // Soft spotlight behind the logo, darker toward the edges.
          background: `radial-gradient(circle at 50% 42%, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,0.28) 100%), ${primary}`,
        }}
      >
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={team.Team}
            className="wd-tc-logo"
            loading="lazy"
            style={{ position: "relative", width: logoSize, height: logoSize, objectFit: "contain", filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.4))" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className="wd-tc-logo" style={{
            position: "relative", width: logoSize, height: logoSize, borderRadius: "50%", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: primary, fontSize: isMobile ? "14px" : "20px", fontWeight: 900,
          }}>
            {abbr}
          </div>
        )}
      </div>
      <div style={{ height: "3px", background: secondary }} />
      <div style={{ padding: isMobile ? "6px 2px" : "8px 6px", textAlign: "center", lineHeight: 1.15 }}>
        {!isMobile && (
          <div style={{ fontSize: "9px", fontWeight: 800, color: "#9aa5b4", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {team.City}
          </div>
        )}
        <div style={{
          fontSize: isMobile ? "9px" : "12px", fontWeight: 900, color: "#1a1f2b",
          textTransform: "uppercase", letterSpacing: "0.04em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {team.Team}
        </div>
      </div>
    </Link>
  );
}

export default function NFLPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );
  // The 1200px content column — MarginAds centers its Homage rails in the
  // gutters beside it.
  const contentRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    async function fetchTeams() {
      try {
        const snapshot = await getDocs(collection(db, "nfl"));
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setTeams(data);
      } catch (err) {
        console.error("Error fetching NFL teams:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchTeams();
  }, []);

  // Group by division
  const grouped = {};
  DIVISION_ORDER.forEach(({ divisions }) => {
    divisions.forEach((div) => {
      grouped[div] = teams
        .filter((t) => `${t.Conference} ${t.Division}` === div)
        .sort((a, b) => a.Team.localeCompare(b.Team));
    });
  });

  // Conference filter in the query string (?conf=), like CFBPage.js's —
  // anything unrecognized falls back to All.
  const confParam = (searchParams.get("conf") || "").toUpperCase();
  const activeConf = CONFS.includes(confParam) ? confParam : "All";
  const visible = DIVISION_ORDER.filter(({ conf }) => activeConf === "All" || conf === activeConf);

  if (loading) return <LoadingSpinner label="Loading Teams" size={56} minHeight="calc(100vh / var(--pz, 1))" />;

  return (
    <>
      <Helmet>
        <title>NFL Teams | We-Draft</title>
      </Helmet>

      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={24} />

      <div ref={contentRef} style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "12px 12px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        <style>{`
          .wd-tc {
            position: relative; display: flex; flex-direction: column;
            border-radius: 12px; overflow: hidden; text-decoration: none; background: #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2;
            transition: transform 0.18s ease, box-shadow 0.18s ease;
          }
          .wd-tc:hover {
            transform: translateY(-3px);
            box-shadow: 0 14px 30px rgba(0,40,90,0.18), 0 0 0 1px #d3dcea;
          }
          .wd-tc-logo { transition: transform 0.22s ease; }
          .wd-tc:hover .wd-tc-logo { transform: scale(1.16) rotate(-5deg); }
          /* Light sweep across the color panel on hover. */
          .wd-tc-panel::after {
            content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%;
            background: linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%);
            transform: skewX(-18deg); pointer-events: none;
          }
          .wd-tc:hover .wd-tc-panel::after { animation: wdTcShine 0.7s ease-out; }
          @keyframes wdTcShine {
            from { left: -60%; }
            to { left: 130%; }
          }
          .wd-conf-tab { transition: background 0.15s ease, color 0.15s ease; }
          @media (prefers-reduced-motion: reduce) {
            .wd-tc, .wd-tc-logo { transition: none !important; }
            .wd-tc:hover { transform: none; }
            .wd-tc:hover .wd-tc-panel::after { animation: none; }
          }
        `}</style>

        {/* ===== Page Header ===== */}
        <div style={{ marginBottom: isMobile ? "16px" : "22px" }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? "22px" : "30px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: SITE_BLUE, marginBottom: "6px" }}>
            NFL Teams
          </h1>
          <div style={{ height: "3px", backgroundColor: SITE_BLUE, borderRadius: "2px", marginBottom: "4px" }} />
          <div style={{ height: "3px", backgroundColor: SITE_GOLD, borderRadius: "2px" }} />
        </div>

        {/* ===== Conference filter ===== */}
        <div
          role="tablist"
          style={{
            display: "flex", flexWrap: "wrap", padding: "4px", gap: "4px", marginBottom: isMobile ? "20px" : "28px",
            background: "#eef3f9", borderRadius: "12px",
          }}
        >
          {["All", ...CONFS].map((c) => {
            const on = activeConf === c;
            const count = c === "All" ? teams.length : teams.filter((t) => t.Conference === c).length;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={on}
                className="wd-conf-tab"
                onClick={() => setSearchParams(c === "All" ? {} : { conf: c.toLowerCase() }, { replace: true })}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  padding: isMobile ? "7px 12px" : "8px 16px", border: "none", borderRadius: "9px", cursor: "pointer",
                  fontWeight: 900, fontSize: isMobile ? "11px" : "12px", textTransform: "uppercase", letterSpacing: "0.04em",
                  background: on ? SITE_BLUE : "transparent", color: on ? "#fff" : SITE_BLUE,
                  boxShadow: on ? "0 3px 10px rgba(0,85,165,0.3)" : "none", whiteSpace: "nowrap",
                }}
              >
                {c}
                <span style={{
                  padding: "1px 6px", borderRadius: "20px", fontSize: "10px",
                  background: on ? SITE_GOLD : "#fff", color: on ? "#fff" : SITE_BLUE,
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ===== AFC + NFC ===== */}
        {visible.map(({ conf, divisions }) => (
          <section key={conf} style={{ marginBottom: isMobile ? "26px" : "36px" }}>
            {/* Conference header — same look as CFBPage.js's conference headers */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: isMobile ? "12px" : "16px" }}>
              <h2 style={{
                margin: 0, fontWeight: 900, fontSize: isMobile ? "18px" : "22px", textTransform: "uppercase", letterSpacing: "0.08em",
                color: SITE_BLUE, whiteSpace: "nowrap",
              }}>
                {conf}
              </h2>
              <div style={{ flex: 1, height: "2px", background: `linear-gradient(to right, ${SITE_GOLD}, rgba(246,162,29,0))` }} />
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#9aa5b4", whiteSpace: "nowrap" }}>
                {divisions.reduce((n, d) => n + (grouped[d]?.length || 0), 0)} Teams
              </div>
            </div>

            {/* Divisions — two side by side on desktop, each a row of four */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "14px" : "18px 22px" }}>
              {divisions.map((div) => (
                <div key={div} style={{ background: "#f7f9fc", borderRadius: "14px", padding: isMobile ? "10px" : "12px 14px 14px", boxShadow: "inset 0 0 0 1px #e6ebf2" }}>
                  <div style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", color: SITE_BLUE, marginBottom: "8px" }}>
                    {div.replace(`${conf} `, "")}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: isMobile ? "8px" : "12px" }}>
                    {(grouped[div] || []).map((team) => (
                      <TeamCard key={team.id} team={team} isMobile={isMobile} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
