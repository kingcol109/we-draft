import { useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import { getAuth } from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  setDoc,
  updateDoc,
  increment,
} from "firebase/firestore";

export default function TeamPage() {
  const { teamId } = useParams();

  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);
  const [historical, setHistorical] = useState([]);
  const [loading, setLoading] = useState(true);
const [positionRanks, setPositionRanks] = useState(null);
const [teamArticles, setTeamArticles] = useState([]);
  // Current roster vs archive
  const [viewMode, setViewMode] = useState("current"); // 'current' | 'archive'
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Projection year selector (only affects current roster view)
  const [rosterYearMode, setRosterYearMode] = useState(2026); // 2026 static, 2027 interactive

  // 2027-only interactive state (wipes on refresh)
  const [declaredIds, setDeclaredIds] = useState(() => new Set()); // moved to LEAVES
  const [redshirtOverrideIds, setRedshirtOverrideIds] = useState(() => new Set()); // force RS "Yes" for projection + move down a class
const [hoveredPlayer, setHoveredPlayer] = useState(null);
const [hoveredIcon, setHoveredIcon] = useState(null);
const [userVotes, setUserVotes] = useState({});
useEffect(() => {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) return;

  const loadVotes = async () => {
    const rosterRef = doc(db, "rosters", teamId.toLowerCase());
    const rosterSnap = await getDoc(rosterRef);
    const rosterPlayers = rosterSnap.exists() ? rosterSnap.data().players || [] : [];

    const votesMap = {};
    await Promise.all(
      rosterPlayers.map(async (p, idx) => {
        const voteId = getVoteId({ ...p, _id: idx });
        try {
          const userVoteRef = doc(db, "votes", voteId, "users", user.uid);
          const snap = await getDoc(userVoteRef);
          if (snap.exists()) {
            votesMap[voteId] = snap.data().value;
          }
        } catch {}
      })
    );
    setUserVotes(votesMap);
  };

  loadVotes();
}, [teamId]);

const getVoteId = (p) => {
  const normalize = (str) =>
    (str || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-");

  return `${normalize(p.First)}-${normalize(p.Last)}-${normalize(p.School)}`;
};
const handleVote = async (p, value) => {
  const auth = getAuth();
  const user = auth.currentUser;

if (!user) {
    const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
    const auth2 = getAuth();
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth2, provider);
    } catch {
      return;
    }
  }

  const voteId = getVoteId(p);
  const oldValue = userVotes[voteId] || 0;
  const newValue = oldValue === value ? 0 : value;
  const delta = newValue - oldValue;

  const voteRef = doc(db, "votes", voteId);
  const userVoteRef = doc(db, "votes", voteId, "users", user.uid);

  await setDoc(voteRef, { voteScore: increment(delta) }, { merge: true });
  await setDoc(userVoteRef, { value: newValue });

  setUserVotes((prev) => ({ ...prev, [voteId]: newValue }));
};
const formatTeamId = (str) => {
  const lower = str.toLowerCase();

  // 🔥 HARD FIXES (problem schools)
  const map = {
    "army": "Army West Point",
    "nc-state": "NC State",
    "uconn": "UConn",
    "troy": "Troy",

    // already working but safe to include
    "lsu": "LSU",
    "smu": "SMU",
    "tcu": "TCU",
    "ucla": "UCLA",
    "ucf": "UCF",
  };

  if (map[lower]) return map[lower];

  // 🔥 abbreviations (LSU, BYU, etc.)
  if (/^[a-z]{2,5}$/i.test(str)) {
    return str.toUpperCase();
  }

  // 🔥 normal schools (florida-state → Florida State)
  return str
    .toLowerCase()
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

  const sanitizeImgur = (url) =>
    url?.includes("imgur.com")
      ? url.replace("imgur.com", "i.imgur.com") + ".png"
      : url;

  const primary = team?.Color1 || "#0055a5";
  const secondary = team?.Color2 || "#f6a21d";

  const YEARS = ["Senior", "Junior", "Sophomore", "Freshman"];
  const OFFENSE_POS = ["QB", "RB", "WR", "TE", "OL"];
  const DEFENSE_POS = ["EDGE", "DL", "LB", "DB"];
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "OL", "DE", "DT", "LB", "CB", "S"];
  /* ===============================
     FETCH TEAM + CURRENT ROSTER + ARCHIVE
  =============================== */
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);

const formattedId = formatTeamId(teamId);
let teamData = null;

// 🔹 FIRST TRY (your existing method)
const teamRef = doc(db, "schools", formattedId);
const teamSnap = await getDoc(teamRef);

