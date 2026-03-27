import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
} from "firebase/firestore";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";

export default function EditArticle() {
  const { id } = useParams();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [priority, setPriority] = useState(2);
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(true);

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);

  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showImageInput, setShowImageInput] = useState(false);

  const [playerSearch, setPlayerSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
    ],
    content: "",
  });

  // 🔥 FETCH DATA
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

        editor.commands.setContent(data.content || "");
      }

      // PLAYERS
      const playerSnap = await getDocs(collection(db, "players"));
      setPlayers(
        playerSnap.docs.map((doc) => {
          const d = doc.data();
          return {
            slug: d.Slug,
            name: `${d.First} ${d.Last}`,
            position: d.Position,
            team: d.School,
          };
        })
      );

      // TEAMS
      const teamSnap = await getDocs(collection(db, "schools"));
      setTeams(
        teamSnap.docs.map((doc) => {
          const d = doc.data();
          const name = d.School;

          return {
            name,
            slug: name
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, "")
              .replace(/\s+/g, "-"),
          };
        })
      );

      setLoading(false);
    };

    fetchData();
  }, [id, editor]);

  // 🔥 STYLE FIX (editor + images)
  useEffect(() => {
    const style = document.createElement("style");

    style.innerHTML = `
      .ProseMirror {
        min-height: 300px;
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

  // 🔥 INSERT FUNCTIONS
  const insertPlayer = (player) => {
    if (!editor) return;

    editor
      .chain()
      .focus()
      .setLink({ href: `/player/${player.slug}` })
      .insertContent(player.name + " ")
      .unsetLink()
      .run();

    setShowPlayerPicker(false);
  };

  const insertTeam = (team) => {
    if (!editor) return;

    editor
      .chain()
      .focus()
      .setLink({ href: `/team/${team.slug}` })
      .insertContent(team.name + " ")
      .unsetLink()
      .run();

    setShowTeamPicker(false);
  };

  const insertImage = () => {
    if (!editor || !imageUrl) return;

    editor.chain().focus().setImage({ src: imageUrl }).run();

    setImageUrl("");
    setShowImageInput(false);
  };

  // 🔥 SAVE
  const handleSave = async () => {
    const ref = doc(db, "articles", id);

    await updateDoc(ref, {
      title,
      slug,
      priority,
      content: editor?.getHTML() || "",
      status,
      updatedAt: serverTimestamp(),
    });

    alert("Saved!");
  };

  if (loading) return <p>Loading...</p>;

  const filteredPlayers = players.filter((p) =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  );

  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(teamSearch.toLowerCase())
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>
      <h1>Edit Article</h1>

      <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />

      <input
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="article-url-slug"
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
      <div style={{ marginTop: "10px" }}>
        <button style={btn} onClick={() => setShowPlayerPicker(true)}>
          + Player
        </button>

        <button style={{ ...btn, marginLeft: "10px" }} onClick={() => setShowTeamPicker(true)}>
          + Team
        </button>

        <button style={{ ...btn, marginLeft: "10px" }} onClick={() => setShowImageInput(true)}>
          + Image
        </button>
      </div>

      {/* EDITOR */}
      <div style={editorBox} onClick={() => editor?.chain().focus().run()}>
        {editor && <EditorContent editor={editor} />}
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

          <button style={btn} onClick={insertImage}>
            Insert Image
          </button>
        </div>
      )}

      <button onClick={handleSave} style={{ ...btn, marginTop: "10px" }}>
        Save Changes
      </button>
    </div>
  );
}

// STYLES
const btn = {
  background: "#0055a5",
  color: "white",
  padding: "8px 14px",
  borderRadius: "8px",
  border: "2px solid #f6a21d",
};

const input = {
  width: "100%",
  padding: "10px",
  border: "2px solid #0055a5",
  borderRadius: "8px",
  marginBottom: "10px",
};

const editorBox = {
  border: "2px solid #0055a5",
  borderRadius: "10px",
  padding: "12px",
  minHeight: "300px",
  background: "white",
  cursor: "text",
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