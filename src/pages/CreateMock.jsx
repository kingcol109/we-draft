import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  Timestamp,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { getAuth } from "firebase/auth";
import { useParams } from "react-router-dom";
import { useRef } from "react";

/* ===================== CONSTANTS ===================== */

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

const gradeScale = {
  "Early First Round": 1,
  "Middle First Round": 2,
  "Late First Round": 3,
  "Second Round": 4,
  "Third Round": 5,
  "Fourth Round": 6,
  "Fifth Round": 7,
  "Sixth Round": 8,
  "Seventh Round": 9,
  UDFA: 10,
};

const gradeLabels = {
  1: "Early First Round",
  2: "Middle First Round",
  3: "Late First Round",
  4: "Second Round",
  5: "Third Round",
  6: "Fourth Round",
  7: "Fifth Round",
  8: "Sixth Round",
  9: "Seventh Round",
  10: "UDFA",
};

const gradeRankDesc = (label) => {
  const n = gradeScale[label];
  return n ? 11 - n : null;
};

export default function CreateMock() {
    const { mockId } = useParams();
  const isEditMode = Boolean(mockId);

  const navigate = useNavigate();
const auth = getAuth();
const [userId, setUserId] = useState(null);

useEffect(() => {
  const unsub = auth.onAuthStateChanged((user) => {
    const uid = user?.uid || null;
    setUserId(uid);

    // ✅ NEW MOCK = CURRENT USER IS OWNER
    if (!mockId && uid) {
      setMockOwnerId(uid);
    }
  });
  return unsub;
}, [mockId]);

useEffect(() => {
  if (!userId) return;

  const loadUserGrades = async () => {
    const snap = await getDocs(
      collection(db, "users", userId, "evaluations")
    );

    const map = {};

    snap.forEach((docSnap) => {
      const data = docSnap.data();

      // ✅ THIS is the key fix
      if (data.playerId && data.grade) {
        map[data.playerId] = data.grade;
      }
    });

    setUserGrades(map);
  };

  loadUserGrades();
}, [userId]);
const filterRef = useRef(null);


  /* ===================== STATE ===================== */

  const [mockName, setMockName] = useState("New Mock Draft");
  const [rounds, setRounds] = useState(1);
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
// idle | saving | saved
const assignedPlayerIds = useMemo(() => {
  return new Set(
    Object.values(assignedPlayers).map((p) => p.id)
  );
}, [assignedPlayers]);
const [userGrades, setUserGrades] = useState({});
useEffect(() => {
  const handleClickOutside = (e) => {
    if (filterRef.current && !filterRef.current.contains(e.target)) {
      setPositionOpen(false);
      setGradeOpen(false);
    }
  };

  document.addEventListener("mousedown", handleClickOutside);
  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, []);
const [roundsOpen, setRoundsOpen] = useState(false);
const [visibility, setVisibility] = useState("public"); // private | public
const [visibilityOpen, setVisibilityOpen] = useState(false);
const isOwner = userId && mockOwnerId === userId;
const [ownerLabel, setOwnerLabel] = useState("");
useEffect(() => {
  if (!mockOwnerId) return;

  const loadOwner = async () => {
    try {
      const snap = await getDoc(doc(db, "users", mockOwnerId));

      if (snap.exists()) {
        const data = snap.data();
        setOwnerLabel(
          data.username || data.email || mockOwnerId
        );
      } else {
        setOwnerLabel(mockOwnerId);
      }
    } catch (err) {
      console.error("Failed to load mock owner", err);
      setOwnerLabel(mockOwnerId);
    }
  };

  loadOwner();
}, [mockOwnerId]);

  /* ===================== LOAD DRAFT + TEAMS ===================== */

  useEffect(() => {
    const loadDraft = async () => {
      const draftSnap = await getDocs(collection(db, "draftOrder"));
      const loaded = draftSnap.docs
        .map((d) => d.data())
        .sort((a, b) => a.Pick - b.Pick)
        .map((d) => ({
          pickNumber: d.Pick,
          round: d.Round,
          originalTeam: d.Team,
          currentTeam: d.Team,
          tradedFrom: null,
        }));

      const teamSnap = await getDocs(collection(db, "nfl"));
      const teamMap = {};
      teamSnap.forEach((t) => (teamMap[t.id] = t.data()));

      setPicks(loaded);
      setTeams(teamMap);
      setLoading(false);
    };

    loadDraft();
  }, []);
useEffect(() => {
  if (!mockId) return;

  const loadExistingMock = async () => {
    const snap = await getDoc(doc(db, "mockDrafts", mockId));
    if (!snap.exists()) return;

    const data = snap.data();
setMockOwnerId(data.ownerId);

    // name + rounds
    setMockName(data.name || "Untitled Mock Draft");
    setRounds(data.rounds || 1);
setVisibility(data.visibility || "private");

    // picks
    const picksArray = Object.values(data.picks || {}).sort(
      (a, b) => a.pickNumber - b.pickNumber
    );

    setPicks(picksArray);

    // assigned players
    const assigned = {};
    picksArray.forEach((p) => {
      if (p.selection) {
        assigned[p.pickNumber] = p.selection;
      }
    });

    setAssignedPlayers(assigned);
  };

  loadExistingMock();
}, [mockId]);

  /* ===================== LOAD PLAYER BANK ===================== */

  useEffect(() => {
    const loadPlayers = async () => {
      if (!userId) return;
      setBankLoading(true);

      const qPlayers = query(
        collection(db, "players"),
        where("Eligible", "==", "2026")
      );
      const snap = await getDocs(qPlayers);

      const data = await Promise.all(
        snap.docs.map(async (docSnap) => {
          const p = { id: docSnap.id, ...docSnap.data() };

          let community = [];

          const evalSnap = await getDocs(
            collection(db, "players", docSnap.id, "evaluations")
          );

          evalSnap.forEach((e) => {
            const g = e.data().grade;
            if (g && gradeScale[g]) community.push(gradeScale[g]);
           
          });

          p.CommunityGrade =
            community.length > 0
              ? gradeLabels[
                  Math.round(
                    community.reduce((a, b) => a + b, 0) / community.length
                  )
                ]
              : "-";

          const ug = userGrades[p.id];
p.UserGrade = ug && gradeScale[ug] ? ug : "-";


          return p;
        })
      );

      setPlayers(data);
      setBankLoading(false);
    };

    loadPlayers();
  }, [userId, userGrades]);

  /* ===================== DRAG & DROP ===================== */

 const handleDragStart = (e, player) => {
  if (!isOwner) return;
  e.dataTransfer.setData("player", JSON.stringify(player));
};


const handleDropOnPick = (pickNumber, e) => {
  if (!isOwner) return;
  e.preventDefault();
  const player = JSON.parse(e.dataTransfer.getData("player"));

  setAssignedPlayers((prev) => ({
    ...prev,
    [pickNumber]: player,
  }));
};


const handleRemovePlayer = (pickNumber) => {
  setAssignedPlayers((prev) => {
    const copy = { ...prev };
    delete copy[pickNumber];
    return copy;
  });
};


  const handleTeamChange = (pickIndex, newTeam) => {
    setPicks((prev) =>
      prev.map((p, i) =>
        i === pickIndex
          ? {
              ...p,
              currentTeam: newTeam,
              tradedFrom: p.originalTeam !== newTeam ? p.originalTeam : null,
            }
          : p
      )
    );
    setActivePick(null);
  };

  /* ===================== MEMOS ===================== */

  const visiblePicks = useMemo(
    () => picks.filter((p) => p.round <= rounds),
    [picks, rounds]
  );

  const picksByRound = useMemo(() => {
    return visiblePicks.reduce((acc, p, i) => {
      if (!acc[p.round]) acc[p.round] = [];
      acc[p.round].push({ ...p, index: i });
      return acc;
    }, {});
  }, [visiblePicks]);

  const allPositions = useMemo(() => {
    const set = new Set(players.map((p) => p.Position).filter(Boolean));
    return Array.from(set).sort();
  }, [players]);

  const filteredPlayers = useMemo(() => {
  return players.filter((p) => {
    // 🚫 already drafted
    if (assignedPlayerIds.has(p.id)) return false;

    if (
      selectedPositions.length > 0 &&
      !selectedPositions.includes(p.Position)
    )
      return false;

    if (
      searchQuery &&
      !`${p.First} ${p.Last}`.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;

    return true;
  });
}, [players, selectedPositions, searchQuery, assignedPlayerIds]);


  const sortedPlayers = useMemo(() => {
    const arr = [...filteredPlayers];
    const nameKey = (p) =>
      `${(p.Last || "").toLowerCase()}|${(p.First || "").toLowerCase()}`;

    arr.sort((a, b) => {
      const ar =
        gradeView === "COMM"
          ? gradeRankDesc(a.CommunityGrade)
          : gradeRankDesc(a.UserGrade);
      const br =
        gradeView === "COMM"
          ? gradeRankDesc(b.CommunityGrade)
          : gradeRankDesc(b.UserGrade);

      if (ar && br) return br - ar;
      if (ar) return -1;
      if (br) return 1;
      return nameKey(a).localeCompare(nameKey(b));
    });

    return arr;
  }, [filteredPlayers, gradeView]);

  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;

  /* ===================== SAVE ===================== */

const handleSaveMock = async () => {
  if (!userId) return;

  setSaveStatus("saving");

  const obj = {};
  visiblePicks.forEach((p) => {
    obj[p.pickNumber] = {
      ...p,
      selection: assignedPlayers[p.pickNumber] || null,
    };
  });

  if (isEditMode) {
    // UPDATE EXISTING MOCK
    await updateDoc(doc(db, "mockDrafts", mockId), {
  name: mockName,
  rounds,
  visibility, // 👈 ADD
  picks: obj,
  updatedAt: Timestamp.now(),
});

  } else {
    // CREATE NEW MOCK
const ref = await addDoc(collection(db, "mockDrafts"), {
  name: mockName,
  ownerId: userId,
  rounds,
  visibility,
  picks: obj,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});

// ✅ MARK OWNER IMMEDIATELY
setMockOwnerId(userId);

navigate(`/mocks/${ref.id}`, { replace: true });

  }

  setSaveStatus("saved");

  setTimeout(() => {
    setSaveStatus("idle");
  }, 2000);
};



  /* ===================== RENDER ===================== */

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
      <div style={{ marginBottom: 18 }}>
  <div
    style={{
      fontSize: 13,
      fontWeight: 800,
      color: SITE_BLUE,
      marginBottom: 6,
      letterSpacing: "0.5px",
      textTransform: "uppercase",
    }}
  >
    Mock Draft Name
  </div>

  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
    }}
  >
{isOwner ? (
  <input
    value={mockName}
    onChange={(e) => setMockName(e.target.value)}
    placeholder="Enter mock draft name…"
    style={{
      flex: 1,
      fontSize: 26,
      fontWeight: 900,
      padding: "10px 18px",
      borderRadius: 999,
      border: `4px solid ${SITE_GOLD}`,
      outline: "none",
      color: SITE_BLUE,
      background: "#fff",
    }}
  />
) : (
  <div
    style={{
      flex: 1,
      fontSize: 26,
      fontWeight: 900,
      padding: "10px 18px",
      color: SITE_BLUE,
    }}
  >
    {mockName}
  </div>
)}


    <button
      onClick={() => navigate("/mocks/my")}
      style={{
        background: "#ffffff",
        color: SITE_BLUE,
        border: `3px solid ${SITE_GOLD}`,
        borderRadius: 999,
        padding: "10px 20px",
        fontWeight: 800,
        cursor: "pointer",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      My Mocks
    </button>
  </div>

<div
  style={{
    fontSize: 13,
    marginTop: 6,
    color: "#555",
    fontWeight: 700,
  }}
>
Created by <span style={{ color: SITE_BLUE }}>{ownerLabel}</span>

</div>

{isOwner && (
  <div
    style={{
      fontSize: 12,
      marginTop: 4,
      color: "#777",
      fontWeight: 600,
    }}
  >
    Click the name above to rename your mock draft
  </div>
)}

</div>



{/* CONTROLS ROW */}
{isOwner && (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      marginBottom: 18,
    }}
  >
    {/* ROUNDS */}
    <div style={{ position: "relative" }}>
      <button
        onClick={() => {
          setRoundsOpen((o) => !o);
          setVisibilityOpen(false);
        }}
        style={{
          background: "#ffffff",
          color: SITE_BLUE,
          border: `3px solid ${SITE_GOLD}`,
          borderRadius: 999,
          padding: "10px 22px",
          fontWeight: 900,
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        Rounds: {rounds} ▾
      </button>

      {roundsOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            background: "#fff",
            border: `3px solid ${SITE_GOLD}`,
            borderRadius: 12,
            padding: 8,
            zIndex: 50,
            minWidth: 140,
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <div
              key={n}
              onClick={() => {
                setRounds(n);
                setRoundsOpen(false);
              }}
              style={{
                padding: "6px 10px",
                fontWeight: n === rounds ? 900 : 700,
                cursor: "pointer",
                color: SITE_BLUE,
              }}
            >
              {n} Round{n > 1 ? "s" : ""}
            </div>
          ))}
        </div>
      )}
    </div>

    {/* VISIBILITY */}
    <div style={{ position: "relative" }}>
      <button
        onClick={() => {
          setVisibilityOpen((o) => !o);
          setRoundsOpen(false);
        }}
        style={{
          background: visibility === "public" ? SITE_BLUE : "#ffffff",
          color: visibility === "public" ? "#fff" : SITE_BLUE,
          border: `3px solid ${SITE_GOLD}`,
          borderRadius: 999,
          padding: "10px 22px",
          fontWeight: 900,
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        {visibility === "public" ? "Public" : "Private"} ▾
      </button>

      {visibilityOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            background: "#fff",
            border: `3px solid ${SITE_GOLD}`,
            borderRadius: 12,
            padding: 8,
            zIndex: 50,
            minWidth: 140,
          }}
        >
          {["public", "private"].map((v) => (
            <div
              key={v}
              onClick={() => {
                setVisibility(v);
                setVisibilityOpen(false);
              }}
              style={{
                padding: "6px 10px",
                fontWeight: v === visibility ? 900 : 700,
                cursor: "pointer",
                color: SITE_BLUE,
                textTransform: "capitalize",
              }}
            >
              {v}
            </div>
          ))}
        </div>
      )}
    </div>

    {/* SAVE */}
    <button
      onClick={handleSaveMock}
      disabled={saveStatus === "saving"}
      style={{
        background: saveStatus === "saved" ? "#2ecc71" : SITE_BLUE,
        color: "#fff",
        border: `4px solid ${SITE_GOLD}`,
        borderRadius: 999,
        padding: "10px 26px",
        fontWeight: 900,
        cursor: saveStatus === "saving" ? "default" : "pointer",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}
    >
      {saveStatus === "saving"
        ? "Saving…"
        : saveStatus === "saved"
        ? "Saved ✓"
        : "Save Mock"}
    </button>
  </div>
)}




     <div
  style={{
    display: "grid",
    gridTemplateColumns: isOwner ? "1fr 1fr" : "1fr",
    justifyContent: "center",
    gap: 20,
  }}
