// src/components/PerformancesManager.js
//
// Admin Panel "Performances" section — look up a player, pick one of their
// games from this season's schedule, and author a performance write-up for
// it (long-form title, short-form title, a text box, and an optional video
// pulled from the existing video database). Structured the same way as
// ArticlesManager.js (search list + a form panel), just with two lookup
// steps — player, then game — ahead of the actual editor, since a
// performance is always scoped to one specific game.
//
// Display of these on the public site is intentionally not built yet —
// this is authoring/data-layer only for now.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "./LoadingSpinner";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Mirrors TeamPage.js — the current season's schedule collection.
const SCHEDULE_COLLECTION = "schedule26";
const SEASON_LABEL = "2026";

const createSlug = (text) => text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");

// Slug = short-form title + the game's date — deterministic and stable as
// long as the short title and game don't change, no manual override needed
// (mirrors ArticlesManager.js's createSlug, just with the date appended
// since short titles alone collide easily across performances).
const slugFor = (titleShort, gameDate) => {
  const d = gameDate?.toDate ? gameDate.toDate() : gameDate ? new Date(gameDate) : null;
  const dateStr = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  return [createSlug(titleShort || ""), dateStr].filter(Boolean).join("-");
};

const BLANK_FORM = {
  titleLong: "", titleShort: "", body: "", statLine: "", videoId: "", author: "", status: "draft", grade: "", playerIds: [],
};

const GRADE_OPTIONS = ["Dominant", "Great", "Good", "Productive", "Average", "Bad"];

// Mirrors PlayerProfile.js's grade-to-rank-value mapping — needed here to
// replicate its "position rank within draft class" computation for the
// Generate Tweet feature below (this isn't a stored/denormalized field
// anywhere, so it has to be recomputed the same way on demand).
const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3, "Second Round": 4,
  "Third Round": 5, "Fourth Round": 6, "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, "UDFA": 10,
};
const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round", 4: "Second Round",
  5: "Third Round", 6: "Fourth Round", 7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
};

// Position abbreviation -> plural noun, for the "ranked Nth out of M
// {year} {plural}" sentence in a generated tweet.
const POSITION_PLURAL = {
  QB: "quarterbacks", RB: "running backs", WR: "wide receivers", TE: "tight ends",
  OL: "offensive linemen", OT: "offensive tackles", OG: "offensive guards", C: "centers",
  IOL: "interior offensive linemen", EDGE: "edge rushers", DL: "defensive linemen",
  DT: "defensive tackles", DE: "defensive ends", LB: "linebackers", ILB: "inside linebackers",
  OLB: "outside linebackers", DB: "defensive backs", CB: "cornerbacks", S: "safeties",
  FS: "free safeties", SS: "strong safeties", K: "kickers", P: "punters", LS: "long snappers",
  ATH: "athletes",
};

const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

const gradeStyles = {
  Dominant: { background: "#e6f4ea", color: "#1a7f37" },
  Great: { background: "#eaf6ec", color: "#2e7d32" },
  Good: { background: "#eaf1ff", color: BLUE },
  Productive: { background: "#fff8e1", color: "#9c7a00" },
  Average: { background: "#f0f0f0", color: "#666" },
  Bad: { background: "#fdeaea", color: "#c0392b" },
};

const inputStyle = {
  width: "100%", border: "2px solid #ddd", borderRadius: "6px",
  padding: "8px 10px", fontWeight: 700, fontSize: "13px",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "160px", resize: "vertical", lineHeight: 1.5, fontWeight: 500,
};

const statusStyles = {
  published: { background: "#e6f4ea", color: "#1a7f37" },
  draft: { background: "#f0f0f0", color: "#666" },
};

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return ts;
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

const formatGameDate = (ts) => {
  const ms = toMs(ts);
  if (!ms) return "TBD";
  // Date-only field is stored as UTC midnight — format in UTC too, or a
  // viewer west of it sees the game roll back a calendar day.
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
};

const weekNumber = (w) => {
  const m = /(\d+)/.exec(w || "");
  return m ? Number(m[1]) : 999;
};

