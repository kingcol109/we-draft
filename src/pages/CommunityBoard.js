import React, { useEffect, useState, useRef } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { Range } from "react-range";
import { Link } from "react-router-dom"; 
import Logo1 from "../assets/Logo1.png"; 

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const defaultRanges = {
  Height: [60, 84],
  Weight: [150, 400],
  Wingspan: [30, 90],
  "Arm Length": [25, 40],
  "Hand Size": [7, 12],
  "40 Yard": [4.0, 7.0],
  Vertical: [15, 50],
  Broad: [70, 130],
  Shuttle: [3.8, 6.0],
  "3-Cone": [6.0, 20.0],
  Bench: [0, 60],
};

const gradeOrder = [
  "Early First Round",
  "Middle First Round",
  "Late First Round",
  "Second Round",
  "Third Round",
  "Fourth Round",
  "Fifth Round",
  "Sixth Round",
  "Seventh Round",
  "UDFA",
];

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

// --- helpers ---
const formatHeight = (inches) => {
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
};

const formatValue = (trait, value) => {
  if (trait === "Height") return formatHeight(value);
  if (["Wingspan", "Arm Length", "Hand Size", "Vertical", "Broad"].includes(trait))
    return `${value}"`;
  if (["40 Yard", "Shuttle", "3-Cone"].includes(trait)) return value.toFixed(2);
  return value.toString();
};

