import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const ACTIVE_YEARS = ["2027", "2028"];
const ARCHIVE_YEARS = ["2026"];

function ArchiveDropdown({ classFilter, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isArchive = ARCHIVE_YEARS.includes(classFilter);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          border: `2px solid ${GOLD}`, borderRadius: "8px",
          padding: "8px 24px",
          fontWeight: 900, fontSize: "14px",
          textTransform: "uppercase", letterSpacing: "0.06em",
          cursor: "pointer",
          background: isArchive ? BLUE : "#fff",
          color: isArchive ? "#fff" : BLUE,
          whiteSpace: "nowrap",
        }}
      >
        {isArchive ? `Archive: ${classFilter}` : "Archive"} ▾
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0,
          zIndex: 50, minWidth: "160px",
          background: "#fff", border: `2px solid ${GOLD}`, borderRadius: "10px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.14)", overflow: "hidden",
        }}>
          <div style={{ background: BLUE, padding: "8px 14px", fontSize: "11px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Past Draft Classes
          </div>
          <div style={{ height: "3px", background: GOLD }} />
          {ARCHIVE_YEARS.map((yr) => (
            <div
              key={yr}
              onClick={() => { onSelect(yr); setOpen(false); }}
              style={{
                padding: "11px 16px", cursor: "pointer", fontWeight: 900,
                fontSize: "15px", color: classFilter === yr ? "#fff" : BLUE,
                background: classFilter === yr ? BLUE : "#fff",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                borderBottom: "1px solid #f0f0f0",
              }}
              onMouseEnter={(e) => { if (classFilter !== yr) e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { if (classFilter !== yr) e.currentTarget.style.background = "#fff"; }}
            >
              <span>{yr}</span>
              {classFilter === yr && <span style={{ color: GOLD }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MockDraftHub() {
  const navigate = useNavigate();
  const [mocks, setMocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userMap, setUserMap] = useState({});
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [classFilter, setClassFilter] = useState("2027");

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db, "mockDrafts"), where("visibility", "==", "public"), orderBy("updatedAt", "desc")));
        setMocks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) { console.error("Failed to load mock drafts", err); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, "users"));
        const map = {};
        snap.forEach((d) => { const u = d.data(); map[d.id] = u.username || u.email || d.id; });
        setUserMap(map);
      } catch (err) { console.error("Failed to load users", err); }
    };
    load();
  }, []);

  return (
    <>
      <Helmet>
        <title>Mock Draft Hub | We-Draft.com</title>
        <meta name="description" content="Create and share 2027 and 2028 NFL Mock Drafts on We-Draft.com. Use your personal scouting grades, trade picks, and see how your board stacks up against the community." />
        <meta property="og:title" content="Mock Draft Hub | We-Draft.com" />
        <meta property="og:description" content="Create and share 2027 and 2028 NFL Mock Drafts on We-Draft.com. Use your personal scouting grades, trade picks, and see how your board stacks up against the community." />
        <meta property="og:url" content="https://we-draft.com/mocks" />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Mock Draft Hub | We-Draft.com" />
        <meta name="twitter:description" content="Create and share 2027 and 2028 NFL Mock Drafts on We-Draft.com. Use your personal scouting grades, trade picks, and see how your board stacks up against the community." />
        <link rel="canonical" href="https://we-draft.com/mocks" />
      </Helmet>

      <style>{`
        .mock-hub-create-btn {
          transition: background 0.15s, transform 0.1s;
        }
        .mock-hub-create-btn:hover {
          background: #003a7a !important;
          transform: translateY(-1px);
        }
        .mock-hub-create-btn:active {
          transform: translateY(0);
        }
        .mock-row {
          transition: background 0.12s, transform 0.12s;
          cursor: pointer;
        }
        .mock-row:hover {
          background: #f0f5ff !important;
          transform: translateX(3px);
        }
        .mock-row:hover .mock-name {
          text-decoration: underline;
        }
      `}</style>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              Mock Draft Hub
            </div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* ===== Hero CTA banner ===== */}
        <div style={{
          background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`,
          borderRadius: "12px",
          border: `2px solid ${GOLD}`,
          padding: isMobile ? "18px 16px" : "22px 28px",
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Diagonal stripe decoration */}
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: "200px",
            background: "repeating-linear-gradient(55deg, transparent, transparent 18px, rgba(246,162,29,0.06) 18px, rgba(246,162,29,0.06) 36px)",
            pointerEvents: "none",
          }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: isMobile ? "9px" : "10px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "4px" }}>
              🏈 Build Your Board
            </div>
            <div style={{ fontSize: isMobile ? "18px" : "24px", fontWeight: 900, color: "#fff", lineHeight: 1.1, marginBottom: "6px" }}>
              Create Your Mock Draft
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {[
                "Use your scouting grades",
                "Trade picks",
                "Share publicly",
              ].map((tag) => (
                <span key={tag} style={{
                  background: "rgba(246,162,29,0.18)",
                  border: `1px solid rgba(246,162,29,0.4)`,
                  color: GOLD,
                  fontSize: "10px", fontWeight: 900,
                  padding: "2px 9px", borderRadius: "20px",
                  textTransform: "uppercase", letterSpacing: "0.08em",
                }}>
                  ✓ {tag}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", flexShrink: 0, position: "relative" }}>
            <button
              className="mock-hub-create-btn"
              onClick={() => navigate("/mocks/create")}
              style={{
                backgroundColor: GOLD, color: "#fff",
                border: "2px solid #fff",
                borderRadius: "8px", padding: isMobile ? "10px 20px" : "12px 28px",
                fontWeight: 900, fontSize: isMobile ? "13px" : "15px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              + Create Mock
            </button>
            <button
              onClick={() => navigate("/mocks/my")}
              style={{
                backgroundColor: "rgba(255,255,255,0.12)", color: "#fff",
                border: "2px solid rgba(255,255,255,0.4)",
                borderRadius: "8px", padding: isMobile ? "10px 20px" : "12px 28px",
                fontWeight: 900, fontSize: isMobile ? "13px" : "15px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.22)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
            >
              My Mocks
            </button>
          </div>
        </div>

        {/* ===== Class filter tabs ===== */}
        <div style={{ marginBottom: "10px" }}>
          <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", color: BLUE, marginBottom: "5px" }}>
            Community Mock Drafts
          </div>
          <div style={{ height: "2px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "2px", background: GOLD, borderRadius: "2px" }} />
        </div>
        <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
          {ACTIVE_YEARS.map((year) => (
            <button
              key={year}
              onClick={() => setClassFilter(year)}
              style={{
                padding: isMobile ? "8px 20px" : "9px 26px",
                fontWeight: 900, fontSize: isMobile ? "13px" : "15px",
                textTransform: "uppercase", letterSpacing: "0.06em",
                border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer",
                background: classFilter === year ? BLUE : "#fff",
                color: classFilter === year ? "#fff" : BLUE,
                transition: "background 0.12s, color 0.12s",
              }}
            >
              {year} Class
            </button>
          ))}
          <ArchiveDropdown classFilter={classFilter} onSelect={setClassFilter} />
        </div>

        {/* ===== Section title ===== */}
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: isMobile ? "16px" : "20px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
            Recent Mock Drafts
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {loading ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>Loading…</div>
        ) : (() => {
          const filtered = mocks.filter((m) => (m.draftClass || "2026") === classFilter);
          return filtered.length === 0 ? (
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 16px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{classFilter} Class</div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              <div style={{ padding: "50px 24px", textAlign: "center", background: "#fff" }}>
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>🏈</div>
                <div style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                  No {classFilter} mocks yet
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#888", marginBottom: "20px" }}>
                  Be the first to publish a {classFilter} mock draft
                </div>
                <button
                  onClick={() => navigate("/mocks/create")}
                  style={{
                    backgroundColor: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
                    borderRadius: "8px", padding: "10px 28px",
                    fontWeight: 900, fontSize: "13px",
                    textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                  }}
                >
                  + Create the First One
                </button>
              </div>
            </div>
          ) : (
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {filtered.length} Mock{filtered.length !== 1 ? "s" : ""} — {classFilter} Class
                </div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Community
                </div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />

              {filtered.map((mock, i) => {
                const date = mock.updatedAt?.toDate?.()?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                const rounds = mock.rounds || 1;
                const author = userMap[mock.ownerId] || "Unknown";

                return (
                  <div
                    key={mock.id}
                    className="mock-row"
                    style={{
                      display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px",
                      padding: isMobile ? "13px 14px" : "16px 22px",
                      borderBottom: i < filtered.length - 1 ? `1px solid #f0f0f0` : "none",
                      background: "#fff",
                    }}
                    onClick={() => navigate(`/mocks/${mock.id}`)}
                  >
                    {/* Round badge */}
                    <div style={{
                      flexShrink: 0,
                      width: isMobile ? "48px" : "64px",
                      height: isMobile ? "48px" : "64px",
                      background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`,
                      border: `2px solid ${GOLD}`,
                      borderRadius: "10px",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      color: "#fff", lineHeight: 1,
                      boxShadow: `0 3px 10px rgba(0,85,165,0.25)`,
                    }}>
                      <span style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 900, letterSpacing: "-0.02em" }}>{rounds}</span>
                      <span style={{ fontSize: "8px", fontWeight: 800, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {rounds === 1 ? "Rnd" : "Rnds"}
                      </span>
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="mock-name"
                        style={{ fontWeight: 900, fontSize: isMobile ? "16px" : "21px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2, marginBottom: "4px" }}
                      >
                        {mock.name || "Untitled Mock Draft"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "#555" }}>by {author}</span>
                        {date && <span style={{ fontSize: "12px", fontWeight: 700, color: "#bbb" }}>· {date}</span>}
                      </div>
                      {mock.description && (
                        <div style={{ fontSize: "11px", fontWeight: 600, color: "#999", marginTop: "3px", lineHeight: 1.4 }}>
                          {mock.description.length > 80 ? mock.description.slice(0, 80) + "…" : mock.description}
                        </div>
                      )}
                    </div>

                    {/* View button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/mocks/${mock.id}`); }}
                      style={{
                        flexShrink: 0, backgroundColor: GOLD, color: "#fff",
                        border: `2px solid #c98a10`, borderRadius: "8px",
                        padding: isMobile ? "8px 16px" : "10px 24px",
                        fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
                        textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#d98f10"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = GOLD; }}
                    >
                      View →
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </>
  );
}