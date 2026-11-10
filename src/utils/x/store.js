// src/utils/x/store.js
//
// xPosts in Firestore (admin only — firestore.rules): the composer's and the
// calendar's reads and writes. A post's images that aren't plain links are
// JPEG data URIs in xPosts/{id}/media/{mediaId}, one a doc, kept out of the post
// so the post stays small to list (Storage is closed to the browser; see
// server/x/README.md for how the publisher will read them).
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";

const POSTS = "xPosts";
// A Firestore doc holds 1 MiB; the image shrinks to fit well under it.
export const MEDIA_MAX_CHARS = 900 * 1024;

export async function loadXPosts(max = 60) {
  const snap = await getDocs(query(collection(db, POSTS), orderBy("updatedAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function loadXPost(id) {
  const d = await getDoc(doc(db, POSTS, id));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}
// A post's stored images → { [mediaId]: data URI }.
export async function loadXMedia(id) {
  const snap = await getDocs(collection(db, POSTS, id, "media"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data().data]));
}

// A post saved, with what its stored images have become.
// data: the post's fields; images: { [mediaId]: data URI } (only those to write);
// keep: the media ids it still uses (any other stored image is deleted).
export async function saveXPost(id, data, images = {}, keep = null) {
  const big = Object.entries(images).find(([, v]) => String(v).length > MEDIA_MAX_CHARS);
  if (big) throw new Error("An image is too large to save.");
  let ref;
  if (id) {
    ref = doc(db, POSTS, id);
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  } else {
    ref = await addDoc(collection(db, POSTS), { status: "draft", ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  for (const [mediaId, value] of Object.entries(images)) {
    await setDoc(doc(db, POSTS, ref.id, "media", mediaId), { data: value });
  }
  if (id && keep) {
    const stored = await getDocs(collection(db, POSTS, ref.id, "media"));
    await Promise.all(stored.docs.filter((d) => !keep.includes(d.id)).map((d) => deleteDoc(d.ref)));
  }
  return ref.id;
}

// The schedule. scheduledAt: ms. X isn't connected, so this is a date on the
// calendar and nothing goes out on its own (server/x/README.md).
export const scheduleXPost = (id, scheduledAt) => updateDoc(doc(db, POSTS, id), { status: "scheduled", scheduledAt, updatedAt: serverTimestamp() });
export const unscheduleXPost = (id) => updateDoc(doc(db, POSTS, id), { status: "draft", scheduledAt: deleteField(), updatedAt: serverTimestamp() });
export const markXPosted = (id) => updateDoc(doc(db, POSTS, id), { status: "posted", postedAt: serverTimestamp(), updatedAt: serverTimestamp() });
export const reopenXPost = (id) => updateDoc(doc(db, POSTS, id), { status: "draft", postedAt: deleteField(), scheduledAt: deleteField(), updatedAt: serverTimestamp() });

export async function deleteXPost(id) {
  const stored = await getDocs(collection(db, POSTS, id, "media"));
  const batch = writeBatch(db);
  stored.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, POSTS, id));
  await batch.commit();
}
