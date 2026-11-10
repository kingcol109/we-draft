// src/components/AdminX.jsx
//
// Admin → Content → X Posts: write a post for X, attach images, save it and
// put it on the Content Calendar. Modeled on Admin → Content → Instagram (the
// saved posts along the top, a post type, the maker on the left, the preview
// on the right), sharing its drawing tools (SocialMakerKit.jsx). Post types
// (POST_TYPES; a saved post's type opens it in its own maker):
//   Create a post     the default: text and up to four images.
//   Player highlight  a player's cut-up video: its We-Draft outline (the frame
//                     round the video, for Premiere) and its text, written for
//                     it (AdminXHighlight.jsx). The video's attached on X by hand.
//
// Not connected to X yet: nothing posts from here. A scheduled post is a time on
// the calendar; when it comes, the post says it's due, and is copied over by
// hand and marked posted. server/x/README.md says what the API phase adds.
//
// Images, up to four: the player card (drawn — utils/x/graphics.js), an upload,
// a pasted link, or a post's slides sent over from Instagram (a draft made by
// Send to X there). Data rules live in utils/x/posts.js, Firestore in utils/x/store.js.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { sanitizeImgur } from "./MarginAds";
import { BLUE, field, label, btn, linkBtn, fileName, fmtET, envFor, loadFeatureImage, svgToBlob, downloadSvg, shrinkToFit, thumbOf, focusFor, FOCUS, NO_ADJUST, PhotoAdjust, useDragAdjust, useSvgUrls, toLocalInput, fromLocalInput, nextHour, WhenPicker } from "./SocialMakerKit";
import { X_LIMIT, X_MAX_MEDIA, X_ALT_LIMIT, xLength, scheduleProblems } from "../utils/x/posts";
import { X_W, X_H, xCard, xCardInput, xCardImageUrls } from "../utils/x/graphics";
import { MEDIA_MAX_CHARS, loadXPosts, loadXPost, loadXMedia, saveXPost, scheduleXPost, unscheduleXPost, markXPosted, reopenXPost, deleteXPost } from "../utils/x/store";
import { msOf, PLATFORMS } from "../utils/contentCalendar/platforms";
import { HighlightSection } from "./AdminXHighlight";
import WdLogo from "../assets/Logo2.png";

const STATUS = {
  draft: ["Draft", "#8a97ab"], scheduled: ["Scheduled", "#6d28d9"], posted: ["Posted", "#15803d"],
  // Reserved for the publisher (server/x/README.md).
  publishing: ["Publishing", BLUE], published: ["Published", "#15803d"], failed: ["Failed", "#a52a1e"],
};
const CARD_ID = "card";
const POST_TYPES = { post: "Create a post", highlight: "Player highlight" };
const typeOf = (p) => (p?.type && POST_TYPES[p.type] ? p.type : "post");
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const readBlob = (blob) => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = reject; fr.readAsDataURL(blob); });
const svgDataUri = async (svg, w, h) => readBlob(await svgToBlob(svg, "image/jpeg", 0.92, w, h));