const parseValue = (trait, val) => {
  if (!val) return NaN;
  if (trait === "Height") {
    const match = val.match(/(\d+)'(\d+)?/);
    if (match) {
      const ft = parseInt(match[1], 10);
      const inches = parseInt(match[2] || "0", 10);
      return ft * 12 + inches;
    }
    return parseFloat(val);
  }
  return parseFloat(val);
};

// --- dropdown checklist ---
function DropdownChecklist({ title, options, selected, setSelected, ordered = false }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (option) => {
    setSelected((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    );
  };

  const selectAll = () => setSelected(options);
  const clearAll = () => setSelected([]);

  const sortedOptions = ordered ? options : [...options].sort();

  return (
    <div ref={dropdownRef} className="relative inline-block text-left">
      <button
        onClick={() => setOpen(!open)}
        className="px-6 py-3 font-extrabold uppercase tracking-wide text-white rounded bg-[#0055a5] border-4 border-[#f6a21d] shadow hover:brightness-110 transition w-64"
      >
        {title}
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-64 max-h-80 overflow-y-auto bg-white border-4 border-[#f6a21d] rounded shadow-lg">
          <div className="flex items-center justify-between px-4 py-2 bg-[#0055a5] text-white text-sm font-bold">
            <span>{title}</span>
            <div className="space-x-3">
              <button onClick={selectAll} type="button" className="underline">
                All
              </button>
              <button onClick={clearAll} type="button" className="underline">
                Clear
              </button>
            </div>
          </div>
          <div className="p-4">
            {sortedOptions.map((option) => (
              <label key={option} className="block mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggleOption(option)}
                  className="mr-2 accent-[#0055a5]"
                />
                {option}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- traits filter ---
function TraitsFilter({ traitFilters, setTraitFilters, resetFilters }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} className="relative inline-block text-left">
      <button
        onClick={() => setOpen(!open)}
        className="px-6 py-3 font-extrabold uppercase tracking-wide text-white rounded bg-[#0055a5] border-4 border-[#f6a21d] shadow hover:brightness-110 transition w-64"
      >
        Traits
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-96 max-h-[36rem] overflow-y-auto bg-white border-2 border-[#f6a21d] rounded-lg shadow-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <span className="font-bold text-[#0055a5]">Filter Traits</span>
            <button
              onClick={resetFilters}
              className="text-xs text-red-600 underline"
            >
              Reset
            </button>
          </div>

          {Object.keys(traitFilters).map((trait) => {
            const [minVal, maxVal] = traitFilters[trait];
            const minDefault = defaultRanges[trait][0];
            const maxDefault = defaultRanges[trait][1];
            const step =
              trait === "Hand Size"
                ? 0.25
                : ["40 Yard", "Shuttle", "3-Cone"].includes(trait)
                ? 0.1
                : 1;

            return (
              <div key={trait} className="mb-6">
                <div className="font-semibold text-[#0055a5] mb-2">{trait}</div>
                <Range
                  values={[minVal, maxVal]}
                  step={step}
                  min={minDefault}
                  max={maxDefault}
                  onChange={(vals) =>
                    setTraitFilters((prev) => ({ ...prev, [trait]: vals }))
                  }
                  renderTrack={({ props, children }) => (
                    <div
                      {...props}
                      className="h-2 w-full bg-gray-200 rounded"
                      style={{ ...props.style }}
                    >
                      <div
                        className="h-2 bg-[#0055a5] rounded"
                        style={{
                          marginLeft: `${((minVal - minDefault) / (maxDefault - minDefault)) * 100}%`,
                          width: `${((maxVal - minVal) / (maxDefault - minDefault)) * 100}%`,
                        }}
                      />
                      {children}
                    </div>
                  )}
                  renderThumb={({ props }) => (
                    <div
                      {...props}
                      className="h-5 w-5 bg-[#0055a5] rounded-full border-2 border-[#f6a21d] shadow"
                    />
                  )}
                />
                <div className="grid grid-cols-3 text-sm text-center mt-2">
                  <span>{formatValue(trait, minDefault)}</span>
                  <span className="font-bold text-[#0055a5]">
                    {formatValue(trait, minVal)} – {formatValue(trait, maxVal)}
                  </span>
                  <span>{formatValue(trait, maxDefault)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- main board ---
export default function CommunityBoard() {
  const [players, setPlayers] = useState([]);
  const [sortKey, setSortKey] = useState("CommunityGrade");
  const [sortOrder, setSortOrder] = useState("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedGrades, setSelectedGrades] = useState([]);
  const [traitFilters, setTraitFilters] = useState(() =>
    JSON.parse(JSON.stringify(defaultRanges))
  );
  const [eligibleYear, setEligibleYear] = useState("2026");

  useEffect(() => {
    const fetchPlayers = async () => {
      const querySnapshot = await getDocs(collection(db, "players"));
      const data = await Promise.all(
        querySnapshot.docs.map(async (docSnap) => {
          const p = { id: docSnap.id, ...docSnap.data() };

          // fetch evaluations for community grade
          try {
            const evalsSnap = await getDocs(collection(db, "players", docSnap.id, "evaluations"));
            const grades = [];
            evalsSnap.forEach((d) => {
              const g = d.data().grade;
              if (g && gradeScale[g]) grades.push(gradeScale[g]);
            });
            if (grades.length > 0) {
              const avg = Math.round(
                grades.reduce((a, b) => a + b, 0) / grades.length
              );
              p.CommunityGrade = gradeLabels[avg];
            } else {
              p.CommunityGrade = "-";
            }
          } catch (err) {
            console.error("Error fetching community grade:", err);
            p.CommunityGrade = "-";
          }

          return p;
        })
      );

      setPlayers(data);
    };
    fetchPlayers();
  }, []);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const resetFilters = () => {
    setSelectedSchools([]);
    setSelectedPositions([]);
    setSelectedGrades([]);
    setTraitFilters(JSON.parse(JSON.stringify(defaultRanges)));
    setSearchQuery("");
    setEligibleYear("2026");
  };

  const filteredPlayers = players
    .filter((p) => {
      if (!searchQuery.trim()) return true;
      const fullName = `${p.First || ""} ${p.Last || ""}`.toLowerCase();
      return fullName.includes(searchQuery.trim().toLowerCase());
    })
    .filter((p) =>
      selectedPositions.length === 0 ? true : selectedPositions.includes(p.Position)
    )
    .filter((p) =>
      selectedSchools.length === 0 ? true : selectedSchools.includes(p.School)
    )
    .filter((p) =>
      selectedGrades.length === 0 ? true : selectedGrades.includes(p.CommunityGrade)
    )
    .filter((p) =>
      p.Eligible ? p.Eligible.toString() === eligibleYear : true
    )
    .filter((p) =>
      Object.entries(traitFilters).every(([trait, [min, max]]) => {
        const val = parseValue(trait, p[trait]);
        if (isNaN(val)) return true;
        return val >= min && val <= max;
      })
    );

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
  if (sortKey === "CommunityGrade") {
    const aHasGrade = gradeScale[a.CommunityGrade];
    const bHasGrade = gradeScale[b.CommunityGrade];

    // If both have grades → sort by grade
    if (aHasGrade && bHasGrade) {
      const aVal = gradeScale[a.CommunityGrade];
      const bVal = gradeScale[b.CommunityGrade];
      return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    }

    // If one has grade → prioritize the one that has it
    if (aHasGrade && !bHasGrade) return -1;
    if (!aHasGrade && bHasGrade) return 1;

    // If neither have grade → sort alphabetically by last name
    const aLast = (a.Last || "").toLowerCase();
    const bLast = (b.Last || "").toLowerCase();
    if (aLast < bLast) return -1;
    if (aLast > bLast) return 1;
    return 0;
  }


  if (sortKey === "Player") {
    const aLast = (a.Last || "").toLowerCase();
    const bLast = (b.Last || "").toLowerCase();
    if (aLast < bLast) return sortOrder === "asc" ? -1 : 1;
    if (aLast > bLast) return sortOrder === "asc" ? 1 : -1;

    // tie-breaker by first name
    const aFirst = (a.First || "").toLowerCase();
    const bFirst = (b.First || "").toLowerCase();
    if (aFirst < bFirst) return sortOrder === "asc" ? -1 : 1;
    if (aFirst > bFirst) return sortOrder === "asc" ? 1 : -1;
    return 0;
  }

  const aVal = a[sortKey] ?? "";
  const bVal = b[sortKey] ?? "";
  if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
  if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
  return 0;
});


  const headers = [
    { key: "Player", label: "PLAYER" },
    { key: "Position", label: "POS" },
    { key: "School", label: "SCHOOL" },
    { key: "CommunityGrade", label: "COMM GRADE" },
    { key: "Height", label: "HT" },
    { key: "Weight", label: "WT" },
    { key: "Wingspan", label: "WING" },
    { key: "Arm Length", label: "ARM" },
    { key: "Hand Size", label: "HAND" },
    { key: "40 Yard", label: "40" },
    { key: "Vertical", label: "VERT" },
    { key: "Broad", label: "BROAD" },
    { key: "3-Cone", label: "3C" },
    { key: "Shuttle", label: "SHUTT" },
    { key: "Bench", label: "BENCH" },
  ];

  return (
    <div className="flex justify-center p-6">
      <div className="w-full max-w-7xl">
        {/* ✅ Logo above title */}
        <div className="flex justify-center mb-2">
          <img src={Logo1} alt="Logo" className="h-20 object-contain" />
        </div>

        <h1 className="text-4xl font-black text-[#0055a5] mb-4 text-center">
          Community Board
        </h1>

        {/* Eligible Year Filter */}
        <div className="flex justify-center gap-4 mb-6">
          {["2026", "2027", "2028"].map((year) => (
            <button
              key={year}
              onClick={() => setEligibleYear(year)}
              className={`px-8 py-3 font-extrabold uppercase rounded-full border-4 border-[#f6a21d] shadow transition ${
                eligibleYear === year
                  ? "bg-[#0055a5] text-white"
                  : "bg-white text-[#0055a5]"
              }`}
            >
              {year}
            </button>
          ))}
        </div>

        {/* Filters */}
<div className="flex flex-col md:flex-row gap-4 md:gap-6 mb-4 items-center md:justify-center">
  <DropdownChecklist
    title="Position"
    options={[...new Set(players.map((p) => p.Position).filter(Boolean))]}
    selected={selectedPositions}
    setSelected={setSelectedPositions}
  />
  <DropdownChecklist
    title="School"
    options={[...new Set(players.map((p) => p.School).filter(Boolean))].sort()}
    selected={selectedSchools}
    setSelected={setSelectedSchools}
  />
  <DropdownChecklist
    title="Community Grade"
    options={gradeOrder}
    selected={selectedGrades}
    setSelected={setSelectedGrades}
    ordered
  />
  <TraitsFilter
    traitFilters={traitFilters}
    setTraitFilters={setTraitFilters}
    resetFilters={resetFilters}
  />
</div>

        {/* ✅ Search */}
        <div className="flex justify-center mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search player..."
            className="w-[360px] px-5 py-3 rounded font-semibold bg-white text-[#0055a5] placeholder-[#0055a5]/70 border-4 border-[#f6a21d] shadow focus:outline-none focus:ring-2 focus:ring-[#f6a21d]"
          />
        </div>

        {/* Table */}
        <div className="overflow-x-auto max-h-[700px] overflow-y-scroll">
          <table className="min-w-full border-collapse text-center">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0055a5] text-white border-4 border-[#f6a21d]">
                {headers.map((h) => (
                  <th
                    key={h.key}
                    onClick={() => handleSort(h.key)}
                    className="p-3 font-extrabold uppercase text-base cursor-pointer select-none"
                  >
                    {h.label}
                    {sortKey === h.key ? (sortOrder === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map((p) => (
                <tr
                  key={p.id}
                  className="odd:bg-white even:bg-white hover:bg-[#e6f0fa]">
                  <td className="p-3 border border-[#f6a21d] text-sm">
                    <Link
                      to={`/player/${p.Slug}`}   // ✅ now uses slug
                      className="text-[#0055a5] font-bold hover:underline"
                    >
                      {`${p.First || ""} ${p.Last || ""}`}
                    </Link>
                  </td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.Position || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.School || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.CommunityGrade || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.Height || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.Weight || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.Wingspan || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p["Arm Length"] || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p["Hand Size"] || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p["40 Yard"] || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.Vertical || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.Broad || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p["3-Cone"] || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.Shuttle || "-"}</td>
                  <td className="p-3 border border-[#f6a21d] text-sm">{p.Bench || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
