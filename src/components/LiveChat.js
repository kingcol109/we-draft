// src/components/LiveChat.js
//
// A game's Chat tab on /live (LivePage.js GameView). Anyone can read; only
// signed-in users can post, from game week (the game's liveGames doc —
// /live is tracking it) until it's final: pregame and live. Messages are
// liveGames/{id}/chat/{msg}, listened to newest CHAT_SHOWN; posting goes
// through api/live-chat.js, which re-checks everything (sign-in, game live,
// src/utils/chatFilter.mjs — slurs, sexual content, links — and a rate
// limit) before writing. The filter also runs here first for instant
// feedback. Admins can delete a message or chat-ban its author
// (users/{uid}.chatBanned).
//
// Signed-in users can up/down-vote other people's messages (▲ score ▼) —
// also through api/live-chat.js, which keeps each message's up / down
// counts and the voter's own votes (users/{uid}/chatVotes/{gameId}, one
// listener) in step. A message voted down to BURIED_AT or below is dimmed.
//
// Game markers — system messages the ingester posts as the game moves
// (kickoff, each quarter, halftime, OT, final: server/live/store.js
// chatMarkOf) — show as dividers, so the chat reads in game time later;
// anything before the kickoff marker sits under a "Pregame" divider.
import { Fragment, useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { chatProblem, CHAT_MAX } from "../utils/chatFilter";
import VerifiedNameBadge from "./VerifiedNameBadge";

const GOLD = "#f6a21d";
const CHAT_SHOWN = 150;
const BURIED_AT = -3;

export const LIVE_CHAT_STYLE = `
.lch { background: #111a2b; border: 1px solid #1d2840; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
.lch-list { height: min(calc(62vh / var(--pz, 1)), 620px); min-height: 320px; overflow-y: auto; padding: 6px 0; display: flex; flex-direction: column; }
/* a message: a plain row — name, time and votes on top, the text under it */
.lch-msg { display: grid; grid-template-columns: 1fr auto; column-gap: 10px; padding: 8px 16px 9px; border-left: 3px solid transparent; line-height: 1.4; word-wrap: break-word; position: relative; }
.lch-msg + .lch-msg { border-top: 1px solid #172238; }
.lch-msg.mine { border-left-color: ${GOLD}; }
.lch-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.lch-name { font-weight: 900; font-size: 13px; color: #8fb8ff; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lch-msg.mine .lch-name { color: ${GOLD}; }
.lch-time { font-size: 11px; font-weight: 700; color: #4f6080; flex-shrink: 0; }
.lch-text { grid-column: 1 / -1; margin-top: 2px; font-size: 15px; color: #e6ecf5; font-weight: 600; }
.lch-mod { position: absolute; right: 90px; top: 6px; display: none; gap: 4px; }
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
.lch-votes { display: inline-flex; align-items: center; gap: 2px; align-self: center; }
.lch-votes button { background: none; border: 0; padding: 1px 4px; border-radius: 5px; color: #4f6080; font-size: 11px; line-height: 1; cursor: pointer; }
.lch-votes button:hover:not(:disabled) { background: #1d2840; color: #c9d5e6; }
.lch-votes button:disabled { cursor: default; }
.lch-votes button.up.on { color: ${GOLD}; }
.lch-votes button.down.on { color: #ff6b6b; }
.lch-votes b { min-width: 14px; text-align: center; font-size: 11px; font-weight: 900; color: #6f819c; font-variant-numeric: tabular-nums; }
.lch-votes b.pos { color: ${GOLD}; }
.lch-votes b.neg { color: #ff6b6b; }
.lch-msg.buried { opacity: 0.45; }
.lch-mark { display: flex; align-items: center; gap: 10px; margin: 10px 16px 6px; color: ${GOLD}; font-weight: 900; font-size: 12px; letter-spacing: 0.04em; position: relative; }
.lch-mark::before, .lch-mark::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, transparent, rgba(246,162,29,0.45), transparent); }
.lch-mark span { text-align: center; white-space: normal; }
.lch-mark small { margin-left: 6px; font-size: 10px; font-weight: 700; color: #4f6080; }
.lch-mark .lch-mod { top: -4px; }
.lch-mark:hover .lch-mod { display: flex; }
.lch-mark.pre { color: #8193ad; }
.lch-mark.pre::before, .lch-mark.pre::after { background: linear-gradient(90deg, transparent, rgba(129,147,173,0.4), transparent); }
.lch-msg.buried:hover { opacity: 1; }
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
  // Open pregame and live; a game /live isn't tracking yet (a future week,
  // built from the schedule) opens game week.
  const isLive = (game?.status === "in_progress" || game?.status === "scheduled") && !game?.scheduleOnly;
  const isAdmin = profile?.role === "admin";

  // My votes in this game's chat ({ [msgId]: 1 | -1 }), plus the ones I've
  // just cast (shown right away, until the server's write comes back).
  const [myVotes, setMyVotes] = useState({});
  const [pending, setPending] = useState({});
  useEffect(() => {
    setMyVotes({}); setPending({});
    if (!user?.uid) return undefined;
    return onSnapshot(doc(db, "users", user.uid, "chatVotes", String(gameId)), (d) => setMyVotes(d.data() || {}), () => {});
  }, [user?.uid, gameId]);

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

  // ▲ / ▼: the same arrow again clears the vote.
  const castVote = async (m, dir) => {
    if (!user) { login(); return; }
    const prev = m.id in pending ? pending[m.id] : myVotes[m.id] || 0;
    const next = prev === dir ? 0 : dir;
    setPending((p) => ({ ...p, [m.id]: next }));
    setErr("");
    try {
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/live-chat", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "vote", gameId: String(gameId), msgId: m.id, vote: next }),
      });
      if (r.status === 404) throw new Error("Chat voting runs on the live site.");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't vote — try again.");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      // The message's counts and my votes doc have the real result now.
      setPending((p) => { const n = { ...p }; delete n[m.id]; return n; });
    }
  };
  // A message's score with my pending vote applied over the saved one.
  const scoreOf = (m) => {
    const saved = myVotes[m.id] || 0;
    const mine = m.id in pending ? pending[m.id] : saved;
    return { mine, score: (m.up || 0) - (m.down || 0) - saved + mine };
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
          : !msgs.length ? <div className="lch-empty">{isLive ? (game?.status === "scheduled" ? "No messages yet — get the pregame talk going." : "No messages yet — start the conversation.") : "No one chatted during this game."}</div>
          : msgs.map((m, i) => {
            // A game marker: a divider, not a message (no name or votes).
            if (m.system) {
              return (
                <div key={m.id} className="lch-mark" role="separator">
                  <span>{m.text}<small>{timeOf(m.atMs)}</small></span>
                  {isAdmin && <span className="lch-mod"><button type="button" onClick={() => remove(m)}>Delete</button></span>}
                </div>
              );
            }
            // Messages before kickoff sit under a "Pregame" divider.
            const pregameHead = i === 0 && (game?.status === "scheduled" || msgs.some((x) => x.system && x.kind === "kickoff"))
              ? <div className="lch-mark pre" role="separator"><span>💬 Pregame</span></div> : null;
            const own = m.uid === user?.uid;
            const { mine, score } = scoreOf(m);
            return (
            <Fragment key={m.id}>
            {pregameHead}
            <div className={`lch-msg${own ? " mine" : ""}${score <= BURIED_AT ? " buried" : ""}`}>
              <div className="lch-top">
                <span className="lch-name"><VerifiedNameBadge uid={m.uid} name={m.name} verified={!!m.verified} size={14} /></span>
                <span className="lch-time">{timeOf(m.atMs)}</span>
              </div>
              <span className="lch-votes">
                <button type="button" className={`up${mine === 1 ? " on" : ""}`} disabled={own} onClick={() => castVote(m, 1)}
                  aria-label="Upvote" aria-pressed={mine === 1} title={own ? "Your message" : mine === 1 ? "Remove upvote" : "Upvote"}>▲</button>
                <b className={score > 0 ? "pos" : score < 0 ? "neg" : ""}>{score}</b>
                <button type="button" className={`down${mine === -1 ? " on" : ""}`} disabled={own} onClick={() => castVote(m, -1)}
                  aria-label="Downvote" aria-pressed={mine === -1} title={own ? "Your message" : mine === -1 ? "Remove downvote" : "Downvote"}>▼</button>
              </span>
              <div className="lch-text">{m.text}</div>
              {isAdmin && (
                <span className="lch-mod">
                  <button type="button" onClick={() => remove(m)}>Delete</button>
                  {m.uid !== user?.uid && <button type="button" onClick={() => ban(m)}>Ban</button>}
                </span>
              )}
            </div>
            </Fragment>
            );
          })}
        {unseen > 0 && <button type="button" className="lch-new" onClick={toBottom}>↓ {unseen} new message{unseen === 1 ? "" : "s"}</button>}
      </div>
      {!isLive ? (
        <div className="lch-note">{game?.status === "final" ? "Chat is closed — this game is final." : "Chat opens game week."}</div>
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
