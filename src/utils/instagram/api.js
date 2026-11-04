// src/utils/instagram/api.js
//
// The admin pages' calls to api/instagram.js (publishing from Admin →
// Content → Instagram, syncs from Instagram Analytics). The Instagram token
// never comes near the browser: this sends the admin's Firebase ID token,
// and the server does the rest.
import { auth } from "../../firebase";

export async function igApi(action, payload = {}) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/instagram", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error("the Instagram API isn't deployed here (it runs on the live site, or locally under `vercel dev`).");
  if (!r.ok) {
    // Meta's own errors carry its code and trace id — worth showing.
    const meta = j.meta?.code != null ? ` (Instagram error ${j.meta.code}${j.meta.subcode ? `/${j.meta.subcode}` : ""}${j.meta.fbtraceId ? ` · trace ${j.meta.fbtraceId}` : ""})` : "";
    throw Object.assign(new Error(`${j.error || `HTTP ${r.status}`}${meta}`), { status: r.status, code: j.code, permalink: j.permalink });
  }
  return j;
}

// A video clip from the admin's computer → { path, bytes }: the server opens
// an upload session in the private bucket (server/instagram/videos.js) and
// the file goes straight there, not through the API. onProgress(0–1).
export async function uploadVideo(file, onProgress) {
  const { path, uploadUrl } = await igApi("video-upload", { type: file.type, bytes: file.size });
  await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", uploadUrl);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`the upload failed (HTTP ${x.status}).`)));
    x.onerror = () => reject(new Error("the upload failed (network)."));
    x.send(file);
  });
  return igApi("video-done", { path });
}

// What a clip is, read in the browser before it's uploaded → { duration (s), w, h }.
export function videoInfo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata";
    v.onloadedmetadata = () => { resolve({ duration: v.duration, w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(url); };
    v.onerror = () => { reject(new Error("the browser can't read that video.")); URL.revokeObjectURL(url); };
    v.src = url;
  });
}
