// src/components/ThumbLibrary.jsx
//
// Saved YouTube thumbnails, in Admin → Videos → Graphics → Thumbnail
// (AdminYouTubeGraphics.jsx): save the one in the editor with its settings
// and metadata, open a saved one to edit it, and put it on the YouTube video
// it went up on, from the day it went up — so Thumb Analytics
// (AdminThumbAnalytics.jsx) can judge it by that video's impressions and
// click-through rate. Stored in ytThumbnails (utils/youtube/thumbStore.js).
// With King Cold Sports' edit connection (server/youtube-analytics/edit.js),
// Set on YouTube puts it on the video itself (a 1280×720 JPEG, under 2 MB) and
// the server records it as up on that video from then.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { BLUE, field, label, btn, linkBtn, svgToBlob } from "./SocialMakerKit";
import { loadThumbs, saveThumb, linkThumb, deleteThumb, dayOf } from "../utils/youtube/thumbStore";

async function ytApi(action, payload = {}) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/youtube-analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error("the YouTube API isn't deployed here (it runs on the live site, or locally under `vercel dev`)");
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code });
  return j;
}
// YouTube's thumbnail: 1280×720 JPEG under 2 MB → base64.
async function youtubeJpeg(svg) {
  for (const q of [0.92, 0.82, 0.7, 0.6]) {
    const blob = await svgToBlob(svg, "image/jpeg", q, 1280, 720);
    if (blob && blob.size <= 2e6) return (await readBlob(blob)).split(",")[1];
  }
  throw new Error("couldn't get it under YouTube's 2 MB limit");
}

const readBlob = (blob) => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = reject; fr.readAsDataURL(blob); });
const msOf = (v) => (v?.toMillis ? v.toMillis() : typeof v === "number" ? v : v ? Date.parse(v) || 0 : 0);

// The channel's videos, newest first: [{ id, title, publishedAt (ms) }].
let videosOnce = null;
export function loadYtVideoList() {
  if (!videosOnce) {
    videosOnce = getDocs(collection(db, "ytVideos")).then((s) => s.docs.map((d) => ({ id: d.id, title: d.data().yt?.title || d.id, publishedAt: msOf(d.data().yt?.publishedAt) }))
      .sort((a, b) => b.publishedAt - a.publishedAt)).catch((e) => { videosOnce = null; throw e; });
  }
  return videosOnce;
}

