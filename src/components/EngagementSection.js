// src/components/EngagementSection.js
//
// Like + Comments, extracted from GamePage.js's own game comments (see its
// handlePostComment/handleToggleHype/etc. — this is the same rules/shape,
// generalized to any parent doc instead of being wired specifically to
// schedule26/{gameId}). Reused by PerformancePage.js and NewsArticle.jsx so
// a performance or article can be liked/commented on the same way a game
// can, without duplicating this ~500 lines of state/handlers/markup.
//
// Three exports, all built on the same state:
//   - useEngagement(docPath): the hook — all state/handlers, no markup.
//     Call it once per page (before any early return, same as any hook) so
//     a page that wants the Like button somewhere other than the comments
//     card (e.g. up in its own header bar, like NewsArticle.jsx) can share
//     one fetch/state instance between both.
//   - LikeButton: just the pill button, reused as-is by both the header-bar
//     placement and EngagementSection's own default placement below.
//   - EngagementSection (default): the comments card. Pass either `docPath`
//     (it calls useEngagement itself) or an already-built `engagement` (to
//     share one instance with a LikeButton rendered elsewhere) — not both.
//
// `docPath` is the parent doc's path as segments, e.g. ["performances", id]
// or ["articles", id] — passed straight through to collection()/doc() to
// build paths like performances/{id}/comments, performances/{id}/likes,
// etc. Firestore rules for each parent collection must mirror
// schedule26/{doc}'s own comments/likes/replies rules (see firestore.rules)
// or every write here will be silently denied.
import { useEffect, useState } from "react";
import {
  collection, query, orderBy, getDocs, getDoc, addDoc, doc, deleteDoc, setDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "./LoadingSpinner";
import verifiedBadge from "../assets/verified.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

// Same word list/approach GamePage.js/PlayerProfile.js/UserProfile.js each
// keep their own copy of for public text — centralized here since this
// component is the one place meant to be shared across pages.
const bannedWords = ["faggot", "nigger", "monkey", "nigga", "fuck"];
const containsProfanity = (text) => bannedWords.some((w) => text.toLowerCase().includes(w));

export function useEngagement(docPath) {
  const { user, profile, login } = useAuth();
  const pathKey = docPath.join("/");
  // .every(Boolean) on an empty array is vacuously true — the length check
  // stops a caller passing [] (e.g. "no doc yet") from being read as ready
  // and hitting collection(db, "comments") at the database root.
  const ready = docPath.length > 0 && docPath.every(Boolean);

  const [likeUids, setLikeUids] = useState(new Set());
  const [liking, setLiking] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentMessage, setCommentMessage] = useState("");
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [likingCommentId, setLikingCommentId] = useState(null);
  const [likingReplyId, setLikingReplyId] = useState(null);
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [replySaving, setReplySaving] = useState(false);
  const [replyMessage, setReplyMessage] = useState("");
  const [deletingReplyId, setDeletingReplyId] = useState(null);
  const [expandedReplies, setExpandedReplies] = useState(new Set());
  const [verifiedByUid, setVerifiedByUid] = useState({});
  const [namesByUid, setNamesByUid] = useState({});

  useEffect(() => {
    setLikeUids(new Set());
    setComments([]);
    setCommentsLoading(true);
    setCommentText("");
    setCommentMessage("");
    setReplyingToId(null);
    setReplyText("");
    setReplyMessage("");
    setExpandedReplies(new Set());
    setVerifiedByUid({});
    setNamesByUid({});

    if (!ready) { setCommentsLoading(false); return; }

    const fetch = async () => {
      try {
        const likesSnap = await getDocs(collection(db, ...docPath, "likes"));
        setLikeUids(new Set(likesSnap.docs.map((d) => d.id)));
      } catch (e) {
        console.error("Engagement likes fetch error:", e);
        setLikeUids(new Set());
      }

      try {
        const commentsSnap = await getDocs(query(collection(db, ...docPath, "comments"), orderBy("createdAt", "desc")));
        const baseComments = commentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Likes and replies both live one level deeper per comment — fetched
        // eagerly for every comment here (not lazily per-comment) so a reply
        // count is known up front for the collapsed "N replies" toggle
        // without a second round trip once someone clicks it.
        const [commentLikesSnaps, repliesSnaps] = await Promise.all([
          Promise.all(baseComments.map((c) => getDocs(collection(db, ...docPath, "comments", c.id, "likes")))),
          Promise.all(baseComments.map((c) => getDocs(query(collection(db, ...docPath, "comments", c.id, "replies"), orderBy("createdAt", "asc"))))),
        ]);

        const baseRepliesPerComment = repliesSnaps.map((snap, i) =>
          snap.docs.map((d) => ({ id: d.id, commentId: baseComments[i].id, ...d.data() }))
        );
        const allReplies = baseRepliesPerComment.flat();
        const replyLikesSnaps = await Promise.all(
          allReplies.map((r) => getDocs(collection(db, ...docPath, "comments", r.commentId, "replies", r.id, "likes")))
        );
        const replyLikedUidsById = new Map(
          allReplies.map((r, i) => [r.id, new Set(replyLikesSnaps[i].docs.map((d) => d.id))])
        );

        const enriched = baseComments.map((c, i) => ({
          ...c,
          likedUids: new Set(commentLikesSnaps[i].docs.map((d) => d.id)),
          replies: baseRepliesPerComment[i].map((r) => ({ ...r, likedUids: replyLikedUidsById.get(r.id) || new Set() })),
        }));
        setComments(enriched);

        const commentUids = [...new Set([
          ...enriched.map((c) => c.uid),
          ...enriched.flatMap((c) => c.replies.map((r) => r.uid)),
        ].filter(Boolean))];
        if (commentUids.length) {
          const userSnaps = await Promise.all(commentUids.map((uid) => getDoc(doc(db, "users", uid))));
          const vMap = {};
          const nMap = {};
          userSnaps.forEach((s, idx) => {
            vMap[commentUids[idx]] = !!(s.exists() && s.data().verified);
            const uname = s.exists() ? s.data().username?.trim() : "";
            if (uname) nMap[commentUids[idx]] = uname;
          });
          setVerifiedByUid(vMap);
          setNamesByUid(nMap);
        }
      } catch (e) {
        console.error("Engagement comments fetch error:", e);
        setComments([]);
      } finally {
        setCommentsLoading(false);
      }
    };
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey, ready]);

  const toggleLike = async () => {
    if (!user) { login(); return; }
    if (!ready) return;
    setLiking(true);
    const likeRef = doc(db, ...docPath, "likes", user.uid);
    const alreadyLiked = likeUids.has(user.uid);
    try {
      if (alreadyLiked) {
        await deleteDoc(likeRef);
        setLikeUids((prev) => { const next = new Set(prev); next.delete(user.uid); return next; });
      } else {
        await setDoc(likeRef, { uid: user.uid, createdAt: serverTimestamp() });
        setLikeUids((prev) => new Set(prev).add(user.uid));
      }
    } catch (e) {
      console.error("Toggle like error:", e);
    } finally {
      setLiking(false);
    }
  };

  const postComment = async () => {
    if (!user) { login(); return; }
    if (!ready) return;
    const text = commentText.trim();
    if (!text) { setCommentMessage("Write something first."); return; }
    if (containsProfanity(text)) { setCommentMessage("Comment contains inappropriate language."); return; }
    setCommentSaving(true);
    setCommentMessage("");
    try {
      const payload = {
        uid: user.uid,
        authorName: profile?.username?.trim() || "Anonymous Fan",
        text,
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, ...docPath, "comments"), payload);
      // Optimistic local prepend — serverTimestamp() doesn't resolve to a
      // real value until Firestore round-trips it back, so a plain Date
      // stands in until then.
      const now = new Date();
      setComments((prev) => [{ id: ref.id, ...payload, createdAt: { toDate: () => now }, likedUids: new Set(), replies: [] }, ...prev]);
      setCommentText("");
    } catch (e) {
      console.error("Post comment error:", e);
      setCommentMessage("Failed to post — try again.");
    } finally {
      setCommentSaving(false);
    }
  };

  const deleteComment = async (commentId) => {
    if (!window.confirm("Delete this comment? Its likes and replies go with it.")) return;
    setDeletingCommentId(commentId);
    try {
      const [likesSnap, repliesSnap] = await Promise.all([
        getDocs(collection(db, ...docPath, "comments", commentId, "likes")),
        getDocs(collection(db, ...docPath, "comments", commentId, "replies")),
      ]);
      const replyLikesSnaps = await Promise.all(
        repliesSnap.docs.map((d) => getDocs(collection(db, ...docPath, "comments", commentId, "replies", d.id, "likes")))
      );
      // Best-effort, not required to succeed: a non-admin author can only
      // delete their own like/reply docs (see firestore.rules), so someone
      // else's likes/replies on a comment they're deleting are left behind
      // as harmless orphans rather than blocking the comment delete below.
      await Promise.allSettled([
        ...likesSnap.docs.map((d) => deleteDoc(d.ref)),
        ...replyLikesSnaps.flatMap((snap) => snap.docs.map((d) => deleteDoc(d.ref))),
        ...repliesSnap.docs.map((d) => deleteDoc(d.ref)),
      ]);
      await deleteDoc(doc(db, ...docPath, "comments", commentId));
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (e) {
      console.error("Delete comment error:", e);
      alert("Failed to delete — check console.");
    } finally {
      setDeletingCommentId(null);
    }
  };

  const toggleCommentLike = async (comment) => {
    if (!user) { login(); return; }
    const alreadyLiked = comment.likedUids.has(user.uid);
    setLikingCommentId(comment.id);
    const likeRef = doc(db, ...docPath, "comments", comment.id, "likes", user.uid);
    try {
      if (alreadyLiked) {
        await deleteDoc(likeRef);
      } else {
        await setDoc(likeRef, { uid: user.uid, createdAt: serverTimestamp() });
      }
      setComments((prev) => prev.map((c) => {
        if (c.id !== comment.id) return c;
        const nextLiked = new Set(c.likedUids);
        if (alreadyLiked) nextLiked.delete(user.uid); else nextLiked.add(user.uid);
        return { ...c, likedUids: nextLiked };
      }));
    } catch (e) {
      console.error("Toggle comment like error:", e);
    } finally {
      setLikingCommentId(null);
    }
  };

  const postReply = async (commentId) => {
    if (!user) { login(); return; }
    const text = replyText.trim();
    if (!text) { setReplyMessage("Write something first."); return; }
    if (containsProfanity(text)) { setReplyMessage("Reply contains inappropriate language."); return; }
    setReplySaving(true);
    setReplyMessage("");
    try {
      const payload = {
        uid: user.uid,
        authorName: profile?.username?.trim() || "Anonymous Fan",
        text,
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, ...docPath, "comments", commentId, "replies"), payload);
      const now = new Date();
      const newReply = { id: ref.id, commentId, ...payload, createdAt: { toDate: () => now }, likedUids: new Set() };
      setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, replies: [...c.replies, newReply] } : c));
      // Opening the reply box already implied interest in this thread —
      // auto-expanding it means the reply someone just posted doesn't
      // vanish behind a still-collapsed "N replies" toggle.
      setExpandedReplies((prev) => new Set(prev).add(commentId));
      setReplyText("");
      setReplyingToId(null);
    } catch (e) {
      console.error("Post reply error:", e);
      setReplyMessage("Failed to post — try again.");
    } finally {
      setReplySaving(false);
    }
  };

  const deleteReply = async (commentId, replyId) => {
    if (!window.confirm("Delete this reply?")) return;
    setDeletingReplyId(replyId);
    try {
      const replyLikesSnap = await getDocs(collection(db, ...docPath, "comments", commentId, "replies", replyId, "likes"));
      await Promise.allSettled(replyLikesSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, ...docPath, "comments", commentId, "replies", replyId));
      setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, replies: c.replies.filter((r) => r.id !== replyId) } : c));
    } catch (e) {
      console.error("Delete reply error:", e);
      alert("Failed to delete — check console.");
    } finally {
      setDeletingReplyId(null);
    }
  };

  const toggleReplyLike = async (commentId, reply) => {
    if (!user) { login(); return; }
    const alreadyLiked = reply.likedUids.has(user.uid);
    setLikingReplyId(reply.id);
    const likeRef = doc(db, ...docPath, "comments", commentId, "replies", reply.id, "likes", user.uid);
    try {
      if (alreadyLiked) {
        await deleteDoc(likeRef);
      } else {
        await setDoc(likeRef, { uid: user.uid, createdAt: serverTimestamp() });
      }
      setComments((prev) => prev.map((c) => {
        if (c.id !== commentId) return c;
        return {
          ...c,
          replies: c.replies.map((r) => {
            if (r.id !== reply.id) return r;
            const nextLiked = new Set(r.likedUids);
            if (alreadyLiked) nextLiked.delete(user.uid); else nextLiked.add(user.uid);
            return { ...r, likedUids: nextLiked };
          }),
        };
      }));
    } catch (e) {
      console.error("Toggle reply like error:", e);
    } finally {
      setLikingReplyId(null);
    }
  };

  const toggleReplyBox = (commentId) => {
    setReplyMessage("");
    setReplyText("");
    setReplyingToId((prev) => (prev === commentId ? null : commentId));
  };

  const toggleRepliesExpanded = (commentId) => {
    setExpandedReplies((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId); else next.add(commentId);
      return next;
    });
  };

  return {
    user, profile, login,
    likeUids, liking, toggleLike,
    comments, commentsLoading,
    commentText, setCommentText, commentSaving, commentMessage, setCommentMessage, postComment,
    deleteComment, deletingCommentId,
    toggleCommentLike, likingCommentId,
    replyingToId, replyText, setReplyText, replySaving, replyMessage, setReplyMessage, postReply,
    deleteReply, deletingReplyId,
    toggleReplyLike, likingReplyId,
    expandedReplies, toggleReplyBox, toggleRepliesExpanded,
    verifiedByUid, namesByUid,
  };
}

