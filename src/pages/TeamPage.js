import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(true);

  // View and sorting
  const [viewMode, setViewMode] = useState("current"); // 'current' | 'archive'
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({
    key: "Player",
    direction: "asc",
  });

  // Filters
  const [filterDropdowns, setFilterDropdowns] = useState({
    Position: false,
    Year: false,
    Round: false,
  });
  const [filters, setFilters] = useState({
    Position: [],
    Year: [],
    Round: [],
  });
  const [allFilterOptions, setAllFilterOptions] = useState({
    Position: [],
    Year: [],
    Round: [],
  });

  const formatTeamId = (str) =>
    str
      .toLowerCase()
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      const formattedId = formatTeamId(teamId);
      const teamRef = doc(db, "schools", formattedId);
      const teamSnap = await getDoc(teamRef);

      if (teamSnap.exists()) {
        const teamData = teamSnap.data();
        setTeam(teamData);

        const collectionName = viewMode === "archive" ? "historical" : "players";
        const colRef = collection(db, collectionName);
        const q = query(colRef, where("School", "==", teamData.School));
        const snapshot = await getDocs(q);

        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setPlayers(data);

        // Build unique filter options
        const uniquePositions = [
          ...new Set(data.map((p) => p.Position).filter(Boolean)),
        ].sort();
        const uniqueYears = [
          ...new Set(data.map((p) => p.Year).filter(Boolean)),
        ]
          .sort((a, b) => b - a)
          .map(String);
        const uniqueRounds = [
          ...new Set(data.map((p) => p.Round).filter(Boolean)),
        ]
          .sort((a, b) => a - b)
          .map(String);

        setAllFilterOptions({
          Position: uniquePositions,
          Year: uniqueYears,
          Round: uniqueRounds,
        });

        setFilters({
          Position: uniquePositions,
          Year: uniqueYears,
          Round: uniqueRounds,
        });
      } else {
        console.error("Team not found:", formattedId);
      }

      setLoading(false);
    };

    fetchData();
  }, [teamId, viewMode]);

  // Sorting defaults
  useEffect(() => {
    if (viewMode === "archive") {
      setSortConfig({ key: "Year", direction: "desc" });
    } else {
      setSortConfig({ key: "Player", direction: "asc" });
    }
  }, [viewMode]);

  const primary = team?.Color1 || "#0055a5";
  const secondary = team?.Color2 || "#f6a21d";

  const sanitizeImgur = (url) =>
    url?.includes("imgur.com")
      ? url.replace("imgur.com", "i.imgur.com") + ".png"
      : url;

  // Sorting handler
  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { key, direction: "asc" };
    });
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return "";
    return sortConfig.direction === "asc" ? " ▲" : " ▼";
  };

  // Filter logic
  const toggleDropdown = (key) => {
    setFilterDropdowns((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleFilterChange = (type, value) => {
    setFilters((prev) => {
      const current = new Set(prev[type]);
      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }
      return { ...prev, [type]: Array.from(current) };
    });
  };

  const clearFilters = () => {
    setFilters({ Position: [], Year: [], Round: [] });
  };

  const resetFilters = () => {
    setFilters(allFilterOptions);
  };

  // Apply filters
  const filteredPlayers = players.filter((p) => {
    if (viewMode === "archive") {
      const posCheck =
        filters.Position.length === 0 || filters.Position.includes(p.Position);
      const yearCheck =
        filters.Year.length === 0 || filters.Year.includes(String(p.Year));
      const roundCheck =
        filters.Round.length === 0 || filters.Round.includes(String(p.Round));
      return posCheck && yearCheck && roundCheck;
    }
    return true;
  });

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (!sortConfig.key) return 0;
    let valA = a[sortConfig.key];
    let valB = b[sortConfig.key];
    if (sortConfig.key === "Player") {
      const lastA = (a.Last || "").toLowerCase();
      const lastB = (b.Last || "").toLowerCase();
      valA = lastA;
      valB = lastB;
    }
    if (!valA) return 1;
    if (!valB) return -1;
    if (typeof valA === "string") valA = valA.toLowerCase();
    if (typeof valB === "string") valB = valB.toLowerCase();
    if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1;
    if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  const dropdownLabel = viewMode === "current" ? "Current Players" : "Draft Archive";

  if (loading) return <p>Loading team data...</p>;

  return (
    <div className="max-w-6xl mx-auto p-6 pb-40">
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between gap-10 mb-10 flex-wrap">
        <div className="flex-1 flex justify-start">
          {team?.Logo1 && (
            <img
              src={sanitizeImgur(team.Logo1)}
              alt={`${team.School} logo`}
              className="h-36 w-auto object-contain"
              loading="lazy"
            />
          )}
        </div>
        <div className="flex-1 flex justify-center">
          <h1 className="text-5xl font-extrabold text-center" style={{ color: primary }}>
            {team?.School} {team?.Mascot}
          </h1>
        </div>
        <div className="flex-1 flex justify-end">
          {team?.Logo2 && (
            <img
              src={sanitizeImgur(team.Logo2)}
              alt={`${team.School} alt logo`}
              className="h-36 w-auto object-contain"
              loading="lazy"
            />
          )}
        </div>
      </div>

      {/* ===== Dropdown Selector ===== */}
      <div className="mb-6 text-center relative">
        <button
          className="text-xl font-extrabold px-6 py-3 rounded border"
          style={{ color: primary, borderColor: primary }}
          onClick={() => setDropdownOpen((prev) => !prev)}
        >
          {dropdownLabel} ▾
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
              Current Players
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

      {/* ===== Archive Filters ===== */}
      {viewMode === "archive" && (
        <div className="flex flex-wrap justify-center gap-4 mb-8">
          {["Position", "Year", "Round"].map((type) => (
            <div key={type} className="relative">
              <button
                onClick={() => toggleDropdown(type)}
                className="font-bold px-5 py-3 text-white"
                style={{
                  backgroundColor: primary,
                  border: `3px solid ${secondary}`,
                  borderRadius: "6px",
                }}
              >
                {type.toUpperCase()}
              </button>
              {filterDropdowns[type] && (
                <div className="absolute left-0 mt-2 bg-white shadow-md rounded border w-48 max-h-64 overflow-y-auto z-50 text-left">
                  {allFilterOptions[type]?.map((val) => (
                    <label
                      key={val}
                      className="flex items-center px-3 py-1 cursor-pointer hover:bg-gray-100"
                    >
                      <input
                        type="checkbox"
                        className="mr-2"
                        checked={filters[type]?.includes(val)}
                        onChange={() => handleFilterChange(type, val)}
                      />
                      {val}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={clearFilters}
            className="font-bold px-4 py-3 text-white"
            style={{
              backgroundColor: "#b91c1c",
              border: `3px solid ${secondary}`,
              borderRadius: "6px",
            }}
          >
            CLEAR
          </button>
          <button
            onClick={resetFilters}
            className="font-bold px-4 py-3 text-white"
            style={{
              backgroundColor: "#15803d",
              border: `3px solid ${secondary}`,
              borderRadius: "6px",
            }}
          >
            RESET
          </button>
        </div>
      )}

      {/* ===== Player Table ===== */}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-center mb-10">
          <thead>
            <tr
              style={{
                backgroundColor: primary,
                color: "#fff",
                border: `4px solid ${secondary}`,
                fontSize: "1.1rem",
              }}
            >
              {viewMode === "archive" ? (
                <>
                  <th
                    className="p-3 font-bold cursor-pointer border"
                    onClick={() => handleSort("Player")}
                    style={{ borderColor: secondary }}
                  >
                    Name{getSortIndicator("Player")}
                  </th>
                  <th
                    className="p-3 font-bold cursor-pointer border"
                    onClick={() => handleSort("Position")}
                    style={{ borderColor: secondary }}
                  >
                    Pos{getSortIndicator("Position")}
                  </th>
                  <th
                    className="p-3 font-bold cursor-pointer border"
                    onClick={() => handleSort("Year")}
                    style={{ borderColor: secondary }}
                  >
                    Year{getSortIndicator("Year")}
                  </th>
                  <th
                    className="p-3 font-bold cursor-pointer border"
                    onClick={() => handleSort("Round")}
                    style={{ borderColor: secondary }}
                  >
                    Round{getSortIndicator("Round")}
                  </th>
                  <th
                    className="p-3 font-bold cursor-pointer border"
                    onClick={() => handleSort("Pick")}
                    style={{ borderColor: secondary }}
                  >
                    Pick{getSortIndicator("Pick")}
                  </th>
                  <th
                    className="p-3 font-bold border"
                    style={{ borderColor: secondary }}
                  >
                    NFL Team
                  </th>
                </>
              ) : (
                <>
                  <th
                    className="p-3 font-bold cursor-pointer border"
                    onClick={() => handleSort("Player")}
                    style={{ borderColor: secondary }}
                  >
                    Player{getSortIndicator("Player")}
                  </th>
                  <th
                    className="p-3 font-bold cursor-pointer border"
                    onClick={() => handleSort("Position")}
                    style={{ borderColor: secondary }}
                  >
                    Position{getSortIndicator("Position")}
                  </th>
                  <th
                    className="p-3 font-bold cursor-pointer border"
                    onClick={() => handleSort("Eligible")}
                    style={{ borderColor: secondary }}
                  >
                    Eligible{getSortIndicator("Eligible")}
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((p) => (
              <tr
                key={p.id}
                className="hover:bg-[#f9f9f9] transition"
                style={{ fontSize: "1.05rem" }}
              >
                {viewMode === "archive" ? (
                  <>
                    <td className="p-3 border font-bold" style={{ borderColor: secondary }}>
                      {p.Player || `${p.First} ${p.Last}`}
                    </td>
                    <td className="p-3 border" style={{ borderColor: secondary }}>
                      {p.Position || "-"}
                    </td>
                    <td className="p-3 border" style={{ borderColor: secondary }}>
                      {p.Year || "-"}
                    </td>
                    <td className="p-3 border" style={{ borderColor: secondary }}>
                      {p.Round || "-"}
                    </td>
                    <td className="p-3 border" style={{ borderColor: secondary }}>
                      {p.Pick || "-"}
                    </td>
                    <td className="p-3 border" style={{ borderColor: secondary }}>
                      {p["NFL Team"] || "-"}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-3 border font-bold" style={{ borderColor: secondary }}>
                      <a
                        href={`/player/${p.Slug}`}
                        className="transition-all"
                        style={{ color: primary, textDecoration: "none" }}
                      >
                        {p.First} {p.Last}
                      </a>
                    </td>
                    <td className="p-3 border" style={{ borderColor: secondary }}>
                      {p.Position || "-"}
                    </td>
                    <td className="p-3 border" style={{ borderColor: secondary }}>
                      {p.Eligible || "-"}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
