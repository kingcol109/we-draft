import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const ACTIVE_YEARS = ["2027"];
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
      <Helmet><title>Mock Draft Hub | We-Draft</title></Helmet>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              Mock Draft Hub
            </div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* ===== Action buttons ===== */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
          <button
            onClick={() => navigate("/mocks/create")}
            style={{
              backgroundColor: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
              borderRadius: "8px", padding: isMobile ? "10px 20px" : "12px 28px",
              fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
              textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
            }}
          >
            + Create Mock
          </button>
          <button
            onClick={() => navigate("/mocks/my")}
            style={{
              backgroundColor: "#fff", color: BLUE, border: `2px solid ${BLUE}`,
              borderRadius: "8px", padding: isMobile ? "10px 20px" : "12px 28px",
              fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
              textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
            }}
          >
            My Mocks
          </button>
        </div>

        {/* ===== Class filter tabs ===== */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
          {ACTIVE_YEARS.map((year) => (
            <button
              key={year}
              onClick={() => setClassFilter(year)}
              style={{
                padding: isMobile ? "7px 18px" : "8px 24px",
                fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
                textTransform: "uppercase", letterSpacing: "0.06em",
                border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer",
                background: classFilter === year ? BLUE : "#fff",
                color: classFilter === year ? "#fff" : BLUE,
              }}
            >
              {year} Class
            </button>
          ))}
          <ArchiveDropdown classFilter={classFilter} onSelect={setClassFilter} />
        </div>

        {/* ===== Mock list ===== */}
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: isMobile ? "14px" : "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
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
            <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>No public {classFilter} mock drafts yet.</div>
          ) : (
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 16px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {filtered.length} Mock{filtered.length !== 1 ? "s" : ""} — {classFilter} Class
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
                    style={{
                      display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px",
                      padding: isMobile ? "12px 12px" : "14px 18px",
                      borderBottom: i < filtered.length - 1 ? "1px solid #f0f0f0" : "none",
                      background: "#fff",
                    }}
                  >
                    {/* Round badge */}
                    <div style={{
                      flexShrink: 0, width: isMobile ? "44px" : "54px", height: isMobile ? "44px" : "54px",
                      background: BLUE, border: `2px solid ${GOLD}`, borderRadius: "8px",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      color: "#fff", lineHeight: 1,
                    }}>
                      <span style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900 }}>{rounds}</span>
                      <span style={{ fontSize: "8px", fontWeight: 800, opacity: 0.8, textTransform: "uppercase" }}>
                        {rounds === 1 ? "Round" : "Rnds"}
                      </span>
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: isMobile ? "14px" : "17px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2, marginBottom: "3px" }}>
                        {mock.name || "Untitled Mock Draft"}
                      </div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>
                        by {author}
                        {date && <span style={{ color: "#bbb", marginLeft: "8px" }}>· {date}</span>}
                      </div>
                      {mock.description && (
                        <div style={{ fontSize: "11px", fontWeight: 600, color: "#999", marginTop: "3px", lineHeight: 1.4 }}>
                          {mock.description.length > 80 ? mock.description.slice(0, 80) + "…" : mock.description}
                        </div>
                      )}
                    </div>

                    {/* View button */}
                    <button
                      onClick={() => navigate(`/mocks/${mock.id}`)}
                      style={{
                        flexShrink: 0, backgroundColor: GOLD, color: "#fff",
                        border: `2px solid #c98a10`, borderRadius: "8px",
                        padding: isMobile ? "7px 14px" : "8px 18px",
                        fontWeight: 900, fontSize: isMobile ? "12px" : "13px",
                        textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                      }}
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