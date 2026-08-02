// src/pages/AdminPanel.js
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, collectionGroup, getDocs, addDoc, doc, updateDoc, setDoc, deleteDoc, query, where, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const ARCHIVE_YEARS = ["2026"];
const ACTIVE_YEARS = ["2027", "2028", "2029"];
const ELIGIBLE_YEARS = [...ARCHIVE_YEARS, ...ACTIVE_YEARS];

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB"];

const POSITIONS = [
  "QB", "RB", "WR", "TE", "OL", "OT", "OG", "C",
  "EDGE", "DL", "DT", "DE", "LB", "DB", "CB", "S", "K", "P", "LS",
];

const FLAIR_OPTIONS = [
  "", "Elite", "Star", "Diamond in the Rough", "Under the Radar", "Future Star",
  "Alien", "Second Chance", "Ahead of the Curve", "Early Impact",
  "Early Contributor", "Year 2 Contributor", "Developmental", "Proven",
];

// ── Grade scale — mirrors PlayerProfile.js exactly, so average-grade math
// in the admin panel matches what the public site shows. "Watchlist" is
// intentionally absent — it isn't a scored grade there either. ──
const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3, "Second Round": 4,
  "Third Round": 5, "Fourth Round": 6, "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, "UDFA": 10,
};
const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round", 4: "Second Round",
  5: "Third Round", 6: "Fourth Round", 7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
};
const gradeDisplayMap = {
  "Watchlist": { short: "W", bg: "#5F5E5A", border: "#444441" },
  "Early First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Late First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Second Round": { short: "2nd", bg: "#0F6E56", border: "#085041" },
  "Third Round": { short: "3rd", bg: "#185FA5", border: "#0C447C" },
  "Fourth Round": { short: "4th", bg: "#BA7517", border: "#854F0B" },
  "Fifth Round": { short: "5th", bg: "#BA7517", border: "#854F0B" },
  "Sixth Round": { short: "6th", bg: "#993C1D", border: "#712B13" },
  "Seventh Round": { short: "7th", bg: "#993C1D", border: "#712B13" },
  "UDFA": { short: "U", bg: "#A32D2D", border: "#791F1F" },
};
const gradeBadgeInfo = (g) => gradeDisplayMap[g] || { short: g, bg: "#5F5E5A", border: "#444441" };

const BLANK_PLAYER_FORM = {
  First: "", Last: "", School: "", Position: "", Eligible: "",
  Height: "", Weight: "", Flair: "", Live: true, AdminNotes: "",
};

