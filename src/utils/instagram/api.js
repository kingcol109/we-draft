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
