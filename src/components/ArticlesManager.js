// src/components/ArticlesManager.js
//
// Combined list + create + edit UI for articles — replaces the old
// standalone AdminArticles.js ("/admin/articles") and EditArticle.js
// ("/admin/articles/:id") pages, which duplicated almost this entire file
// between them. Mounted in two places depending on role:
//   - Admins get it as a section inside AdminPanel.js.
//   - Writers (who don't have full admin access) get it inside their own
//     profile page (UserProfile.js) instead.
// The component itself adapts to whichever of those two roles is viewing it
// — admins see every article, writers see only their own — rather than the
// two mount points needing to pass down any scoping props.
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
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
import LoadingSpinner from "./LoadingSpinner";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TiptapLink from "@tiptap/extension-link";
import TiptapImage from "@tiptap/extension-image";
import { TextStyle } from "@tiptap/extension-text-style";
import { Extension } from "@tiptap/core";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace("px", ""),
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}px` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark("textStyle", { fontSize: size }).run(),
    };
  },
});

const createSlug = (text) => text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");

// Same fallback PlayerProfile.js/generate-sitemap.js use for a school with
// no manually-set Slug field: TeamPage.js's own lookup prefers a doc's
// stored Slug and only falls back to this derived form.
const toTeamSlug = (school) => {
  if (!school) return "";
  return school.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
};

// Slug = short-form title + the published date — same deterministic
// formula PerformancesManager.js uses (short titles alone collide easily
// across articles). Fully automatic now — there's no admin-facing Slug
// input to override it with (see the read-only preview in the form below)
// — computed fresh at create time and then left untouched by every later
// edit (handleSave never rewrites slug on an existing article), so a
// published article's URL never silently changes out from under it.
const slugFor = (titleShort, publishedAtDate) => {
  const d = publishedAtDate instanceof Date ? publishedAtDate : (publishedAtDate ? new Date(publishedAtDate) : null);
  const dateStr = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  return [createSlug(titleShort || ""), dateStr].filter(Boolean).join("-");
};

// formState.publishedAt is a plain "YYYY-MM-DD" <input type="date"> value —
// shared by handleSave and the live slug preview so both build the exact
// same Date (and therefore the exact same slug) from it.
const parsePublishedAt = (dateStr) => {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-");
  return new Date(+y, +m - 1, +d);
};

// "Away vs Home (M/D/YYYY)" — same UTC-anchored numeric date format
// PlayerProfile.js's Game Notes picker already uses, so a game reads
// identically wherever it's tagged.
const gameLabel = (g) => `${g.away} vs ${g.home}${g.dateMs ? ` (${new Date(g.dateMs).toLocaleDateString("en-US", { timeZone: "UTC" })})` : ""}`;

const BLANK_FORM = {
  title: "", titleShort: "", author: "", publishedAt: "",
  status: "draft", priority: 2, videoId: "", seoDescription: "",
};

const inputStyle = {
  width: "100%", border: "2px solid #ddd", borderRadius: "6px",
  padding: "8px 10px", fontWeight: 700, fontSize: "13px",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};

const toolbarBtnStyle = (active) => ({
  background: active ? GOLD : "#fff", color: active ? "#fff" : BLUE,
  border: "2px solid " + BLUE, borderRadius: "6px", padding: "6px 11px",
  fontWeight: 900, fontSize: "12px", cursor: "pointer",
});

const statusStyles = {
  published: { background: "#e6f4ea", color: "#1a7f37" },
  pending: { background: "#fff4e5", color: "#b35c00" },
  draft: { background: "#f0f0f0", color: "#666" },
};

// Same search-input + dropdown-of-matches pattern as
// PerformancesManager.js's own VideoLookupCombobox — picks an existing
// video doc (from the "videos" collection, the same one PerformancesManager
// draws from) instead of a hand-pasted URL, so tagging a video here works
// identically to tagging one on a performance.
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

// ── One of the three "Tagged X" lists at the bottom of the article form
// (Players/Teams/Games) — order here is what NewsArticle.jsx's Mentioned
// blocks render in, and this list, not whatever links happen to be in the
// body, is what actually becomes playerIds/schools/gameIds on save (see
// ArticlesManager's handleSave). `items`/`options` are pre-normalized to
// {key, label, sub?, raw?} so this component stays generic across all
// three entity types. ──
function TaggedList({ title, items, onRemove, onMove, search, onSearchChange, show, onToggleShow, options, onAdd, placeholder }) {
  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "8px", overflow: "hidden" }}>
      <div style={{ background: "#f8faff", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #eee" }}>
        <div style={{ fontSize: "11px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {title} ({items.length})
        </div>
        <button
          type="button"
          onClick={onToggleShow}
          style={{ background: "none", border: "none", color: BLUE, fontWeight: 900, fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}
        >
          {show ? "Cancel" : "+ Add"}
        </button>
      </div>

      {show && (
        <div style={{ padding: "10px", borderBottom: "1px solid #eee", background: "#fdfdfd" }}>
          <input
            placeholder={placeholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ ...inputStyle, marginBottom: "8px" }}
          />
          <div style={{ maxHeight: "160px", overflowY: "auto" }}>
            {options.map((o) => (
              <div
                key={o.key}
                onClick={() => onAdd(o)}
                style={{ padding: "6px 4px", borderBottom: "1px solid #eee", cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "#333" }}
              >
                {o.label}
              </div>
            ))}
            {options.length === 0 && (
              <div style={{ padding: "6px 4px", fontSize: "12px", color: "#999" }}>No matches.</div>
            )}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ padding: "12px", fontSize: "12px", color: "#999", fontStyle: "italic" }}>None tagged yet.</div>
      ) : (
        items.map((it, i) => (
          <div key={it.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderBottom: i < items.length - 1 ? "1px solid #f0f0f0" : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <button
                type="button" disabled={i === 0} onClick={() => onMove(i, -1)}
                style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#ddd" : BLUE, fontSize: "10px", lineHeight: 1, padding: 0 }}
              >
                ▲
              </button>
              <button
                type="button" disabled={i === items.length - 1} onClick={() => onMove(i, 1)}
                style={{ background: "none", border: "none", cursor: i === items.length - 1 ? "default" : "pointer", color: i === items.length - 1 ? "#ddd" : BLUE, fontSize: "10px", lineHeight: 1, padding: 0 }}
              >
                ▼
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 800, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</div>
              {it.sub && <div style={{ fontSize: "11px", color: "#999" }}>{it.sub}</div>}
            </div>
            <button
              type="button"
              onClick={() => onRemove(it.key)}
              title="Remove tag — doesn't touch any link in the body"
              style={{ background: "none", border: "none", color: "#c0392b", fontWeight: 900, fontSize: "16px", cursor: "pointer", padding: "0 4px" }}
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export default function ArticlesManager() {
  const { user, profile } = useAuth();
  const role = profile?.role || "public";
  const isAdmin = role === "admin";

  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [videos, setVideos] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedArticle, setSelectedArticle] = useState(null);
  const [formState, setFormState] = useState(null);
  // Staged replacement slug for an *existing* article — only set when the
  // admin explicitly clicks "Regenerate" below (never automatically), and
  // only actually written on the next Save. null means "leave the stored
  // slug alone", same as before Regenerate existed.
  const [regeneratedSlug, setRegeneratedSlug] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [migrating, setMigrating] = useState(false);
  const [migrateMessage, setMigrateMessage] = useState("");

  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showGamePicker, setShowGamePicker] = useState(false);
  const [showImageInput, setShowImageInput] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [gameSearch, setGameSearch] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  // ── Tagged Players/Teams/Games — the actual source of playerIds/schools/
  // gameIds on save (see handleSave), kept as ordered state independent of
  // whatever links happen to be in the body. insertPlayer/insertTeam/
  // insertGame below auto-add here too, so by default everything still
  // behaves like before (link it, it shows up) — but a tag can be removed
  // here without touching its link, or added here with no link at all.
  // Each holds the same shape as its source list (players/teams/games
  // state above) so a tagged entry can be rendered without a second lookup. ──
  const [taggedPlayers, setTaggedPlayers] = useState([]);
  const [taggedTeams, setTaggedTeams] = useState([]);
  const [taggedGames, setTaggedGames] = useState([]);
  const [showTagPlayerAdd, setShowTagPlayerAdd] = useState(false);
  const [showTagTeamAdd, setShowTagTeamAdd] = useState(false);
  const [showTagGameAdd, setShowTagGameAdd] = useState(false);
  const [tagPlayerSearch, setTagPlayerSearch] = useState("");
  const [tagTeamSearch, setTagTeamSearch] = useState("");
  const [tagGameSearch, setTagGameSearch] = useState("");

  const editor = useEditor({
    extensions: [StarterKit, Underline, TiptapLink.configure({ openOnClick: false }), TiptapImage, TextStyle, FontSize],
    content: "<p>Start writing your article...</p>",
    // Tiptap v3 changed useEditor's default to NOT re-render the component
    // on every transaction (a v2→v3 perf change) — without this, moving the
    // cursor into already-bold/italic/underlined text or just selecting a
    // range never re-evaluates editor.isActive(...) below, so the B/I/U
    // toolbar buttons stay stuck showing whatever was active last time
    // something else happened to re-render this component.
    shouldRerenderOnTransaction: true,
  });

  // Injected once, globally — the ProseMirror editor content isn't inside
  // this component's own DOM subtree in a way inline styles can reach.
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      /* AdminPanel.js's outer wrapper sets the whole admin UI's font to
         Arial Black — a genuinely heavy face, not just "Arial + bold" — and
         .wd-article-editor never overrode it, so every character in here
         (including plain body text) rendered at that same black weight
         regardless of whether an actual Bold mark was applied. Explicit
         normal-weight Arial/Helvetica here fixes that; the Bold toolbar
         button's own font-weight:bold below still reads as bold relative
         to this normal baseline. */
      .wd-article-editor .ProseMirror { min-height: 300px; width: 100%; cursor: text; outline: none; font-size: 16px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif; font-weight: 400; }
      .wd-article-editor .ProseMirror p { margin: 0; }
      .wd-article-editor .ProseMirror strong, .wd-article-editor .ProseMirror b { font-weight: 700; }
      .wd-article-editor .ProseMirror img { max-width: 100%; border-radius: 10px; margin: 10px 0; }
      .wd-article-editor .ProseMirror a { color: ${GOLD}; font-weight: bold; text-decoration: underline; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const articlesQuery = isAdmin
          ? collection(db, "articles")
          : query(collection(db, "articles"), where("authorId", "==", user.uid));
        const [articleSnap, playerSnap, teamSnap, gameSnap, videoSnap] = await Promise.all([
          getDocs(articlesQuery),
          getDocs(collection(db, "players")),
          getDocs(collection(db, "schools")),
          getDocs(collection(db, "schedule26")),
          getDocs(collection(db, "videos")),
        ]);

        setArticles(articleSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        setPlayers(playerSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return { id: docSnap.id, slug: d.Slug, name: `${d.First} ${d.Last}`, position: d.Position, team: d.School };
        }));

        setTeams(teamSnap.docs.map((d) => {
          const data = d.data();
          const name = data.School;
          return { name, slug: data.Slug || toTeamSlug(name) };
        }));

        // Most recent first — a game just played (or about to be) is far
        // more likely to be what an article being written right now is
        // tagging than one from months ago.
        setGames(gameSnap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            const dateMs = d.Date?.toDate ? d.Date.toDate().getTime() : (d.Date ? new Date(d.Date).getTime() : 0);
            return { id: docSnap.id, slug: d.Slug, away: d.Away, home: d.Home, dateMs };
          })
          .filter((g) => g.slug && g.away && g.home)
          .sort((a, b) => b.dateMs - a.dateMs));

        setVideos(videoSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Articles fetch error:", e);
        setArticles([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user, isAdmin]);

  const resetPickers = () => {
    setShowPlayerPicker(false);
    setShowTeamPicker(false);
    setShowGamePicker(false);
    setShowImageInput(false);
    setShowLinkInput(false);
    setShowVideoInput(false);
    setShowTagPlayerAdd(false);
    setShowTagTeamAdd(false);
    setShowTagGameAdd(false);
  };

  const selectArticle = (a) => {
    setSelectedArticle(a);
    setFormState({
      title: a.title || "",
      titleShort: a.titleShort || "",
      author: a.author || "",
      publishedAt: a.publishedAt?.toDate ? a.publishedAt.toDate().toISOString().split("T")[0] : "",
      status: a.status || "draft",
      priority: a.priority || 2,
      videoId: a.videoId || "",
      seoDescription: a.seoDescription || "",
    });
    editor?.commands.setContent(a.content || "");
    resetPickers();
    setSaveMessage("");
    setRegeneratedSlug(null);

    // Seed the tag lists from the article's own saved arrays — not by
    // re-parsing the body's links — so order and any past removals (a tag
    // taken out here even though its link is still in the body) come back
    // exactly as last saved. An id/name with no match in the currently-
    // loaded players/teams/games (a deleted player, say) is dropped rather
    // than kept as a dead reference.
    const playerById = new Map(players.map((p) => [p.id, p]));
    setTaggedPlayers((a.playerIds || []).map((id) => playerById.get(id)).filter(Boolean));
    const teamByName = new Map(teams.map((t) => [t.name, t]));
    setTaggedTeams((a.schools || []).map((name) => teamByName.get(name)).filter(Boolean));
    const gameById = new Map(games.map((g) => [g.id, g]));
    setTaggedGames((a.gameIds || []).map((id) => gameById.get(id)).filter(Boolean));
  };

  const startNewArticle = () => {
    setSelectedArticle({ id: null, isNew: true });
    setFormState({ ...BLANK_FORM });
    editor?.commands.setContent("<p>Start writing your article...</p>");
    resetPickers();
    setSaveMessage("");
    setRegeneratedSlug(null);
    setTaggedPlayers([]);
    setTaggedTeams([]);
    setTaggedGames([]);
  };

  const isNew = selectedArticle?.isNew === true;

  const previewSlug = useMemo(() => {
    if (!formState) return "";
    return slugFor(formState.titleShort.trim(), parsePublishedAt(formState.publishedAt));
  }, [formState]);

  const addTaggedTeam = (team) => {
    setTaggedTeams((prev) => (prev.some((t) => t.slug === team.slug) ? prev : [...prev, team]));
  };
  const addTaggedGame = (game) => {
    setTaggedGames((prev) => (prev.some((g) => g.id === game.id) ? prev : [...prev, game]));
  };
  // Tagging a player also tags their current team by default (mirrors the
  // old auto-school-association this replaces) — it's still just an
  // ordinary, removable Teams tag afterward, not a permanent snapshot.
  const addTaggedPlayer = (player) => {
    setTaggedPlayers((prev) => (prev.some((p) => p.id === player.id) ? prev : [...prev, player]));
    const team = teams.find((t) => t.name === player.team);
    if (team) addTaggedTeam(team);
  };
  const removeTaggedPlayer = (id) => setTaggedPlayers((prev) => prev.filter((p) => p.id !== id));
  const removeTaggedTeam = (slug) => setTaggedTeams((prev) => prev.filter((t) => t.slug !== slug));
  const removeTaggedGame = (id) => setTaggedGames((prev) => prev.filter((g) => g.id !== id));
  // Swaps an item with its neighbor — shared by all three lists' ▲▼
  // buttons below. This order is what NewsArticle.jsx's Mentioned blocks
  // render in, so it's the writer's one control over sidebar order.
  const moveTagged = (setList, index, dir) => {
    setList((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const insertPlayer = (player) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`<a href="/player/${player.slug}" data-player-id="${player.id}">${player.name}</a> `).run();
    addTaggedPlayer(player);
    setShowPlayerPicker(false);
  };

  const insertTeam = (team) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`<a href="/team/${team.slug}">${team.name}</a> `).run();
    addTaggedTeam(team);
    setShowTeamPicker(false);
  };

  const insertGame = (game) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`<a href="/game/${game.slug}" data-game-id="${game.id}">${gameLabel(game)}</a> `).run();
    addTaggedGame(game);
    setShowGamePicker(false);
  };

  const insertImage = () => {
    if (!editor || !imageUrl) return;
    editor.chain().focus().setImage({ src: imageUrl }).run();
    setImageUrl("");
    setShowImageInput(false);
  };

  const insertLink = () => {
    if (!editor || !linkText.trim() || !linkUrl.trim()) return;
    const href = /^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`;
    editor.chain().focus().insertContent(`<a href="${href}">${linkText.trim()}</a> `).run();
    setLinkText("");
    setLinkUrl("");
    setShowLinkInput(false);
  };

  const handleSave = async () => {
    if (!formState) return;
    const html = editor?.getHTML() || "";
    if (!formState.title.trim() || !formState.titleShort.trim() || !html.trim()) {
      setSaveMessage("Failed: Title, short-form title, and content are required.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      // playerIds/schools/gameIds now come straight from the Tagged
      // Players/Teams/Games lists below (in whatever order the writer put
      // them in) — not from re-parsing the body's links. A link inserted
      // via +Player/+Team/+Game auto-adds to its list (see insertPlayer/
      // insertTeam/insertGame above), but from here on the list, not the
      // link, is what actually drives playerIds/schools/gameIds+the
      // article's own Mentioned sidebar order.
      const playerIds = taggedPlayers.map((p) => p.id);
      const teamSlugs = taggedTeams.map((t) => t.slug);
      const schools = taggedTeams.map((t) => t.name);
      const gameIds = taggedGames.map((g) => g.id);
      const publishedAtDate = parsePublishedAt(formState.publishedAt);

      if (isNew) {
        const payload = {
          title: formState.title,
          titleShort: formState.titleShort.trim(),
          slug: slugFor(formState.titleShort.trim(), publishedAtDate),
          content: html,
          status: formState.status,
          priority: formState.priority,
          author: formState.author,
          publishedAt: publishedAtDate,
          playerIds, teamSlugs, schools, gameIds,
          videoId: formState.videoId || "",
          seoDescription: formState.seoDescription.trim(),
          authorId: user.uid,
          createdAt: serverTimestamp(),
        };
        const newRef = await addDoc(collection(db, "articles"), payload);
        const newArticle = { id: newRef.id, ...payload };
        setArticles((prev) => [newArticle, ...prev]);
        setSelectedArticle(newArticle);
        setSaveMessage("Article created.");
      } else {
        // slug intentionally omitted unless the admin explicitly staged a
        // replacement via the "Regenerate" button — see the comment above
        // slugFor(). Otherwise it's never rewritten by an edit, so a
        // published article's URL stays stable even if the title or date
        // changes later.
        const payload = {
          title: formState.title,
          titleShort: formState.titleShort.trim(),
          content: html,
          status: formState.status,
          priority: formState.priority,
          author: formState.author,
          publishedAt: publishedAtDate,
          playerIds, teamSlugs, schools, gameIds,
          videoId: formState.videoId || "",
          seoDescription: formState.seoDescription.trim(),
          updatedAt: serverTimestamp(),
        };
        if (regeneratedSlug) payload.slug = regeneratedSlug;
        await updateDoc(doc(db, "articles", selectedArticle.id), payload);
        setArticles((prev) => prev.map((a) => (a.id === selectedArticle.id ? { ...a, ...payload } : a)));
        setSelectedArticle((prev) => ({ ...prev, ...payload }));
        setRegeneratedSlug(null);
        setSaveMessage("Saved.");
      }
    } catch (e) {
      console.error("Article save error:", e);
      setSaveMessage("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedArticle || isNew) return;
    if (!window.confirm("Delete this article? This cannot be undone.")) return;
    setRemoving(true);
    setSaveMessage("");
    try {
      await deleteDoc(doc(db, "articles", selectedArticle.id));
      setArticles((prev) => prev.filter((a) => a.id !== selectedArticle.id));
      setSelectedArticle(null);
      setFormState(null);
      setSaveMessage("");
    } catch (e) {
      console.error("Article delete error:", e);
      setSaveMessage("Failed to delete — check console.");
    } finally {
      setRemoving(false);
    }
  };

  // One-time migration for articles saved before the playerId schema —
  // resolves each legacy doc's `slugs[]` against the currently-loaded
  // player list and writes `playerIds`. Additive only.
  const migrateLegacyArticles = async () => {
    setMigrating(true);
    setMigrateMessage("");
    const slugToId = new Map(players.map((p) => [p.slug, p.id]));
    const unresolved = new Set();
    let migratedCount = 0;
    try {
      const legacy = articles.filter((a) => !Array.isArray(a.playerIds) && Array.isArray(a.slugs) && a.slugs.length > 0);
      for (const a of legacy) {
        const ids = a.slugs.map((s) => {
          const id = slugToId.get(s);
          if (!id) unresolved.add(s);
          return id;
        }).filter(Boolean);
        if (ids.length === 0) continue;
        await updateDoc(doc(db, "articles", a.id), { playerIds: ids });
        migratedCount++;
      }
      setArticles((prev) => prev.map((a) => {
        const match = legacy.find((la) => la.id === a.id);
        if (!match) return a;
        const ids = match.slugs.map((s) => slugToId.get(s)).filter(Boolean);
        return ids.length > 0 ? { ...a, playerIds: ids } : a;
      }));
      setMigrateMessage(
        migratedCount + " article" + (migratedCount !== 1 ? "s" : "") + " migrated to player IDs." +
        (unresolved.size > 0 ? " Unresolved slugs: " + Array.from(unresolved).join(", ") : "")
      );
    } catch (e) {
      console.error("Article migration error:", e);
      setMigrateMessage("Migration failed — check console.");
    } finally {
      setMigrating(false);
    }
  };

  const filteredArticles = articles
    .filter((a) => !searchQuery.trim() || (a.title || "").toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });

  const filteredPlayers = players.filter((p) => p.name.toLowerCase().includes(playerSearch.toLowerCase()));
  const filteredTeams = teams.filter((t) => t.name.toLowerCase().includes(teamSearch.toLowerCase()));
  const filteredGames = games.filter((g) => `${g.away} ${g.home}`.toLowerCase().includes(gameSearch.toLowerCase()));

  // Options for the Tagged Players/Teams/Games "+ Add" pickers below —
  // same search-filter shape as the toolbar pickers above, but also
  // excluding whatever's already tagged so a match can't be added twice.
  const tagPlayerOptions = players
    .filter((p) => !taggedPlayers.some((tp) => tp.id === p.id) && p.name.toLowerCase().includes(tagPlayerSearch.toLowerCase()))
    .map((p) => ({ key: p.id, label: `${p.name} · ${p.position} · ${p.team}`, raw: p }));
  const tagTeamOptions = teams
    .filter((t) => !taggedTeams.some((tt) => tt.slug === t.slug) && t.name.toLowerCase().includes(tagTeamSearch.toLowerCase()))
    .map((t) => ({ key: t.slug, label: t.name, raw: t }));
  const tagGameOptions = games
    .filter((g) => !taggedGames.some((tg) => tg.id === g.id) && `${g.away} ${g.home}`.toLowerCase().includes(tagGameSearch.toLowerCase()))
    .map((g) => ({ key: g.id, label: gameLabel(g), raw: g }));

  const taggedPlayerItems = taggedPlayers.map((p) => ({ key: p.id, label: p.name, sub: [p.position, p.team].filter(Boolean).join(" · ") }));
  const taggedTeamItems = taggedTeams.map((t) => ({ key: t.slug, label: t.name }));
  const taggedGameItems = taggedGames.map((g) => ({ key: g.id, label: gameLabel(g) }));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Articles
          </div>
          <button
            onClick={startNewArticle}
            style={{
              marginLeft: "auto", background: GOLD, color: "#fff", border: "none",
              borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "12px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
            }}
          >
            + New
          </button>
        </div>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee", display: "flex", flexDirection: "column", gap: "8px" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title..."
            style={{ ...inputStyle }}
          />
          <button
            onClick={migrateLegacyArticles}
            disabled={migrating}
            title="Backfill playerIds on articles still using the old slug-only schema"
            style={{
              background: "#fff", color: BLUE, border: "2px solid " + BLUE,
              borderRadius: "6px", padding: "6px 10px", fontWeight: 900, fontSize: "11px",
              textTransform: "uppercase", letterSpacing: "0.04em", cursor: migrating ? "default" : "pointer",
              opacity: migrating ? 0.6 : 1,
            }}
          >
            {migrating ? "Migrating..." : "Migrate Legacy Articles"}
          </button>
          {migrateMessage && (
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#555" }}>{migrateMessage}</div>
          )}
        </div>

        {loading ? (
          <LoadingSpinner label="Loading" size={28} minHeight="100px" />
        ) : filteredArticles.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No articles yet.</div>
        ) : (
          <div style={{ maxHeight: "700px", overflowY: "auto" }}>
            {filteredArticles.map((a) => {
              const isSelected = selectedArticle?.id === a.id;
              const status = statusStyles[a.status] || statusStyles.draft;
              const date = a.createdAt?.toDate ? a.createdAt.toDate() : null;
              return (
                <div
                  key={a.id}
                  onClick={() => selectArticle(a)}
                  style={{
                    padding: "10px 14px", cursor: "pointer",
                    background: isSelected ? "#eaf1ff" : "#fff",
                    borderLeft: isSelected ? "4px solid " + BLUE : "4px solid transparent",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f7f9fc"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{ fontWeight: 900, fontSize: "13px", color: BLUE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#999" }}>
                      {date ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"}
                    </span>
                    <span style={{
                      fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "20px",
                      textTransform: "capitalize", background: status.background, color: status.color,
                    }}>
                      {a.status || "draft"}
                    </span>
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
            {isNew ? "New Article" : selectedArticle ? "Edit Article" : "Select an Article"}
          </div>
        </div>

        {!selectedArticle || !formState ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>
            Click an article from the list to edit it, or "+ New" to create one.
          </div>
        ) : (
          <div style={{ padding: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Title</div>
                <input value={formState.title} onChange={(e) => setFormState((p) => ({ ...p, title: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Short-form Title</div>
                <input value={formState.titleShort} onChange={(e) => setFormState((p) => ({ ...p, titleShort: e.target.value }))} placeholder="used in the slug, e.g. with the date" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                  {isNew ? "Slug (auto-generated preview)" : "Slug"}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <div style={{
                    flex: 1, border: "2px solid #eee", borderRadius: "6px",
                    padding: "8px 10px", fontWeight: 700, fontSize: "13px",
                    background: "#fafafa", color: "#666", boxSizing: "border-box",
                    wordBreak: "break-all",
                  }}>
                    {isNew ? (previewSlug || "—") : (regeneratedSlug || selectedArticle?.slug || "—")}
                  </div>
                  {/* New articles already live-preview from the current
                      title/date on every keystroke, so there's nothing to
                      regenerate — this only matters once a slug exists and
                      is otherwise frozen (see the comment above slugFor()). */}
                  {!isNew && (
                    <button
                      type="button"
                      onClick={() => setRegeneratedSlug(slugFor(formState.titleShort.trim(), parsePublishedAt(formState.publishedAt)))}
                      title="Recompute the slug from the current short title + date"
                      style={{
                        flexShrink: 0, background: "#fff", color: BLUE, border: "2px solid " + BLUE,
                        borderRadius: "6px", padding: "0 12px", fontWeight: 900, fontSize: "12px",
                        textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                      }}
                    >
                      ↻ Regenerate
                    </button>
                  )}
                </div>
                {!isNew && regeneratedSlug && regeneratedSlug !== selectedArticle?.slug && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: 700, color: "#8a6300", marginTop: "5px" }}>
                    ⚠ Will replace the current slug on next Save — existing links/bookmarks to the old one break.
                    <button
                      type="button"
                      onClick={() => setRegeneratedSlug(null)}
                      style={{ background: "none", border: "none", color: "#8a6300", cursor: "pointer", fontWeight: 900, textDecoration: "underline", fontSize: "11px" }}
                    >
                      Undo
                    </button>
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Author</div>
                <input value={formState.author} onChange={(e) => setFormState((p) => ({ ...p, author: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Published Date</div>
                <input type="date" value={formState.publishedAt} onChange={(e) => setFormState((p) => ({ ...p, publishedAt: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Status</div>
                <select value={formState.status} onChange={(e) => setFormState((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>
                  <option value="draft">Draft</option>
                  <option value="pending">Pending</option>
                  <option value="published">Published</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Priority</div>
                <select value={formState.priority} onChange={(e) => setFormState((p) => ({ ...p, priority: Number(e.target.value) }))} style={inputStyle}>
                  <option value={1}>Priority 1</option>
                  <option value={2}>Priority 2</option>
                  <option value={3}>Priority 3</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>SEO Description</div>
              <textarea
                value={formState.seoDescription}
                onChange={(e) => setFormState((p) => ({ ...p, seoDescription: e.target.value }))}
                placeholder="A sentence or two for search engines — the meta description leads with the published date and mentioned players, then this."
                rows={2}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
              <button style={toolbarBtnStyle(editor?.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
              <button style={toolbarBtnStyle(editor?.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
              <button style={toolbarBtnStyle(editor?.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()}>U</button>
              <button
                style={toolbarBtnStyle(false)}
                onClick={() => {
                  const current = editor.getAttributes("textStyle").fontSize || 18;
                  editor.chain().focus().setFontSize(Math.max(12, Number(current) - 2)).run();
                }}
              >A-</button>
              <button
                style={toolbarBtnStyle(false)}
                onClick={() => {
                  const current = editor.getAttributes("textStyle").fontSize || 18;
                  editor.chain().focus().setFontSize(Math.min(36, Number(current) + 2)).run();
                }}
              >A+</button>
              <button style={toolbarBtnStyle(showPlayerPicker)} onClick={() => { const v = !showPlayerPicker; resetPickers(); setShowPlayerPicker(v); }}>+ Player</button>
              <button style={toolbarBtnStyle(showTeamPicker)} onClick={() => { const v = !showTeamPicker; resetPickers(); setShowTeamPicker(v); }}>+ Team</button>
              <button style={toolbarBtnStyle(showGamePicker)} onClick={() => { const v = !showGamePicker; resetPickers(); setShowGamePicker(v); }}>+ Game</button>
              <button style={toolbarBtnStyle(showImageInput)} onClick={() => { const v = !showImageInput; resetPickers(); setShowImageInput(v); }}>+ Image</button>
              <button style={toolbarBtnStyle(showLinkInput)} onClick={() => { const v = !showLinkInput; resetPickers(); setShowLinkInput(v); }}>+ Link</button>
              <button style={{ ...toolbarBtnStyle(showVideoInput), borderColor: "#b45309", color: showVideoInput ? "#fff" : "#b45309", background: showVideoInput ? "#b45309" : "#fff" }} onClick={() => { const v = !showVideoInput; resetPickers(); setShowVideoInput(v); }}>▶ Video</button>
            </div>

            {showPlayerPicker && (
              <div style={{ border: "2px solid " + BLUE, borderRadius: "8px", padding: "10px", marginBottom: "8px", maxHeight: "200px", overflowY: "auto", background: "#f8faff" }}>
                <input placeholder="Search player..." value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} style={{ ...inputStyle, marginBottom: "8px" }} />
                {filteredPlayers.map((p) => (
                  <div key={p.id} onClick={() => insertPlayer(p)} style={{ padding: "6px 4px", borderBottom: "1px solid #eee", cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "#333" }}>
                    {p.name} · {p.position} · {p.team}
                  </div>
                ))}
              </div>
            )}
            {showTeamPicker && (
              <div style={{ border: "2px solid " + BLUE, borderRadius: "8px", padding: "10px", marginBottom: "8px", maxHeight: "200px", overflowY: "auto", background: "#f8faff" }}>
                <input placeholder="Search team..." value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} style={{ ...inputStyle, marginBottom: "8px" }} />
                {filteredTeams.map((t, i) => (
                  <div key={i} onClick={() => insertTeam(t)} style={{ padding: "6px 4px", borderBottom: "1px solid #eee", cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "#333" }}>
                    {t.name}
                  </div>
                ))}
              </div>
            )}
            {showGamePicker && (
              <div style={{ border: "2px solid " + BLUE, borderRadius: "8px", padding: "10px", marginBottom: "8px", maxHeight: "200px", overflowY: "auto", background: "#f8faff" }}>
                <input placeholder="Search game (either team)..." value={gameSearch} onChange={(e) => setGameSearch(e.target.value)} style={{ ...inputStyle, marginBottom: "8px" }} />
                {filteredGames.map((g) => (
                  <div key={g.id} onClick={() => insertGame(g)} style={{ padding: "6px 4px", borderBottom: "1px solid #eee", cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "#333" }}>
                    {gameLabel(g)}
                  </div>
                ))}
                {filteredGames.length === 0 && (
                  <div style={{ padding: "6px 4px", fontSize: "12px", color: "#999" }}>No games match.</div>
                )}
              </div>
            )}
            {showImageInput && (
              <div style={{ border: "2px solid " + BLUE, borderRadius: "8px", padding: "10px", marginBottom: "8px", background: "#f8faff" }}>
                <input placeholder="Paste image URL..." value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={{ ...inputStyle, marginBottom: "8px" }} />
                <button onClick={insertImage} style={toolbarBtnStyle(false)}>Insert Image</button>
              </div>
            )}
            {showLinkInput && (
              <div style={{ border: "2px solid " + BLUE, borderRadius: "8px", padding: "10px", marginBottom: "8px", background: "#f8faff" }}>
                <input placeholder="Display text" value={linkText} onChange={(e) => setLinkText(e.target.value)} style={{ ...inputStyle, marginBottom: "8px" }} />
                <input placeholder="URL (e.g. https://example.com)" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} style={{ ...inputStyle, marginBottom: "8px" }} />
                <button onClick={insertLink} disabled={!linkText.trim() || !linkUrl.trim()} style={{ ...toolbarBtnStyle(false), opacity: !linkText.trim() || !linkUrl.trim() ? 0.5 : 1 }}>Insert Link</button>
              </div>
            )}
            {showVideoInput && (
              <div style={{ border: "2px solid #b45309", borderRadius: "8px", padding: "10px", marginBottom: "8px", background: "#fff8f0" }}>
                <VideoLookupCombobox videoId={formState.videoId} onChange={(id) => setFormState((p) => ({ ...p, videoId: id }))} videos={videos} />
                <div style={{ fontSize: "11px", color: "#888", marginTop: "8px" }}>Shows up on the side of the article, above Players Mentioned — not in the body.</div>
              </div>
            )}

            <div className="wd-article-editor" style={{ border: "2px solid " + BLUE, borderRadius: "10px", padding: "12px", cursor: "text", background: "#fff" }} onClick={() => editor?.chain().focus().run()}>
              {editor && <EditorContent editor={editor} />}
            </div>

            <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "2px solid #eee" }}>
              <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
                Tagged Players / Teams / Games
              </div>
              <div style={{ fontSize: "11px", color: "#999", marginBottom: "10px", lineHeight: 1.5 }}>
                Controls what shows up on this article's own sidebar and on each tagged player/team/game's page — separate
                from the +Player/+Team/+Game links above. Linking one auto-adds it here; remove it here without touching
                the link, or add one here with no link at all. The order here is the order they'll show up in.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <TaggedList
                  title="Players" items={taggedPlayerItems} onRemove={removeTaggedPlayer}
                  onMove={(i, dir) => moveTagged(setTaggedPlayers, i, dir)}
                  search={tagPlayerSearch} onSearchChange={setTagPlayerSearch}
                  show={showTagPlayerAdd} onToggleShow={() => setShowTagPlayerAdd((v) => !v)}
                  options={tagPlayerOptions}
                  onAdd={(o) => { addTaggedPlayer(o.raw); setTagPlayerSearch(""); setShowTagPlayerAdd(false); }}
                  placeholder="Search player..."
                />
                <TaggedList
                  title="Teams" items={taggedTeamItems} onRemove={removeTaggedTeam}
                  onMove={(i, dir) => moveTagged(setTaggedTeams, i, dir)}
                  search={tagTeamSearch} onSearchChange={setTagTeamSearch}
                  show={showTagTeamAdd} onToggleShow={() => setShowTagTeamAdd((v) => !v)}
                  options={tagTeamOptions}
                  onAdd={(o) => { addTaggedTeam(o.raw); setTagTeamSearch(""); setShowTagTeamAdd(false); }}
                  placeholder="Search team..."
                />
                <TaggedList
                  title="Games" items={taggedGameItems} onRemove={removeTaggedGame}
                  onMove={(i, dir) => moveTagged(setTaggedGames, i, dir)}
                  search={tagGameSearch} onSearchChange={setTagGameSearch}
                  show={showTagGameAdd} onToggleShow={() => setShowTagGameAdd((v) => !v)}
                  options={tagGameOptions}
                  onAdd={(o) => { addTaggedGame(o.raw); setTagGameSearch(""); setShowTagGameAdd(false); }}
                  placeholder="Search game..."
                />
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%", marginTop: "14px",
                background: BLUE, color: "#fff", border: "2px solid " + GOLD,
                borderRadius: "8px", padding: "12px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : isNew ? "Create Article" : "Save Changes"}
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
                {removing ? "Deleting..." : "Delete Article"}
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
  );
}
