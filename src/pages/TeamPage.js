import { useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";

export default function TeamPage() {
  const { teamId } = useParams();

  const [team, setTeam] = useState(null);
  const [players, setPlayers] = useState([]);
  const [historical, setHistorical] = useState([]);
  const [loading, setLoading] = useState(true);

  // Current roster vs archive
  const [viewMode, setViewMode] = useState("current"); // 'current' | 'archive'
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Projection year selector (only affects current roster view)
  const [rosterYearMode, setRosterYearMode] = useState(2026); // 2026 static, 2027 interactive

  // 2027-only interactive state (wipes on refresh)
  const [declaredIds, setDeclaredIds] = useState(() => new Set()); // moved to LEAVES
  const [redshirtOverrideIds, setRedshirtOverrideIds] = useState(() => new Set()); // force RS "Yes" for projection + move down a class

  const formatTeamId = (str) =>
    str
      .toLowerCase()
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

  const sanitizeImgur = (url) =>
    url?.includes("imgur.com")
      ? url.replace("imgur.com", "i.imgur.com") + ".png"
      : url;

  const primary = team?.Color1 || "#0055a5";
  const secondary = team?.Color2 || "#f6a21d";

  const YEARS = ["Senior", "Junior", "Sophomore", "Freshman"];
  const OFFENSE_POS = ["QB", "RB", "WR", "TE", "OL"];
  const DEFENSE_POS = ["EDGE", "DL", "LB", "DB"];

  /* ===============================
     FETCH TEAM + CURRENT ROSTER + ARCHIVE
  =============================== */
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);

      const formattedId = formatTeamId(teamId);
      const teamRef = doc(db, "schools", formattedId);
      const teamSnap = await getDoc(teamRef);

      if (!teamSnap.exists()) {
        setLoading(false);
        return;
      }

      const teamData = teamSnap.data();
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
  const sortLastNameAZ = (arr) => {
    return [...arr].sort((a, b) => {
      const la = (a.Last || "").toString().toLowerCase();
      const lb = (b.Last || "").toString().toLowerCase();
      if (!la) return 1;
      if (!lb) return -1;
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
                const posPlayers = sortLastNameAZ(
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
                            justifyContent: "center",
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
                              textAlign: "center",
                              boxShadow: "0 1px 0 rgba(0,0,0,0.08)",
                              color: "#fff",
                            }}
                          >
                            {/* NAME (stacked) */}
                            {slugged ? (
                              <a
                                href={`/player/${p.Slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: "#fff",
                                  fontWeight: 700, // less bold than before
                                  fontSize: "1.05rem",
                                  textDecoration: "underline",
                                  fontStyle: italic ? "italic" : "normal",
                                  display: "block",
                                  lineHeight: 1.1,
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

                            {/* Draft Prospect label if slug exists */}
                            {slugged && (
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 11,
                                  fontWeight: 800,
                                  color: "#fff",
                                  opacity: 0.9,
                                  letterSpacing: 0.4,
                                  textTransform: "uppercase",
                                }}
                              >
                                Draft Prospect
                              </div>
                            )}

                            {/* ICON ROW (2027 only) — NFL + Shirt side-by-side */}
                            {showIcons && (showNFL || showShirt) && (
                              <div
                                style={{
                                  marginTop: 6,
                                  display: "flex",
                                  justifyContent: "center",
                                  gap: 10,
                                }}
                              >
                                {showNFL && (
                                  <span
                                    title="Declare / leave in 2027"
                                    onClick={() => toggleDeclare(p._id)}
                                    style={{
                                      cursor: "pointer",
                                      userSelect: "none",
                                      fontSize: 16,
                                      lineHeight: "16px",
                                    }}
                                  >
                                    🏈
                                  </span>
                                )}

                                {showShirt && (
                                  <span
                                    title="Project redshirt (toggle)"
                                    onClick={() => toggleRedshirt(p)}
                                    style={{
                                      cursor: "pointer",
                                      userSelect: "none",
                                      fontSize: 16,
                                      lineHeight: "16px",
                                      opacity: redshirtOverrideIds.has(p._id)
                                        ? 1
                                        : 0.9,
                                    }}
                                  >
                                    👕
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
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
    <div className="max-w-7xl mx-auto p-6 pb-40">
      {/* ===== HEADER WITH LOGOS (kept) ===== */}
      <div
        className="flex items-center justify-between gap-10 mb-10 flex-wrap"
        style={{ marginTop: 10 }}
      >
        <div className="flex-1 flex justify-start">
          {team?.Logo1 && (
            <img
              src={sanitizeImgur(team.Logo1)}
              alt={`${team.School} logo`}
              className="h-32 w-auto object-contain"
              loading="lazy"
            />
          )}
        </div>

        <div className="flex-1 flex justify-center">
          <h1
            className="text-5xl font-extrabold text-center"
            style={{ color: primary }}
          >
            {team?.School} {team?.Mascot}
          </h1>
        </div>

        <div className="flex-1 flex justify-end">
          {team?.Logo2 && (
            <img
              src={sanitizeImgur(team.Logo2)}
              alt={`${team.School} alt logo`}
              className="h-32 w-auto object-contain"
              loading="lazy"
            />
          )}
        </div>
      </div>

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
              gap: 12,
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => {
                setRosterYearMode(2026);
                // keep states, but they won’t show in 2026 anyway
              }}
              style={{
                background: rosterYearMode === 2026 ? primary : "#fff",
                color: rosterYearMode === 2026 ? "#fff" : primary,
                border: `2px solid ${secondary}`,
                padding: "10px 16px",
                borderRadius: 8,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              2026
            </button>

            <button
              onClick={() => setRosterYearMode(2027)}
              style={{
                background: rosterYearMode === 2027 ? primary : "#fff",
                color: rosterYearMode === 2027 ? "#fff" : primary,
                border: `2px solid ${secondary}`,
                padding: "10px 16px",
                borderRadius: 8,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              2027 (Projection Tool)
            </button>
          </div>

          {renderSection(OFFENSE_POS, "OFFENSE")}
          {renderSection(DEFENSE_POS, "DEFENSE")}

          {/* LEAVES IN 2027 (only shows in 2027 mode) */}
          {rosterYearMode === 2027 && (
            <div style={{ marginTop: 60 }}>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 900,
                  color: primary,
                  marginBottom: 14,
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
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 120px 60px",
                    background: primary,
                    color: "#fff",
                    fontWeight: 900,
                    padding: "12px 14px",
                  }}
                >
                  <div>Player</div>
                  <div style={{ textAlign: "center" }}>Pos</div>
                  <div style={{ textAlign: "center" }}></div>
                </div>

                {leavesIn2027.length === 0 ? (
                  <div style={{ padding: 14, color: "#444" }}>
                    No players currently marked as leaving.
                  </div>
                ) : (
                  leavesIn2027
                    .slice()
                    .sort((a, b) => (a.Last || "").localeCompare(b.Last || ""))
                    .map((p) => {
                      const isDeclared = declaredIds.has(p._id);

                      return (
                        <div
                          key={p._id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 120px 60px",
                            padding: "12px 14px",
                            borderTop: "1px solid #eee",
                            alignItems: "center",
                          }}
                        >
                          <div style={{ fontWeight: 800, color: primary }}>
                            {p.First} {p.Last}
                          </div>
                          <div style={{ textAlign: "center" }}>
                            {p.Position || "-"}
                          </div>

                          {/* X only for drafted/declared players (not natural seniors leaving) */}
                          <div style={{ textAlign: "center" }}>
                            {isDeclared ? (
                              <button
                                onClick={() => toggleDeclare(p._id)}
                                title="Remove from Leaves (put back on roster)"
                                style={{
                                  background: "#fff",
                                  border: `2px solid ${secondary}`,
                                  color: "#b91c1c",
                                  fontWeight: 900,
                                  borderRadius: 8,
                                  width: 34,
                                  height: 34,
                                  cursor: "pointer",
                                }}
                              >
                                ✕
                              </button>
                            ) : (
                              <span style={{ color: "#999" }}>—</span>
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

      {/* ===== ARCHIVE VIEW (left as your existing system) ===== */}
      {viewMode === "archive" && (
        <div className="text-center text-gray-500">
          Archive view unchanged (use your existing table UI here).
        </div>
      )}
    </div>
  );
}