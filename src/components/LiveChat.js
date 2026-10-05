// src/components/LiveChat.js
//
// A game's Chat tab on /live (LivePage.js GameView). Anyone can read; only
// signed-in users can post, and only while the game is live. Messages are
// liveGames/{id}/chat/{msg}, listened to newest CHAT_SHOWN; posting goes
// through api/live-chat.js, which re-checks everything (sign-in, game live,
// src/utils/chatFilter.mjs — slurs, sexual content, links — and a rate
// limit) before writing. The filter also runs here first for instant
// feedback. Admins can delete a message or chat-ban its author
// (users/{uid}.chatBanned).
import { useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { chatProblem, CHAT_MAX } from "../utils/chatFilter";

const GOLD = "#f6a21d";
const CHAT_SHOWN = 150;

export const LIVE_CHAT_STYLE = `
.lch { background: #111a2b; border: 1px solid #1d2840; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
.lch-list { height: min(62vh, 620px); min-height: 320px; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 2px; }
.lch-msg { padding: 6px 8px; border-radius: 10px; line-height: 1.35; word-wrap: break-word; position: relative; }
.lch-msg:hover { background: #16213a; }
.lch-msg.mine { background: rgba(246,162,29,0.07); }
.lch-name { font-weight: 900; font-size: 13px; color: #8fb8ff; margin-right: 6px; }
.lch-msg.mine .lch-name { color: ${GOLD}; }
.lch-ver { color: #4d9fff; font-size: 11px; margin-left: 2px; }
.lch-time { font-size: 10px; font-weight: 700; color: #4f6080; margin-left: 6px; }
.lch-text { font-size: 15px; color: #e6ecf5; font-weight: 600; }
.lch-mod { position: absolute; right: 6px; top: 5px; display: none; gap: 4px; }
.lch-msg:hover .lch-mod { display: flex; }
.lch-mod button { background: #26324a; border: 0; color: #c9d5e6; font-size: 10px; font-weight: 900; padding: 3px 7px; border-radius: 6px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; }
.lch-mod button:hover { background: #d62828; color: #fff; }
.lch-empty { margin: auto; color: #6f819c; font-weight: 800; text-align: center; padding: 30px 10px; }
.lch-new { align-self: center; position: sticky; bottom: 4px; background: ${GOLD}; color: #121212; border: 0; border-radius: 999px; padding: 5px 14px; font-weight: 900; font-size: 12px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
.lch-form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #1d2840; background: #0c1220; align-items: center; }
.lch-form input { flex: 1; min-width: 0; background: #111a2b; border: 1px solid #26324a; border-radius: 999px; padding: 10px 14px; color: #eef2f8; font: inherit; font-weight: 700; font-size: 15px; outline: none; }
.lch-form input:focus { border-color: ${GOLD}; }
.lch-form button { background: ${GOLD}; color: #121212; border: 0; border-radius: 999px; padding: 10px 18px; font-weight: 900; font-size: 14px; cursor: pointer; flex-shrink: 0; }
.lch-form button:disabled { opacity: 0.5; cursor: default; }
.lch-count { font-size: 11px; font-weight: 800; color: #6f819c; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.lch-note { padding: 12px 14px; border-top: 1px solid #1d2840; background: #0c1220; color: #9fb0c8; font-weight: 800; font-size: 14px; text-align: center; }
.lch-note button { background: none; border: 0; color: ${GOLD}; font: inherit; font-weight: 900; cursor: pointer; text-decoration: underline; padding: 0; }
.lch-err { padding: 6px 14px 0; color: #ff6b6b; font-weight: 800; font-size: 13px; background: #0c1220; }
`;

const timeOf = (ms) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");

export default function LiveChat({ gameId, game }) {
  const { user, profile, login } = useAuth();
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const listRef = useRef(null);
  const atBottom = useRef(true);
  const isLive = game?.status === "in_progress";
  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    const q = query(collection(db, "liveGames", String(gameId), "chat"), orderBy("atMs", "desc"), limit(CHAT_SHOWN));
    return onSnapshot(q, (s) => setMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() })).reverse()), () => setMsgs([]));
  }, [gameId]);

  // Follow new messages while scrolled to the bottom; otherwise count them.
  const prevCount = useRef(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !msgs) return;
    const added = msgs.length - prevCount.current;
    prevCount.current = msgs.length;
    const mineLast = msgs[msgs.length - 1]?.uid === user?.uid;
    if (atBottom.current || mineLast) { el.scrollTop = el.scrollHeight; setUnseen(0); } else if (added > 0) setUnseen((n) => n + added);
  }, [msgs, user?.uid]);
  const onScroll = () => {
    const el = listRef.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom.current) setUnseen(0);
  };
  const toBottom = () => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; setUnseen(0); };

  const send = async (e) => {
    e.preventDefault();
    const t = text.trim();
    const problem = chatProblem(t);
    if (problem) { setErr(problem); return; }
    setSending(true); setErr("");
    try {
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/live-chat", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ gameId: String(gameId), text: t }),
      });
      if (r.status === 404) throw new Error("Chat posting runs on the live site.");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't send — try again.");
      setText("");
      atBottom.current = true;
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (m) => {
    if (!window.confirm(`Delete this message from ${m.name}?`)) return;
    try { await deleteDoc(doc(db, "liveGames", String(gameId), "chat", m.id)); } catch (e) { console.error(e); alert("Couldn't delete — check console."); }
  };
  const ban = async (m) => {
    if (!window.confirm(`Ban ${m.name} from chat? Their messages stay until deleted.`)) return;
    try { await updateDoc(doc(db, "users", m.uid), { chatBanned: true }); alert(`${m.name} can no longer post in chat.`); } catch (e) { console.error(e); alert("Couldn't ban — check console."); }
  };

  return (
    <div className="lch">
      <div className="lch-list" ref={listRef} onScroll={onScroll}>
        {!msgs ? <div className="lch-empty">Loading chat…</div>
          : !msgs.length ? <div className="lch-empty">{isLive ? "No messages yet — start the conversation." : "No one chatted during this game."}</div>
          : msgs.map((m) => (
            <div key={m.id} className={`lch-msg${m.uid === user?.uid ? " mine" : ""}`}>
              <span className="lch-name">{m.name}{m.verified && <span className="lch-ver" title="Verified">✔</span>}</span>
              <span className="lch-text">{m.text}</span>
              <span className="lch-time">{timeOf(m.atMs)}</span>
              {isAdmin && (
                <span className="lch-mod">
                  <button type="button" onClick={() => remove(m)}>Delete</button>
                  {m.uid !== user?.uid && <button type="button" onClick={() => ban(m)}>Ban</button>}
                </span>
              )}
            </div>
          ))}
        {unseen > 0 && <button type="button" className="lch-new" onClick={toBottom}>↓ {unseen} new message{unseen === 1 ? "" : "s"}</button>}
      </div>
      {!isLive ? (
        <div className="lch-note">{game?.status === "final" ? "Chat is closed — this game is final." : "Chat opens at kickoff."}</div>
      ) : !user ? (
        <div className="lch-note"><button type="button" onClick={login}>Log in</button> to join the chat.</div>
      ) : (
        <>
          {err && <div className="lch-err">{err}</div>}
          <form className="lch-form" onSubmit={send}>
            <input value={text} maxLength={CHAT_MAX} placeholder="Say something…" onChange={(e) => { setText(e.target.value); if (err) setErr(""); }} />
            {text.length > CHAT_MAX - 40 && <span className="lch-count">{CHAT_MAX - text.length}</span>}
            <button type="submit" disabled={sending || !text.trim()}>{sending ? "…" : "Send"}</button>
          </form>
        </>
      )}
    </div>
  );
}