// ── Saved posts ──
function SavedXPosts({ version, onOpen, setMsg }) {
  const [posts, setPosts] = useState(null);
  const [open, setOpen] = useState(true);
  const [mine, setMine] = useState(0);
  useEffect(() => {
    loadXPosts().then(setPosts).catch((e) => { setPosts([]); setMsg(`Couldn't load the saved posts: ${e.message}`); });
  }, [version, mine, setMsg]);
  const remove = async (p) => {
    if (!window.confirm(`Delete the saved post "${p.name}"?`)) return;
    await deleteXPost(p.id);
    setMine((n) => n + 1);
  };
  return (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "10px", background: "#fff" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", width: "100%", alignItems: "center", gap: "8px", border: "none", background: "none", padding: "8px 12px", cursor: "pointer" }}>
        <span style={{ ...label, marginBottom: 0 }}>Saved X posts{posts ? ` · ${posts.length}` : ""}</span>
        <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 900, color: BLUE }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px" }}>
          {!posts && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>Loading…</div>}
          {posts && !posts.length && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>None yet. Write one below and save it.</div>}
          <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "4px" }}>
            {(posts || []).map((p) => {
              const s = p.status || "draft";
              const when = msOf(p.scheduledAt);
              const due = s === "scheduled" && when <= Date.now();
              return (
                <div key={p.id} data-xpost={p.name} style={{ flex: "0 0 190px", border: "1px solid #e3e8ef", borderRadius: "8px", background: "#f8fafc", overflow: "hidden" }}>
                  <button onClick={() => onOpen(p)} title="Open to edit" style={{ display: "block", width: "100%", border: "none", padding: 0, cursor: "pointer", background: "#0b1426", height: "90px" }}>
                    {p.thumb
                      ? <img src={p.thumb} alt="" style={{ width: "100%", height: "90px", objectFit: "cover", display: "block" }} />
                      : <div style={{ padding: "8px", fontSize: "11px", fontWeight: 700, color: "#fff", textAlign: "left", overflow: "hidden", height: "74px" }}>{p.text}</div>}
                  </button>
                  <div style={{ padding: "5px 7px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 900, color: "#1d2433", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</div>
                    <div style={{ fontSize: "10px", fontWeight: 800, color: "#8a97ab" }}>{POST_TYPES[typeOf(p)]}</div>
                    <div style={{ fontSize: "11px", fontWeight: 900, color: due ? "#b7791f" : STATUS[s]?.[1] || "#8a97ab", marginTop: "2px" }}>{due ? "Due: post by hand" : STATUS[s]?.[0] || s}</div>
                    {s === "scheduled" && <div style={{ fontSize: "10px", fontWeight: 800, color: "#5b6b84" }}>{fmtET(when)}</div>}
                    <div style={{ display: "flex", marginTop: "3px" }}>
                      <button onClick={() => onOpen(p)} style={linkBtn}>Open</button>
                      <button onClick={() => remove(p).catch((er) => setMsg(`Couldn't delete it: ${er.message}`))} style={{ ...linkBtn, marginLeft: "auto", color: "#a52a1e" }}>Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── The post as it'll read ──
function XPreview({ text, media }) {
  const shown = media.filter((m) => m.href);
  const grid = shown.length === 1 ? "1fr" : "1fr 1fr";
  return (
    <div style={{ border: "1px solid #d5dce6", borderRadius: "14px", background: "#fff", padding: "12px 14px", maxWidth: "560px", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", gap: "10px" }}>
        <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "#0b1426", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <img src={WdLogo} alt="" style={{ width: "36px" }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "14px" }}><b>We-Draft.com</b> <span style={{ color: "#6b7785" }}>@WeDraftSite</span></div>
          <div style={{ fontSize: "15px", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "2px", color: "#0f1419", minHeight: "20px" }}>{text || <span style={{ color: "#aab4c0" }}>Your post…</span>}</div>
          {shown.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: grid, gap: "2px", marginTop: "10px", borderRadius: "14px", overflow: "hidden", border: "1px solid #e3e8ef" }}>
              {shown.map((m, i) => (
                <img key={m.id} src={m.href} alt={m.alt || ""} style={{ width: "100%", display: "block", objectFit: "cover", aspectRatio: shown.length === 1 ? undefined : "16 / 9", gridRow: shown.length === 3 && i === 0 ? "span 2" : undefined, height: shown.length === 3 && i === 0 ? "100%" : undefined }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── The player card's controls and drawing ──
const BLANK_CARD = { on: false, playerId: "", photoUrl: "", focus: "center", kicker: "", adjust: NO_ADJUST, chips: [{ value: "", label: "" }, { value: "", label: "" }, { value: "", label: "" }] };

export default function AdminX({ open = null }) {
  const [msg, setMsg] = useState("");
  const [version, setVersion] = useState(0);
  // A count that starts the composer over when a post's opened or New is picked.
  const [run, setRun] = useState(0);
  const [opened, setOpened] = useState(null);
  const [type, setType] = useState("post");
  const start = (post = null, nextType = null) => {
    setOpened(post);
    if (post) setType(typeOf(post));
    else if (nextType) setType(nextType);
    setRun((n) => n + 1);
    setMsg("");
  };
  // Sent here from another tab (the calendar, Send to X): { id } or { date }.
  const [startDate, setStartDate] = useState("");
  useEffect(() => {
    if (!open) return;
    if (open.id) loadXPost(open.id).then((p) => { if (p) start(p); else setMsg("That post is gone."); }).catch((e) => setMsg(`Couldn't open it: ${e.message}`));
    else { setStartDate(open.date || ""); start(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ border: "1px solid #f3d9a4", background: "#fff8ea", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: 800, color: "#8a5a00" }}>
        X isn&apos;t connected yet: nothing posts from here on its own. Scheduling puts a post on the Content Calendar; when its time comes, copy it to X and mark it posted.
      </div>
      <SavedXPosts version={version} onOpen={start} setMsg={setMsg} />
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <div style={{ ...label, marginBottom: 0 }}>Post type</div>
        <select value={type} data-x-type onChange={(e) => { setStartDate(""); start(null, e.target.value); }} style={{ ...field, width: "auto", minWidth: "190px" }}>
          {Object.entries(POST_TYPES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        {opened && <span style={{ fontSize: "12px", fontWeight: 800, color: "#5b6b84" }}>Editing &ldquo;{opened.name}&rdquo;</span>}
        <button onClick={() => { setStartDate(""); start(null); }} style={{ ...btn(!opened), padding: "6px 14px" }}>New {type === "post" ? "post" : POST_TYPES[type].toLowerCase()}</button>
      </div>
      <Composer key={run} type={type} saved={opened} startDate={startDate} setMsg={setMsg} onSaved={() => setVersion((v) => v + 1)} onSavedPost={setOpened} />
      {msg && <div data-x-msg style={{ fontSize: "12px", fontWeight: 800, color: /^Couldn't|^No |^Fix/.test(msg) ? "#a52a1e" : "#15803d" }}>{msg}</div>}
    </div>
  );
}

function Composer({ type = "post", saved, startDate, setMsg, onSaved, onSavedPost }) {
  const { user } = useAuth();
  const hl = type === "highlight";
  // Player highlight: what its maker reports (AdminXHighlight.jsx), and
  // whether the text's been typed over (then it stops following the player).
  const [hlOut, setHlOut] = useState(null);
  const [touched, setTouched] = useState(!!saved);
  const [post, setPost] = useState(saved ? { id: saved.id, status: saved.status || "draft", scheduledAt: msOf(saved.scheduledAt) } : null);
  const [name, setName] = useState(saved?.name || "");
  const [text, setText] = useState(saved?.text || "");
  const [busy, setBusy] = useState("");
  // Images other than the card: { id, kind, url?, href, alt, w, h, fresh (not yet stored) }.
  const [media, setMedia] = useState(() => (saved?.media || []).filter((m) => m.kind !== "card").map((m) => ({ ...m, href: m.url || "", fresh: false })));
  const [linkInput, setLinkInput] = useState("");
  const [links, setLinks] = useState(saved?.linkedTo || []);
  const [when, setWhen] = useState(() => (startDate ? toLocalInput(new Date(`${startDate}T12:00:00`).getTime()) : ""));

  // A saved post's stored images.
  useEffect(() => {
    if (!saved?.id) return;
    loadXMedia(saved.id).then((stored) => setMedia((list) => list.map((m) => (stored[m.id] ? { ...m, href: stored[m.id] } : m))))
      .catch((e) => setMsg(`Couldn't load its images: ${e.message}`));
  }, [saved?.id, setMsg]);

  // ── The player card ──
  const [card, setCard] = useState({ ...BLANK_CARD, ...(saved?.card || {}) });
  const setC = (patch) => setCard((c) => ({ ...c, ...patch }));
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState(null);
  const [school, setSchool] = useState({});
  const [shots, setShots] = useState([]);
  const [cardSvg, setCardSvg] = useState("");
  const [cardHref, setCardHref] = useState("");
  const setAdjust = (fn) => setCard((c) => ({ ...c, adjust: typeof fn === "function" ? fn(c.adjust) : fn }));
  const drag = useDragAdjust(setAdjust, X_W);
  useEffect(() => {
    if (!card.on || players) return;
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [card.on, players, setMsg]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 10);
  }, [players, search]);
  const pickPlayer = async (p, restore = false) => {
    setSearch("");
    try {
      const [schoolSnap, photoSnap] = await Promise.all([
        getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))),
        getDoc(doc(db, "playerPhotos", p.id)),
      ]);
      const action = photoSnap.exists() ? photoSnap.data().action || [] : [];
      setPlayer(p);
      setSchool(schoolSnap.docs[0]?.data() || {});
      setShots(action);
      if (!restore) setC({ playerId: p.id, photoUrl: action[0]?.url || "", focus: focusFor(action[0]), adjust: NO_ADJUST, kicker: card.kicker || `${p.Eligible ? `${p.Eligible} ` : ""}NFL DRAFT PROSPECT` });
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };
  useEffect(() => {
    if (!saved?.card?.playerId) return;
    getDoc(doc(db, "players", saved.card.playerId)).then((d) => { if (d.exists()) pickPlayer({ id: d.id, ...d.data() }, true); })
      .catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cardInput = useMemo(() => (card.on && player ? xCardInput({ player, school, photo: card.photoUrl ? { url: card.photoUrl } : null, kicker: card.kicker, chips: card.chips, brandLogo: WdLogo, focus: card.focus, adjust: card.adjust }) : null), [card, player, school]);
  useEffect(() => {
    if (!cardInput) { setCardSvg(""); setCardHref(""); return; }
    let live = true;
    envFor(cardInput, cardInput.photo ? { [cardInput.photo]: loadFeatureImage(cardInput.photo, true) } : {}, xCardImageUrls(cardInput)).then((env) => {
      if (!live) return;
      setCardSvg(xCard(cardInput, env));
      if (cardInput.photo && !env.images[cardInput.photo]) setMsg("Couldn't load that photo — it may not allow downloads (try an imgur link).");
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [cardInput, setMsg]);
  const svgs = useMemo(() => (cardSvg ? [cardSvg] : []), [cardSvg]);
  const [cardUrl] = useSvgUrls(svgs);
  useEffect(() => { setCardHref(cardUrl || ""); }, [cardUrl]);

  // The highlight's text follows its player until it's typed over.
  useEffect(() => { if (hl && !touched && hlOut?.text) setText(hlOut.text); }, [hl, touched, hlOut?.text]);

  // ── Images ──
  const cardAlt = card.alt ?? "";
  // A highlight posts a video (attached on X by hand), so it has no images; its preview shows the outline.
  const allMedia = hl ? [] : [...(card.on && cardHref ? [{ id: CARD_ID, kind: "card", href: cardHref, alt: cardAlt, w: X_W, h: X_H }] : []), ...media];
  const previewMedia = hl ? (hlOut?.previewHref ? [{ id: "hl", kind: "highlight", href: hlOut.previewHref, alt: "" }] : []) : allMedia;
  const room = X_MAX_MEDIA - allMedia.length;
  const fileRef = useRef(null);
  const addFiles = async (files) => {
    for (const file of [...files].slice(0, Math.max(0, room))) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setMsg("X posts here take JPEG, PNG or WebP images."); continue; }
      try {
        const url = URL.createObjectURL(file);
        const { data, w, h } = await shrinkToFit(url, MEDIA_MAX_CHARS);
        URL.revokeObjectURL(url);
        setMedia((list) => [...list, { id: newId(), kind: "upload", href: data, alt: "", w, h, fresh: true }]);
      } catch (e) {
        setMsg(`Couldn't use ${file.name}: ${e.message}`);
      }
    }
  };
  const addLink = () => {
    const u = sanitizeImgur(linkInput.trim()) || linkInput.trim();
    if (!/^https:\/\//i.test(u)) { setMsg("Fix the link: paste an https:// image link."); return; }
    if (room <= 0) return;
    setMedia((list) => [...list, { id: newId(), kind: "link", url: u, href: u, alt: "", fresh: false }]);
    setLinkInput("");
  };
  const setAlt = (id, alt) => {
    if (id === CARD_ID) setC({ alt });
    else setMedia((list) => list.map((m) => (m.id === id ? { ...m, alt } : m)));
  };
  const moveMedia = (k, d) => setMedia((vs) => { const n = [...vs]; [n[k], n[k + d]] = [n[k + d], n[k]]; return n; });

  // ── Links to the same content elsewhere ──
  const [igOptions, setIgOptions] = useState(null);
  const [ytOptions, setYtOptions] = useState(null);
  const loadLinkOptions = () => {
    if (igOptions) return;
    getDocs(query(collection(db, "instagramPosts"), orderBy("updatedAt", "desc"), limit(40))).then((s) => setIgOptions(s.docs.map((d) => ({ id: d.id, label: d.data().name || d.id })))).catch(() => setIgOptions([]));
    getDocs(query(collection(db, "videos"), orderBy("Date", "desc"), limit(40))).then((s) => setYtOptions(s.docs.map((d) => ({ id: d.id, label: d.data().GenTitle || d.id })))).catch(() => setYtOptions([]));
  };
  const addLinkTo = (value) => {
    if (!value) return;
    const [platform, id] = value.split("|");
    const opt = (platform === "instagram" ? igOptions : ytOptions)?.find((o) => o.id === id);
    setLinks((ls) => (ls.some((l) => l.platform === platform && l.id === id) ? ls : [...ls, { platform, id, label: opt?.label || id }]));
  };

  // ── Saving ──
  const status = post?.status || "draft";
  const isPosted = status === "posted" || status === "published";
  const shownName = name || (hl && hlOut?.name) || (text.trim() ? text.trim().slice(0, 40) : "X post");
  const n = xLength(text);
  const over = n > X_LIMIT;

  // → the post's id.
  const save = async (asNew = false) => {
    if (hl) return saveHighlight(asNew);
    const stored = {};
    const docMedia = [];
    if (card.on && cardSvg) {
      const uri = await svgDataUri(cardSvg, X_W, X_H);
      const { data } = await shrinkToFit(uri, MEDIA_MAX_CHARS);
      stored[CARD_ID] = data;
      docMedia.push({ id: CARD_ID, kind: "card", alt: cardAlt, w: X_W, h: X_H });
    }
    media.forEach((m) => {
      if (m.href?.startsWith("data:") && (m.fresh || asNew)) stored[m.id] = m.href;
      docMedia.push({ id: m.id, kind: m.kind, ...(m.url ? { url: m.url } : {}), alt: m.alt || "", ...(m.w ? { w: m.w, h: m.h } : {}) });
    });
    const first = allMedia[0]?.href;
    const data = {
      type: "post", name: shownName, text, media: docMedia, card: card.on ? { ...card } : { on: false },
      thumb: first ? await thumbOf(first) : "",
      playerIds: [...new Set([card.on ? card.playerId : null].filter(Boolean))],
      subject: card.on && card.playerId ? { kind: "player", playerId: card.playerId } : null,
      linkedTo: links,
    };
    const existing = asNew ? null : post?.id || null;
    const id = await saveXPost(existing, existing ? data : { ...data, createdBy: user?.uid || "" }, stored, docMedia.map((m) => m.id));
    setMedia((list) => list.map((m) => ({ ...m, fresh: false })));
    const nextStatus = asNew ? "draft" : status;
    setPost({ id, status: nextStatus, scheduledAt: asNew ? null : post?.scheduledAt ?? null });
    onSavedPost({ id, ...data, status: nextStatus });
    return id;
  };
  // A highlight: its text, its outline's settings (drawn again when it's
  // opened) and a thumbnail of the outline; no images.
  const saveHighlight = async (asNew) => {
    if (!hlOut?.playerId) throw new Error("pick a player first");
    const data = {
      type: "highlight", name: shownName, text, media: [], card: { on: false }, highlight: hlOut.state,
      thumb: hlOut.previewHref ? await thumbOf(hlOut.previewHref) : "",
      playerIds: [hlOut.playerId], subject: { kind: "player", playerId: hlOut.playerId }, linkedTo: links,
    };
    const existing = asNew ? null : post?.id || null;
    const id = await saveXPost(existing, existing ? data : { ...data, createdBy: user?.uid || "" }, {}, []);
    const nextStatus = asNew ? "draft" : status;
    setPost({ id, status: nextStatus, scheduledAt: asNew ? null : post?.scheduledAt ?? null });
    onSavedPost({ id, ...data, status: nextStatus });
    return id;
  };
  const run = async (phase, fn) => {
    setBusy(phase);
    setMsg("");
    try { await fn(); onSaved(); } catch (e) { setMsg(`Couldn't ${phase.toLowerCase().replace(/…$/, "")}: ${e.message}`); } finally { setBusy(""); }
  };
  const saveClick = (asNew) => {
    if (over) { setMsg(`Fix the text first: it's ${n} characters and X takes ${X_LIMIT}.`); return; }
    run("Save…", async () => { await save(asNew); setMsg(`Saved "${shownName}".`); });
  };
  const scheduleIt = () => {
    const at = fromLocalInput(when);
    const problems = scheduleProblems({ text, media: allMedia, scheduledAt: at });
    if (hl && !hlOut?.playerId) problems.unshift("Pick the highlight's player.");
    if (problems.length) { setMsg(`Fix this first: ${problems[0]}`); return; }
    run("Schedule…", async () => {
      const id = await save(false);
      await scheduleXPost(id, at);
      setPost({ id, status: "scheduled", scheduledAt: at });
      setWhen("");
      setMsg(`On the calendar for ${fmtET(at)}. X isn't connected: post it by hand then.`);
    });
  };
  const unschedule = () => run("Unschedule…", async () => {
    await unscheduleXPost(post.id);
    setPost({ ...post, status: "draft", scheduledAt: null });
    setMsg("Back to a draft; it's off the calendar.");
  });
  const markPosted = () => run("Mark posted…", async () => {
    const id = await save(false);
    await markXPosted(id);
    setPost({ id, status: "posted", scheduledAt: post?.scheduledAt ?? null });
    setMsg("Marked as posted.");
  });
  const reopen = () => run("Reopen…", async () => {
    await reopenXPost(post.id);
    setPost({ ...post, status: "draft", scheduledAt: null });
    setMsg("Back to a draft.");
  });
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const download = (m, i) => {
    const base = `wedraft-x-${fileName(shownName)}-${i + 1}`;
    if (m.kind === "card") { downloadSvg(cardSvg, base, X_W, X_H).catch((e) => setMsg(`Couldn't export: ${e.message}`)); return; }
    const a = document.createElement("a");
    a.href = m.href;
    a.download = `${base}.jpg`;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.click();
  };
  const dueNow = status === "scheduled" && post?.scheduledAt <= Date.now();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 420px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <div style={{ ...label, display: "flex", alignItems: "center" }}>
            Post
            <button onClick={copy} disabled={!text} style={{ ...linkBtn, marginLeft: "auto" }}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setTouched(true); }} rows={hl ? 8 : 6} placeholder="What's happening on the board?" data-x-text style={{ ...field, fontWeight: 600, fontFamily: "Arial, sans-serif", resize: "vertical" }} />
          <div style={{ display: "flex", alignItems: "center" }}>
            {hl && touched && hlOut?.text && <button onClick={() => { setTouched(false); setText(hlOut.text); }} style={linkBtn}>Rewrite it for the player</button>}
            <div data-x-count style={{ fontSize: "11px", fontWeight: 900, marginLeft: "auto", color: over ? "#a52a1e" : n > X_LIMIT - 20 ? "#b7791f" : "#8a97ab" }}>{n} / {X_LIMIT}</div>
          </div>
        </div>

        {hl && <HighlightSection initial={saved?.highlight} onUpdate={setHlOut} setMsg={setMsg} />}

        {!hl && <div>
          <div style={label}>Images · up to {X_MAX_MEDIA}</div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
            <input type="checkbox" checked={card.on} onChange={(e) => setC({ on: e.target.checked })} disabled={!card.on && room <= 0} /> Player card ({X_W}×{X_H})
          </label>
          {card.on && (
            <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc", marginTop: "6px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ position: "relative" }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} data-x-player placeholder={players ? (player ? `${player.First} ${player.Last} — search another…` : "Search a prospect…") : "Loading players…"} style={field} />
                {matches.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "220px", overflowY: "auto" }}>
                    {matches.map((p) => (
                      <button key={p.id} onClick={() => pickPlayer(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                        {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {player && (
                <>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {shots.map((a, i) => (
                      <button key={a.url} onClick={() => setC({ photoUrl: a.url, focus: focusFor(a), adjust: NO_ADJUST })} title={`Action shot ${i + 1}`}
                        style={{ border: `2px solid ${card.photoUrl === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "54px", height: "68px" }}>
                        <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
                      </button>
                    ))}
                    <button onClick={() => setC({ photoUrl: "" })} style={{ border: `2px solid ${!card.photoUrl ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", cursor: "pointer", width: "54px", height: "68px", fontSize: "9px", fontWeight: 900, color: "#5b6b84" }}>NO PHOTO</button>
                  </div>
                  <input value={card.photoUrl} onChange={(e) => setC({ photoUrl: e.target.value, adjust: NO_ADJUST })} placeholder="Or any image link…" style={field} />
                  {card.photoUrl && (
                    <>
                      <div style={{ display: "flex", gap: "4px" }}>{FOCUS.map(([v, t]) => <button key={v} onClick={() => setC({ focus: v })} style={{ ...btn(card.focus === v), padding: "4px 10px" }}>{t}</button>)}</div>
                      <PhotoAdjust value={card.adjust} onChange={(v) => setC({ adjust: v })} />
                    </>
                  )}
                  <div><div style={label}>Kicker (blank for none)</div><input value={card.kicker} onChange={(e) => setC({ kicker: e.target.value })} style={field} /></div>
                  <div>
                    <div style={label}>Chips · up to three</div>
                    {card.chips.map((c, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "6px", marginBottom: "5px" }}>
                        <input value={c.value} onChange={(e) => setC({ chips: card.chips.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder="Value — #3 TE" style={field} />
                        <input value={c.label} onChange={(e) => setC({ chips: card.chips.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label — 2029 CLASS" style={field} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {allMedia.map((m, i) => (
            <div key={m.id} style={{ display: "grid", gridTemplateColumns: "54px 1fr auto", gap: "8px", alignItems: "center", marginTop: "6px" }}>
              <img src={m.href} alt="" style={{ width: "54px", height: "36px", objectFit: "cover", borderRadius: "4px", border: "1px solid #d5dce6", background: "#0b1426" }} />
              <input value={m.alt || ""} maxLength={X_ALT_LIMIT} onChange={(e) => setAlt(m.id, e.target.value)} placeholder={`Image ${i + 1} description (alt text)`} style={{ ...field, fontSize: "12px" }} />
              <span style={{ whiteSpace: "nowrap" }}>
                {m.kind !== "card" && media.indexOf(m) > 0 && <button onClick={() => moveMedia(media.indexOf(m), -1)} style={linkBtn}>↑</button>}
                {m.kind !== "card" && media.indexOf(m) < media.length - 1 && <button onClick={() => moveMedia(media.indexOf(m), 1)} style={linkBtn}>↓</button>}
                <button onClick={() => download(m, i)} style={linkBtn} title="Download it, to attach on X">⬇</button>
                {m.kind === "card"
                  ? <button onClick={() => setC({ on: false })} style={{ ...linkBtn, color: "#a52a1e" }}>✕</button>
                  : <button onClick={() => setMedia((l) => l.filter((x) => x.id !== m.id))} style={{ ...linkBtn, color: "#a52a1e" }}>✕</button>}
              </span>
            </div>
          ))}
          {room > 0 && (
            <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center" }}>
              <label style={{ ...btn(false), display: "inline-block", padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
                + Upload
                <input ref={fileRef} type="file" data-x-file accept="image/jpeg,image/png,image/webp" multiple style={{ display: "none" }} onChange={(e) => { const f = e.target.files; addFiles(f).finally(() => { if (fileRef.current) fileRef.current.value = ""; }); }} />
              </label>
              <input value={linkInput} onChange={(e) => setLinkInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLink(); }} placeholder="Or paste an image link…" style={field} />
              <button onClick={addLink} disabled={!linkInput.trim()} style={{ ...btn(false), padding: "5px 12px" }}>Add</button>
            </div>
          )}
        </div>}

        <div onFocus={loadLinkOptions} onMouseEnter={loadLinkOptions}>
          <div style={label}>Goes with · the same content elsewhere (optional)</div>
          {links.map((l) => (
            <div key={`${l.platform}|${l.id}`} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#33415a", marginBottom: "3px" }}>
              <span style={{ background: PLATFORMS[l.platform]?.color, color: "#fff", borderRadius: "4px", padding: "1px 5px", fontSize: "10px" }}>{PLATFORMS[l.platform]?.tag}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label}</span>
              <button onClick={() => setLinks((ls) => ls.filter((x) => x !== l))} style={{ ...linkBtn, color: "#a52a1e" }}>✕</button>
            </div>
          ))}
          <select value="" onChange={(e) => addLinkTo(e.target.value)} style={field} data-x-link>
            <option value="">Link an Instagram post or YouTube video…</option>
            {igOptions?.length > 0 && <optgroup label="Instagram">{igOptions.map((o) => <option key={o.id} value={`instagram|${o.id}`}>{o.label}</option>)}</optgroup>}
            {ytOptions?.length > 0 && <optgroup label="YouTube">{ytOptions.map((o) => <option key={o.id} value={`youtube|${o.id}`}>{o.label}</option>)}</optgroup>}
          </select>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", marginTop: "3px" }}>Each keeps its own text, images and time; the calendar shows them together.</div>
        </div>

        <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc" }}>
          <div style={{ ...label, display: "flex", gap: "6px" }}>
            {post?.id ? "Saved post" : "Save this post"}
            {post?.id && <span data-x-status style={{ color: dueNow ? "#b7791f" : STATUS[status]?.[1] }}>· {dueNow ? "Due: post by hand" : STATUS[status]?.[0] || status}</span>}
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={shownName} style={field} data-x-name />
          <div style={{ display: "flex", gap: "6px", marginTop: "6px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => saveClick(false)} disabled={!!busy} style={{ ...btn(true), padding: "5px 14px", opacity: busy ? 0.5 : 1 }}>{post?.id ? "Save changes" : "Save"}</button>
            {post?.id && <button onClick={() => saveClick(true)} disabled={!!busy} style={{ ...btn(false), padding: "5px 14px" }}>Save as new</button>}
            {!isPosted && !when && (
              <button onClick={() => setWhen(toLocalInput(post?.scheduledAt && post.scheduledAt > Date.now() ? post.scheduledAt : nextHour()))} disabled={!!busy} style={{ ...btn(false), padding: "5px 14px" }}>{status === "scheduled" ? "Change time…" : "Schedule…"}</button>
            )}
            {status === "scheduled" && <button onClick={unschedule} disabled={!!busy} style={{ ...btn(false), padding: "5px 14px", color: "#a52a1e" }}>Unschedule</button>}
            {post?.id && !isPosted && <button onClick={markPosted} disabled={!!busy} style={{ ...btn(false), padding: "5px 14px" }} title="You've posted it on X yourself">Mark posted</button>}
            {status === "posted" && <button onClick={reopen} disabled={!!busy} style={{ ...btn(false), padding: "5px 14px" }}>Back to draft</button>}
            {busy && <span style={{ fontSize: "11px", fontWeight: 800, color: BLUE }}>{busy}</span>}
          </div>
          {when && !isPosted && (
            <div style={{ display: "flex", gap: "6px", marginTop: "6px", alignItems: "center", flexWrap: "wrap" }}>
              <WhenPicker value={when} onChange={setWhen} />
              <button onClick={scheduleIt} disabled={!!busy} data-x-schedule style={{ ...btn(true), background: STATUS.scheduled[1], padding: "5px 14px" }}>Put on calendar</button>
              <button onClick={() => setWhen("")} disabled={!!busy} style={linkBtn}>Never mind</button>
            </div>
          )}
          {status === "scheduled" && (
            <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 800, color: dueNow ? "#b7791f" : STATUS.scheduled[1] }}>
              {dueNow ? `Was due ${fmtET(post.scheduledAt)}. Copy it to X, then Mark posted.` : `On the calendar for ${fmtET(post.scheduledAt)}. It won't post itself.`}
            </div>
          )}
        </div>
      </div>

      <div>
        <div style={label}>Preview</div>
        <XPreview text={text} media={previewMedia} />
        {hl && previewMedia.length > 0 && <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", marginTop: "6px" }}>On X, this is the video: the cut-up inside the outline.</div>}
        {!hl && card.on && cardHref && (
          <div style={{ marginTop: "14px" }}>
            <div style={label}>Player card · drag to move his photo</div>
            <img src={cardHref} alt="Player card" {...(card.photoUrl ? drag.handlers : {})} style={{ width: "100%", maxWidth: "640px", display: "block", borderRadius: "8px", border: "1px solid #d5dce6", ...(card.photoUrl ? drag.handlers.style : {}) }} />
          </div>
        )}
      </div>
    </div>
  );
}
