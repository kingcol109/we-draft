import { useEffect, useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  doc as firestoreDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { TextStyle } from "@tiptap/extension-text-style";
import { Extension } from "@tiptap/core";

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
      setFontSize: (size) => ({ chain }) =>
        chain().setMark("textStyle", { fontSize: size }).run(),
    };
  },
});

export default function AdminArticles() {
  const { user } = useAuth();

  const [role, setRole] = useState(null);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");

  const [status, setStatus] = useState("draft");
  const [priority, setPriority] = useState(2);
  const [slug, setSlug] = useState("");
  const [author, setAuthor] = useState("");
  const [publishedAt, setPublishedAt] = useState("");

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);

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
  const [videoUrl, setVideoUrl] = useState("");
  const [savedVideoUrl, setSavedVideoUrl] = useState("");
const editor = useEditor({
  extensions: [
    StarterKit,
    Underline,
    Link.configure({ openOnClick: false }),
    Image,
    TextStyle,
    FontSize,
  ],
  content: "<p>Start writing your article...</p>",
});

useEffect(() => {
  const style = document.createElement("style");
  style.innerHTML = `
    .ProseMirror {
      min-height: 300px;
      height: 100%;
      width: 100%;
      cursor: text;
      outline: none;
      font-size: 16px;
      line-height: 1.6;
    }

    .ProseMirror p {
      margin: 0;
    }

    .ProseMirror img {
      max-width: 100%;
      border-radius: 10px;
      margin: 10px 0;
    }

    .ProseMirror a {
      color: #f6a21d;
      font-weight: bold;
      text-decoration: underline;
    }
  `;
  document.head.appendChild(style);

  return () => document.head.removeChild(style);
}, []);
  // 🔥 slug
  const createSlug = (text) =>
    text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      const userSnap = await getDocs(
        query(collection(db, "users"), where("uid", "==", user.uid))
      );

      let userRole = "public";
      userSnap.forEach((doc) => {
        userRole = doc.data().role || "public";
      });

      setRole(userRole);

      let q =
        userRole === "admin"
          ? collection(db, "articles")
          : query(collection(db, "articles"), where("authorId", "==", user.uid));

      const snap = await getDocs(q);
      setArticles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // 🔥 PLAYERS
      const playerSnap = await getDocs(collection(db, "players"));
      setPlayers(
        playerSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            slug: d.Slug,
            name: `${d.First} ${d.Last}`,
            position: d.Position,
            team: d.School,
          };
        })
      );

// 🔥 SCHOOLS (FIXED)
const teamSnap = await getDocs(collection(db, "schools"));

const formattedTeams = teamSnap.docs.map((doc) => {
  const d = doc.data();

  const schoolName = d.School;

  return {
    name: schoolName,
    slug: schoolName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "-"),
  };
});

