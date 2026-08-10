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
import { useEffect, useState } from "react";
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

// Slug = short-form title + the published date — same deterministic,
// no-manual-override-needed formula PerformancesManager.js uses (short
// titles alone collide easily across articles). Only spent when the Slug
// field itself is left blank — see handleSave — so a manually-set slug on
// an existing article is never silently overwritten.
const slugFor = (titleShort, publishedAtDate) => {
  const d = publishedAtDate instanceof Date ? publishedAtDate : (publishedAtDate ? new Date(publishedAtDate) : null);
  const dateStr = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  return [createSlug(titleShort || ""), dateStr].filter(Boolean).join("-");
};

const BLANK_FORM = {
  title: "", titleShort: "", slug: "", author: "", publishedAt: "",
  status: "draft", priority: 2, videoUrl: "", seoDescription: "",
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

export default function ArticlesManager() {
  const { user, profile } = useAuth();
  const role = profile?.role || "public";
  const isAdmin = role === "admin";

  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedArticle, setSelectedArticle] = useState(null);
  const [formState, setFormState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [migrating, setMigrating] = useState(false);
  const [migrateMessage, setMigrateMessage] = useState("");

  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showImageInput, setShowImageInput] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [videoUrlInput, setVideoUrlInput] = useState("");

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
        const [articleSnap, playerSnap, teamSnap] = await Promise.all([
          getDocs(articlesQuery),
          getDocs(collection(db, "players")),
          getDocs(collection(db, "schools")),
        ]);

        setArticles(articleSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        setPlayers(playerSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return { id: docSnap.id, slug: d.Slug, name: `${d.First} ${d.Last}`, position: d.Position, team: d.School };
        }));

        setTeams(teamSnap.docs.map((d) => {
          const name = d.data().School;
          return { name, slug: name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-") };
        }));
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
    setShowImageInput(false);
    setShowLinkInput(false);
    setShowVideoInput(false);
  };

  const selectArticle = (a) => {
    setSelectedArticle(a);
    setFormState({
      title: a.title || "",
      titleShort: a.titleShort || "",
      slug: a.slug || "",
      author: a.author || "",
      publishedAt: a.publishedAt?.toDate ? a.publishedAt.toDate().toISOString().split("T")[0] : "",
      status: a.status || "draft",
      priority: a.priority || 2,
      videoUrl: a.videoUrl || "",
      seoDescription: a.seoDescription || "",
    });
    editor?.commands.setContent(a.content || "");
    resetPickers();
    setSaveMessage("");
  };

  const startNewArticle = () => {
    setSelectedArticle({ id: null, isNew: true });
    setFormState({ ...BLANK_FORM });
    editor?.commands.setContent("<p>Start writing your article...</p>");
    resetPickers();
    setSaveMessage("");
  };

  const isNew = selectedArticle?.isNew === true;

  const insertPlayer = (player) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`<a href="/player/${player.slug}" data-player-id="${player.id}">${player.name}</a> `).run();
    setShowPlayerPicker(false);
  };

  const insertTeam = (team) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`<a href="/team/${team.slug}">${team.name}</a> `).run();
    setShowTeamPicker(false);
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

  const insertVideo = () => {
    if (!videoUrlInput.trim()) return;
    const href = /^https?:\/\//i.test(videoUrlInput.trim()) ? videoUrlInput.trim() : `https://${videoUrlInput.trim()}`;
    setFormState((prev) => ({ ...prev, videoUrl: href }));
    setVideoUrlInput("");
    setShowVideoInput(false);
  };

  // Player links are the join key for "related articles" on a player's
  // page. Prefer the data-player-id baked in by insertPlayer; fall back to
  // resolving the href's slug against the loaded players list for links
  // that predate this attribute.
  const extractLinkedIds = (html) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    const slugToPlayerId = new Map(players.map((p) => [p.slug, p.id]));
    const playerIdSet = new Set();
    div.querySelectorAll("a[href^='/player/']").forEach((link) => {
      const pid = link.getAttribute("data-player-id") || slugToPlayerId.get(link.getAttribute("href").split("/player/")[1]);
      if (pid) playerIdSet.add(pid);
    });
    const teamSet = new Set();
    div.querySelectorAll("a[href^='/team/']").forEach((link) => {
      const linkSlug = link.getAttribute("href").split("/team/")[1];
      if (linkSlug) teamSet.add(linkSlug);
    });
    return { playerIds: Array.from(playerIdSet), teamSlugs: Array.from(teamSet) };
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
      const { playerIds, teamSlugs } = extractLinkedIds(html);
      const publishedAtDate = formState.publishedAt
        ? (() => { const [y, m, d] = formState.publishedAt.split("-"); return new Date(+y, +m - 1, +d); })()
        : null;

      // Team-page article association: which school(s) TeamPage.js's own
      // automatic "articles about our players" feed should show this under
      // — replacing the old team-mention-based teamSlugs above, which
      // nothing actually reads anymore. Snapshotted the first time a player
      // is linked, not recomputed from their live current school on every
      // re-save — a player already linked before a transfer keeps whatever
      // school was captured back then, so a later unrelated edit (fixing a
      // typo, say) can't silently move the article to their new team. Only
      // a player newly linked in *this* save contributes their current
      // school.
      const existingPlayerIds = new Set(Array.isArray(selectedArticle?.playerIds) ? selectedArticle.playerIds : []);
      const schoolSet = new Set(Array.isArray(selectedArticle?.schools) ? selectedArticle.schools : []);
      playerIds.filter((id) => !existingPlayerIds.has(id)).forEach((id) => {
        const p = players.find((pl) => pl.id === id);
        if (p?.team) schoolSet.add(p.team);
      });
      const schools = Array.from(schoolSet);

      if (isNew) {
        const payload = {
          title: formState.title,
          titleShort: formState.titleShort.trim(),
          slug: formState.slug.trim() ? formState.slug.trim() : slugFor(formState.titleShort.trim(), publishedAtDate),
          content: html,
          status: formState.status,
          priority: formState.priority,
          author: formState.author,
          publishedAt: publishedAtDate,
          playerIds, teamSlugs, schools,
          videoUrl: formState.videoUrl || "",
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
        const payload = {
          title: formState.title,
          titleShort: formState.titleShort.trim(),
          slug: formState.slug,
          content: html,
          status: formState.status,
          priority: formState.priority,
          author: formState.author,
          publishedAt: publishedAtDate,
          playerIds, teamSlugs, schools,
          videoUrl: formState.videoUrl || "",
          seoDescription: formState.seoDescription.trim(),
          updatedAt: serverTimestamp(),
        };
        await updateDoc(doc(db, "articles", selectedArticle.id), payload);
        setArticles((prev) => prev.map((a) => (a.id === selectedArticle.id ? { ...a, ...payload } : a)));
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
                <div style={{ fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Slug (optional)</div>
                <input value={formState.slug} onChange={(e) => setFormState((p) => ({ ...p, slug: e.target.value }))} placeholder="auto-generated from short title + date" style={inputStyle} />
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
                {formState.videoUrl && (
                  <div style={{ marginBottom: "8px", padding: "6px 10px", background: "#fff", borderRadius: "6px", fontSize: "12px", fontWeight: 700, color: "#b45309", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>Current: {formState.videoUrl}</span>
                    <button onClick={() => setFormState((p) => ({ ...p, videoUrl: "" }))} style={{ background: "#b91c1c", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px", fontWeight: 900 }}>Remove</button>
                  </div>
                )}
                <input placeholder="Video URL (YouTube, Twitter, etc.)" value={videoUrlInput} onChange={(e) => setVideoUrlInput(e.target.value)} style={{ ...inputStyle, marginBottom: "8px" }} />
                <div style={{ fontSize: "11px", color: "#888", marginBottom: "8px" }}>A ▶ Watch Video button appears below the article title — not in the body.</div>
                <button onClick={insertVideo} disabled={!videoUrlInput.trim()} style={{ ...toolbarBtnStyle(false), borderColor: "#b45309", color: "#b45309", opacity: !videoUrlInput.trim() ? 0.5 : 1 }}>
                  {formState.videoUrl ? "Update Video Link" : "Set Video Link"}
                </button>
              </div>
            )}

            <div className="wd-article-editor" style={{ border: "2px solid " + BLUE, borderRadius: "10px", padding: "12px", cursor: "text", background: "#fff" }} onClick={() => editor?.chain().focus().run()}>
              {editor && <EditorContent editor={editor} />}
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