// Same pill shape/colors as PlayerProfile.js's own hero-bar Like button
// (heart icon, white border, solid white fill once liked) — meant to sit
// in a page's own header/masthead bar, but works anywhere a `background`
// prop is passed matching whatever it's sitting on (defaults to the
// article/performance header's BLUE). "md" (the header-bar size, used by
// NewsArticle.jsx/PerformancePage.js) sized to actually read as a real
// button next to the date/author text there, not shrink into an icon;
// "sm" stays compact for EngagementSection's own comments-card header,
// tucked beside the comment-count pill.
export function LikeButton({ engagement, itemLabel = "this", size = "md" }) {
  const { user, likeUids, liking, toggleLike } = engagement;
  const iLiked = user ? likeUids.has(user.uid) : false;
  const likeCount = likeUids.size;
  const isSmall = size === "sm";
  return (
    <button
      onClick={toggleLike}
      disabled={liking}
      title={user ? (iLiked ? `Remove your like from ${itemLabel}` : `Like ${itemLabel}`) : `Sign in to like ${itemLabel}`}
      style={{
        display: "flex", alignItems: "center", gap: "8px",
        border: "2px solid #fff",
        background: iLiked ? "#fff" : "rgba(255,255,255,0.12)",
        color: iLiked ? "#ff4d6d" : "#fff",
        borderRadius: "999px", fontWeight: 900,
        fontSize: isSmall ? "12px" : "16px",
        padding: isSmall ? "5px 12px" : "9px 20px",
        cursor: liking ? "default" : "pointer",
        opacity: liking ? 0.7 : 1,
      }}
    >
      <span style={{ fontSize: isSmall ? "13px" : "19px", lineHeight: 1 }}>♥</span>
      {likeCount}
    </button>
  );
}

