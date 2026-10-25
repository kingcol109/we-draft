// src/pages/CreateMock.jsx
//
// /mocks/create and /mocks/:mockId — the mock draft editor: pick a class,
// fill each pick from the player bank (drag, or tap a player to fill the
// next open pick), trade picks, and write it up — an intro plus an optional
// note on each pick, which ViewMock.js shows as the column. Both start
// hidden behind "+ Add intro" / "+ Add note" (open on their own once they
// have text), so a plain mock is just the board. Only the owner
// edits; anyone else (and the owner of a locked 2026 mock) is sent to the
// read-only /view page.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link, Navigate } from "react-router-dom";
import {
  collection, addDoc, getDocs, getDoc, updateDoc, deleteDoc,
  doc, Timestamp, query, where,
} from "firebase/firestore";
import { db } from "../firebase";
import { averageGradesFor, gradeLabel } from "../utils/communityGrades";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "../components/LoadingSpinner";
import ShareMockButton from "../components/ShareMockButton";
import GradeChip from "../components/GradeChip";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { fetchNflBranding } from "../utils/draftProfileData";
import { picksFromOrder, followsOrder, withEffectiveOrder, orderFromLegacyPicks, ORDER_YEAR } from "../utils/draftOrder";
import { textOn } from "../utils/teamColors";
import {
  BLUE, GOLD, INK, MUTED, CARD_SHADOW, BODY_FONT, FONT, INTRO_MAX, NOTE_MAX,
  useIsMobile, MockPageShell, MockHero, heroText, chip, button,
} from "../components/MockDraftKit";

const MOCK_LOCK_DATE = new Date("2026-04-24T19:55:00-04:00");

const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
};
const gradeRankDesc = (label) => { const n = gradeScale[label]; return n ? 11 - n : null; };

// A class's whole draft order as the editor's picks. Upcoming drafts live
// in one draftOrders/{year} doc now (all seven rounds — see
// utils/draftOrder.js); the old per-pick collection is the fallback for a
// year not saved in that format yet. A later draft follows the upcoming
// draft's order with its own trades.
async function orderPicks(draftClass) {
  const orderCollectionMap = { "2027": "draftOrder2027", "2028": "draftOrder2028", "2026": "draftOrder" };
  const orderCollection = orderCollectionMap[draftClass] || "draftOrder";
  let rawPicks = null;
  if (draftClass !== "2026") {
    const read = async (y) => { const s = await getDoc(doc(db, "draftOrders", y)); return s.exists() ? s.data() : null; };
    let own = await read(draftClass);
    const base = followsOrder(draftClass) ? await read(ORDER_YEAR) : own;
    if (base?.order?.length) {
      // A later draft not saved in the new format yet keeps its old trades.
      if (!own && followsOrder(draftClass)) own = { trades: orderFromLegacyPicks((await getDocs(collection(db, orderCollection))).docs.map((d) => d.data())).trades };
      rawPicks = picksFromOrder(withEffectiveOrder(draftClass, own, base));
    }
  }
  if (!rawPicks) rawPicks = (await getDocs(collection(db, orderCollection))).docs.map((d) => d.data());
  return rawPicks
    .sort((a, b) => a.Pick - b.Pick)
    .map((d) => ({
      pickNumber: d.Pick,
      round: d.Round,
      originalTeam: d.Team,
      currentTeam: d.Traded ? d.Traded : d.Team,
      tradedFrom: d.Traded ? d.Team : null,
    }));
}

// The class snapshots read for college logos.
const LOGO_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K", "P"];

// Each position's pill color, so the board and the bank read at a glance.
const POSITION_COLORS = {
  QB: "#c8102e", RB: "#2e7d32", WR: "#0055a5", TE: "#6a1b9a", OL: "#795548", DL: "#37474f",
  EDGE: "#e65100", LB: "#00838f", DB: "#283593", K: "#607d8b", P: "#607d8b", LS: "#607d8b",
};
function PositionPill({ pos }) {
  if (!pos) return null;
  return (
    <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, letterSpacing: "0.06em", color: "#fff", background: POSITION_COLORS[pos] || "#5f6b7a", borderRadius: 4, padding: "2px 5px", lineHeight: 1.2 }}>{pos}</span>
  );
}
// A college logo, or a blank the same size so names line up.
function SchoolLogo({ src, size }) {
  return src
    ? <img src={src} alt="" loading="lazy" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
    : <span style={{ width: size, height: size, flexShrink: 0 }} />;
}

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