// Same search-input + dropdown-of-matches pattern as AdminPanel.js's
// PlayerLookupCombobox, adapted to pick an existing video doc instead of a
// player — reused here for the "select a video" field on the performance
// form.
function VideoLookupCombobox({ videoId, onChange, videos }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const labelFor = (v) => v?.GenTitle || v?.items?.find((it) => it.title)?.title || v?.Video || "Untitled Video";

  const selected = videos.find((v) => v.id === videoId) || null;
  const displayValue = open ? query : (selected ? labelFor(selected) : "");

  const q = query.trim().toLowerCase();
  const filtered = (q
    ? videos.filter((v) => labelFor(v).toLowerCase().includes(q))
    : videos
  ).slice(0, 8);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          value={displayValue}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          placeholder="Search videos..."
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
          {filtered.map((v) => (
            <div
              key={v.id}
              onClick={() => { onChange(v.id); setQuery(""); setOpen(false); }}
              style={{ padding: "8px 10px", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{labelFor(v)}</div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {v.Video || "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Search-and-add version of the lookup pattern above — unlike
// VideoLookupCombobox/PlayerLookupCombobox (which hold one selected value),
// this one always clears itself after a pick since it's adding to a list
// (formState.playerIds) rather than replacing a single field. Players
// already on the list are excluded from suggestions.
function PlayerAddCombobox({ excludeIds, onAdd, players }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const q = query.trim().toLowerCase();
  const excluded = new Set(excludeIds);
  const filtered = (q
    ? players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q))
    : players
  ).filter((p) => !excluded.has(p.id)).slice(0, 8);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Add another player mentioned..."
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
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>{p.Position || "—"} · {p.School || "—"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PerformancesManager() {
  const { user } = useAuth();

  const [allPlayers, setAllPlayers] = useState([]);
  const [videos, setVideos] = useState([]);
  const [performances, setPerformances] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);

  // Generate Tweet — copy-pasteable promo text for the performance being
  // edited, computed on demand (not stored) from the player's live
  // position rank + the subject/opponent schools' abbreviation & mascot.
  const [tweetText, setTweetText] = useState("");
  const [tweetLoading, setTweetLoading] = useState(false);
  const [tweetError, setTweetError] = useState("");
  const [tweetCopied, setTweetCopied] = useState(false);

  const [playerSearch, setPlayerSearch] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);

  const [selectedPerformance, setSelectedPerformance] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // Browse-by-week — a second way into an existing performance, alongside
  // the player-search flow above, for when the admin wants to see/manage
  // everything tagged to a given week rather than starting from a player.
  const [browseWeek, setBrowseWeek] = useState("");
  const [jumping, setJumping] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [playersSnap, videosSnap, performancesSnap, schoolsSnap] = await Promise.all([
          getDocs(collection(db, "players")),
          getDocs(collection(db, "videos")),
          getDocs(collection(db, "performances")),
          getDocs(collection(db, "schools")),
        ]);
        setAllPlayers(playersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setVideos(videosSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPerformances(performancesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSchools(schoolsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Performances fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Player search is deliberately search-first (no full roster dump) — the
  // players collection is large and this is a lookup tool, not a browse list.
  const filteredPlayers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return [];
    return allPlayers
      .filter((p) => `${p.First || ""} ${p.Last || ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.Last || "").localeCompare(b.Last || ""))
      .slice(0, 40);
  }, [playerSearch, allPlayers]);

  const performanceCountByGameId = useMemo(() => {
    const m = {};
    performances.forEach((p) => { m[p.gameId] = (m[p.gameId] || 0) + 1; });
    return m;
  }, [performances]);

  const performancesForGame = useMemo(() => {
    if (!selectedGame) return [];
    return performances
      .filter((p) => p.gameId === selectedGame.id)
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }, [performances, selectedGame]);

  const playersById = useMemo(() => {
    const m = new Map();
    allPlayers.forEach((p) => m.set(p.id, p));
    return m;
  }, [allPlayers]);

  const schoolsByName = useMemo(() => {
    const m = new Map();
    schools.forEach((s) => { if (s.School) m.set(s.School, s); });
    return m;
  }, [schools]);

  const weekOptions = useMemo(
    () => Array.from(new Set(performances.map((p) => p.week).filter(Boolean))).sort((a, b) => weekNumber(a) - weekNumber(b)),
    [performances]
  );

  // Default the browse-week picker to the earliest week that actually has
  // performances, once — never overrides an admin's own selection afterward.
  useEffect(() => {
    if (!browseWeek && weekOptions.length > 0) setBrowseWeek(weekOptions[0]);
  }, [weekOptions, browseWeek]);

  const performancesForBrowseWeek = useMemo(() => {
    return performances
      .filter((p) => p.week === browseWeek)
      .sort((a, b) => toMs(b.gameDate) - toMs(a.gameDate));
  }, [performances, browseWeek]);

  // Jump straight into editing a performance found via the week browser,
  // reconstructing the player/game context the search flow would normally
  // build up (fetches that player's full schedule too, so the admin can
  // still navigate to a different game from here if they want).
  const jumpToPerformance = async (perf) => {
    const p = playersById.get(perf.playerId);
    setPlayerSearch("");
    setJumping(true);
    setSaveMessage("");
    try {
      if (p) {
        setSelectedPlayer(p);
        setScheduleLoading(true);
        const [awaySnap, homeSnap] = await Promise.all([
          getDocs(query(collection(db, SCHEDULE_COLLECTION), where("Away", "==", p.School))),
          getDocs(query(collection(db, SCHEDULE_COLLECTION), where("Home", "==", p.School))),
        ]);
        const seenIds = new Set();
        const games = [...awaySnap.docs, ...homeSnap.docs]
          .filter((d) => { if (seenIds.has(d.id)) return false; seenIds.add(d.id); return true; })
          .map((d) => ({ id: d.id, ...d.data() }));
        games.sort((a, b) => toMs(a.Date) - toMs(b.Date));
        setSchedule(games);
        setScheduleLoading(false);
        const g = games.find((gm) => gm.id === perf.gameId) || null;
        setSelectedGame(g);
      }
      selectPerformance(perf);
    } catch (e) {
      console.error("Jump to performance error:", e);
    } finally {
      setJumping(false);
    }
  };

  const selectPlayer = async (p) => {
    setSelectedPlayer(p);
    setSelectedGame(null);
    setSelectedPerformance(null);
    setFormState(null);
    setSaveMessage("");
    setPlayerSearch("");
    setSchedule([]);

    if (!p.School) return;
    setScheduleLoading(true);
    try {
      // A team can appear as either side of a matchup — same Home/Away
      // merge-and-dedupe TeamPage.js uses for its schedule sidebar.
      const [awaySnap, homeSnap] = await Promise.all([
        getDocs(query(collection(db, SCHEDULE_COLLECTION), where("Away", "==", p.School))),
        getDocs(query(collection(db, SCHEDULE_COLLECTION), where("Home", "==", p.School))),
      ]);
      const seenIds = new Set();
      const games = [...awaySnap.docs, ...homeSnap.docs]
        .filter((d) => { if (seenIds.has(d.id)) return false; seenIds.add(d.id); return true; })
        .map((d) => ({ id: d.id, ...d.data() }));
      games.sort((a, b) => toMs(a.Date) - toMs(b.Date));
      setSchedule(games);
    } catch (e) {
      console.error("Performances schedule load error:", e);
      setSchedule([]);
    } finally {
      setScheduleLoading(false);
    }
  };

  const selectGame = (g) => {
    setSelectedGame(g);
    setSelectedPerformance(null);
    setFormState(null);
    setSaveMessage("");
    setTweetText("");
    setTweetError("");
  };

  const selectPerformance = (perf) => {
    setSelectedPerformance(perf);
    setTweetText("");
    setTweetError("");
    setFormState({
      titleLong: perf.titleLong || "",
      titleShort: perf.titleShort || "",
      body: perf.body || "",
      statLine: perf.statLine || "",
      videoId: perf.videoId || "",
      author: perf.author || "",
      status: perf.status || "draft",
      grade: perf.grade || "",
      // Legacy performances (saved before this field existed) only have the
      // single `playerId` — fall back to that so they still show something.
      playerIds: perf.playerIds?.length ? perf.playerIds : [perf.playerId].filter(Boolean),
    });
    setSaveMessage("");
  };

  const startNewPerformance = () => {
    setSelectedPerformance({ id: null, isNew: true });
    setFormState({ ...BLANK_FORM, playerIds: [selectedPlayer.id] });
    setSaveMessage("");
    setTweetText("");
    setTweetError("");
  };

  // Replicates PlayerProfile.js's fetchDraftClass effect: pull every player
  // in the same draft class (Eligible year), average each one's evaluation
  // grades into a rank value, sort, then filter down to just this player's
  // position to get rank/total. Not a stored field — recomputed live so it
  // always reflects the current community grades at the moment of tweeting.
  const computePositionRank = async (player) => {
    if (!player?.Position || !player?.Eligible) return null;
    const q = query(collection(db, "players"), where("Eligible", "==", player.Eligible));
    const snap = await getDocs(q);
    const list = await Promise.all(
      snap.docs
        .filter((d) => d.id === player.id || d.data().Live !== false)
        .map(async (d) => {
          const data = d.data();
          let avgGrade = null;
          try {
            const evalsSnap = await getDocs(collection(db, "players", d.id, "evaluations"));
            const grades = [];
            evalsSnap.forEach((ev) => {
              const g = ev.data().grade;
              if (g && gradeScale[g]) grades.push(gradeScale[g]);
            });
            if (grades.length > 0) avgGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
          } catch { /* no evaluations subcollection access — leave avgGrade null */ }
          return { id: d.id, Position: data.Position || "", avgGrade, isSelf: d.id === player.id };
        })
    );
    list.sort((a, b) => {
      const aLabel = a.avgGrade != null ? gradeLabels[Math.round(a.avgGrade)] : null;
      const bLabel = b.avgGrade != null ? gradeLabels[Math.round(b.avgGrade)] : null;
      const aV = aLabel ? gradeScale[aLabel] : null;
      const bV = bLabel ? gradeScale[bLabel] : null;
      if (aV && bV) return aV - bV;
      if (aV && !bV) return -1;
      if (!aV && bV) return 1;
      return 0;
    });
    const filtered = list.filter((p) => p.Position === player.Position);
    const selfIndex = filtered.findIndex((p) => p.isSelf);
    return { rank: selfIndex >= 0 ? selfIndex + 1 : null, total: filtered.length };
  };

  const handleGenerateTweet = async () => {
    if (!formState || !selectedPlayer || !selectedGame) return;
    setTweetLoading(true);
    setTweetError("");
    setTweetCopied(false);
    try {
      const rankInfo = await computePositionRank(selectedPlayer);
      const opponentName = selectedGame.Home === selectedPlayer.School ? selectedGame.Away : selectedGame.Home;
      const subjectSchool = schoolsByName.get(selectedPlayer.School) || null;
      const opponentSchool = schoolsByName.get(opponentName) || null;
      const fullName = `${selectedPlayer.First || ""} ${selectedPlayer.Last || ""}`.trim();
      const positionPlural = POSITION_PLURAL[selectedPlayer.Position] || `${(selectedPlayer.Position || "player").toLowerCase()}s`;

      const lines = [];
      if (formState.body.trim()) lines.push(formState.body.trim());

      if (rankInfo?.rank && rankInfo?.total && selectedPlayer.Eligible) {
        lines.push(`${fullName} is currently ranked ${ordinal(rankInfo.rank)} out of ${rankInfo.total} ${selectedPlayer.Eligible} ${positionPlural} on We-Draft.com.`);
      }

      lines.push(`Evaluate ${fullName} and more draft prospects on We-Draft.com.`);

      const hashtags = [];
      if (subjectSchool?.School) hashtags.push(`#${createSlug(subjectSchool.School).replace(/-/g, "")}football`);
      if (subjectSchool?.Mascot) hashtags.push(`#${createSlug(subjectSchool.Mascot).replace(/-/g, "")}`);
      if (subjectSchool?.Short && opponentSchool?.Short) hashtags.push(`#${subjectSchool.Short}vs${opponentSchool.Short}`);
      if (selectedPlayer.Eligible) hashtags.push(`#nfldraft${selectedPlayer.Eligible}`);
      if (hashtags.length) lines.push(`${hashtags.join(" ")}.`);

      setTweetText(lines.join("\n\n"));
    } catch (e) {
      console.error("Generate tweet error:", e);
      setTweetError("Failed to generate — check console.");
    } finally {
      setTweetLoading(false);
    }
  };

  const handleCopyTweet = async () => {
    if (!tweetText) return;
    try {
      await navigator.clipboard.writeText(tweetText);
      setTweetCopied(true);
      setTimeout(() => setTweetCopied(false), 2000);
    } catch (e) {
      console.error("Copy tweet error:", e);
    }
  };

  const isNew = selectedPerformance?.isNew === true;

  const handleSave = async () => {
    if (!formState || !selectedPlayer || !selectedGame) return;
    if (!formState.titleLong.trim() || !formState.titleShort.trim()) {
      setSaveMessage("Failed: Long-form and short-form titles are required.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const opponent = selectedGame.Home === selectedPlayer.School ? selectedGame.Away : selectedGame.Home;
      const gameDate = selectedGame.Date?.toDate ? selectedGame.Date.toDate() : (selectedGame.Date ? new Date(selectedGame.Date) : null);
      const slug = slugFor(formState.titleShort.trim(), gameDate);
      // The primary subject (selectedPlayer) is always included, even if
      // somehow removed from the chip list — they're who the game/schedule
      // context is scoped to, so dropping them would be a broken state.
      const playerIds = Array.from(new Set([selectedPlayer.id, ...formState.playerIds]));

      if (isNew) {
        const payload = {
          playerId: selectedPlayer.id,
          playerIds,
          playerSlug: selectedPlayer.Slug || "",
          // Denormalized so display surfaces (GamePage's "Top Performances"
          // list, sidebars) can show the subject's name without an extra
          // fetch per performance.
          playerName: `${selectedPlayer.First || ""} ${selectedPlayer.Last || ""}`.trim(),
          gameId: selectedGame.id,
          school: selectedPlayer.School || "",
          opponent: opponent || "",
          week: selectedGame.Week || "",
          gameDate,
          slug,
          titleLong: formState.titleLong.trim(),
          titleShort: formState.titleShort.trim(),
          body: formState.body,
          statLine: formState.statLine || "",
          videoId: formState.videoId || "",
          author: formState.author,
          status: formState.status,
          grade: formState.grade || "",
          authorId: user.uid,
          createdAt: serverTimestamp(),
        };
        const newRef = await addDoc(collection(db, "performances"), payload);
        const newPerformance = { id: newRef.id, ...payload };
        setPerformances((prev) => [newPerformance, ...prev]);
        setSelectedPerformance(newPerformance);
        setSaveMessage("Performance created.");
      } else {
        const payload = {
          titleLong: formState.titleLong.trim(),
          titleShort: formState.titleShort.trim(),
          slug,
          playerIds,
          playerName: `${selectedPlayer.First || ""} ${selectedPlayer.Last || ""}`.trim(),
          body: formState.body,
          statLine: formState.statLine || "",
          videoId: formState.videoId || "",
          author: formState.author,
          status: formState.status,
          grade: formState.grade || "",
          updatedAt: serverTimestamp(),
        };
        await updateDoc(doc(db, "performances", selectedPerformance.id), payload);
        setPerformances((prev) => prev.map((p) => (p.id === selectedPerformance.id ? { ...p, ...payload } : p)));
        setSaveMessage("Saved.");
      }
    } catch (e) {
      console.error("Performance save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPerformance || isNew) return;
    if (!window.confirm("Delete this performance? This cannot be undone.")) return;
    setRemoving(true);
    setSaveMessage("");
    try {
      await deleteDoc(doc(db, "performances", selectedPerformance.id));
      setPerformances((prev) => prev.filter((p) => p.id !== selectedPerformance.id));
      setSelectedPerformance(null);
      setFormState(null);
    } catch (e) {
      console.error("Performance delete error:", e);
      setSaveMessage("Failed to delete — check console.");
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading" size={28} minHeight="100px" />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "18px", alignItems: "start" }}>
      {/* ===== Left column: player lookup, then browse-by-week ===== */}
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ background: BLUE, padding: "10px 16px" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Performances
            </div>
          </div>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee" }}>
            <input
              type="text"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder="Search player by name..."
              style={inputStyle}
            />
          </div>

          {selectedPlayer && (
            <div
              onClick={() => { setSelectedPlayer(null); setSchedule([]); setSelectedGame(null); setSelectedPerformance(null); setFormState(null); }}
              style={{ padding: "10px 14px", background: "#eaf1ff", borderBottom: "1px solid #f0f0f0", cursor: "pointer" }}
            >
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Selected — click to change
              </div>
              <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>
                {selectedPlayer.First} {selectedPlayer.Last}
              </div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
                {selectedPlayer.Position || "—"} · {selectedPlayer.School || "—"}
              </div>
            </div>
          )}

          {playerSearch.trim() && (
            <div style={{ maxHeight: "600px", overflowY: "auto" }}>
              {filteredPlayers.length === 0 ? (
                <div style={{ padding: "20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
                  No players match "{playerSearch}".
                </div>
              ) : (
                filteredPlayers.map((p) => {
                  const isSelected = selectedPlayer?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => selectPlayer(p)}
                      style={{
                        padding: "10px 14px", cursor: "pointer",
                        background: isSelected ? "#eaf1ff" : "#fff",
                        borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
                        borderBottom: "1px solid #f0f0f0",
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
                    >
                      <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{p.First} {p.Last}</div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
                        {p.Position || "—"} · {p.School || "—"} · {p.Eligible || "—"}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* ===== Browse by week — every performance for a week, regardless of player ===== */}
        <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ background: BLUE, padding: "10px 16px" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Browse by Week
            </div>
          </div>
          {weekOptions.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
              No performances yet.
            </div>
          ) : (
            <>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee" }}>
                <select value={browseWeek} onChange={(e) => setBrowseWeek(e.target.value)} style={inputStyle}>
                  {weekOptions.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              {jumping ? (
                <LoadingSpinner label="Loading" size={24} minHeight="80px" />
              ) : performancesForBrowseWeek.length === 0 ? (
                <div style={{ padding: "20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
                  No performances for {browseWeek}.
                </div>
              ) : (
                <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                  {performancesForBrowseWeek.map((perf) => {
                    const p = playersById.get(perf.playerId);
                    const status = statusStyles[perf.status] || statusStyles.draft;
                    return (
                      <div
                        key={perf.id}
                        onClick={() => jumpToPerformance(perf)}
                        style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #f0f0f0" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{perf.titleShort || perf.titleLong}</div>
                          <span style={{
                            flexShrink: 0, fontSize: "9px", fontWeight: 900, padding: "2px 7px", borderRadius: "20px",
                            textTransform: "capitalize", background: status.background, color: status.color,
                          }}>
                            {perf.status || "draft"}
                          </span>
                        </div>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
                          {p ? `${p.First} ${p.Last}` : "Unknown player"} · {formatGameDate(perf.gameDate)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ===== Right: games list, then performance form ===== */}
      <div style={{ border: "2px solid " + GOLD, borderRadius: "10px", overflow: "hidden", position: "sticky", top: "20px" }}>
        <div style={{ background: GOLD, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {!selectedPlayer
              ? "Select a Player"
              : !selectedGame
                ? `${selectedPlayer.First} ${selectedPlayer.Last} — ${SEASON_LABEL} Schedule`
                : (isNew ? "New Performance" : selectedPerformance ? "Edit Performance" : `Week ${(selectedGame.Week || "").replace("Week ", "")} vs ${selectedGame.Home === selectedPlayer.School ? selectedGame.Away : selectedGame.Home}`)}
          </div>
          {selectedGame && (
            <button
              onClick={() => selectGame(null)}
              style={{
                marginLeft: "auto", background: "rgba(255,255,255,0.2)", color: "#fff", border: "none",
                borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "11px",
                textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
              }}
            >
              ← Games
            </button>
          )}
        </div>

        {/* Step 1: no player selected yet */}
        {!selectedPlayer && (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Search for a player on the left, then pick one of their {SEASON_LABEL} games to add a performance for.
          </div>
        )}

        {/* Step 2: player selected, choose a game */}
        {selectedPlayer && !selectedGame && (
          scheduleLoading ? (
            <LoadingSpinner label="Loading schedule" size={28} minHeight="140px" />
          ) : schedule.length === 0 ? (
            <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
              No {SEASON_LABEL} schedule found for {selectedPlayer.School || "this player's team"}.
            </div>
          ) : (
            <div style={{ maxHeight: "700px", overflowY: "auto" }}>
              {schedule.map((g) => {
                const isHome = g.Home === selectedPlayer.School;
                const opponent = isHome ? g.Away : g.Home;
                const count = performanceCountByGameId[g.id] || 0;
                const played = g.HomeScore != null && g.AwayScore != null;
                return (
                  <div
                    key={g.id}
                    onClick={() => selectGame(g)}
                    style={{
                      padding: "12px 16px", cursor: "pointer",
                      borderBottom: "1px solid #f0f0f0",
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#fffaf0"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                  >
                    <div>
                      <div style={{ fontSize: "10px", fontWeight: 900, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {(g.Week || "Week —")} · {formatGameDate(g.Date)}
                      </div>
                      <div style={{ fontWeight: 900, fontSize: "14px", color: BLUE }}>
                        {isHome ? "vs" : "at"} {opponent || "TBD"}
                      </div>
                      {played && (
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
                          Final: {g.Home} {g.HomeScore} – {g.AwayScore} {g.Away}
                        </div>
                      )}
                    </div>
                    {count > 0 && (
                      <span style={{
                        flexShrink: 0, fontSize: "10px", fontWeight: 900, padding: "3px 9px", borderRadius: "20px",
                        background: "#e6f4ea", color: "#1a7f37", textTransform: "uppercase", letterSpacing: "0.04em",
                      }}>
                        {count} added
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Step 3: game selected — list existing performances + form */}
        {selectedPlayer && selectedGame && (
          <div style={{ padding: "16px" }}>
            {!selectedPerformance ? (
              <>
                <button
                  onClick={startNewPerformance}
                  style={{
                    width: "100%", background: GOLD, color: "#fff", border: "none",
                    borderRadius: "8px", padding: "12px", fontWeight: 900, fontSize: "13px",
                    textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer", marginBottom: "14px",
                  }}
                >
                  + New Performance
                </button>
                {performancesForGame.length === 0 ? (
                  <div style={{ padding: "16px 4px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
                    No performances added for this game yet.
                  </div>
                ) : (
                  performancesForGame.map((perf) => {
                    const status = statusStyles[perf.status] || statusStyles.draft;
                    const grade = gradeStyles[perf.grade];
                    return (
                      <div
                        key={perf.id}
                        onClick={() => selectPerformance(perf)}
                        style={{
                          padding: "10px 12px", cursor: "pointer", border: "2px solid #eee",
                          borderRadius: "8px", marginBottom: "8px",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = BLUE; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#eee"; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{perf.titleShort || perf.titleLong}</div>
                          <span style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                            {grade && (
                              <span style={{
                                fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "20px",
                                background: grade.background, color: grade.color,
                              }}>
                                {perf.grade}
                              </span>
                            )}
                            <span style={{
                              fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "20px",
                              textTransform: "capitalize", background: status.background, color: status.color,
                            }}>
                              {perf.status || "draft"}
                            </span>
                          </span>
                        </div>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#999", marginTop: "2px" }}>{perf.titleLong}</div>
                      </div>
                    );
                  })
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => { setSelectedPerformance(null); setFormState(null); setSaveMessage(""); }}
                  style={{
                    background: "none", border: "none", color: BLUE, fontWeight: 900, fontSize: "12px",
                    cursor: "pointer", padding: 0, marginBottom: "14px", textTransform: "uppercase", letterSpacing: "0.04em",
                  }}
                >
                  ← Back to performances
                </button>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                  <div>
                    <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Long-form Title</div>
                    <input value={formState.titleLong} onChange={(e) => setFormState((p) => ({ ...p, titleLong: e.target.value }))} style={inputStyle} />
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Short-form Title</div>
                    <input value={formState.titleShort} onChange={(e) => setFormState((p) => ({ ...p, titleShort: e.target.value }))} style={inputStyle} />
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Author</div>
                    <input value={formState.author} onChange={(e) => setFormState((p) => ({ ...p, author: e.target.value }))} style={inputStyle} />
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Status</div>
                    <select value={formState.status} onChange={(e) => setFormState((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Grade</div>
                    <select value={formState.grade} onChange={(e) => setFormState((p) => ({ ...p, grade: e.target.value }))} style={inputStyle}>
                      <option value="">— Select —</option>
                      {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                    Players Mentioned
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: formState.playerIds.length > 0 ? "8px" : 0 }}>
                    {formState.playerIds.map((pid) => {
                      const p = playersById.get(pid);
                      const isPrimary = pid === selectedPlayer.id;
                      return (
                        <span
                          key={pid}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: "6px",
                            background: isPrimary ? "#eaf1ff" : "#f5f5f5", border: `2px solid ${isPrimary ? BLUE : "#ddd"}`,
                            borderRadius: "20px", padding: "3px 6px 3px 10px",
                            fontSize: "12px", fontWeight: 800, color: isPrimary ? BLUE : "#555",
                          }}
                        >
                          {p ? `${p.First} ${p.Last}` : "Unknown"}
                          {isPrimary ? (
                            <span style={{ fontSize: "9px", fontWeight: 900, color: "#999", textTransform: "uppercase" }}>subject</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setFormState((prev) => ({ ...prev, playerIds: prev.playerIds.filter((id) => id !== pid) }))}
                              style={{ background: "none", border: "none", color: "#999", fontWeight: 900, fontSize: "13px", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                  <PlayerAddCombobox
                    excludeIds={formState.playerIds}
                    players={allPlayers}
                    onAdd={(pid) => setFormState((prev) => ({ ...prev, playerIds: [...prev.playerIds, pid] }))}
                  />
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Video</div>
                  <VideoLookupCombobox videoId={formState.videoId} onChange={(id) => setFormState((p) => ({ ...p, videoId: id }))} videos={videos} />
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                    Stat Line
                  </div>
                  <input
                    value={formState.statLine}
                    onChange={(e) => setFormState((p) => ({ ...p, statLine: e.target.value }))}
                    placeholder="e.g. 24/31, 312 YDS, 3 TD"
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Write-up</div>
                  <textarea value={formState.body} onChange={(e) => setFormState((p) => ({ ...p, body: e.target.value }))} style={textareaStyle} />
                </div>

                <div style={{ marginBottom: "14px" }}>
                  <button
                    type="button"
                    onClick={handleGenerateTweet}
                    disabled={tweetLoading || !formState.body.trim()}
                    title={!formState.body.trim() ? "Write the body text first" : ""}
                    style={{
                      width: "100%", background: "#fff", color: BLUE, border: "2px solid " + BLUE,
                      borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "12px",
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      cursor: tweetLoading || !formState.body.trim() ? "default" : "pointer",
                      opacity: tweetLoading || !formState.body.trim() ? 0.5 : 1,
                    }}
                  >
                    {tweetLoading ? "Generating..." : "Generate Tweet"}
                  </button>

                  {tweetError && (
                    <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 800, color: "#c0392b" }}>{tweetError}</div>
                  )}

                  {tweetText && (
                    <div style={{ marginTop: "10px" }}>
                      <textarea
                        readOnly
                        value={tweetText}
                        onFocus={(e) => e.target.select()}
                        style={{ ...textareaStyle, minHeight: "150px", fontWeight: 600 }}
                      />
                      <button
                        type="button"
                        onClick={handleCopyTweet}
                        style={{
                          width: "100%", marginTop: "6px",
                          background: tweetCopied ? "#e6f4ea" : GOLD, color: tweetCopied ? "#1a7f37" : "#fff",
                          border: "none", borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "12px",
                          textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                        }}
                      >
                        {tweetCopied ? "Copied!" : "Copy to Clipboard"}
                      </button>
                    </div>
                  )}
                </div>

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
                  {saving ? "Saving..." : isNew ? "Create Performance" : "Save Changes"}
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
                    {removing ? "Deleting..." : "Delete Performance"}
                  </button>
                )}

                {saveMessage && (
                  <div style={{ marginTop: "10px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: saveMessage.startsWith("Failed") ? "#c0392b" : "#2e7d32" }}>
                    {saveMessage}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
