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

const FLAG_COLORS = [
  { key: "red", hex: "#c0392b" },
  { key: "green", hex: "#2e7d32" },
  { key: "blue", hex: "#1565c0" },
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
  Height: "", Weight: "", Flair: "", Live: true, AdminNotes: "", Flag: "",
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
  { key: "branding", label: "Branding", icon: "🎨", ready: true },
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
  const [selectedFlags, setSelectedFlags] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [duplicateMatches, setDuplicateMatches] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    if (selectedFlags.length > 0 && !selectedFlags.includes(p.Flag)) return false;
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
      Flag: p.Flag || "",
    });
    setSaveMessage("");
    setDuplicateMatches(null);
    setConfirmDelete(false);
  };

  const startNewPlayer = () => {
    setSelectedPlayer({ id: null, isNew: true });
    setFormState({ ...BLANK_PLAYER_FORM });
    setSaveMessage("");
    setDuplicateMatches(null);
    setConfirmDelete(false);
  };

  const handleFieldChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    // Editing the name after a duplicate warning was shown invalidates that
    // check — force it to re-run against the new value on the next save
    // attempt rather than trusting a match found for the old name.
    setDuplicateMatches(null);
  };

  const previewSlug = useMemo(() => {
    if (!formState) return "";
    return generateSlug(formState.First, formState.Last, formState.Position, formState.Eligible);
  }, [formState]);

  const isNew = selectedPlayer?.isNew === true;

  // ── Same-name check runs against the already-loaded `allPlayers` list
  // (no extra Firestore read needed) rather than the Slug, since two
  // different real players can share a name — Slug already disambiguates
  // by position/year, so this is specifically about catching an admin
  // re-adding someone who's already in the system under a different
  // position/year/school by mistake. ──
  const findNameMatches = (first, last) => {
    const normFirst = first.trim().toLowerCase();
    const normLast = last.trim().toLowerCase();
    return allPlayers.filter(
      (p) => (p.First || "").trim().toLowerCase() === normFirst && (p.Last || "").trim().toLowerCase() === normLast
    );
  };

  const handleSave = async (forceDuplicate = false) => {
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

      if (!forceDuplicate) {
        const matches = findNameMatches(formState.First, formState.Last);
        if (matches.length > 0) {
          setDuplicateMatches(matches);
          setSaveMessage("");
          return;
        }
      }
      setDuplicateMatches(null);

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

  // ── Delete requires an explicit in-panel confirmation step (setConfirmDelete)
  // rather than a native window.confirm(), matching the duplicate-name
  // check's pattern — clicking "Delete Player" only reveals the warning;
  // the actual deleteDoc only runs from the "Yes, Delete Permanently" button. ──
  const handleDelete = async () => {
    if (!selectedPlayer || isNew) return;
    setRemoving(true);
    setSaveMessage("");
    try {
      // Clean up the player's own evaluations subcollection first — leaving
      // it behind would keep counting toward site-wide averages via
      // collectionGroup(db, "evaluations") queries elsewhere in the admin
      // panel even after the player itself is gone.
      const evalSnap = await getDocs(collection(db, "players", selectedPlayer.id, "evaluations"));
      await Promise.all(evalSnap.docs.map((d) => deleteDoc(d.ref)));

      await deleteDoc(doc(db, "players", selectedPlayer.id));
      setAllPlayers((prev) => prev.filter((p) => p.id !== selectedPlayer.id));
      setSelectedPlayer(null);
      setFormState(null);
      setConfirmDelete(false);
      setSaveMessage("");
    } catch (e) {
      console.error("Admin player delete error:", e);
      setSaveMessage("Failed to delete — check console.");
    } finally {
      setRemoving(false);
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
          <div>
            <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px" }}>
              Flag
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {FLAG_COLORS.map((f) => {
                const active = selectedFlags.includes(f.key);
                return (
                  <button
                    key={f.key}
                    onClick={() => setSelectedFlags((prev) => prev.includes(f.key) ? prev.filter((x) => x !== f.key) : [...prev, f.key])}
                    title={f.key + " flag"}
                    style={{
                      width: "26px", height: "26px", borderRadius: "50%", cursor: "pointer",
                      background: f.hex, border: active ? "3px solid #333" : "3px solid transparent",
                      boxShadow: active ? "none" : "0 0 0 1px #ddd",
                    }}
                  />
                );
              })}
            </div>
          </div>
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
                      {p.Flag && (
                        <span
                          title={p.Flag + " flag"}
                          style={{
                            display: "inline-block", width: "9px", height: "9px", borderRadius: "50%",
                            marginRight: "7px", background: (FLAG_COLORS.find((f) => f.key === p.Flag) || {}).hex || "#999",
                          }}
                        />
                      )}
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
              <FieldRow label="Flag">
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {FLAG_COLORS.map((f) => {
                    const active = formState.Flag === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => handleFieldChange("Flag", active ? "" : f.key)}
                        title={f.key + " flag"}
                        style={{
                          width: "28px", height: "28px", borderRadius: "50%", cursor: "pointer",
                          background: f.hex, border: active ? "3px solid #333" : "3px solid transparent",
                          boxShadow: active ? "none" : "0 0 0 1px #ddd",
                        }}
                      />
                    );
                  })}
                  {formState.Flag && (
                    <button
                      type="button"
                      onClick={() => handleFieldChange("Flag", "")}
                      style={{
                        background: "none", border: "none", color: "#999", cursor: "pointer",
                        fontWeight: 700, fontSize: "12px", textDecoration: "underline",
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
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

            {duplicateMatches && duplicateMatches.length > 0 ? (
              <div style={{ marginTop: "16px", border: "2px solid #c0392b", borderRadius: "8px", padding: "12px", background: "#fff3f0" }}>
                <div style={{ fontWeight: 900, fontSize: "12px", color: "#a52a1e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>
                  ⚠ Possible Duplicate — {duplicateMatches.length} existing player{duplicateMatches.length !== 1 ? "s" : ""} named "{formState.First} {formState.Last}"
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
                  {duplicateMatches.map((m) => (
                    <div key={m.id} style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>
                      {m.Position || "—"} · {m.School || "—"} · {m.Eligible || "—"}
                      {m.Slug && (
                        <a
                          href={"/player/" + m.Slug} target="_blank" rel="noopener noreferrer"
                          style={{ marginLeft: "8px", color: BLUE, fontWeight: 900, textDecoration: "none" }}
                        >
                          View ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => setDuplicateMatches(null)}
                    style={{
                      flex: 1, background: "#fff", color: "#666", border: "2px solid #ddd",
                      borderRadius: "6px", padding: "10px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={saving}
                    style={{
                      flex: 1, background: "#c0392b", color: "#fff", border: "2px solid #a52a1e",
                      borderRadius: "6px", padding: "10px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.04em", cursor: saving ? "default" : "pointer",
                      opacity: saving ? 0.6 : 1,
                    }}
                  >
                    {saving ? "Creating..." : "Yes, Create Anyway"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => handleSave()}
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
            )}
            {saveMessage && (
              <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") || saveMessage.includes("required") || saveMessage.includes("already in use") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}

            {!isNew && (
              <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
                {confirmDelete ? (
                  <div style={{ border: "2px solid #c0392b", borderRadius: "8px", padding: "12px", background: "#fff3f0" }}>
                    <div style={{ fontWeight: 900, fontSize: "12px", color: "#a52a1e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>
                      ⚠ Permanently delete {(selectedPlayer.First || "") + " " + (selectedPlayer.Last || "")}?
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#666", marginBottom: "12px" }}>
                      This removes the player record and their evaluations, and cannot be undone.
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        disabled={removing}
                        style={{
                          flex: 1, background: "#fff", color: "#666", border: "2px solid #ddd",
                          borderRadius: "6px", padding: "10px", fontWeight: 900, fontSize: "12px",
                          textTransform: "uppercase", letterSpacing: "0.04em", cursor: removing ? "default" : "pointer",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={removing}
                        style={{
                          flex: 1, background: "#c0392b", color: "#fff", border: "2px solid #a52a1e",
                          borderRadius: "6px", padding: "10px", fontWeight: 900, fontSize: "12px",
                          textTransform: "uppercase", letterSpacing: "0.04em", cursor: removing ? "default" : "pointer",
                          opacity: removing ? 0.6 : 1,
                        }}
                      >
                        {removing ? "Deleting..." : "Yes, Delete Permanently"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    style={{
                      width: "100%", background: "#fff", color: "#c0392b", border: "2px solid #c0392b",
                      borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                    }}
                  >
                    Delete Player
                  </button>
                )}
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

const RANGE_OPTIONS = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
  { days: 365, label: "1Y" },
];

// Same four rolling windows as RANGE_OPTIONS plus an "All Time" choice —
// used by the Players & Evaluations table, which (unlike the chart above)
// has a real all-time figure to fall back on for both evals and views.
// `days: null` is the sentinel for that no-cutoff case.
const TABLE_RANGE_OPTIONS = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
  { days: 365, label: "1Y" },
  { days: null, label: "All Time" },
];

// Maps a TABLE_RANGE_OPTIONS.days value to the matching field on
// analytics/{slug}.pageViews, written by scripts/syncGoogleAnalytics.js.
const VIEW_FIELD_BY_RANGE_DAYS = {
  7: "last7Days",
  30: "last30Days",
  90: "last90Days",
  365: "lastYear",
};

// Buckets a list of ms timestamps into one count per day over the last
// `rangeDays` days (oldest first) — shared by every daily bar chart below.
function bucketDaily(msList, rangeDays) {
  const buckets = new Map();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    buckets.set(d.getTime(), 0);
  }
  msList.forEach((ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  });
  return Array.from(buckets.entries()).map(([ts, count]) => ({ ts, count }));
}

function DailyBarChart({ dailyCounts, rangeDays, loading, color, emptyLabel, unitLabel }) {
  const maxCount = Math.max(1, ...dailyCounts.map((d) => d.count));
  return (
    <div style={{ padding: "20px 16px" }}>
      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>Loading…</div>
      ) : dailyCounts.every((d) => d.count === 0) ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
          {emptyLabel}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: rangeDays > 30 ? "1px" : "3px", height: "160px" }}>
          {dailyCounts.map((d) => {
            const h = Math.max(2, (d.count / maxCount) * 150);
            const dateLabel = new Date(d.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            return (
              <div
                key={d.ts}
                title={dateLabel + ": " + d.count + " " + unitLabel + (d.count !== 1 ? "s" : "")}
                style={{
                  flex: 1, height: h + "px", background: color, borderRadius: "2px 2px 0 0",
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
  );
}

function toDateInputValue(d) {
  if (!d) return "";
  const dateObj = d?.toDate ? d.toDate() : d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return "";
  return dateObj.toISOString().slice(0, 10);
}

// ── Player lookup — search by name, connect by ID. Unlike the old
// PlayerSlugCombobox this replaced, the input never displays or accepts the
// connected value directly (an ID isn't something an admin would ever type
// or recognize) — it holds its own search text, shows the selected player's
// name when idle, and only ever calls onChange with a player's doc ID,
// picked from the dropdown. No free-text fallback. ──
function PlayerLookupCombobox({ playerId, onChange, players }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = players.find((p) => p.id === playerId) || null;
  const displayValue = open ? query : (selected ? selected.First + " " + selected.Last : "");

  const q = query.trim().toLowerCase();
  const filtered = (q
    ? players.filter((p) => (p.First + " " + p.Last).toLowerCase().includes(q))
    : players
  ).slice(0, 8);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          value={displayValue}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          placeholder="Search player by name..."
          autoComplete="off"
          style={{ ...inputStyle, flex: 1 }}
        />
        {selected && !open && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Clear"
            style={{
              flexShrink: 0, width: "26px", height: "26px", borderRadius: "6px",
              border: "2px solid #ddd", background: "#fff", color: "#999",
              fontWeight: 900, fontSize: "13px", cursor: "pointer",
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
          background: "#fff", border: "2px solid #ddd", borderRadius: "6px",
          maxHeight: "220px", overflowY: "auto", boxShadow: "0 4px 14px rgba(0,0,0,0.14)",
        }}>
          {filtered.map((p) => (
            <div
              key={p.id}
              onClick={() => { onChange(p.id); setQuery(""); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{p.First} {p.Last}</div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
                {p.Position || "—"} · {p.School || "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const BLANK_VIDEO_ITEM = { playerId: "", title: "", thumb: "" };

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
  const [migrating, setMigrating] = useState(false);
  const [migrateMessage, setMigrateMessage] = useState("");

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

  const playersById = useMemo(() => {
    const map = new Map();
    allPlayers.forEach((p) => map.set(p.id, p));
    return map;
  }, [allPlayers]);

  const filtered = videos.filter((v) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const items = Array.isArray(v.items) ? v.items : [];
    return (
      (v.GenTitle || "").toLowerCase().includes(q) ||
      (v.Video || "").toLowerCase().includes(q) ||
      items.some((it) => {
        const p = playersById.get(it.playerId);
        return (p && (p.First + " " + p.Last).toLowerCase().includes(q)) || (it.title || "").toLowerCase().includes(q);
      })
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
        playerId: items[i]?.playerId || "",
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
        .filter((it) => it.playerId)
        .map((it) => ({ playerId: it.playerId, title: it.title.trim(), thumb: it.thumb.trim() }));

      const payload = {
        Video: formState.Video.trim(),
        Date: formState.Date ? new Date(formState.Date) : new Date(),
        GenTitle: formState.GenTitle.trim(),
        GenThumb: formState.GenThumb.trim(),
        items: cleanedItems,
        playerIds: cleanedItems.map((it) => it.playerId),
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

  // ── One-time migration for videos saved before the playerId schema —
  // resolves each legacy item's `slug` against the currently-loaded player
  // list and rewrites `items`/`playerIds` in place. Additive only: the old
  // `slugs` field on the doc is left untouched rather than deleted, and any
  // doc whose slug no longer matches a real player (e.g. a since-deleted
  // player) is skipped and reported rather than silently dropped. ──
  const migrateLegacyVideos = async () => {
    setMigrating(true);
    setMigrateMessage("");
    const slugToId = new Map(allPlayers.map((p) => [p.Slug, p.id]));
    const unresolved = new Set();
    let migratedCount = 0;
    try {
      const legacy = videos.filter((v) =>
        !Array.isArray(v.playerIds) &&
        Array.isArray(v.items) &&
        v.items.some((it) => it.slug && !it.playerId)
      );

      for (const v of legacy) {
        const items = v.items
          .map((it) => {
            if (it.playerId) return it;
            const id = slugToId.get(it.slug);
            if (!id) { if (it.slug) unresolved.add(it.slug); return null; }
            return { playerId: id, title: it.title || "", thumb: it.thumb || "" };
          })
          .filter(Boolean);
        if (items.length === 0) continue;
        await updateDoc(doc(db, "videos", v.id), {
          items,
          playerIds: items.map((it) => it.playerId),
          updatedAt: serverTimestamp(),
        });
        migratedCount++;
      }

      setVideos((prev) => prev.map((v) => {
        const match = legacy.find((lv) => lv.id === v.id);
        if (!match) return v;
        const items = match.items
          .map((it) => (it.playerId ? it : (slugToId.get(it.slug) ? { playerId: slugToId.get(it.slug), title: it.title || "", thumb: it.thumb || "" } : null)))
          .filter(Boolean);
        return items.length > 0 ? { ...v, items, playerIds: items.map((it) => it.playerId) } : v;
      }));

      setMigrateMessage(
        migratedCount + " video" + (migratedCount !== 1 ? "s" : "") + " migrated to player IDs." +
        (unresolved.size > 0 ? " Unresolved slugs (no matching player): " + Array.from(unresolved).join(", ") : "")
      );
    } catch (e) {
      console.error("Admin video migration error:", e);
      setMigrateMessage("Migration failed — check console.");
    } finally {
      setMigrating(false);
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
            onClick={migrateLegacyVideos}
            disabled={migrating || loading}
            title="Backfill playerIds on videos still using the old slug-only schema"
            style={{
              marginLeft: "auto", background: "transparent", color: "#fff", border: "2px solid #fff",
              borderRadius: "6px", padding: "5px 11px", fontWeight: 900, fontSize: "11px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: migrating || loading ? "default" : "pointer",
              opacity: migrating || loading ? 0.6 : 1,
            }}
          >
            {migrating ? "Migrating..." : "Migrate Legacy Videos"}
          </button>
          <button
            onClick={startNewVideo}
            style={{
              background: GOLD, color: "#fff", border: "none",
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
            placeholder="Search title, URL, or player name..."
            style={{ width: "100%", border: "2px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        {migrateMessage && (
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #eee", fontSize: "12px", fontWeight: 700, color: "#555" }}>
            {migrateMessage}
          </div>
        )}

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
                          const p = playersById.get(it.playerId);
                          return (
                            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: 700, color: "#666", background: "#f0f0f0", borderRadius: "8px", padding: "1px 7px" }}>
                              {p ? p.First + " " + p.Last : "Unmigrated player"}
                              {p?.Slug && (
                                <a
                                  href={"/player/" + p.Slug}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Open player page in a new tab"
                                  style={{ color: BLUE, textDecoration: "none", fontWeight: 900 }}
                                >
                                  ↗
                                </a>
                              )}
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
                  <FieldRow label="Player">
                    <PlayerLookupCombobox
                      playerId={formState.items[i].playerId}
                      onChange={(v) => handleItemChange(i, "playerId", v)}
                      players={allPlayers}
                    />
                    {(() => {
                      const p = playersById.get(formState.items[i].playerId);
                      return p?.Slug ? (
                        <a
                          href={"/player/" + p.Slug}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-block", marginTop: "6px", fontSize: "11px", fontWeight: 800, color: BLUE, textDecoration: "none" }}
                        >
                          View player page ↗
                        </a>
                      ) : null;
                    })()}
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
// Page views come from the `analytics` collection — populated separately by
// scripts/syncGoogleAnalytics.js (a daily GitHub Actions cron pulling from
// GA4), keyed by player Slug. This section only reads it; it doesn't
// trigger a sync. "Last synced" is the max updatedAt across all analytics
// docs, so a stale/broken cron job is visible here rather than silent.
//
// Signups come from users/{uid}.createdAt, stamped by AuthContext.js at
// first sign-in for every provider (including Google, which never wrote a
// profile doc otherwise). Accounts created before that write existed won't
// have createdAt and are excluded from the New Accounts chart rather than
// miscounted.
//
// One chart panel, not two — chartMetric toggles which series (Evaluations
// vs. New Accounts) DailyBarChart renders; both share the same rangeDays.
// Page views aren't part of that toggle since the analytics docs only store
// four fixed rolling windows (24h/7d/30d/total), not a daily-granularity
// history, so there's no per-day series to plot. ──
function AnalyticsSection() {
  const [rangeDays, setRangeDays] = useState(7);
  const [chartMetric, setChartMetric] = useState("evaluations");
  const [loading, setLoading] = useState(true);
  const [allEvals, setAllEvals] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [pageViewTotals, setPageViewTotals] = useState({ last24: 0, last7: 0, last30: 0, total: 0, lastSyncedMs: 0, playerCount: 0 });
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
  // failing query doesn't blank out the others — and the failure gets shown
  // on screen instead of only logged to console. ──
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setFetchErrors([]);
      const errors = [];
      const [evalRes, usersRes, analyticsRes] = await Promise.allSettled([
        getDocs(collectionGroup(db, "evaluations")),
        getDocs(collection(db, "users")),
        getDocs(collection(db, "analytics")),
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
        const users = usersRes.value.docs.map((d) => ({ id: d.id, createdAtMs: toMs(d.data().createdAt) }));
        setAllUsers(users);
      } else {
        console.error("Admin analytics users fetch error:", usersRes.reason);
        setAllUsers([]);
        errors.push("Users: " + (usersRes.reason?.message || "read failed."));
      }

      if (analyticsRes.status === "fulfilled") {
        let last24 = 0, last7 = 0, last30 = 0, total = 0, lastSyncedMs = 0;
        analyticsRes.value.docs.forEach((d) => {
          const data = d.data();
          const pv = data.pageViews || {};
          last24 += Number(pv.last24Hours) || 0;
          last7 += Number(pv.last7Days) || 0;
          last30 += Number(pv.last30Days) || 0;
          total += Number(pv.total) || 0;
          const ms = toMs(data.updatedAt);
          if (ms > lastSyncedMs) lastSyncedMs = ms;
        });
        setPageViewTotals({ last24, last7, last30, total, lastSyncedMs, playerCount: analyticsRes.value.docs.length });
      } else {
        console.error("Admin analytics page-views fetch error:", analyticsRes.reason);
        setPageViewTotals({ last24: 0, last7: 0, last30: 0, total: 0, lastSyncedMs: 0, playerCount: 0 });
        errors.push("Page Views: " + (analyticsRes.reason?.message || "read failed."));
      }

      setFetchErrors(errors);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const cutoffMs = useMemo(() => Date.now() - rangeDays * 24 * 60 * 60 * 1000, [rangeDays]);
  const evalsInRange = useMemo(() => allEvals.filter((e) => e.updatedAtMs >= cutoffMs), [allEvals, cutoffMs]);
  const signupsInRange = useMemo(() => allUsers.filter((u) => u.createdAtMs >= cutoffMs), [allUsers, cutoffMs]);

  const activeEvaluators = useMemo(() => new Set(evalsInRange.map((e) => e.uid)).size, [evalsInRange]);
  const totalUsers = allUsers.length;

  const evalDailyCounts = useMemo(
    () => bucketDaily(evalsInRange.map((e) => e.updatedAtMs), rangeDays),
    [evalsInRange, rangeDays]
  );
  const signupDailyCounts = useMemo(
    () => bucketDaily(signupsInRange.map((u) => u.createdAtMs), rangeDays),
    [signupsInRange, rangeDays]
  );

  const STAT_CARDS = [
    { label: "Active Evaluators", value: activeEvaluators, sub: "last " + rangeDays + "d" },
    { label: "New Accounts", value: signupsInRange.length, sub: "last " + rangeDays + "d" },
    { label: "Registered Users", value: totalUsers },
  ];

  const rangeLabel = (RANGE_OPTIONS.find((o) => o.days === rangeDays) || {}).label || rangeDays + "d";

  const CHART_METRICS = [
    {
      key: "evaluations", label: "Evaluations", title: "Evaluations Saved", color: BLUE,
      unitLabel: "evaluation", emptyLabel: "No evaluations saved in this range yet.",
      dailyCounts: evalDailyCounts,
    },
    {
      key: "signups", label: "New Accounts", title: "New Accounts", color: "#2e7d32",
      unitLabel: "signup", emptyLabel: "No new accounts in this range yet.",
      dailyCounts: signupDailyCounts,
    },
  ];
  const activeMetric = CHART_METRICS.find((m) => m.key === chartMetric) || CHART_METRICS[0];

  const lastSyncedLabel = pageViewTotals.lastSyncedMs > 0
    ? new Date(pageViewTotals.lastSyncedMs).toLocaleString()
    : "Never synced";
  const syncIsStale = pageViewTotals.lastSyncedMs > 0 && (Date.now() - pageViewTotals.lastSyncedMs) > 36 * 60 * 60 * 1000; // >36h old

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
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setRangeDays(opt.days)}
                style={{
                  padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  border: "2px solid " + GOLD, borderRadius: "20px", cursor: "pointer",
                  background: rangeDays === opt.days ? GOLD : "transparent",
                  color: "#fff",
                  whiteSpace: "nowrap", transition: "background 0.15s",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontSize: "12px", fontWeight: 700, color: "#999" }}>
          {loading
            ? "Loading live numbers from Firestore…"
            : "Read-only — pulled from the evaluations, users, and analytics collections."}
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

      {/* ── Page Views (Google Analytics, via analytics/{slug}) ── */}
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Page Views
          </div>
          <div style={{ fontSize: "9px", fontWeight: 900, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Google Analytics
          </div>
        </div>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee", fontSize: "12px", fontWeight: 700, color: syncIsStale ? "#a52a1e" : "#999" }}>
          {loading
            ? "Loading…"
            : "Last synced: " + lastSyncedLabel + (syncIsStale ? " — sync may be stale, check the GitHub Actions cron." : "") + " · " + pageViewTotals.playerCount + " player page" + (pageViewTotals.playerCount !== 1 ? "s" : "") + " tracked"}
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "1px", background: "#eee",
        }}>
          {[
            { label: "Views (24h)", value: pageViewTotals.last24 },
            { label: "Views (7d)", value: pageViewTotals.last7 },
            { label: "Views (30d)", value: pageViewTotals.last30 },
            { label: "Views (All-Time)", value: pageViewTotals.total },
          ].map((card) => (
            <div key={card.label} style={{ background: "#fff", padding: "16px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                {card.label}
              </div>
              <div style={{ fontSize: "22px", fontWeight: 900, color: BLUE }}>
                {loading ? "—" : card.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: GOLD, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {activeMetric.title} — {rangeLabel}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
            {CHART_METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setChartMetric(m.key)}
                style={{
                  padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  border: "2px solid #fff", borderRadius: "20px", cursor: "pointer",
                  background: chartMetric === m.key ? "#fff" : "transparent",
                  color: chartMetric === m.key ? GOLD : "#fff",
                  whiteSpace: "nowrap", transition: "background 0.15s, color 0.15s",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <DailyBarChart
          dailyCounts={activeMetric.dailyCounts}
          rangeDays={rangeDays}
          loading={loading}
          color={activeMetric.color}
          unitLabel={activeMetric.unitLabel}
          emptyLabel={activeMetric.emptyLabel}
        />
      </div>

      <PlayerEvaluationsTable />
    </div>
  );
}

// ── Players + Evaluations table — same filter pattern as Player Data
// (search, School dropdown, Eligible Year, Position bar; 2026 excluded by
// default), but read-only and joined against a per-player evaluation
// summary instead of an edit form. Same join-key reasoning as
// AnalyticsSection above (d.ref.parent.parent.id). Page views are joined
// separately by Slug against the analytics collection — same field the
// public site's /player/{slug} route and the sync script both key off of.
// Columns are sortable by clicking the header. ──
function PlayerEvaluationsTable() {
  const [allPlayers, setAllPlayers] = useState([]);
  const [allEvals, setAllEvals] = useState([]);
  const [pageViewsBySlug, setPageViewsBySlug] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYears, setSelectedYears] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [sortKey, setSortKey] = useState("count");
  const [sortDir, setSortDir] = useState("desc");
  const [fetchErrors, setFetchErrors] = useState([]);
  const [rangeDays, setRangeDays] = useState(null); // null = All Time

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
  // .allSettled so a failed read on any one of the three sources still lets
  // the other two render instead of blanking the whole table, and each
  // failure is shown on screen rather than only logged. ──
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setFetchErrors([]);
      const errors = [];
      const [playersRes, evalRes, analyticsRes] = await Promise.allSettled([
        getDocs(collection(db, "players")),
        getDocs(collectionGroup(db, "evaluations")),
        getDocs(collection(db, "analytics")),
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
        const evals = evalRes.value.docs
          .filter((d) => d.ref.parent?.parent?.parent?.id === "players")
          .map((d) => {
            const data = d.data();
            const playerId = data.playerId || d.ref.parent.parent?.id || null;
            return {
              playerId,
              visibility: data.visibility || "public",
              grade: data.grade || "",
              updatedAtMs: toMs(data.updatedAt),
            };
          });
        setAllEvals(evals);
      } else {
        console.error("Admin player-evaluations evaluations fetch error:", evalRes.reason);
        setAllEvals([]);
        errors.push("Evaluations: " + (evalRes.reason?.message || "read failed — likely missing a Firestore rule for collection-group reads on \"evaluations\"."));
      }

      if (analyticsRes.status === "fulfilled") {
        const map = new Map();
        analyticsRes.value.docs.forEach((d) => {
          const data = d.data();
          map.set(d.id, data.pageViews || { last24Hours: 0, last7Days: 0, last30Days: 0, last90Days: 0, lastYear: 0, total: 0 });
        });
        setPageViewsBySlug(map);
      } else {
        console.error("Admin player-evaluations page-views fetch error:", analyticsRes.reason);
        setPageViewsBySlug(new Map());
        errors.push("Page Views: " + (analyticsRes.reason?.message || "read failed."));
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

  // rangeDays === null is "All Time" — no cutoff, every evaluation counts.
  const cutoffMs = useMemo(
    () => (rangeDays == null ? 0 : Date.now() - rangeDays * 24 * 60 * 60 * 1000),
    [rangeDays]
  );
  const viewField = rangeDays == null ? "total" : VIEW_FIELD_BY_RANGE_DAYS[rangeDays];

  // Re-aggregated per player whenever the selected range changes, rather
  // than once up front — Evals/Pub-Priv/Last-Updated all need to reflect
  // only the evaluations that fall inside the chosen window.
  const statsByPlayer = useMemo(() => {
    const map = new Map();
    allEvals.forEach((e) => {
      if (!e.playerId) return;
      if (e.updatedAtMs < cutoffMs) return;
      const entry = map.get(e.playerId) || { count: 0, publicCount: 0, grades: [], lastUpdatedMs: 0 };
      entry.count += 1;
      if (e.visibility === "public") entry.publicCount += 1;
      if (e.grade && gradeScale[e.grade] != null) entry.grades.push(gradeScale[e.grade]);
      if (e.updatedAtMs > entry.lastUpdatedMs) entry.lastUpdatedMs = e.updatedAtMs;
      map.set(e.playerId, entry);
    });
    return map;
  }, [allEvals, cutoffMs]);

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
      const pageViews = (p.Slug && pageViewsBySlug.get(p.Slug)) || null;
      // Undefined (not 0) means this window hasn't been synced yet for this
      // slug — e.g. last90Days/lastYear on analytics docs written before
      // those fields existed — so it renders as "—" rather than a
      // misleading zero.
      const viewsRaw = pageViews ? pageViews[viewField] : null;
      return {
        ...p,
        evalCount: stats.count,
        publicCount: stats.publicCount,
        privateCount: stats.count - stats.publicCount,
        avgGradeLabel,
        lastUpdatedMs: stats.lastUpdatedMs,
        views: viewsRaw != null ? (Number(viewsRaw) || 0) : null,
      };
    });

    withStats.sort((a, b) => {
      let av, bv;
      if (sortKey === "name") { av = a.Last || ""; bv = b.Last || ""; }
      else if (sortKey === "grade") { av = a.avgGradeLabel ? gradeScale[a.avgGradeLabel] : 99; bv = b.avgGradeLabel ? gradeScale[b.avgGradeLabel] : 99; }
      else if (sortKey === "updated") { av = a.lastUpdatedMs; bv = b.lastUpdatedMs; }
      else if (sortKey === "views") { av = a.views ?? -1; bv = b.views ?? -1; }
      else { av = a.evalCount; bv = b.evalCount; }
      if (typeof av === "string") {
        const cmp = av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });

    return withStats;
  }, [allPlayers, statsByPlayer, pageViewsBySlug, viewField, selectedYears, selectedPositions, selectedSchools, searchQuery, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const rangeLabel = (TABLE_RANGE_OPTIONS.find((o) => o.days === rangeDays) || {}).label || "All Time";

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
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Players &amp; Evaluations
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          {TABLE_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setRangeDays(opt.days)}
              style={{
                padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                textTransform: "uppercase", letterSpacing: "0.04em",
                border: "2px solid " + GOLD, borderRadius: "20px", cursor: "pointer",
                background: rangeDays === opt.days ? GOLD : "transparent",
                color: "#fff",
                whiteSpace: "nowrap", transition: "background 0.15s",
              }}
            >
              {opt.label}
            </button>
          ))}
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
                <SortHeader label={"Evals (" + rangeLabel + ")"} sortId="count" align="center" />
                <th style={{ padding: "9px 10px", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center", whiteSpace: "nowrap" }}>Pub / Priv</th>
                <SortHeader label="Avg Grade" sortId="grade" align="center" />
                <SortHeader label={"Views (" + rangeLabel + ")"} sortId="views" align="center" />
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
                    <td style={{ padding: "9px 10px", fontSize: "13px", fontWeight: 900, color: p.views != null && p.views > 0 ? BLUE : "#ccc", textAlign: "center" }}>
                      {p.views != null ? p.views.toLocaleString() : "—"}
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

// ── Branding — logos & colors for CFB (schools) and NFL (nfl) teams. This
// is both the lookup point for pulling brand assets to build graphics
// (banners, social cards, etc.) and the place to fix them — edits write
// straight to the same schools/{School} and nfl/{Abbreviation} docs every
// public team page, player card, and draft graphic already reads from. ──
const LEAGUE_CONFIG = {
  cfb: {
    label: "CFB",
    collectionName: "schools",
    nameField: "School",
    subLabelField: "Mascot",
    groupField: "Conference",
    searchPlaceholder: "Search school, mascot, or conference...",
  },
  nfl: {
    label: "NFL",
    collectionName: "nfl",
    nameField: "Team",
    subLabelField: "City",
    groupField: "Conference",
    searchPlaceholder: "Search team, city, or conference...",
  },
};

// Classic CSS checkerboard trick — lets a transparent-background logo PNG
// be told apart from "no logo set" instead of both rendering as blank white.
const CHECKER_BG = {
  backgroundColor: "#fff",
  backgroundImage:
    "linear-gradient(45deg, #eee 25%, transparent 25%), linear-gradient(-45deg, #eee 25%, transparent 25%), " +
    "linear-gradient(45deg, transparent 75%, #eee 75%), linear-gradient(-45deg, transparent 75%, #eee 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0px",
};

// Many of the logo URLs stored in schools/nfl are bare "imgur.com/xxx.png"
// links — Imgur happily serves the raw image bytes from that host (that's
// why the <img> previews render fine), but it caps that domain's
// Access-Control-Allow-Origin to https://imgur.com itself, which blocks the
// cross-origin canvas read a clipboard-image-copy needs. The i.imgur.com
// CDN subdomain serves the identical bytes with a permissive CORS header,
// so rewrite to it before fetching. No-op for every other host.
function corsFriendlyImageUrl(url) {
  return url.replace(/^(https?:\/\/)imgur\.com\//i, "$1i.imgur.com/");
}

// ── Draws a (possibly cross-origin) logo URL onto a canvas and exports it
// as a PNG blob, so it can be written to the clipboard as actual image data
// rather than just a URL string — the point being to paste straight into
// Canva/Photoshop/etc. Requires the image host to serve CORS headers
// (Access-Control-Allow-Origin); if it doesn't, the canvas comes back
// "tainted" and toBlob throws a SecurityError, which the caller treats as a
// normal copy failure rather than crashing. ──
function loadImageAsPngBlob(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas failed to export the image."));
        }, "image/png");
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Image failed to load for clipboard copy."));
    img.src = corsFriendlyImageUrl(url);
  });
}

// `status` drives both the label and color: "idle" | "copying" | "copied" | "failed".
function CopyButton({ onClick, disabled, status, idleLabel }) {
  const isBusy = status === "copying";
  const isSuccess = status === "copied";
  const isError = status === "failed";
  const label = isBusy ? "Copying…" : isSuccess ? "Copied ✓" : isError ? "Failed" : (idleLabel || "Copy");
  const accent = isSuccess ? "#2e7d32" : isError ? "#c0392b" : null;
  return (
    <button
      onClick={onClick}
      disabled={disabled || isBusy}
      style={{
        flexShrink: 0, padding: "8px 12px", fontWeight: 900, fontSize: "11px",
        textTransform: "uppercase", letterSpacing: "0.04em", cursor: (disabled || isBusy) ? "default" : "pointer",
        border: "2px solid " + (accent || "#ddd"), borderRadius: "6px",
        background: accent || "#fff", color: accent ? "#fff" : "#666",
        opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap", minWidth: "88px",
      }}
    >
      {label}
    </button>
  );
}

function LogoUrlField({ label, value, onChange, onCopy, copyStatus }) {
  return (
    <FieldRow label={label}>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <div style={{
          flexShrink: 0, width: "52px", height: "52px", borderRadius: "6px",
          border: "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden", ...CHECKER_BG,
        }}>
          {value ? (
            <img
              src={value} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            <span style={{ fontSize: "8px", color: "#bbb", fontWeight: 700, textAlign: "center" }}>No logo</span>
          )}
        </div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          style={{ ...inputStyle, flex: 1 }}
        />
        <CopyButton onClick={onCopy} disabled={!value} status={copyStatus} idleLabel="Copy Image" />
      </div>
      {copyStatus === "failed" && (
        <div style={{ fontSize: "10px", fontWeight: 700, color: "#c0392b", marginTop: "5px" }}>
          Couldn't copy the image directly (often a cross-origin restriction from the image host) —
          right-click the preview thumbnail above and choose "Copy image" instead.
        </div>
      )}
    </FieldRow>
  );
}

function ColorHexField({ label, value, onChange, onCopy, copied }) {
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <FieldRow label={label}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          title="Pick a color"
          style={{ width: "40px", height: "36px", flexShrink: 0, border: "2px solid #ddd", borderRadius: "6px", padding: "2px", cursor: "pointer", background: "#fff" }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          style={{ ...inputStyle, flex: 1 }}
        />
        <CopyButton onClick={onCopy} disabled={!value} status={copied ? "copied" : "idle"} idleLabel="Copy" />
      </div>
    </FieldRow>
  );
}

function BrandingSection() {
  const [league, setLeague] = useState("cfb");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        {Object.entries(LEAGUE_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setLeague(key)}
            style={{
              padding: "9px 22px", fontWeight: 900, fontSize: "13px",
              textTransform: "uppercase", letterSpacing: "0.06em",
              border: "2px solid " + BLUE, borderRadius: "8px", cursor: "pointer",
              background: league === key ? BLUE : "#fff",
              color: league === key ? "#fff" : BLUE,
            }}
          >
            {cfg.label}
          </button>
        ))}
      </div>
      {/* key={league} forces a clean remount on toggle rather than trying to
          reuse fetch/selection state across two entirely different collections. */}
      <TeamBrandingPane key={league} league={league} />
    </div>
  );
}

function TeamBrandingPane({ league }) {
  const cfg = LEAGUE_CONFIG[league];
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [copiedField, setCopiedField] = useState("");
  const [logoCopyStatus, setLogoCopyStatus] = useState({});

  useEffect(() => {
    const fetchTeams = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, cfg.collectionName));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a[cfg.nameField] || "").localeCompare(b[cfg.nameField] || ""));
        setTeams(data);
      } catch (e) {
        console.error("Admin branding fetch error (" + league + "):", e);
        setTeams([]);
      } finally {
        setLoading(false);
      }
    };
    fetchTeams();
  }, [league, cfg.collectionName, cfg.nameField]);

  const groupOptions = useMemo(() => {
    const set = [...new Set(teams.map((t) => t[cfg.groupField]).filter(Boolean))];
    return set.sort();
  }, [teams, cfg.groupField]);

  const filtered = useMemo(() => {
    return teams.filter((t) => {
      if (selectedGroups.length > 0 && !selectedGroups.includes(t[cfg.groupField])) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matches =
          (t[cfg.nameField] || "").toLowerCase().includes(q) ||
          (t[cfg.subLabelField] || "").toLowerCase().includes(q) ||
          (t[cfg.groupField] || "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [teams, selectedGroups, searchQuery, cfg]);

  const selectTeam = (t) => {
    setSelectedTeam(t);
    setFormState({
      Logo1: t.Logo1 || "",
      Logo2: t.Logo2 || "",
      Color1: t.Color1 || BLUE,
      Color2: t.Color2 || GOLD,
    });
    setSaveMessage("");
    setCopiedField("");
    setLogoCopyStatus({});
  };

  const handleFieldChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleCopy = async (field, value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((f) => (f === field ? "" : f)), 1500);
    } catch (e) {
      console.error("Clipboard copy failed:", e);
    }
  };

  // ── Copies the actual logo pixels (not the URL) so it can be pasted
  // straight into a graphics tool. navigator.clipboard.write() is called
  // synchronously (with a pending Promise<Blob> as the value) rather than
  // after an awaited fetch, since some browsers only honor clipboard writes
  // that happen within the original click's user-activation window. ──
  const handleCopyImage = (field, url) => {
    if (!url) return;
    setLogoCopyStatus((prev) => ({ ...prev, [field]: "copying" }));
    let clipboardPromise;
    try {
      clipboardPromise = navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": loadImageAsPngBlob(url) }),
      ]);
    } catch (e) {
      clipboardPromise = Promise.reject(e);
    }
    clipboardPromise
      .then(() => setLogoCopyStatus((prev) => ({ ...prev, [field]: "copied" })))
      .catch((e) => {
        console.error("Copy image to clipboard failed:", e);
        setLogoCopyStatus((prev) => ({ ...prev, [field]: "failed" }));
      })
      .finally(() => {
        setTimeout(() => {
          setLogoCopyStatus((prev) => (prev[field] === "copying" ? prev : { ...prev, [field]: "idle" }));
        }, 2400);
      });
  };

  const handleSave = async () => {
    if (!selectedTeam || !formState) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const payload = {
        Logo1: formState.Logo1.trim(),
        Logo2: formState.Logo2.trim(),
        Color1: formState.Color1.trim(),
        Color2: formState.Color2.trim(),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, cfg.collectionName, selectedTeam.id), payload);
      setTeams((prev) => prev.map((t) => (t.id === selectedTeam.id ? { ...t, ...payload } : t)));
      setSelectedTeam((prev) => (prev ? { ...prev, ...payload } : prev));
      setSaveMessage("Saved.");
    } catch (e) {
      console.error("Admin branding save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {cfg.label} Teams
          </div>
        </div>

        <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee", display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={cfg.searchPlaceholder}
            style={{ width: "100%", border: "2px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
          />
          <DropdownChecklist title="Conference" options={groupOptions} selected={selectedGroups} setSelected={setSelectedGroups} />
        </div>

        {loading ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No teams match.</div>
        ) : (
          <div style={{ maxHeight: "640px", overflowY: "auto" }}>
            <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
              {filtered.length} team{filtered.length !== 1 ? "s" : ""}
            </div>
            {filtered.map((t) => {
              const isSelected = selectedTeam?.id === t.id;
              const c1 = t.Color1 || "#ccc";
              const c2 = t.Color2 || "#eee";
              return (
                <div
                  key={t.id}
                  onClick={() => selectTeam(t)}
                  style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "10px 14px", cursor: "pointer",
                    background: isSelected ? "#eaf1ff" : "#fff",
                    borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{
                    flexShrink: 0, width: "40px", height: "40px", borderRadius: "8px",
                    background: c1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                  }}>
                    {t.Logo1 ? (
                      <img src={t.Logo1} alt="" style={{ width: "80%", height: "80%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <span style={{ color: "#fff", fontWeight: 900, fontSize: "14px" }}>{(t[cfg.nameField] || "?").charAt(0)}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t[cfg.nameField] || "Untitled"}
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#888", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[t[cfg.subLabelField], t[cfg.groupField]].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                    <div title={"Color 1: " + c1} style={{ width: "16px", height: "16px", borderRadius: "50%", background: c1, border: "1px solid rgba(0,0,0,0.15)" }} />
                    <div title={"Color 2: " + c2} style={{ width: "16px", height: "16px", borderRadius: "50%", background: c2, border: "1px solid rgba(0,0,0,0.15)" }} />
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
            {selectedTeam ? (selectedTeam[cfg.nameField] || "Edit Team") : "Select a Team"}
          </div>
        </div>

        {!selectedTeam || !formState ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click a team from the list to view and edit its logos and colors.
          </div>
        ) : (
          <div style={{ padding: "16px", maxHeight: "760px", overflowY: "auto" }}>
            <div style={{ marginBottom: "18px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                Graphic Preview
              </div>
              <div style={{ borderRadius: "10px", overflow: "hidden", border: "2px solid #eee" }}>
                <div style={{
                  background: /^#[0-9a-fA-F]{3,8}$/.test(formState.Color1) ? formState.Color1 : BLUE,
                  padding: "24px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
                }}>
                  <div style={{
                    width: "64px", height: "64px", borderRadius: "50%", background: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  }}>
                    {formState.Logo1 ? (
                      <img src={formState.Logo1} alt="" style={{ width: "80%", height: "80%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <span style={{ color: "#ccc", fontWeight: 900, fontSize: "20px" }}>?</span>
                    )}
                  </div>
                  <div style={{ color: "#fff", fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>
                    {selectedTeam[cfg.nameField]}
                  </div>
                </div>
                <div style={{ height: "6px", background: /^#[0-9a-fA-F]{3,8}$/.test(formState.Color2) ? formState.Color2 : GOLD }} />
              </div>
            </div>

            <FieldGroup>
              <LogoUrlField
                label="Logo 1 (Primary)"
                value={formState.Logo1}
                onChange={(v) => handleFieldChange("Logo1", v)}
                onCopy={() => handleCopyImage("Logo1", formState.Logo1)}
                copyStatus={logoCopyStatus.Logo1 || "idle"}
              />
              <LogoUrlField
                label="Logo 2 (Secondary / Alt)"
                value={formState.Logo2}
                onChange={(v) => handleFieldChange("Logo2", v)}
                onCopy={() => handleCopyImage("Logo2", formState.Logo2)}
                copyStatus={logoCopyStatus.Logo2 || "idle"}
              />
              <ColorHexField
                label="Color 1 (Primary)"
                value={formState.Color1}
                onChange={(v) => handleFieldChange("Color1", v)}
                onCopy={() => handleCopy("Color1", formState.Color1)}
                copied={copiedField === "Color1"}
              />
              <ColorHexField
                label="Color 2 (Secondary)"
                value={formState.Color2}
                onChange={(v) => handleFieldChange("Color2", v)}
                onCopy={() => handleCopy("Color2", formState.Color2)}
                copied={copiedField === "Color2"}
              />
            </FieldGroup>

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
              {saving ? "Saving..." : "Save Changes"}
            </button>

            {saveMessage && (
              <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
            {activeSection === "branding" && <BrandingSection />}
            {activeSection === "content" && <ComingSoonPane label="Content Management" />}
            {activeSection === "sync" && <ComingSoonPane label="Sync / System Status" />}
            {activeSection === "ads" && <ComingSoonPane label="Ads Management" />}
          </div>
        </div>
      </div>
    </>
  );
}