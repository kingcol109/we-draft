import { useNavigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { getAuth } from "firebase/auth";
import { collection, getDocs, query, where, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";

const MAX_MOCKS_PER_CLASS = 5;
const ACTIVE_YEARS = ["2027"];
const ARCHIVE_YEARS = ["2026"];
const ALL_YEARS = [...ACTIVE_YEARS, ...ARCHIVE_YEARS];
const BLUE = "#0055a5";
const GOLD = "#f6a21d";

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
          padding: "12px 20px",
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

export default function MyMocksPage() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mocks, setMocks] = useState([]);
  const [error, setError] = useState("");
  const [classFilter, setClassFilter] = useState("2027");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => { setUser(u); setLoading(false); });
    return unsub;
  }, [auth]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const snap = await getDocs(query(collection(db, "mockDrafts"), where("ownerId", "==", user.uid)));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
      setMocks(data);
    };
    load();
  }, [user]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this mock draft? This cannot be undone.")) return;
    await deleteDoc(doc(db, "mockDrafts", id));
    setMocks((prev) => prev.filter((m) => m.id !== id));
  };

  const filteredMocks = mocks.filter((m) => (m.draftClass || "2026") === classFilter);
  const atLimit = filteredMocks.length >= MAX_MOCKS_PER_CLASS;

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", fontSize: "18px", fontWeight: 900, color: BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
      Loading…
    </div>
  );

  if (!user) return (
    <div style={{ maxWidth: "600px", margin: "80px auto", padding: "0 20px", textAlign: "center", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "14px 20px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Mock Drafts</div>
        </div>
        <div style={{ height: "3px", background: GOLD }} />
        <div style={{ padding: "40px 24px", background: "#fff" }}>
          <div style={{ fontWeight: 900, fontSize: "18px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Please log in to create and manage mock drafts
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Helmet><title>My Mock Drafts | We-Draft</title></Helmet>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              My Mock Drafts
            </div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* ===== Action buttons ===== */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => {
              if (atLimit) { setError(`You've reached the ${MAX_MOCKS_PER_CLASS} mock limit for the ${classFilter} class — delete one to create a new one.`); return; }
              setError("");
              navigate("/mocks/create");
            }}
            style={{
              backgroundColor: atLimit ? "#ccc" : BLUE, color: "#fff",
              border: `2px solid ${atLimit ? "#bbb" : GOLD}`, borderRadius: "8px",
              padding: isMobile ? "10px 20px" : "12px 28px",
              fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
              textTransform: "uppercase", letterSpacing: "0.06em",
              cursor: atLimit ? "not-allowed" : "pointer",
            }}
          >
            + Create Mock
          </button>
          <button
            onClick={() => navigate("/mocks")}
            style={{
              backgroundColor: "#fff", color: BLUE, border: `2px solid ${BLUE}`,
              borderRadius: "8px", padding: isMobile ? "10px 20px" : "12px 28px",
              fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
              textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
            }}
          >
            Mock Hub
          </button>
        </div>

        {/* ===== Class filter tabs ===== */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
          {ACTIVE_YEARS.map((year) => {
            const count = mocks.filter((m) => (m.draftClass || "2026") === year).length;
            const full = count >= MAX_MOCKS_PER_CLASS;
            return (
              <button
                key={year}
                onClick={() => { setClassFilter(year); setError(""); }}
                style={{
                  padding: isMobile ? "7px 18px" : "8px 24px",
                  fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer",
                  background: classFilter === year ? BLUE : "#fff",
                  color: classFilter === year ? "#fff" : BLUE,
                  display: "flex", alignItems: "center", gap: "8px",
                }}
              >
                {year} Class
                <span style={{
                  fontSize: "10px", fontWeight: 900, padding: "1px 7px", borderRadius: "10px",
                  background: full ? "#ffebee" : (classFilter === year ? "rgba(255,255,255,0.25)" : "#e8f5e9"),
                  color: full ? "#c0392b" : (classFilter === year ? "#fff" : "#2e7d32"),
                }}>
                  {count}/{MAX_MOCKS_PER_CLASS}
                </span>
              </button>
            );
          })}
          <ArchiveDropdown classFilter={classFilter} onSelect={(yr) => { setClassFilter(yr); setError(""); }} />
        </div>

        {error && (
          <div style={{ background: "#fff3f3", border: "2px solid #e74c3c", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontWeight: 700, fontSize: "13px", color: "#c0392b" }}>
            {error}
          </div>
        )}

        {/* ===== Mocks list ===== */}
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: isMobile ? "14px" : "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
            {classFilter} Class Drafts
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {filteredMocks.length === 0 ? (
          <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ background: BLUE, padding: "8px 16px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{classFilter} Class</div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            <div style={{ padding: "40px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px", background: "#fff" }}>
              You haven't created a {classFilter} mock draft yet.
            </div>
          </div>
        ) : (
          <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ background: BLUE, padding: "8px 16px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {filteredMocks.length} / {MAX_MOCKS_PER_CLASS} {classFilter} Drafts
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />

            {filteredMocks.map((mock, i) => {
              const date = mock.updatedAt?.seconds
                ? new Date(mock.updatedAt.seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                : null;
              const rounds = mock.rounds || 1;

              return (
                <div key={mock.id} style={{
                  display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px",
                  padding: isMobile ? "12px 12px" : "14px 18px",
                  borderBottom: i < filteredMocks.length - 1 ? "1px solid #f0f0f0" : "none",
                  background: "#fff",
                }}>
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
                    <div
                      onClick={() => navigate(`/mocks/${mock.id}`)}
                      style={{ fontWeight: 900, fontSize: isMobile ? "14px" : "17px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2, marginBottom: "3px", cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                    >
                      {mock.name || "Untitled Mock Draft"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      {date && <div style={{ fontSize: "11px", fontWeight: 700, color: "#bbb" }}>Last saved {date}</div>}
                      {mock.visibility === "public" && (
                        <span style={{ background: "#e8f5e9", color: "#2e7d32", fontSize: "8px", fontWeight: 900, padding: "1px 6px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          Public
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Buttons */}
                  <div style={{ flexShrink: 0, display: "flex", gap: "6px" }}>
                    <button
                      onClick={() => navigate(`/mocks/${mock.id}`)}
                      style={{
                        backgroundColor: GOLD, color: "#fff", border: `2px solid #c98a10`,
                        borderRadius: "8px", padding: isMobile ? "6px 12px" : "7px 16px",
                        fontWeight: 900, fontSize: "12px", textTransform: "uppercase",
                        letterSpacing: "0.06em", cursor: "pointer",
                      }}
                    >
                      Edit →
                    </button>
                    <button
                      onClick={() => handleDelete(mock.id)}
                      style={{
                        backgroundColor: "#fff", color: "#c0392b",
                        border: "2px solid #e74c3c", borderRadius: "8px",
                        padding: isMobile ? "6px 10px" : "7px 14px",
                        fontWeight: 900, fontSize: "12px", textTransform: "uppercase",
                        letterSpacing: "0.06em", cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}