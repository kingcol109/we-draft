import { useEffect, useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
export default function AdminArticles() {
  const { user } = useAuth();

  const [role, setRole] = useState(null);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);

  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);

  const [playerSearch, setPlayerSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
const editor = useEditor({
  extensions: [
    StarterKit,
    Underline,
Link.configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
  HTMLAttributes: {
    class: "player-link",
  },
}),
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

  // 🔥 INSERT PLAYER
const insertPlayer = (player) => {
  editor.chain().focus().extendMarkRange("link").unsetLink().run();

  editor
    .chain()
    .focus()
    .setLink({ href: `/player/${player.slug}` })
    .insertContent(player.name + " ")
    .unsetLink()
    .run();

  setShowPlayerPicker(false);
};
  // 🔥 INSERT TEAM
const insertTeam = (team) => {
  editor.chain().focus().extendMarkRange("link").unsetLink().run();

  editor
    .chain()
    .focus()
    .setLink({ href: `/team/${team.slug}` })
    .insertContent(team.name + " ")
    .unsetLink()
    .run();

  setShowTeamPicker(false);
};

  // 🔥 CREATE ARTICLE
  const handleCreateArticle = async () => {
const html = editor.getHTML();

if (!title.trim() || !html.trim()) {
      setMessage("❌ Title and content required");
      return;
    }

    try {
      await addDoc(collection(db, "articles"), {
        title,
        slug: createSlug(title),
content: html,
        status: "draft",
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

  if (!user) return <p>Login required</p>;
  if (loading) return <p>Loading...</p>;
  if (role !== "admin" && role !== "writer") return <p>Access Denied</p>;

  const filteredPlayers = players.filter((p) =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  );

  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(teamSearch.toLowerCase())
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>
      <h1 style={{ color: "#0055a5" }}>Article Dashboard</h1>

      <button style={btn} onClick={() => setShowCreate(true)}>
        + Create Article
      </button>

      {showCreate && (
        <div style={card}>
          <input
            placeholder="Article Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={input}
          />

          {/* ACTION BUTTONS */}
          <div style={{ marginBottom: "10px" }}>
  <button onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
  <button onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
  <button onClick={() => editor.chain().focus().toggleUnderline().run()}>U</button>
</div>
          <div style={{ marginBottom: "10px" }}>
            <button style={btn} onClick={() => setShowPlayerPicker(true)}>
              + Player
            </button>

            <button
              style={{ ...btn, marginLeft: "10px" }}
              onClick={() => setShowTeamPicker(true)}
            >
              + Team
            </button>
          </div>

          {/* TEXT EDITOR */}
<div style={editorBox}>
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

          {message && <p>{message}</p>}

          <button style={btn} onClick={handleCreateArticle}>
            Save Draft
          </button>
        </div>
      )}

{articles.map((a) => (
  <div
    key={a.id}
    onClick={() => window.location.href = `/admin/articles/${a.id}`}
    style={{
      border: "1px solid #ddd",
      padding: "10px",
      marginBottom: "10px",
      borderRadius: "8px",
      cursor: "pointer",
    }}
  >
    <h3 style={{ color: "#0055a5" }}>{a.title}</h3>

    <p
      style={{
        color:
          a.status === "published"
            ? "green"
            : a.status === "pending"
            ? "orange"
            : "gray",
      }}
    >
      {a.status}
    </p>
  </div>
))}
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