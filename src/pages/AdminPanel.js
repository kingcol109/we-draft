// src/pages/AdminPanel.js
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, addDoc, doc, updateDoc, setDoc, deleteDoc, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// 2026 is archived — the draft already happened, so it's excluded from
// normal browsing/filtering and only reachable via the explicit Archive
// toggle. Mirrors the ARCHIVE_YEARS / ACTIVE_YEARS split CommunityBoard.js
// uses for the same reason.
const ARCHIVE_YEARS = ["2026"];
const ACTIVE_YEARS = ["2027", "2028", "2029"];
// Full list — still used by the create/edit form's Eligible dropdown, since
// correcting a typo on an existing 2026 record is a legitimate edit even
// though 2026 isn't part of normal browsing.
const ELIGIBLE_YEARS = [...ARCHIVE_YEARS, ...ACTIVE_YEARS];

// Same priority order CommunityBoard.js uses for its position filter bar —
// known positions first in this order, then anything else alphabetically.
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

const BLANK_PLAYER_FORM = {
  First: "", Last: "", School: "", Position: "", Eligible: "",
  Height: "", Weight: "", Flair: "", Live: true,
};

// ── Slug generator — ports the Google Sheets formula exactly so IDs
// created here match what the sheet has been producing:
//   =REGEXREPLACE(LOWER(REGEXREPLACE(REGEXREPLACE(REGEXREPLACE(
//     A2&"-"&B2&"-"&P2&"-"&C2, "[’'`.]", ""), "[^a-zA-Z0-9- ]", ""),
//     "\s+", "-")), "-+", "-")
// Column order in the sheet is First(A) - Last(B) - Position(P) - Eligible
// year(C) — NOT School. School isn't part of the slug at all. ──
function generateSlug(first, last, position, eligible) {
  const raw = `${first || ""}-${last || ""}-${position || ""}-${eligible || ""}`;
  let s = raw.replace(/[’'`.]/g, "");        // strip curly/straight apostrophes, backtick, period
  s = s.replace(/[^a-zA-Z0-9\- ]/g, "");      // keep only letters, numbers, dash, space
  s = s.replace(/\s+/g, "-");                 // collapse whitespace runs to a single dash
  s = s.toLowerCase();
  s = s.replace(/-+/g, "-");                  // collapse repeated dashes to one
  return s;
}

// ── Sections for the sidebar. Only `key: "players"` is wired to real data
// right now — the rest render a placeholder pane so the layout/nav is in
// place to build into next. Add new entries here as sections come online. ──
const SECTIONS = [
  { key: "players", label: "Player Data", icon: "🏈", ready: true },
  { key: "trends", label: "Trends", icon: "📈", ready: true },
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

// ── Typeable school dropdown — a plain text input with a filtered
// suggestion list underneath, not a locked <select>. Options come from the
// `schools` collection, but free text is still allowed (e.g. a school not
// in that collection yet), so this only assists rather than restricts.
// Used in the create/edit form (single value, not a filter). ──
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

// ── Multi-select filter, click-to-open panel — used for School since the
// option list is large (100+ schools) and a plain button row would be
// unreadable at that size. Same pattern as CommunityBoard.js's
// DropdownChecklist: default `selected = []` means no restriction. ──
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
        {title}{selected.length > 0 ? ` (${selected.length})` : ""} ▾
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

// ── Multi-select filter bar — plain buttons, no dropdown/click-to-open
// panel. Toggling a button adds/removes it from `selected`; an empty
// `selected` array means "no restriction, show everything," which is the
// default state. Used for Position, where the option count is small enough
// to show as a direct row of buttons. ──
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

// ── Player Data section. Fetches the ENTIRE players collection once (this
// is a low-traffic internal admin tool, so one broader read up front is
// fine), then filters client-side. 2026 (archived) is excluded from normal
// browsing entirely and only shown when the Archive toggle is on — it never
// blends into the active-year filters. Position and School filters both
// default to blank (no restriction). Selecting a row loads it into an edit
// form; Save does a targeted updateDoc. "+ Add Player" opens the same form
// blank — Save there does a slug-uniqueness check, then addDoc (Firestore
// auto-generates the doc ID, same random-ID shape as every existing
// player), and the row flips into edit mode against the new doc. ──
function PlayerDataSection() {
  const [allPlayers, setAllPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewArchive, setViewArchive] = useState(false);
  const [selectedYears, setSelectedYears] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedSchools, setSelectedSchools] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null); // null | { id: null, isNew: true } | existing player
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [schoolOptions, setSchoolOptions] = useState([]);

  // Fetched once — schools don't depend on the player filters below.
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

  // Switching Archive mode clears the year/position/school filters and any
  // open selection, since "2026 only" replaces rather than blends with the
  // active-year browsing state.
  const toggleArchive = () => {
    setViewArchive((v) => !v);
    setSelectedYears([]);
    setSelectedPositions([]);
    setSelectedSchools([]);
    setSelectedPlayer(null);
    setFormState(null);
    setSaveMessage("");
  };

  // Positions actually present in the currently-relevant pool (archive or
  // active), ordered the same way CommunityBoard.js orders its position
  // filter bar: POSITION_ORDER first, anything else appended alphabetically.
  const allPositions = useMemo(() => {
    const pool = allPlayers.filter((p) => viewArchive ? p.Eligible === "2026" : p.Eligible !== "2026");
    const set = [...new Set(pool.map((p) => p.Position).filter(Boolean))];
    return set.sort((a, b) => {
      const ai = POSITION_ORDER.indexOf(a);
      const bi = POSITION_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [allPlayers, viewArchive]);

  const filtered = allPlayers.filter((p) => {
    if (viewArchive) {
      if (p.Eligible !== "2026") return false;
    } else {
      if (p.Eligible === "2026") return false; // 2026 never appears outside Archive mode
      if (selectedYears.length > 0 && !selectedYears.includes(p.Eligible)) return false;
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
    });
    setSaveMessage("");
  };

  const startNewPlayer = () => {
    setSelectedPlayer({ id: null, isNew: true });
    setFormState({ ...BLANK_PLAYER_FORM, Eligible: viewArchive ? "2026" : "" });
    setSaveMessage("");
  };

  const handleFieldChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  // Live preview of the slug that will be assigned on create — same formula
  // as the sheet, recomputed as the admin types. Not used for existing
  // players; their stored Slug is shown as-is and never auto-recomputed,
  // since it's already the canonical, indexed URL for that player.
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
        // Guard against slug collisions across the whole players collection.
        const dupSnap = await getDocs(query(collection(db, "players"), where("Slug", "==", slug)));
        if (!dupSnap.empty) {
          setSaveMessage(`Slug "${slug}" is already in use — adjust name/position/year to make it unique.`);
          setSaving(false);
          return;
        }

        const payload = { ...formState, Slug: slug };
        const newDocRef = await addDoc(collection(db, "players"), payload);
        const newPlayer = { id: newDocRef.id, ...payload };

        setAllPlayers((prev) => [...prev, newPlayer].sort((a, b) => (a.Last || "").localeCompare(b.Last || "")));

        // Flip into edit mode against the real doc so further saves update
        // rather than create again.
        setSelectedPlayer(newPlayer);
        setSaveMessage(`Player created — slug "${slug}".`);
      } catch (e) {
        console.error("Admin player create error:", e);
        setSaveMessage("Failed to create — check console.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Existing player — unchanged update path.
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
      {/* ── List / search column ── */}
      <div style={{ border: "2px solid " + (viewArchive ? GOLD : BLUE), borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: viewArchive ? GOLD : BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: viewArchive ? "#fff" : GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {viewArchive ? "Archive — 2026 Draft Class" : "Player Data"}
          </div>
          <button
            onClick={toggleArchive}
            style={{
              background: viewArchive ? "#fff" : "transparent",
              color: viewArchive ? GOLD : "#fff",
              border: "2px solid #fff", borderRadius: "20px",
              padding: "5px 12px", fontWeight: 900, fontSize: "11px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            {viewArchive ? "← Back to Active" : "Archive: 2026 ▾"}
          </button>
          <button
            onClick={startNewPlayer}
            style={{
              marginLeft: "auto", background: viewArchive ? BLUE : GOLD, color: "#fff", border: "none",
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
            {!viewArchive && (
              <FilterBar options={ACTIVE_YEARS} selected={selectedYears} setSelected={setSelectedYears} />
            )}
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
                    borderLeft: isSelected ? `4px solid ${BLUE}` : "4px solid transparent",
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
                      href={`/player/${p.Slug}`}
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

      {/* ── Edit / create column ── */}
      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden", position: "sticky", top: "20px" }}>
        <div style={{ background: GOLD, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {isNew ? "New Player" : selectedPlayer ? "Edit Player" : "Select a Player"}
          </div>
          {!isNew && selectedPlayer?.Slug && (
            <a
              href={`/player/${selectedPlayer.Slug}`}
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
                <input value={formState.Height} onChange={(e) => handleFieldChange("Height", e.target.value)} placeholder={'e.g. 6\'2"'} style={inputStyle} />
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

              {/* Slug — read-only. New players show a live preview of what
                  will be assigned on save; existing players show their
                  actual stored slug, never editable here (it's the
                  canonical, already-indexed URL for that player). */}
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
                background: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
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

// ── Trends section — lets an admin flag a player as "Up" or "Breakout"
// (mirrors what PlayerProfile.js reads from the `trends` collection, keyed
// by player Slug) and attach a few short notes that show in that page's
// tooltip. Scoped to active-year players only (2027–2029) — trends are a
// pre-draft storyline signal, not something relevant for archived 2026
// players. Adding and removing are two distinct, explicit actions: Save
// always requires a Trend value selected, and Remove is its own button
// that deletes the doc outright rather than trying to infer removal from
// an emptied dropdown. ──
function TrendsSection() {
  const [allPlayers, setAllPlayers] = useState([]);
  const [trendsMap, setTrendsMap] = useState(new Map()); // slug -> { Trend, Notes }
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [formState, setFormState] = useState(null); // { Trend, Notes }
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
    if (!p.Slug) return false; // a trend doc is keyed by Slug — can't attach one without it
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
    if (!window.confirm(`Remove the trend for ${selectedPlayer.First} ${selectedPlayer.Last}?`)) return;
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
      {/* ── List / search column ── */}
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
                    borderLeft: isSelected ? `4px solid ${BLUE}` : "4px solid transparent",
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

      {/* ── Edit column ── */}
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
                background: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
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
      {/* Admin pages should never be indexed or appear in search results. */}
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
            {activeSection === "content" && <ComingSoonPane label="Content Management" />}
            {activeSection === "sync" && <ComingSoonPane label="Sync / System Status" />}
            {activeSection === "ads" && <ComingSoonPane label="Ads Management" />}
          </div>
        </div>
      </div>
    </>
  );
}