>

        {/* MOCK BOARD */}
        <div
  style={{
    maxHeight: "75vh",
    overflowY: "auto",
    margin: isOwner ? "0" : "0 auto",
    maxWidth: isOwner ? "100%" : 720,
  }}
>

          {Object.keys(picksByRound).map((round) => (
            <div key={round}>
              <h3>ROUND {round}</h3>
              {picksByRound[round].map((pick) => {
                const team = teams[pick.currentTeam];
                const player = assignedPlayers[pick.pickNumber];

                return (
                  <div
                    key={pick.pickNumber}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropOnPick(pick.pickNumber, e)}
                    style={{ marginBottom: 8 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 20 }}>{pick.pickNumber}</span>

                      <img
                        src={team?.Logo1}
                        alt={team?.Team}
                        style={{ width: 26, height: 26 }}
                      />

                      <div
  onClick={() => {
    if (!isOwner) return;
    setActivePick(
      activePick === pick.index ? null : pick.index
    );
  }}
  style={{
    flex: 1,
    background: team?.Color1,
    color: "#fff",

    // 🔥 BIGGER IN VIEW MODE
    padding: isOwner ? "8px 14px" : "26px 34px",
    borderRadius: 999,
    fontWeight: isOwner ? 700 : 900,
    cursor: isOwner ? "pointer" : "default",

    display: "flex",
    flexDirection: "column",
    gap: isOwner ? 4 : 10,
  }}
>
  {/* TEAM + PLAYER LINE */}
  <div
    style={{
      display: "flex",
      gap: 8,
      alignItems: "center",
      fontSize: isOwner ? 14 : 24,
      fontWeight: 900,
      lineHeight: 1.2,
    }}
  >
    <Link
  to={`/nfl/${pick.currentTeam}`}
  target="_blank"
  rel="noopener noreferrer"
  style={{
    color: "#fff",
    textDecoration: "none",
    fontWeight: 900,
  }}
>
  {team?.City} {team?.Team}
</Link>


    {player && (
      <>
        <span style={{ opacity: 0.6 }}>—</span>
        <Link
          to={`/player/${player.Slug}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "#fff",
            textDecoration: "none",
            fontWeight: 900,
          }}
        >
          {player.First} {player.Last}
        </Link>
      </>
    )}
  </div>

  {/* POSITION / SCHOOL */}
  {player && (
    <div
      style={{
        fontSize: isOwner ? 12 : 16,
        opacity: 0.95,
        fontWeight: 700,
      }}
    >
      {player.Position} — {player.School}
    </div>
  )}
</div>


                    {isOwner && player && (
  <button
    onClick={() => handleRemovePlayer(pick.pickNumber)}
    style={{
      background: "rgba(0,0,0,0.2)",
      border: "none",
      color: "#fff",
      fontWeight: 900,
      borderRadius: "50%",
      width: 22,
      height: 22,
      cursor: "pointer",
    }}
  >
    ✕
  </button>
)}

                    </div>

                    {pick.tradedFrom && (
                      <div style={{ fontSize: 12, marginLeft: 56 }}>
                        {pick.tradedFrom} → {pick.currentTeam}
                      </div>
                    )}

                    {isOwner && activePick === pick.index && (
  <select

                        value={pick.currentTeam}
                        onChange={(e) =>
                          handleTeamChange(pick.index, e.target.value)
                        }
                        style={{ marginLeft: 56 }}
                      >
                        {Object.keys(teams).map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

         {/* PLAYER BANK — OWNER ONLY */}
        {isOwner && (
          <div
            style={{
              background: SITE_BLUE,
              border: `4px solid ${SITE_GOLD}`,
              borderRadius: 12,
              padding: 12,
              color: "#fff",
              maxHeight: "75vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h3>Player Bank (2026)</h3>

            {/* Sticky Filters */}
            <div
              style={{
                position: "sticky",
                top: 0,
                background: SITE_BLUE,
                zIndex: 10,
                paddingBottom: 12,
              }}
            >
              {/* FILTER PILLS */}
              <div
                ref={filterRef}
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 16,
                  marginBottom: 10,
                }}
              >
                {/* POSITION */}
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setPositionOpen((o) => !o)}
                    style={{
                      background: SITE_BLUE,
                      color: "#fff",
                      border: `3px solid ${SITE_GOLD}`,
                      borderRadius: 999,
                      padding: "8px 22px",
                      fontWeight: 800,
                    }}
                  >
                    POSITION
                  </button>

                  {positionOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: 44,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "#fff",
                        border: `3px solid ${SITE_GOLD}`,
                        borderRadius: 12,
                        padding: 10,
                        zIndex: 20,
                        color: "#000",
                      }}
                    >
                      {allPositions.map((pos) => (
                        <label
                          key={pos}
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            marginBottom: 6,
                            fontWeight: 600,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPositions.includes(pos)}
                            onChange={() =>
                              setSelectedPositions((prev) =>
                                prev.includes(pos)
                                  ? prev.filter((p) => p !== pos)
                                  : [...prev, pos]
                              )
                            }
                          />
                          {pos}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* GRADES */}
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setGradeOpen((o) => !o)}
                    style={{
                      background: SITE_BLUE,
                      color: "#fff",
                      border: `3px solid ${SITE_GOLD}`,
                      borderRadius: 999,
                      padding: "8px 22px",
                      fontWeight: 800,
                    }}
                  >
                    GRADES
                  </button>

                  {gradeOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: 44,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "#fff",
                        border: `3px solid ${SITE_GOLD}`,
                        borderRadius: 12,
                        padding: 10,
                        zIndex: 20,
                        color: "#000",
                      }}
                    >
                      <div
                        style={{
                          fontWeight:
                            gradeView === "COMM" ? 800 : 600,
                          cursor: "pointer",
                          marginBottom: 6,
                        }}
                        onClick={() => {
                          setGradeView("COMM");
                          setGradeOpen(false);
                        }}
                      >
                        Community Grades
                      </div>
                      <div
                        style={{
                          fontWeight:
                            gradeView === "USER" ? 800 : 600,
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          setGradeView("USER");
                          setGradeOpen(false);
                        }}
                      >
                        My Grades
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* SEARCH */}
              <input
                placeholder="Search player..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: `3px solid ${SITE_GOLD}`,
                  fontWeight: 700,
                  color: "#000",
                }}
              />
            </div>

            {/* PLAYER LIST */}
            <div style={{ overflowY: "auto", flex: 1, marginTop: 10 }}>
              {bankLoading ? (
                <div>Loading…</div>
              ) : (
                sortedPlayers.map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, p)}
                    style={{
                      padding: 8,
                      marginBottom: 6,
                      borderRadius: 10,
                      background: "#0b67c2",
                      cursor: "grab",
                    }}
                  >
                    <Link
                      to={`/player/${p.Slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#fff",
                        fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      ⠿ {p.First} {p.Last}
                    </Link>

                    <div
                      style={{
                        fontSize: 12,
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 2,
                        opacity: 0.95,
                      }}
                    >
                      <span>
                        {p.Position} — {p.School}
                      </span>
                      <span style={{ fontWeight: 700 }}>
                        {gradeView === "COMM"
                          ? p.CommunityGrade
                          : p.UserGrade}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