if (teamSnap.exists()) {
  teamData = teamSnap.data();
} else {
  // 🔥 FALLBACK (handles Army, Miami, etc.)
  const schoolsRef = collection(db, "schools");
  const snapshot = await getDocs(schoolsRef);

  const normalize = (str) =>
    (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const target = normalize(teamId);

  snapshot.forEach((doc) => {
    const school = doc.data().School;
    const s = normalize(school);

let bestMatch = null;

// 🔥 PRIORITY MATCHING
snapshot.forEach((doc) => {
  const school = doc.data().School;
  const s = normalize(school);

  // 1. EXACT MATCH (best)
  if (s === target) {
    bestMatch = doc.data();
    return;
  }

  // 2. STARTS WITH (Texas vs Texas Tech)
  if (!bestMatch && s.startsWith(target)) {
    bestMatch = doc.data();
  }

  // 3. LAST RESORT (very loose)
  if (!bestMatch && s.includes(target)) {
    bestMatch = doc.data();
  }
});

teamData = bestMatch;
  });
}

if (!teamData) {
  console.log("❌ No matching school:", teamId);
  setLoading(false);
  return;
}

setTeam(teamData);

      // current roster (from rosters/{teamId})
      const rosterRef = doc(db, "rosters", teamId.toLowerCase());
      const rosterSnap = await getDoc(rosterRef);
      const rosterPlayers = rosterSnap.exists() ? rosterSnap.data().players || [] : [];

      // give stable local ids (index-based; fine since this is a tool)
      setPlayers(
        rosterPlayers.map((p, idx) => ({
          ...p,
          _id: idx,
        }))
      );

      // archive (historical collection)
      const colRef = collection(db, "historical");
      const q = query(colRef, where("School", "==", teamData.School));
      const snapshot = await getDocs(q);
      setHistorical(
        snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
// 🔥 FETCH POSITION RANKS
const rankRef = doc(db, "teamPositionRanks", teamId.toLowerCase());
const rankSnap = await getDoc(rankRef);

if (rankSnap.exists()) {
  setPositionRanks(rankSnap.data());
  // 🔥 FETCH TEAM ARTICLES
const articleQuery = query(
  collection(db, "articles"),
  where("status", "==", "published"),
  where("teamSlugs", "array-contains", teamId.toLowerCase())
);

const articleSnap = await getDocs(articleQuery);

setTeamArticles(
  articleSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }))
);
}
      setLoading(false);
    };

    fetchData();
  }, [teamId]);

  /* ===============================
     HELPERS
  =============================== */

  const hasSlug = (p) => Boolean((p.Slug ?? "").toString().trim());
  const rsStringIsYes = (v) => (v ?? "").toString().trim().toLowerCase() === "yes";

  // RS for display:
  // - In 2026 static: use RS column only
  // - In 2027 interactive: RS is true if RS column is yes OR user toggled shirt
  const isRedshirtDisplay = (p) => {
    if (rosterYearMode === 2026) return rsStringIsYes(p.RS);
    return rsStringIsYes(p.RS) || redshirtOverrideIds.has(p._id);
  };

  // Sort A -> Z by last name within each position+class cell
const sortRosterPlayers = (arr) => {
  const gradeRank = (g) => {
    if (!g) return 100;

    const grade = g.toString().toUpperCase().trim();

// numeric grades (5 first, 1 last)
if (/^[1-5]$/.test(grade)) return 6 - Number(grade);

    // letter grades
    if (grade === "A+") return 9;
    if (grade === "A") return 10;
    if (grade === "B") return 11;
    if (grade === "C") return 12;
    if (grade === "D") return 13;

    // walk-on
    if (grade === "W") return 20;

    return 90;
  };

  return [...arr].sort((a, b) => {
    const ga = gradeRank(a.Grade);
    const gb = gradeRank(b.Grade);

    if (ga !== gb) return ga - gb;

    const la = (a.Last || "").toLowerCase();
    const lb = (b.Last || "").toLowerCase();

    if (la < lb) return -1;
    if (la > lb) return 1;

    return 0;
  });
};

  // Aging 2026 -> 2027
  const ageForward = (year) => {
    if (year === "Senior") return "LEAVES";
    if (year === "Junior") return "Senior";
    if (year === "Sophomore") return "Junior";
    if (year === "Freshman") return "Sophomore";
    return year;
  };

  // “Move down a class” (used for shirt toggle in 2027 view)
  const moveDownOne = (year) => {
    if (year === "Senior") return "Junior";
    if (year === "Junior") return "Sophomore";
    if (year === "Sophomore") return "Freshman";
    if (year === "Freshman") return "Freshman";
    return year;
  };

  // Draft-eligible in 2027 is based on the ORIGINAL 2026 status:
  // - Seniors in 2026
  // - Juniors in 2026
  // - Redshirt Sophomores in 2026 (RS=yes OR shirt-toggled in 2027 tool to project RS)
  const isDraftEligibleIn2027 = (p) => {
    const baseYear = p.Year;
    const baseRS = rsStringIsYes(p.RS) || redshirtOverrideIds.has(p._id);

    if (baseYear === "Senior") return true;
    if (baseYear === "Junior") return true;
    if (baseYear === "Sophomore" && baseRS) return true;

    return false;
  };

  /* ===============================
     2026 STATIC VS 2027 PROJECTED DATASETS
  =============================== */

  // What year/class to display in the grid:
  // - 2026: show p.Year as-is
  // - 2027: show aged year, then apply redshirt “move down one” if shirt toggled
  const displayPlayers = useMemo(() => {
    if (rosterYearMode === 2026) return players;

    return players.map((p) => {
      let y = ageForward(p.Year);

      // Shirt toggle projects redshirt (moves down a class) for RS=no players.
      // We only allow toggling for players who are not already RS=yes in the data.
      if (redshirtOverrideIds.has(p._id)) {
        // If they would have left as a senior, keep them leaving (redshirt projection doesn’t save seniors)
        if (y !== "LEAVES") y = moveDownOne(y);
      }

      return {
        ...p,
        _displayYear: y,
      };
    });
  }, [players, rosterYearMode, redshirtOverrideIds]);
