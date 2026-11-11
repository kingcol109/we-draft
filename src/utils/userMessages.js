// userMessages — admin → user replies (one doc per message). Written by the
// admin Requests section (AdminPanel.js) when a player request or issue
// report is resolved; read by the profile hub's Messages tab and counted
// into the Navbar's Profile sticker. See firestore.rules: the recipient can
// read their own, flip `read`, and delete; only admins create.
//
// Doc shape: { toUid, kind: "requestReply", source: "playerRequests" |
// "userReports", requestId, subject, original, message, outcome:
// "resolved" | "declined", createdAt, read }
import { collection, getDocs, query, where, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebase";

const toMs = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : 0);

// Only filters on toUid (no orderBy) so it needs no composite index; sorted
// newest first here.
export async function fetchUserMessages(uid) {
  const snap = await getDocs(query(collection(db, "userMessages"), where("toUid", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

export async function countUnreadMessages(uid) {
  const snap = await getDocs(query(collection(db, "userMessages"), where("toUid", "==", uid), where("read", "==", false)));
  return snap.size;
}

export const markMessagesRead = (ids) => Promise.all(ids.map((id) => updateDoc(doc(db, "userMessages", id), { read: true })));

export { toMs as messageTimeMs };
