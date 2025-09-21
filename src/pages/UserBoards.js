import React, { useEffect, useState, useRef } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Logo1 from "../assets/Logo1.png";
import { Range } from "react-range";

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
  "Watchlist",
];

// --- helpers ---
const formatHeight = (inches) => {
  if (!inches || isNaN(inches)) return "-";
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
};

const formatValue = (trait, value) => {
  if (value === undefined || value === null || value === "" || isNaN(value))
    return "-";
  if (trait === "Height") return formatHeight(value);
  if (
    ["Wingspan", "Arm Length", "Hand Size", "Vertical", "Broad"].includes(trait)
  )
    return `${value}"`;
  if (["40 Yard", "Shuttle", "3-Cone"].includes(trait))
    return value.toFixed(2);
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

// --- Dropdown checklist ---
function DropdownChecklist({
  title,
  options,
  selected,
  setSelected,
  ordered = false,
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (option) => {
    setSelected((prev) =>
      prev.includes(option)
        ? prev.filter((o) => o !== option)
        : [...prev, option]
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

// --- Traits filter ---
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
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
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
            const [minDefault, maxDefault] = defaultRanges[trait];
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
                          marginLeft: `${
                            ((minVal - minDefault) / (maxDefault - minDefault)) *
                            100
                          }%`,
                          width: `${
                            ((maxVal - minVal) / (maxDefault - minDefault)) *
                            100
                          }%`,
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

// --- Main ---
export default function UserBoards() {
  const { user } = useAuth();
  const [evaluations, setEvaluations] = useState([]);
  const [players, setPlayers] = useState([]);
  const [sortKey, setSortKey] = useState("Last");
  const [sortOrder, setSortOrder] = useState("asc");
  const [view, setView] = useState("table");

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedGrades, setSelectedGrades] = useState([]);
  const [traitFilters, setTraitFilters] = useState(
    JSON.parse(JSON.stringify(defaultRanges))
  );
  const [eligibleYear, setEligibleYear] = useState("2026");

  // Fetch players
  useEffect(() => {
    const fetchPlayers = async () => {
      const querySnapshot = await getDocs(collection(db, "players"));
      const data = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setPlayers(data);
    };
    fetchPlayers();
  }, []);

  // Fetch user evaluations
  useEffect(() => {
    const fetchEvaluations = async () => {
      if (!user) return;
      const evalSnapshot = await getDocs(
        collection(db, "users", user.uid, "evaluations")
      );
      const evals = evalSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setEvaluations(evals);
    };
    fetchEvaluations();
  }, [user]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  // Merge players + evals
  const gradedPlayers = players
    .map((p) => {
      const evalData = evaluations.find((e) => e.playerId === p.id);
      if (!evalData) return null;
      return { ...p, UserGrade: evalData.grade || "-" };
    })
    .filter(Boolean);

  // Filters
  const filteredPlayers = gradedPlayers
    .filter((p) => {
      if (!searchQuery.trim()) return true;
      return `${p.First} ${p.Last}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
    })
    .filter((p) =>
      selectedPositions.length ? selectedPositions.includes(p.Position) : true
    )
    .filter((p) =>
      selectedSchools.length ? selectedSchools.includes(p.School) : true
    )
    .filter((p) =>
      selectedGrades.length ? selectedGrades.includes(p.UserGrade) : true
    )
    .filter((p) => {
      if (!p.Eligible) return true;
      return p.Eligible.toString() === eligibleYear;
    })
    .filter((p) =>
      Object.entries(traitFilters).every(([trait, [min, max]]) => {
        const val = parseValue(trait, p[trait]);
        if (isNaN(val)) return true;
        return val >= min && val <= max;
      })
    );

  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (sortKey === "UserGrade") {
      const rank = (g) =>
        gradeOrder.includes(g) ? gradeOrder.indexOf(g) : gradeOrder.length;
      return (rank(a.UserGrade) - rank(b.UserGrade)) * (sortOrder === "asc" ? 1 : -1);
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
    { key: "UserGrade", label: "YOUR GRADE" },
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

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen text-xl font-bold text-[#0055a5]">
        Please sign in to view your boards.
      </div>
    );
  }

  return (
    <div className="flex justify-center p-6">
      <div className="w-full max-w-7xl">
        {/* Logo + title */}
        <div className="flex justify-center mb-2">
          <img src={Logo1} alt="Logo" className="h-20 object-contain" />
        </div>
        <h1 className="text-4xl font-black text-[#0055a5] mb-4 text-center">
          Your Boards
        </h1>

        {/* Eligible buttons */}
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
        <div className="flex gap-4 mb-4 justify-center flex-wrap">
          <DropdownChecklist
            title="Position"
            options={[
              ...new Set(gradedPlayers.map((p) => p.Position).filter(Boolean)),
            ]}
            selected={selectedPositions}
            setSelected={setSelectedPositions}
          />
          <DropdownChecklist
            title="School"
            options={[
              ...new Set(gradedPlayers.map((p) => p.School).filter(Boolean)),
            ].sort()}
            selected={selectedSchools}
            setSelected={setSelectedSchools}
          />
          <DropdownChecklist
            title="Your Grade"
            options={gradeOrder}
            selected={selectedGrades}
            setSelected={setSelectedGrades}
            ordered
          />
          <TraitsFilter
            traitFilters={traitFilters}
            setTraitFilters={setTraitFilters}
            resetFilters={() => {
              setSelectedSchools([]);
              setSelectedPositions([]);
              setSelectedGrades([]);
              setTraitFilters(JSON.parse(JSON.stringify(defaultRanges)));
              setSearchQuery("");
              setEligibleYear("2026");
            }}
          />
        </div>

        {/* Search */}
        <div className="flex justify-center mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search player..."
            className="w-[360px] px-5 py-3 rounded font-semibold bg-white text-[#0055a5] placeholder-[#0055a5]/70 border-4 border-[#f6a21d] shadow focus:outline-none focus:ring-2 focus:ring-[#f6a21d]"
          />
        </div>

        {/* Table view */}
        {view === "table" && (
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
                      {sortKey === h.key
                        ? sortOrder === "asc"
                          ? " ▲"
                          : " ▼"
                        : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((p) => (
                  <tr
                    key={p.id}
                    className="odd:bg-white even:bg-white hover:bg-[#e6f0fa]"
                  >
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      <Link
                        to={`/player/${p.Slug}`}
                        className="text-[#0055a5] font-bold hover:underline"
                      >
                        {`${p.First || ""} ${p.Last || ""}`}
                      </Link>
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {p.Position || "-"}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {p.School || "-"}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {p.UserGrade || "-"}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("Height", parseValue("Height", p.Height))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {p.Weight || "-"}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("Wingspan", parseFloat(p.Wingspan))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("Arm Length", parseFloat(p["Arm Length"]))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("Hand Size", parseFloat(p["Hand Size"]))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("40 Yard", parseFloat(p["40 Yard"]))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("Vertical", parseFloat(p.Vertical))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("Broad", parseFloat(p.Broad))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("3-Cone", parseFloat(p["3-Cone"]))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {formatValue("Shuttle", parseFloat(p.Shuttle))}
                    </td>
                    <td className="p-3 border border-[#f6a21d] text-sm">
                      {p.Bench || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
