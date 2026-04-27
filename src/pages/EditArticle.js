import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs,
} from "firebase/firestore";

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

export default function EditArticle() {
  const { id } = useParams();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [priority, setPriority] = useState(2);
  const [slug, setSlug] = useState("");
  const [author, setAuthor] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [loading, setLoading] = useState(true);

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);

  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showImageInput, setShowImageInput] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);

  const [playerSearch, setPlayerSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [savedVideoUrl, setSavedVideoUrl] = useState(""); // stored separately, not in body

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      TextStyle,
      FontSize,
    ],
    content: "",
  });

  useEffect(() => {
    if (!editor) return;

    const fetchData = async () => {
      const ref = doc(db, "articles", id);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const data = snap.data();
        setTitle(data.title);
        setStatus(data.status || "draft");
        setPriority(data.priority || 2);
        setSlug(data.slug || "");
        setAuthor(data.author || "");
        setPublishedAt(
          data.publishedAt?.toDate
            ? data.publishedAt.toDate().toISOString().split("T")[0]
            : ""
        );
        editor.commands.setContent(data.content || "");
        setSavedVideoUrl(data.videoUrl || "");
      }

      const playerSnap = await getDocs(collection(db, "players"));
      setPlayers(
        playerSnap.docs.map((doc) => {
          const d = doc.data();
          return { slug: d.Slug, name: `${d.First} ${d.Last}`, position: d.Position, team: d.School };
        })
      );

      const teamSnap = await getDocs(collection(db, "schools"));
      setTeams(
        teamSnap.docs.map((doc) => {
          const d = doc.data();
          const name = d.School;
          return {
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-"),
          };
        })
      );

      setLoading(false);
    };

    fetchData();
  }, [id, editor]);

  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      .ProseMirror { min-height: 300px; width: 100%; cursor: text; outline: none; font-size: inherit; line-height: 1.6; }
      .ProseMirror p { margin: 0; }
      .ProseMirror img { max-width: 100%; border-radius: 10px; margin: 10px 0; }
      .ProseMirror a { color: #f6a21d; font-weight: bold; text-decoration: underline; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const insertPlayer = (player) => {
    if (!editor) return;
    editor.chain().focus().insertContent(`<a href="/player/${player.slug}">${player.name}</a> `).run();
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
    // Ensure URL has protocol
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

  const handleDelete = async () => {
    const confirmDelete = window.confirm("Are you sure you want to delete this article? This cannot be undone.");
    if (!confirmDelete) return;
    await deleteDoc(doc(db, "articles", id));
    alert("Article deleted");
    window.location.href = "/admin/articles";
  };

  const handleSave = async () => {
    const ref = doc(db, "articles", id);
    const html = editor?.getHTML() || "";
    const div = document.createElement("div");
    div.innerHTML = html;

    const playerLinks = div.querySelectorAll("a[href^='/player/']");
    const playerSet = new Set();
    playerLinks.forEach((link) => {
      const slug = link.getAttribute("href").split("/player/")[1];
      if (slug) playerSet.add(slug);
    });

    const teamLinks = div.querySelectorAll("a[href^='/team/']");
    const teamSet = new Set();
    teamLinks.forEach((link) => {
      const slug = link.getAttribute("href").split("/team/")[1];
      if (slug) teamSet.add(slug);
    });

    await updateDoc(ref, {
      title, slug, priority, content: html, status, author,
      publishedAt: publishedAt ? (() => { const [y,m,d] = publishedAt.split("-"); return new Date(+y, +m-1, +d); })() : null,
      slugs: Array.from(playerSet),
      teamSlugs: Array.from(teamSet),
      videoUrl: savedVideoUrl || "",
      updatedAt: serverTimestamp(),
    });

    alert("Saved!");
  };

  if (loading) return <p>Loading...</p>;

  const filteredPlayers = players.filter((p) => p.name.toLowerCase().includes(playerSearch.toLowerCase()));
  const filteredTeams = teams.filter((t) => t.name.toLowerCase().includes(teamSearch.toLowerCase()));

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>
      <h1>Edit Article</h1>

      <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
      <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="article-url-slug" style={input} />
      <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" style={input} />
      <input type="date" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} style={input} />

      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="draft">Draft</option>
        <option value="pending">Pending</option>
        <option value="published">Published</option>
      </select>

      <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} style={{ marginLeft: "10px" }}>
        <option value={1}>Priority 1</option>
        <option value={2}>Priority 2</option>
        <option value={3}>Priority 3</option>
      </select>

      {/* TOOLBAR */}
      <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button style={btn} onClick={() => {
          const current = editor.getAttributes("textStyle").fontSize || 18;
          editor.chain().focus().setFontSize(Math.max(12, Number(current) - 2)).run();
        }}>A-</button>

        <button style={btn} onClick={() => {
          const current = editor.getAttributes("textStyle").fontSize || 18;
          editor.chain().focus().setFontSize(Math.min(36, Number(current) + 2)).run();
        }}>A+</button>

        <button style={btn} onClick={() => { setShowPlayerPicker((v) => !v); setShowTeamPicker(false); setShowImageInput(false); setShowLinkInput(false); setShowVideoInput(false); }}>
          + Player
        </button>

        <button style={btn} onClick={() => { setShowTeamPicker((v) => !v); setShowPlayerPicker(false); setShowImageInput(false); setShowLinkInput(false); setShowVideoInput(false); }}>
          + Team
        </button>

        <button style={btn} onClick={() => { setShowImageInput((v) => !v); setShowPlayerPicker(false); setShowTeamPicker(false); setShowLinkInput(false); setShowVideoInput(false); }}>
          + Image
        </button>

        <button style={btn} onClick={() => { setShowLinkInput((v) => !v); setShowPlayerPicker(false); setShowTeamPicker(false); setShowImageInput(false); setShowVideoInput(false); }}>
          + Link
        </button>

        <button style={{ ...btn, background: "#b45309" }} onClick={() => { setShowVideoInput((v) => !v); setShowPlayerPicker(false); setShowTeamPicker(false); setShowImageInput(false); setShowLinkInput(false); }}>
          ▶ Video
        </button>
      </div>

      {/* EDITOR */}
      <div style={editorBox} onClick={() => editor?.chain().focus().run()}>
        {editor && <EditorContent editor={editor} />}
      </div>

      {/* PLAYER PICKER */}
      {showPlayerPicker && (
        <div style={modal}>
          <input placeholder="Search player..." value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} style={search} />
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
          <input placeholder="Search team..." value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} style={search} />
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
          <input placeholder="Paste image URL..." value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={search} />
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
            style={{ ...btn, opacity: (!linkText.trim() || !linkUrl.trim()) ? 0.5 : 1 }}
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
            <div style={{ marginBottom: "10px", padding: "8px 10px", background: "#e8f0fa", borderRadius: "6px", fontSize: "12px", fontWeight: 700, color: "#0055a5", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span>Current: {savedVideoUrl}</span>
              <button onClick={() => setSavedVideoUrl("")} style={{ background: "#b91c1c", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px", fontWeight: 900 }}>Remove</button>
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

      <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
        <button onClick={handleSave} style={btn}>Save Changes</button>
        <button onClick={handleDelete} style={{ ...btn, background: "#b91c1c" }}>Delete Article</button>
      </div>
    </div>
  );
}

// STYLES
const btn = {
  background: "#0055a5", color: "white",
  padding: "8px 14px", borderRadius: "8px",
  border: "2px solid #f6a21d", cursor: "pointer",
};

const input = {
  width: "100%", padding: "10px",
  border: "2px solid #0055a5", borderRadius: "8px",
  marginBottom: "10px",
};

const editorBox = {
  border: "2px solid #0055a5", borderRadius: "10px",
  padding: "12px", minHeight: "300px",
  background: "white", cursor: "text",
  marginTop: "10px",
};

const modal = {
  border: "2px solid #0055a5", padding: "12px",
  borderRadius: "8px", marginTop: "10px",
  maxHeight: "220px", overflowY: "scroll",
  background: "#f8faff",
};

const listItem = {
  width: "100%", textAlign: "left",
  padding: "6px", borderBottom: "1px solid #ddd",
  background: "none", cursor: "pointer",
};

const search = {
  width: "100%", padding: "8px",
  marginBottom: "10px", boxSizing: "border-box",
};