const getGradeColor = (grade) => {
  const g = grade?.toString().toUpperCase().trim();

  if (g === "5") return "#0026ff";
  if (g === "4") return "#00a83e";
  if (g === "3") return "#eab308";
  if (g === "2") return "#f97316";
  if (g === "1") return "#ef4444";

  if (g === "A+") return "#00ff40";
  if (g === "A") return "#00d9ff";
  if (g === "B") return "#dc00f0";
  if (g === "C") return "#a74300";
  if (g === "D") return "#850000";

  if (g === "W") return "#000000";

  return "#111";
};

  // Leaves list (2027 mode only): includes aged seniors + declared
  const leavesIn2027 = useMemo(() => {
    if (rosterYearMode !== 2027) return [];

    const agedLeaves = displayPlayers.filter((p) => p._displayYear === "LEAVES");
    const declaredLeaves = displayPlayers.filter((p) => declaredIds.has(p._id));

    // Merge unique (declared might include someone already LEAVES; keep one)
    const map = new Map();
    [...agedLeaves, ...declaredLeaves].forEach((p) => map.set(p._id, p));
    return Array.from(map.values());
  }, [displayPlayers, rosterYearMode, declaredIds]);

  // Roster grid list:
  // - 2026: everyone
  // - 2027: exclude aged seniors (LEAVES) + exclude declared
  const rosterGridPlayers = useMemo(() => {
    if (rosterYearMode === 2026) return players;

    return displayPlayers.filter(
      (p) => p._displayYear !== "LEAVES" && !declaredIds.has(p._id)
    );
  }, [players, displayPlayers, rosterYearMode, declaredIds]);