export default function EngagementSection({ docPath, engagement: externalEngagement, itemLabel = "this", commentsTitle = "💬 Comments", showLikeRow = true }) {
  // Only actually fetches when no externally-shared engagement was passed
  // in (docPath defaults to [] there, which useEngagement's own ready
  // check treats as inert) — avoids a second parallel fetch/state instance
  // for the same doc when a page already built one to feed its own
  // header-bar LikeButton.
  const ownEngagement = useEngagement(externalEngagement ? [] : (docPath || []));
  const engagement = externalEngagement || ownEngagement;
  const {
    comments, commentsLoading,
    commentText, setCommentText, commentSaving, commentMessage, setCommentMessage, postComment,
    deleteComment, deletingCommentId,
    toggleCommentLike, likingCommentId,
    replyingToId, replyText, setReplyText, replySaving, replyMessage, setReplyMessage, postReply,
    deleteReply, deletingReplyId,
    toggleReplyLike, likingReplyId,
    expandedReplies, toggleReplyBox, toggleRepliesExpanded,
    verifiedByUid, namesByUid,
    user, profile, login,
  } = engagement;

  return (
    <div style={{ marginTop: "28px" }}>
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: "12px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
          <h2 style={{ margin: 0, color: GOLD, fontWeight: 900, fontSize: "16px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {commentsTitle}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {showLikeRow && <LikeButton engagement={engagement} itemLabel={itemLabel} size="sm" />}
            <div style={{ color: "#fff", background: "rgba(255,255,255,0.18)", fontSize: "13px", fontWeight: 900, padding: "5px 14px", borderRadius: "20px" }}>
              {comments.length} comment{comments.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <div style={{ height: "3px", background: GOLD }} />
        <div style={{ padding: "18px 20px" }}>

          {user ? (
            <div style={{ marginBottom: "18px" }}>
              <textarea
                value={commentText}
                onChange={(e) => { setCommentText(e.target.value); setCommentMessage(""); }}
                placeholder="Share your thoughts..."
                rows={3}
                style={{ width: "100%", border: "2px solid #ddd", borderRadius: "8px", padding: "10px 12px", fontSize: "14px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", outline: "none" }}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: "8px", gap: "12px", flexWrap: "wrap" }}>
                {commentMessage && (
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#c0392b" }}>{commentMessage}</div>
                )}
                <button
                  onClick={postComment}
                  disabled={commentSaving || !commentText.trim()}
                  style={{
                    background: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
                    borderRadius: "8px", padding: "9px 20px", fontWeight: 900, fontSize: "13px",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                    cursor: commentSaving || !commentText.trim() ? "default" : "pointer",
                    opacity: commentSaving || !commentText.trim() ? 0.6 : 1,
                  }}
                >
                  {commentSaving ? "Posting..." : "Post Comment"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={login}
              style={{
                width: "100%", marginBottom: "18px", background: "#fff", color: BLUE, border: `2px solid ${BLUE}`,
                borderRadius: "8px", padding: "10px", fontWeight: 900, fontSize: "13px",
                textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
              }}
            >
              Sign In To Comment
            </button>
          )}

          {commentsLoading ? (
            <LoadingSpinner label="Loading comments" size={24} minHeight="60px" />
          ) : comments.length === 0 ? (
            <div style={{ textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>
              No comments yet — be the first to weigh in.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {comments.map((c, i) => {
                const canDelete = user && (user.uid === c.uid || profile?.role === "admin");
                const commentMs = toMs(c.createdAt);
                const iLikedComment = user ? c.likedUids.has(user.uid) : false;
                const isReplying = replyingToId === c.id;
                const repliesShown = expandedReplies.has(c.id);
                const commentAuthorName = namesByUid[c.uid] || c.authorName || "Anonymous Fan";
                return (
                  <div key={c.id} style={{ borderBottom: i < comments.length - 1 ? "1px solid #eee" : "none", paddingBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <span style={{ fontWeight: 900, fontSize: "13px", color: BLUE }}>{commentAuthorName}</span>
                        {verifiedByUid[c.uid] && (
                          <img src={verifiedBadge} alt="Verified" title="Verified" loading="lazy" style={{ width: "14px", height: "14px" }} />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
                          {commentMs > 0 ? new Date(commentMs).toLocaleString() : ""}
                        </div>
                        {canDelete && (
                          <button
                            onClick={() => deleteComment(c.id)}
                            disabled={deletingCommentId === c.id}
                            style={{ background: "none", border: "none", color: "#c0392b", cursor: deletingCommentId === c.id ? "default" : "pointer", fontSize: "11px", fontWeight: 800, textDecoration: "underline", padding: 0 }}
                          >
                            {deletingCommentId === c.id ? "…" : "Delete"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: "14px", color: "#333", lineHeight: 1.5, marginTop: "5px", whiteSpace: "pre-wrap" }}>
                      {c.text}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "8px" }}>
                      <button
                        onClick={() => toggleCommentLike(c)}
                        disabled={likingCommentId === c.id}
                        style={{
                          display: "flex", alignItems: "center", gap: "5px",
                          background: "none", border: "none", padding: 0,
                          color: iLikedComment ? GOLD : "#999", fontWeight: 800, fontSize: "12px",
                          cursor: likingCommentId === c.id ? "default" : "pointer",
                        }}
                      >
                        <span>👍</span>
                        {c.likedUids.size > 0 ? c.likedUids.size : "Like"}
                      </button>
                      <button
                        onClick={() => toggleReplyBox(c.id)}
                        style={{ background: "none", border: "none", padding: 0, color: "#999", fontWeight: 800, fontSize: "12px", cursor: "pointer" }}
                      >
                        {isReplying ? "Cancel" : "Reply"}
                      </button>
                      {c.replies.length > 0 && (
                        <button
                          onClick={() => toggleRepliesExpanded(c.id)}
                          style={{ background: "none", border: "none", padding: 0, color: BLUE, fontWeight: 800, fontSize: "12px", cursor: "pointer" }}
                        >
                          {repliesShown ? "▲ Hide" : "▼ View"} {c.replies.length} repl{c.replies.length !== 1 ? "ies" : "y"}
                        </button>
                      )}
                    </div>

                    {isReplying && (
                      <div style={{ marginTop: "10px", marginLeft: "24px" }}>
                        {user ? (
                          <>
                            <textarea
                              value={replyText}
                              onChange={(e) => { setReplyText(e.target.value); setReplyMessage(""); }}
                              placeholder={`Reply to ${commentAuthorName}...`}
                              rows={2}
                              autoFocus
                              style={{ width: "100%", border: "2px solid #ddd", borderRadius: "8px", padding: "8px 10px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", outline: "none" }}
                            />
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: "6px", gap: "10px", flexWrap: "wrap" }}>
                              {replyMessage && (
                                <div style={{ fontSize: "11px", fontWeight: 700, color: "#c0392b" }}>{replyMessage}</div>
                              )}
                              <button
                                onClick={() => postReply(c.id)}
                                disabled={replySaving || !replyText.trim()}
                                style={{
                                  background: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
                                  borderRadius: "6px", padding: "6px 16px", fontWeight: 900, fontSize: "11px",
                                  textTransform: "uppercase", letterSpacing: "0.04em",
                                  cursor: replySaving || !replyText.trim() ? "default" : "pointer",
                                  opacity: replySaving || !replyText.trim() ? 0.6 : 1,
                                }}
                              >
                                {replySaving ? "Posting..." : "Post Reply"}
                              </button>
                            </div>
                          </>
                        ) : (
                          <button
                            onClick={login}
                            style={{
                              background: "#fff", color: BLUE, border: `2px solid ${BLUE}`,
                              borderRadius: "6px", padding: "7px 14px", fontWeight: 900, fontSize: "11px",
                              textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
                            }}
                          >
                            Sign In To Reply
                          </button>
                        )}
                      </div>
                    )}

                    {repliesShown && c.replies.length > 0 && (
                      <div style={{ marginTop: "10px", marginLeft: "24px", display: "flex", flexDirection: "column", gap: "10px", borderLeft: "2px solid #eee", paddingLeft: "12px" }}>
                        {c.replies.map((r) => {
                          const canDeleteReply = user && (user.uid === r.uid || profile?.role === "admin");
                          const replyMs = toMs(r.createdAt);
                          const iLikedReply = user ? r.likedUids.has(user.uid) : false;
                          const replyAuthorName = namesByUid[r.uid] || r.authorName || "Anonymous Fan";
                          return (
                            <div key={r.id}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                  <span style={{ fontWeight: 900, fontSize: "12px", color: BLUE }}>{replyAuthorName}</span>
                                  {verifiedByUid[r.uid] && (
                                    <img src={verifiedBadge} alt="Verified" title="Verified" loading="lazy" style={{ width: "12px", height: "12px" }} />
                                  )}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <div style={{ fontSize: "10px", fontWeight: 700, color: "#aaa" }}>
                                    {replyMs > 0 ? new Date(replyMs).toLocaleString() : ""}
                                  </div>
                                  {canDeleteReply && (
                                    <button
                                      onClick={() => deleteReply(c.id, r.id)}
                                      disabled={deletingReplyId === r.id}
                                      style={{ background: "none", border: "none", color: "#c0392b", cursor: deletingReplyId === r.id ? "default" : "pointer", fontSize: "10px", fontWeight: 800, textDecoration: "underline", padding: 0 }}
                                    >
                                      {deletingReplyId === r.id ? "…" : "Delete"}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div style={{ fontSize: "13px", color: "#333", lineHeight: 1.45, marginTop: "3px", whiteSpace: "pre-wrap" }}>
                                {r.text}
                              </div>
                              <button
                                onClick={() => toggleReplyLike(c.id, r)}
                                disabled={likingReplyId === r.id}
                                style={{
                                  display: "flex", alignItems: "center", gap: "5px", marginTop: "5px",
                                  background: "none", border: "none", padding: 0,
                                  color: iLikedReply ? GOLD : "#999", fontWeight: 800, fontSize: "11px",
                                  cursor: likingReplyId === r.id ? "default" : "pointer",
                                }}
                              >
                                <span>👍</span>
                                {r.likedUids.size > 0 ? r.likedUids.size : "Like"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
