// src/pages/AdminPanel.js
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, collectionGroup, getDocs, addDoc, doc, updateDoc, setDoc, deleteDoc, deleteField, query, where, serverTimestamp, arrayUnion, arrayRemove } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import ArticlesManager from "../components/ArticlesManager";
import PerformancesManager from "../components/PerformancesManager";
import LoadingSpinner from "../components/LoadingSpinner";

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
  Height: "", Weight: "", Bio: "", Flair: "", Live: true, AdminNotes: "", Flag: "",
};

// ── Recruits (high school players, no public page yet) ──
// Recruit Class is the class the player is committed as a high schooler;
// Draft Class = Recruit Class + 3, mirroring the real 3-years-removed-from-
// high-school NFL draft eligibility rule. Only 2026 recruits currently have
// a Draft Class (2029) inside the site's supported ACTIVE_YEARS, so only
// they can be promoted to a real player page for now.
const RECRUIT_CLASSES = ["2026", "2027", "2028", "2029"];
const PROMOTABLE_RECRUIT_CLASS = "2026";
// Best to worst — doubles as both the select's option order and the sort
// rank for the recruit list (see recruitFlairRank below), so "descending"
// visually means best grade first.
const RECRUIT_FLAIR_OPTIONS = ["", "Early Impact", "Early Contributor", "Year 2 Contributor", "Developmental"];
const RECRUIT_GRADE_COLORS = {
  "Early Impact": { bg: "#3B6D11", border: "#27500A" },
  "Early Contributor": { bg: "#0F6E56", border: "#085041" },
  "Year 2 Contributor": { bg: "#BA7517", border: "#854F0B" },
  "Developmental": { bg: "#5F5E5A", border: "#444441" },
};
// No flair sorts after every real grade (Infinity), not before — an
// un-graded recruit isn't "worse than Developmental", it just has no grade
// yet, but it still needs to land somewhere in a descending sort.
function recruitFlairRank(flair) {
  const i = RECRUIT_FLAIR_OPTIONS.indexOf(flair);
  return i > 0 ? i : Infinity;
}

const BLANK_RECRUIT_FORM = {
  First: "", Last: "", HighSchool: "", State: "", Commitment: "", Position: "", RecruitClass: "",
  Height: "", Weight: "", Flair: "", Film: "", AdminNotes: "", Flag: "",
};

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois",
  "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming",
];

// Full state name -> 2-letter code, purely for the "(LA)" suffix shown
// next to each saved high school in the autocomplete dropdown below —
// the State field itself still stores the full name from US_STATES.
const STATE_ABBR = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
  "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
  "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
  "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
  "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
  "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
  "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
  "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
};

function draftClassForRecruitClass(recruitClass) {
  const y = parseInt(recruitClass, 10);
  if (!y) return "";
  return String(y + 3);
}

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
  { key: "articles", label: "Articles", icon: "📰", ready: true },
  { key: "performances", label: "Performances", icon: "⭐", ready: true },
  { key: "cfbschedule", label: "CFB Schedule", icon: "📅", ready: true },
  { key: "requests", label: "Requests", icon: "📥", ready: true },
  { key: "sync", label: "Sync / System", icon: "🔄", ready: false },
  { key: "ads", label: "Ads", icon: "🎯", ready: false },
];

