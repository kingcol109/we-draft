// src/components/ContentCalendarManager.js
//
// Admin Panel "Content Calendar" section — a month grid for planning
// upcoming videos, articles, and posts. Each entry is scoped to a subject
// (a player, recruit, or team) whose name is the entry's own display text
// on the chip itself ("the subject will be the text" was the original
// spec); the entry's content type (video/article/post) drives how it's
// styled (color + icon). An optional free-text Note can be added on top of
// that — an angle to take, who's involved, anything the subject name alone
// doesn't capture — shown via the chip's own tooltip and a small 📝 marker,
// never inline on the chip itself (there's no room, and the whole point of
// the subject-as-title design is staying scannable at a glance).
//
// Two kinds of entries share this same grid, visually distinguished (solid
// border vs. dashed + a small 🔗 marker — see the legend above the grid and
// the chip styling in the render below):
//   - Manual plans (this component's own `contentCalendar` docs, solid
//     border) — an idea not created yet, just a subject/type/date/note.
//     Draggable to a different day (see handleDropOnDate) — that's the
//     whole point of planning here.
//   - Pulled-in real content (dashed border) — every existing video
//     (`videos`) and article (`articles`) doc, placed on its own Date/
//     publishedAt, standing in for the player it's tagged to (or a generic
//     name — see videoEntries/articleEntries below — when it's tagged to
//     more than one). Performances are deliberately excluded (not asked
//     for). These aren't separately stored anywhere; they're derived every
//     render from the videos/articles collections themselves, and are
//     read-only/not draggable/no note here — moving when a video or
//     article actually goes live (or annotating it) is the Videos/Articles
//     tabs' own job, not this calendar's.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "./LoadingSpinner";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Content type -> display styling. Distinct from the site's own BLUE/GOLD
// brand pair so a chip's color alone tells you what kind of content it is
// at a glance, scanning the whole month.
const CONTENT_TYPES = [
  { key: "video", label: "Video", icon: "▶", color: "#b45309" },
  // Pulled-in entries split video/short below by that video doc's own
  // Short flag (AdminPanel.js VideosSection) rather than needing its own
  // separate fetch — same data, just a different color so the two read
  // apart at a glance scanning the month. Also pickable here manually, for
  // planning a Short that doesn't exist yet.
  { key: "short", label: "Short", icon: "🎬", color: "#ec4899" },
  { key: "article", label: "Article", icon: "📰", color: "#0055a5" },
  { key: "post", label: "Post", icon: "📣", color: "#7c3aed" },
];
const CONTENT_TYPE_BY_KEY = Object.fromEntries(CONTENT_TYPES.map((t) => [t.key, t]));

// Same three Flag values AdminPanel.js's Player Data section colors a
// player with (see that file's own FLAG_COLORS) — the Player Bank below
// reads that same field to group players by which of these three needs
// they're flagged for. defaultType is just a starting point for the "new
// entry" form a bank player pre-fills (see startEntryForBankPlayer) —
// Watch maps to Short since that's the site's own Shorts/Watch feature,
// Video to the plain Video type, and Follow (no clean content-type
// equivalent) falls back to Post; all three stay fully editable on the
// form same as any other entry.
const FLAG_GROUPS = [
  { key: "green", label: "Watch", hex: "#2e7d32", defaultType: "short" },
  { key: "blue", label: "Follow", hex: "#1565c0", defaultType: "post" },
  { key: "red", label: "Video", hex: "#c0392b", defaultType: "video" },
];

const SUBJECT_TYPES = [
  { key: "player", label: "Player" },
  { key: "recruit", label: "Recruit" },
  { key: "team", label: "Team" },
  // Not every planned entry has one clean player/recruit/team it's about —
  // this skips SubjectCombobox for a plain text field instead, so
  // subjectLabel (the chip's own display text) can just be typed directly.
  // subjectId stays empty for these; nothing looks it up by id.
  { key: "custom", label: "Custom" },
];

const inputStyle = {
  width: "100%", border: "2px solid #ddd", borderRadius: "6px",
  padding: "8px 10px", fontWeight: 700, fontSize: "13px",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};