function generateSlug(first, last, position, eligible) {
  const raw = (first || "") + "-" + (last || "") + "-" + (eligible || "") + "-" + (position || "");
  let s = raw.replace(/['\u2019`.]/g, "");
  s = s.replace(/[^a-zA-Z0-9\- ]/g, "");
  s = s.replace(/\s+/g, "-");
  s = s.toLowerCase();
  s = s.replace(/-+/g, "-");
  return s;
}

const SECTIONS = [
  { key: "players", label: "Player Data", icon: "🏈", ready: true },
  { key: "trends", label: "Trends", icon: "📈", ready: true },
  { key: "videos", label: "Videos", icon: "🎬", ready: true },
  { key: "analytics", label: "Analytics", icon: "📊", ready: true },
  { key: "content", label: "Content", icon: "📰", ready: false },
  { key: "sync", label: "Sync / System", icon: "🔄", ready: false },
  { key: "ads", label: "Ads", icon: "🎯", ready: false },
];

function SidebarNav({ active, setActive }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {SECTIONS.map((s) => {
        const isActive = active === s.key;
        return (
          <button
            key={s.key}
            onClick={() => setActive(s.key)}
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "12px 16px", borderRadius: "8px",
              border: "2px solid " + (isActive ? BLUE : "transparent"),
              background: isActive ? "#eaf1ff" : "#fff",
              color: isActive ? BLUE : "#555",
              fontWeight: 900, fontSize: "14px", textAlign: "left",
              cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em",
            }}
          >
            <span style={{ fontSize: "16px" }}>{s.icon}</span>
            <span style={{ flex: 1 }}>{s.label}</span>
            {!s.ready && (
              <span style={{
                fontSize: "8px", fontWeight: 900, color: "#aaa",
                border: "1px solid #ddd", borderRadius: "10px",
                padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.04em",
              }}>
                Soon
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ComingSoonPane({ label }) {
  return (
    <div style={{
      border: "2px dashed #ddd", borderRadius: "12px",
      padding: "60px 24px", textAlign: "center", background: "#fafafa",
    }}>
      <div style={{ fontSize: "32px", marginBottom: "12px" }}>🛠️</div>
      <div style={{ fontSize: "18px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label} — Coming Soon
      </div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#aaa", marginTop: "8px" }}>
        This section of the admin panel hasn't been built yet.
      </div>
    </div>
  );
}

function SchoolCombobox({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const q = (value || "").trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.toLowerCase().includes(q)).slice(0, 8)
    : options.slice(0, 8);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Type or select a school..."
        autoComplete="off"
        style={inputStyle}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
          background: "#fff", border: "2px solid #ddd", borderRadius: "6px",
          maxHeight: "220px", overflowY: "auto", boxShadow: "0 4px 14px rgba(0,0,0,0.14)",
        }}>
          {filtered.map((school) => (
            <div
              key={school}
              onClick={() => { onChange(school); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer", fontWeight: 700, fontSize: "13px", color: "#333" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              {school}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DropdownChecklist({ title, options, selected, setSelected }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (o) => setSelected((prev) => prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "7px 14px", fontWeight: 900, fontSize: "12px",
          textTransform: "uppercase", letterSpacing: "0.04em",
          color: selected.length > 0 ? "#fff" : BLUE,
          background: selected.length > 0 ? BLUE : "#fff",
          border: "2px solid " + GOLD, borderRadius: "20px",
          cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        {title}{selected.length > 0 ? " (" + selected.length + ")" : ""} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          zIndex: 50, width: "240px", maxHeight: "280px", overflowY: "auto",
          background: "#fff", border: "2px solid " + GOLD, borderRadius: "8px",
          boxShadow: "0 6px 16px rgba(0,0,0,0.14)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", background: BLUE, color: "#fff",
            fontSize: "11px", fontWeight: 900, flexShrink: 0,
          }}>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</span>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setSelected(options)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontWeight: 800, fontSize: "11px", textDecoration: "underline" }}>All</button>
              <button onClick={() => setSelected([])} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontWeight: 800, fontSize: "11px", textDecoration: "underline" }}>Clear</button>
            </div>
          </div>
          <div style={{ padding: "8px 10px" }}>
            {options.map((o) => (
              <label key={o} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} style={{ accentColor: BLUE, width: "13px", height: "13px" }} />
                {o}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBar({ label, options, selected, setSelected }) {
  const toggle = (opt) => setSelected((prev) => prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]);
  if (options.length === 0) return null;
  return (
    <div>
      {label && (
        <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>
          {label}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              style={{
                padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                textTransform: "uppercase", letterSpacing: "0.04em",
                border: "2px solid " + GOLD, borderRadius: "20px", cursor: "pointer",
                background: active ? BLUE : "#fff",
                color: active ? "#fff" : BLUE,
                whiteSpace: "nowrap", transition: "background 0.15s, color 0.15s",
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlayerDataSection() {
  const [allPlayers, setAllPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYears, setSelectedYears] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [schoolOptions, setSchoolOptions] = useState([]);

  useEffect(() => {
    const fetchSchools = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const names = snap.docs.map((d) => d.data().School).filter(Boolean).sort();
        setSchoolOptions(names);
      } catch (e) {
        console.error("Admin schools fetch error:", e);
        setSchoolOptions([]);
      }
    };
    fetchSchools();
  }, []);

  useEffect(() => {
    const fetchAllPlayers = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "players"));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.Last || "").localeCompare(b.Last || ""));
        setAllPlayers(data);
      } catch (e) {
        console.error("Admin player fetch error:", e);
        setAllPlayers([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAllPlayers();
  }, []);

  const allPositions = useMemo(() => {
    const pool = allPlayers.filter((p) => {
      if (selectedYears.length === 0) return p.Eligible !== "2026";
      return selectedYears.includes(p.Eligible);
    });
    const set = [...new Set(pool.map((p) => p.Position).filter(Boolean))];
    return set.sort((a, b) => {
      const ai = POSITION_ORDER.indexOf(a);
      const bi = POSITION_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [allPlayers, selectedYears]);

  const filtered = allPlayers.filter((p) => {
    if (selectedYears.length === 0) {
      if (p.Eligible === "2026") return false;
    } else {
      if (!selectedYears.includes(p.Eligible)) return false;
    }
    if (selectedPositions.length > 0 && !selectedPositions.includes(p.Position)) return false;
    if (selectedSchools.length > 0 && !selectedSchools.includes(p.School)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matches =
        ((p.First || "") + " " + (p.Last || "")).toLowerCase().includes(q) ||
        (p.School || "").toLowerCase().includes(q) ||
        (p.Slug || "").toLowerCase().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const selectPlayer = (p) => {
    setSelectedPlayer(p);
    setFormState({
      First: p.First || "",
      Last: p.Last || "",
      School: p.School || "",
      Position: p.Position || "",
      Eligible: p.Eligible || "",
      Height: p.Height || "",
      Weight: p.Weight || "",
      Flair: p.Flair || "",
      Live: p.Live !== false,
      AdminNotes: p.AdminNotes || "",
    });
    setSaveMessage("");
  };

  const startNewPlayer = () => {
    setSelectedPlayer({ id: null, isNew: true });
    setFormState({ ...BLANK_PLAYER_FORM });
    setSaveMessage("");
  };

  const handleFieldChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const previewSlug = useMemo(() => {
    if (!formState) return "";
    return generateSlug(formState.First, formState.Last, formState.Position, formState.Eligible);
  }, [formState]);

  const isNew = selectedPlayer?.isNew === true;

  const handleSave = async () => {
    if (!selectedPlayer || !formState) return;

    if (isNew) {
      if (!formState.First.trim() || !formState.Last.trim() || !formState.School.trim() || !formState.Position || !formState.Eligible) {
        setSaveMessage("First, Last, School, Position, and Eligible are required.");
        return;
      }
      const slug = generateSlug(formState.First, formState.Last, formState.Position, formState.Eligible);
      if (!slug || slug === "-") {
        setSaveMessage("Couldn't generate a valid slug from these fields.");
        return;
      }

      setSaving(true);
      setSaveMessage("");
      try {
        const dupSnap = await getDocs(query(collection(db, "players"), where("Slug", "==", slug)));
        if (!dupSnap.empty) {
          setSaveMessage("Slug \"" + slug + "\" is already in use — adjust name/position/year to make it unique.");
          setSaving(false);
          return;
        }

        const payload = { ...formState, Slug: slug };
        const newDocRef = await addDoc(collection(db, "players"), payload);
        const newPlayer = { id: newDocRef.id, ...payload };

        setAllPlayers((prev) => [...prev, newPlayer].sort((a, b) => (a.Last || "").localeCompare(b.Last || "")));
        setSelectedPlayer(newPlayer);
        setSaveMessage("Player created — slug \"" + slug + "\".");
      } catch (e) {
        console.error("Admin player create error:", e);
        setSaveMessage("Failed to create — check console.");
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setSaveMessage("");
    try {
      await updateDoc(doc(db, "players", selectedPlayer.id), { ...formState });
      setAllPlayers((prev) =>
        prev.map((p) => (p.id === selectedPlayer.id ? { ...p, ...formState } : p))
      );
      setSaveMessage("Saved.");
    } catch (e) {
      console.error("Admin player save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Player Data
          </div>
          <button
            onClick={startNewPlayer}
            style={{
              marginLeft: "auto", background: GOLD, color: "#fff", border: "none",
              borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            + Add Player
          </button>
        </div>

        <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee", display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, school, or slug..."
            style={{ width: "100%", border: "2px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-start" }}>
            <DropdownChecklist title="School" options={schoolOptions} selected={selectedSchools} setSelected={setSelectedSchools} />
          </div>
          <div>
            <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>
              Eligible Year
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {[...ACTIVE_YEARS, "2026"].map((yr) => {
                const isArchive = yr === "2026";
                const active = selectedYears.includes(yr);
                return (
                  <button
                    key={yr}
                    onClick={() => setSelectedYears((prev) => prev.includes(yr) ? prev.filter((y) => y !== yr) : [...prev, yr])}
                    title={isArchive ? "2026 — completed draft class, not shown by default" : undefined}
                    style={{
                      padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.04em",
                      border: "2px solid " + (isArchive ? "#7a5c00" : GOLD), borderRadius: "20px", cursor: "pointer",
                      background: active ? (isArchive ? "#7a5c00" : BLUE) : "#fff",
                      color: active ? "#fff" : (isArchive ? "#7a5c00" : BLUE),
                      whiteSpace: "nowrap", transition: "background 0.15s, color 0.15s",
                    }}
                  >
                    {isArchive ? "📦 2026" : yr}
                  </button>
                );
              })}
            </div>
          </div>
          <FilterBar label="Position" options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
        </div>

        {loading ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>Loading players…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No players match.</div>
        ) : (
          <div style={{ maxHeight: "600px", overflowY: "auto" }}>
            <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
              {filtered.length} player{filtered.length !== 1 ? "s" : ""}
            </div>
            {filtered.map((p) => {
              const isSelected = selectedPlayer?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => selectPlayer(p)}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "10px 14px", cursor: "pointer",
                    background: isSelected ? "#eaf1ff" : "#fff",
                    borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: "14px", color: BLUE }}>
                      {(p.First || "") + " " + (p.Last || "")}
                      {p.Live === false && (
                        <span style={{ marginLeft: "8px", fontSize: "9px", fontWeight: 900, color: "#c0392b", border: "1px solid #c0392b", borderRadius: "10px", padding: "1px 6px" }}>
                          HIDDEN
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#888" }}>
                      {p.Position || "—"} · {p.School || "—"} · {p.Eligible || "—"}
                    </div>
                  </div>
                  {p.Slug && (
                    <a
                      href={"/player/" + p.Slug}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Open player page in a new tab"
                      style={{
                        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        width: "30px", height: "30px", borderRadius: "6px",
                        border: "2px solid " + BLUE, color: BLUE, textDecoration: "none",
                        fontSize: "14px", fontWeight: 900,
                      }}
                    >
                      ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden", position: "sticky", top: "20px" }}>
        <div style={{ background: GOLD, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {isNew ? "New Player" : selectedPlayer ? "Edit Player" : "Select a Player"}
          </div>
          {!isNew && selectedPlayer?.Slug && (
            <a
              href={"/player/" + selectedPlayer.Slug}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "center", gap: "5px",
                background: "#fff", color: GOLD, border: "none",
                borderRadius: "6px", padding: "5px 10px", fontWeight: 900, fontSize: "11px",
                textTransform: "uppercase", letterSpacing: "0.04em", textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              View Page ↗
            </a>
          )}
        </div>

        {!selectedPlayer || !formState ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click a player from the list to edit their record, or "+ Add Player" to create one.
          </div>
        ) : (
          <div style={{ padding: "16px" }}>
            <FieldGroup>
              <FieldRow label="First">
                <input value={formState.First} onChange={(e) => handleFieldChange("First", e.target.value)} style={inputStyle} />
              </FieldRow>
              <FieldRow label="Last">
                <input value={formState.Last} onChange={(e) => handleFieldChange("Last", e.target.value)} style={inputStyle} />
              </FieldRow>
              <FieldRow label="School">
                <SchoolCombobox
                  value={formState.School}
                  onChange={(v) => handleFieldChange("School", v)}
                  options={schoolOptions}
                />
              </FieldRow>
              <FieldRow label="Position">
                <select value={formState.Position} onChange={(e) => handleFieldChange("Position", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Eligible">
                <select value={formState.Eligible} onChange={(e) => handleFieldChange("Eligible", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {ELIGIBLE_YEARS.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Height">
                <input value={formState.Height} onChange={(e) => handleFieldChange("Height", e.target.value)} placeholder="e.g. 6'2&quot;" style={inputStyle} />
              </FieldRow>
              <FieldRow label="Weight">
                <input value={formState.Weight} onChange={(e) => handleFieldChange("Weight", e.target.value)} placeholder="e.g. 215" style={inputStyle} />
              </FieldRow>
              <FieldRow label="Flair">
                <select value={formState.Flair} onChange={(e) => handleFieldChange("Flair", e.target.value)} style={inputStyle}>
                  {FLAIR_OPTIONS.map((f) => <option key={f} value={f}>{f || "None"}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Live">
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "13px" }}>
                  <input
                    type="checkbox"
                    checked={formState.Live}
                    onChange={(e) => handleFieldChange("Live", e.target.checked)}
                    style={{ width: "16px", height: "16px", accentColor: BLUE }}
                  />
                  Visible on site
                </label>
              </FieldRow>
              <FieldRow label="Admin Notes (internal only)">
                <textarea
                  value={formState.AdminNotes}
                  onChange={(e) => handleFieldChange("AdminNotes", e.target.value)}
                  placeholder="Internal notes — not shown on the public site"
                  style={{ ...inputStyle, height: "80px", resize: "vertical", fontFamily: "inherit" }}
                />
              </FieldRow>

              <FieldRow label={isNew ? "Slug (auto-generated preview)" : "Slug"}>
                <div style={{
                  width: "100%", border: "2px solid #eee", borderRadius: "6px",
                  padding: "8px 10px", fontWeight: 700, fontSize: "13px",
                  background: "#fafafa", color: "#666", boxSizing: "border-box",
                  wordBreak: "break-all",
                }}>
                  {isNew ? (previewSlug || "—") : (selectedPlayer.Slug || "—")}
                </div>
              </FieldRow>
            </FieldGroup>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%", marginTop: "16px",
                background: BLUE, color: "#fff", border: "2px solid " + GOLD,
                borderRadius: "8px", padding: "12px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : isNew ? "Create Player" : "Save Changes"}
            </button>
            {saveMessage && (
              <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") || saveMessage.includes("required") || saveMessage.includes("already in use") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TrendsSection() {
  const [allPlayers, setAllPlayers] = useState([]);
  const [trendsMap, setTrendsMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [playersSnap, trendsSnap] = await Promise.all([
          getDocs(query(collection(db, "players"), where("Eligible", "in", ACTIVE_YEARS))),
          getDocs(collection(db, "trends")),
        ]);
        const players = playersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        players.sort((a, b) => (a.Last || "").localeCompare(b.Last || ""));
        setAllPlayers(players);

        const map = new Map();
        trendsSnap.docs.forEach((d) => map.set(d.id, d.data()));
        setTrendsMap(map);
      } catch (e) {
        console.error("Admin trends fetch error:", e);
        setAllPlayers([]);
        setTrendsMap(new Map());
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = allPlayers.filter((p) => {
    if (!p.Slug) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      ((p.First || "") + " " + (p.Last || "")).toLowerCase().includes(q) ||
      (p.School || "").toLowerCase().includes(q) ||
      (p.Slug || "").toLowerCase().includes(q)
    );
  });

  const selectPlayer = (p) => {
    setSelectedPlayer(p);
    const existing = trendsMap.get(p.Slug);
    setFormState({
      Trend: existing?.Trend || "",
      Notes: existing?.Notes || "",
    });
    setSaveMessage("");
  };

  const handleSave = async () => {
    if (!selectedPlayer || !formState) return;
    if (!formState.Trend) {
      setSaveMessage("Pick a Trend value before saving — use Remove Trend to clear it instead.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const payload = { Trend: formState.Trend, Notes: formState.Notes || "" };
      await setDoc(doc(db, "trends", selectedPlayer.Slug), payload);
      setTrendsMap((prev) => new Map(prev).set(selectedPlayer.Slug, payload));
      setSaveMessage("Saved.");
    } catch (e) {
      console.error("Admin trend save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedPlayer) return;
    if (!trendsMap.has(selectedPlayer.Slug)) return;
    if (!window.confirm("Remove the trend for " + selectedPlayer.First + " " + selectedPlayer.Last + "?")) return;
    setRemoving(true);
    setSaveMessage("");
    try {
      await deleteDoc(doc(db, "trends", selectedPlayer.Slug));
      setTrendsMap((prev) => {
        const next = new Map(prev);
        next.delete(selectedPlayer.Slug);
        return next;
      });
      setFormState({ Trend: "", Notes: "" });
      setSaveMessage("Trend removed.");
    } catch (e) {
      console.error("Admin trend remove error:", e);
      setSaveMessage("Failed to remove — check console.");
    } finally {
      setRemoving(false);
    }
  };

  const TrendBadge = ({ value }) => {
    if (!value) return <span style={{ fontSize: "10px", fontWeight: 700, color: "#bbb" }}>No trend</span>;
    const lower = value.toLowerCase();
    if (lower === "breakout") {
      return (
        <span style={{ fontSize: "10px", fontWeight: 900, color: "#0a6b8f", background: "#e6f7ff", border: "1px solid #8fd8ff", borderRadius: "10px", padding: "2px 8px", textTransform: "uppercase" }}>
          ⚡ Breakout
        </span>
      );
    }
    if (lower === "up") {
      return (
        <span style={{ fontSize: "10px", fontWeight: 900, color: "#16a34a", background: "#eafff0", border: "1px solid #4ade80", borderRadius: "10px", padding: "2px 8px", textTransform: "uppercase" }}>
          ▲ Up
        </span>
      );
    }
    return (
      <span style={{ fontSize: "10px", fontWeight: 900, color: "#666", background: "#f0f0f0", border: "1px solid #ddd", borderRadius: "10px", padding: "2px 8px", textTransform: "uppercase" }}>
        {value}
      </span>
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Trends
          </div>
        </div>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, school, or slug..."
            style={{ width: "100%", border: "2px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {loading ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No players match.</div>
        ) : (
          <div style={{ maxHeight: "600px", overflowY: "auto" }}>
            <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
              {filtered.length} player{filtered.length !== 1 ? "s" : ""} · {trendsMap.size} with a trend
            </div>
            {filtered.map((p) => {
              const isSelected = selectedPlayer?.id === p.id;
              const existing = trendsMap.get(p.Slug);
              return (
                <div
                  key={p.id}
                  onClick={() => selectPlayer(p)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
                    padding: "10px 14px", cursor: "pointer",
                    background: isSelected ? "#eaf1ff" : "#fff",
                    borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: "14px", color: BLUE }}>
                      {(p.First || "") + " " + (p.Last || "")}
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#888" }}>
                      {p.Position || "—"} · {p.School || "—"} · {p.Eligible || "—"}
                    </div>
                  </div>
                  <TrendBadge value={existing?.Trend} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden", position: "sticky", top: "20px" }}>
        <div style={{ background: GOLD, padding: "10px 16px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {selectedPlayer ? "Edit Trend" : "Select a Player"}
          </div>
        </div>

        {!selectedPlayer || !formState ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click a player from the list to add or edit their trend.
          </div>
        ) : (
          <div style={{ padding: "16px" }}>
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontWeight: 900, fontSize: "16px", color: BLUE }}>
                {selectedPlayer.First} {selectedPlayer.Last}
              </div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#888", marginTop: "2px" }}>
                {selectedPlayer.Position || "—"} · {selectedPlayer.School || "—"} · {selectedPlayer.Eligible || "—"}
              </div>
            </div>

            <FieldGroup>
              <FieldRow label="Trend">
                <select
                  value={formState.Trend}
                  onChange={(e) => setFormState((prev) => ({ ...prev, Trend: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">— None —</option>
                  <option value="Up">▲ Up</option>
                  <option value="Breakout">⚡ Breakout</option>
                </select>
              </FieldRow>
              <FieldRow label="Notes (one per line)">
                <textarea
                  value={formState.Notes}
                  onChange={(e) => setFormState((prev) => ({ ...prev, Notes: e.target.value }))}
                  placeholder={"e.g.\n3 sacks in last 2 games\nForced 2 fumbles vs. Ohio State"}
                  style={{ ...inputStyle, height: "100px", resize: "vertical", fontFamily: "inherit" }}
                />
              </FieldRow>
            </FieldGroup>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%", marginTop: "16px",
                background: BLUE, color: "#fff", border: "2px solid " + GOLD,
                borderRadius: "8px", padding: "12px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : "Save Trend"}
            </button>

            {trendsMap.has(selectedPlayer.Slug) && (
              <button
                onClick={handleRemove}
                disabled={removing}
                style={{
                  width: "100%", marginTop: "8px",
                  background: "#fff", color: "#c0392b", border: "2px solid #c0392b",
                  borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.06em", cursor: removing ? "default" : "pointer",
                  opacity: removing ? 0.6 : 1,
                }}
              >
                {removing ? "Removing..." : "Remove Trend"}
              </button>
            )}

            {saveMessage && (
              <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") || saveMessage.includes("Pick a") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return ts;
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

function toDateInputValue(d) {
  if (!d) return "";
  const dateObj = d?.toDate ? d.toDate() : d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return "";
  return dateObj.toISOString().slice(0, 10);
}

function PlayerSlugCombobox({ value, onChange, players }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const q = (value || "").trim().toLowerCase();
  const filtered = (q
    ? players.filter((p) => (p.First + " " + p.Last).toLowerCase().includes(q) || (p.Slug || "").toLowerCase().includes(q))
    : players
  ).slice(0, 8);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Type a name or paste a slug..."
        autoComplete="off"
        style={inputStyle}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
          background: "#fff", border: "2px solid #ddd", borderRadius: "6px",
          maxHeight: "220px", overflowY: "auto", boxShadow: "0 4px 14px rgba(0,0,0,0.14)",
        }}>
          {filtered.map((p) => (
            <div
              key={p.Slug}
              onClick={() => { onChange(p.Slug); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{p.First} {p.Last}</div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
                {p.Position || "—"} · {p.School || "—"} · {p.Slug}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const BLANK_VIDEO_ITEM = { slug: "", title: "", thumb: "" };

function VideosSection() {
  const [videos, setVideos] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [videosSnap, playersSnap] = await Promise.all([
          getDocs(collection(db, "videos")),
          getDocs(collection(db, "players")),
        ]);
        const vids = videosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        vids.sort((a, b) => toMs(b.Date) - toMs(a.Date));
        setVideos(vids);

        const players = playersSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.Slug);
        players.sort((a, b) => (a.Last || "").localeCompare(b.Last || ""));
        setAllPlayers(players);
      } catch (e) {
        console.error("Admin videos fetch error:", e);
        setVideos([]);
        setAllPlayers([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const playersBySlug = useMemo(() => {
    const map = new Map();
    allPlayers.forEach((p) => map.set(p.Slug, p));
    return map;
  }, [allPlayers]);

  const filtered = videos.filter((v) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const items = Array.isArray(v.items) ? v.items : [];
    return (
      (v.GenTitle || "").toLowerCase().includes(q) ||
      (v.Video || "").toLowerCase().includes(q) ||
      items.some((it) => (it.slug || "").toLowerCase().includes(q) || (it.title || "").toLowerCase().includes(q))
    );
  });

  const selectVideo = (v) => {
    setSelectedVideo(v);
    const items = Array.isArray(v.items) ? v.items : [];
    setFormState({
      Video: v.Video || "",
      Date: toDateInputValue(v.Date) || toDateInputValue(new Date()),
      GenTitle: v.GenTitle || "",
      GenThumb: v.GenThumb || "",
      items: [0, 1, 2].map((i) => ({
        slug: items[i]?.slug || "",
        title: items[i]?.title || "",
        thumb: items[i]?.thumb || "",
      })),
    });
    setSaveMessage("");
  };

  const startNewVideo = () => {
    setSelectedVideo({ id: null, isNew: true });
    setFormState({
      Video: "",
      Date: toDateInputValue(new Date()),
      GenTitle: "",
      GenThumb: "",
      items: [{ ...BLANK_VIDEO_ITEM }, { ...BLANK_VIDEO_ITEM }, { ...BLANK_VIDEO_ITEM }],
    });
    setSaveMessage("");
  };

  const handleFieldChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleItemChange = (index, field, value) => {
    setFormState((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, items };
    });
  };

  const isNew = selectedVideo?.isNew === true;

  const handleSave = async () => {
    if (!selectedVideo || !formState) return;
    if (!formState.Video.trim()) {
      setSaveMessage("A video URL is required.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const cleanedItems = formState.items
        .filter((it) => it.slug.trim())
        .map((it) => ({ slug: it.slug.trim(), title: it.title.trim(), thumb: it.thumb.trim() }));

      const payload = {
        Video: formState.Video.trim(),
        Date: formState.Date ? new Date(formState.Date) : new Date(),
        GenTitle: formState.GenTitle.trim(),
        GenThumb: formState.GenThumb.trim(),
        items: cleanedItems,
        slugs: cleanedItems.map((it) => it.slug),
        updatedAt: serverTimestamp(),
      };

      if (isNew) {
        const newRef = await addDoc(collection(db, "videos"), payload);
        const newVideo = { id: newRef.id, ...payload };
        setVideos((prev) => [newVideo, ...prev].sort((a, b) => toMs(b.Date) - toMs(a.Date)));
        setSelectedVideo(newVideo);
        setSaveMessage("Video created.");
      } else {
        await updateDoc(doc(db, "videos", selectedVideo.id), payload);
        setVideos((prev) =>
          prev.map((v) => (v.id === selectedVideo.id ? { ...v, ...payload } : v))
            .sort((a, b) => toMs(b.Date) - toMs(a.Date))
        );
        setSaveMessage("Saved.");
      }
    } catch (e) {
      console.error("Admin video save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedVideo || isNew) return;
    if (!window.confirm("Delete this video entry? This cannot be undone.")) return;
    setRemoving(true);
    setSaveMessage("");
    try {
      await deleteDoc(doc(db, "videos", selectedVideo.id));
      setVideos((prev) => prev.filter((v) => v.id !== selectedVideo.id));
      setSelectedVideo(null);
      setFormState(null);
      setSaveMessage("");
    } catch (e) {
      console.error("Admin video remove error:", e);
      setSaveMessage("Failed to remove — check console.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Videos
          </div>
          <button
            onClick={startNewVideo}
            style={{
              marginLeft: "auto", background: GOLD, color: "#fff", border: "none",
              borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            + Add Video
          </button>
        </div>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title, URL, player name, or slug..."
            style={{ width: "100%", border: "2px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {loading ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No videos match.</div>
        ) : (
          <div style={{ maxHeight: "640px", overflowY: "auto" }}>
            <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
              {filtered.length} video{filtered.length !== 1 ? "s" : ""}
            </div>
            {filtered.map((v) => {
              const isSelected = selectedVideo?.id === v.id;
              const items = Array.isArray(v.items) ? v.items : [];
              const displayTitle = v.GenTitle || items[0]?.title || "Untitled Video";
              const displayThumb = v.GenThumb || items[0]?.thumb || "";
              return (
                <div
                  key={v.id}
                  onClick={() => selectVideo(v)}
                  style={{
                    display: "flex", gap: "10px",
                    padding: "10px 14px", cursor: "pointer",
                    background: isSelected ? "#eaf1ff" : "#fff",
                    borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{ flexShrink: 0, width: "64px", height: "36px", borderRadius: "4px", background: "#111", overflow: "hidden" }}>
                    {displayThumb && (
                      <img src={displayThumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {displayTitle}
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#888", marginTop: "2px" }}>
                      {v.Date ? new Date(toMs(v.Date)).toLocaleDateString() : "No date"}
                    </div>
                    {items.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                        {items.map((it, i) => {
                          const p = playersBySlug.get(it.slug);
                          return (
                            <span key={i} style={{ fontSize: "10px", fontWeight: 700, color: "#666", background: "#f0f0f0", borderRadius: "8px", padding: "1px 7px" }}>
                              {p ? p.First + " " + p.Last : it.slug}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden", position: "sticky", top: "20px" }}>
        <div style={{ background: GOLD, padding: "10px 16px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {isNew ? "New Video" : selectedVideo ? "Edit Video" : "Select a Video"}
          </div>
        </div>

        {!selectedVideo || !formState ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click a video from the list to edit it, or "+ Add Video" to create one.
          </div>
        ) : (
          <div style={{ padding: "16px", maxHeight: "720px", overflowY: "auto" }}>
            <FieldGroup>
              <FieldRow label="Video URL">
                <input value={formState.Video} onChange={(e) => handleFieldChange("Video", e.target.value)} placeholder="https://youtu.be/..." style={inputStyle} />
              </FieldRow>
              <FieldRow label="Date">
                <input type="date" value={formState.Date} onChange={(e) => handleFieldChange("Date", e.target.value)} style={inputStyle} />
              </FieldRow>
              <FieldRow label="Generic Title (fallback if no player match)">
                <input value={formState.GenTitle} onChange={(e) => handleFieldChange("GenTitle", e.target.value)} placeholder="e.g. 2026 Impact Freshman RBs" style={inputStyle} />
              </FieldRow>
              <FieldRow label="Generic Thumbnail URL (fallback)">
                <input value={formState.GenThumb} onChange={(e) => handleFieldChange("GenThumb", e.target.value)} placeholder="https://..." style={inputStyle} />
              </FieldRow>
            </FieldGroup>

            <div style={{ height: "1px", background: "#eee", margin: "16px 0" }} />

            {[0, 1, 2].map((i) => (
              <div key={i} style={{ marginBottom: i < 2 ? "18px" : 0 }}>
                <div style={{ fontSize: "11px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                  Player {i + 1}
                </div>
                <FieldGroup>
                  <FieldRow label="Slug (search by name or paste directly)">
                    <PlayerSlugCombobox
                      value={formState.items[i].slug}
                      onChange={(v) => handleItemChange(i, "slug", v)}
                      players={allPlayers}
                    />
                  </FieldRow>
                  <FieldRow label="Title override">
                    <input value={formState.items[i].title} onChange={(e) => handleItemChange(i, "title", e.target.value)} placeholder="Shown on this player's page" style={inputStyle} />
                  </FieldRow>
                  <FieldRow label="Thumbnail URL">
                    <input value={formState.items[i].thumb} onChange={(e) => handleItemChange(i, "thumb", e.target.value)} placeholder="https://..." style={inputStyle} />
                  </FieldRow>
                </FieldGroup>
              </div>
            ))}

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%", marginTop: "18px",
                background: BLUE, color: "#fff", border: "2px solid " + GOLD,
                borderRadius: "8px", padding: "12px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : isNew ? "Create Video" : "Save Changes"}
            </button>

            {!isNew && (
              <button
                onClick={handleRemove}
                disabled={removing}
                style={{
                  width: "100%", marginTop: "8px",
                  background: "#fff", color: "#c0392b", border: "2px solid #c0392b",
                  borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.06em", cursor: removing ? "default" : "pointer",
                  opacity: removing ? 0.6 : 1,
                }}
              >
                {removing ? "Removing..." : "Delete Video"}
              </button>
            )}

            {saveMessage && (
              <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") || saveMessage.includes("required") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Analytics section — read-only dashboard pulling real numbers from
// Firestore. Evaluations live in a players/{playerId}/evaluations/{uid}
// subcollection (see PlayerProfile.js), so this reads via
// collectionGroup(db, "evaluations") — one query instead of iterating each
// player's subcollection individually. playerId is taken from the doc's
// parent path (d.ref.parent.parent.id) rather than the stored playerId
// field, since the path is correct even if that field is stale.
//
// This is reads only — no page-view/visit tracking exists yet, so
// "Active Users" style traffic metrics aren't derivable from current data.
// Everything below IS derivable from the players, evaluations, and users
// collections as they exist today. Write tracking is a separate follow-up. ──
function AnalyticsSection() {
  const [rangeDays, setRangeDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [allEvals, setAllEvals] = useState([]);
  const [totalUsers, setTotalUsers] = useState(null);
  const [totalPlayers, setTotalPlayers] = useState(null);
  const [fetchErrors, setFetchErrors] = useState([]);

  // ── Two evaluation copies exist per save: the canonical
  // players/{playerId}/evaluations/{uid} doc, and a mirrored
  // users/{uid}/evaluations/{playerId} doc (see PlayerProfile.js
  // handleSaveEvaluation — it writes both). Both subcollections are named
  // "evaluations", so collectionGroup() returns both copies of every eval
  // unless filtered. d.ref.parent.parent.parent.id is the top-level
  // collection two levels up from the doc — "players" for the canonical
  // copy, "users" for the mirror — so filtering on that keeps exactly one
  // copy per real evaluation. Promise.allSettled (not Promise.all) so one
  // failing query doesn't blank out the other two — and the failure gets
  // shown on screen instead of only logged to console. ──
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setFetchErrors([]);
      const errors = [];
      const [evalRes, usersRes, playersRes] = await Promise.allSettled([
        getDocs(collectionGroup(db, "evaluations")),
        getDocs(collection(db, "users")),
        getDocs(collection(db, "players")),
      ]);

      if (evalRes.status === "fulfilled") {
        const evals = evalRes.value.docs
          .filter((d) => d.ref.parent?.parent?.parent?.id === "players")
          .map((d) => {
            const data = d.data();
            const playerId = data.playerId || d.ref.parent.parent?.id || null;
            return {
              playerId,
              uid: data.uid || d.id,
              visibility: data.visibility || "public",
              grade: data.grade || "",
              updatedAtMs: toMs(data.updatedAt),
            };
          });
        setAllEvals(evals);
      } else {
        console.error("Admin analytics evaluations fetch error:", evalRes.reason);
        setAllEvals([]);
        errors.push("Evaluations: " + (evalRes.reason?.message || "read failed — likely missing a Firestore rule for collection-group reads on \"evaluations\"."));
      }

      if (usersRes.status === "fulfilled") {
        setTotalUsers(usersRes.value.size);
      } else {
        console.error("Admin analytics users fetch error:", usersRes.reason);
        setTotalUsers(null);
        errors.push("Users: " + (usersRes.reason?.message || "read failed."));
      }

      if (playersRes.status === "fulfilled") {
        setTotalPlayers(playersRes.value.size);
      } else {
        console.error("Admin analytics players fetch error:", playersRes.reason);
        setTotalPlayers(null);
        errors.push("Players: " + (playersRes.reason?.message || "read failed."));
      }

      setFetchErrors(errors);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const cutoffMs = useMemo(() => Date.now() - rangeDays * 24 * 60 * 60 * 1000, [rangeDays]);
  const evalsInRange = useMemo(() => allEvals.filter((e) => e.updatedAtMs >= cutoffMs), [allEvals, cutoffMs]);

  const totalEvaluations = allEvals.length;
  const publicEvaluations = allEvals.filter((e) => e.visibility === "public").length;
  const activeEvaluators = useMemo(() => new Set(evalsInRange.map((e) => e.uid)).size, [evalsInRange]);
  const playersWithEvals = useMemo(() => new Set(allEvals.map((e) => e.playerId).filter(Boolean)).size, [allEvals]);
  const avgPerPlayer = playersWithEvals > 0 ? (totalEvaluations / playersWithEvals).toFixed(1) : "0";

  const dailyCounts = useMemo(() => {
    const buckets = new Map();
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      buckets.set(d.getTime(), 0);
    }
    evalsInRange.forEach((e) => {
      const d = new Date(e.updatedAtMs);
      d.setHours(0, 0, 0, 0);
      const key = d.getTime();
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    });
    return Array.from(buckets.entries()).map(([ts, count]) => ({ ts, count }));
  }, [evalsInRange, rangeDays]);

  const maxCount = Math.max(1, ...dailyCounts.map((d) => d.count));

  const STAT_CARDS = [
    { label: "Total Evaluations", value: totalEvaluations },
    { label: "Public Evaluations", value: publicEvaluations },
    { label: "Active Evaluators", value: activeEvaluators, sub: "last " + rangeDays + "d" },
    { label: "Players Evaluated", value: totalPlayers != null ? (playersWithEvals + " / " + totalPlayers) : playersWithEvals },
    { label: "Avg Evals / Player", value: avgPerPlayer },
    { label: "Registered Users", value: totalUsers != null ? totalUsers : "—" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{
          background: BLUE, padding: "10px 16px",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Analytics
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setRangeDays(d)}
                style={{
                  padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  border: "2px solid " + GOLD, borderRadius: "20px", cursor: "pointer",
                  background: rangeDays === d ? GOLD : "transparent",
                  color: "#fff",
                  whiteSpace: "nowrap", transition: "background 0.15s",
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontSize: "12px", fontWeight: 700, color: "#999" }}>
          {loading
            ? "Loading live numbers from Firestore…"
            : "Read-only — pulled from the players, evaluations, and users collections. No page-view/visit tracking exists yet."}
        </div>

        {!loading && fetchErrors.length > 0 && (
          <div style={{ padding: "10px 16px", background: "#fff3f0", borderBottom: "2px solid #c0392b" }}>
            {fetchErrors.map((msg, i) => (
              <div key={i} style={{ fontSize: "12px", fontWeight: 700, color: "#a52a1e" }}>⚠ {msg}</div>
            ))}
          </div>
        )}

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1px", background: "#eee",
        }}>
          {STAT_CARDS.map((card) => (
            <div key={card.label} style={{ background: "#fff", padding: "18px 16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                {card.label}
              </div>
              <div style={{ fontSize: "26px", fontWeight: 900, color: BLUE }}>
                {loading ? "—" : card.value}
              </div>
              {card.sub && (
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#bbb", marginTop: "4px" }}>
                  {card.sub}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: GOLD, padding: "10px 16px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Evaluations Saved — Last {rangeDays} Days
          </div>
        </div>
        <div style={{ padding: "20px 16px" }}>
          {loading ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>Loading…</div>
          ) : dailyCounts.every((d) => d.count === 0) ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
              No evaluations saved in this range yet.
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: rangeDays > 30 ? "1px" : "3px", height: "160px" }}>
              {dailyCounts.map((d) => {
                const h = Math.max(2, (d.count / maxCount) * 150);
                const dateLabel = new Date(d.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                return (
                  <div
                    key={d.ts}
                    title={dateLabel + ": " + d.count + " evaluation" + (d.count !== 1 ? "s" : "")}
                    style={{
                      flex: 1, height: h + "px", background: BLUE, borderRadius: "2px 2px 0 0",
                      minWidth: rangeDays > 60 ? "2px" : "4px",
                    }}
                  />
                );
              })}
            </div>
          )}
          {!loading && dailyCounts.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "10px", fontWeight: 700, color: "#aaa" }}>
              <span>{new Date(dailyCounts[0].ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span>{new Date(dailyCounts[dailyCounts.length - 1].ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </div>
          )}
        </div>
      </div>

      <PlayerEvaluationsTable />
    </div>
  );
}

// ── Players + Evaluations table — same filter pattern as Player Data
// (search, School dropdown, Eligible Year, Position bar; 2026 excluded by
// default), but read-only and joined against a per-player evaluation
// summary instead of an edit form. Same join-key reasoning as
// AnalyticsSection above (d.ref.parent.parent.id). Columns are sortable
// by clicking the header. ──
function PlayerEvaluationsTable() {
  const [allPlayers, setAllPlayers] = useState([]);
  const [statsByPlayer, setStatsByPlayer] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYears, setSelectedYears] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [sortKey, setSortKey] = useState("count");
  const [sortDir, setSortDir] = useState("desc");
  const [fetchErrors, setFetchErrors] = useState([]);

  useEffect(() => {
    const fetchSchools = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const names = snap.docs.map((d) => d.data().School).filter(Boolean).sort();
        setSchoolOptions(names);
      } catch (e) {
        setSchoolOptions([]);
      }
    };
    fetchSchools();
  }, []);

  // ── Same canonical-copy filtering as AnalyticsSection: evaluations are
  // written to both players/{playerId}/evaluations/{uid} (canonical) and a
  // mirrored users/{uid}/evaluations/{playerId} doc, both collections named
  // "evaluations" — collectionGroup() returns both unless filtered down to
  // the players-rooted copy via d.ref.parent.parent.parent.id. Promise
  // .allSettled so a failed evaluations read still lets the player list
  // render (with zeroed stats) instead of blanking the whole table, and the
  // failure is shown on screen rather than only logged. ──
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setFetchErrors([]);
      const errors = [];
      const [playersRes, evalRes] = await Promise.allSettled([
        getDocs(collection(db, "players")),
        getDocs(collectionGroup(db, "evaluations")),
      ]);

      if (playersRes.status === "fulfilled") {
        const players = playersRes.value.docs.map((d) => ({ id: d.id, ...d.data() }));
        players.sort((a, b) => (a.Last || "").localeCompare(b.Last || ""));
        setAllPlayers(players);
      } else {
        console.error("Admin player-evaluations players fetch error:", playersRes.reason);
        setAllPlayers([]);
        errors.push("Players: " + (playersRes.reason?.message || "read failed."));
      }

      if (evalRes.status === "fulfilled") {
        const map = new Map();
        evalRes.value.docs
          .filter((d) => d.ref.parent?.parent?.parent?.id === "players")
          .forEach((d) => {
            const data = d.data();
            const playerId = data.playerId || d.ref.parent.parent?.id;
            if (!playerId) return;
            const entry = map.get(playerId) || { count: 0, publicCount: 0, grades: [], lastUpdatedMs: 0 };
            entry.count += 1;
            if ((data.visibility || "public") === "public") entry.publicCount += 1;
            if (data.grade && gradeScale[data.grade] != null) entry.grades.push(gradeScale[data.grade]);
            const ms = toMs(data.updatedAt);
            if (ms > entry.lastUpdatedMs) entry.lastUpdatedMs = ms;
            map.set(playerId, entry);
          });
        setStatsByPlayer(map);
      } else {
        console.error("Admin player-evaluations evaluations fetch error:", evalRes.reason);
        setStatsByPlayer(new Map());
        errors.push("Evaluations: " + (evalRes.reason?.message || "read failed — likely missing a Firestore rule for collection-group reads on \"evaluations\"."));
      }

      setFetchErrors(errors);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const allPositions = useMemo(() => {
    const pool = allPlayers.filter((p) => {
      if (selectedYears.length === 0) return p.Eligible !== "2026";
      return selectedYears.includes(p.Eligible);
    });
    const set = [...new Set(pool.map((p) => p.Position).filter(Boolean))];
    return set.sort((a, b) => {
      const ai = POSITION_ORDER.indexOf(a);
      const bi = POSITION_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [allPlayers, selectedYears]);

  const rows = useMemo(() => {
    const filtered = allPlayers.filter((p) => {
      if (selectedYears.length === 0) {
        if (p.Eligible === "2026") return false;
      } else {
        if (!selectedYears.includes(p.Eligible)) return false;
      }
      if (selectedPositions.length > 0 && !selectedPositions.includes(p.Position)) return false;
      if (selectedSchools.length > 0 && !selectedSchools.includes(p.School)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matches =
          ((p.First || "") + " " + (p.Last || "")).toLowerCase().includes(q) ||
          (p.School || "").toLowerCase().includes(q) ||
          (p.Slug || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });

    const withStats = filtered.map((p) => {
      const stats = statsByPlayer.get(p.id) || { count: 0, publicCount: 0, grades: [], lastUpdatedMs: 0 };
      const avgGrade = stats.grades.length > 0
        ? stats.grades.reduce((a, b) => a + b, 0) / stats.grades.length
        : null;
      const avgGradeLabel = avgGrade != null ? gradeLabels[Math.round(avgGrade)] : null;
      return {
        ...p,
        evalCount: stats.count,
        publicCount: stats.publicCount,
        privateCount: stats.count - stats.publicCount,
        avgGradeLabel,
        lastUpdatedMs: stats.lastUpdatedMs,
      };
    });

    withStats.sort((a, b) => {
      let av, bv;
      if (sortKey === "name") { av = a.Last || ""; bv = b.Last || ""; }
      else if (sortKey === "grade") { av = a.avgGradeLabel ? gradeScale[a.avgGradeLabel] : 99; bv = b.avgGradeLabel ? gradeScale[b.avgGradeLabel] : 99; }
      else if (sortKey === "updated") { av = a.lastUpdatedMs; bv = b.lastUpdatedMs; }
      else { av = a.evalCount; bv = b.evalCount; }
      if (typeof av === "string") {
        const cmp = av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });

    return withStats;
  }, [allPlayers, statsByPlayer, selectedYears, selectedPositions, selectedSchools, searchQuery, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortHeader = ({ label, sortId, align }) => (
    <th
      onClick={() => toggleSort(sortId)}
      style={{
        padding: "9px 10px", cursor: "pointer", userSelect: "none",
        fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase",
        letterSpacing: "0.06em", textAlign: align || "left", whiteSpace: "nowrap",
      }}
    >
      {label}{sortKey === sortId ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "10px 16px" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Players &amp; Evaluations
        </div>
      </div>

      <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee", display: "flex", flexDirection: "column", gap: "10px" }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search name, school, or slug..."
          style={{ width: "100%", border: "2px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-start" }}>
          <DropdownChecklist title="School" options={schoolOptions} selected={selectedSchools} setSelected={setSelectedSchools} />
        </div>
        <div>
          <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>
            Eligible Year
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {[...ACTIVE_YEARS, "2026"].map((yr) => {
              const isArchive = yr === "2026";
              const active = selectedYears.includes(yr);
              return (
                <button
                  key={yr}
                  onClick={() => setSelectedYears((prev) => prev.includes(yr) ? prev.filter((y) => y !== yr) : [...prev, yr])}
                  title={isArchive ? "2026 — completed draft class, not shown by default" : undefined}
                  style={{
                    padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                    border: "2px solid " + (isArchive ? "#7a5c00" : GOLD), borderRadius: "20px", cursor: "pointer",
                    background: active ? (isArchive ? "#7a5c00" : BLUE) : "#fff",
                    color: active ? "#fff" : (isArchive ? "#7a5c00" : BLUE),
                    whiteSpace: "nowrap", transition: "background 0.15s, color 0.15s",
                  }}
                >
                  {isArchive ? "📦 2026" : yr}
                </button>
              );
            })}
          </div>
        </div>
        <FilterBar label="Position" options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
      </div>

      {!loading && fetchErrors.length > 0 && (
        <div style={{ padding: "10px 16px", background: "#fff3f0", borderBottom: "2px solid #c0392b" }}>
          {fetchErrors.map((msg, i) => (
            <div key={i} style={{ fontSize: "12px", fontWeight: 700, color: "#a52a1e" }}>⚠ {msg}</div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No players match.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
            {rows.length} player{rows.length !== 1 ? "s" : ""}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: BLUE }}>
                <SortHeader label="Player" sortId="name" />
                <th style={{ padding: "9px 10px", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap" }}>Pos</th>
                <th style={{ padding: "9px 10px", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap" }}>School</th>
                <th style={{ padding: "9px 10px", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap" }}>Year</th>
                <SortHeader label="Evals" sortId="count" align="center" />
                <th style={{ padding: "9px 10px", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center", whiteSpace: "nowrap" }}>Pub / Priv</th>
                <SortHeader label="Avg Grade" sortId="grade" align="center" />
                <SortHeader label="Last Updated" sortId="updated" align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const gd = p.avgGradeLabel ? gradeBadgeInfo(p.avgGradeLabel) : null;
                return (
                  <tr
                    key={p.id}
                    style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc", borderBottom: "1px solid #f0f0f0" }}
                  >
                    <td style={{ padding: "9px 10px", fontWeight: 900, fontSize: "13px", color: BLUE, whiteSpace: "nowrap" }}>
                      {(p.First || "") + " " + (p.Last || "")}
                      {p.Live === false && (
                        <span style={{ marginLeft: "6px", fontSize: "8px", fontWeight: 900, color: "#c0392b", border: "1px solid #c0392b", borderRadius: "10px", padding: "1px 5px" }}>
                          HIDDEN
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "9px 10px", fontSize: "12px", fontWeight: 700, color: "#666" }}>{p.Position || "—"}</td>
                    <td style={{ padding: "9px 10px", fontSize: "12px", fontWeight: 700, color: "#666" }}>{p.School || "—"}</td>
                    <td style={{ padding: "9px 10px", fontSize: "12px", fontWeight: 700, color: "#666" }}>{p.Eligible || "—"}</td>
                    <td style={{ padding: "9px 10px", fontSize: "13px", fontWeight: 900, color: p.evalCount > 0 ? BLUE : "#ccc", textAlign: "center" }}>{p.evalCount}</td>
                    <td style={{ padding: "9px 10px", fontSize: "11px", fontWeight: 700, color: "#888", textAlign: "center" }}>
                      {p.evalCount > 0 ? (p.publicCount + " / " + p.privateCount) : "—"}
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "center" }}>
                      {gd ? (
                        <span style={{
                          display: "inline-block", fontSize: "10px", fontWeight: 900, color: "#fff",
                          background: gd.bg, border: "1px solid " + gd.border, borderRadius: "10px", padding: "2px 8px",
                        }}>
                          {gd.short}
                        </span>
                      ) : (
                        <span style={{ fontSize: "11px", color: "#ccc" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 10px", fontSize: "11px", fontWeight: 700, color: "#999", textAlign: "right", whiteSpace: "nowrap" }}>
                      {p.lastUpdatedMs > 0 ? new Date(p.lastUpdatedMs).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%", border: "2px solid #ddd", borderRadius: "6px",
  padding: "8px 10px", fontWeight: 700, fontSize: "13px",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};

function FieldGroup({ children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>{children}</div>;
}

function FieldRow({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export default function AdminPanel() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState("players");

  return (
    <>
      <Helmet>
        <title>Admin | We-Draft.com</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "24px 24px 80px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "28px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Admin Panel
          </div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#888", marginTop: "2px" }}>
            Signed in as {user?.email || "—"}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "20px", alignItems: "start" }}>
          <div style={{ position: "sticky", top: "20px" }}>
            <SidebarNav active={activeSection} setActive={setActiveSection} />
          </div>

          <div>
            {activeSection === "players" && <PlayerDataSection />}
            {activeSection === "trends" && <TrendsSection />}
            {activeSection === "videos" && <VideosSection />}
            {activeSection === "analytics" && <AnalyticsSection />}
            {activeSection === "content" && <ComingSoonPane label="Content Management" />}
            {activeSection === "sync" && <ComingSoonPane label="Sync / System Status" />}
            {activeSection === "ads" && <ComingSoonPane label="Ads Management" />}
          </div>
        </div>
      </div>
    </>
  );
}