setTeams(formattedTeams);
      setLoading(false);
    };

    fetchData();
  }, [user]);

  // 🔥 INSERT PLAYER — href stays slug-based (that's still the live route),
  // but data-player-id is what handleCreateArticle/EditArticle actually
  // read to build the playerIds join field, so the connection survives even
  // if a slug were ever to change.
  const insertPlayer = (player) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`<a href="/player/${player.slug}" data-player-id="${player.id}">${player.name}</a> `).run();
    setShowPlayerPicker(false);
  };

  // 🔥 INSERT TEAM
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
    if (!videoUrl.trim()) return;
    const href = /^https?:\/\//i.test(videoUrl.trim()) ? videoUrl.trim() : `https://${videoUrl.trim()}`;
    setSavedVideoUrl(href);
    setVideoUrl("");
    setShowVideoInput(false);
  };

  // 🔥 CREATE ARTICLE
  const handleCreateArticle = async () => {
    const html = editor.getHTML();

    if (!title.trim() || !html.trim()) {
      setMessage("❌ Title and content required");
      return;
    }

    const div = document.createElement("div");
    div.innerHTML = html;

    // Player links are the join key for "related articles" on a player's
    // page. Prefer the data-player-id baked in by insertPlayer; fall back to
    // resolving the href's slug against the loaded players list for links
    // that predate this attribute (e.g. pasted-in HTML, or an old article's
    // links that haven't been re-inserted).
    const slugToPlayerId = new Map(players.map((p) => [p.slug, p.id]));
    const playerLinks = div.querySelectorAll("a[href^='/player/']");
    const playerIdSet = new Set();
    playerLinks.forEach((link) => {
      const pid = link.getAttribute("data-player-id") || slugToPlayerId.get(link.getAttribute("href").split("/player/")[1]);
      if (pid) playerIdSet.add(pid);
    });

    const teamLinks = div.querySelectorAll("a[href^='/team/']");
    const teamSet = new Set();
    teamLinks.forEach((link) => {
      const linkSlug = link.getAttribute("href").split("/team/")[1];
      if (linkSlug) teamSet.add(linkSlug);
    });

    try {
      await addDoc(collection(db, "articles"), {
        title,
        slug: slug.trim() ? slug.trim() : createSlug(title),
        content: html,
        status,
        priority,
        author,
        publishedAt: publishedAt
          ? (() => {
              const [y, m, d] = publishedAt.split("-");
              return new Date(+y, +m - 1, +d);
            })()
          : null,
        playerIds: Array.from(playerIdSet),
        teamSlugs: Array.from(teamSet),
        videoUrl: savedVideoUrl || "",
        authorId: user.uid,
        createdAt: serverTimestamp(),
      });

      setMessage("✅ Article created");
      setTitle("");
      setContent("");
      setShowCreate(false);
      window.location.reload();
    } catch (err) {
      setMessage("❌ Error");
    }
  };

  // ── One-time migration for articles saved before the playerId schema —
  // resolves each legacy doc's `slugs[]` (player-linkage field) against the
  // currently-loaded player list and writes `playerIds`. Additive only: the
  // old `slugs` field is left in place rather than deleted, and any slug
  // that no longer matches a real player is reported rather than dropped
  // silently. ──
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
        await updateDoc(firestoreDoc(db, "articles", a.id), { playerIds: ids });
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
        (unresolved.size > 0 ? " Unresolved slugs (no matching player): " + Array.from(unresolved).join(", ") : "")
      );
    } catch (e) {
      console.error("Admin article migration error:", e);
      setMigrateMessage("Migration failed — check console.");
    } finally {
      setMigrating(false);
    }
  };

  if (!user) return <p>Login required</p>;
  if (loading) return <p>Loading...</p>;
  if (role !== "admin" && role !== "writer") return <p>Access Denied</p>;

  const filteredPlayers = players.filter((p) =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  );

  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(teamSearch.toLowerCase())
  );

  // 🔥 sort newest first
  const sortedArticles = [...articles].sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return bTime - aTime;
  });

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <h1 style={{ color: "#0055a5", margin: 0 }}>Article Dashboard</h1>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            style={{ ...btn, background: "#fff", color: "#0055a5", border: "2px solid #0055a5" }}
            onClick={migrateLegacyArticles}
            disabled={migrating}
            title="Backfill playerIds on articles still using the old slug-only schema"
          >
            {migrating ? "Migrating..." : "Migrate Legacy Articles"}
          </button>
          <button style={btn} onClick={() => setShowCreate(true)}>
            + Create Article
          </button>
        </div>
      </div>

      {migrateMessage && (
        <div style={{ marginBottom: "16px", fontSize: "13px", fontWeight: 700, color: "#555" }}>
          {migrateMessage}
        </div>
      )}

      {showCreate && (
        <div style={card}>
          <input
            placeholder="Article Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={input}
          />

          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="article-url-slug (optional, auto-generated from title)"
            style={input}
          />

          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author"
            style={input}
          />

          <input
            type="date"
            value={publishedAt}
            onChange={(e) => setPublishedAt(e.target.value)}
            style={input}
          />

          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="published">Published</option>
          </select>

          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            style={{ marginLeft: "10px" }}
          >
            <option value={1}>Priority 1</option>
            <option value={2}>Priority 2</option>
            <option value={3}>Priority 3</option>
          </select>

          {/* TOOLBAR */}
          <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button style={btn} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
            <button style={btn} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
            <button style={btn} onClick={() => editor.chain().focus().toggleUnderline().run()}>U</button>

            <button
              style={btn}
              onClick={() => {
                const current = editor.getAttributes("textStyle").fontSize || 18;
                editor.chain().focus().setFontSize(Math.max(12, Number(current) - 2)).run();
              }}
            >
              A-
            </button>

            <button
              style={btn}
              onClick={() => {
                const current = editor.getAttributes("textStyle").fontSize || 18;
                editor.chain().focus().setFontSize(Math.min(36, Number(current) + 2)).run();
              }}
            >
              A+
            </button>

            <button
              style={btn}
              onClick={() => {
                setShowPlayerPicker((v) => !v);
                setShowTeamPicker(false);
                setShowImageInput(false);
                setShowLinkInput(false);
                setShowVideoInput(false);
              }}
            >
              + Player
            </button>

            <button
              style={btn}
              onClick={() => {
                setShowTeamPicker((v) => !v);
                setShowPlayerPicker(false);
                setShowImageInput(false);
                setShowLinkInput(false);
                setShowVideoInput(false);
              }}
            >
              + Team
            </button>

            <button
              style={btn}
              onClick={() => {
                setShowImageInput((v) => !v);
                setShowPlayerPicker(false);
                setShowTeamPicker(false);
                setShowLinkInput(false);
                setShowVideoInput(false);
              }}
            >
              + Image
            </button>

            <button
              style={btn}
              onClick={() => {
                setShowLinkInput((v) => !v);
                setShowPlayerPicker(false);
                setShowTeamPicker(false);
                setShowImageInput(false);
                setShowVideoInput(false);
              }}
            >
              + Link
            </button>

            <button
              style={{ ...btn, background: "#b45309" }}
              onClick={() => {
                setShowVideoInput((v) => !v);
                setShowPlayerPicker(false);
                setShowTeamPicker(false);
                setShowImageInput(false);
                setShowLinkInput(false);
              }}
            >
              ▶ Video
            </button>
          </div>

          {/* TEXT EDITOR */}
          <div style={editorBox} onClick={() => editor?.chain().focus().run()}>
            <EditorContent editor={editor} />
          </div>

          {/* PLAYER PICKER */}
          {showPlayerPicker && (
            <div style={modal}>
              <input
                placeholder="Search player..."
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                style={search}
              />

              {filteredPlayers.map((p, i) => (
                <button key={i} style={listItem} onClick={() => insertPlayer(p)}>
                  {p.name} | {p.position} | {p.team}
                </button>
              ))}
            </div>
          )}

          {/* TEAM PICKER */}
          {showTeamPicker && (
            <div style={modal}>
              <input
                placeholder="Search team..."
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                style={search}
              />

              {filteredTeams.map((t, i) => (
                <button key={i} style={listItem} onClick={() => insertTeam(t)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {/* IMAGE INPUT */}
          {showImageInput && (
            <div style={modal}>
              <input
                placeholder="Paste image URL..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                style={search}
              />
              <button style={btn} onClick={insertImage}>Insert Image</button>
            </div>
          )}

          {/* CUSTOM LINK INPUT */}
          {showLinkInput && (
            <div style={modal}>
              <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: "13px", color: "#0055a5" }}>Custom Link</p>
              <input
                placeholder="Display text (e.g. Click here)"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                style={{ ...search, marginBottom: "8px" }}
              />
              <input
                placeholder="URL (e.g. https://example.com or /community)"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                style={{ ...search, marginBottom: "8px" }}
              />
              <button
                style={{ ...btn, opacity: !linkText.trim() || !linkUrl.trim() ? 0.5 : 1 }}
                onClick={insertLink}
                disabled={!linkText.trim() || !linkUrl.trim()}
              >
                Insert Link
              </button>
            </div>
          )}

          {/* VIDEO INPUT */}
          {showVideoInput && (
            <div style={modal}>
              <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: "13px", color: "#0055a5" }}>Video Link</p>
              {savedVideoUrl && (
                <div
                  style={{
                    marginBottom: "10px",
                    padding: "8px 10px",
                    background: "#e8f0fa",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#0055a5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <span>Current: {savedVideoUrl}</span>
                  <button
                    onClick={() => setSavedVideoUrl("")}
                    style={{
                      background: "#b91c1c",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      padding: "2px 8px",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: 900,
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
              <input
                placeholder="Video URL (YouTube, Twitter, etc.)"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                style={{ ...search, marginBottom: "8px" }}
              />
              <p style={{ margin: "0 0 8px", fontSize: "11px", color: "#888" }}>
                A ▶ Watch Video button will appear below the article title — not in the body.
              </p>
              <button
                style={{ ...btn, background: "#b45309", opacity: !videoUrl.trim() ? 0.5 : 1 }}
                onClick={insertVideo}
                disabled={!videoUrl.trim()}
              >
                {savedVideoUrl ? "Update Video Link" : "Set Video Link"}
              </button>
            </div>
          )}

          {message && <p>{message}</p>}

          <button style={{ ...btn, marginTop: "10px" }} onClick={handleCreateArticle}>
            Save Draft
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {sortedArticles.length === 0 && !loading && (
          <p style={{ color: "#777" }}>No articles yet.</p>
        )}

        {sortedArticles.map((a) => {
          const status = statusStyles[a.status] || statusStyles.draft;
          const date = a.createdAt?.toDate ? a.createdAt.toDate() : null;

          return (
            <div
              key={a.id}
              onClick={() => (window.location.href = `/admin/articles/${a.id}`)}
              style={articleCard}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
                e.currentTarget.style.borderColor = "#0055a5";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.borderColor = "#e0e0e0";
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <h3 style={{ color: "#0055a5", margin: 0 }}>{a.title}</h3>
                <span style={{ color: "#888", fontSize: "13px" }}>
                  {date
                    ? date.toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : "Unknown date"}
                </span>
              </div>

              <span
                style={{
                  ...statusBadge,
                  background: status.background,
                  color: status.color,
                }}
              >
                {a.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 🔥 STYLES
const btn = {
  background: "#0055a5",
  color: "white",
  padding: "8px 16px",
  borderRadius: "8px",
  border: "2px solid #f6a21d",
  fontWeight: "bold",
};

const card = {
  background: "#fff",
  padding: "20px",
  borderRadius: "10px",
  marginTop: "15px",
};

const input = {
  width: "100%",
  padding: "10px",
  borderRadius: "8px",
  border: "2px solid #0055a5",
  marginBottom: "10px",
};

const textarea = {
  width: "100%",
  height: "200px",
  borderRadius: "8px",
  border: "2px solid #0055a5",
  padding: "10px",
};

const modal = {
  border: "2px solid #0055a5",
  padding: "10px",
  borderRadius: "8px",
  marginTop: "10px",
  maxHeight: "200px",
  overflowY: "scroll",
};

const listItem = {
  width: "100%",
  textAlign: "left",
  padding: "6px",
  borderBottom: "1px solid #ddd",
};

const search = {
  width: "100%",
  padding: "8px",
  marginBottom: "10px",
};
const toolbarBtn = {
  background: "#f6a21d",
  color: "#0055a5",
  border: "none",
  padding: "6px 10px",
  borderRadius: "6px",
  fontWeight: "bold",
  marginRight: "6px",
  cursor: "pointer",
};
const editorBox = {
  border: "2px solid #0055a5",
  borderRadius: "10px",
  padding: "12px",
  minHeight: "300px",
  cursor: "text",
  background: "white",
};

const articleCard = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  border: "1px solid #e0e0e0",
  padding: "16px",
  borderRadius: "10px",
  cursor: "pointer",
  background: "#fff",
  transition: "box-shadow 0.15s ease, border-color 0.15s ease",
};

const statusBadge = {
  padding: "4px 12px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "bold",
  textTransform: "capitalize",
  whiteSpace: "nowrap",
};

const statusStyles = {
  published: { background: "#e6f4ea", color: "#1a7f37" },
  pending: { background: "#fff4e5", color: "#b35c00" },
  draft: { background: "#f0f0f0", color: "#666" },
};