const pad2 = (n) => String(n).padStart(2, "0");
// Plain "YYYY-MM-DD" formatter — this component's own contentCalendar.date
// and videos.Date are stored as UTC midnight (the standard `new
// Date("YYYY-MM-DD")` string-parse trick every date-only field elsewhere in
// this app relies on — see TeamPage.js's own formatGameDate), so those are
// read back with UTC getters. articles.publishedAt is the one exception —
// ArticlesManager.js's parsePublishedAt builds it with `new Date(y, m-1, d)`
// (the *numeric* Date constructor, always local, not the ISO-string one),
// so that one has to be read back — and rewritten, on drag/drop — with
// local getters instead, or it'd land a calendar day off for anyone not on
// UTC-equivalent local time. See videoEntries/articleEntries and
// handleDropOnDate below for where each of those two conventions applies.
const dateKeyUTC = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const dateKeyFromTimestamp = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  if (!d) return "";
  return dateKeyUTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const dateKeyFromArticleTimestamp = (ts) => {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null;
  if (!d) return "";
  return dateKeyUTC(d.getFullYear(), d.getMonth(), d.getDate());
};
const MONTH_LABEL_FMT = { month: "long", year: "numeric", timeZone: "UTC" };
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Every day cell is exactly this tall, full stop — a fixed size instead of
// min-height, so no cell (and no row, since CSS grid rows share the height
// of their tallest member) is ever "warped" taller than the rest by a
// Saturday with a dozen pulled-in videos/articles. Overflow past this
// scrolls inside the cell instead (see the chip-list div in the grid render
// below), rather than growing it — that only actually holds if the cell
// itself also sets overflow:hidden (see its own style comment); height
// alone doesn't stop a grid item's automatic minimum size from winning.
const CELL_HEIGHT = "96px";
// Calendar chips are narrow — a long subject name doesn't just get clipped
// by CSS overflow, it's hard-cut to a fixed length so every chip reads as
// roughly the same width regardless of font/browser rounding.
const MAX_LABEL_CHARS = 16;
const truncateLabel = (label) => {
  if (!label) return "";
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS)}...` : label;
};

const BLANK_FORM = { date: "", type: "video", subjectType: "player", subjectId: "", subjectLabel: "", note: "" };

// Search-input + dropdown-of-matches combobox for picking this entry's
// subject — same pattern as PerformancesManager.js's own VideoLookupCombobox,
// just swapping its option source (players/recruits/teams) based on
// subjectType rather than always searching one fixed collection.
function SubjectCombobox({ subjectType, subjectId, subjectLabel, players, recruits, teams, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pool = subjectType === "team" ? teams : subjectType === "recruit" ? recruits : players;
  const labelFor = (o) => subjectType === "team" ? (o.School || "") : `${o.First || ""} ${o.Last || ""}`.trim();
  const subFor = (o) => subjectType === "team" ? (o.Conference || "—") : [o.Position, o.School].filter(Boolean).join(" · ") || "—";

  const displayValue = open ? query : (subjectLabel || "");
  const q = query.trim().toLowerCase();
  const filtered = (q ? pool.filter((o) => labelFor(o).toLowerCase().includes(q)) : pool).slice(0, 8);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          value={displayValue}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          placeholder={`Search ${subjectType === "team" ? "teams" : subjectType + "s"}...`}
          autoComplete="off"
          style={{ ...inputStyle, flex: 1 }}
        />
        {subjectId && !open && (
          <button
            type="button"
            onClick={() => onChange("", "")}
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
          {filtered.map((o) => (
            <div
              key={o.id || o.School}
              onClick={() => { onChange(o.id || o.School, labelFor(o)); setQuery(""); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{labelFor(o)}</div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>{subFor(o)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ContentCalendarManager() {
  const { user } = useAuth();
  const today = new Date();

  const [players, setPlayers] = useState([]);
  const [recruits, setRecruits] = useState([]);
  const [teams, setTeams] = useState([]);
  const [entries, setEntries] = useState([]);
  // Real, already-created content pulled onto the calendar alongside the
  // manual `entries` above — see videoEntries/articleEntries below for how
  // each becomes a display entry. Performances are intentionally not
  // fetched at all here.
  const [videos, setVideos] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragMessage, setDragMessage] = useState("");

  // {year, month} — month is 0-indexed, same as Date's own getMonth().
  const [viewYear, setViewYear] = useState(today.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(today.getUTCMonth());

  const [selectedEntry, setSelectedEntry] = useState(null); // { id, isNew } | null
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // Player Bank (below the grid) — which Flag group is currently shown.
  // Defaults to the first group rather than nothing selected, since an
  // empty bank on first render would just look broken.
  const [selectedBankGroup, setSelectedBankGroup] = useState(FLAG_GROUPS[0].key);
  // Player currently mid-update (their own Flag re-assignment write in
  // flight) — just disables that one chip's dots so a slow connection
  // can't double-fire the same write, not a page-wide loading state.
  const [flagSavingId, setFlagSavingId] = useState("");
  // The Bank's own "add a player to this group" search — a fresh
  // {id, label} pair per pick rather than living in formState, since
  // picking here writes straight to that player's own doc immediately
  // instead of building up an entry to save later.
  const [bankAddPick, setBankAddPick] = useState({ id: "", label: "" });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [playerSnap, recruitSnap, teamSnap, calSnap, videoSnap, articleSnap] = await Promise.all([
          getDocs(collection(db, "players")),
          getDocs(collection(db, "recruits")),
          getDocs(collection(db, "schools")),
          getDocs(query(collection(db, "contentCalendar"))),
          getDocs(collection(db, "videos")),
          getDocs(collection(db, "articles")),
        ]);
        setPlayers(playerSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setRecruits(recruitSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setTeams(teamSnap.docs.map((d) => d.data()).filter((t) => t.School).sort((a, b) => a.School.localeCompare(b.School)));
        setEntries(calSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setVideos(videoSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setArticles(articleSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Content calendar fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const recruitsById = useMemo(() => new Map(recruits.map((r) => [r.id, r])), [recruits]);

  // Player Bank — every player flagged (AdminPanel.js's Player Data →
  // Flag) into whichever of the three groups is currently selected.
  const bankPlayers = useMemo(
    () => players
      .filter((p) => p.Flag === selectedBankGroup)
      .sort((a, b) => `${a.First || ""} ${a.Last || ""}`.localeCompare(`${b.First || ""} ${b.Last || ""}`)),
    [players, selectedBankGroup]
  );

  // One video doc -> one display entry, standing in for whichever player/
  // recruit it's tagged to. "items" holds up to 3 tag slots (see
  // AdminPanel.js's VideosSection); an empty slot has no playerId/recruitId
  // at all. Exactly one real tag shows that person's name; zero or more
  // than one falls back to the video's own generic title, per the "more
  // than one player -> generic name" rule.
  const videoEntries = useMemo(() => {
    return videos.map((v) => {
      const tagged = (Array.isArray(v.items) ? v.items : [])
        .filter((it) => (it.type === "recruit" ? it.recruitId : it.playerId));
      let subjectLabel = "";
      if (tagged.length === 1) {
        const it = tagged[0];
        const person = it.type === "recruit" ? recruitsById.get(it.recruitId) : playersById.get(it.playerId);
        if (person) subjectLabel = `${person.First || ""} ${person.Last || ""}`.trim();
      }
      if (!subjectLabel) subjectLabel = v.GenTitle || (v.Short ? "Short" : "Video");
      const dateKey = dateKeyFromTimestamp(v.Date);
      if (!dateKey) return null;
      return { id: `video:${v.id}`, refId: v.id, source: "video", type: v.Short === true ? "short" : "video", subjectLabel, dateKey };
    }).filter(Boolean);
  }, [videos, playersById, recruitsById]);

  // Same idea for articles — tagged via ArticlesManager.js's own playerIds
  // array (its Tagged Players list, not whatever's linked in the body).
  // Falls back to the article's own titleShort/title, same "more than one
  // -> generic" rule as videos above. publishedAt reads with LOCAL getters
  // — see dateKeyFromArticleTimestamp's own comment for why that one field
  // differs from every other date-only field in this app.
  const articleEntries = useMemo(() => {
    return articles.map((a) => {
      const ids = Array.isArray(a.playerIds) ? a.playerIds : [];
      let subjectLabel = "";
      if (ids.length === 1) {
        const person = playersById.get(ids[0]);
        if (person) subjectLabel = `${person.First || ""} ${person.Last || ""}`.trim();
      }
      if (!subjectLabel) subjectLabel = a.titleShort || a.title || "Article";
      const dateKey = dateKeyFromArticleTimestamp(a.publishedAt);
      if (!dateKey) return null;
      return { id: `article:${a.id}`, refId: a.id, source: "article", type: "article", subjectLabel, dateKey };
    }).filter(Boolean);
  }, [articles, playersById]);

  // Every chip the grid actually renders — manual plans plus the pulled-in
  // real content above, merged into one shape so the grid/drag-drop code
  // below doesn't need to special-case where an entry came from. `raw`
  // (manual only) is the original contentCalendar doc, for the edit form.
  const displayEntries = useMemo(() => {
    const manual = entries.map((e) => ({
      id: `manual:${e.id}`, refId: e.id, source: "manual", type: e.type,
      subjectLabel: e.subjectLabel, dateKey: dateKeyFromTimestamp(e.date), raw: e,
    }));
    return [...manual, ...videoEntries, ...articleEntries];
  }, [entries, videoEntries, articleEntries]);

  // Grouped by "YYYY-MM-DD" for O(1) lookup per grid cell, rather than
  // filtering the whole displayEntries array once per day rendered.
  const entriesByDate = useMemo(() => {
    const map = {};
    displayEntries.forEach((e) => {
      if (!e.dateKey) return;
      (map[e.dateKey] = map[e.dateKey] || []).push(e);
    });
    return map;
  }, [displayEntries]);

  // Drag-and-drop reschedule — manual plans only (see the header comment's
  // "read-only/not draggable" note on pulled-in videos/articles; only a
  // manual chip's source ever gets `draggable` below, so this never fires
  // for the other two). Each draggable chip stashes its own doc id via the
  // native HTML5 drag payload (dataTransfer); a day cell's onDrop reads it
  // back and rewrites that contentCalendar doc's own `date` field.
  const handleDropOnDate = async (refId, cellDate, currentKey) => {
    const y = cellDate.getUTCFullYear(), m = cellDate.getUTCMonth(), d = cellDate.getUTCDate();
    const targetKey = dateKeyUTC(y, m, d);
    if (targetKey === currentKey) return; // dropped back on its own day — nothing to do
    try {
      const newDate = new Date(Date.UTC(y, m, d));
      await updateDoc(doc(db, "contentCalendar", refId), { date: newDate });
      setEntries((prev) => prev.map((e) => (e.id === refId ? { ...e, date: newDate } : e)));
      setDragMessage("Moved.");
    } catch (e) {
      console.error("Content calendar reschedule error:", e);
      setDragMessage("Failed to move — check console.");
    } finally {
      setTimeout(() => setDragMessage(""), 2500);
    }
  };

  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString(undefined, MONTH_LABEL_FMT);
  const todayKey = dateKeyUTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  // Always a full 6x7 grid (42 cells) — leading/trailing days from the
  // adjacent months fill it out, dimmed, so the grid never reflows height
  // between a 4-week and 6-week month.
  const gridCells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startOffset = firstOfMonth.getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dayNum = i - startOffset + 1;
      const cellDate = new Date(Date.UTC(viewYear, viewMonth, dayNum));
      cells.push({
        key: dateKeyUTC(cellDate.getUTCFullYear(), cellDate.getUTCMonth(), cellDate.getUTCDate()),
        dayOfMonth: cellDate.getUTCDate(),
        inMonth: dayNum >= 1 && dayNum <= daysInMonth,
        cellDate,
      });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const goMonth = (delta) => {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    else if (m > 11) { m = 0; y += 1; }
    setViewMonth(m); setViewYear(y);
  };

  const startNewEntry = (cellDate) => {
    setSelectedEntry({ id: null, isNew: true });
    setFormState({ ...BLANK_FORM, date: cellDate ? cellDate.toISOString().slice(0, 10) : "" });
    setSaveMessage("");
  };

  // Player Bank chip clicked — opens the same "new entry" form startNewEntry
  // does, just pre-filled with that player as the subject and the group's
  // own defaultType (see FLAG_GROUPS) instead of blank. Date is left empty
  // (no day was clicked) for the admin to pick.
  const startEntryForBankPlayer = (player, defaultType) => {
    setSelectedEntry({ id: null, isNew: true });
    setFormState({
      ...BLANK_FORM,
      type: defaultType,
      subjectType: "player",
      subjectId: player.id,
      subjectLabel: `${player.First || ""} ${player.Last || ""}`.trim(),
    });
    setSaveMessage("");
  };

  // Reassign (or clear, newFlag === "") a player's own Flag straight from
  // the Bank — same field AdminPanel.js's Player Data → Flag writes,
  // just editable here too instead of needing a trip to that tab.
  const handleSetPlayerFlag = async (playerId, newFlag) => {
    setFlagSavingId(playerId);
    try {
      await updateDoc(doc(db, "players", playerId), { Flag: newFlag });
      setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, Flag: newFlag } : p)));
    } catch (e) {
      console.error("Player Bank flag update error:", e);
    } finally {
      setFlagSavingId("");
    }
  };

  const selectEntry = (entry) => {
    setSelectedEntry(entry);
    setFormState({
      date: dateKeyFromTimestamp(entry.date),
      type: entry.type || "video",
      subjectType: entry.subjectType || "player",
      subjectId: entry.subjectId || "",
      subjectLabel: entry.subjectLabel || "",
      note: entry.note || "",
    });
    setSaveMessage("");
  };

  const isNew = selectedEntry?.isNew === true;

  const handleSave = async () => {
    if (!formState) return;
    if (!formState.date) { setSaveMessage("Failed: pick a date."); return; }
    // Custom Text needs a typed label instead of a tagged subjectId — every
    // other subject type still needs an actual pick.
    const hasSubject = formState.subjectType === "custom" ? !!formState.subjectLabel.trim() : !!formState.subjectId;
    if (!hasSubject) { setSaveMessage("Failed: pick a subject or enter a title."); return; }
    setSaving(true);
    setSaveMessage("");
    try {
      const [y, m, d] = formState.date.split("-").map(Number);
      const payload = {
        date: new Date(Date.UTC(y, m - 1, d)),
        type: formState.type,
        subjectType: formState.subjectType,
        subjectId: formState.subjectId,
        subjectLabel: formState.subjectLabel.trim(),
        note: formState.note?.trim() || "",
      };
      if (isNew) {
        payload.createdAt = serverTimestamp();
        payload.createdBy = user?.uid || "";
        const ref = await addDoc(collection(db, "contentCalendar"), payload);
        const newEntry = { id: ref.id, ...payload };
        setEntries((prev) => [...prev, newEntry]);
        setSelectedEntry(newEntry);
        setSaveMessage("Added to calendar.");
      } else {
        await updateDoc(doc(db, "contentCalendar", selectedEntry.id), payload);
        setEntries((prev) => prev.map((e) => (e.id === selectedEntry.id ? { ...e, ...payload } : e)));
        setSaveMessage("Saved.");
      }
    } catch (e) {
      console.error("Content calendar save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedEntry || isNew) return;
    if (!window.confirm("Remove this from the content calendar?")) return;
    setRemoving(true);
    try {
      await deleteDoc(doc(db, "contentCalendar", selectedEntry.id));
      setEntries((prev) => prev.filter((e) => e.id !== selectedEntry.id));
      setSelectedEntry(null);
      setFormState(null);
    } catch (e) {
      console.error("Content calendar delete error:", e);
      setSaveMessage("Failed to remove — check console.");
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading" size={28} minHeight="200px" />;

  return (
    <>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 230px", gap: "14px", alignItems: "start" }}>
      {/* ===== Left: month grid ===== */}
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => goMonth(-1)}
            style={{ background: "none", border: "none", color: "#fff", fontSize: "18px", fontWeight: 900, cursor: "pointer", padding: "0 8px" }}
          >
            ‹
          </button>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {monthLabel}
          </div>
          <button
            onClick={() => goMonth(1)}
            style={{ background: "none", border: "none", color: "#fff", fontSize: "18px", fontWeight: 900, cursor: "pointer", padding: "0 8px" }}
          >
            ›
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "8px 14px", borderBottom: "1px solid #eee", background: "#fafbfc", flexWrap: "wrap" }}>
          {CONTENT_TYPES.map((t) => (
            <div key={t.key} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ width: "9px", height: "9px", borderRadius: "3px", background: t.color, display: "inline-block" }} />
              <span style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t.label}</span>
            </div>
          ))}
          <div style={{ width: "1px", height: "14px", background: "#ddd" }} />
          {/* Same solid-vs-dashed distinction the chips themselves use (see
              the grid render below) — added manually vs. pulled in from the
              Videos/Articles feed on its own. */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "9px", height: "9px", borderRadius: "3px", background: "#888", border: "1px solid #666", display: "inline-block" }} />
            <span style={{ fontSize: "10px", fontWeight: 700, color: "#888" }}>Added</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: "9px", height: "9px", borderRadius: "3px", background: "#888", border: "1px dashed #666", display: "inline-block" }} />
            <span style={{ fontSize: "10px", fontWeight: 700, color: "#888" }}>🔗 Pulled from feed</span>
          </div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "#bbb", fontStyle: "italic", marginLeft: "auto" }}>
            Drag a planned entry to a different day to reschedule it
          </span>
          {dragMessage && (
            <span style={{ fontSize: "10px", fontWeight: 900, color: dragMessage.startsWith("Failed") ? "#c0392b" : "#2e7d32" }}>
              {dragMessage}
            </span>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} style={{ padding: "6px 4px", textAlign: "center", fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "2px solid #eee" }}>
              {w}
            </div>
          ))}
          {gridCells.map((cell) => {
            const dayEntries = entriesByDate[cell.key] || [];
            const isToday = cell.key === todayKey;
            return (
              <div
                key={cell.key}
                onClick={() => startNewEntry(cell.cellDate)}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const raw = e.dataTransfer.getData("text/plain");
                  if (!raw) return;
                  try {
                    const { refId, dateKey } = JSON.parse(raw);
                    handleDropOnDate(refId, cell.cellDate, dateKey);
                  } catch { /* malformed payload — ignore */ }
                }}
                style={{
                  // Fixed, not min — every cell (and every row) stays the
                  // exact same size regardless of how many entries a given
                  // day has; a busy Saturday scrolls internally (see the
                  // chip-list div below) instead of stretching its whole row
                  // taller than the rest of the grid. height alone isn't
                  // enough here: this cell is itself a CSS grid item, and a
                  // grid item's automatic minimum size defaults to its
                  // content's min-content — which can still win over an
                  // explicit height and stretch the row anyway — UNLESS the
                  // item's own overflow is something other than visible.
                  // The inner chip-list div's own overflowY:auto further
                  // down doesn't count for this; it has to be set here too,
                  // on the cell itself, which is what was actually letting
                  // a busy day (and everything below it that month) push
                  // past the grid and get clipped/hidden by whatever
                  // contains the whole calendar.
                  height: CELL_HEIGHT, minHeight: CELL_HEIGHT, maxHeight: CELL_HEIGHT, overflow: "hidden",
                  padding: "6px", borderRight: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0",
                  background: cell.inMonth ? "#fff" : "#fafbfc", cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: "3px", boxSizing: "border-box",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = cell.inMonth ? "#f7f9fc" : "#f2f3f5"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = cell.inMonth ? "#fff" : "#fafbfc"; }}
                title="Click to add an entry for this day, or drop a dragged chip here"
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                  <div style={{
                    fontSize: "11px", fontWeight: 900,
                    color: isToday ? "#fff" : cell.inMonth ? "#999" : "#ccc",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "20px", height: "20px", borderRadius: "50%",
                    background: isToday ? BLUE : "transparent",
                  }}>
                    {cell.dayOfMonth}
                  </div>
                  {dayEntries.length > 0 && (
                    <span style={{ fontSize: "9px", fontWeight: 900, color: "#bbb" }}>{dayEntries.length}</span>
                  )}
                </div>
                {/* The one part of the cell allowed to overflow — flex:1 +
                    minHeight:0 is what lets a flex child actually scroll
                    instead of just pushing the (fixed-height) cell taller. */}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "3px" }}>
                  {dayEntries.map((entry) => {
                    const style = CONTENT_TYPE_BY_KEY[entry.type] || CONTENT_TYPES[0];
                    const isManual = entry.source === "manual";
                    const note = isManual ? entry.raw?.note : "";
                    const tooltip = [`${style.label} — ${entry.subjectLabel}`, isManual ? "Added manually" : "Pulled from its own feed"];
                    if (note) tooltip.push(note);
                    return (
                      <div
                        key={entry.id}
                        draggable={isManual}
                        onDragStart={isManual ? (e) => {
                          e.stopPropagation();
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", JSON.stringify({ refId: entry.refId, dateKey: entry.dateKey }));
                        } : undefined}
                        onClick={(e) => { e.stopPropagation(); if (isManual) selectEntry(entry.raw); }}
                        title={tooltip.join(" — ")}
                        style={{
                          display: "flex", alignItems: "center", gap: "4px", flexShrink: 0,
                          width: "100%", minWidth: 0, boxSizing: "border-box",
                          background: style.color, color: "#fff", borderRadius: "4px",
                          padding: "2px 6px", fontSize: "10px", fontWeight: 800,
                          cursor: isManual ? "grab" : "default",
                          // Solid border = added manually here; dashed,
                          // slightly faded = pulled in from the Videos/
                          // Articles feed on its own — see the legend above.
                          border: isManual ? "1px solid rgba(255,255,255,0.4)" : "1px dashed rgba(255,255,255,0.55)",
                          opacity: isManual ? 1 : 0.82,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>{style.icon}</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {truncateLabel(entry.subjectLabel)}
                        </span>
                        {note && <span style={{ flexShrink: 0 }} title="Has a note">📝</span>}
                        {!isManual && <span style={{ flexShrink: 0, opacity: 0.85 }} title="Pulled from its own feed">🔗</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== Right: add/edit form ===== */}
      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden", position: "sticky", top: "20px" }}>
        <div style={{ background: GOLD, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {isNew ? "New Entry" : selectedEntry ? "Edit Entry" : "Content Calendar"}
          </div>
          {!selectedEntry && (
            <button
              onClick={() => startNewEntry(null)}
              style={{
                marginLeft: "auto", background: "rgba(255,255,255,0.25)", color: "#fff", border: "none",
                borderRadius: "6px", padding: "5px 10px", fontWeight: 900, fontSize: "11px",
                textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
              }}
            >
              + New
            </button>
          )}
        </div>

        {!selectedEntry || !formState ? (
          <div style={{ padding: "24px 18px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click a day on the calendar (or "+ New") to plan a video, article, or post.
          </div>
        ) : (
          <div style={{ padding: "16px" }}>
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Date</div>
              <input type="date" value={formState.date} onChange={(e) => setFormState((p) => ({ ...p, date: e.target.value }))} style={inputStyle} />
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Content Type</div>
              <div style={{ display: "flex", gap: "6px" }}>
                {CONTENT_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFormState((p) => ({ ...p, type: t.key }))}
                    style={{
                      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                      padding: "8px 6px", borderRadius: "6px", cursor: "pointer",
                      border: `2px solid ${t.color}`,
                      background: formState.type === t.key ? t.color : "#fff",
                      color: formState.type === t.key ? "#fff" : t.color,
                      fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em",
                    }}
                  >
                    <span>{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Subject</div>
              <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                {SUBJECT_TYPES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setFormState((p) => ({ ...p, subjectType: s.key, subjectId: "", subjectLabel: "" }))}
                    style={{
                      flex: 1, padding: "6px", borderRadius: "6px", cursor: "pointer",
                      border: "2px solid " + BLUE,
                      background: formState.subjectType === s.key ? BLUE : "#fff",
                      color: formState.subjectType === s.key ? "#fff" : BLUE,
                      fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {formState.subjectType === "custom" ? (
                <input
                  value={formState.subjectLabel}
                  onChange={(e) => setFormState((p) => ({ ...p, subjectLabel: e.target.value }))}
                  placeholder="Type whatever this entry is about..."
                  style={inputStyle}
                />
              ) : (
                <SubjectCombobox
                  subjectType={formState.subjectType}
                  subjectId={formState.subjectId}
                  subjectLabel={formState.subjectLabel}
                  players={players}
                  recruits={recruits}
                  teams={teams}
                  onChange={(id, label) => setFormState((p) => ({ ...p, subjectId: id, subjectLabel: label }))}
                />
              )}
            </div>

            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                Note <span style={{ textTransform: "none", fontWeight: 700, color: "#bbb" }}>(optional)</span>
              </div>
              <textarea
                value={formState.note}
                onChange={(e) => setFormState((p) => ({ ...p, note: e.target.value }))}
                placeholder="What this is about, an angle to take, who's involved..."
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", fontWeight: 500 }}
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%", background: BLUE, color: "#fff", border: "2px solid " + GOLD,
                borderRadius: "8px", padding: "11px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : isNew ? "Add to Calendar" : "Save Changes"}
            </button>

            {!isNew && (
              <button
                onClick={handleDelete}
                disabled={removing}
                style={{
                  width: "100%", marginTop: "8px",
                  background: "#fff", color: "#c0392b", border: "2px solid #c0392b",
                  borderRadius: "8px", padding: "9px", fontWeight: 900, fontSize: "12px",
                  textTransform: "uppercase", letterSpacing: "0.06em", cursor: removing ? "default" : "pointer",
                  opacity: removing ? 0.6 : 1,
                }}
              >
                {removing ? "Removing..." : "Remove"}
              </button>
            )}

            <button
              onClick={() => { setSelectedEntry(null); setFormState(null); setSaveMessage(""); }}
              style={{
                width: "100%", marginTop: "8px", background: "none", border: "none",
                color: "#999", fontWeight: 900, fontSize: "11px", textTransform: "uppercase",
                letterSpacing: "0.04em", cursor: "pointer", padding: "4px",
              }}
            >
              Close
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

    {/* ===== Player Bank ===== */}
    {/* Every player currently Flagged (AdminPanel.js's Player Data → Flag)
        into whichever of the three groups is selected below — a quick pool
        to plan content from instead of hunting each one down individually.
        Clicking a chip's name opens the same "new entry" form a calendar-
        day click does (see startEntryForBankPlayer); the small dots under
        it reassign (or the × clears) that player's own Flag right here
        (see handleSetPlayerFlag) instead of needing a trip to Player Data.
        The search box lets an unflagged player be added to the current
        group the same way. */}
    <div style={{ marginTop: "14px", border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Player Bank
        </div>
        <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
          {FLAG_GROUPS.map((g) => {
            const active = selectedBankGroup === g.key;
            const count = players.filter((p) => p.Flag === g.key).length;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setSelectedBankGroup(g.key)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 12px", borderRadius: "20px", cursor: "pointer",
                  border: "2px solid " + g.hex,
                  background: active ? g.hex : "rgba(255,255,255,0.9)",
                  color: active ? "#fff" : g.hex,
                  fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em",
                }}
              >
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: active ? "#fff" : g.hex, flexShrink: 0 }} />
                {g.label} ({count})
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ height: "3px", background: GOLD }} />

      {/* Add a player straight into the currently-selected group. */}
      <div style={{ padding: "12px 16px 0", maxWidth: "320px" }}>
        <SubjectCombobox
          subjectType="player"
          subjectId={bankAddPick.id}
          subjectLabel={bankAddPick.label}
          players={players}
          recruits={[]}
          teams={[]}
          onChange={(id, label) => {
            if (id) handleSetPlayerFlag(id, selectedBankGroup);
            setBankAddPick({ id: "", label: "" }); // reset so the box is ready for the next add either way
          }}
        />
      </div>

      <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: "8px", minHeight: "56px" }}>
        {bankPlayers.length === 0 ? (
          <div style={{ color: "#999", fontWeight: 700, fontSize: "13px", fontStyle: "italic", padding: "8px 0" }}>
            No players flagged {FLAG_GROUPS.find((g) => g.key === selectedBankGroup)?.label} yet.
          </div>
        ) : (
          bankPlayers.map((p) => {
            const group = FLAG_GROUPS.find((g) => g.key === selectedBankGroup);
            const isSaving = flagSavingId === p.id;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex", flexDirection: "column", gap: "6px",
                  padding: "6px 10px 8px", borderRadius: "8px",
                  border: "2px solid " + group.hex, background: "#fff",
                  opacity: isSaving ? 0.6 : 1,
                }}
              >
                <button
                  type="button"
                  onClick={() => startEntryForBankPlayer(p, group.defaultType)}
                  title={`Plan content for ${p.First || ""} ${p.Last || ""}`.trim()}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start",
                    background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>
                    {`${p.First || ""} ${p.Last || ""}`.trim()}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: "11px", color: "#888" }}>
                    {[p.Position, p.School].filter(Boolean).join(" · ") || "—"}
                  </span>
                </button>
                {/* Reassign/clear this player's own Flag — separate click
                    target from the button above, so picking a group above
                    doesn't also open the new-entry form. */}
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {FLAG_GROUPS.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      disabled={isSaving}
                      title={`Move to ${g.label}`}
                      onClick={() => handleSetPlayerFlag(p.id, g.key)}
                      style={{
                        width: "16px", height: "16px", borderRadius: "50%", padding: 0,
                        border: "2px solid " + (g.key === p.Flag ? g.hex : "#ddd"),
                        background: g.key === p.Flag ? g.hex : "#fff",
                        cursor: isSaving ? "default" : "pointer",
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    disabled={isSaving}
                    title="Remove flag"
                    onClick={() => handleSetPlayerFlag(p.id, "")}
                    style={{
                      marginLeft: "2px", background: "none", border: "none", color: "#bbb",
                      fontWeight: 900, fontSize: "12px", cursor: isSaving ? "default" : "pointer", padding: 0, lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
    </>
  );
}
