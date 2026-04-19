import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  collection, addDoc, getDocs, getDoc, updateDoc,
  doc, Timestamp, query, where,
} from "firebase/firestore";
import { db } from "../firebase";
import { getAuth } from "firebase/auth";
import { useParams } from "react-router-dom";
import { useRef } from "react";
import Logo1 from "../assets/Logo1.png";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";
const MOCK_LOCK_DATE = new Date("2026-04-24T19:55:00-04:00"); // Thu Apr 24 7:55PM ET — just before draft starts

const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
};
const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round",
  4: "Second Round", 5: "Third Round", 6: "Fourth Round",
  7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
};
const gradeRankDesc = (label) => { const n = gradeScale[label]; return n ? 11 - n : null; };

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

function gradeDisplay(g) {
  const map = {
    "Watchlist":          { short: "W",   bg: "#5F5E5A", border: "#444441" },
    "Early First Round":  { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Late First Round":   { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Second Round":       { short: "2nd", bg: "#0F6E56", border: "#085041" },
    "Third Round":        { short: "3rd", bg: "#185FA5", border: "#0C447C" },
    "Fourth Round":       { short: "4th", bg: "#BA7517", border: "#854F0B" },
    "Fifth Round":        { short: "5th", bg: "#BA7517", border: "#854F0B" },
    "Sixth Round":        { short: "6th", bg: "#993C1D", border: "#712B13" },
    "Seventh Round":      { short: "7th", bg: "#993C1D", border: "#712B13" },
    "UDFA":               { short: "U",   bg: "#A32D2D", border: "#791F1F" },
  };
  return map[g] || null;
}

export default function CreateMock() {
  const { mockId } = useParams();
  const isEditMode = Boolean(mockId);
  const navigate = useNavigate();
  const auth = getAuth();
  const [userId, setUserId] = useState(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      const uid = user?.uid || null;
      setUserId(uid);
      if (!mockId && uid) setMockOwnerId(uid);
    });
    return unsub;
  }, [mockId]);

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

  const filterRef = useRef(null);

  const [mockName, setMockName] = useState("New Mock Draft");
  const [rounds, setRounds] = useState(7);
  const [mockOwnerId, setMockOwnerId] = useState(null);
  const [picks, setPicks] = useState([]);
  const [teams, setTeams] = useState({});
  const [activePick, setActivePick] = useState(null);
  const [players, setPlayers] = useState([]);
  const [assignedPlayers, setAssignedPlayers] = useState({});
  const [loading, setLoading] = useState(true);
  const [bankLoading, setBankLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [gradeView, setGradeView] = useState("COMM");
  const [positionOpen, setPositionOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [userGrades, setUserGrades] = useState({});
  const [roundsOpen, setRoundsOpen] = useState(false);
  const [visibility, setVisibility] = useState("public");
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [ownerLabel, setOwnerLabel] = useState("");
  const [activeRound, setActiveRound] = useState(1); // for view mode
  const [activeEditRound, setActiveEditRound] = useState(1); // for edit mode
  const [showBank, setShowBank] = useState(true); // for mobile bank toggle
  const [communityData, setCommunityData] = useState({});
  const [communityLoading, setCommunityLoading] = useState(false);
  const [draftClass, setDraftClass] = useState(null); // "2026" | "2027" — null = not yet chosen for new mocks

  const assignedPlayerIds = useMemo(() => new Set(Object.values(assignedPlayers).map((p) => p.id)), [assignedPlayers]);
  const isOwner = userId && mockOwnerId === userId;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setPositionOpen(false); setGradeOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!mockOwnerId) return;
    const loadOwner = async () => {
      try {
        const snap = await getDoc(doc(db, "users", mockOwnerId));
        if (snap.exists()) {
          const data = snap.data();
          setOwnerLabel(data.username || data.email || mockOwnerId);
        } else setOwnerLabel(mockOwnerId);
      } catch { setOwnerLabel(mockOwnerId); }
    };
    loadOwner();
  }, [mockOwnerId]);

  useEffect(() => {
    const loadDraft = async () => {
      // Always load NFL teams for logos/colors
      const teamSnap = await getDocs(collection(db, "nfl"));
      const teamMap = {};
      teamSnap.forEach((t) => (teamMap[t.id] = t.data()));
      setTeams(teamMap);

      // Only load draft order for NEW mocks, and only once class is chosen
      if (!mockId && draftClass) {
        const orderCollection = draftClass === "2027" ? "draftOrder2027" : "draftOrder";
        const draftSnap = await getDocs(collection(db, orderCollection));
        const loaded = draftSnap.docs.map((d) => d.data())
          .sort((a, b) => a.Pick - b.Pick)
          .map((d) => ({
            pickNumber: d.Pick,
            round: d.Round,
            originalTeam: d.Team,
            currentTeam: d.Traded ? d.Traded : d.Team,
            tradedFrom: d.Traded ? d.Team : null,
          }));
        setPicks(loaded);
        if (draftClass === "2027") setRounds(1); // 2027 is 1 round only
      }

      setLoading(false);
    };
    loadDraft();
  }, [mockId, draftClass]);

  useEffect(() => {
    if (!mockId) return;
    const loadExistingMock = async () => {
      const snap = await getDoc(doc(db, "mockDrafts", mockId));
      if (!snap.exists()) return;
      const data = snap.data();
      setMockOwnerId(data.ownerId);
      setMockName(data.name || "Untitled Mock Draft");
      setRounds(data.rounds || 1);
      setVisibility(data.visibility || "private");
      setDraftClass(data.draftClass || "2026"); // restore class, default to 2026
      const picksArray = Object.values(data.picks || {}).sort((a, b) => a.pickNumber - b.pickNumber);
      setPicks(picksArray);
      const assigned = {};
      picksArray.forEach((p) => { if (p.selection) assigned[p.pickNumber] = p.selection; });
      setAssignedPlayers(assigned);
      setLoading(false);
    };
    loadExistingMock();
  }, [mockId]);

  useEffect(() => {
    const loadPlayers = async () => {
      if (!userId || !draftClass) return;
      setBankLoading(true);
      const snap = await getDocs(query(collection(db, "players"), where("Eligible", "==", draftClass)));
      const data = await Promise.all(snap.docs.map(async (docSnap) => {
        const p = { id: docSnap.id, ...docSnap.data() };
        let community = [];
        const evalSnap = await getDocs(collection(db, "players", docSnap.id, "evaluations"));
        evalSnap.forEach((e) => { const g = e.data().grade; if (g && gradeScale[g]) community.push(gradeScale[g]); });
        p.CommunityGrade = community.length > 0 ? gradeLabels[Math.round(community.reduce((a, b) => a + b, 0) / community.length)] : "-";
        const ug = userGrades[p.id];
        p.UserGrade = ug && gradeScale[ug] ? ug : "-";
        return p;
      }));
      setPlayers(data); setBankLoading(false);
    };
    loadPlayers();
  }, [userId, userGrades, draftClass]);

  const handleDragStart = (e, player) => { if (!isOwner) return; e.dataTransfer.setData("player", JSON.stringify(player)); };
  const handleDropOnPick = (pickNumber, e) => { if (!isOwner) return; e.preventDefault(); const player = JSON.parse(e.dataTransfer.getData("player")); setAssignedPlayers((prev) => ({ ...prev, [pickNumber]: player })); };
  const handleRemovePlayer = (pickNumber) => { setAssignedPlayers((prev) => { const copy = { ...prev }; delete copy[pickNumber]; return copy; }); };
  const handleTeamChange = (pickNumber, newTeam) => { setPicks((prev) => prev.map((p) => p.pickNumber === pickNumber ? { ...p, currentTeam: newTeam, tradedFrom: p.originalTeam !== newTeam ? p.originalTeam : null } : p)); setActivePick(null); };

  const visiblePicks = useMemo(() => picks.filter((p) => p.round <= rounds), [picks, rounds]);
  const picksByRound = useMemo(() => visiblePicks.reduce((acc, p, i) => { if (!acc[p.round]) acc[p.round] = []; acc[p.round].push({ ...p, index: i }); return acc; }, {}), [visiblePicks]);
  const allPositions = useMemo(() => Array.from(new Set(players.map((p) => p.Position).filter(Boolean))).sort(), [players]);
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

  // Fetch community grades/S/W for view mode, only for the active round's picks
  useEffect(() => {
    if (isOwner || !mockId) return;
    setCommunityData({}); // reset cache on round change so fresh data loads
    const roundPicks = visiblePicks.filter((p) => p.round === activeRound);
    const playerIds = roundPicks
      .map((p) => assignedPlayers[p.pickNumber]?.id)
      .filter(Boolean);
    if (!playerIds.length) return;
    const fetchCommunity = async () => {
      setCommunityLoading(true);
      const results = await Promise.all(
        playerIds.map(async (playerId) => {
          try {
            const evalsSnap = await getDocs(collection(db, "players", playerId, "evaluations"));
            const grades = [], sCount = {}, wCount = {};
            evalsSnap.forEach((d) => {
              const ev = d.data();
              if (ev.grade && gradeScale[ev.grade]) grades.push(gradeScale[ev.grade]);
              if (Array.isArray(ev.strengths)) ev.strengths.forEach((s) => { sCount[s] = (sCount[s] || 0) + 1; });
              if (Array.isArray(ev.weaknesses)) ev.weaknesses.forEach((w) => { wCount[w] = (wCount[w] || 0) + 1; });
            });
            const avgGrade = grades.length > 0 ? gradeLabels[Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)] : null;
            const topStrengths = Object.entries(sCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
            const topWeaknesses = Object.entries(wCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
            return [playerId, { grade: avgGrade, strengths: topStrengths, weaknesses: topWeaknesses }];
          } catch { return [playerId, null]; }
        })
      );
      setCommunityData((prev) => ({ ...prev, ...Object.fromEntries(results.filter(([, v]) => v)) }));
      setCommunityLoading(false);
    };
    fetchCommunity();
  }, [activeRound, isOwner, mockId, assignedPlayers, visiblePicks]);

  const handleSaveMock = async () => {
    if (!userId) return;
    setSaveStatus("saving");
    const obj = {};
    visiblePicks.forEach((p) => { obj[p.pickNumber] = { ...p, selection: assignedPlayers[p.pickNumber] || null }; });
    if (isEditMode) {
      await updateDoc(doc(db, "mockDrafts", mockId), { name: mockName, rounds, visibility, draftClass, picks: obj, updatedAt: Timestamp.now() });
    } else {
      const ref = await addDoc(collection(db, "mockDrafts"), { name: mockName, ownerId: userId, rounds, visibility, draftClass, picks: obj, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      setMockOwnerId(userId);
      navigate(`/mocks/${ref.id}`, { replace: true });
    }
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  };

  // New mock — show class selector before anything loads
  if (!mockId && !draftClass) {
    const isLocked = new Date() >= MOCK_LOCK_DATE;
    const availableClasses = isLocked
      ? [{ year: "2027", label: "2027 NFL Draft", sub: "1 round · Projected order" }]
      : [
          { year: "2026", label: "2026 NFL Draft", sub: "7 rounds · Live draft order" },
          { year: "2027", label: "2027 NFL Draft", sub: "1 round · Projected order" },
        ];

    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: "0 20px", fontFamily: "'Arial Black', Arial, sans-serif", textAlign: "center" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: SITE_BLUE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>Create Mock Draft</div>
          <div style={{ height: "3px", background: SITE_BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: SITE_GOLD, borderRadius: "2px" }} />
        </div>
        {isLocked && (
          <div style={{ background: "#fff8e1", border: `2px solid ${SITE_GOLD}`, borderRadius: 8, padding: "10px 16px", marginBottom: "20px", fontSize: 13, fontWeight: 700, color: "#7a5c00" }}>
            🔒 2026 mock drafts are locked. Only 2027 mocks can be created now.
          </div>
        )}
        <div style={{ fontSize: 15, fontWeight: 700, color: "#555", marginBottom: "24px" }}>Which draft class?</div>
        <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
          {availableClasses.map(({ year, label, sub }) => (
            <div key={year} onClick={() => setDraftClass(year)}
              style={{ border: `3px solid ${SITE_GOLD}`, borderRadius: 12, padding: "24px 32px", cursor: "pointer", background: "#fff", minWidth: 180, transition: "all 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; e.currentTarget.style.borderColor = SITE_BLUE; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = SITE_GOLD; }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: SITE_BLUE, marginBottom: 6 }}>{year}</div>
              <div style={{ fontSize: 13, fontWeight: 900, color: SITE_BLUE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{sub}</div>
            </div>
          ))}
        </div>
        <button onClick={() => navigate("/mocks")} style={{ marginTop: 24, background: "none", border: "none", color: "#bbb", fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
          Cancel
        </button>
      </div>
    );
  }

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", fontSize: "18px", fontWeight: 900, color: SITE_BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
      Loading…
    </div>
  );

  /* ===================== VIEW MODE (non-owner) ===================== */
  // Also force view mode for 2026 mocks after lock date (even for owner)
  const mock2026Locked = draftClass === "2026" && new Date() >= MOCK_LOCK_DATE;
  if ((!isOwner && mockId) || mock2026Locked) {
    const picksArray = visiblePicks;
    const availableRounds = [...new Set(picksArray.map((p) => p.round))].sort((a, b) => a - b);
    const roundPicks = picksArray.filter((p) => p.round === activeRound);
    const totalPicks = Object.values(assignedPlayers).length;

    return (
      <>
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* Header */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: "26px", objectFit: "contain" }} />
            <div style={{ fontSize: "24px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", color: SITE_BLUE, flex: 1, minWidth: 0 }}>
              {mockName}
            </div>
            <button onClick={() => navigate("/mocks")} style={{ background: "#fff", color: SITE_BLUE, border: `2px solid ${SITE_BLUE}`, borderRadius: "8px", padding: "8px 18px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", cursor: "pointer", flexShrink: 0 }}>
              ← Hub
            </button>
          </div>
          <div style={{ height: "3px", background: SITE_BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: SITE_GOLD, borderRadius: "2px" }} />
        </div>

        {/* Lock banner for owner */}
        {mock2026Locked && isOwner && (
          <div style={{ background: "#fff8e1", border: `2px solid ${SITE_GOLD}`, borderRadius: 8, padding: "10px 16px", marginBottom: "16px", fontSize: 13, fontWeight: 700, color: "#7a5c00", display: "flex", alignItems: "center", gap: 8 }}>
            🔒 2026 mock drafts are locked for editing after the draft began.
          </div>
        )}

        {/* Meta */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
          {ownerLabel && (
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#666" }}>
              By <span style={{ color: SITE_BLUE, fontWeight: 900 }}>{ownerLabel}</span>
            </div>
          )}
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#bbb" }}>
            {rounds} Round{rounds !== 1 ? "s" : ""} · {totalPicks} picks made
          </div>
          {visibility === "public" && (
            <span style={{ background: "#e8f5e9", color: "#2e7d32", fontSize: "8px", fontWeight: 900, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Public</span>
          )}
        </div>

        {/* Round tabs */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
          {availableRounds.map((r) => (
            <button key={r} onClick={() => setActiveRound(r)} style={{
              padding: "8px 20px", fontWeight: 900, fontSize: "14px",
              textTransform: "uppercase", letterSpacing: "0.05em",
              border: `2px solid ${SITE_GOLD}`, borderRadius: "8px", cursor: "pointer",
              background: activeRound === r ? SITE_BLUE : "#fff",
              color: activeRound === r ? "#fff" : SITE_BLUE,
            }}>
              Rd {r}
            </button>
          ))}
        </div>

        {/* Picks */}
        <div style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ background: SITE_BLUE, padding: "8px 16px" }}>
            <div style={{ color: SITE_GOLD, fontWeight: 900, fontSize: "13px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Round {activeRound}</div>
          </div>
          <div style={{ height: "3px", background: SITE_GOLD }} />

          {roundPicks.map((pick, i) => {
            const team = teams[pick.currentTeam];
            const player = assignedPlayers[pick.pickNumber];
            const teamColor1 = team?.Color1 || SITE_BLUE;
            const teamColor2 = team?.Color2 || SITE_GOLD;
            const teamLogo = team?.Logo1 || null;
            const teamName = team ? `${team.City} ${team.Team}` : pick.currentTeam;
            const hasPick = !!player;

            return (
              <div key={pick.pickNumber} style={{
                display: "flex", alignItems: "center",
                padding: "14px 18px",
                borderBottom: i < roundPicks.length - 1 ? "1px solid #f0f0f0" : "none",
                background: "#fff", opacity: hasPick ? 1 : 0.4,
              }}>
                {/* LEFT HALF — pick info */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
                  {/* Pick badge */}
                  <div style={{
                    flexShrink: 0, width: "60px", height: "60px",
                    borderRadius: "8px", background: teamColor1, border: `2px solid ${teamColor2}`,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  }}>
                    <div style={{ fontSize: "24px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{pick.pickNumber}</div>
                    <div style={{ fontSize: "8px", fontWeight: 800, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pick</div>
                  </div>

                  {/* Team logo */}
                  <div style={{ flexShrink: 0, width: "52px", height: "52px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {teamLogo ? (
                      <img src={sanitizeUrl(teamLogo)} alt={teamName} style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: teamColor1, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "10px" }}>
                        {pick.currentTeam}
                      </div>
                    )}
                  </div>

                  {/* Player info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {hasPick ? (
                      <>
                        <Link to={`/player/${player.Slug}`} style={{ color: SITE_BLUE, fontWeight: 900, fontSize: "20px", textDecoration: "none", lineHeight: 1.2, display: "block" }}
                          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>
                          {player.First} {player.Last}
                        </Link>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#555", marginTop: "2px" }}>
                          {player.Position} · {player.School}
                        </div>
                      </>
                    ) : null}
                    <div style={{ fontSize: "12px", fontWeight: 800, color: teamColor1, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: hasPick ? "2px" : 0 }}>
                      <Link to={`/nfl/${pick.currentTeam.toLowerCase()}`} style={{ color: teamColor1, textDecoration: "none" }}
                        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>
                        {teamName}
                      </Link>
                      {pick.tradedFrom && (
                        <span style={{ color: "#bbb", fontWeight: 700, fontSize: "10px", marginLeft: "8px" }}>(via {pick.tradedFrom})</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* RIGHT HALF — comm grade + S/W */}
                {hasPick && (() => {
                  const cd = communityData[player.id];
                  const gd = cd?.grade ? gradeDisplay(cd.grade) : null;
                  return (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "16px", paddingLeft: "20px", borderLeft: "1px solid #f0f0f0" }}>

                      {/* Grade badge */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                        <div style={{ fontSize: "8px", fontWeight: 900, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em" }}>Comm</div>
                        {communityLoading && !cd ? (
                          <div style={{ width: "64px", height: "52px", borderRadius: "6px", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <div style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid #ddd", borderTopColor: SITE_BLUE, animation: "spin 0.8s linear infinite" }} />
                          </div>
                        ) : gd ? (
                          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`, borderRadius: "6px", width: "64px", height: "52px" }}>
                            <span style={{ fontSize: "22px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{gd.short}</span>
                            <span style={{ fontSize: "6px", fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "2px", textAlign: "center", lineHeight: 1.1 }}>{cd.grade}</span>
                          </div>
                        ) : (
                          <div style={{ width: "64px", height: "52px", borderRadius: "6px", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, color: "#ccc" }}>—</div>
                        )}
                      </div>

                      {/* Two rows: strengths + weaknesses */}
                      {cd && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                            {cd.strengths?.slice(0, 3).map((s, si) => (
                              <div key={`s${si}`} style={{ fontSize: "10px", fontWeight: 900, color: "#2e7d32", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                                <span style={{ fontSize: "8px" }}>▲</span>{s}
                              </div>
                            ))}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                            {cd.weaknesses?.slice(0, 3).map((w, wi) => (
                              <div key={`w${wi}`} style={{ fontSize: "10px", fontWeight: 900, color: "#c0392b", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                                <span style={{ fontSize: "8px" }}>▼</span>{w}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }


  /* ===================== EDIT MODE (owner) ===================== */
  const filledPicks = visiblePicks.filter((p) => assignedPlayers[p.pickNumber]).length;
  const totalVisiblePicks = visiblePicks.length;
  const availableRoundsEdit = [...new Set(visiblePicks.map((p) => p.round))].sort((a, b) => a - b);
  const roundPicksEdit = visiblePicks.filter((p) => p.round === activeEditRound);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "10px 10px 80px" : 20, fontFamily: "'Arial Black', Arial, sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
          <input value={mockName} onChange={(e) => setMockName(e.target.value)} placeholder="Mock draft name…"
            style={{ flex: 1, minWidth: "160px", fontSize: isMobile ? 16 : 20, fontWeight: 900, padding: "8px 14px", borderRadius: 8, border: `2px solid ${SITE_GOLD}`, outline: "none", color: SITE_BLUE, background: "#fff", fontFamily: "'Arial Black', Arial, sans-serif" }} />
          <button onClick={() => navigate("/mocks/my")} style={{ background: "#fff", color: SITE_BLUE, border: `2px solid ${SITE_BLUE}`, borderRadius: 8, padding: "8px 14px", fontWeight: 900, cursor: "pointer", textTransform: "uppercase", fontSize: 12, whiteSpace: "nowrap" }}>My Mocks</button>
        </div>
        <div style={{ height: "3px", background: SITE_BLUE, borderRadius: "2px", marginBottom: "3px" }} />
        <div style={{ height: "3px", background: SITE_GOLD, borderRadius: "2px", marginBottom: "8px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#666", fontWeight: 700 }}>By <span style={{ color: SITE_BLUE }}>{ownerLabel}</span></div>
          <div style={{ fontSize: 12, fontWeight: 900, color: filledPicks === totalVisiblePicks && totalVisiblePicks > 0 ? "#2e7d32" : SITE_BLUE }}>
            {filledPicks} / {totalVisiblePicks} picks made
          </div>
          {draftClass && (
            <div style={{ fontSize: 11, fontWeight: 900, background: SITE_BLUE, color: SITE_GOLD, padding: "2px 10px", borderRadius: 20, letterSpacing: "0.06em" }}>
              {draftClass} CLASS
            </div>
          )}
        </div>
      </div>

      {/* ── Controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <button onClick={() => { setVisibilityOpen((o) => !o); setRoundsOpen(false); }}
            style={{ background: visibility === "public" ? SITE_BLUE : "#fff", color: visibility === "public" ? "#fff" : SITE_BLUE, border: `2px solid ${SITE_GOLD}`, borderRadius: 8, padding: "7px 14px", fontWeight: 900, cursor: "pointer", textTransform: "uppercase", fontSize: 12 }}>
            {visibility === "public" ? "🌍 Public" : "🔒 Private"} ▾
          </button>
          {visibilityOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: "#fff", border: `2px solid ${SITE_GOLD}`, borderRadius: 8, padding: 6, zIndex: 50, minWidth: 130 }}>
              <div style={{ background: SITE_BLUE, padding: "5px 10px", borderRadius: "4px 4px 0 0", fontSize: 10, fontWeight: 900, color: SITE_GOLD, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Visibility</div>
              {["public", "private"].map((v) => (
                <div key={v} onClick={() => { setVisibility(v); setVisibilityOpen(false); }}
                  style={{ padding: "6px 10px", fontWeight: v === visibility ? 900 : 700, cursor: "pointer", color: SITE_BLUE, background: v === visibility ? "#f0f5ff" : "transparent", borderRadius: 4, fontSize: 12 }}>
                  {v === "public" ? "🌍 Public" : "🔒 Private"}
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={handleSaveMock} disabled={saveStatus === "saving"}
          style={{ background: saveStatus === "saved" ? "#2e7d32" : SITE_BLUE, color: "#fff", border: `2px solid ${SITE_GOLD}`, borderRadius: 8, padding: "7px 20px", fontWeight: 900, cursor: saveStatus === "saving" ? "default" : "pointer", textTransform: "uppercase", fontSize: 12 }}>
          {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved" : "Save Mock"}
        </button>

        <button onClick={() => { if (window.confirm("Clear all picks? This cannot be undone.")) setAssignedPlayers({}); }}
          style={{ background: "#fff", color: "#c0392b", border: "2px solid #e74c3c", borderRadius: 8, padding: "7px 14px", fontWeight: 900, cursor: "pointer", textTransform: "uppercase", fontSize: 12 }}>
          Clear All
        </button>

        {isMobile && (
          <button onClick={() => setShowBank((o) => !o)}
            style={{ background: showBank ? SITE_BLUE : "#fff", color: showBank ? "#fff" : SITE_BLUE, border: `2px solid ${SITE_BLUE}`, borderRadius: 8, padding: "7px 14px", fontWeight: 900, cursor: "pointer", textTransform: "uppercase", fontSize: 12, marginLeft: "auto" }}>
            {showBank ? "Hide Bank" : "Player Bank"}
          </button>
        )}
      </div>

      {/* ── Round tabs ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {availableRoundsEdit.map((r) => {
          const filled = visiblePicks.filter((p) => p.round === r && assignedPlayers[p.pickNumber]).length;
          const total = visiblePicks.filter((p) => p.round === r).length;
          return (
            <button key={r} onClick={() => setActiveEditRound(r)} style={{
              padding: isMobile ? "6px 12px" : "7px 16px", fontWeight: 900,
              fontSize: isMobile ? 12 : 13, textTransform: "uppercase", letterSpacing: "0.05em",
              border: `2px solid ${SITE_GOLD}`, borderRadius: 8, cursor: "pointer",
              background: activeEditRound === r ? SITE_BLUE : "#fff",
              color: activeEditRound === r ? "#fff" : SITE_BLUE,
            }}>
              Rd {r} <span style={{ opacity: 0.65, fontSize: 10 }}>({filled}/{total})</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>

        {/* ── MOCK BOARD ── */}
        <div style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ background: SITE_BLUE, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ color: SITE_GOLD, fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>Round {activeEditRound}</div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: 700 }}>
              {roundPicksEdit.filter((p) => assignedPlayers[p.pickNumber]).length}/{roundPicksEdit.length} picks
            </div>
          </div>
          <div style={{ height: "3px", background: SITE_GOLD, flexShrink: 0 }} />

          <div style={{ overflowY: "auto", maxHeight: isMobile ? "50vh" : "65vh" }}>
            {roundPicksEdit.map((pick, i) => {
              const team = teams[pick.currentTeam];
              const player = assignedPlayers[pick.pickNumber];
              const isLast = i === roundPicksEdit.length - 1;
              return (
                <div key={pick.pickNumber}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropOnPick(pick.pickNumber, e)}
                  style={{ borderBottom: isLast ? "none" : "1px solid #f0f0f0", background: player ? "#fff" : "#fafafa" }}>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
                    <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 6, background: team?.Color1 || SITE_BLUE, border: `2px solid ${team?.Color2 || SITE_GOLD}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                      <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1 }}>{pick.pickNumber}</div>
                      <div style={{ fontSize: 6, fontWeight: 800, opacity: 0.7, textTransform: "uppercase" }}>Pick</div>
                    </div>

                    <img src={sanitizeUrl(team?.Logo1)} alt={team?.Team} style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }} />

                    <div onClick={() => setActivePick(activePick === pick.pickNumber ? null : pick.pickNumber)}
                      style={{ flex: 1, background: team?.Color1 || SITE_BLUE, color: "#fff", padding: "7px 12px", borderRadius: 8, fontWeight: 700, cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, outline: activePick === pick.pickNumber ? `3px solid ${SITE_GOLD}` : "none", minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 900, lineHeight: 1.2, flexWrap: "wrap" }}>
                        <Link to={`/nfl/${pick.currentTeam}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#fff", textDecoration: "none", fontWeight: 900 }}>
                          {team?.City} {team?.Team}
                        </Link>
                        {player && (<><span style={{ opacity: 0.5 }}>—</span>
                          <Link to={`/player/${player.Slug}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#fff", textDecoration: "none", fontWeight: 900 }}>{player.First} {player.Last}</Link></>)}
                      </div>
                      {player && <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 700 }}>{player.Position} · {player.School}</div>}
                      {!player && <div style={{ fontSize: 10, opacity: 0.5, fontStyle: "italic" }}>{isMobile ? "Tap to trade" : "Drag a player here · Click to trade"}</div>}
                    </div>

                    {player && (
                      <button onClick={() => handleRemovePlayer(pick.pickNumber)}
                        style={{ flexShrink: 0, background: "rgba(0,0,0,0.15)", border: "none", color: "#fff", fontWeight: 900, borderRadius: "50%", width: 22, height: 22, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                    )}
                  </div>

                  {pick.tradedFrom && (
                    <div style={{ fontSize: 10, color: "#999", fontWeight: 700, paddingLeft: 88, paddingBottom: 4 }}>📤 Traded from {pick.tradedFrom}</div>
                  )}

                  {activePick === pick.pickNumber && (
                    <div style={{ padding: "6px 12px 10px 88px" }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: SITE_BLUE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Trade pick to:</div>
                      <select value={pick.currentTeam} onChange={(e) => handleTeamChange(pick.pickNumber, e.target.value)}
                        style={{ border: `2px solid ${SITE_GOLD}`, borderRadius: 6, padding: "4px 8px", fontWeight: 700, color: SITE_BLUE, fontSize: 13 }}>
                        {Object.keys(teams).sort().map((t) => <option key={t} value={t}>{teams[t]?.City} {teams[t]?.Team}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── PLAYER BANK ── */}
        {(!isMobile || showBank) && (
          <div style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: isMobile ? "60vh" : "75vh" }}>
            <div style={{ background: SITE_BLUE, padding: "8px 14px", flexShrink: 0 }}>
              <div style={{ color: SITE_GOLD, fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>Player Bank — {draftClass || "2026"}</div>
            </div>
            <div style={{ height: "3px", background: SITE_GOLD, flexShrink: 0 }} />

            <div ref={filterRef} style={{ background: "#fff", padding: "10px 12px", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ position: "relative" }}>
                  <button onClick={() => setPositionOpen((o) => !o)}
                    style={{ background: selectedPositions.length > 0 ? SITE_BLUE : "#fff", color: selectedPositions.length > 0 ? "#fff" : SITE_BLUE, border: `2px solid ${SITE_GOLD}`, borderRadius: 6, padding: "5px 10px", fontWeight: 900, cursor: "pointer", textTransform: "uppercase", fontSize: 11 }}>
                    Position {selectedPositions.length > 0 ? `(${selectedPositions.length})` : "▾"}
                  </button>
                  {positionOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: "#fff", border: `2px solid ${SITE_GOLD}`, borderRadius: 8, padding: 8, zIndex: 20, minWidth: 120 }}>
                      <div style={{ background: SITE_BLUE, margin: "-8px -8px 8px", padding: "5px 10px", borderRadius: "6px 6px 0 0", fontSize: 10, fontWeight: 900, color: SITE_GOLD, textTransform: "uppercase", letterSpacing: "0.08em" }}>Position</div>
                      {allPositions.map((pos) => (
                        <label key={pos} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, fontWeight: 700, fontSize: 12, cursor: "pointer", color: SITE_BLUE }}>
                          <input type="checkbox" checked={selectedPositions.includes(pos)} onChange={() => setSelectedPositions((prev) => prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos])} />
                          {pos}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ position: "relative" }}>
                  <button onClick={() => setGradeOpen((o) => !o)}
                    style={{ background: "#fff", color: SITE_BLUE, border: `2px solid ${SITE_GOLD}`, borderRadius: 6, padding: "5px 10px", fontWeight: 900, cursor: "pointer", textTransform: "uppercase", fontSize: 11 }}>
                    {gradeView === "COMM" ? "Comm" : "Mine"} ▾
                  </button>
                  {gradeOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, background: "#fff", border: `2px solid ${SITE_GOLD}`, borderRadius: 8, padding: 8, zIndex: 20, minWidth: 140 }}>
                      <div style={{ background: SITE_BLUE, margin: "-8px -8px 8px", padding: "5px 10px", borderRadius: "6px 6px 0 0", fontSize: 10, fontWeight: 900, color: SITE_GOLD, textTransform: "uppercase", letterSpacing: "0.08em" }}>Sort by</div>
                      {[["COMM", "Community Grades"], ["USER", "My Grades"]].map(([val, label]) => (
                        <div key={val} onClick={() => { setGradeView(val); setGradeOpen(false); }}
                          style={{ padding: "5px 8px", fontWeight: gradeView === val ? 900 : 700, cursor: "pointer", color: SITE_BLUE, background: gradeView === val ? "#f0f5ff" : "transparent", borderRadius: 4, fontSize: 12 }}>
                          {label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 11, fontWeight: 700, color: "#bbb", marginLeft: "auto", alignSelf: "center" }}>
                  {sortedPlayers.length} players
                </div>
              </div>

              <input placeholder="Search player…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: "100%", padding: "7px 12px", borderRadius: 6, border: `2px solid ${SITE_GOLD}`, fontWeight: 700, color: SITE_BLUE, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'Arial Black', Arial, sans-serif" }} />
            </div>

            <div style={{ overflowY: "auto", flex: 1, background: "#fafafa" }}>
              {bankLoading ? (
                <div style={{ padding: 24, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 13 }}>Loading players…</div>
              ) : sortedPlayers.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: 13 }}>No players match your filters</div>
              ) : sortedPlayers.map((p) => (
                <div key={p.id} draggable onDragStart={(e) => handleDragStart(e, p)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f0f0f0", background: "#fff", cursor: "grab" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
                  <div style={{ color: "#ccc", fontSize: 14, flexShrink: 0 }}>⠿</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link to={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                      style={{ color: SITE_BLUE, fontWeight: 900, textDecoration: "none", fontSize: 13, display: "block" }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>
                      {p.First} {p.Last}
                    </Link>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#777" }}>{p.Position} · {p.School}</div>
                  </div>
                  <div style={{ flexShrink: 0, fontSize: 10, fontWeight: 900, color: SITE_BLUE, textAlign: "right" }}>
                    {(gradeView === "COMM" ? p.CommunityGrade : p.UserGrade) || "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}