function SidebarNav({ active, setActive, badgeCounts }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {SECTIONS.map((s) => {
        const isActive = active === s.key;
        const badge = badgeCounts?.[s.key] || 0;
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
            {/* Unread-count sticker — currently only wired up for
                "requests" (see AdminPanel's unreadRequestCount), but keyed
                generically off badgeCounts so any other section could grow
                one later without touching this component. */}
            {badge > 0 && (
              <span style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                minWidth: "18px", height: "18px", borderRadius: "9px", padding: "0 5px",
                background: "#c0392b", color: "#fff", fontSize: "10px", fontWeight: 900,
                flexShrink: 0,
              }}>
                {badge > 99 ? "99+" : badge}
              </span>
            )}
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

function SchoolCombobox({ value, onChange, options, getLabel }) {
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
              {getLabel ? getLabel(school) : school}
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
  // Named groups — a separate layer from Flag (one color per player, quick
  // visual tag) for arbitrary many-to-many organizing ("Top 100",
  // "Sleepers", a specific scout's watchlist, etc.). Each playerGroups doc
  // owns its own member-id array rather than players storing which groups
  // they're in, so deleting a group is a single doc delete that can never
  // touch a player doc — see handleDeleteGroup below.
  const [allGroups, setAllGroups] = useState([]); // [{ id, name, playerIds }]
  const [selectedGroups, setSelectedGroups] = useState([]); // filter, by group name
  const [groupError, setGroupError] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [duplicateMatches, setDuplicateMatches] = useState(null);
  const [slugCollision, setSlugCollision] = useState(null); // { baseSlug, uniqueSlug } | null
  const [slugChangePrompt, setSlugChangePrompt] = useState(null); // { newBase, oldSlug } | null — editing an existing player
  const [removing, setRemoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [playerDataTab, setPlayerDataTab] = useState("players");

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
    const fetchGroups = async () => {
      try {
        const snap = await getDocs(collection(db, "playerGroups"));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data(), playerIds: d.data().playerIds || [] }));
        data.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setAllGroups(data);
      } catch (e) {
        console.error("Admin player groups fetch error:", e);
        setAllGroups([]);
      }
    };
    fetchGroups();
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

  // Group membership lives on the group docs (playerIds arrays), not on the
  // player docs — this reverses that into playerId -> [group names] so the
  // filter below and the sidebar row tags can look a player up in O(1)
  // instead of scanning every group per player.
  const groupNamesByPlayer = useMemo(() => {
    const map = new Map();
    allGroups.forEach((g) => {
      (g.playerIds || []).forEach((pid) => {
        const arr = map.get(pid) || [];
        arr.push(g.name);
        map.set(pid, arr);
      });
    });
    return map;
  }, [allGroups]);

  const filtered = allPlayers.filter((p) => {
    if (selectedYears.length === 0) {
      if (p.Eligible === "2026") return false;
    } else {
      if (!selectedYears.includes(p.Eligible)) return false;
    }
    if (selectedPositions.length > 0 && !selectedPositions.includes(p.Position)) return false;
    if (selectedSchools.length > 0 && !selectedSchools.includes(p.School)) return false;
    if (selectedFlags.length > 0 && !selectedFlags.includes(p.Flag)) return false;
    if (selectedGroups.length > 0) {
      const playerGroupNames = groupNamesByPlayer.get(p.id) || [];
      if (!selectedGroups.some((n) => playerGroupNames.includes(n))) return false;
    }
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
      Bio: p.Bio || "",
      Flair: p.Flair || "",
      Live: p.Live !== false,
      AdminNotes: p.AdminNotes || "",
      Flag: p.Flag || "",
    });
    setSaveMessage("");
    setDuplicateMatches(null);
    setSlugChangePrompt(null);
    setConfirmDelete(false);
  };

  const startNewPlayer = () => {
    setSelectedPlayer({ id: null, isNew: true });
    setFormState({ ...BLANK_PLAYER_FORM });
    setSaveMessage("");
    setDuplicateMatches(null);
    setSlugCollision(null);
    setSlugChangePrompt(null);
    setConfirmDelete(false);
  };

  const handleFieldChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    // Editing the name after a duplicate warning was shown invalidates that
    // check — force it to re-run against the new value on the next save
    // attempt rather than trusting a match found for the old name.
    setDuplicateMatches(null);
    setSlugCollision(null);
    setSlugChangePrompt(null);
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

  // ── generateSlug() is name+position+year only, so a genuinely different
  // player who happens to share all three with an existing one (e.g. two
  // real "Ashton Hampton, DB, 2027"s) collides on the exact same slug.
  // Rather than blocking that admin outright, findUniqueSlug appends "-1",
  // "-2", etc. until it lands on one nothing in the already-loaded
  // `allPlayers` list is using. ──
  const findUniqueSlug = (baseSlug) => {
    const existingSlugs = new Set(allPlayers.map((p) => p.Slug).filter(Boolean));
    let n = 1;
    let candidate = baseSlug + "-" + n;
    while (existingSlugs.has(candidate)) {
      n += 1;
      candidate = baseSlug + "-" + n;
    }
    return candidate;
  };

  // ── Named groups (playerGroups collection) — create/delete the group
  // itself, and toggle one player's membership in it. Deliberately separate
  // from handleSave: a group doc is independent of any player doc, so none
  // of this touches `players` at all. initialPlayerId lets the "+ New
  // Group" quick-create inside a player's edit form create the group and
  // add that player in the same write, instead of two round trips. ──
  const handleCreateGroup = async (name, initialPlayerId = null) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const dupe = allGroups.find((g) => (g.name || "").trim().toLowerCase() === trimmed.toLowerCase());
    if (dupe) {
      setGroupError("A group named \"" + trimmed + "\" already exists.");
      return null;
    }
    try {
      const payload = {
        name: trimmed,
        playerIds: initialPlayerId ? [initialPlayerId] : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "playerGroups"), payload);
      const newGroup = { id: ref.id, ...payload };
      setAllGroups((prev) => [...prev, newGroup].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      setGroupError("");
      return newGroup;
    } catch (e) {
      console.error("Admin create group error:", e);
      setGroupError("Failed to create group — check console.");
      return null;
    }
  };

  // Lower-stakes than deleting a player (an org label, not real data), so a
  // plain window.confirm() matches the rest of the admin panel's
  // lighter-weight deletes (trends, videos, games, rivalries) rather than
  // the heavier in-panel confirm card reserved for player records.
  const handleDeleteGroup = async (group) => {
    const count = group.playerIds?.length || 0;
    if (!window.confirm("Delete the group \"" + group.name + "\"? This only removes the group — none of its " + count + " player" + (count !== 1 ? "s" : "") + " will be affected.")) return;
    try {
      await deleteDoc(doc(db, "playerGroups", group.id));
      setAllGroups((prev) => prev.filter((g) => g.id !== group.id));
      setSelectedGroups((prev) => prev.filter((n) => n !== group.name));
    } catch (e) {
      console.error("Admin delete group error:", e);
      alert("Failed to delete group — check console.");
    }
  };

  const handleToggleGroupMembership = async (group, playerId) => {
    const isMember = (group.playerIds || []).includes(playerId);
    try {
      await updateDoc(doc(db, "playerGroups", group.id), {
        playerIds: isMember ? arrayRemove(playerId) : arrayUnion(playerId),
        updatedAt: serverTimestamp(),
      });
      setAllGroups((prev) => prev.map((g) => g.id === group.id
        ? { ...g, playerIds: isMember ? (g.playerIds || []).filter((id) => id !== playerId) : [...(g.playerIds || []), playerId] }
        : g
      ));
    } catch (e) {
      console.error("Admin toggle group membership error:", e);
      alert("Failed to update group membership — check console.");
    }
  };

  // forcedSlug, when set, is a de-duped slug (base + "-1", "-2", ...) the
  // admin already saw and confirmed via the "Slug Already In Use" card
  // below — skips straight to writing with that slug instead of
  // re-deriving/re-checking the base one. skipSlugUpdate is the editing-an-
  // existing-player equivalent of "no" on the "Slug Would Change" prompt —
  // keep the stored Slug as-is and just flag it outdated instead.
  const handleSave = async (forceDuplicate = false, forcedSlug = null, skipSlugUpdate = false) => {
    if (!selectedPlayer || !formState) return;

    if (isNew) {
      if (!formState.First.trim() || !formState.Last.trim() || !formState.School.trim() || !formState.Position || !formState.Eligible) {
        setSaveMessage("First, Last, School, Position, and Eligible are required.");
        return;
      }
      const baseSlug = generateSlug(formState.First, formState.Last, formState.Position, formState.Eligible);
      if (!baseSlug || baseSlug === "-") {
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

      const slug = forcedSlug || baseSlug;

      setSaving(true);
      setSaveMessage("");
      try {
        const dupSnap = await getDocs(query(collection(db, "players"), where("Slug", "==", slug)));
        if (!dupSnap.empty) {
          // Same name/position/year as an existing player produces the same
          // slug. The admin already confirmed above (via "Yes, Create
          // Anyway") that this is a genuinely different, intentional entry
          // and not a mis-click, so rather than blocking outright, surface
          // the de-duped slug it'll actually be saved under and let them
          // confirm that too before anything gets written.
          setSaving(false);
          setSlugCollision({ baseSlug, uniqueSlug: findUniqueSlug(baseSlug) });
          return;
        }

        const payload = { ...formState, Slug: slug, updatedAt: serverTimestamp() };
        const newDocRef = await addDoc(collection(db, "players"), payload);
        const newPlayer = { id: newDocRef.id, ...payload };

        setAllPlayers((prev) => [...prev, newPlayer].sort((a, b) => (a.Last || "").localeCompare(b.Last || "")));
        setSelectedPlayer(newPlayer);
        setSlugCollision(null);
        setSaveMessage(
          forcedSlug
            ? "Player created — \"" + baseSlug + "\" was already taken, so this one was saved as \"" + slug + "\"."
            : "Player created — slug \"" + slug + "\"."
        );
      } catch (e) {
        console.error("Admin player create error:", e);
        setSaveMessage("Failed to create — check console.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Editing First/Last/Position/Eligible changes what generateSlug would
    // produce, but the stored Slug is never silently rewritten out from
    // under a live page/shared link — a previously de-duped slug ("...-1")
    // still counts as "matching" its base so re-saving unrelated fields on
    // a player who once collided doesn't re-trigger this every time.
    const newBase = generateSlug(formState.First, formState.Last, formState.Position, formState.Eligible);
    const currentSlug = selectedPlayer.Slug || "";
    const validBase = !!newBase && newBase !== "-";
    const slugStillMatches = !validBase || currentSlug === newBase || currentSlug.startsWith(newBase + "-");

    if (!slugStillMatches && !skipSlugUpdate && !forcedSlug) {
      setSlugChangePrompt({ newBase, oldSlug: currentSlug });
      setSaveMessage("");
      return;
    }

    setSaving(true);
    setSaveMessage("");
    try {
      const fields = { ...formState };
      if (skipSlugUpdate) {
        // Admin chose to keep the old slug — leave Slug itself untouched,
        // just flag that it no longer matches this player's current info
        // (see the "SLUG" badge in the player list / this field's note).
        fields.SlugOutdated = true;
      } else if (!slugStillMatches) {
        const slugToWrite = forcedSlug || newBase;
        const dupSnap = await getDocs(query(collection(db, "players"), where("Slug", "==", slugToWrite)));
        if (!dupSnap.empty && slugToWrite !== currentSlug) {
          // The new slug collides with a different existing player — same
          // "offer a de-duped alternative" flow as creating a new player.
          setSaving(false);
          setSlugCollision({ baseSlug: newBase, uniqueSlug: findUniqueSlug(newBase) });
          return;
        }
        fields.Slug = slugToWrite;
        fields.SlugOutdated = false;
      } else if (selectedPlayer.SlugOutdated) {
        // The edit brought the slug back in line with the current fields
        // (e.g. a typo revert) — clear a stale flag rather than leave it on.
        fields.SlugOutdated = false;
      }

      // updatedAt drives the player page's sitemap <lastmod> (see
      // generate-sitemap.js) — without it every player showed the same
      // sitemap-generation date regardless of when they were actually
      // last edited.
      await updateDoc(doc(db, "players", selectedPlayer.id), { ...fields, updatedAt: serverTimestamp() });
      setAllPlayers((prev) =>
        prev.map((p) => (p.id === selectedPlayer.id ? { ...p, ...fields } : p))
      );
      // Kept in sync (not just allPlayers) since this form's own slug
      // display and the next save's slugStillMatches check both read
      // straight off selectedPlayer — leaving it stale would compare
      // against the pre-update slug on a second edit in the same sitting.
      setSelectedPlayer((prev) => ({ ...prev, ...fields }));
      setSlugChangePrompt(null);
      setSaveMessage(
        fields.Slug && fields.Slug !== currentSlug
          ? "Saved — slug updated to \"" + fields.Slug + "\"."
          : skipSlugUpdate
            ? "Saved — kept the existing slug, flagged as outdated."
            : "Saved."
      );
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
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {[
          { key: "players", label: "Players" },
          { key: "recruits", label: "Recruits" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setPlayerDataTab(t.key)}
            style={{
              padding: "8px 18px", fontWeight: 900, fontSize: "13px",
              textTransform: "uppercase", letterSpacing: "0.05em",
              border: "2px solid " + BLUE, borderRadius: "8px", cursor: "pointer",
              background: playerDataTab === t.key ? BLUE : "#fff",
              color: playerDataTab === t.key ? "#fff" : BLUE,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {playerDataTab === "recruits" ? (
        <RecruitsSection />
      ) : (
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

          {/* Named groups — separate from Flag above (one color per player)
              since a player can belong to any number of these. Filtering
              happens here; creating/deleting a group and adding/removing
              this-or-that player from one both happen in the edit form
              below (see the "Groups" FieldRow), except deleting a group can
              also be done right here so it's not buried inside some
              player's form. */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "5px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Groups
              </div>
              {allGroups.length > 0 && (
                <DropdownChecklist title="Filter" options={allGroups.map((g) => g.name)} selected={selectedGroups} setSelected={setSelectedGroups} />
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => { setNewGroupName(e.target.value); setGroupError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && newGroupName.trim()) { handleCreateGroup(newGroupName); setNewGroupName(""); } }}
                placeholder="New group name..."
                style={{ flex: "1 1 160px", minWidth: "140px", border: "2px solid #ddd", borderRadius: "6px", padding: "6px 10px", fontWeight: 700, fontSize: "12px", outline: "none", boxSizing: "border-box" }}
              />
              <button
                onClick={() => { if (newGroupName.trim()) { handleCreateGroup(newGroupName); setNewGroupName(""); } }}
                disabled={!newGroupName.trim()}
                style={{
                  padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  border: "2px solid " + BLUE, borderRadius: "6px",
                  background: BLUE, color: "#fff",
                  cursor: newGroupName.trim() ? "pointer" : "default",
                  opacity: newGroupName.trim() ? 1 : 0.5,
                }}
              >
                + Group
              </button>
            </div>
            {groupError && (
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#c0392b", marginTop: "4px" }}>{groupError}</div>
            )}
            {allGroups.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                {allGroups.map((g) => (
                  <span
                    key={g.id}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "6px",
                      border: "2px solid #ddd", borderRadius: "20px",
                      padding: "4px 6px 4px 12px", fontSize: "11px", fontWeight: 800, color: "#555",
                    }}
                  >
                    {g.name} <span style={{ color: "#aaa", fontWeight: 700 }}>({(g.playerIds || []).length})</span>
                    <button
                      onClick={() => handleDeleteGroup(g)}
                      title={"Delete \"" + g.name + "\" — players are unaffected"}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "18px", height: "18px", borderRadius: "50%",
                        border: "none", background: "#eee", color: "#888",
                        fontSize: "11px", fontWeight: 900, cursor: "pointer", lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <LoadingSpinner label="Loading players" size={28} minHeight="100px" />
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
                      {p.SlugOutdated && (
                        <span
                          title="Slug no longer matches this player's current name/position/year — see the Slug field below."
                          style={{ marginLeft: "8px", fontSize: "9px", fontWeight: 900, color: "#8a6300", border: "1px solid #e0a300", borderRadius: "10px", padding: "1px 6px" }}
                        >
                          SLUG
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#888" }}>
                      {p.Position || "—"} · {p.School || "—"} · {p.Eligible || "—"}
                    </div>
                    {(groupNamesByPlayer.get(p.id) || []).length > 0 && (
                      <div style={{ fontSize: "10px", fontWeight: 700, color: "#7a5c00", marginTop: "2px" }}>
                        🏷 {(groupNamesByPlayer.get(p.id) || []).join(", ")}
                      </div>
                    )}
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
              <FieldRow label="Bio (shown on player page)">
                <textarea
                  value={formState.Bio}
                  onChange={(e) => handleFieldChange("Bio", e.target.value)}
                  placeholder="A short public bio — shown on the player's page, below the hero and above measurements."
                  style={{ ...inputStyle, height: "100px", resize: "vertical", fontFamily: "inherit" }}
                />
                <div style={{ fontSize: "11px", color: "#999", marginTop: "4px" }}>
                  Tip: press Enter to start a new paragraph, or start a line with • or - for a bullet point — both render on the player page.
                </div>
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
              {/* New players don't have a Firestore doc id yet to attach
                  memberships to — save the player first, then this appears
                  on re-opening it. Creating a brand-new group from here
                  (rather than the list above) adds this player to it
                  immediately, in the same write. */}
              {!isNew && (
                <FieldRow label="Groups">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {allGroups.map((g) => {
                      const active = (g.playerIds || []).includes(selectedPlayer.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => handleToggleGroupMembership(g, selectedPlayer.id)}
                          style={{
                            padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                            textTransform: "uppercase", letterSpacing: "0.04em",
                            border: "2px solid " + BLUE, borderRadius: "20px", cursor: "pointer",
                            background: active ? BLUE : "#fff",
                            color: active ? "#fff" : BLUE,
                          }}
                        >
                          {active ? "✓ " : "+ "}{g.name}
                        </button>
                      );
                    })}
                    {allGroups.length === 0 && (
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#999" }}>
                        No groups yet — create one above the player list.
                      </div>
                    )}
                  </div>
                </FieldRow>
              )}
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
                  width: "100%", border: "2px solid " + (!isNew && selectedPlayer.SlugOutdated ? "#e0a300" : "#eee"),
                  borderRadius: "6px", padding: "8px 10px", fontWeight: 700, fontSize: "13px",
                  background: "#fafafa", color: "#666", boxSizing: "border-box",
                  wordBreak: "break-all",
                }}>
                  {isNew ? (previewSlug || "—") : (selectedPlayer.Slug || "—")}
                </div>
                {/* Set when the admin picked "Keep Old Slug" on a Slug Would
                    Change prompt below — cleared automatically the next time
                    an edit brings the slug back in line, or the admin
                    updates it from here. */}
                {!isNew && selectedPlayer.SlugOutdated && (
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a6300", marginTop: "5px" }}>
                    ⚠ Outdated — no longer matches this player's current name/position/year.
                  </div>
                )}
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
            ) : slugCollision ? (
              <div style={{ marginTop: "16px", border: "2px solid #c0392b", borderRadius: "8px", padding: "12px", background: "#fff3f0" }}>
                <div style={{ fontWeight: 900, fontSize: "12px", color: "#a52a1e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>
                  ⚠ Slug Already In Use
                </div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#666", marginBottom: "12px" }}>
                  "{slugCollision.baseSlug}" is already taken — same name, position, and year as an existing player. {isNew ? "Creating" : "Saving"} this player will save it as "{slugCollision.uniqueSlug}" instead.
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => setSlugCollision(null)}
                    style={{
                      flex: 1, background: "#fff", color: "#666", border: "2px solid #ddd",
                      borderRadius: "6px", padding: "10px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSave(true, slugCollision.uniqueSlug)}
                    disabled={saving}
                    style={{
                      flex: 1, background: "#c0392b", color: "#fff", border: "2px solid #a52a1e",
                      borderRadius: "6px", padding: "10px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.04em", cursor: saving ? "default" : "pointer",
                      opacity: saving ? 0.6 : 1,
                    }}
                  >
                    {saving ? "Saving..." : "Yes, Save As \"" + slugCollision.uniqueSlug + "\""}
                  </button>
                </div>
              </div>
            ) : slugChangePrompt ? (
              <div style={{ marginTop: "16px", border: "2px solid #e0a300", borderRadius: "8px", padding: "12px", background: "#fffaf0" }}>
                <div style={{ fontWeight: 900, fontSize: "12px", color: "#8a6300", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>
                  ⚠ Slug Would Change
                </div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#666", marginBottom: "12px" }}>
                  These edits change the name, position, or year the slug is built from — it would go from "{slugChangePrompt.oldSlug}" to "{slugChangePrompt.newBase}". Update it now (old links/bookmarks to this page break), or keep the current slug and just flag it as outdated?
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => handleSave(false, null, true)}
                    disabled={saving}
                    style={{
                      flex: 1, background: "#fff", color: "#666", border: "2px solid #ddd",
                      borderRadius: "6px", padding: "10px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.04em", cursor: saving ? "default" : "pointer",
                    }}
                  >
                    {saving ? "Saving..." : "Keep Old Slug"}
                  </button>
                  <button
                    onClick={() => handleSave(false, slugChangePrompt.newBase)}
                    disabled={saving}
                    style={{
                      flex: 1, background: "#e0a300", color: "#fff", border: "2px solid #a57a00",
                      borderRadius: "6px", padding: "10px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.04em", cursor: saving ? "default" : "pointer",
                      opacity: saving ? 0.6 : 1,
                    }}
                  >
                    {saving ? "Saving..." : "Update Slug"}
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
      )}
    </div>
  );
}

// ── High school recruits — same data model as players but stored in their
// own `recruits` collection with no public page by default (Commitment is
// FBS-only, Eligible becomes Recruit Class capped at 2026-2029, no Bio, and
// Flair is restricted to the four "Recruit Grade" tags). "Add to We-Draft"
// promotes a recruit into a real players/{id} doc + slug — gated to 2026
// recruits, since Draft Class = Recruit Class + 3 and 2029 is the only
// result currently inside ACTIVE_YEARS. The recruit doc is marked with
// promotedPlayerId/Slug/At rather than deleted, so promoting twice is a
// no-op and the origin record stays intact. ──
function RecruitsSection() {
  const [allRecruits, setAllRecruits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedStates, setSelectedStates] = useState([]);
  const [selectedCommitments, setSelectedCommitments] = useState([]);
  const [selectedGrades, setSelectedGrades] = useState([]);
  // Named recruit groups — same shape/purpose as PlayerDataSection's own
  // playerGroups (own recruitIds array, so deleting a group never touches
  // a recruit doc), just against the separate recruitGroups collection so
  // recruit and player group namespaces never mix.
  const [allGroups, setAllGroups] = useState([]); // [{ id, name, recruitIds }]
  const [selectedGroups, setSelectedGroups] = useState([]); // filter, by group name
  const [groupError, setGroupError] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedRecruit, setSelectedRecruit] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [fbsSchoolOptions, setFbsSchoolOptions] = useState([]);
  const [highSchoolOptions, setHighSchoolOptions] = useState([]);
  const [removing, setRemoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    const fetchSchools = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const names = snap.docs
          .map((d) => d.data())
          .filter((s) => !s.FCS)
          .map((s) => s.School)
          .filter(Boolean)
          .sort();
        setFbsSchoolOptions(names);
      } catch (e) {
        console.error("Admin FBS schools fetch error:", e);
        setFbsSchoolOptions([]);
      }
    };
    fetchSchools();
  }, []);

  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const snap = await getDocs(collection(db, "recruitGroups"));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data(), recruitIds: d.data().recruitIds || [] }));
        data.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setAllGroups(data);
      } catch (e) {
        console.error("Admin recruit groups fetch error:", e);
        setAllGroups([]);
      }
    };
    fetchGroups();
  }, []);

  // ── High schools are their own small collection, seeded lazily: typing a
  // new one into the High School field (see handleSave below) creates it
  // here with a unique doc id the first time, so every admin after that
  // gets it as an autocomplete suggestion via SchoolCombobox instead of
  // retyping it from scratch. Kept as {Name, State} objects (not just
  // names) so picking one from the dropdown can auto-fill State and the
  // suggestion list can show "Name (ST)" to disambiguate same-named
  // schools in different states. ──
  useEffect(() => {
    const fetchHighSchools = async () => {
      try {
        const snap = await getDocs(collection(db, "highSchools"));
        const data = snap.docs
          .map((d) => d.data())
          .filter((h) => h.Name)
          .sort((a, b) => a.Name.localeCompare(b.Name));
        setHighSchoolOptions(data);
      } catch (e) {
        console.error("Admin high schools fetch error:", e);
        setHighSchoolOptions([]);
      }
    };
    fetchHighSchools();
  }, []);

  useEffect(() => {
    const fetchRecruits = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "recruits"));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.Last || "").localeCompare(b.Last || ""));
        setAllRecruits(data);
      } catch (e) {
        console.error("Admin recruits fetch error:", e);
        setAllRecruits([]);
      } finally {
        setLoading(false);
      }
    };
    fetchRecruits();
  }, []);

  const highSchoolNames = useMemo(() => highSchoolOptions.map((h) => h.Name), [highSchoolOptions]);
  const highSchoolLabel = (name) => {
    const match = highSchoolOptions.find((h) => h.Name === name);
    return match && match.State ? name + " (" + (STATE_ABBR[match.State] || match.State) + ")" : name;
  };

  const allPositions = useMemo(() => {
    const set = [...new Set(allRecruits.map((r) => r.Position).filter(Boolean))];
    return set.sort((a, b) => {
      const ai = POSITION_ORDER.indexOf(a);
      const bi = POSITION_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [allRecruits]);

  // Group membership lives on the group docs (recruitIds arrays), not on
  // the recruit docs — reversed here into recruitId -> [group names] so
  // the filter below and the list row's tags can look a recruit up in
  // O(1) instead of scanning every group per recruit.
  const groupNamesByRecruit = useMemo(() => {
    const map = new Map();
    allGroups.forEach((g) => {
      (g.recruitIds || []).forEach((rid) => {
        const arr = map.get(rid) || [];
        arr.push(g.name);
        map.set(rid, arr);
      });
    });
    return map;
  }, [allGroups]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = allRecruits.filter((r) => {
      if (selectedClasses.length > 0 && !selectedClasses.includes(r.RecruitClass)) return false;
      if (selectedPositions.length > 0 && !selectedPositions.includes(r.Position)) return false;
      if (selectedStates.length > 0 && !selectedStates.includes(r.State)) return false;
      if (selectedCommitments.length > 0 && !selectedCommitments.includes(r.Commitment)) return false;
      if (selectedGrades.length > 0 && !selectedGrades.includes(r.Flair)) return false;
      if (selectedGroups.length > 0) {
        const recruitGroupNames = groupNamesByRecruit.get(r.id) || [];
        if (!selectedGroups.some((n) => recruitGroupNames.includes(n))) return false;
      }
      if (q) {
        const hay = ((r.First || "") + " " + (r.Last || "") + " " + (r.Commitment || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Best grade first (see recruitFlairRank), last name alphabetical as
    // the tiebreak within a tier.
    return rows.sort((a, b) => {
      const ra = recruitFlairRank(a.Flair);
      const rb = recruitFlairRank(b.Flair);
      if (ra !== rb) return ra - rb;
      return (a.Last || "").localeCompare(b.Last || "");
    });
  }, [allRecruits, searchQuery, selectedClasses, selectedPositions, selectedStates, selectedCommitments, selectedGrades, selectedGroups, groupNamesByRecruit]);

  const isNew = selectedRecruit?.isNew === true;

  const startNewRecruit = () => {
    setSelectedRecruit({ isNew: true });
    setFormState({ ...BLANK_RECRUIT_FORM });
    setSaveMessage("");
    setConfirmDelete(false);
  };

  const selectRecruit = (r) => {
    setSelectedRecruit(r);
    setFormState({ ...r });
    setSaveMessage("");
    setConfirmDelete(false);
  };

  const handleFieldChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  // ── Picking (or typing the exact name of) a saved high school also fills
  // in State from that record, so the admin doesn't have to set both. Fires
  // on every keystroke, not just a dropdown click, but only actually
  // changes State once the typed text exactly matches a saved name — a
  // partial match while still typing leaves whatever State is already set
  // alone. ──
  const handleHighSchoolChange = (name) => {
    setFormState((prev) => {
      const match = highSchoolOptions.find((h) => h.Name.toLowerCase() === name.trim().toLowerCase());
      return { ...prev, HighSchool: name, State: match ? match.State || prev.State : prev.State };
    });
  };

  const handleCreateGroup = async (name, initialRecruitId = null) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const dupe = allGroups.find((g) => (g.name || "").trim().toLowerCase() === trimmed.toLowerCase());
    if (dupe) {
      setGroupError("A group named \"" + trimmed + "\" already exists.");
      return null;
    }
    try {
      const payload = {
        name: trimmed,
        recruitIds: initialRecruitId ? [initialRecruitId] : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "recruitGroups"), payload);
      const newGroup = { id: ref.id, ...payload };
      setAllGroups((prev) => [...prev, newGroup].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      setGroupError("");
      return newGroup;
    } catch (e) {
      console.error("Admin create recruit group error:", e);
      setGroupError("Failed to create group — check console.");
      return null;
    }
  };

  // Lower-stakes than deleting a recruit (an org label, not real data), so
  // a plain window.confirm() matches PlayerDataSection's own group delete
  // rather than the heavier in-panel confirm card reserved for records.
  const handleDeleteGroup = async (group) => {
    const count = group.recruitIds?.length || 0;
    if (!window.confirm("Delete the group \"" + group.name + "\"? This only removes the group — none of its " + count + " recruit" + (count !== 1 ? "s" : "") + " will be affected.")) return;
    try {
      await deleteDoc(doc(db, "recruitGroups", group.id));
      setAllGroups((prev) => prev.filter((g) => g.id !== group.id));
      setSelectedGroups((prev) => prev.filter((n) => n !== group.name));
    } catch (e) {
      console.error("Admin delete recruit group error:", e);
      alert("Failed to delete group — check console.");
    }
  };

  const handleToggleGroupMembership = async (group, recruitId) => {
    const isMember = (group.recruitIds || []).includes(recruitId);
    try {
      await updateDoc(doc(db, "recruitGroups", group.id), {
        recruitIds: isMember ? arrayRemove(recruitId) : arrayUnion(recruitId),
        updatedAt: serverTimestamp(),
      });
      setAllGroups((prev) => prev.map((g) => g.id === group.id
        ? { ...g, recruitIds: isMember ? (g.recruitIds || []).filter((id) => id !== recruitId) : [...(g.recruitIds || []), recruitId] }
        : g
      ));
    } catch (e) {
      console.error("Admin toggle recruit group membership error:", e);
      alert("Failed to update group membership — check console.");
    }
  };

  const handleSave = async () => {
    if (!formState.First.trim() || !formState.Last.trim()) {
      setSaveMessage("First and last name are required.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      // ── Seed the highSchools collection the first time this exact name
      // (case-insensitive) is entered, so it becomes an autocomplete
      // suggestion for every recruit after this one. Runs on every save
      // rather than on blur, so a recruit that's never actually saved
      // never creates an orphan high school doc. ──
      const hsName = (formState.HighSchool || "").trim();
      if (hsName && !highSchoolOptions.some((h) => h.Name.toLowerCase() === hsName.toLowerCase())) {
        const newHighSchool = { Name: hsName, State: formState.State || "", createdAt: serverTimestamp() };
        await addDoc(collection(db, "highSchools"), newHighSchool);
        setHighSchoolOptions((prev) => [...prev, newHighSchool].sort((a, b) => a.Name.localeCompare(b.Name)));
      }

      if (isNew) {
        const payload = { ...formState, updatedAt: serverTimestamp() };
        delete payload.isNew;
        const newDocRef = await addDoc(collection(db, "recruits"), payload);
        const newRecruit = { id: newDocRef.id, ...payload };
        setAllRecruits((prev) => [...prev, newRecruit].sort((a, b) => (a.Last || "").localeCompare(b.Last || "")));
        setSelectedRecruit(newRecruit);
        setFormState(newRecruit);
        setSaveMessage("Recruit created.");
      } else {
        const payload = { ...formState, updatedAt: serverTimestamp() };
        delete payload.id;
        await updateDoc(doc(db, "recruits", selectedRecruit.id), payload);
        const updated = { ...selectedRecruit, ...formState };
        setAllRecruits((prev) => prev.map((r) => (r.id === updated.id ? updated : r)).sort((a, b) => (a.Last || "").localeCompare(b.Last || "")));
        setSelectedRecruit(updated);
        setSaveMessage("Changes saved.");
      }
    } catch (e) {
      console.error("Admin recruit save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRecruit || isNew) return;
    setRemoving(true);
    try {
      await deleteDoc(doc(db, "recruits", selectedRecruit.id));
      setAllRecruits((prev) => prev.filter((r) => r.id !== selectedRecruit.id));
      setSelectedRecruit(null);
      setFormState(null);
      setConfirmDelete(false);
      setSaveMessage("");
    } catch (e) {
      console.error("Admin recruit delete error:", e);
      setSaveMessage("Failed to delete — check console.");
    } finally {
      setRemoving(false);
    }
  };

  const handlePromote = async () => {
    if (!selectedRecruit || isNew || !formState) return;
    if (formState.RecruitClass !== PROMOTABLE_RECRUIT_CLASS) return;
    if (selectedRecruit.promotedPlayerId) return;
    setPromoting(true);
    setSaveMessage("");
    try {
      const draftClass = draftClassForRecruitClass(formState.RecruitClass);
      const baseSlug = generateSlug(formState.First, formState.Last, formState.Position, draftClass);

      const playersSnap = await getDocs(collection(db, "players"));
      const existingSlugs = new Set(playersSnap.docs.map((d) => d.data().Slug).filter(Boolean));
      let slug = baseSlug;
      let n = 1;
      while (existingSlugs.has(slug)) {
        slug = baseSlug + "-" + n;
        n += 1;
      }

      const playerPayload = {
        First: formState.First,
        Last: formState.Last,
        School: formState.Commitment,
        Position: formState.Position,
        Eligible: draftClass,
        Height: formState.Height,
        Weight: formState.Weight,
        Bio: "",
        Flair: formState.Flair,
        Live: true, // recruits no longer track Live themselves — a promoted player goes public immediately
        AdminNotes: formState.AdminNotes,
        Flag: formState.Flag,
        Slug: slug,
        updatedAt: serverTimestamp(),
      };
      const newPlayerRef = await addDoc(collection(db, "players"), playerPayload);

      const promotionFields = { promotedPlayerId: newPlayerRef.id, promotedSlug: slug, promotedAt: serverTimestamp() };
      await updateDoc(doc(db, "recruits", selectedRecruit.id), promotionFields);

      const updated = { ...selectedRecruit, ...formState, ...promotionFields };
      setAllRecruits((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSelectedRecruit(updated);
      setFormState(updated);
      setSaveMessage("Added to We-Draft — slug \"" + slug + "\".");
    } catch (e) {
      console.error("Admin recruit promote error:", e);
      setSaveMessage("Failed to add to We-Draft — check console.");
    } finally {
      setPromoting(false);
    }
  };

  const canPromote = formState && formState.RecruitClass === PROMOTABLE_RECRUIT_CLASS;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Recruits
          </div>
          <button
            onClick={startNewRecruit}
            style={{
              marginLeft: "auto", background: GOLD, color: "#fff", border: "none",
              borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            + Add Recruit
          </button>
        </div>

        <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee", display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name or commitment..."
            style={{ width: "100%", border: "2px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
          />
          <FilterBar label="Recruit Class" options={RECRUIT_CLASSES} selected={selectedClasses} setSelected={setSelectedClasses} />
          <FilterBar label="Position" options={allPositions} selected={selectedPositions} setSelected={setSelectedPositions} />
          <FilterBar label="Recruit Grade" options={RECRUIT_FLAIR_OPTIONS.filter(Boolean)} selected={selectedGrades} setSelected={setSelectedGrades} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-start" }}>
            <DropdownChecklist title="State" options={US_STATES} selected={selectedStates} setSelected={setSelectedStates} />
            <DropdownChecklist title="Commitment" options={fbsSchoolOptions} selected={selectedCommitments} setSelected={setSelectedCommitments} />
          </div>

          {/* Named groups — separate from Flag/Recruit Grade above (a
              recruit can belong to any number of these). Filtering happens
              here; creating/deleting a group and adding/removing this-or-
              that recruit from one both happen in the edit form below (see
              the "Groups" FieldRow), except deleting a group can also be
              done right here so it's not buried inside some recruit's
              form. */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "5px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Groups
              </div>
              {allGroups.length > 0 && (
                <DropdownChecklist title="Filter" options={allGroups.map((g) => g.name)} selected={selectedGroups} setSelected={setSelectedGroups} />
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => { setNewGroupName(e.target.value); setGroupError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && newGroupName.trim()) { handleCreateGroup(newGroupName); setNewGroupName(""); } }}
                placeholder="New group name..."
                style={{ flex: "1 1 160px", minWidth: "140px", border: "2px solid #ddd", borderRadius: "6px", padding: "6px 10px", fontWeight: 700, fontSize: "12px", outline: "none", boxSizing: "border-box" }}
              />
              <button
                onClick={() => { if (newGroupName.trim()) { handleCreateGroup(newGroupName); setNewGroupName(""); } }}
                disabled={!newGroupName.trim()}
                style={{
                  padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  border: "2px solid " + BLUE, borderRadius: "6px",
                  background: BLUE, color: "#fff",
                  cursor: newGroupName.trim() ? "pointer" : "default",
                  opacity: newGroupName.trim() ? 1 : 0.5,
                }}
              >
                + Group
              </button>
            </div>
            {groupError && (
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#c0392b", marginTop: "4px" }}>{groupError}</div>
            )}
            {allGroups.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                {allGroups.map((g) => (
                  <span
                    key={g.id}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "6px",
                      border: "2px solid #ddd", borderRadius: "20px",
                      padding: "4px 6px 4px 12px", fontSize: "11px", fontWeight: 800, color: "#555",
                    }}
                  >
                    {g.name} <span style={{ color: "#aaa", fontWeight: 700 }}>({(g.recruitIds || []).length})</span>
                    <button
                      onClick={() => handleDeleteGroup(g)}
                      title={"Delete \"" + g.name + "\" — recruits are unaffected"}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "18px", height: "18px", borderRadius: "50%",
                        border: "none", background: "#eee", color: "#888",
                        fontSize: "11px", fontWeight: 900, cursor: "pointer", lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <LoadingSpinner label="Loading recruits" size={28} minHeight="100px" />
        ) : filtered.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No recruits match.</div>
        ) : (
          <div style={{ maxHeight: "600px", overflowY: "auto" }}>
            <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
              {filtered.length} recruit{filtered.length !== 1 ? "s" : ""}
            </div>
            {filtered.map((r) => {
              const isSelected = selectedRecruit?.id === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() => selectRecruit(r)}
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
                      {r.Flag && (
                        <span
                          title={r.Flag + " flag"}
                          style={{
                            display: "inline-block", width: "9px", height: "9px", borderRadius: "50%",
                            marginRight: "7px", background: (FLAG_COLORS.find((f) => f.key === r.Flag) || {}).hex || "#999",
                          }}
                        />
                      )}
                      {(r.First || "") + " " + (r.Last || "")}
                      {r.Flair && (
                        <span
                          title={r.Flair}
                          style={{
                            marginLeft: "8px", fontSize: "9px", fontWeight: 900, color: "#fff",
                            background: (RECRUIT_GRADE_COLORS[r.Flair] || {}).bg || "#5F5E5A",
                            border: "1px solid " + ((RECRUIT_GRADE_COLORS[r.Flair] || {}).border || "#444441"),
                            borderRadius: "10px", padding: "1px 6px",
                          }}
                        >
                          {r.Flair}
                        </span>
                      )}
                      {r.promotedPlayerId && (
                        <span style={{ marginLeft: "8px", fontSize: "9px", fontWeight: 900, color: "#2e7d32", border: "1px solid #2e7d32", borderRadius: "10px", padding: "1px 6px" }}>
                          ADDED
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#888" }}>
                      {r.Position || "—"} · {r.Commitment || "—"} · Class of {r.RecruitClass || "—"}
                    </div>
                    {(groupNamesByRecruit.get(r.id) || []).length > 0 && (
                      <div style={{ fontSize: "10px", fontWeight: 700, color: "#7a5c00", marginTop: "2px" }}>
                        🏷 {(groupNamesByRecruit.get(r.id) || []).join(", ")}
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
        <div style={{ background: GOLD, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {isNew ? "New Recruit" : selectedRecruit ? "Edit Recruit" : "Select a Recruit"}
          </div>
          {!isNew && selectedRecruit?.promotedSlug && (
            <a
              href={"/player/" + selectedRecruit.promotedSlug}
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

        {!selectedRecruit || !formState ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click a recruit from the list to edit their record, or "+ Add Recruit" to create one.
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
              <FieldRow label="High School">
                <SchoolCombobox
                  value={formState.HighSchool}
                  onChange={handleHighSchoolChange}
                  options={highSchoolNames}
                  getLabel={highSchoolLabel}
                />
                <div style={{ fontSize: "11px", color: "#999", marginTop: "4px" }}>
                  Type to search saved high schools — picking one fills in State too. A new name is saved automatically the first time you save this recruit.
                </div>
              </FieldRow>
              <FieldRow label="State">
                <select value={formState.State} onChange={(e) => handleFieldChange("State", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Commitment (FBS only)">
                <select value={formState.Commitment} onChange={(e) => handleFieldChange("Commitment", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {fbsSchoolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Position">
                <select value={formState.Position} onChange={(e) => handleFieldChange("Position", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Recruit Class">
                <select value={formState.RecruitClass} onChange={(e) => handleFieldChange("RecruitClass", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {RECRUIT_CLASSES.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
                </select>
                {formState.RecruitClass && (
                  <div style={{ fontSize: "11px", color: "#999", marginTop: "4px" }}>
                    Draft Class: {draftClassForRecruitClass(formState.RecruitClass)}
                    {formState.RecruitClass !== PROMOTABLE_RECRUIT_CLASS && " — not yet promotable (only " + PROMOTABLE_RECRUIT_CLASS + " recruits can be added to We-Draft today)."}
                  </div>
                )}
              </FieldRow>
              <FieldRow label="Height">
                <input value={formState.Height} onChange={(e) => handleFieldChange("Height", e.target.value)} placeholder="e.g. 6'2&quot;" style={inputStyle} />
              </FieldRow>
              <FieldRow label="Weight">
                <input value={formState.Weight} onChange={(e) => handleFieldChange("Weight", e.target.value)} placeholder="e.g. 215" style={inputStyle} />
              </FieldRow>
              <FieldRow label="Flair (recruit grade)">
                <select value={formState.Flair} onChange={(e) => handleFieldChange("Flair", e.target.value)} style={inputStyle}>
                  {RECRUIT_FLAIR_OPTIONS.map((f) => <option key={f} value={f}>{f || "None"}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Film">
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    value={formState.Film}
                    onChange={(e) => handleFieldChange("Film", e.target.value)}
                    placeholder="https://..."
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  {formState.Film ? (
                    <a
                      href={formState.Film}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        flexShrink: 0, display: "flex", alignItems: "center", gap: "5px",
                        background: BLUE, color: "#fff", border: "none",
                        borderRadius: "6px", padding: "0 12px", fontWeight: 900, fontSize: "12px",
                        textTransform: "uppercase", letterSpacing: "0.04em", textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      🎥 Film ↗
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      style={{
                        flexShrink: 0, background: "#eee", color: "#999", border: "none",
                        borderRadius: "6px", padding: "0 12px", fontWeight: 900, fontSize: "12px",
                        textTransform: "uppercase", letterSpacing: "0.04em", cursor: "default",
                      }}
                    >
                      🎥 Film
                    </button>
                  )}
                </div>
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
              {/* New recruits don't have a Firestore doc id yet to attach
                  memberships to — save the recruit first, then this appears
                  on re-opening it. Creating a brand-new group from here
                  (rather than the filter bar above) adds this recruit to it
                  immediately, in the same write. */}
              {!isNew && (
                <FieldRow label="Groups">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {allGroups.map((g) => {
                      const active = (g.recruitIds || []).includes(selectedRecruit.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => handleToggleGroupMembership(g, selectedRecruit.id)}
                          style={{
                            padding: "6px 14px", fontWeight: 900, fontSize: "12px",
                            textTransform: "uppercase", letterSpacing: "0.04em",
                            border: "2px solid " + BLUE, borderRadius: "20px", cursor: "pointer",
                            background: active ? BLUE : "#fff",
                            color: active ? "#fff" : BLUE,
                          }}
                        >
                          {active ? "✓ " : "+ "}{g.name}
                        </button>
                      );
                    })}
                    {allGroups.length === 0 && (
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#999" }}>
                        No groups yet — create one above the recruit list.
                      </div>
                    )}
                  </div>
                </FieldRow>
              )}
              <FieldRow label="Admin Notes (internal only)">
                <textarea
                  value={formState.AdminNotes}
                  onChange={(e) => handleFieldChange("AdminNotes", e.target.value)}
                  placeholder="Internal notes — not shown anywhere public"
                  style={{ ...inputStyle, height: "80px", resize: "vertical", fontFamily: "inherit" }}
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
              {saving ? "Saving..." : isNew ? "Create Recruit" : "Save Changes"}
            </button>

            {!isNew && (
              <div style={{ marginTop: "10px" }}>
                {selectedRecruit.promotedPlayerId ? (
                  <div style={{
                    width: "100%", textAlign: "center", background: "#eafaf0", color: "#2e7d32",
                    border: "2px solid #2e7d32", borderRadius: "8px", padding: "10px",
                    fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em",
                  }}>
                    ✅ Added — <a href={"/player/" + selectedRecruit.promotedSlug} target="_blank" rel="noopener noreferrer" style={{ color: "#2e7d32" }}>View Page ↗</a>
                  </div>
                ) : (
                  <button
                    onClick={handlePromote}
                    disabled={!canPromote || promoting}
                    title={canPromote ? "" : "Only " + PROMOTABLE_RECRUIT_CLASS + " recruits can be added to We-Draft today."}
                    style={{
                      width: "100%", background: canPromote ? GOLD : "#eee", color: canPromote ? "#fff" : "#999",
                      border: "2px solid " + (canPromote ? BLUE : "#ddd"),
                      borderRadius: "8px", padding: "12px", fontWeight: 900, fontSize: "13px",
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      cursor: canPromote && !promoting ? "pointer" : "default",
                      opacity: promoting ? 0.6 : 1,
                    }}
                  >
                    {promoting ? "Adding..." : "Add to We-Draft"}
                  </button>
                )}
              </div>
            )}

            {saveMessage && (
              <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") || saveMessage.includes("required") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}

            {!isNew && (
              <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
                {confirmDelete ? (
                  <div style={{ border: "2px solid #c0392b", borderRadius: "8px", padding: "12px", background: "#fff3f0" }}>
                    <div style={{ fontWeight: 900, fontSize: "12px", color: "#a52a1e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>
                      ⚠ Permanently delete {(selectedRecruit.First || "") + " " + (selectedRecruit.Last || "")}?
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#666", marginBottom: "12px" }}>
                      This removes the recruit record{selectedRecruit.promotedPlayerId ? " (their promoted player page is unaffected)" : ""} and cannot be undone.
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
                    Delete Recruit
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

function TrendBadge({ value }) {
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
  if (lower === "on fire") {
    return (
      <span style={{ fontSize: "10px", fontWeight: 900, color: "#c2410c", background: "#fff1e6", border: "1px solid #ff9d4d", borderRadius: "10px", padding: "2px 8px", textTransform: "uppercase" }}>
        🔥 On Fire
      </span>
    );
  }
  return (
    <span style={{ fontSize: "10px", fontWeight: 900, color: "#666", background: "#f0f0f0", border: "1px solid #ddd", borderRadius: "10px", padding: "2px 8px", textTransform: "uppercase" }}>
      {value}
    </span>
  );
}

// ── One draggable row inside the Active Trends panel. The grip handle (⠿)
// is the only part wired to dnd-kit's listeners — the row itself keeps its
// plain onClick to select the player, so a normal click still works instead
// of being swallowed by drag-gesture detection. Dragging persists a new
// Order value for every active trend (see handleTrendDragEnd in
// TrendsSection), which is what the public player pages' "Top 5 Trending"
// spotlight sorts by. ──
function SortableTrendRow({ trend, isSelected, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: trend.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      onClick={onSelect}
      style={{
        ...style,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
        padding: "9px 14px", cursor: "pointer",
        background: isSelected ? "#eaf1ff" : "#fff",
        borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
        borderBottom: "1px solid #f0f0f0",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
        <span
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
          style={{ cursor: "grab", color: "#bbb", fontSize: "14px", flexShrink: 0, touchAction: "none", padding: "4px" }}
        >
          ⠿
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>
            {(trend.First || "") + " " + (trend.Last || "")}
          </div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
            {trend.Position || "—"} · {trend.School || "—"} · {trend.Eligible || "—"}
          </div>
        </div>
      </div>
      <TrendBadge value={trend.Trend} />
    </div>
  );
}

// ── A non-draggable row for the "Not Shown" section — visually identical to
// SortableTrendRow minus the grip handle, since membership (shown vs. not)
// is now set via the dropdown in the edit panel rather than by dragging a
// trend across a section boundary (that cross-container drag was unreliable
// — see the "Show on Player Pages" field in TrendsSection instead). ──
function PlainTrendRow({ trend, isSelected, onSelect }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
        padding: "9px 14px 9px 24px", cursor: "pointer",
        background: isSelected ? "#eaf1ff" : "#fff",
        borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
        borderBottom: "1px solid #f0f0f0",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>
          {(trend.First || "") + " " + (trend.Last || "")}
        </div>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
          {trend.Position || "—"} · {trend.School || "—"} · {trend.Eligible || "—"}
        </div>
      </div>
      <TrendBadge value={trend.Trend} />
    </div>
  );
}

// ── The "Showing on Player Pages" section — drag-to-reorder only (order
// within the top 5 still matters for the public spotlight), no cross-section
// dropping. The "Not Shown" section renders as a plain, non-draggable list. ──
function TrendSection({ label, sublabel, accentColor, items, selectedId, onSelect, emptyLabel, maxHeight, sortable }) {
  return (
    <div>
      <div style={{ padding: "8px 14px", background: "#f7f8fa", borderBottom: "1px solid #eee" }}>
        <div style={{ fontSize: "11px", fontWeight: 900, color: accentColor, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </div>
        {sublabel && (
          <div style={{ fontSize: "10px", fontWeight: 700, color: "#999", marginTop: "1px" }}>{sublabel}</div>
        )}
      </div>
      <div style={{ maxHeight: maxHeight || undefined, overflowY: maxHeight ? "auto" : undefined }}>
        {items.length === 0 ? (
          <div style={{ padding: "16px 14px", textAlign: "center", color: "#bbb", fontWeight: 700, fontSize: "12px", fontStyle: "italic" }}>
            {emptyLabel}
          </div>
        ) : sortable ? (
          <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {items.map((t) => (
              <SortableTrendRow key={t.id} trend={t} isSelected={selectedId === t.id} onSelect={() => onSelect(t)} />
            ))}
          </SortableContext>
        ) : (
          items.map((t) => (
            <PlainTrendRow key={t.id} trend={t} isSelected={selectedId === t.id} onSelect={() => onSelect(t)} />
          ))
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

  // Every player currently carrying a trend, joined against allPlayers so
  // the summary panel can show name/position/school without a second read —
  // trends is keyed by Slug, so this only surfaces trends whose player is
  // still in the currently-loaded (active-years) roster. `Shown` (an
  // explicit boolean, set via the "Show on Player Pages" dropdown below) is
  // the actual source of truth for membership — NOT array position. An
  // earlier version inferred "shown" purely from being among the first
  // TOP5_LIMIT by Order, which silently broke as soon as there were fewer
  // than 5 total active trends: with only 4 trends, every one of them is
  // "first 5 by position" whether an admin wants it featured or not, so
  // there was no way to actually exclude one. Order only breaks ties within
  // whichever bucket (shown/bench) a trend is already in.
  const activeTrends = useMemo(() => {
    const TREND_ORDER = { Breakout: 0, "On Fire": 1, Up: 2 };
    const list = [];
    allPlayers.forEach((p) => {
      if (!p.Slug) return;
      const t = trendsMap.get(p.Slug);
      if (t?.Trend) list.push({ ...p, Trend: t.Trend, Notes: t.Notes || "", Order: t.Order, Shown: t.Shown === true });
    });
    list.sort((a, b) => {
      const aHasOrder = typeof a.Order === "number";
      const bHasOrder = typeof b.Order === "number";
      if (aHasOrder && bHasOrder) return a.Order - b.Order;
      if (aHasOrder) return -1;
      if (bHasOrder) return 1;
      const ao = TREND_ORDER[a.Trend] ?? 2;
      const bo = TREND_ORDER[b.Trend] ?? 2;
      if (ao !== bo) return ao - bo;
      return (a.Last || "").localeCompare(b.Last || "");
    });
    return list;
  }, [allPlayers, trendsMap]);

  // The public player pages read every trend with Shown === true (ordered
  // by Order among themselves), capped at TOP5_LIMIT — everything else is
  // "active" (still shown in the admin list/badges) but not featured in the
  // public spotlight. Membership is set via the "Show on Player Pages"
  // dropdown in the edit panel below (see handleSave) rather than by
  // dragging a trend across a section boundary — that cross-list drag
  // turned out to be unreliable right at the boundary.
  const TOP5_LIMIT = 5;
  const top5Trends = activeTrends.filter((t) => t.Shown);
  const benchedTrends = activeTrends.filter((t) => !t.Shown);

  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const selectPlayer = (p) => {
    setSelectedPlayer(p);
    const existing = trendsMap.get(p.Slug);
    setFormState({
      Trend: existing?.Trend || "",
      Notes: existing?.Notes || "",
      // A brand-new trend always defaults to "no" — an admin has to
      // deliberately opt a player into the public top group rather than it
      // happening automatically just because there was room left. Only
      // reflects the actual current Shown value once a trend already exists.
      ShowOnPages: existing ? (existing.Shown ? "yes" : "no") : "no",
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
      const existing = trendsMap.get(selectedPlayer.Slug);
      const wasShown = existing?.Shown === true;
      const wantShown = formState.ShowOnPages === "yes";

      // bumpUpdate holds the one OTHER trend that needs to flip to
      // Shown:false as a side effect — only happens when featuring this one
      // would push the shown count above TOP5_LIMIT, in which case the
      // current lowest-priority (highest Order) shown trend gets bumped.
      let order;
      let bumpUpdate = null;

      if (existing && typeof existing.Order === "number" && wasShown === wantShown) {
        // Membership isn't changing — leave this trend's position alone so
        // editing notes/trend type never silently reshuffles the order.
        order = existing.Order;
      } else if (wantShown) {
        const otherShown = top5Trends.filter((t) => t.Slug !== selectedPlayer.Slug);
        if (otherShown.length >= TOP5_LIMIT) {
          const toBump = otherShown.reduce((max, t) => ((t.Order ?? 0) > (max.Order ?? 0) ? t : max), otherShown[0]);
          bumpUpdate = { slug: toBump.Slug };
        }
        const maxOrder = otherShown.reduce((m, t) => Math.max(m, typeof t.Order === "number" ? t.Order : -1), -1);
        order = maxOrder + 1;
      } else {
        const otherBench = benchedTrends.filter((t) => t.Slug !== selectedPlayer.Slug);
        const maxOrder = otherBench.reduce((m, t) => Math.max(m, typeof t.Order === "number" ? t.Order : -1), -1);
        order = maxOrder + 1;
      }

      // First/Last/Position/School/Eligible are denormalized onto the trend
      // doc so the public player-page "Top 5 Trending" panel can render
      // straight from a single trends query instead of a join against
      // players on every page load.
      const payload = {
        Trend: formState.Trend,
        Notes: formState.Notes || "",
        Shown: wantShown,
        Order: order,
        First: selectedPlayer.First || "",
        Last: selectedPlayer.Last || "",
        Position: selectedPlayer.Position || "",
        School: selectedPlayer.School || "",
        Eligible: selectedPlayer.Eligible || "",
      };
      await setDoc(doc(db, "trends", selectedPlayer.Slug), payload);
      if (bumpUpdate) {
        await updateDoc(doc(db, "trends", bumpUpdate.slug), { Shown: false });
      }
      setTrendsMap((prev) => {
        const next = new Map(prev);
        next.set(selectedPlayer.Slug, payload);
        if (bumpUpdate) {
          const cur = next.get(bumpUpdate.slug);
          if (cur) next.set(bumpUpdate.slug, { ...cur, Shown: false });
        }
        return next;
      });
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
      setFormState({ Trend: "", Notes: "", ShowOnPages: "no" });
      setSaveMessage("Trend removed.");
    } catch (e) {
      console.error("Admin trend remove error:", e);
      setSaveMessage("Failed to remove — check console.");
    } finally {
      setRemoving(false);
    }
  };

  // ── Drag-to-reorder only within the "Showing on Player Pages" list — no
  // cross-section dropping (see the "Show on Player Pages" dropdown in the
  // edit panel for moving a trend between sections instead). Since
  // membership is now the explicit Shown field rather than array position,
  // this only ever needs to renumber the shown bucket itself. ──
  const handleTrendDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = top5Trends.findIndex((t) => t.id === active.id);
    const newIndex = top5Trends.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(top5Trends, oldIndex, newIndex);
    const updates = reordered.map((t, i) => ({ slug: t.Slug, Order: i }));

    setTrendsMap((prev) => {
      const next = new Map(prev);
      updates.forEach(({ slug, Order }) => {
        const cur = next.get(slug);
        if (cur) next.set(slug, { ...cur, Order });
      });
      return next;
    });

    try {
      await Promise.all(updates.map(({ slug, Order }) => updateDoc(doc(db, "trends", slug), { Order })));
    } catch (e) {
      console.error("Admin trend reorder error:", e);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ background: GOLD, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Active Trends
            </div>
            <div style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 800, color: "rgba(255,255,255,0.85)" }}>
              {top5Trends.length}/{TOP5_LIMIT} shown · {benchedTrends.length} benched
            </div>
          </div>
          <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa", borderBottom: "1px solid #f0f0f0" }}>
            Drag ⠿ to reorder — use "Show on Player Pages" in the edit panel to move a trend between sections.
          </div>
          {loading ? (
            <LoadingSpinner label="Loading" size={28} minHeight="80px" />
          ) : activeTrends.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
              No active trends — set one below.
            </div>
          ) : (
            <>
              <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleTrendDragEnd}>
                <TrendSection
                  label="Showing on Player Pages"
                  sublabel={"Top " + TOP5_LIMIT + " — order matters"}
                  accentColor={GOLD}
                  items={top5Trends}
                  selectedId={selectedPlayer?.id}
                  onSelect={selectPlayer}
                  emptyLabel='No trends set to "Show on Player Pages" yet.'
                  sortable
                />
              </DndContext>
              <TrendSection
                label="Not Shown"
                sublabel="Active, but not in the spotlight"
                accentColor="#888"
                items={benchedTrends}
                selectedId={selectedPlayer?.id}
                onSelect={selectPlayer}
                emptyLabel="Nothing benched."
                maxHeight="220px"
              />
            </>
          )}
        </div>

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
            <LoadingSpinner label="Loading" size={28} minHeight="100px" />
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
                  <option value="On Fire">🔥 On Fire</option>
                </select>
              </FieldRow>
              <FieldRow label="Show on Player Pages">
                <select
                  value={formState.ShowOnPages}
                  onChange={(e) => setFormState((prev) => ({ ...prev, ShowOnPages: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="yes">Yes — in the Top {TOP5_LIMIT} spotlight</option>
                  <option value="no">No — active, but not shown</option>
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
        <LoadingSpinner label="Loading" size={28} minHeight="140px" />
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
          <LoadingSpinner label="Loading" size={28} minHeight="100px" />
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

const REQUEST_TABS = [
  { key: "playerRequests", label: "Player Requests" },
  { key: "issueReports", label: "Issue Reports" },
];

// ── Requests section — surfaces the two "Request a Player" / "Report an
// Issue" forms on UserProfile.js, which previously wrote to Firestore
// (playerRequests / userReports) with no admin-facing UI at all — every
// submission landed invisibly. Read-only list + delete (once handled,
// clear it out — there's no "resolved" status field, just presence in the
// collection, matching how lightweight this was designed to be on the
// submit side too). ──
function RequestsSection() {
  const [activeTab, setActiveTab] = useState("playerRequests");
  const [playerRequests, setPlayerRequests] = useState([]);
  const [issueReports, setIssueReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchErrors, setFetchErrors] = useState([]);
  const [removingId, setRemovingId] = useState(null);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setFetchErrors([]);
      const errors = [];
      const [prRes, urRes] = await Promise.allSettled([
        getDocs(collection(db, "playerRequests")),
        getDocs(collection(db, "userReports")),
      ]);

      let prRows = [];
      if (prRes.status === "fulfilled") {
        prRows = prRes.value.docs.map((d) => ({ id: d.id, ...d.data() }));
        prRows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
        setPlayerRequests(prRows);
      } else {
        console.error("Admin player requests fetch error:", prRes.reason);
        setPlayerRequests([]);
        errors.push("Player Requests: " + (prRes.reason?.message || "read failed."));
      }

      let urRows = [];
      if (urRes.status === "fulfilled") {
        urRows = urRes.value.docs.map((d) => ({ id: d.id, ...d.data() }));
        urRows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
        setIssueReports(urRows);
      } else {
        console.error("Admin issue reports fetch error:", urRes.reason);
        setIssueReports([]);
        errors.push("Issue Reports: " + (urRes.reason?.message || "read failed."));
      }

      setFetchErrors(errors);
      setLoading(false);

      // Mark everything just shown as read — a doc with no `read` field at
      // all (every one submitted before this existed) counts as unread too.
      // This is what clears the sidebar's sticker: AdminPanel's own count
      // effect refetches on every activeSection change, so simply writing
      // `read: true` here is enough, no direct call back up to it needed.
      // Fire-and-forget after the list is already showing — a failure here
      // shouldn't block viewing/using the requests that just loaded fine.
      const unreadPr = prRows.filter((r) => r.read !== true);
      const unreadUr = urRows.filter((r) => r.read !== true);
      if (unreadPr.length > 0 || unreadUr.length > 0) {
        try {
          await Promise.all([
            ...unreadPr.map((r) => updateDoc(doc(db, "playerRequests", r.id), { read: true })),
            ...unreadUr.map((r) => updateDoc(doc(db, "userReports", r.id), { read: true })),
          ]);
          if (unreadPr.length > 0) setPlayerRequests((prev) => prev.map((r) => ({ ...r, read: true })));
          if (unreadUr.length > 0) setIssueReports((prev) => prev.map((r) => ({ ...r, read: true })));
        } catch (e) {
          console.error("Admin mark-requests-read error:", e);
        }
      }
    };
    fetchAll();
  }, []);

  const handleDelete = async (collectionName, id, setList, label) => {
    if (!window.confirm("Delete this " + label + "? This cannot be undone.")) return;
    setRemovingId(id);
    try {
      await deleteDoc(doc(db, collectionName, id));
      setList((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error("Admin delete " + collectionName + " error:", e);
      alert("Failed to delete — check console.");
    } finally {
      setRemovingId(null);
    }
  };

  const activeRows = activeTab === "playerRequests" ? playerRequests : issueReports;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        {REQUEST_TABS.map((t) => {
          const count = t.key === "playerRequests" ? playerRequests.length : issueReports.length;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: "9px 18px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.05em",
                border: "2px solid " + BLUE, borderRadius: "8px", cursor: "pointer",
                background: activeTab === t.key ? BLUE : "#fff",
                color: activeTab === t.key ? "#fff" : BLUE,
              }}
            >
              {t.label}{count > 0 ? " (" + count + ")" : ""}
            </button>
          );
        })}
      </div>

      {!loading && fetchErrors.length > 0 && (
        <div style={{ padding: "10px 16px", background: "#fff3f0", border: "2px solid #c0392b", borderRadius: "8px" }}>
          {fetchErrors.map((msg, i) => (
            <div key={i} style={{ fontSize: "12px", fontWeight: 700, color: "#a52a1e" }}>⚠ {msg}</div>
          ))}
        </div>
      )}

      {loading ? (
        <LoadingSpinner label="Loading requests" size={28} minHeight="100px" />
      ) : activeRows.length === 0 ? (
        <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
          {activeTab === "playerRequests" ? "No player requests." : "No issue reports."}
        </div>
      ) : (
        <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: BLUE }}>
                  {activeTab === "playerRequests" ? (
                    <>
                      <th style={thStyle}>Player</th>
                      <th style={thStyle}>School</th>
                      <th style={thStyle}>Position</th>
                      <th style={thStyle}>Requested By</th>
                      <th style={thStyle}>Date</th>
                    </>
                  ) : (
                    <>
                      <th style={thStyle}>Message</th>
                      <th style={thStyle}>Submitted By</th>
                      <th style={thStyle}>Date</th>
                    </>
                  )}
                  <th style={{ ...thStyle, textAlign: "right" }}></th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((r, i) => {
                  const dateMs = toMs(r.createdAt);
                  const collectionName = activeTab === "playerRequests" ? "playerRequests" : "userReports";
                  const setList = activeTab === "playerRequests" ? setPlayerRequests : setIssueReports;
                  const label = activeTab === "playerRequests" ? "player request" : "report";
                  // Reflects local state (already flipped to true right after
                  // fetch's mark-as-read call succeeds, see the effect above)
                  // rather than re-checking Firestore, so this tag disappears
                  // for the whole batch the instant that write resolves.
                  const isUnread = r.read !== true;
                  const newTag = isUnread && (
                    <span style={{
                      display: "inline-block", marginLeft: "8px", fontSize: "9px", fontWeight: 900,
                      color: "#fff", background: "#c0392b", borderRadius: "10px", padding: "2px 6px",
                      textTransform: "uppercase", letterSpacing: "0.04em", verticalAlign: "middle",
                    }}>
                      New
                    </span>
                  );
                  return (
                    <tr key={r.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc", borderBottom: "1px solid #f0f0f0" }}>
                      {activeTab === "playerRequests" ? (
                        <>
                          <td style={tdStyle}>{r.playerName || "—"}{newTag}</td>
                          <td style={tdStyle}>{r.school || "—"}</td>
                          <td style={tdStyle}>{r.position || "—"}</td>
                          <td style={tdStyle}>{r.email || "—"}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dateMs > 0 ? new Date(dateMs).toLocaleDateString() : "—"}</td>
                        </>
                      ) : (
                        <>
                          <td style={{ ...tdStyle, maxWidth: "420px", whiteSpace: "pre-wrap" }}>{r.message || "—"}{newTag}</td>
                          <td style={tdStyle}>{r.email || "—"}</td>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dateMs > 0 ? new Date(dateMs).toLocaleDateString() : "—"}</td>
                        </>
                      )}
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button
                          onClick={() => handleDelete(collectionName, r.id, setList, label)}
                          disabled={removingId === r.id}
                          style={{
                            background: "none", border: "2px solid #ddd", borderRadius: "6px",
                            color: "#999", cursor: removingId === r.id ? "default" : "pointer",
                            fontSize: "11px", fontWeight: 800, padding: "5px 10px",
                            textTransform: "uppercase", letterSpacing: "0.04em",
                          }}
                        >
                          {removingId === r.id ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: "9px 10px", fontSize: "10px", fontWeight: 900, color: "#fff",
  textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap",
};
const tdStyle = {
  padding: "9px 10px", fontSize: "12px", fontWeight: 700, color: "#666",
};

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
// Top-level tabs inside the Analytics section — "Overview" is everything
// that already existed (stat cards, page-view totals, the evals/signups
// chart, and the Players & Evaluations table); Games/Performances/Articles
// are new, each backed by ContentAnalyticsTable + CONTENT_ANALYTICS_CONFIG
// further down this file.
const CONTENT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "game", label: "Games" },
  { key: "performance", label: "Performances" },
  { key: "article", label: "Articles" },
];

function AnalyticsSection() {
  const [activeTab, setActiveTab] = useState("overview");
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
        // Player-only — the analytics collection now also holds game/
        // performance/article docs (namespaced as "{type}_{slug}", see
        // syncGoogleAnalytics.js), each with its own tab below. A doc with
        // no `type` at all predates that field and is still a player doc.
        let last24 = 0, last7 = 0, last30 = 0, total = 0, lastSyncedMs = 0, playerCount = 0;
        analyticsRes.value.docs.forEach((d) => {
          const data = d.data();
          if (data.type && data.type !== "player") return;
          playerCount++;
          const pv = data.pageViews || {};
          last24 += Number(pv.last24Hours) || 0;
          last7 += Number(pv.last7Days) || 0;
          last30 += Number(pv.last30Days) || 0;
          total += Number(pv.total) || 0;
          const ms = toMs(data.updatedAt);
          if (ms > lastSyncedMs) lastSyncedMs = ms;
        });
        setPageViewTotals({ last24, last7, last30, total, lastSyncedMs, playerCount });
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
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {CONTENT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "9px 18px", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.05em",
              border: "2px solid " + BLUE, borderRadius: "8px", cursor: "pointer",
              background: activeTab === t.key ? BLUE : "#fff",
              color: activeTab === t.key ? "#fff" : BLUE,
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab !== "overview" && <ContentAnalyticsTable type={activeTab} />}

      {activeTab === "overview" && (
      <>
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
      </>
      )}
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
        <LoadingSpinner label="Loading" size={28} minHeight="100px" />
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

// ── Source-collection readers for the Games/Performances/Articles analytics
// tabs — each returns a flat { slug, title, subtitle, dateMs } row. Kept
// separate per type since each source collection has a completely
// different shape; ContentAnalyticsTable below joins whatever comes back
// against analytics docs by slug. ──
async function fetchGameRows() {
  const snap = await getDocs(collection(db, "schedule26"));
  return snap.docs
    .map((d) => d.data())
    .filter((g) => g.Slug)
    .map((g) => ({
      slug: g.Slug,
      title: `${g.Away || "?"} @ ${g.Home || "?"}`,
      subtitle: [g.Week, g.Final ? "Final" : null].filter(Boolean).join(" · "),
      dateMs: toMs(g.Date),
    }));
}

async function fetchPerformanceRows() {
  const snap = await getDocs(collection(db, "performances"));
  return snap.docs
    .map((d) => d.data())
    .filter((p) => p.slug)
    .map((p) => ({
      slug: p.slug,
      title: p.titleShort || p.titleLong || "Untitled performance",
      subtitle: p.playerName || "",
      dateMs: toMs(p.createdAt) || toMs(p.gameDate),
    }));
}

async function fetchArticleRows() {
  // Articles and plain news items both serve from the same /news/:slug
  // route (see NewsArticle.jsx) and both get tracked under the "article"
  // analytics type (see syncGoogleAnalytics.js), so both source
  // collections are read and merged here.
  const [articlesSnap, newsSnap] = await Promise.all([
    getDocs(collection(db, "articles")),
    getDocs(collection(db, "news")),
  ]);
  const articleRows = articlesSnap.docs
    .map((d) => d.data())
    .filter((a) => a.slug)
    .map((a) => ({
      slug: a.slug,
      title: a.title || "Untitled article",
      subtitle: a.author ? "By " + a.author : "Article",
      dateMs: toMs(a.publishedAt),
    }));
  const newsRows = newsSnap.docs
    .map((d) => d.data())
    .filter((n) => n.slug)
    .map((n) => ({
      slug: n.slug,
      title: n.title || "Untitled",
      subtitle: "News",
      dateMs: toMs(n.publishedAt),
    }));
  return [...articleRows, ...newsRows];
}

const CONTENT_ANALYTICS_CONFIG = {
  game: { label: "Games", noun: "game", publicPrefix: "/game/", fetchRows: fetchGameRows },
  performance: { label: "Performances", noun: "performance", publicPrefix: "/performance/", fetchRows: fetchPerformanceRows },
  article: { label: "Articles", noun: "article", publicPrefix: "/news/", fetchRows: fetchArticleRows },
};

// ── Games/Performances/Articles page-view table — one reusable component
// driven by CONTENT_ANALYTICS_CONFIG, joined against the analytics
// collection's type-namespaced docs (analytics/{type}_{slug}, see
// syncGoogleAnalytics.js) by their `slug` field rather than doc id, since
// the doc id carries the type prefix this query already filtered on. Same
// range/sort/search conventions as PlayerEvaluationsTable above, minus the
// player-only filters (school/year/position) that don't apply here. ──
function ContentAnalyticsTable({ type }) {
  const config = CONTENT_ANALYTICS_CONFIG[type];
  const [rows, setRows] = useState([]);
  const [pageViewsBySlug, setPageViewsBySlug] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [fetchErrors, setFetchErrors] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState("views");
  const [sortDir, setSortDir] = useState("desc");
  const [rangeDays, setRangeDays] = useState(null); // null = All Time

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setFetchErrors([]);
      const errors = [];
      const [rowsRes, analyticsRes] = await Promise.allSettled([
        config.fetchRows(),
        getDocs(query(collection(db, "analytics"), where("type", "==", type))),
      ]);

      if (rowsRes.status === "fulfilled") {
        setRows(rowsRes.value);
      } else {
        console.error(`Admin ${type} analytics rows fetch error:`, rowsRes.reason);
        setRows([]);
        errors.push(config.label + ": " + (rowsRes.reason?.message || "read failed."));
      }

      if (analyticsRes.status === "fulfilled") {
        const map = new Map();
        analyticsRes.value.docs.forEach((d) => {
          const data = d.data();
          if (data.slug) map.set(data.slug, data.pageViews || {});
        });
        setPageViewsBySlug(map);
      } else {
        console.error(`Admin ${type} analytics page-views fetch error:`, analyticsRes.reason);
        setPageViewsBySlug(new Map());
        errors.push("Page Views: " + (analyticsRes.reason?.message || "read failed."));
      }

      setFetchErrors(errors);
      setLoading(false);
    };
    fetchAll();
    // `config` is a stable lookup (CONTENT_ANALYTICS_CONFIG[type]) that only
    // ever changes when `type` does, so `type` alone is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const viewField = rangeDays == null ? "total" : VIEW_FIELD_BY_RANGE_DAYS[rangeDays];

  // Undefined (not 0) means this window hasn't synced for this slug yet —
  // e.g. it's a brand-new page, or predates the sync script tracking this
  // type at all — so it renders as "—" rather than a misleading zero.
  const withViews = useMemo(() => {
    return rows.map((r) => {
      const pv = pageViewsBySlug.get(r.slug);
      const viewsRaw = pv ? pv[viewField] : null;
      return { ...r, views: viewsRaw != null ? (Number(viewsRaw) || 0) : null };
    });
  }, [rows, pageViewsBySlug, viewField]);

  const filtered = useMemo(() => {
    let list = withViews;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((r) =>
        (r.title || "").toLowerCase().includes(q) ||
        (r.subtitle || "").toLowerCase().includes(q) ||
        (r.slug || "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      let av, bv;
      if (sortKey === "title") { av = a.title || ""; bv = b.title || ""; }
      else if (sortKey === "date") { av = a.dateMs || 0; bv = b.dateMs || 0; }
      else { av = a.views ?? -1; bv = b.views ?? -1; }
      if (typeof av === "string") {
        const cmp = av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [withViews, searchQuery, sortKey, sortDir]);

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
          {config.label} — Page Views
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

      <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee" }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={"Search " + config.noun + "s..."}
          style={inputStyle}
        />
      </div>

      {!loading && fetchErrors.length > 0 && (
        <div style={{ padding: "10px 16px", background: "#fff3f0", borderBottom: "2px solid #c0392b" }}>
          {fetchErrors.map((msg, i) => (
            <div key={i} style={{ fontSize: "12px", fontWeight: 700, color: "#a52a1e" }}>⚠ {msg}</div>
          ))}
        </div>
      )}

      {loading ? (
        <LoadingSpinner label="Loading" size={28} minHeight="100px" />
      ) : filtered.length === 0 ? (
        <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
          No {config.noun}s match.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
            {filtered.length} {config.noun}{filtered.length !== 1 ? "s" : ""}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: BLUE }}>
                <SortHeader label="Title" sortId="title" />
                <th style={{ padding: "9px 10px", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap" }}>Details</th>
                <SortHeader label="Date" sortId="date" align="right" />
                <SortHeader label={"Views (" + rangeLabel + ")"} sortId="views" align="center" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={type + "-" + r.slug + "-" + i} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc", borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "9px 10px", fontWeight: 900, fontSize: "13px" }}>
                    <a href={config.publicPrefix + r.slug} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, textDecoration: "none" }}>
                      {r.title}
                    </a>
                  </td>
                  <td style={{ padding: "9px 10px", fontSize: "12px", fontWeight: 700, color: "#666" }}>{r.subtitle || "—"}</td>
                  <td style={{ padding: "9px 10px", fontSize: "11px", fontWeight: 700, color: "#999", textAlign: "right", whiteSpace: "nowrap" }}>
                    {r.dateMs > 0 ? new Date(r.dateMs).toLocaleDateString() : "—"}
                  </td>
                  <td style={{ padding: "9px 10px", fontSize: "13px", fontWeight: 900, color: r.views != null && r.views > 0 ? BLUE : "#ccc", textAlign: "center" }}>
                    {r.views != null ? r.views.toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── CFB Schedule — direct editor for the schedule26 collection (each doc is
// one game: Home, Away, Date, Week, optional Home/AwayScore once played).
// This is the same collection TeamPage.js reads for its Schedule sidebar and
// PerformancesManager.js reads to list a player's games — editing here is
// the only way to fix a wrong score/date/matchup short of going into the
// Firebase console directly. ──
const BLANK_GAME_FORM = {
  // Channel holds the TV channel's Name (matching tvChannels/{doc}.Name) —
  // same "reference by name, not doc id" convention Home/Away already use
  // for schools — so GamePage.js can look up that channel's logos with a
  // plain equality check, no id plumbing needed. See Misc Branding
  // (MiscBrandingSection) for where channels/logos actually get managed.
  Home: "", Away: "", Date: "", Time: "", Week: "", Channel: "", Neutral: false, HomeScore: "", AwayScore: "",
  // GameOfWeek is a separate, higher tier than Featured (see GamePage.js's
  // ribbon — GameOfWeek shows a bigger, fire-themed one instead of the gold
  // Featured one when both are set) rather than replacing it, so a game can
  // be Featured most weeks and additionally called out as THE game some weeks.
  Featured: false, GameOfWeek: false, Final: false, Notes: "",
  KeyPlayersHome: [], KeyPlayersAway: [], KeyPlayerNotes: {},
  // Score picks (GamePage.js's "Make Your Pick") normally unlock the Monday
  // before the game's own week and lock again once it's Final — this lets
  // an admin override that and open picks early for a specific game.
  PicksForceOpen: false,
  // Excludes this game from We-Pick's ranked "Pick 6" lineup (WePickHub.js)
  // — still fully pickable for unranked score/winner picks either way, this
  // only gates ranked eligibility (e.g. a lopsided or otherwise uninteresting
  // matchup an admin doesn't want counting toward the leaderboard).
  RankedDisqualified: false,
};

const weekNumber = (w) => {
  const m = /(\d+)/.exec(w || "");
  return m ? Number(m[1]) : 999;
};

const createSlug = (text) => (text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");

// Individual game page slug — "away-vs-home-month-day-year", e.g.
// "florida-state-vs-miami-10-29-2026" — the year keeps an annual rivalry
// (same two teams, same month/day every year) from colliding across
// seasons. Matches the schedule's own "Away at Home" ordering, just with
// the away team leading here too. Recomputed from scratch on every save
// (rather than only set once) so a corrected matchup/date always keeps the
// slug in sync — nothing else derives an identity from the old slug, since
// the doc ID (not the slug) is the canonical foreign key every other
// collection (performances) points at. Every existing game was also
// one-time backfilled to a year-inclusive slug (previously only games
// saved after this function was added got one) via a script run directly
// against schedule26 — no schedule26 doc should be missing the year now.
const gameSlugFor = (away, home, dateInputValue) => {
  const parts = [createSlug(away), "vs", createSlug(home)];
  if (dateInputValue) {
    // dateInputValue is an <input type="date"> value: "YYYY-MM-DD".
    const [y, m, d] = dateInputValue.split("-");
    if (m && d) parts.push(`${Number(m)}-${Number(d)}`);
    if (y) parts.push(y);
  }
  return parts.filter(Boolean).join("-");
};

// Games within a day have no natural order until a kickoff Time is entered
// (the Date field alone is always midnight — see handleSave below) — this
// layers the optional Time on top of the date for a real chronological sort,
// and games without a Time just sort to the start of their day rather than
// blocking the rest of the week from ordering correctly.
const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};
const formatTime12h = (t) => {
  const mins = timeToMinutes(t);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
};
const gameSortMs = (g) => {
  const mins = timeToMinutes(g.Time);
  return toMs(g.Date) + (mins != null ? mins * 60000 : 0);
};

// Renders the current Key Players selections — one row per player rather
// than PerformancesManager.js's compact flex-wrap pill, since each one now
// also carries an optional note (shown on GamePage.js when that player's
// row is hovered) that needs room for a text field.
function KeyPlayersChips({ playerIds, allPlayers, onRemove, notes, onNoteChange }) {
  if (!playerIds.length) return null;
  const byId = new Map(allPlayers.map((p) => [p.id, p]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
      {playerIds.map((pid) => {
        const p = byId.get(pid);
        return (
          <div key={pid} style={{ background: "#f5f5f5", border: "2px solid #ddd", borderRadius: "8px", padding: "6px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
              <span style={{ flex: 1, fontSize: "12px", fontWeight: 800, color: "#555" }}>{p ? `${p.First} ${p.Last}` : "Unknown"}</span>
              <button
                type="button"
                onClick={() => onRemove(pid)}
                style={{ background: "none", border: "none", color: "#999", fontWeight: 900, fontSize: "14px", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <input
              value={notes[pid] || ""}
              onChange={(e) => onNoteChange(pid, e.target.value)}
              placeholder="Note shown when hovered on the game page (optional)..."
              style={{ ...inputStyle, fontSize: "11px", padding: "5px 8px" }}
            />
          </div>
        );
      })}
    </div>
  );
}

// Key Players are meant to be the future draft picks worth watching in a
// given matchup, not every senior on the roster — restricted to the three
// classes still actively evaluated as prospects (this season's true
// freshmen through juniors), same as the CFB rankings' upcoming-class scope.
const KEY_PLAYER_ELIGIBLE_YEARS = ["2027", "2028", "2029"];

// Search-and-add combobox scoped to one team's roster (School) — used
// twice per game (Away/Home) to pick that side's Key Players. Disabled
// until a school is chosen for that side, since "key players" without a
// team to filter by would just be the entire ~4,000-player database.
function KeyPlayersCombobox({ school, excludeIds, players, onAdd }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const roster = players.filter((p) => p.School === school && KEY_PLAYER_ELIGIBLE_YEARS.includes(p.Eligible));
  const q = query.trim().toLowerCase();
  const excluded = new Set(excludeIds);
  const filtered = (q
    ? roster.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q))
    : roster
  ).filter((p) => !excluded.has(p.id)).slice(0, 8);

  if (!school) {
    return (
      <input disabled placeholder="Select this team first..." style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }} />
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Add a key player..."
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
              key={p.id}
              onClick={() => { onAdd(p.id); setQuery(""); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{p.First} {p.Last}</div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>{p.Position || "—"} · {p.Eligible || "—"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CFBScheduleSection() {
  const [cfbTab, setCfbTab] = useState("schedule");
  const [games, setGames] = useState([]);
  const [schoolNames, setSchoolNames] = useState([]);
  const [channelNames, setChannelNames] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedGame, setSelectedGame] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [gamesSnap, schoolsSnap, playersSnap, channelsSnap] = await Promise.all([
          getDocs(collection(db, "schedule26")),
          getDocs(collection(db, "schools")),
          getDocs(collection(db, "players")),
          getDocs(collection(db, "tvChannels")),
        ]);
        const gameDocs = gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setGames(gameDocs);
        setSchoolNames(schoolsSnap.docs.map((d) => d.data().School).filter(Boolean).sort());
        setAllPlayers(playersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setChannelNames(channelsSnap.docs.map((d) => d.data().Name).filter(Boolean).sort());

        const weeks = Array.from(new Set(gameDocs.map((g) => g.Week).filter(Boolean))).sort((a, b) => weekNumber(a) - weekNumber(b));
        if (weeks.length > 0) setSelectedWeek(weeks[0]);
      } catch (e) {
        console.error("CFB schedule fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const weekOptions = useMemo(
    () => Array.from(new Set(games.map((g) => g.Week).filter(Boolean))).sort((a, b) => weekNumber(a) - weekNumber(b)),
    [games]
  );

  const gamesForWeek = useMemo(() => {
    return games
      .filter((g) => g.Week === selectedWeek)
      .sort((a, b) => (gameSortMs(a) - gameSortMs(b)) || (a.Home || "").localeCompare(b.Home || ""));
  }, [games, selectedWeek]);

  const selectGame = (g) => {
    setSelectedGame(g);
    setFormState({
      Home: g.Home || "", Away: g.Away || "",
      Date: toDateInputValue(g.Date), Time: g.Time || "", Week: g.Week || selectedWeek, Channel: g.Channel || "",
      Neutral: !!g.Neutral,
      HomeScore: g.HomeScore != null ? String(g.HomeScore) : "",
      AwayScore: g.AwayScore != null ? String(g.AwayScore) : "",
      Featured: !!g.Featured,
      GameOfWeek: !!g.GameOfWeek,
      Final: !!g.Final,
      Notes: g.Notes || "",
      KeyPlayersHome: g.KeyPlayersHome || [],
      KeyPlayersAway: g.KeyPlayersAway || [],
      KeyPlayerNotes: g.KeyPlayerNotes || {},
      PicksForceOpen: !!g.PicksForceOpen,
      RankedDisqualified: !!g.RankedDisqualified,
    });
    setSaveMessage("");
  };

  const startNewGame = () => {
    setSelectedGame({ id: null, isNew: true });
    setFormState({ ...BLANK_GAME_FORM, Week: selectedWeek });
    setSaveMessage("");
  };

  const isNew = selectedGame?.isNew === true;

  // "Final" can only be set once both scores are entered — this is the
  // explicit admin action that flips the game (and its public page) from
  // pregame to postgame state, distinct from just having scores typed in.
  const canMarkFinal = formState?.HomeScore?.trim() !== "" && formState?.AwayScore?.trim() !== "";

  const handleSave = async () => {
    if (!formState) return;
    if (!formState.Home.trim() || !formState.Away.trim() || !formState.Week.trim()) {
      setSaveMessage("Failed: Home, Away, and Week are required.");
      return;
    }
    // Date is required too — every game page shows a date/pick-lock date
    // derived from it (see GamePage.js), so a game saved without one would
    // render with a blank masthead date and never unlock for picks.
    if (!formState.Date) {
      setSaveMessage("Failed: Date is required.");
      return;
    }
    if (formState.Final && !canMarkFinal) {
      setSaveMessage("Failed: enter both scores before marking this game Final.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const payload = {
        Home: formState.Home.trim(),
        Away: formState.Away.trim(),
        Week: formState.Week.trim(),
        Neutral: formState.Neutral,
        Featured: formState.Featured,
        GameOfWeek: formState.GameOfWeek,
        PicksForceOpen: formState.PicksForceOpen,
        RankedDisqualified: formState.RankedDisqualified,
        Final: formState.Final && canMarkFinal,
        Notes: formState.Notes || "",
        KeyPlayersHome: formState.KeyPlayersHome,
        KeyPlayersAway: formState.KeyPlayersAway,
        KeyPlayerNotes: formState.KeyPlayerNotes,
        Slug: gameSlugFor(formState.Away.trim(), formState.Home.trim(), formState.Date),
        updatedAt: serverTimestamp(),
      };
      if (formState.Date) payload.Date = new Date(formState.Date);
      // Same delete-vs-omit distinction as the scores below: a cleared
      // kickoff Time on an existing doc has to be explicitly deleted, or
      // updateDoc() just leaves whatever Time was saved before in place.
      let timeCleared = false;
      if (formState.Time) {
        payload.Time = formState.Time;
      } else if (!isNew) {
        payload.Time = deleteField();
        timeCleared = true;
      }
      // Same delete-vs-omit treatment for the TV channel — clearing it back
      // to "— None —" on an existing game has to explicitly remove the
      // field, or it'd just keep showing the old channel's logo forever.
      let channelCleared = false;
      if (formState.Channel) {
        payload.Channel = formState.Channel;
      } else if (!isNew) {
        payload.Channel = deleteField();
        channelCleared = true;
      }
      // Blank scores are simply omitted on a brand-new doc (Firestore
      // rejects `undefined` outright, and there's nothing to remove yet).
      // On an EXISTING doc, though, omitting the key is not the same as
      // clearing it — updateDoc() only touches fields present in the
      // payload, so a blanked-out score previously saved as e.g. 34 would
      // silently stay 34 forever unless explicitly deleted here.
      let homeScoreCleared = false, awayScoreCleared = false;
      if (formState.HomeScore.trim() !== "") {
        payload.HomeScore = Number(formState.HomeScore);
      } else if (!isNew) {
        payload.HomeScore = deleteField();
        homeScoreCleared = true;
      }
      if (formState.AwayScore.trim() !== "") {
        payload.AwayScore = Number(formState.AwayScore);
      } else if (!isNew) {
        payload.AwayScore = deleteField();
        awayScoreCleared = true;
      }

      if (isNew) {
        const newRef = await addDoc(collection(db, "schedule26"), payload);
        const newGame = { id: newRef.id, ...payload };
        setGames((prev) => [...prev, newGame]);
        setSelectedGame(newGame);
        setSaveMessage("Game created.");
      } else {
        await updateDoc(doc(db, "schedule26", selectedGame.id), payload);
        setGames((prev) => prev.map((g) => {
          if (g.id !== selectedGame.id) return g;
          // deleteField() sentinels aren't real values — mirror the
          // deletion in local state instead of spreading the sentinel in.
          const merged = { ...g, ...payload };
          if (homeScoreCleared) delete merged.HomeScore;
          if (awayScoreCleared) delete merged.AwayScore;
          if (timeCleared) delete merged.Time;
          if (channelCleared) delete merged.Channel;
          return merged;
        }));
        setSaveMessage("Saved.");
      }
      if (payload.Week !== selectedWeek) setSelectedWeek(payload.Week);
    } catch (e) {
      console.error("CFB schedule save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedGame || isNew) return;
    if (!window.confirm("Delete this game? This cannot be undone.")) return;
    setRemoving(true);
    setSaveMessage("");
    try {
      await deleteDoc(doc(db, "schedule26", selectedGame.id));
      setGames((prev) => prev.filter((g) => g.id !== selectedGame.id));
      setSelectedGame(null);
      setFormState(null);
    } catch (e) {
      console.error("CFB schedule delete error:", e);
      setSaveMessage("Failed to delete — check console.");
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading" size={28} minHeight="100px" />;

  return (
    <div>
      {/* Internal tab bar — Rivalries lives here alongside the Schedule
          editor (not as its own top-level sidebar section) since it's
          schedule-adjacent metadata (used to badge/flavor individual game
          pages), authored by the same admin working the schedule. */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
        {[["schedule", "📅 Schedule"], ["rivalries", "⚔️ Rivalries"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setCfbTab(key)}
            style={{
              background: cfbTab === key ? BLUE : "#fff", color: cfbTab === key ? "#fff" : BLUE,
              border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "8px 18px",
              fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {cfbTab === "rivalries" ? (
        <RivalriesSection schoolNames={schoolNames} />
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            CFB Schedule
          </div>
          <button
            onClick={startNewGame}
            style={{
              marginLeft: "auto", background: GOLD, color: "#fff", border: "none",
              borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            + New
          </button>
        </div>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee" }}>
          <select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} style={inputStyle}>
            {weekOptions.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>

        {gamesForWeek.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No games in this week.</div>
        ) : (
          <div style={{ maxHeight: "700px", overflowY: "auto" }}>
            {gamesForWeek.map((g) => {
              const isSelected = selectedGame?.id === g.id;
              const played = g.HomeScore != null && g.AwayScore != null;
              // Date-only field is stored as UTC midnight (`new Date("YYYY-MM-DD")`
              // below in handleSave) — formatting it in the viewer's local zone can
              // roll it back a calendar day west of UTC, so pin display to UTC too.
              const dateStr = toMs(g.Date) ? new Date(toMs(g.Date)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "TBD";
              const timeStr = formatTime12h(g.Time);
              return (
                <div
                  key={g.id}
                  onClick={() => selectGame(g)}
                  style={{
                    padding: "10px 14px", cursor: "pointer",
                    background: isSelected ? "#eaf1ff" : "#fff",
                    borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE, display: "flex", alignItems: "center", gap: "5px" }}>
                      {g.GameOfWeek && <span title="Game of the Week">🔥</span>}
                      {g.Featured && <span title="Featured">⭐</span>}
                      {g.Away} at {g.Home}
                      {g.RankedDisqualified && (
                        <span style={{ flexShrink: 0, background: "#eee", color: "#999", fontSize: "9px", fontWeight: 900, padding: "1px 6px", borderRadius: "4px", letterSpacing: "0.03em" }}>
                          NOT QUALIFIED
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#999", flexShrink: 0 }}>{dateStr}{timeStr ? ` · ${timeStr}` : ""}</span>
                  </div>
                  {g.Final && played ? (
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#888", marginTop: "2px" }}>
                      Final: {g.Home} {g.HomeScore} – {g.AwayScore} {g.Away}
                    </div>
                  ) : played ? (
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#c98a00", marginTop: "2px" }}>
                      Score entered, not yet marked Final
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden", position: "sticky", top: "20px" }}>
        <div style={{ background: GOLD, padding: "10px 16px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {isNew ? "New Game" : selectedGame ? "Edit Game" : "Select a Game"}
          </div>
        </div>

        {!selectedGame || !formState ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click a game from the list to edit it, or "+ New" to add one to {selectedWeek || "a week"}.
          </div>
        ) : (
          <div style={{ padding: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Away</div>
                <SchoolCombobox value={formState.Away} onChange={(v) => setFormState((p) => ({ ...p, Away: v }))} options={schoolNames} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Home</div>
                <SchoolCombobox value={formState.Home} onChange={(v) => setFormState((p) => ({ ...p, Home: v }))} options={schoolNames} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Date</div>
                <input type="date" value={formState.Date} onChange={(e) => setFormState((p) => ({ ...p, Date: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Kickoff Time (optional)</div>
                <input type="time" value={formState.Time} onChange={(e) => setFormState((p) => ({ ...p, Time: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Week</div>
                <input value={formState.Week} onChange={(e) => setFormState((p) => ({ ...p, Week: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                {/* Names come from tvChannels (Misc Branding, MiscBrandingSection)
                    — GamePage.js looks up that channel's dark logo by this
                    same Name to show under the at/vs button. */}
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>TV Channel</div>
                <select value={formState.Channel} onChange={(e) => setFormState((p) => ({ ...p, Channel: e.target.value }))} style={inputStyle}>
                  <option value="">— None —</option>
                  {channelNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Away Score</div>
                <input type="number" value={formState.AwayScore} onChange={(e) => setFormState((p) => ({ ...p, AwayScore: e.target.value }))} placeholder="—" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Home Score</div>
                <input type="number" value={formState.HomeScore} onChange={(e) => setFormState((p) => ({ ...p, HomeScore: e.target.value }))} placeholder="—" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "flex", gap: "20px", marginBottom: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input type="checkbox" checked={formState.Neutral} onChange={(e) => setFormState((p) => ({ ...p, Neutral: e.target.checked }))} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>Neutral site</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input type="checkbox" checked={formState.Featured} onChange={(e) => setFormState((p) => ({ ...p, Featured: e.target.checked }))} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>⭐ Featured game</span>
              </label>
              {/* A separate, higher tier than Featured (see GamePage.js's
                  ribbon) rather than a replacement — a game can be Featured
                  most weeks and additionally called out as THE game some
                  weeks. */}
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input type="checkbox" checked={formState.GameOfWeek} onChange={(e) => setFormState((p) => ({ ...p, GameOfWeek: e.target.checked }))} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>🔥 Game of the Week</span>
              </label>
              {/* Score picks normally unlock the Monday before the game's
                  own week and lock again once it's Final (see GamePage.js) —
                  this overrides that to open picks early for this game. */}
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input type="checkbox" checked={formState.PicksForceOpen} onChange={(e) => setFormState((p) => ({ ...p, PicksForceOpen: e.target.checked }))} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>🔓 Force picks open</span>
              </label>
              {/* Still fully pickable either way (unranked score/winner
                  picks stay open) — this only excludes the game from
                  We-Pick's ranked "Pick 6" lineup (WePickHub.js). */}
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input type="checkbox" checked={formState.RankedDisqualified} onChange={(e) => setFormState((p) => ({ ...p, RankedDisqualified: e.target.checked }))} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>🚫 Disqualify from Ranked We-Pick</span>
              </label>
            </div>

            {/* Key Players — same search-and-add chip pattern as the
                Performances editor's "Players Mentioned" field, just split
                into two lists (one per side) so each team's picks stay
                scoped to that team's roster. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                  Key Players — Away{formState.Away ? ` (${formState.Away})` : ""}
                </div>
                <KeyPlayersChips
                  playerIds={formState.KeyPlayersAway}
                  allPlayers={allPlayers}
                  notes={formState.KeyPlayerNotes}
                  onNoteChange={(pid, note) => setFormState((p) => ({ ...p, KeyPlayerNotes: { ...p.KeyPlayerNotes, [pid]: note } }))}
                  onRemove={(pid) => setFormState((p) => {
                    const KeyPlayerNotes = { ...p.KeyPlayerNotes };
                    delete KeyPlayerNotes[pid];
                    return { ...p, KeyPlayersAway: p.KeyPlayersAway.filter((id) => id !== pid), KeyPlayerNotes };
                  })}
                />
                <KeyPlayersCombobox
                  school={formState.Away}
                  excludeIds={formState.KeyPlayersAway}
                  players={allPlayers}
                  onAdd={(pid) => setFormState((p) => ({ ...p, KeyPlayersAway: [...p.KeyPlayersAway, pid] }))}
                />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                  Key Players — Home{formState.Home ? ` (${formState.Home})` : ""}
                </div>
                <KeyPlayersChips
                  playerIds={formState.KeyPlayersHome}
                  allPlayers={allPlayers}
                  notes={formState.KeyPlayerNotes}
                  onNoteChange={(pid, note) => setFormState((p) => ({ ...p, KeyPlayerNotes: { ...p.KeyPlayerNotes, [pid]: note } }))}
                  onRemove={(pid) => setFormState((p) => {
                    const KeyPlayerNotes = { ...p.KeyPlayerNotes };
                    delete KeyPlayerNotes[pid];
                    return { ...p, KeyPlayersHome: p.KeyPlayersHome.filter((id) => id !== pid), KeyPlayerNotes };
                  })}
                />
                <KeyPlayersCombobox
                  school={formState.Home}
                  excludeIds={formState.KeyPlayersHome}
                  players={allPlayers}
                  onAdd={(pid) => setFormState((p) => ({ ...p, KeyPlayersHome: [...p.KeyPlayersHome, pid] }))}
                />
              </div>
            </div>

            {/* Notes — one field whose purpose (and label) flips once the
                game is marked Final: pregame it's forward-looking preview
                copy, postgame the admin overwrites it with a recap. */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                {formState.Final ? "Review Notes" : "Preview Notes"} (public)
              </div>
              <textarea
                value={formState.Notes}
                onChange={(e) => setFormState((p) => ({ ...p, Notes: e.target.value }))}
                placeholder={formState.Final ? "Recap the game for the public game page..." : "Preview the matchup for the public game page..."}
                style={{ ...inputStyle, minHeight: "110px", resize: "vertical", lineHeight: 1.5, fontWeight: 500 }}
              />
            </div>

            <label
              title={!canMarkFinal ? "Enter both scores before marking Final" : ""}
              style={{
                display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px",
                cursor: canMarkFinal ? "pointer" : "not-allowed", opacity: canMarkFinal ? 1 : 0.5,
              }}
            >
              <input
                type="checkbox"
                checked={formState.Final}
                disabled={!canMarkFinal}
                onChange={(e) => setFormState((p) => ({ ...p, Final: e.target.checked }))}
              />
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>
                Mark game Final {!canMarkFinal && "(enter both scores first)"}
              </span>
            </label>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%",
                background: BLUE, color: "#fff", border: "2px solid " + GOLD,
                borderRadius: "8px", padding: "12px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : isNew ? "Create Game" : "Save Changes"}
            </button>

            {!isNew && (
              <button
                onClick={handleDelete}
                disabled={removing}
                style={{
                  width: "100%", marginTop: "8px",
                  background: "#fff", color: "#c0392b", border: "2px solid #c0392b",
                  borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.06em", cursor: removing ? "default" : "pointer",
                  opacity: removing ? 0.6 : 1,
                }}
              >
                {removing ? "Deleting..." : "Delete Game"}
              </button>
            )}

            {saveMessage && (
              <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
      )}
    </div>
  );
}

const BLANK_RIVALRY_FORM = { Title: "", TeamA: "", TeamB: "", Logo: "", Description: "" };

// Admin editor for the "rivalries" collection — two designated teams, an
// optional rivalry-specific logo (a trophy graphic, a shared nickname
// badge, etc. — same "paste a URL" convention every other logo field in
// this app uses, no real file upload anywhere in this codebase), and a
// short writeup, so a game page between two rivals can badge/flavor itself
// accordingly. Lives as a tab inside CFB Schedule (see CFBScheduleSection)
// rather than its own top-level sidebar section since it's schedule-
// adjacent metadata authored by the same admin.
function RivalriesSection({ schoolNames }) {
  const [rivalries, setRivalries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const fetchRivalries = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "rivalries"));
        setRivalries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Rivalries fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchRivalries();
  }, []);

  const selectRivalry = (r) => {
    setSelected(r);
    setFormState({ Title: r.Title || "", TeamA: r.TeamA || "", TeamB: r.TeamB || "", Logo: r.Logo || "", Description: r.Description || "" });
    setSaveMessage("");
  };

  const startNew = () => {
    setSelected({ id: null, isNew: true });
    setFormState({ ...BLANK_RIVALRY_FORM });
    setSaveMessage("");
  };

  const isNew = selected?.isNew === true;

  const handleSave = async () => {
    if (!formState) return;
    if (!formState.Title.trim()) {
      setSaveMessage("Failed: give the rivalry a title.");
      return;
    }
    if (!formState.TeamA || !formState.TeamB) {
      setSaveMessage("Failed: choose both teams.");
      return;
    }
    if (formState.TeamA === formState.TeamB) {
      setSaveMessage("Failed: pick two different teams.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const payload = {
        Title: formState.Title.trim(),
        TeamA: formState.TeamA,
        TeamB: formState.TeamB,
        Logo: formState.Logo.trim(),
        Description: formState.Description.trim(),
        updatedAt: serverTimestamp(),
      };
      if (isNew) {
        const ref = await addDoc(collection(db, "rivalries"), payload);
        const newRivalry = { id: ref.id, ...payload };
        setRivalries((prev) => [...prev, newRivalry]);
        setSelected(newRivalry);
      } else {
        await setDoc(doc(db, "rivalries", selected.id), payload, { merge: true });
        setRivalries((prev) => prev.map((r) => (r.id === selected.id ? { ...r, ...payload } : r)));
      }
      setSaveMessage("Saved!");
    } catch (e) {
      console.error("Rivalry save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || isNew) return;
    if (!window.confirm("Delete this rivalry? This cannot be undone.")) return;
    setRemoving(true);
    try {
      await deleteDoc(doc(db, "rivalries", selected.id));
      setRivalries((prev) => prev.filter((r) => r.id !== selected.id));
      setSelected(null);
      setFormState(null);
    } catch (e) {
      console.error("Rivalry delete error:", e);
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading" size={28} minHeight="100px" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Rivalries
          </div>
          <button
            onClick={startNew}
            style={{
              marginLeft: "auto", background: GOLD, color: "#fff", border: "none",
              borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            + New
          </button>
        </div>
        {rivalries.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No rivalries yet.</div>
        ) : (
          <div style={{ maxHeight: "700px", overflowY: "auto" }}>
            {rivalries.map((r) => {
              const isSelected = selected?.id === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() => selectRivalry(r)}
                  style={{
                    padding: "10px 14px", cursor: "pointer",
                    background: isSelected ? "#eaf1ff" : "#fff",
                    borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: "13px", color: "#222" }}>{r.Title || `${r.TeamA} vs ${r.TeamB}`}</div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#aaa", marginTop: "1px" }}>{r.TeamA} vs {r.TeamB}</div>
                  {r.Description && (
                    <div style={{ fontSize: "11px", color: "#888", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.Description}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        {!formState ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Select a rivalry, or start a new one.
          </div>
        ) : (
          <div style={{ padding: "16px" }}>
            <FieldGroup>
              <FieldRow label="Rivalry Title">
                <input
                  value={formState.Title}
                  onChange={(e) => setFormState((p) => ({ ...p, Title: e.target.value }))}
                  placeholder='e.g. "The Iron Bowl"'
                  style={inputStyle}
                />
              </FieldRow>
              <FieldRow label="Team A">
                <select value={formState.TeamA} onChange={(e) => setFormState((p) => ({ ...p, TeamA: e.target.value }))} style={inputStyle}>
                  <option value="">— Select —</option>
                  {schoolNames.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Team B">
                <select value={formState.TeamB} onChange={(e) => setFormState((p) => ({ ...p, TeamB: e.target.value }))} style={inputStyle}>
                  <option value="">— Select —</option>
                  {schoolNames.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="Rivalry Logo">
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <div style={{
                    flexShrink: 0, width: "52px", height: "52px", borderRadius: "6px",
                    border: "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                  }}>
                    {formState.Logo ? (
                      <img src={formState.Logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <span style={{ fontSize: "8px", color: "#bbb", fontWeight: 700, textAlign: "center" }}>No logo</span>
                    )}
                  </div>
                  <input
                    value={formState.Logo}
                    onChange={(e) => setFormState((p) => ({ ...p, Logo: e.target.value }))}
                    placeholder="https://..."
                    style={{ ...inputStyle, flex: 1 }}
                  />
                </div>
              </FieldRow>
              <FieldRow label="Description">
                <textarea
                  value={formState.Description}
                  onChange={(e) => setFormState((p) => ({ ...p, Description: e.target.value }))}
                  rows={5}
                  placeholder="What makes this one a rivalry — history, trophy, streak, anything worth telling..."
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </FieldRow>
            </FieldGroup>

            <div style={{ display: "flex", gap: "10px", marginTop: "16px", alignItems: "center" }}>
              {!isNew && (
                <button
                  onClick={handleDelete}
                  disabled={removing}
                  style={{ background: "#fff", color: "#c0392b", border: "2px solid #c0392b", borderRadius: "8px", padding: "9px 16px", fontWeight: 900, fontSize: "12px", cursor: removing ? "default" : "pointer", opacity: removing ? 0.6 : 1 }}
                >
                  {removing ? "Deleting…" : "Delete"}
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ marginLeft: "auto", background: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "9px 20px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}
              >
                {saving ? "Saving…" : isNew ? "Create Rivalry" : "Save Changes"}
              </button>
            </div>
            {saveMessage && (
              <div style={{ marginTop: "10px", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Same 11 conferences Navbar.js's CFB dropdown groups schools into — kept
// as its own constant here (rather than imported) since every other small
// shared list in this codebase (BLUE/GOLD, TREND_STYLE, etc.) is duplicated
// per-file the same way instead of factored out.
const CFB_CONFERENCES = [
  "ACC", "Big 10", "Big 12", "SEC", "Pac 12", "Independent",
  "AAC", "CUSA", "MAC", "Mountain West", "Sun Belt",
];

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
    // The school's own short-form abbreviation (e.g. "Bama") — GameMarginSidebars.js's
    // scoreboard bug and PerformancesManager.js's auto-generated hashtags both read this.
    shortField: "Short",
    shortLabel: "Short Name",
    conferenceOptions: CFB_CONFERENCES,
    // Which NFL team this school is associated with (MarginAds.js matches
    // ads.Team against it) — an NFL team has no analogous "parent" team, so
    // this only applies to the CFB side.
    hasNflAssociation: true,
    searchPlaceholder: "Search school, mascot, or conference...",
  },
  nfl: {
    label: "NFL",
    collectionName: "nfl",
    nameField: "Team",
    subLabelField: "City",
    groupField: "Conference",
    shortField: "Abbreviation",
    shortLabel: "Abbreviation",
    conferenceOptions: ["AFC", "NFC"],
    hasNflAssociation: false,
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

// "Teams" (the existing CFB/NFL logo/color editor) and "Misc" (TV channel
// logos, formerly its own top-level "Misc Branding" sidebar section — moved
// here since it's just another flavor of branding asset, not a separate
// concern) as sibling tabs under one Branding section.
const BRANDING_TABS = [
  { key: "teams", label: "Teams" },
  { key: "misc", label: "Misc" },
];

function BrandingSection() {
  const [brandingTab, setBrandingTab] = useState("teams");
  const [league, setLeague] = useState("cfb");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        {BRANDING_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setBrandingTab(t.key)}
            style={{
              padding: "9px 22px", fontWeight: 900, fontSize: "13px",
              textTransform: "uppercase", letterSpacing: "0.06em",
              border: "2px solid " + GOLD, borderRadius: "8px", cursor: "pointer",
              background: brandingTab === t.key ? GOLD : "#fff",
              color: brandingTab === t.key ? "#fff" : GOLD,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {brandingTab === "teams" && (
        <>
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
        </>
      )}

      {brandingTab === "misc" && <MiscBrandingSection />}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [nflTeamOptions, setNflTeamOptions] = useState([]);

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

  // NFL team options for the CFB side's "NFL Team" association dropdown —
  // skipped entirely on the NFL pane, which has no such field.
  useEffect(() => {
    if (!cfg.hasNflAssociation) { setNflTeamOptions([]); return; }
    const fetchNflTeams = async () => {
      try {
        const snap = await getDocs(collection(db, "nfl"));
        const opts = snap.docs
          .map((d) => ({ id: d.id, label: `${d.data().City || ""} ${d.data().Team || d.id}`.trim() + ` (${d.data().Abbreviation || d.id})` }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setNflTeamOptions(opts);
      } catch (e) {
        console.error("Admin branding NFL-options fetch error:", e);
        setNflTeamOptions([]);
      }
    };
    fetchNflTeams();
  }, [cfg.hasNflAssociation]);

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
      [cfg.subLabelField]: t[cfg.subLabelField] || "",
      [cfg.groupField]: t[cfg.groupField] || "",
      [cfg.shortField]: t[cfg.shortField] || "",
      ...(cfg.hasNflAssociation ? { NFL: t.NFL || "" } : {}),
      ...(league === "cfb" ? { FCS: !!t.FCS } : {}),
      Logo1: t.Logo1 || "",
      Logo2: t.Logo2 || "",
      Wordmark: t.Wordmark || "",
      WordmarkDark: t.WordmarkDark || "",
      LogoDark: t.LogoDark || "",
      LogoBlack: t.LogoBlack || "",
      Color1: t.Color1 || BLUE,
      Color2: t.Color2 || GOLD,
    });
    setSaveMessage("");
    setCopiedField("");
    setLogoCopyStatus({});
    setConfirmDelete(false);
  };

  // ── Add a brand-new team (school or NFL club) — same form as editing, plus
  // a name/mascot pair up top that only ever applies here: an existing
  // team's name is treated as immutable everywhere else in this pane since
  // players, games, performances, and ads all reference it by that exact
  // string, and silently renaming it would orphan every reference. ──
  const startNewTeam = () => {
    setSelectedTeam({ id: null, isNew: true });
    setFormState({
      [cfg.nameField]: "",
      [cfg.subLabelField]: "",
      [cfg.groupField]: "",
      [cfg.shortField]: "",
      ...(cfg.hasNflAssociation ? { NFL: "" } : {}),
      ...(league === "cfb" ? { FCS: false } : {}),
      Logo1: "",
      Logo2: "",
      Wordmark: "",
      WordmarkDark: "",
      LogoDark: "",
      LogoBlack: "",
      Color1: BLUE,
      Color2: GOLD,
    });
    setSaveMessage("");
    setCopiedField("");
    setLogoCopyStatus({});
    setConfirmDelete(false);
  };

  const isNewTeam = selectedTeam?.isNew === true;

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
    if (isNewTeam && !formState[cfg.nameField]?.trim()) {
      setSaveMessage(`Failed: ${cfg.nameField} name is required.`);
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const payload = {
        // The name itself only ever gets set here at creation — see
        // startNewTeam's own comment for why an existing team's name is
        // treated as immutable in this pane. subLabelField (Mascot for
        // CFB, City for NFL) isn't load-bearing the same way anything else
        // references it by, so unlike the name it stays editable anytime.
        ...(isNewTeam ? { [cfg.nameField]: formState[cfg.nameField].trim() } : {}),
        [cfg.subLabelField]: (formState[cfg.subLabelField] || "").trim(),
        [cfg.groupField]: formState[cfg.groupField].trim(),
        [cfg.shortField]: formState[cfg.shortField].trim(),
        ...(cfg.hasNflAssociation ? { NFL: formState.NFL.trim() } : {}),
        ...(league === "cfb" ? { FCS: !!formState.FCS } : {}),
        Logo1: formState.Logo1.trim(),
        Logo2: formState.Logo2.trim(),
        Wordmark: formState.Wordmark.trim(),
        WordmarkDark: formState.WordmarkDark.trim(),
        LogoDark: formState.LogoDark.trim(),
        LogoBlack: formState.LogoBlack.trim(),
        Color1: formState.Color1.trim(),
        Color2: formState.Color2.trim(),
        updatedAt: serverTimestamp(),
      };
      if (isNewTeam) {
        const ref = await addDoc(collection(db, cfg.collectionName), payload);
        const newTeam = { id: ref.id, ...payload };
        setTeams((prev) => [...prev, newTeam].sort((a, b) => (a[cfg.nameField] || "").localeCompare(b[cfg.nameField] || "")));
        setSelectedTeam(newTeam);
        setSaveMessage("Team created.");
      } else {
        await updateDoc(doc(db, cfg.collectionName, selectedTeam.id), payload);
        setTeams((prev) => prev.map((t) => (t.id === selectedTeam.id ? { ...t, ...payload } : t)));
        setSelectedTeam((prev) => (prev ? { ...prev, ...payload } : prev));
        setSaveMessage("Saved.");
      }
    } catch (e) {
      console.error("Admin branding save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  // ── Same two-step in-panel confirmation as the Player delete (clicking
  // "Delete Team" only reveals the warning; the actual deleteDoc only runs
  // from "Yes, Delete Permanently") rather than a native window.confirm() —
  // deleting a team is higher blast-radius than the video/game/trend deletes
  // that do use window.confirm() elsewhere, since players, schedule games,
  // performances, and ads all reference a team by name/abbreviation and
  // aren't cleaned up here (see the warning copy below). ──
  const handleDeleteTeam = async () => {
    if (!selectedTeam || isNewTeam) return;
    setRemoving(true);
    setSaveMessage("");
    try {
      await deleteDoc(doc(db, cfg.collectionName, selectedTeam.id));
      setTeams((prev) => prev.filter((t) => t.id !== selectedTeam.id));
      setSelectedTeam(null);
      setFormState(null);
      setConfirmDelete(false);
    } catch (e) {
      console.error("Admin branding delete error:", e);
      setSaveMessage("Failed to delete — check console.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {cfg.label} Teams
          </div>
          <button
            onClick={startNewTeam}
            style={{
              marginLeft: "auto", background: GOLD, color: "#fff", border: "none",
              borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            + New Team
          </button>
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
          <LoadingSpinner label="Loading" size={28} minHeight="100px" />
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
                    {(t.LogoDark || t.Logo1) ? (
                      <img src={t.LogoDark || t.Logo1} alt="" style={{ width: "80%", height: "80%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <span style={{ color: "#fff", fontWeight: 900, fontSize: "14px" }}>{(t[cfg.nameField] || "?").charAt(0)}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t[cfg.nameField] || "Untitled"}
                      </div>
                      {t.FCS && (
                        <span style={{ flexShrink: 0, background: "#eee", color: "#666", fontSize: "9px", fontWeight: 900, padding: "1px 6px", borderRadius: "4px", letterSpacing: "0.04em" }}>
                          FCS
                        </span>
                      )}
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
            {isNewTeam ? (formState?.[cfg.nameField] || `New ${cfg.label} Team`) : (selectedTeam ? (selectedTeam[cfg.nameField] || "Edit Team") : "Select a Team")}
          </div>
        </div>

        {!selectedTeam || !formState ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click a team from the list to view and edit its logos and colors, or "+ New Team" to add one.
          </div>
        ) : (
          <div style={{ padding: "16px", maxHeight: "760px", overflowY: "auto" }}>
            {/* The name field only ever shows at creation (see handleSave's
                own comment for why an existing team's name is immutable
                here), but subLabelField — Mascot for CFB, City for NFL —
                stays editable anytime, not just when the team is first
                created. */}
            <FieldGroup>
              {isNewTeam && (
                <FieldRow label={`${cfg.nameField} Name`}>
                  <input
                    value={formState[cfg.nameField]}
                    onChange={(e) => handleFieldChange(cfg.nameField, e.target.value)}
                    placeholder={cfg.nameField}
                    style={inputStyle}
                  />
                </FieldRow>
              )}
              <FieldRow label={cfg.subLabelField}>
                <input
                  value={formState[cfg.subLabelField]}
                  onChange={(e) => handleFieldChange(cfg.subLabelField, e.target.value)}
                  placeholder={cfg.subLabelField}
                  style={inputStyle}
                />
              </FieldRow>
            </FieldGroup>
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
                    {isNewTeam ? (formState[cfg.nameField] || "New Team") : selectedTeam[cfg.nameField]}
                  </div>
                </div>
                <div style={{ height: "6px", background: /^#[0-9a-fA-F]{3,8}$/.test(formState.Color2) ? formState.Color2 : GOLD }} />
              </div>
            </div>

            <FieldGroup>
              <FieldRow label="Conference">
                <select
                  value={formState[cfg.groupField]}
                  onChange={(e) => handleFieldChange(cfg.groupField, e.target.value)}
                  style={inputStyle}
                >
                  <option value="">— Select —</option>
                  {cfg.conferenceOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </FieldRow>
              <FieldRow label={cfg.shortLabel}>
                <input
                  value={formState[cfg.shortField]}
                  onChange={(e) => handleFieldChange(cfg.shortField, e.target.value)}
                  placeholder={cfg.shortLabel}
                  style={inputStyle}
                />
              </FieldRow>
              {cfg.hasNflAssociation && (
                <FieldRow label="NFL Team">
                  <select
                    value={formState.NFL}
                    onChange={(e) => handleFieldChange("NFL", e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">— None —</option>
                    {nflTeamOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </FieldRow>
              )}
              {league === "cfb" && (
                <FieldRow label="Division">
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!formState.FCS}
                      onChange={(e) => handleFieldChange("FCS", e.target.checked)}
                    />
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#444" }}>
                      This is an FCS team (unchecked = FBS)
                    </span>
                  </label>
                </FieldRow>
              )}
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
              <LogoUrlField
                label="Wordmark"
                value={formState.Wordmark}
                onChange={(v) => handleFieldChange("Wordmark", v)}
                onCopy={() => handleCopyImage("Wordmark", formState.Wordmark)}
                copyStatus={logoCopyStatus.Wordmark || "idle"}
              />
              <LogoUrlField
                label="Wordmark (Dark)"
                value={formState.WordmarkDark}
                onChange={(v) => handleFieldChange("WordmarkDark", v)}
                onCopy={() => handleCopyImage("WordmarkDark", formState.WordmarkDark)}
                copyStatus={logoCopyStatus.WordmarkDark || "idle"}
              />
              <LogoUrlField
                label="Logo (Dark)"
                value={formState.LogoDark}
                onChange={(v) => handleFieldChange("LogoDark", v)}
                onCopy={() => handleCopyImage("LogoDark", formState.LogoDark)}
                copyStatus={logoCopyStatus.LogoDark || "idle"}
              />
              <LogoUrlField
                label="Logo (Black)"
                value={formState.LogoBlack}
                onChange={(v) => handleFieldChange("LogoBlack", v)}
                onCopy={() => handleCopyImage("LogoBlack", formState.LogoBlack)}
                copyStatus={logoCopyStatus.LogoBlack || "idle"}
              />
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#888", marginTop: "-8px" }}>
                Optional — the Performances terminal uses this team's dark logo by default and switches to this black version once set.
              </div>
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
              {saving ? "Saving..." : isNewTeam ? "Create Team" : "Save Changes"}
            </button>

            {saveMessage && (
              <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") ? "#c0392b" : "#2e7d32" }}>
                {saveMessage}
              </div>
            )}

            {!isNewTeam && (
            <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
              {confirmDelete ? (
                <div style={{ border: "2px solid #c0392b", borderRadius: "8px", padding: "12px", background: "#fff3f0" }}>
                  <div style={{ fontWeight: 900, fontSize: "12px", color: "#a52a1e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>
                    ⚠ Permanently delete {selectedTeam[cfg.nameField] || "this team"}?
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#666", marginBottom: "12px" }}>
                    This removes the {cfg.label} team record and cannot be undone. Players, schedule games,
                    performances, and ads that still reference "{selectedTeam[cfg.nameField]}" by name won't be
                    cleaned up automatically and may show broken logos/links afterward.
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
                      onClick={handleDeleteTeam}
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
                  Delete Team
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

// ── Misc Branding — a home for branding assets that aren't a school or NFL
// team. TV channels are the first (only) resident: CFBScheduleSection's own
// "TV Channel" dropdown references a channel by this same Name, and
// GamePage.js looks up that channel's LogoDark to show under the at/vs
// button. Deliberately its own simple manager rather than another
// LEAGUE_CONFIG entry in TeamBrandingPane — a channel has no conference,
// short name, or NFL association, just a name and two logos, so the
// team-shaped machinery there would be mostly unused ceremony here. ──
function MiscBrandingSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <TvChannelsManager />
    </div>
  );
}

function TvChannelsManager() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState(null); // { id, isNew } | full channel doc
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [logoCopyStatus, setLogoCopyStatus] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const fetchChannels = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "tvChannels"));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.Name || "").localeCompare(b.Name || ""));
        setChannels(data);
      } catch (e) {
        console.error("Admin TV channels fetch error:", e);
        setChannels([]);
      } finally {
        setLoading(false);
      }
    };
    fetchChannels();
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) => (c.Name || "").toLowerCase().includes(q));
  }, [channels, searchQuery]);

  const selectChannel = (c) => {
    setSelected(c);
    setFormState({ Short: c.Short || "", Logo: c.Logo || "", LogoDark: c.LogoDark || "" });
    setSaveMessage("");
    setLogoCopyStatus({});
    setConfirmDelete(false);
  };

  const startNewChannel = () => {
    setSelected({ id: null, isNew: true });
    setFormState({ Name: "", Short: "", Logo: "", LogoDark: "" });
    setSaveMessage("");
    setLogoCopyStatus({});
    setConfirmDelete(false);
  };

  const isNewChannel = selected?.isNew === true;

  const handleFieldChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  // Same clipboard-image-copy as TeamBrandingPane's own handleCopyImage —
  // duplicated rather than shared since that one is a closure over that
  // component's own logoCopyStatus setter.
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
    if (!selected || !formState) return;
    if (isNewChannel && !formState.Name?.trim()) {
      setSaveMessage("Failed: Channel name is required.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const payload = {
        // Same immutable-after-creation rule as a school/NFL team's name
        // (see TeamBrandingPane's handleSave) — CFBScheduleSection
        // references channels by this exact string, so renaming one here
        // would silently orphan every game already pointed at it.
        ...(isNewChannel ? { Name: formState.Name.trim() } : {}),
        // The short form shown next to date/time on the schedule sidebars
        // (GameMarginSidebars.js) — e.g. "ESPN" stays "ESPN", but
        // "ACC Network" becomes "ACCN" so it doesn't crowd a narrow row.
        Short: (formState.Short || "").trim(),
        Logo: (formState.Logo || "").trim(),
        LogoDark: (formState.LogoDark || "").trim(),
        updatedAt: serverTimestamp(),
      };
      if (isNewChannel) {
        const ref = await addDoc(collection(db, "tvChannels"), payload);
        const newChannel = { id: ref.id, ...payload };
        setChannels((prev) => [...prev, newChannel].sort((a, b) => (a.Name || "").localeCompare(b.Name || "")));
        setSelected(newChannel);
        setSaveMessage("Channel created.");
      } else {
        await updateDoc(doc(db, "tvChannels", selected.id), payload);
        setChannels((prev) => prev.map((c) => (c.id === selected.id ? { ...c, ...payload } : c)));
        setSelected((prev) => (prev ? { ...prev, ...payload } : prev));
        setSaveMessage("Saved.");
      }
    } catch (e) {
      console.error("Admin TV channel save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteChannel = async () => {
    if (!selected || isNewChannel) return;
    setRemoving(true);
    try {
      await deleteDoc(doc(db, "tvChannels", selected.id));
      setChannels((prev) => prev.filter((c) => c.id !== selected.id));
      setSelected(null);
      setFormState(null);
    } catch (e) {
      console.error("Admin TV channel delete error:", e);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: "20px", fontWeight: 900, color: BLUE, marginBottom: "4px" }}>📺 TV Channels</div>
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#888", marginBottom: "14px" }}>
        Logos referenced by CFB Schedule's "TV Channel" field and shown on each game's own page.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "16px" }}>
        <div style={{ border: "2px solid #eee", borderRadius: "10px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search channels..."
              style={inputStyle}
            />
          </div>
          <div style={{ maxHeight: "560px", overflowY: "auto", flex: 1 }}>
            {loading ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#999", fontSize: "13px" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#999", fontSize: "13px", fontStyle: "italic" }}>No channels found.</div>
            ) : (
              filtered.map((c) => (
                <div
                  key={c.id}
                  onClick={() => selectChannel(c)}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", cursor: "pointer",
                    background: selected?.id === c.id ? "#eaf1ff" : "#fff", borderBottom: "1px solid #f5f5f5",
                  }}
                >
                  <div style={{ width: "28px", height: "28px", borderRadius: "4px", ...CHECKER_BG, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                    {(c.LogoDark || c.Logo) ? (
                      <img src={c.LogoDark || c.Logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : null}
                  </div>
                  <span style={{ fontWeight: 800, fontSize: "13px", color: BLUE }}>{c.Name || "Untitled"}</span>
                </div>
              ))
            )}
          </div>
          <button
            onClick={startNewChannel}
            style={{ width: "100%", padding: "12px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.04em", background: GOLD, color: "#fff", border: "none", cursor: "pointer" }}
          >
            + New Channel
          </button>
        </div>

        <div style={{ border: "2px solid #eee", borderRadius: "10px", padding: "16px" }}>
          {!selected || !formState ? (
            <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
              Click a channel from the list to edit its logos, or "+ New Channel" to add one.
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 900, fontSize: "16px", color: BLUE, marginBottom: "14px" }}>
                {isNewChannel ? (formState.Name || "New Channel") : (selected.Name || "Edit Channel")}
              </div>
              <FieldGroup>
                {isNewChannel && (
                  <FieldRow label="Channel Name">
                    <input
                      value={formState.Name}
                      onChange={(e) => handleFieldChange("Name", e.target.value)}
                      placeholder="e.g. ACC Network"
                      style={inputStyle}
                    />
                  </FieldRow>
                )}
                {/* Editable anytime, unlike Name — nothing references a
                    channel by its Short form, so there's no orphan risk in
                    changing it later. */}
                <FieldRow label="Short Name (for schedule sidebars)">
                  <input
                    value={formState.Short}
                    onChange={(e) => handleFieldChange("Short", e.target.value)}
                    placeholder="e.g. ACCN"
                    style={inputStyle}
                  />
                </FieldRow>
                <LogoUrlField
                  label="Logo"
                  value={formState.Logo}
                  onChange={(v) => handleFieldChange("Logo", v)}
                  onCopy={() => handleCopyImage("Logo", formState.Logo)}
                  copyStatus={logoCopyStatus.Logo || "idle"}
                />
                <LogoUrlField
                  label="Logo (Dark)"
                  value={formState.LogoDark}
                  onChange={(v) => handleFieldChange("LogoDark", v)}
                  onCopy={() => handleCopyImage("LogoDark", formState.LogoDark)}
                  copyStatus={logoCopyStatus.LogoDark || "idle"}
                />
              </FieldGroup>

              <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    flex: 1, background: BLUE, color: "#fff", border: "none", borderRadius: "8px",
                    padding: "12px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase",
                    letterSpacing: "0.06em", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? "Saving..." : isNewChannel ? "Create Channel" : "Save Changes"}
                </button>
              </div>
              {saveMessage && (
                <div style={{ marginTop: "10px", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") ? "#c0392b" : "#2e7d32" }}>
                  {saveMessage}
                </div>
              )}

              {!isNewChannel && (
                <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      style={{
                        width: "100%", background: "#fff", color: "#c0392b", border: "2px solid #c0392b",
                        borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "12px",
                        textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                      }}
                    >
                      Delete Channel
                    </button>
                  ) : (
                    <div style={{ border: "2px solid #c0392b", borderRadius: "8px", padding: "12px", background: "#fff5f5" }}>
                      <div style={{ fontSize: "12px", fontWeight: 800, color: "#c0392b", marginBottom: "10px" }}>
                        ⚠ Permanently delete {selected.Name || "this channel"}? Any game still pointed at it by name will just show no channel logo — this doesn't touch schedule26.
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={handleDeleteChannel}
                          disabled={removing}
                          style={{
                            flex: 1, background: "#c0392b", color: "#fff", border: "none", borderRadius: "6px",
                            padding: "9px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase",
                            cursor: removing ? "default" : "pointer", opacity: removing ? 0.6 : 1,
                          }}
                        >
                          {removing ? "Deleting…" : "Yes, Delete Permanently"}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(false)}
                          style={{
                            flex: 1, background: "#fff", color: "#666", border: "2px solid #ddd", borderRadius: "6px",
                            padding: "9px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState("players");
  const [unreadRequestCount, setUnreadRequestCount] = useState(0);

  // ── Sidebar badge for the Requests section — lives up here (not inside
  // RequestsSection itself) so the count is visible without ever having to
  // open that section. Refetches on every activeSection change rather than
  // just once on mount: that's what catches the count dropping back to 0
  // right after a visit to Requests, since RequestsSection marks everything
  // it just loaded as read (see its own effect) the moment it's viewed. ──
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const [prSnap, urSnap] = await Promise.all([
          getDocs(collection(db, "playerRequests")),
          getDocs(collection(db, "userReports")),
        ]);
        const unread = [...prSnap.docs, ...urSnap.docs].filter((d) => d.data().read !== true).length;
        setUnreadRequestCount(unread);
      } catch (e) {
        console.error("Admin unread-requests count error:", e);
      }
    };
    fetchUnread();
  }, [activeSection]);

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
            <SidebarNav active={activeSection} setActive={setActiveSection} badgeCounts={{ requests: unreadRequestCount }} />
          </div>

          <div>
            {activeSection === "players" && <PlayerDataSection />}
            {activeSection === "trends" && <TrendsSection />}
            {activeSection === "videos" && <VideosSection />}
            {activeSection === "analytics" && <AnalyticsSection />}
            {activeSection === "branding" && <BrandingSection />}
            {activeSection === "articles" && <ArticlesManager />}
            {activeSection === "performances" && <PerformancesManager />}
            {activeSection === "cfbschedule" && <CFBScheduleSection />}
            {activeSection === "requests" && <RequestsSection />}
            {activeSection === "sync" && <ComingSoonPane label="Sync / System Status" />}
            {activeSection === "ads" && <ComingSoonPane label="Ads Management" />}
          </div>
        </div>
      </div>
    </>
  );
}