// current: what's in the editor — { template, templateName, label (a default
// name), playerId, playerName, school, position, eligible, headline, design,
// meta }; svg: its export SVG; onOpen(saved): load a saved one into the editor.
export default function ThumbLibrary({ current, svg, savedId, setSavedId, onOpen, setMsg }) {
  const { user } = useAuth();
  const [thumbs, setThumbs] = useState(null);
  const [videos, setVideos] = useState(null);
  const [open, setOpen] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [videoId, setVideoId] = useState("");
  const [since, setSince] = useState("");
  // King Cold Sports' edit connection (ytAnalytics/status.edit).
  const [edit, setEdit] = useState(null);
  const [pushing, setPushing] = useState(false);
  useEffect(() => {
    getDoc(doc(db, "ytAnalytics", "status")).then((s) => setEdit(s.data()?.edit || { connected: false })).catch(() => setEdit({ connected: false }));
    // Back from Google's sign-in.
    const q = new URLSearchParams(window.location.search);
    if (q.get("yte") === "connected") setMsg("King Cold Sports is connected: thumbnails can go straight onto its videos.");
    if (q.get("yte") === "error") setMsg(`Couldn't connect King Cold Sports: ${q.get("msg") || "unknown error"}`);
    if (q.get("yte")) {
      q.delete("yte");
      q.delete("msg");
      window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
    }
  }, [setMsg]);
  const connectEdit = () => ytApi("edit-connect").then((r) => { window.location.href = r.url; }).catch((e) => setMsg(`Couldn't start the sign-in: ${e.message}`));
  const disconnectEdit = () => {
    if (!window.confirm("Disconnect King Cold Sports' edit permission? Thumbnails won't go onto its videos from here until it's connected again.")) return;
    ytApi("edit-disconnect").then(() => setEdit({ connected: false })).catch((e) => setMsg(`Couldn't disconnect: ${e.message}`));
  };
  const reload = () => loadThumbs().then(setThumbs).catch((e) => { setThumbs([]); setMsg(`Couldn't load the saved thumbnails: ${e.message}`); });
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadYtVideoList().then(setVideos).catch(() => setVideos([])); }, []);
  const saved = thumbs?.find((t) => t.id === savedId) || null;
  // The open one's name and video, when it changes.
  useEffect(() => {
    setName(saved?.name || "");
    setVideoId(saved?.videoId || "");
    setSince(saved?.liveFrom ? dayOf(saved.liveFrom) : "");
  }, [savedId, thumbs?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const titleOf = useMemo(() => Object.fromEntries((videos || []).map((v) => [v.id, v.title])), [videos]);

  // → its id.
  const save = async (asNew) => {
    if (!svg || !current) return null;
    setBusy(true);
    try {
      const thumb = await readBlob(await svgToBlob(svg, "image/jpeg", 0.8, 480, 270));
      const data = { ...current, name: name.trim() || current.label, thumb };
      delete data.label;
      delete data.templateName;
      const id = await saveThumb(asNew ? null : savedId, asNew || !savedId ? { ...data, createdBy: user?.uid || "" } : data);
      setSavedId(id);
      await reload();
      setMsg(`Saved "${data.name}".`);
      return id;
    } catch (e) {
      setMsg(`Couldn't save it: ${e.message}`);
      return null;
    } finally {
      setBusy(false);
    }
  };
  // Onto the video, from now: saves it first (so what's on YouTube is what's saved), then the server sets it and records it.
  const pushToYouTube = async () => {
    if (!videoId) return;
    const title = titleOf[videoId] || videoId;
    if (!window.confirm(`Put this thumbnail on "${title}" on YouTube now? It replaces the one there.`)) return;
    setPushing(true);
    try {
      const id = await save(false);
      if (!id) return;
      const jpeg = await youtubeJpeg(svg);
      await ytApi("set-thumbnail", { videoId, jpeg, thumbId: id });
      await reload();
      setSince(dayOf(Date.now()));
      setMsg(`It's on "${title}" now. Thumb Analytics counts it from today.`);
    } catch (e) {
      setMsg(e.code === "edit_not_connected" || e.code === "edit_needs_reconnect" ? `${e.message}` : `Couldn't put it on YouTube: ${e.message}`);
      if (e.code === "edit_needs_reconnect") setEdit({ connected: false, needsReconnect: true });
    } finally {
      setPushing(false);
    }
  };
  const link = async () => {
    if (!savedId) return;
    const v = videos?.find((x) => x.id === videoId);
    // The day it went up: as picked, else the video's own publish day. Noon Pacific-ish, so the day stays the day.
    const day = since || (v?.publishedAt ? dayOf(v.publishedAt) : dayOf(Date.now()));
    try {
      await linkThumb(savedId, videoId, videoId ? new Date(`${day}T20:00:00Z`).getTime() : null);
      await reload();
      setMsg(videoId ? `On "${titleOf[videoId] || videoId}" from ${day}. Thumb Analytics counts its impressions from then.` : "Taken off its video.");
    } catch (e) { setMsg(`Couldn't link it: ${e.message}`); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete the saved thumbnail "${t.name}"?`)) return;
    await deleteThumb(t.id).catch((e) => setMsg(`Couldn't delete it: ${e.message}`));
    if (t.id === savedId) setSavedId(null);
    reload();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ ...label, marginBottom: 0, display: "flex", gap: "6px" }}>
          {savedId ? "Saved thumbnail" : "Save this thumbnail"}
          {saved && <span style={{ color: saved.videoId ? "#15803d" : "#8a97ab" }}>· {saved.videoId ? "on a video" : "not on a video yet"}</span>}
        </div>
        <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={current?.label || "Thumbnail"} />
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button style={{ ...btn(true), padding: "5px 14px" }} disabled={busy || !svg || !current} onClick={() => save(false)}>{savedId ? "Save changes" : "Save"}</button>
          {savedId && <button style={{ ...btn(false), padding: "5px 14px" }} disabled={busy} onClick={() => save(true)}>Save as new</button>}
          {savedId && <button style={{ ...linkBtn }} onClick={() => setSavedId(null)}>Start a new one</button>}
        </div>
        {savedId && (
          <div style={{ borderTop: "1px solid #eef1f5", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={label}>The video it&apos;s on (for Thumb Analytics)</div>
            <select style={field} value={videoId} onChange={(e) => setVideoId(e.target.value)}>
              <option value="">{videos ? "Not on a video" : "Loading the channel's videos…"}</option>
              {(videos || []).map((v) => <option key={v.id} value={v.id}>{v.title}{v.publishedAt ? ` · ${new Date(v.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</option>)}
            </select>
            {videoId && (
              <div style={{ display: "flex", gap: "6px", alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <div style={label}>Up on it since (blank = the video&apos;s publish day)</div>
                  <input type="date" style={field} value={since} onChange={(e) => setSince(e.target.value)} />
                </div>
              </div>
            )}
            {videoId && edit?.connected && (
              <button data-set-on-youtube style={{ ...btn(true), alignSelf: "flex-start", padding: "5px 14px", background: "#c4302b", borderColor: "#c4302b" }} disabled={pushing || busy || !svg} onClick={pushToYouTube}>
                {pushing ? "Putting it on YouTube…" : "Set on YouTube"}
              </button>
            )}
            <button style={{ ...btn(false), alignSelf: "flex-start", padding: "5px 14px" }} onClick={link} disabled={videoId === (saved?.videoId || "") && (!videoId || since === (saved?.liveFrom ? dayOf(saved.liveFrom) : ""))}>
              {videoId ? "Put it on this video" : "Take it off its video"}
            </button>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>
              {edit?.connected
                ? "Set on YouTube puts it on the video now and counts it from today. Put it on this video only records it (for one you uploaded in Studio). "
                : "Put it on this video records it, for one you uploaded in Studio. "}
              Swapped thumbnails on one video each get their own days: one ends when the next goes up.
            </div>
            {edit && !edit.connected && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", borderTop: "1px solid #eef1f5", paddingTop: "6px" }}>
                <span style={{ fontSize: "11px", fontWeight: 800, color: edit.needsReconnect ? "#a52a1e" : "#5b6b84" }}>
                  {edit.needsReconnect ? "King Cold Sports' edit permission expired." : "To set it on YouTube from here, connect King Cold Sports once."}
                </span>
                <button data-connect-edit style={{ ...btn(false), padding: "4px 12px" }} onClick={connectEdit}>Connect King Cold Sports</button>
              </div>
            )}
            {edit?.connected && (
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>
                Connected: {edit.channelTitle || "King Cold Sports"} (can edit its videos). <button style={{ ...linkBtn, fontSize: "11px" }} onClick={disconnectEdit}>Disconnect</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: "10px" }}>
        <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", width: "100%", alignItems: "center", border: "none", background: "none", padding: "8px 12px", cursor: "pointer" }}>
          <span style={{ ...label, marginBottom: 0 }}>Saved thumbnails{thumbs ? ` · ${thumbs.length}` : ""}</span>
          <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 900, color: BLUE }}>{open ? "Hide" : "Show"}</span>
        </button>
        {open && (
          <div style={{ padding: "0 12px 10px", display: "flex", gap: "10px", overflowX: "auto" }}>
            {!thumbs && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>Loading…</div>}
            {thumbs && !thumbs.length && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>None yet.</div>}
            {(thumbs || []).map((t) => (
              <div key={t.id} data-thumb={t.name} style={{ flex: "0 0 180px", border: `1px solid ${t.id === savedId ? BLUE : "#e3e8ef"}`, borderRadius: "8px", overflow: "hidden", background: "#f8fafc" }}>
                <button onClick={() => onOpen(t)} style={{ display: "block", width: "100%", border: "none", padding: 0, cursor: "pointer", background: "#0b1426" }}>
                  {t.thumb ? <img src={t.thumb} alt="" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block" }} /> : <div style={{ aspectRatio: "16 / 9" }} />}
                </button>
                <div style={{ padding: "5px 7px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 900, color: "#1d2433", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={t.name}>{t.name}</div>
                  <div style={{ fontSize: "10px", fontWeight: 800, color: t.videoId ? "#15803d" : "#8a97ab", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={titleOf[t.videoId] || ""}>
                    {t.videoId ? `▶ ${titleOf[t.videoId] || t.videoId}` : "Not on a video"}
                  </div>
                  <div style={{ display: "flex", marginTop: "3px" }}>
                    <button onClick={() => onOpen(t)} style={linkBtn}>Open</button>
                    <button onClick={() => remove(t)} style={{ ...linkBtn, marginLeft: "auto", color: "#a52a1e" }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
