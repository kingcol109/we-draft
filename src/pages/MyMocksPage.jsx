// src/pages/MyMocksPage.jsx
//
// /mocks/my — the signed-in user's own mock drafts (public and private),
// up to MAX_MOCKS_PER_CLASS per draft class, each with View / Edit / Delete.
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { useAuth } from "../context/AuthContext";
import {
  BLUE, INK, MUTED, CARD_SHADOW, BODY_FONT, MOCK_CARD_CSS,
  useIsMobile, MockPageShell, MockHero, heroText, chip, button, SectionTitle, PhoneAd,
} from "../components/MockDraftKit";

const MAX_MOCKS_PER_CLASS = 5;
const ACTIVE_YEARS = ["2027", "2028"];
const ARCHIVE_YEARS = ["2026"];

export default function MyMocksPage() {
  const navigate = useNavigate();
  const { user, authReady, login } = useAuth();
  const isMobile = useIsMobile();
  const [mocks, setMocks] = useState(null);
  const [error, setError] = useState("");
  const [classFilter, setClassFilter] = useState("2027");

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db, "mockDrafts"), where("ownerId", "==", user.uid)));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
        setMocks(data);
      } catch (err) { console.error("Failed to load my mocks", err); setMocks([]); }
    };
    load();
  }, [user]);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this mock draft? This cannot be undone.")) return;
    await deleteDoc(doc(db, "mockDrafts", id));
    setMocks((prev) => prev.filter((m) => m.id !== id));
  };

  const list = mocks || [];
  const countFor = (y) => list.filter((m) => (m.draftClass || "2026") === y).length;
  const filteredMocks = list.filter((m) => (m.draftClass || "2026") === classFilter);
  const isArchive = ARCHIVE_YEARS.includes(classFilter);
  const atLimit = filteredMocks.length >= MAX_MOCKS_PER_CLASS;

  const create = () => {
    if (atLimit) { setError(`You've reached the ${MAX_MOCKS_PER_CLASS} mock limit for the ${classFilter} class — delete one to write a new one.`); return; }
    setError("");
    navigate("/mocks/create");
  };

  if (!authReady || (user && !mocks)) return <LoadingSpinner label="Loading" size={56} minHeight="calc(60vh / var(--pz, 1))" />;

  return (
    <>
      <Helmet><title>My Mock Drafts | We-Draft</title></Helmet>
      <style>{MOCK_CARD_CSS}</style>

      <MockPageShell width={900} year={isArchive ? "2027" : classFilter} isMobile={isMobile}>
        <MockHero
          eyebrow="Mock Drafts"
          title="My Mock Drafts"
          isMobile={isMobile}
          actions={user && (
            <>
              {!isArchive && <button onClick={create} style={{ ...button("gold", isMobile), opacity: atLimit ? 0.6 : 1 }}>+ Write a Mock</button>}
              <button onClick={() => navigate("/mocks")} style={button("ghost", isMobile)}>All Mocks</button>
            </>
          )}
        >
          <p style={heroText(isMobile)}>
            {user
              ? `Your drafts, public and private — up to ${MAX_MOCKS_PER_CLASS} per class. Add an intro and a note on each pick before you publish.`
              : "Sign in to write mock drafts, trade picks, and publish your board with notes on every selection."}
          </p>
          {!user && (
            <button onClick={login} style={{ ...button("gold", isMobile), marginTop: 14 }}>Sign In →</button>
          )}
        </MockHero>

        {user && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
              {ACTIVE_YEARS.map((y) => {
                const n = countFor(y);
                const on = classFilter === y;
                return (
                  <button key={y} onClick={() => { setClassFilter(y); setError(""); }} aria-pressed={on} style={chip(on, isMobile)}>
                    {y} Draft{" "}
                    <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.8, color: n >= MAX_MOCKS_PER_CLASS && !on ? "#b42318" : "inherit" }}>
                      {n}/{MAX_MOCKS_PER_CLASS}
                    </span>
                  </button>
                );
              })}
              {ARCHIVE_YEARS.map((y) => (
                <button key={y} onClick={() => { setClassFilter(y); setError(""); }} aria-pressed={classFilter === y} style={chip(classFilter === y, isMobile)}>{y} · Archive</button>
              ))}
            </div>

            {error && (
              <div style={{ background: "#fff3f2", border: "1px solid #f1c4bf", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, fontWeight: 700, color: "#b42318", fontFamily: BODY_FONT }}>
                {error}
              </div>
            )}

            <SectionTitle isMobile={isMobile}>{classFilter} {isArchive ? "Archive" : "Mock Drafts"}</SectionTitle>

            {filteredMocks.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: "40px 24px", textAlign: "center", fontSize: 14, color: MUTED, fontFamily: BODY_FONT }}>
                You haven&apos;t written a {classFilter} mock draft yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredMocks.map((mock) => {
                  const date = mock.updatedAt?.seconds
                    ? new Date(mock.updatedAt.seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : null;
                  const picks = Object.values(mock.picks || {});
                  const made = picks.filter((p) => p.selection).length;
                  const isPublic = mock.visibility === "public";
                  return (
                    <div key={mock.id} className="wd-mock-card" style={{
                      display: "flex", alignItems: "center", flexWrap: isMobile ? "wrap" : "nowrap", gap: isMobile ? 10 : 16,
                      background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: isMobile ? "12px 14px" : "16px 20px",
                      borderLeft: `5px solid ${isPublic ? BLUE : "#c3ccd8"}`,
                    }}>
                      <div style={{ flex: "1 1 220px", minWidth: 0, cursor: "pointer" }} onClick={() => navigate(`/mocks/${mock.id}/view`)}>
                        <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 900, color: INK, textTransform: "uppercase", lineHeight: 1.15, overflowWrap: "anywhere" }}>
                          {mock.name || "Untitled Mock Draft"}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, fontFamily: BODY_FONT, marginTop: 4 }}>
                          {isPublic ? "Public" : "Private"} · {made} pick{made !== 1 ? "s" : ""} · {mock.rounds || 1} round{(mock.rounds || 1) !== 1 ? "s" : ""}
                          {date && ` · Saved ${date}`}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => navigate(`/mocks/${mock.id}/view`)} style={button("outline", isMobile)}>View</button>
                        <button onClick={() => navigate(`/mocks/${mock.id}`)} style={button("blue", isMobile)}>Edit</button>
                        <button onClick={() => handleDelete(mock.id)} style={button("danger", isMobile)}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        <div style={{ marginTop: 16 }}><PhoneAd isMobile={isMobile} /></div>
      </MockPageShell>
    </>
  );
}