const panel = { background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, overflow: "hidden", display: "flex", flexDirection: "column" };
const panelHead = { background: BLUE, padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 };
const panelTitle = { color: GOLD, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em" };
const field = { width: "100%", boxSizing: "border-box", border: "2px solid #d8dee8", borderRadius: 10, outline: "none", color: INK, background: "#fff" };

// "+ Add intro" / "+ Add note": a quiet text link.
const addTextBtn = { border: "none", background: "none", padding: 0, color: BLUE, fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: BODY_FONT };

export default function CreateMock() {
  const { mockId } = useParams();
  const isEditMode = Boolean(mockId);
  const navigate = useNavigate();
  const { user, authReady, login } = useAuth();
  const userId = user?.uid || null;
  const isMobile = useIsMobile();
  const filterRef = useRef(null);

  const [mockName, setMockName] = useState("New Mock Draft");
  const [intro, setIntro] = useState("");
  const [rounds, setRounds] = useState(7);
  const [mockOwnerId, setMockOwnerId] = useState(null);
  const [picks, setPicks] = useState([]);
  const [teams, setTeams] = useState({});
  const [activePick, setActivePick] = useState(null);
  const [players, setPlayers] = useState([]);
  const [assignedPlayers, setAssignedPlayers] = useState({});
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [mockLoaded, setMockLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [bankLoading, setBankLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [gradeView, setGradeView] = useState("COMM");
  const [positionOpen, setPositionOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [userGrades, setUserGrades] = useState({});
  const [visibility, setVisibility] = useState("public");
  const [ownerLabel, setOwnerLabel] = useState("");
  const [activeEditRound, setActiveEditRound] = useState(1);
  const [showBank, setShowBank] = useState(true);
  const [draftClass, setDraftClass] = useState(null);
  const [pendingClass, setPendingClass] = useState(null);

  const assignedPlayerIds = useMemo(() => new Set(Object.values(assignedPlayers).map((p) => p.id)), [assignedPlayers]);
  const isOwner = userId && mockOwnerId === userId;

  useEffect(() => { if (!mockId && userId) setMockOwnerId(userId); }, [mockId, userId]);
  useEffect(() => { fetchNflBranding().then(setTeams).catch(() => {}); }, []);

  useEffect(() => {
    if (!userId) return;
    const loadUserGrades = async () => {
      const snap = await getDocs(collection(db, "users", userId, "evaluations"));
      const map = {};
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.playerId && data.grade) map[data.playerId] = data.grade;
      });
      setUserGrades(map);
    };
    loadUserGrades();
  }, [userId]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setPositionOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!mockOwnerId) return;
    const loadOwner = async () => {
      try {
        const snap = await getDoc(doc(db, "users", mockOwnerId));
        setOwnerLabel(snap.exists() ? (snap.data().username || snap.data().email || "") : "");
      } catch { setOwnerLabel(""); }
    };
    loadOwner();
  }, [mockOwnerId]);

  // A new mock's picks: the chosen class's draft order.
  useEffect(() => {
    if (mockId || !draftClass) return;
    orderPicks(draftClass).then((all) => {
      setPicks(all);
      // 2027 and 2028 default to 1 round; 2026 defaults to 7
      if (draftClass === "2027" || draftClass === "2028") setRounds(1);
      setOrderLoaded(true);
    });
  }, [mockId, draftClass]);

  // A saved mock keeps only the rounds it was saved with — the rest of its
  // class's order goes in behind them, so Rounds can go back up too.
  useEffect(() => {
    if (!mockId || !mockLoaded || !draftClass) return;
    let live = true;
    orderPicks(draftClass).then((all) => {
      if (!live) return;
      setPicks((prev) => {
        const have = new Set(prev.map((p) => p.pickNumber));
        const extra = all.filter((p) => !have.has(p.pickNumber));
        return extra.length ? [...prev, ...extra].sort((a, b) => a.pickNumber - b.pickNumber) : prev;
      });
    }).catch(() => {});
    return () => { live = false; };
  }, [mockId, mockLoaded, draftClass]);

  useEffect(() => {
    if (!mockId) return;
    const loadExistingMock = async () => {
      try {
        const snap = await getDoc(doc(db, "mockDrafts", mockId));
        if (!snap.exists()) { setNotFound(true); return; }
        const data = snap.data();
        setMockOwnerId(data.ownerId);
        setMockName(data.name || "Untitled Mock Draft");
        setIntro(data.description || "");
        setRounds(data.rounds || 1);
        setVisibility(data.visibility || "private");
        setDraftClass(data.draftClass || "2026");
        const picksArray = Object.values(data.picks || {}).sort((a, b) => a.pickNumber - b.pickNumber);
        setPicks(picksArray);
        const assigned = {};
        picksArray.forEach((p) => { if (p.selection) assigned[p.pickNumber] = p.selection; });
        setAssignedPlayers(assigned);
      } catch (err) {
        // A private mock that isn't ours fails the read rule.
        console.error("Mock load error:", err);
        setNotFound(true);
      } finally { setMockLoaded(true); }
    };
    loadExistingMock();
  }, [mockId]);

  useEffect(() => {
    const loadPlayers = async () => {
      if (!userId || !draftClass) return;
      setBankLoading(true);
      const snap = await getDocs(query(collection(db, "players"), where("Eligible", "==", draftClass)));
      const liveDocs = snap.docs.filter((d) => {
        const live = d.data().Live;
        return live !== false && live !== 0 && live !== "false" && live !== "no" && live !== null;
      });
      // Community grades: one snapshot read for the whole class
      // (utils/communityGrades.js), not one evaluations query per player.
      const avgs = await averageGradesFor(liveDocs.map((d) => d.id));
      const data = liveDocs.map((docSnap) => {
        const p = { id: docSnap.id, ...docSnap.data() };
        p.CommunityGrade = gradeLabel(avgs[p.id]) || "-";
        const ug = userGrades[p.id];
        p.UserGrade = ug && gradeScale[ug] ? ug : "-";
        return p;
      });
      setPlayers(data); setBankLoading(false);
    };
    loadPlayers();
  }, [userId, userGrades, draftClass]);

  // College logos by player id, from the class snapshots (compSnapshots/
  // class_{year}_{Position} — each row's `lg`): a few cached reads, not a
  // schools query per name.
  const [schoolLogos, setSchoolLogos] = useState({});
  useEffect(() => {
    if (!draftClass) return undefined;
    let live = true;
    Promise.all(LOGO_POSITIONS.map((pos) => getSiteSnapshot(`class_${draftClass}_${pos}`).catch(() => null))).then((docs) => {
      if (!live) return;
      const map = {};
      docs.forEach((d) => {
        (d?.rows || []).forEach((r) => { if (r.lg) map[r.i] = r.lg; });
        Object.entries(d?.hidden || {}).forEach(([id, h]) => { if (h.lg) map[id] = h.lg; });
      });
      setSchoolLogos(map);
    });
    return () => { live = false; };
  }, [draftClass]);

  const visiblePicks = useMemo(() => picks.filter((p) => p.round <= rounds), [picks, rounds]);
  // Offense, defense, then specialists (POSITION_COLORS' order); anything else after, A–Z.
  const allPositions = useMemo(() => {
    const order = Object.keys(POSITION_COLORS);
    const rank = (pos) => (order.includes(pos) ? order.indexOf(pos) : order.length);
    return Array.from(new Set(players.map((p) => p.Position).filter(Boolean))).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [players]);
  const filteredPlayers = useMemo(() => players.filter((p) => {
    if (assignedPlayerIds.has(p.id)) return false;
    if (selectedPositions.length > 0 && !selectedPositions.includes(p.Position)) return false;
    if (searchQuery && !`${p.First} ${p.Last}`.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }), [players, selectedPositions, searchQuery, assignedPlayerIds]);
  const sortedPlayers = useMemo(() => {
    const arr = [...filteredPlayers];
    arr.sort((a, b) => {
      const ar = gradeView === "COMM" ? gradeRankDesc(a.CommunityGrade) : gradeRankDesc(a.UserGrade);
      const br = gradeView === "COMM" ? gradeRankDesc(b.CommunityGrade) : gradeRankDesc(b.UserGrade);
      if (ar && br) return br - ar; if (ar) return -1; if (br) return 1;
      return `${a.Last}|${a.First}`.localeCompare(`${b.Last}|${b.First}`);
    });
    return arr;
  }, [filteredPlayers, gradeView]);

  const assign = (pickNumber, player) => setAssignedPlayers((prev) => ({ ...prev, [pickNumber]: player }));
  const handleDragStart = (e, player) => { if (!isOwner) return; e.dataTransfer.setData("player", JSON.stringify(player)); };
  const handleDropOnPick = (pickNumber, e) => { if (!isOwner) return; e.preventDefault(); const raw = e.dataTransfer.getData("player"); if (raw) assign(pickNumber, JSON.parse(raw)); };
  const handleRemovePlayer = (pickNumber) => { setAssignedPlayers((prev) => { const copy = { ...prev }; delete copy[pickNumber]; return copy; }); };
  const handleTeamChange = (pickNumber, newTeam) => { setPicks((prev) => prev.map((p) => p.pickNumber === pickNumber ? { ...p, currentTeam: newTeam, tradedFrom: p.originalTeam !== newTeam ? p.originalTeam : null } : p)); setActivePick(null); };
  // Text boxes opened with "+ Add…" — the intro, and picks by number.
  const [introOpen, setIntroOpen] = useState(false);
  const [openNotes, setOpenNotes] = useState({});
  const handleNoteChange = (pickNumber, note) => setPicks((prev) => prev.map((p) => (p.pickNumber === pickNumber ? { ...p, note } : p)));

  const handleSaveMock = async () => {
    if (!userId) return;
    setSaveStatus("saving");
    const obj = {};
    visiblePicks.forEach((p) => { obj[p.pickNumber] = { ...p, note: (p.note || "").trim(), selection: assignedPlayers[p.pickNumber] || null }; });
    const fields = { name: mockName, description: intro.trim(), rounds, visibility, draftClass, picks: obj, updatedAt: Timestamp.now() };
    try {
      if (isEditMode) {
        await updateDoc(doc(db, "mockDrafts", mockId), fields);
      } else {
        const ref = await addDoc(collection(db, "mockDrafts"), { ...fields, ownerId: userId, createdAt: Timestamp.now() });
        setMockOwnerId(userId);
        navigate(`/mocks/${ref.id}`, { replace: true });
      }
      setSaveStatus("saved");
    } catch (err) {
      console.error("Mock save error:", err);
      setSaveStatus("error");
    }
    setTimeout(() => setSaveStatus("idle"), 2500);
  };

  // Delete the whole mock (owner only — the rules say the same), back to My Mocks.
  const [deleting, setDeleting] = useState(false);
  const handleDeleteMock = async () => {
    if (!isEditMode || !isOwner) return;
    if (!window.confirm(`Delete "${mockName || "this mock draft"}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "mockDrafts", mockId));
      navigate("/mocks/my", { replace: true });
    } catch (err) {
      console.error("Mock delete error:", err);
      setDeleting(false);
      alert("Couldn't delete the mock. Please try again.");
    }
  };

  // ── Draft class picker ──
  if (!mockId && !draftClass) {
    const isLocked = new Date() >= MOCK_LOCK_DATE;
    const availableClasses = [
      ...(isLocked ? [] : [{ year: "2026", sub: "7 rounds · Live draft order" }]),
      { year: "2027", sub: "Projected order · up to 7 rounds" },
      { year: "2028", sub: "Projected order · up to 7 rounds" },
    ];
    const handleClassSelect = (year) => { if (!userId) setPendingClass(year); else setDraftClass(year); };

    return (
      <MockPageShell width={900} isMobile={isMobile}>
        <MockHero eyebrow="Mock Drafts" title="Write a Mock Draft" isMobile={isMobile}
          actions={<button onClick={() => navigate("/mocks")} style={button("ghost", isMobile)}>Cancel</button>}>
          <p style={heroText(isMobile)}>
            Pick a draft class, fill the board, then make your case — an intro and a note on any pick you want to explain.
          </p>
        </MockHero>

        {pendingClass && !userId ? (
          <div style={{ ...panel, maxWidth: 440, margin: "0 auto", padding: "28px 26px", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: BLUE, textTransform: "uppercase", marginBottom: 8 }}>{pendingClass} Mock Draft</div>
            <div style={{ fontSize: 14, color: MUTED, fontFamily: BODY_FONT, lineHeight: 1.6, marginBottom: 20 }}>
              Sign in to save your {pendingClass} mock draft, trade picks, and publish it to the We-Draft community.
            </div>
            <button onClick={login} style={{ ...button("blue", isMobile), width: "100%", justifyContent: "center", padding: "13px 20px", fontSize: 15 }}>Sign In to Write →</button>
            <div style={{ fontSize: 11, color: "#98a2b3", fontWeight: 700, margin: "10px 0 14px", fontFamily: BODY_FONT }}>Free · Google or Email · No spam</div>
            <button onClick={() => setPendingClass(null)} style={{ background: "none", border: "none", color: MUTED, fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline", fontFamily: BODY_FONT }}>← Back</button>
          </div>
        ) : (
          <>
            <h2 style={{ margin: "0 0 12px 2px", fontSize: isMobile ? 16 : 20, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Which draft?</h2>
            <style>{`.wd-class-card { transition: transform 0.16s ease, box-shadow 0.16s ease; } .wd-class-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.14) !important; }`}</style>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${availableClasses.length}, 1fr)`, gap: 12 }}>
              {availableClasses.map(({ year, sub }) => (
                <button key={year} className="wd-class-card" onClick={() => handleClassSelect(year)}
                  style={{ ...panel, border: "none", cursor: "pointer", textAlign: "left", padding: 0, fontFamily: FONT }}>
                  <span style={{ display: "block", background: `linear-gradient(120deg, #00305c 0%, ${BLUE} 100%)`, padding: "16px 18px", borderBottom: `4px solid ${GOLD}` }}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 900, color: GOLD, letterSpacing: "0.14em" }}>NFL DRAFT</span>
                    <span style={{ display: "block", fontSize: 38, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{year}</span>
                  </span>
                  <span style={{ display: "block", padding: "12px 18px", fontSize: 13, fontWeight: 700, color: MUTED, fontFamily: BODY_FONT }}>{sub}</span>
                </button>
              ))}
            </div>
            {isLocked && (
              <div style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: MUTED, fontFamily: BODY_FONT }}>
                2026 mocks are closed now that the draft is done — they stay readable in the archive.
              </div>
            )}
          </>
        )}
      </MockPageShell>
    );
  }

  if (notFound) return <Navigate to={`/mocks/${mockId}/view`} replace />;
  if (!authReady || (mockId ? !mockLoaded : !orderLoaded)) return <LoadingSpinner label="Loading" size={56} minHeight="calc(60vh / var(--pz, 1))" />;

  // Only the owner edits, and 2026 mocks are frozen since the draft began.
  const mock2026Locked = draftClass === "2026" && new Date() >= MOCK_LOCK_DATE;
  if (mockId && (!isOwner || mock2026Locked)) return <Navigate to={`/mocks/${mockId}/view`} replace />;

  /* ===================== EDITOR ===================== */
  const filledPicks = visiblePicks.filter((p) => assignedPlayers[p.pickNumber]).length;
  const totalVisiblePicks = visiblePicks.length;
  const availableRoundsEdit = [...new Set(visiblePicks.map((p) => p.round))].sort((a, b) => a - b);
  const roundPicksEdit = visiblePicks.filter((p) => p.round === activeEditRound);
  const nextOpen = roundPicksEdit.find((p) => !assignedPlayers[p.pickNumber]);
  // ShareMockButton takes an already-normalized picks shape — here that
  // means pulling each pick's player out of the separate assignedPlayers map.
  const sharePicksEdit = roundPicksEdit.map((p) => ({ pickNumber: p.pickNumber, currentTeam: p.currentTeam, tradedFrom: p.tradedFrom, player: assignedPlayers[p.pickNumber] || null }));
  const saveLabel = { saving: "Saving…", saved: "✓ Saved", error: "Save failed" }[saveStatus] || "Save Mock";

  return (
    <MockPageShell width={1200} rails={false} isMobile={isMobile}>
      <style>{".wd-mock-title::placeholder { color: rgba(255,255,255,0.5); }"}</style>
      {/* ── Header: a blue band (class, title, progress), then the toolbar ── */}
      <div style={{ ...panel, marginBottom: 14, boxShadow: "0 10px 28px rgba(0,40,90,0.16), 0 0 0 1px #e6ebf2" }}>
        <div style={{ position: "relative", padding: isMobile ? "16px 14px 18px" : "22px 26px 24px", background: `linear-gradient(120deg, #00305c 0%, ${BLUE} 60%, #1d6fc0 100%)`, overflow: "hidden" }}>
          {!isMobile && (
            <div aria-hidden="true" style={{ position: "absolute", right: 18, top: "50%", transform: "translateY(-50%)", fontSize: 130, fontWeight: 900, color: "rgba(255,255,255,0.06)", lineHeight: 1, pointerEvents: "none" }}>{draftClass}</div>
          )}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", color: "#1a1005", background: GOLD, borderRadius: 999, padding: "4px 11px" }}>{draftClass} MOCK DRAFT</span>
            {ownerLabel && <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.8)", fontFamily: BODY_FONT }}>By <strong style={{ color: "#fff" }}>{ownerLabel}</strong></span>}
            <button onClick={() => navigate("/mocks/my")} style={{ ...button("ghost", true), marginLeft: "auto" }}>My Mocks</button>
          </div>

          <input value={mockName} onChange={(e) => setMockName(e.target.value)} placeholder="Mock draft title…" aria-label="Mock draft title" className="wd-mock-title"
            style={{
              position: "relative", width: "100%", boxSizing: "border-box", margin: "12px 0 0", padding: "4px 0 6px", border: "none", borderBottom: "2px solid rgba(255,255,255,0.25)",
              background: "transparent", color: "#fff", outline: "none", fontSize: isMobile ? 22 : 34, fontWeight: 900, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.01em",
            }} />

          {/* Picks made, as a bar. */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <div style={{ flex: 1, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${totalVisiblePicks ? (filledPicks / totalVisiblePicks) * 100 : 0}%`, background: filledPicks === totalVisiblePicks && totalVisiblePicks > 0 ? "#4ade80" : GOLD, borderRadius: 999, transition: "width .3s ease" }} />
            </div>
            <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 900, color: "#fff", fontFamily: BODY_FONT }}>{filledPicks}/{totalVisiblePicks} <span style={{ fontWeight: 700, opacity: 0.75 }}>picks made</span></span>
          </div>
        </div>
        <div style={{ height: 4, background: GOLD }} />

        <div style={{ padding: isMobile ? "12px 14px" : "14px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        {introOpen || intro ? (
          <div>
            <textarea value={intro} onChange={(e) => setIntro(e.target.value.slice(0, INTRO_MAX))} rows={isMobile ? 4 : 3} aria-label="Intro" autoFocus={introOpen && !intro}
              placeholder="Intro (optional) — set the scene: what's driving this board, the big trades, the picks you'd defend to the end…"
              style={{ ...field, padding: "10px 14px", fontSize: 15, lineHeight: 1.55, fontFamily: "Georgia, 'Times New Roman', serif", resize: "vertical", background: "#fbfcfe" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#98a2b3", fontFamily: BODY_FONT }}>
              {!intro ? <button onClick={() => setIntroOpen(false)} style={addTextBtn}>Hide intro</button> : <span />}
              <span>{intro.length}/{INTRO_MAX}</span>
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {!(introOpen || intro) && <button onClick={() => setIntroOpen(true)} style={{ ...addTextBtn, fontSize: 13, marginRight: 6 }}>+ Add intro</button>}
          <div role="group" aria-label="Visibility" style={{ display: "inline-flex", gap: 4, padding: 3, background: "#f1f4f8", borderRadius: 999 }}>
            {["public", "private"].map((v) => (
              <button key={v} onClick={() => setVisibility(v)} aria-pressed={visibility === v}
                style={{ ...chip(visibility === v, true), border: "none", textTransform: "uppercase", background: visibility === v ? BLUE : "transparent" }}>
                {v === "public" ? "Public" : "Private"}
              </button>
            ))}
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Rounds
            <select value={rounds} onChange={(e) => {
              const n = Number(e.target.value);
              // Saving keeps only the visible rounds, so dropping filled ones loses them.
              const lost = picks.filter((p) => p.round > n && (assignedPlayers[p.pickNumber] || p.note?.trim())).length;
              if (lost && !window.confirm(`Rounds ${n + 1}+ have ${lost} pick${lost !== 1 ? "s" : ""} filled in — they'll be dropped when you save. Continue?`)) return;
              setRounds(n);
              if (activeEditRound > n) setActiveEditRound(1);
            }}
              style={{ ...field, width: "auto", padding: "5px 8px", fontSize: 13, fontWeight: 900, color: BLUE, fontFamily: FONT }}>
              {[...new Set(picks.map((p) => p.round))].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          {isEditMode && (
            <ShareMockButton
              variant="light"
              mockName={mockName}
              ownerLabel={ownerLabel}
              roundLabel={`Round ${activeEditRound}`}
              totalRounds={rounds}
              visibility={visibility}
              picks={sharePicksEdit}
              teams={teams}
              filenamePrefix={`WeDraft_${(mockName || "MockDraft").replace(/\s+/g, "")}_Rd${activeEditRound}`}
              draftClass={draftClass}
              mockUrl={`https://we-draft.com/mocks/${mockId}/view`}
            />
          )}
          {isEditMode && <button onClick={() => navigate(`/mocks/${mockId}/view`)} style={button("outline", isMobile)}>Preview</button>}
          {isEditMode && isOwner && <button onClick={handleDeleteMock} disabled={deleting} style={button("danger", isMobile)}>{deleting ? "Deleting…" : "Delete"}</button>}
          <button onClick={() => { if (window.confirm("Clear all picks? This cannot be undone.")) setAssignedPlayers({}); }} style={button("danger", isMobile)}>Clear</button>
          <button onClick={handleSaveMock} disabled={saveStatus === "saving"}
            style={{ ...button("blue", isMobile), background: saveStatus === "saved" ? "#2e7d32" : saveStatus === "error" ? "#b42318" : BLUE, borderColor: "transparent", cursor: saveStatus === "saving" ? "default" : "pointer" }}>
            {saveLabel}
          </button>
        </div>
        </div>
      </div>

      {/* ── Round tabs, each with how full it is ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {availableRoundsEdit.map((r) => {
          const filled = visiblePicks.filter((p) => p.round === r && assignedPlayers[p.pickNumber]).length;
          const total = visiblePicks.filter((p) => p.round === r).length;
          const on = activeEditRound === r;
          return (
            <button key={r} onClick={() => setActiveEditRound(r)} aria-pressed={on} style={{
              display: "flex", flexDirection: "column", gap: 5, minWidth: isMobile ? 64 : 104, padding: isMobile ? "7px 10px" : "8px 14px", borderRadius: 10, cursor: "pointer",
              border: `2px solid ${on ? BLUE : "#d8dee8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : "#3a4352", fontFamily: FONT, textAlign: "left",
              boxShadow: on ? "0 4px 12px rgba(0,85,165,0.25)" : "none",
            }}>
              <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 900, letterSpacing: "0.04em" }}>
                {isMobile ? `R${r}` : `Round ${r}`} <span style={{ opacity: 0.65, fontSize: 10 }}>{filled}/{total}</span>
              </span>
              <span style={{ display: "block", height: 4, borderRadius: 999, background: on ? "rgba(255,255,255,0.25)" : "#edf0f5", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${total ? (filled / total) * 100 : 0}%`, background: filled === total && total ? "#2e9e5b" : GOLD }} />
              </span>
            </button>
          );
        })}
        {isMobile && (
          <button onClick={() => setShowBank((o) => !o)} style={{ ...button(showBank ? "blue" : "outline", true), marginLeft: "auto" }}>
            {showBank ? "Hide Bank" : "Player Bank"}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.15fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>

        {/* ── MOCK BOARD ── */}
        <div style={panel}>
          <div style={panelHead}>
            <span style={panelTitle}>Round {activeEditRound}</span>
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 700, fontFamily: BODY_FONT }}>
              {isMobile ? "Tap a team to trade" : "Drag players in · click a team to trade"}
            </span>
          </div>
          <div style={{ height: 3, background: GOLD, flexShrink: 0 }} />

          <div style={{ overflowY: "auto", maxHeight: isMobile ? "calc(60vh / var(--pz, 1))" : "calc(75vh / var(--pz, 1))" }}>
            {roundPicksEdit.map((pick, i) => {
              const team = teams[pick.currentTeam] || {};
              const player = assignedPlayers[pick.pickNumber];
              const c1 = team.Color1 || BLUE;
              const c2 = team.Color2 || GOLD;
              const isNext = nextOpen?.pickNumber === pick.pickNumber;
              // Filled: the team's color down the left and a faint wash of
              // it; on the clock: gold; open: a dashed slot to drop into.
              return (
                <div key={pick.pickNumber}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropOnPick(pick.pickNumber, e)}
                  style={{
                    borderBottom: i === roundPicksEdit.length - 1 ? "none" : "1px solid #edf0f5", padding: "10px 12px 10px 14px",
                    borderLeft: `5px solid ${player ? c1 : isNext ? GOLD : "transparent"}`,
                    background: player ? `linear-gradient(90deg, ${c1}14 0%, #fff 55%)` : isNext ? "linear-gradient(90deg, #fff4df 0%, #fff 60%)" : "#fff",
                  }}>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 9, background: `linear-gradient(160deg, ${c1} 0%, ${c1} 70%, ${c2} 100%)`, color: textOn(c1, c2), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>
                      <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1 }}>{pick.pickNumber}</div>
                      <div style={{ fontSize: 6, fontWeight: 900, opacity: 0.8, letterSpacing: "0.1em" }}>PICK</div>
                    </div>

                    <button onClick={() => setActivePick(activePick === pick.pickNumber ? null : pick.pickNumber)} title="Trade this pick"
                      style={{ flexShrink: 0, width: 42, height: 42, padding: 2, border: activePick === pick.pickNumber ? `2px solid ${GOLD}` : "2px solid transparent", borderRadius: 8, background: "transparent", cursor: "pointer" }}>
                      {team.Logo1
                        ? <img src={sanitizeUrl(team.Logo1)} alt={team.Team || pick.currentTeam} style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        : <span style={{ fontSize: 10, fontWeight: 900, color: c1 }}>{pick.currentTeam}</span>}
                    </button>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: "#7a8597", letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {team.City} {team.Team || pick.currentTeam}
                        {pick.tradedFrom && <span style={{ marginLeft: 6, color: "#8a5a00" }}>· via {pick.tradedFrom}</span>}
                      </div>
                      {player ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, minWidth: 0 }}>
                          <div style={{ minWidth: 0 }}>
                            <Link to={`/player/${player.Slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 15, fontWeight: 900, color: INK, textDecoration: "none", textTransform: "uppercase", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {player.First} {player.Last}
                            </Link>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                              <PositionPill pos={player.Position} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{player.School}</span>
                            </div>
                          </div>
                        </div>
                      ) : isNext ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: "#1a1005", background: GOLD, borderRadius: 999, padding: "3px 9px" }}>ON THE CLOCK</span>
                          <span style={{ fontSize: 12, color: "#8a6a2a", fontWeight: 700, fontFamily: BODY_FONT }}>{isMobile ? "Tap a player in the bank" : "Drag or click a player"}</span>
                        </div>
                      ) : (
                        <div style={{ marginTop: 3, border: "2px dashed #dfe5ee", borderRadius: 8, padding: "5px 10px", fontSize: 12, color: "#a3adbb", fontWeight: 700, fontFamily: BODY_FONT }}>
                          Open — drop a player here
                        </div>
                      )}
                    </div>

                    {player && (
                      <button onClick={() => handleRemovePlayer(pick.pickNumber)} aria-label="Remove player"
                        style={{ flexShrink: 0, background: "#f1f4f8", border: "none", color: MUTED, fontWeight: 900, borderRadius: "50%", width: 24, height: 24, cursor: "pointer", fontSize: 12 }}>✕</button>
                    )}
                  </div>

                  {activePick === pick.pickNumber && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 2px 48px" }}>
                      <span style={{ fontSize: 10, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.08em" }}>Trade to</span>
                      <select value={pick.currentTeam} onChange={(e) => handleTeamChange(pick.pickNumber, e.target.value)}
                        style={{ ...field, width: "auto", padding: "4px 8px", fontWeight: 700, fontSize: 13, fontFamily: BODY_FONT }}>
                        {Object.keys(teams).sort().map((t) => <option key={t} value={t}>{teams[t]?.City} {teams[t]?.Team}</option>)}
                      </select>
                    </div>
                  )}

                  {player && !pick.note && !openNotes[pick.pickNumber] && (
                    <div style={{ padding: "2px 0 0 48px" }}>
                      <button onClick={() => setOpenNotes((o) => ({ ...o, [pick.pickNumber]: true }))} style={addTextBtn}>+ Add note</button>
                    </div>
                  )}
                  {(pick.note || (player && openNotes[pick.pickNumber])) && (
                    <div style={{ padding: "6px 0 0 48px" }}>
                      <textarea value={pick.note || ""} onChange={(e) => handleNoteChange(pick.pickNumber, e.target.value.slice(0, NOTE_MAX))} autoFocus={!pick.note}
                        onBlur={() => { if (!pick.note?.trim()) setOpenNotes((o) => ({ ...o, [pick.pickNumber]: false })); }}
                        rows={pick.note ? 3 : 2} placeholder="Why this pick? (optional)" aria-label={`Note for pick ${pick.pickNumber}`}
                        style={{ ...field, border: "1px solid #e1e7ef", borderRadius: 8, padding: "6px 10px", fontSize: 13, lineHeight: 1.5, fontFamily: "Georgia, 'Times New Roman', serif", resize: "vertical", background: "#fbfcfe" }} />
                      {pick.note && <div style={{ textAlign: "right", fontSize: 10, color: "#98a2b3", fontFamily: BODY_FONT }}>{pick.note.length}/{NOTE_MAX}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── PLAYER BANK ── */}
        {(!isMobile || showBank) && (
          <div style={{ ...panel, maxHeight: isMobile ? "calc(60vh / var(--pz, 1))" : "calc(80vh / var(--pz, 1))", position: isMobile ? "static" : "sticky", top: 16 }}>
            <div style={panelHead}>
              <span style={panelTitle}>Player Bank — {draftClass}</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 700, fontFamily: BODY_FONT }}>{sortedPlayers.length} players</span>
            </div>
            <div style={{ height: 3, background: GOLD, flexShrink: 0 }} />

            <div ref={filterRef} style={{ padding: "10px 12px", borderBottom: "1px solid #edf0f5", flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <input placeholder="Search player…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                style={{ ...field, padding: "8px 12px", fontSize: 14, fontWeight: 700, fontFamily: BODY_FONT }} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ position: "relative" }}>
                  <button onClick={() => setPositionOpen((o) => !o)} style={chip(selectedPositions.length > 0, true)}>
                    Position {selectedPositions.length > 0 ? `(${selectedPositions.length})` : "▾"}
                  </button>
                  {positionOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.16), 0 0 0 1px #e6ebf2", padding: 10, zIndex: 20, minWidth: 110, display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                      {allPositions.map((pos) => (
                        <label key={pos} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 800, fontSize: 12, cursor: "pointer", color: INK }}>
                          <input type="checkbox" checked={selectedPositions.includes(pos)} onChange={() => setSelectedPositions((prev) => prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos])} />
                          {pos}
                        </label>
                      ))}
                      {selectedPositions.length > 0 && (
                        <button onClick={() => setSelectedPositions([])} style={{ gridColumn: "1 / -1", marginTop: 4, background: "none", border: "none", color: BLUE, fontWeight: 800, fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>Clear</button>
                      )}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 10, fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em", marginLeft: 4 }}>SORT</span>
                {[["COMM", "Board"], ["USER", "My Grades"]].map(([val, label]) => (
                  <button key={val} onClick={() => setGradeView(val)} aria-pressed={gradeView === val} style={chip(gradeView === val, true)}>{label}</button>
                ))}
              </div>
            </div>

            <div style={{ overflowY: "auto", flex: 1 }}>
              {bankLoading ? (
                <LoadingSpinner label="Loading players" size={28} minHeight="120px" />
              ) : sortedPlayers.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#98a2b3", fontStyle: "italic", fontSize: 13, fontFamily: BODY_FONT }}>No players match your filters</div>
              ) : sortedPlayers.map((p) => (
                <div key={p.id} draggable onDragStart={(e) => handleDragStart(e, p)}
                  onClick={() => { if (nextOpen) assign(nextOpen.pickNumber, p); }}
                  title={nextOpen ? `Click to take at pick ${nextOpen.pickNumber}` : undefined}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #edf0f5", background: "#fff", cursor: nextOpen ? "pointer" : "grab" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f9ff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
                  {!isMobile && <div style={{ color: "#c3ccd8", fontSize: 14, flexShrink: 0 }}>⠿</div>}
                  <SchoolLogo src={schoolLogos[p.id]} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link to={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                      style={{ color: INK, fontWeight: 900, textDecoration: "none", fontSize: 13, display: "block", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.First} {p.Last}
                    </Link>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, minWidth: 0 }}>
                      <PositionPill pos={p.Position} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.School}</span>
                    </div>
                  </div>
                  {/* The grade the bank's sorted by — the board's or their own — as the site's grade chip. */}
                  {gradeView === "COMM"
                    ? <GradeChip label={gradeScale[p.CommunityGrade] ? p.CommunityGrade : null} title={`We-Draft board: ${p.CommunityGrade}`} />
                    : <GradeChip label={gradeScale[p.UserGrade] ? p.UserGrade : null} title={`My grade: ${p.UserGrade}`} />}
                  {nextOpen && <span style={{ flexShrink: 0, fontSize: 16, fontWeight: 900, color: BLUE }} aria-hidden="true">+</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </MockPageShell>
  );
}