const positionCounts = useMemo(() => {
  if (!historical.length) return {};

  const counts = {};

  historical.forEach((p) => {
    const pos = p.Position;
    if (!pos) return;

    counts[pos] = (counts[pos] || 0) + 1;
  });

  return counts;
}, [historical]);
  /* ===============================
     INTERACTIONS (2027 ONLY)
  =============================== */

  const toggleDeclare = (id) => {
    setDeclaredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRedshirt = (p) => {
    // Only for 2027 interactive view
    if (rosterYearMode !== 2027) return;

    // Only show shirt icon if RS column is NO
    if (rsStringIsYes(p.RS)) return;

    setRedshirtOverrideIds((prev) => {
      const next = new Set(prev);
      if (next.has(p._id)) next.delete(p._id);
      else next.add(p._id);
      return next;
    });
  };

  /* ===============================
     RENDER SECTION (Excel-style)
  =============================== */

  const renderSection = (positions, label) => {
    return (
      <div style={{ marginBottom: 70 }}>
        <div
          style={{
            fontSize: 26,
            fontWeight: 900,
            marginBottom: 14,
            color: primary,
          }}
        >
          {label}
        </div>

        {/* POSITION HEADER (STICKY) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `160px repeat(${positions.length}, 1fr)`,
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 30,
            borderTop: `4px solid ${secondary}`,
            borderBottom: `4px solid ${secondary}`,
          }}
        >
          <div />
          {positions.map((pos) => (
            <div
              key={pos}
              style={{
                textAlign: "center",
                fontWeight: 900,
                fontSize: 18,
                padding: "12px 8px",
                borderLeft: `2px solid ${secondary}`,
                color: primary,
                letterSpacing: 0.5,
              }}
            >
              {pos}
            </div>
          ))}
        </div>

        {/* YEAR BLOCKS */}
        {YEARS.map((year) => {
          const yearPlayers =
            rosterYearMode === 2026
              ? rosterGridPlayers.filter((p) => p.Year === year)
              : rosterGridPlayers.filter((p) => p._displayYear === year);

          if (!yearPlayers.length) return null;

          return (
            <div
              key={year}
              style={{
                display: "grid",
                gridTemplateColumns: `160px repeat(${positions.length}, 1fr)`,
                borderBottom: `2px solid ${secondary}`,
              }}
            >
              {/* YEAR LABEL */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 18,
                  borderRight: `2px solid ${secondary}`,
                  background: "#f9f9f9",
                  padding: "14px 10px",
                }}
              >
                {year.toUpperCase()}
              </div>

              {/* POSITION CELLS */}
              {positions.map((pos) => {
const posPlayers = sortRosterPlayers(
  yearPlayers.filter((p) => p.Position === pos)
);
                return (
                  <div
                    key={pos}
                    style={{
                      padding: 14,
                      borderLeft: `2px solid ${secondary}`,
                      minHeight: 90,
                    }}
                  >
                    {posPlayers.map((p) => {
                      const italic = isRedshirtDisplay(p);
                      const slugged = hasSlug(p);

                      // Only in 2027 interactive view
                      const showIcons = rosterYearMode === 2027;

                      // NFL icon appears only if draft eligible in 2027
                      // (based on original 2026 class+RS logic)
                      const showNFL = showIcons && isDraftEligibleIn2027(p);

                      // Shirt icon only if RS column is NO (user can project RS)
                      const showShirt = showIcons && !rsStringIsYes(p.RS);

                      return (
                        <div
                          key={p._id}
                          style={{
display: "flex",
flexDirection: "column",
alignItems: "center",
                            marginBottom: 10,
                          }}
                        >
<div
  style={{
    width: "92%",
    background: primary,
    border: `3px solid ${secondary}`,
    borderRadius: 10,
    padding: "10px 10px 8px",
    boxShadow: "0 1px 0 rgba(0,0,0,0.08)",
    color: "#fff",
    display: "flex",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 8,
    position: "relative",
  }}
>
{/* GRADE + NAME ROW */}
<div
  style={{
    display: "flex",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 10,
    width: "100%",
  }}
>

{/* GRADE INDICATOR WITH VOTING */}
{p.Grade && (
  <div
style={{
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  margin: "-10px 0 -8px -10px",
  alignSelf: "stretch",
}}
  >


    {/* GRADE BOX */}
    <div
style={{
  display: "flex",
  alignItems: "stretch",
  justifyContent: "flex-start",
  fontWeight: 900,
  fontSize: 18,
  color: p.Grade === "A+" ? "#ffffff" : getGradeColor(p.Grade),
  background: p.Grade === "A+" ? "#f6a21d" : "#ffffff",
  padding: 0,
  width: 28,
  minWidth: 28,
  height: "100%",
  borderRadius: "7px 0 0 7px",
  borderRight: `3px solid ${secondary}`,
  position: "relative",

}}
    >
<div
style={{
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  minHeight: 52,
  padding: "4px 0",
  lineHeight: 1,
}}
>
  {/* ▲ */}
<span
    onClick={() => handleVote(p, 1)}
    style={{
      cursor: "pointer",
      fontSize: 10,
      color: userVotes[getVoteId(p)] === 1 ? "#00c94f" : "#aaa",
      fontWeight: userVotes[getVoteId(p)] === 1 ? 900 : 400,
      marginBottom: -2,
    }}
  >
    ▲
  </span>

  {/* GRADE */}
  <div style={{ display: "flex", alignItems: "center" }}>
    {p.Grade === "A+" ? (
      <>
        <span>A</span>
        <span
          style={{
            fontSize: 10,
            marginLeft: 1,
            position: "relative",
            top: -2,
          }}
        >
          +
        </span>
      </>
    ) : (
      p.Grade
    )}
  </div>

  {/* ▼ */}
<span
    onClick={() => handleVote(p, -1)}
    style={{
      cursor: "pointer",
      fontSize: 9,
      color: userVotes[getVoteId(p)] === -1 ? "#ff4444" : "#aaa",
      fontWeight: userVotes[getVoteId(p)] === -1 ? 900 : 400,
      lineHeight: 1,
    }}
  >
    ▼
  </span>
</div>

    </div>

  </div>
)}

{/* NAME + POPUP */}
<div
  style={{
    position: "relative",
    textAlign: "center",
    flex: 1,
  }}
  onMouseEnter={() => setHoveredPlayer(p._id)}
  onMouseLeave={() => setHoveredPlayer(null)}
>

{slugged ? (
  <a
    href={`/player/${p.Slug}`}
    target="_blank"
    rel="noopener noreferrer"
    style={{
      color: "#fff",
      fontWeight: 700,
      fontSize: "1.05rem",
      textDecoration: "underline",
      fontStyle: italic ? "italic" : "normal",
      lineHeight: 1.1,
      display: "block",
    }}
  >
    <div>{p.First}</div>
    <div>{p.Last}</div>
  </a>
) : (
  <div
    style={{
      fontWeight: 700,
      fontSize: "1.05rem",
      fontStyle: italic ? "italic" : "normal",
      lineHeight: 1.1,
    }}
  >
    <div>{p.First}</div>
    <div>{p.Last}</div>
  </div>
)}

{/* PLAYER POPUP */}
{hoveredPlayer === p._id && (p.Notes || p.Notes2) && (
<div
  style={{
    position: "absolute",
    bottom: "120%",
    left: "50%",
    transform: "translateX(-50%)",
background: p.Grade === "A+" ? "#0055a5" : "#111",
color: "#fff",
border: p.Grade === "A+" ? "2px solid #f6a21d" : "none",
    padding: "10px 12px",
    borderRadius: 6,
    fontSize: 13,
    width: 220,
    zIndex: 50,
    textAlign: "left",
    boxShadow: "0 6px 14px rgba(0,0,0,0.4)",
    display: "flex",
    flexDirection: "column",
  }}
>
  
{/* PLAYER HEADER */}

<div
  style={{
    fontWeight: p.Grade === "A+" ? 1000 : 900,
    textAlign: p.Grade === "A+" ? "center" : "left",
    width: "100%",

    // 🔥 NEW
    fontSize: p.Grade === "A+" ? 16 : 14,
  }}
>
  {p.First} {p.Last}
</div>

{p.Grade === "A+" && (
  <div
    style={{
      marginTop: 4,
      marginBottom: 6,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
    }}
  >
    <div
      style={{
        fontWeight: 700,
        fontSize: 12,
        color: "#f6a21d",
        letterSpacing: 0.5,
      }}
    >
      We-Draft.com
    </div>

    <div
      style={{
        fontWeight: 900,
        fontSize: 13,
        color: "#f6a21d",
        letterSpacing: 1,
      }}
    >
      BLUECHIP PROSPECT
    </div>
  </div>
)}

{/* ELITE PROSPECT BADGE */}
{p.Grade === "5" && (
  <div
    style={{
      marginTop: 4,
      marginBottom: 6,
      fontWeight: 900,
      fontSize: 13,
      color: "#ffd700",
      letterSpacing: 1,
    }}
  >
    ★ IMPACT PLAYER ★
  </div>
)}

<div style={{ marginBottom: 6 }}>
  {p.Year}{isRedshirtDisplay(p) ? " (RS)" : ""} {p.Position}
</div>
{/* HEIGHT / WEIGHT */}
{p.Notes && (
  <div style={{ fontWeight: 800 }}>
    {p.Notes}
  </div>
)}

{/* FROM (OWN ROW UNDER HT/WT) */}
{p.From && (
  <div style={{ fontWeight: 800, marginBottom: 6 }}>
    {p.From}
  </div>
)}

{/* SHORT BIO */}
{p.Notes2 && (
  <div
    style={{
      lineHeight: 1.4,
      whiteSpace: "pre-line",
    }}
  >
    {p.Notes2}
  </div>
)}

  </div>
)}

</div>
</div>
</div>

{/* EMOJIS UNDER CARD */}
{showIcons && (showNFL || showShirt) && (
  <div
    style={{
      marginTop: 4,
      display: "flex",
      justifyContent: "center",
      gap: 10,
    }}
  >
    {showNFL && (
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHoveredIcon(`nfl-${p._id}`)}
        onMouseLeave={() => setHoveredIcon(null)}
      >
        <span
          onClick={() => toggleDeclare(p._id)}
          style={{ cursor: "pointer", fontSize: 16 }}
        >
          🏈
        </span>

        {hoveredIcon === `nfl-${p._id}` && (
          <div
            style={{
              position: "absolute",
              bottom: "130%",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#111",
              color: "#fff",
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: "nowrap",
              zIndex: 50,
              boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
            }}
          >
            Declare for Draft (moves to LEAVES)
          </div>
        )}
      </div>
    )}

    {showShirt && (
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHoveredIcon(`shirt-${p._id}`)}
        onMouseLeave={() => setHoveredIcon(null)}
      >
        <span
          onClick={() => toggleRedshirt(p)}
          style={{
            cursor: "pointer",
            fontSize: 16,
            opacity: redshirtOverrideIds.has(p._id) ? 1 : 0.9,
          }}
        >
          👕
        </span>

        {hoveredIcon === `shirt-${p._id}` && (
          <div
            style={{
              position: "absolute",
              bottom: "130%",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#111",
              color: "#fff",
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: "nowrap",
              zIndex: 50,
              boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
            }}
          >
            Project Redshirt (moves player down a class)
          </div>
        )}
      </div>
    )}
  </div>
)}

</div>
                        
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

if (loading) return <p>Loading team data...</p>;

  return (
    <>
    <Helmet>
      <title>{team?.School} {team?.Mascot} 2026 Roster & Draft Prospects | We-Draft</title>
      <meta
        name="description"
        content={`Full 2026 roster, player grades, and NFL draft prospects for the ${team?.School} ${team?.Mascot}. See which players are projected for the 2027 NFL Draft.`}
      />
      <link rel="canonical" href={`https://we-draft.com/team/${teamId}`} />
      <meta property="og:title" content={`${team?.School} ${team?.Mascot} 2026 Roster | We-Draft`} />
      <meta property="og:description" content={`NFL draft prospects and full roster breakdown for ${team?.School}.`} />
      <meta property="og:url" content={`https://we-draft.com/team/${teamId}`} />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SportsTeam",
          "name": `${team?.School} ${team?.Mascot}`,
          "sport": "American Football",
          "url": `https://we-draft.com/team/${teamId}`,
          "memberOf": {
            "@type": "SportsOrganization",
            "name": team?.Conference || "NCAA"
          }
        })}
      </script>
    </Helmet>
    <div className="max-w-7xl mx-auto p-6 pb-40">
{/* ===== HEADER WITH LOGOS ===== */}
<div
  style={{
    display: "grid",
    gridTemplateColumns: "260px 1fr 260px",
    alignItems: "center",
    marginBottom: 40,
    marginTop: 10,
  }}
>

  {/* LEFT LOGO */}
  <div style={{ textAlign: "center" }}>
    {team?.Logo1 && (
      <img
        src={sanitizeImgur(team.Logo1)}
        alt={`${team.School} logo`}
        style={{
          height: 190,
          objectFit: "contain",
        }}
        loading="lazy"
      />
    )}
  </div>

  {/* STACKED TEAM NAME */}
  <div style={{ textAlign: "center" }}>
    <div
      style={{
        fontSize: 60,
        fontWeight: 900,
        color: primary,
        letterSpacing: 1,
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      {team?.School}
    </div>

    <div
      style={{
        fontSize: 60,
        fontWeight: 900,
        color: primary,
        letterSpacing: 1,
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      {team?.Mascot}
    </div>
  </div>

  {/* RIGHT LOGO */}
  <div style={{ textAlign: "center" }}>
    {team?.Logo2 && (
      <img
        src={sanitizeImgur(team.Logo2)}
        alt={`${team.School} alt logo`}
        style={{
          height: 190,
          objectFit: "contain",
        }}
        loading="lazy"
      />
    )}
  </div>

</div>
{/* ===== TEAM ARTICLES ===== */}
{teamArticles.length > 0 && (
  <div
    style={{
      maxWidth: 900,
      margin: "0 auto 30px",
      border: `3px solid ${secondary}`,
      borderRadius: 10,
      overflow: "hidden",
      background: "#fff",
    }}
  >
    {/* HEADER */}
    <div
      style={{
        background: primary,
        color: "#fff",
        fontWeight: 900,
        padding: "12px",
        textAlign: "center",
        fontSize: 18,
        letterSpacing: 1,
      }}
    >
      IN THE NEWS
    </div>

    {/* ARTICLES */}
    {teamArticles
      .slice()
      .sort((a, b) => b.updatedAt?.seconds - a.updatedAt?.seconds)
      .map((a) => (
        <div
          key={a.id}
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #eee",
            fontWeight: 800,
            fontSize: 18,
          }}
        >
          <a
            href={`/news/${a.slug}`}
            style={{
              color: primary,
              textDecoration: "underline",
            }}
          >
            <>
  <span style={{ marginRight: 6 }}>
    {a.updatedAt?.toDate?.().toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}
    :
  </span>
  {a.title}
</>
          </a>
        </div>
      ))}
  </div>
)}
      {/* ===== VIEW TOGGLE (kept) ===== */}
      <div className="mb-10 text-center relative">
        <button
          className="text-xl font-extrabold px-6 py-3 rounded border"
          style={{ color: primary, borderColor: primary }}
          onClick={() => setDropdownOpen((prev) => !prev)}
        >
          {viewMode === "current" ? "Current Roster" : "Draft Archive"} ▾
        </button>

        {dropdownOpen && (
          <div className="absolute left-1/2 transform -translate-x-1/2 mt-2 bg-white shadow-lg rounded border w-56 z-50">
            <div
              onClick={() => {
                setViewMode("current");
                setDropdownOpen(false);
              }}
              className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-center"
            >
              Current Roster
            </div>
            <div
              onClick={() => {
                setViewMode("archive");
                setDropdownOpen(false);
              }}
              className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-center"
            >
              Draft Archive
            </div>
          </div>
        )}
      </div>

      {/* ===== CURRENT VIEW ===== */}
      {viewMode === "current" && (
        <>
          {/* Year selector (2026 static vs 2027 interactive) */}
<div
  style={{
    display: "flex",
    justifyContent: "center",
    gap: 18,
    marginBottom: 30,
    flexWrap: "wrap",
  }}
>

  {/* 2026 */}
  <button
    onClick={() => setRosterYearMode(2026)}
    style={{
      background: rosterYearMode === 2026 ? primary : "#fff",
      color: rosterYearMode === 2026 ? "#fff" : primary,
      border: `3px solid ${secondary}`,
      padding: "18px 34px",
      borderRadius: 10,
      fontWeight: 900,
      fontSize: 22,
      cursor: "pointer",
    }}
  >
    2026
  </button>

  {/* 2027 */}
  <button
    onClick={() => setRosterYearMode(2027)}
    style={{
      background: rosterYearMode === 2027 ? primary : "#fff",
      color: rosterYearMode === 2027 ? "#fff" : primary,
      border: `3px solid ${secondary}`,
      padding: "14px 34px",
      borderRadius: 10,
      fontWeight: 900,
      cursor: "pointer",
      textAlign: "center",
      lineHeight: 1.1,
    }}
  >
    <div style={{ fontSize: 22 }}>2027</div>
    <div style={{ fontSize: 14 }}>Projection</div>
  </button>

</div>

{/* PLAYER GRADES BUTTON */}
<div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
  <div style={{ position: "relative", display: "inline-block" }}>
    <button
      style={{
        background: "#fff",
        color: primary,
        border: `3px solid ${secondary}`,
        padding: "10px 28px",
        borderRadius: 10,
        fontWeight: 900,
        fontSize: 16,
        cursor: "pointer",
        letterSpacing: 0.5,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.nextSibling.style.display = "block";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.nextSibling.style.display = "none";
      }}
    >
      Player Grades ▾
    </button>

    <div
      style={{
        display: "none",
        position: "absolute",
        top: "110%",
        left: "50%",
        transform: "translateX(-50%)",
        background: "#fff",
        border: `3px solid ${secondary}`,
        borderRadius: 10,
        padding: "20px 24px",
        width: 420,
        zIndex: 100,
        boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
        textAlign: "left",
        fontSize: 14,
        lineHeight: 1.6,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.display = "block";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.display = "none";
      }}
    >

      {/* PRODUCTION GRADES */}
      <div style={{ fontWeight: 900, fontSize: 16, color: primary, marginBottom: 4 }}>
        Production Grades <span style={{ fontWeight: 400, fontSize: 13 }}>(number system)</span>
      </div>
      <div style={{ marginBottom: 8, color: "#444", fontSize: 13 }}>
        Given by <strong>We-Draft.com</strong> editors based on a player's experience, production, and skillset. These reflect a player's degree of production at the college level — draft grades are given only to provide a sense of scale.
      </div>

      {[
        { grade: "5", color: "#0026ff", desc: 'Player is one of the best in the country and can make an impact on any given play. "First or early second round talent"' },
        { grade: "4", color: "#00a83e", desc: 'Player has proven to be a high-end starter. "Day 2 talent"' },
        { grade: "3", color: "#eab308", desc: 'Player has played a lot and can be trusted to contribute. "Day 3 talent"' },
        { grade: "2", color: "#f97316", desc: "Player has played some and/or is depth." },
        { grade: "1", color: "#ef4444", desc: "Player has not played much." },
        { grade: "W", color: "#000", desc: "Walk-on. Player is not on scholarship." },
      ].map(({ grade, color, desc }) => (
        <div key={grade} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
          <span style={{ fontWeight: 900, color, minWidth: 20, fontSize: 15 }}>{grade}</span>
          <span style={{ color: "#333", fontSize: 13 }}>{desc}</span>
        </div>
      ))}

      {/* DIVIDER */}
      <div style={{ borderTop: `2px solid ${secondary}`, margin: "14px 0" }} />

      {/* DEVELOPMENT GRADES */}
      <div style={{ fontWeight: 900, fontSize: 16, color: primary, marginBottom: 4 }}>
        Development Grades <span style={{ fontWeight: 400, fontSize: 13 }}>(letter system)</span>
      </div>
      <div style={{ marginBottom: 8, color: "#444", fontSize: 13 }}>
        Given to players with 3+ years of eligibility remaining, based on recruiting rankings, high school film, and college experience. A 3-star player can be elevated if he played well in limited action. A player who plays a lot as an underclassman will receive a production grade instead.
      </div>

      {[
        { grade: "A+", color: "#f6a21d", desc: 'Player has rare talent and is a bluechip prospect according to We-Draft.com' },
        { grade: "A", color: "#00d9ff", desc: 'Player has the talent to make an impact sooner than later. "5-Star"' },
        { grade: "B", color: "#dc00f0", desc: 'Player has multiple traits that will help him contribute early. "4-Star"' },
        { grade: "C", color: "#a74300", desc: 'Player has potential but needs some time before he is ready to see the field. "3-Star"' },
{ grade: "D", color: "#850000", desc: "Player needs a lot of time before he can see the field." },
      ].map(({ grade, color, desc }) => (
        <div key={grade} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
          <span style={{ fontWeight: 900, color, minWidth: 20, fontSize: 15 }}>{grade}</span>
          <span style={{ color: "#333", fontSize: 13 }}>{desc}</span>
        </div>
      ))}

      {/* DIVIDER */}
      <div style={{ borderTop: `2px solid ${secondary}`, margin: "14px 0" }} />

      {/* COMMUNITY VOTES */}
      <div style={{ fontWeight: 900, fontSize: 16, color: primary, marginBottom: 6 }}>
        Community Votes
      </div>
      <div style={{ color: "#444", fontSize: 13, lineHeight: 1.6 }}>
        Vote on any player that you think <strong>We-Draft.com</strong> is underrating or overrating. If a player receives enough votes one way or the other, we will change their ranking. Just sign in to your <strong>We-Draft.com</strong> account!
      </div>

    </div>
  </div>
</div>

          {renderSection(OFFENSE_POS, "OFFENSE")}
          {renderSection(DEFENSE_POS, "DEFENSE")}

{/* LEAVES IN 2027 (only shows in 2027 mode) */}
{rosterYearMode === 2027 && (
  <div style={{ marginTop: 60, textAlign: "center" }}>
    
    <div
      style={{
        fontSize: 30,
        fontWeight: 900,
        color: primary,
        marginBottom: 18,
      }}
    >
      LEAVES IN 2027
    </div>

    <div
      style={{
        border: `3px solid ${secondary}`,
        borderRadius: 10,
        overflow: "hidden",
        background: "#fff",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >

      {/* HEADER */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 80px 140px 60px",
          background: primary,
          color: "#fff",
          fontWeight: 900,
          padding: "14px 18px",
          fontSize: 18,
          alignItems: "center",
        }}
      >
        <div style={{ textAlign: "left" }}>Player</div>
        <div style={{ textAlign: "center" }}>Pos</div>
        <div style={{ textAlign: "center" }}>Reason</div>
        <div />
      </div>

      {leavesIn2027.length === 0 ? (
        <div
          style={{
            padding: 18,
            fontSize: 18,
            color: "#444",
          }}
        >
          No players currently marked as leaving.
        </div>
      ) : (
        leavesIn2027
          .slice()
          .sort((a, b) => (a.Last || "").localeCompare(b.Last || ""))
          .map((p) => {
            const isDeclared = declaredIds.has(p._id);
            const reason = isDeclared ? "Draft" : "Graduates";

            return (
              <div
                key={p._id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 140px 60px",
                  padding: "12px 18px",
                  borderTop: "1px solid #eee",
                  alignItems: "center",
                  fontSize: 18,
                }}
              >

                {/* PLAYER */}
                <div
                  style={{
                    fontWeight: 900,
                    color: primary,
                    textAlign: "left",
                  }}
                >
                  {p.First} {p.Last}
                </div>

                {/* POSITION */}
                <div
                  style={{
                    textAlign: "center",
                    fontWeight: 800,
                  }}
                >
                  {p.Position || "-"}
                </div>

                {/* REASON */}
                <div
                  style={{
                    textAlign: "center",
                    fontWeight: 800,
                    color: isDeclared ? "#b45309" : "#444",
                  }}
                >
                  {reason}
                </div>

                {/* REMOVE BUTTON */}
                <div style={{ textAlign: "center" }}>
                  {isDeclared ? (
                    <button
                      onClick={() => toggleDeclare(p._id)}
                      title="Return player to roster"
                      style={{
                        background: "#fff",
                        border: `2px solid ${secondary}`,
                        color: "#b91c1c",
                        fontWeight: 900,
                        borderRadius: 6,
                        width: 30,
                        height: 30,
                        cursor: "pointer",
                        fontSize: 18,
                      }}
                    >
                      ✕
                    </button>
                  ) : (
                    <span style={{ color: "#999", fontSize: 18 }}>—</span>
                  )}
                </div>

              </div>
            );
          })
      )}
    </div>
  </div>
)}
        </>
      )}
      {viewMode === "archive" && (
  <div
    style={{
      textAlign: "center",
      fontSize: 28,
      fontWeight: 900,
      color: primary,
      marginBottom: 10,
      marginTop: 10,
      letterSpacing: 1,
    }}
  >
    PLAYERS DRAFTED SINCE 2000
  </div>
)}
{/* ===== PLAYERS DRAFTED BY POSITION ===== */}
{viewMode === "archive" && positionRanks && (
  <div
    style={{
      maxWidth: 1100,
      margin: "0 auto 30px",
      border: `3px solid ${secondary}`,
      borderRadius: 10,
      overflow: "hidden",
      background: "#fff",
    }}
  >

    {/* HEADER */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `160px repeat(${POSITION_ORDER.length}, 1fr)`,
        background: primary,
        color: "#fff",
        fontWeight: 900,
        padding: "14px 10px",
        fontSize: 16,
        textAlign: "center",
      }}
    >
      <div></div>
      {POSITION_ORDER.map((pos) => (
        <div key={pos}>{pos}</div>
      ))}
    </div>

    {/* AMOUNT */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `160px repeat(${POSITION_ORDER.length}, 1fr)`,
        borderTop: "1px solid #eee",
        textAlign: "center",
        fontWeight: 800,
      }}
    >
      <div style={{ padding: 12 }}>Amount</div>
      {POSITION_ORDER.map((pos) => (
        <div key={pos} style={{ padding: 12 }}>
          {positionCounts[pos] || 0}
        </div>
      ))}
    </div>

    {/* NATIONAL */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `160px repeat(${POSITION_ORDER.length}, 1fr)`,
        borderTop: "1px solid #eee",
        textAlign: "center",
        fontWeight: 800,
      }}
    >
      <div style={{ padding: 12 }}>National Rank</div>
      {POSITION_ORDER.map((pos) => (
        <div key={pos} style={{ padding: 12 }}>
          {positionRanks?.[pos]?.natRank || "-"}
        </div>
      ))}
    </div>

    {/* CONFERENCE */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `160px repeat(${POSITION_ORDER.length}, 1fr)`,
        borderTop: "1px solid #eee",
        textAlign: "center",
        fontWeight: 800,
      }}
    >
      <div style={{ padding: 12 }}>
        {team?.Conference} Rank
      </div>
      {POSITION_ORDER.map((pos) => (
        <div key={pos} style={{ padding: 12 }}>
          {positionRanks?.[pos]?.confRank || "-"}
        </div>
      ))}
    </div>

  </div>
)}
      {/* ===== ARCHIVE VIEW (left as your existing system) ===== */}
{viewMode === "archive" && (
  <div
    style={{
      maxWidth: 1000,
      margin: "0 auto",
      border: `3px solid ${secondary}`,
      borderRadius: 10,
      overflow: "hidden",
      background: "#fff",
    }}
  >
    {/* HEADER */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "80px 100px 1fr 100px 200px",
        background: primary,
        color: "#fff",
        fontWeight: 900,
        padding: "14px 18px",
        fontSize: 18,
        alignItems: "center",
      }}
    >
      <div>Year</div>
      <div>Round</div>
      <div>Player</div>
      <div>Pos</div>
      <div>NFL Team</div>
    </div>

    {/* ROWS */}
    {historical.length === 0 ? (
      <div style={{ padding: 20, fontSize: 18 }}>
        No draft history available.
      </div>
    ) : (
      historical
        .slice()
        .sort((a, b) => {
          // newest year first, then round, then pick
          if (a.Year !== b.Year) return b.Year - a.Year;
          if (a.Round !== b.Round) return a.Round - b.Round;
          return a.Pick - b.Pick;
        })
        .map((p) => (
          <div
            key={p.id}
            style={{
              display: "grid",
              gridTemplateColumns: "80px 100px 1fr 100px 200px",
              padding: "12px 18px",
              borderTop: "1px solid #eee",
              alignItems: "center",
              fontSize: 18,
            }}
          >
            {/* YEAR */}
            <div style={{ fontWeight: 800 }}>{p.Year}</div>

            {/* ROUND */}
            <div style={{ fontWeight: 800 }}>
              R{p.Round}
            </div>

            {/* PLAYER */}
            <div style={{ fontWeight: 900, color: primary }}>
              {p.Player}
            </div>

            {/* POSITION */}
            <div style={{ textAlign: "center", fontWeight: 800 }}>
              {p.Position}
            </div>

            {/* NFL TEAM */}
            <div style={{ fontWeight: 700 }}>
              {p["NFL Team"]}
            </div>
          </div>
        ))
    )}
  </div>
)}
</div>
    </>
  );
}