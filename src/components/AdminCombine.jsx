// src/components/AdminCombine.jsx
//
// Admin → Content → Combine: graphics for the all-time best Combine
// performer at every position — the #1 by Combine score, the same list as
// each position page's Best Performer (combineData.js combineProfiles →
// performers) — a front with his action shot and a back with his results
// and percentiles (utils/instagram/combineLeader.js). Nine graphics in all.
//   The cards   one per position: its best performer, his score, and
//               whether his graphic is made. Click one to open it.
//   The editor  the photo (a link, a file uploaded from this computer, or one
//               of his action shots from Admin → Photos), its placement (drag
//               it on the front), the kicker; Save, and download either side.
// Saved: combineGraphics/{POS} { pos, name, year, photo: { kind: "link" |
// "upload" | "player", url?, shotId? }, adjust, cutout, headline, thumb,
// updatedAt }; an uploaded photo is its own doc, combineShots/{id} { data (a
// JPEG data URI), name, pos, createdAt } — shrunk to fit one document
// (Firebase Storage is closed to the browser).
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { fetchCombineIndex, fetchCombineYear } from "../utils/events";
import { combineProfiles } from "../utils/combineData";
import { combineLeaderInput, combineLeaderFront, combineLeaderBack, combineLeaderImageUrls } from "../utils/instagram/combineLeader";
import { IG_W, IG_H } from "../utils/instagram/posts";
import { envFor, loadFeatureImage, useSvgUrls, useDragAdjust, PhotoAdjust, NO_ADJUST, shrinkToFit, thumbOf, downloadSvg, fileName, btn, linkBtn, label, field, BLUE, GOLD } from "./SocialMakerKit";
import { sanitizeImgur } from "./MarginAds";
import { nflAbbrFromOrg } from "../utils/coachHistory";
import WdLogo from "../assets/Logo2.png";

// The NFL Combine shield (public/logos).
const COMBINE_LOGO = "/logos/nfl-combine.png";

const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB"];
const POS_NAMES = { QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OL: "Offensive Line", EDGE: "Edge Rusher", DL: "Defensive Line", LB: "Linebacker", DB: "Defensive Back" };
// An uploaded photo: as big as fits a Firestore document with room to spare.
const SHOT_MAX_CHARS = 900000;
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px" };
const draftText = (p) => (p.round ? `Rd ${p.round}${p.pick ? `, #${p.pick}` : ""}${p.team ? ` · ${p.team}` : ""}` : p.undrafted ? "Undrafted" : "");

// Every year's rows → { performers, pooled: { [pos]: players }, span }.
async function loadCombine() {
  const index = await fetchCombineIndex();
  const years = Object.keys(index?.years || {});
  const lists = await Promise.all(years.map((y) => fetchCombineYear(y)));
  const byYear = Object.fromEntries(years.map((y, i) => [y, lists[i] || []]));
  // Built here from every year's rows — the same code the snapshot runs, so
  // it matches the site once the snapshots are rebuilt.
  const { performers } = combineProfiles(byYear);
  const pooled = {};
  Object.values(byYear).flat().forEach((r) => { if (POSITIONS.includes(r.position)) pooled[r.position] = (pooled[r.position] || 0) + 1; });
  const ys = years.map(Number).sort((a, b) => a - b);
  return { performers, pooled, span: ys.length ? `${ys[0]}–${ys[ys.length - 1]}` : "" };
}

export default function AdminCombine() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState({}); // pos → combineGraphics doc
  const [rulesMissing, setRulesMissing] = useState(false);
  const [open, setOpen] = useState(null); // a position

  useEffect(() => {
    loadCombine().then(setData).catch((e) => setErr(`Couldn't load the Combine data: ${e.message}`));
    getDocs(collection(db, "combineGraphics"))
      .then((s) => setSaved(Object.fromEntries(s.docs.filter((d) => POSITIONS.includes(d.id)).map((d) => [d.id, d.data()]))))
      .catch(() => setRulesMissing(true));
  }, []);

  if (err) return <div style={{ color: "#c0392b", fontWeight: 800 }}>{err}</div>;
  if (!data) return <div style={{ padding: 30, color: "#7a8597", fontWeight: 800 }}>Loading every Combine…</div>;
  const made = POSITIONS.filter((p) => saved[p]).length;

  return (
    <div style={{ fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginBottom: "6px" }}>
        <div style={{ fontWeight: 900, fontSize: "20px", color: BLUE }}>All-Time Best Combine Performers</div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#5b6b84" }}>{made} of {POSITIONS.length} graphics made · Combines {data.span}</div>
      </div>
      <div style={{ fontSize: "13px", color: "#5b6b84", marginBottom: "14px", lineHeight: 1.5 }}>
        The #1 by Combine score at each position — a front with his action shot, a back with his results and percentiles. Pick a position to make or edit its graphic.
      </div>
      {rulesMissing && (
        <div style={{ ...card, borderColor: "#f3c26b", background: "#fff8ea", padding: "10px 14px", fontSize: "13px", fontWeight: 700, color: "#8a5600", marginBottom: "14px" }}>
          Saved graphics can't be read — the Firestore rules for combineGraphics and combineShots aren't deployed yet. You can still make and download graphics; saving needs the rules.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px", marginBottom: "18px" }}>
        {POSITIONS.map((pos) => {
          const p = data.performers[pos]?.[0];
          const g = saved[pos];
          const on = open === pos;
          return (
            <button key={pos} disabled={!p} onClick={() => setOpen(pos)} style={{
              ...card, display: "flex", gap: "10px", alignItems: "center", padding: "10px", textAlign: "left", cursor: p ? "pointer" : "default", fontFamily: "inherit",
              border: `2px solid ${on ? BLUE : g ? "#16a34a66" : "#e3e8ef"}`, background: on ? "#eef4fb" : "#fff",
            }}>
              {g?.thumb ? <img src={g.thumb} alt="" style={{ width: "44px", height: "55px", objectFit: "cover", borderRadius: "5px", flexShrink: 0 }} />
                : <span style={{ width: "44px", height: "55px", borderRadius: "5px", background: "#eef1f5", flexShrink: 0, display: "grid", placeItems: "center", color: "#a3afc0", fontWeight: 900, fontSize: "18px" }}>+</span>}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "11px", fontWeight: 900, color: BLUE, letterSpacing: "0.06em" }}>{pos}</span>
                <span style={{ display: "block", fontSize: "14px", fontWeight: 900, color: "#1c2330", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p?.name || "—"}</span>
                <span style={{ display: "block", fontSize: "11px", fontWeight: 800, color: g ? "#15803d" : "#7a8597" }}>{p ? `${p.score.toFixed(1)} · ${p.year} · ` : ""}{g ? "Made" : "Not made"}</span>
              </span>
            </button>
          );
        })}
      </div>

      {open && data.performers[open]?.[0] && (
        <Editor key={open} data={data} pos={open} saved={saved[open] || null}
          onSaved={(value) => setSaved((s) => { const n = { ...s }; if (value) n[open] = value; else delete n[open]; return n; })}
          onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function Editor({ data, pos, saved, onSaved, onClose }) {
  const performer = data.performers[pos][0];
  const [headline, setHeadline] = useState(saved?.headline || "");
  const [cutout, setCutout] = useState(saved ? saved.cutout !== false : true);
  const [adjust, setAdjust] = useState(saved?.adjust || { ...NO_ADJUST });
  // The photo: { kind, url?, shotId?, name? }; an upload's data is shotData.
  const [photo, setPhoto] = useState(saved?.photo || null);
  const [shotData, setShotData] = useState("");
  const [link, setLink] = useState(saved?.photo?.kind === "link" ? saved.photo.url : "");
  const [school, setSchool] = useState({});
  const [teamLogo, setTeamLogo] = useState("");
  const [playerShots, setPlayerShots] = useState([]);
  const [svgs, setSvgs] = useState(["", ""]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const drag = useDragAdjust(setAdjust);
  const stale = saved && saved.name !== performer.name;

  // An uploaded photo saved before: its data, from combineShots.
  useEffect(() => {
    if (photo?.kind !== "upload" || !photo.shotId || shotData) return;
    getDoc(doc(db, "combineShots", photo.shotId)).then((s) => s.exists() && setShotData(s.data().data)).catch(() => setMsg("Couldn't load the uploaded photo."));
  }, [photo, shotData]);
  // His school, his NFL team's logo (today's franchise — "Oakland Raiders" → LV;
  // the dark-background version), and his action shots from Admin → Photos.
  useEffect(() => {
    const abbr = nflAbbrFromOrg(performer.team);
    if (abbr) getDoc(doc(db, "nfl", abbr)).then((s) => { const t = s.data() || {}; setTeamLogo(t.LogoDark || t.Logo1 || ""); }).catch(() => {});
    if (performer.school) getDocs(query(collection(db, "schools"), where("School", "==", performer.school), limit(1))).then((s) => setSchool(s.docs[0]?.data() || {})).catch(() => {});
    if (performer.slug) {
      getDocs(query(collection(db, "playerPhotos"), where("slug", "==", performer.slug), limit(1)))
        .then((s) => setPlayerShots((s.docs[0]?.data()?.action || []).filter((a) => a?.url))).catch(() => {});
    }
  }, [performer]);

  const photoUrl = photo?.kind === "upload" ? shotData : photo?.url || "";
  const input = useMemo(() => combineLeaderInput({
    pos, performer, pool: data.pooled[pos] || 0, span: data.span, school, teamLogo, combineLogo: COMBINE_LOGO,
    photo: photoUrl ? { url: photoUrl, adjust } : null, headline, brandLogo: WdLogo,
  }), [pos, performer, data, school, teamLogo, photoUrl, adjust, headline]);

  useEffect(() => {
    let live = true;
    const overrides = input.photo ? { [input.photo]: loadFeatureImage(input.photo, cutout) } : {};
    envFor(input, overrides, combineLeaderImageUrls(input)).then((env) => {
      if (!live) return;
      setSvgs([combineLeaderFront(input, env), combineLeaderBack(input, env)]);
      if (input.photo && !env.images[input.photo]) setMsg("Couldn't load that photo — it may not allow downloads (an imgur link or an upload works).");
      else setMsg((m) => (m.startsWith("Couldn't load that photo") ? "" : m));
    }).catch((e) => live && setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input, cutout]);
  const [frontUrl, backUrl] = useSvgUrls(useMemo(() => svgs.filter(Boolean), [svgs]));

  const run = async (key, fn) => { setBusy(key); setMsg(""); try { await fn(); } catch (e) { console.error("Combine graphic error:", e); setMsg(e.message || "Something went wrong — check the console."); } finally { setBusy(""); } };
  const applyLink = () => {
    const u = sanitizeImgur(link.trim()) || link.trim();
    if (!/^https?:\/\//.test(u)) { setMsg("Paste an image link (https://…)."); return; }
    setShotData("");
    setPhoto({ kind: "link", url: u });
  };
  const upload = (file) => run("upload", async () => {
    if (!file) return;
    const src = URL.createObjectURL(file);
    try {
      const { data: d } = await shrinkToFit(src, SHOT_MAX_CHARS, 1800);
      setShotData(d);
      setPhoto({ kind: "upload", shotId: null, name: file.name });
    } finally { URL.revokeObjectURL(src); }
  });
  // (Not his First Pick placement — that's a waist-up box; this one is full body.)
  const pickPlayerShot = (s) => {
    setShotData("");
    setPhoto({ kind: "player", url: s.url });
    setAdjust({ ...NO_ADJUST });
  };

  const save = () => run("save", async () => {
    let ph = photo;
    if (photo?.kind === "upload" && !photo.shotId) {
      if (!shotData) throw new Error("The uploaded photo didn't load.");
      const ref = await addDoc(collection(db, "combineShots"), { data: shotData, name: photo.name || "", pos, createdAt: serverTimestamp() });
      ph = { kind: "upload", shotId: ref.id, name: photo.name || "" };
      setPhoto(ph);
    }
    const thumb = frontUrl ? await thumbOf(frontUrl, 120) : "";
    const value = {
      pos, name: performer.name, year: performer.year, photo: ph ? Object.fromEntries(Object.entries(ph).filter(([, v]) => v != null)) : null,
      adjust, cutout, headline, thumb, updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "combineGraphics", pos), value);
    onSaved({ ...value, updatedAt: new Date() });
    setMsg("Saved.");
  });
  const remove = () => run("delete", async () => {
    if (!window.confirm(`Delete the ${pos} graphic?`)) return;
    await deleteDoc(doc(db, "combineGraphics", pos));
    if (saved?.photo?.kind === "upload" && saved.photo.shotId) await deleteDoc(doc(db, "combineShots", saved.photo.shotId)).catch(() => {});
    onSaved(null);
    onClose();
  });
  const download = (side) => run(`dl-${side}`, async () => {
    const svg = side === "front" ? svgs[0] : svgs[1];
    if (!svg) throw new Error("Still drawing.");
    await downloadSvg(svg, fileName(`combine-best-${pos}-${performer.name}-${side}`));
  });

  return (
    <div style={{ ...card, padding: "18px", display: "grid", gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)", gap: "20px", alignItems: "start" }}>
      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: "17px", color: BLUE, flex: 1 }}>{POS_NAMES[pos]} · best all-time</div>
          <button onClick={onClose} style={linkBtn}>CLOSE</button>
        </div>

        <div>
          <div style={label}>#1 by Combine score</div>
          <div style={{ fontSize: "15px", fontWeight: 900, color: "#1c2330" }}>{performer.name} · {performer.score.toFixed(1)}</div>
          <div style={{ fontSize: "12px", color: "#5b6b84", marginTop: "3px" }}>{[performer.school, performer.year, draftText(performer)].filter(Boolean).join(" · ")}</div>
          {stale && <div style={{ fontSize: "12px", fontWeight: 800, color: "#c0392b", marginTop: "4px" }}>This graphic was saved for {saved.name} — the #1 has changed. Check the photo and save again.</div>}
        </div>

        <div>
          <div style={label}>Action shot · full body, head to toe</div>
          <div style={{ display: "flex", gap: "6px" }}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste an image link (imgur…)" style={field} />
            <button onClick={applyLink} style={btn(false)}>Use</button>
          </div>
          <label style={{ ...btn(false), display: "inline-block", marginTop: "8px", cursor: "pointer" }}>
            {busy === "upload" ? "Reading…" : "Upload a photo"}
            <input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} style={{ display: "none" }} />
          </label>
          {photo && <span style={{ fontSize: "12px", fontWeight: 800, color: "#15803d", marginLeft: "8px" }}>
            {photo.kind === "upload" ? `Uploaded${photo.name ? `: ${photo.name}` : ""}${photo.shotId ? "" : " (saves with the graphic)"}` : photo.kind === "player" ? "His shot from Photos" : "Link"}
          </span>}
          {playerShots.length > 0 && (
            <div style={{ marginTop: "10px" }}>
              <div style={label}>His action shots · Admin → Photos</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {playerShots.map((s) => (
                  <button key={s.url} onClick={() => pickPlayerShot(s)} title={s.firstPick ? "Placed for First Pick" : "Not placed yet"} style={{ padding: 0, border: `2px solid ${photo?.url === s.url ? BLUE : "#e3e8ef"}`, borderRadius: "6px", background: "#fff", cursor: "pointer" }}>
                    <img src={sanitizeImgur(s.url) || s.url} alt="" style={{ width: "54px", height: "68px", objectFit: "cover", borderRadius: "4px", display: "block" }} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#33415a", marginTop: "10px" }}>
            <input type="checkbox" checked={cutout} onChange={(e) => setCutout(e.target.checked)} /> Take out a plain backdrop
          </label>
        </div>

        {photoUrl && <PhotoAdjust value={adjust} onChange={setAdjust} />}

        <div>
          <div style={label}>Kicker · the big line under "All-time best"</div>
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="COMBINE PERFORMER" style={field} />
        </div>

        {msg && <div style={{ fontSize: "12px", fontWeight: 800, color: msg === "Saved." ? "#15803d" : "#c0392b" }}>{msg}</div>}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button disabled={!!busy} onClick={save} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}>{busy === "save" ? "Saving…" : saved ? "Save changes" : "Save graphic"}</button>
          <button disabled={!!busy || !svgs[0]} onClick={() => download("front")} style={btn(false)}>{busy === "dl-front" ? "…" : "Download front"}</button>
          <button disabled={!!busy || !svgs[1]} onClick={() => download("back")} style={btn(false)}>{busy === "dl-back" ? "…" : "Download back"}</button>
          {saved && <button disabled={!!busy} onClick={remove} style={{ ...linkBtn, color: "#a52a1e" }}>DELETE</button>}
        </div>
      </div>

      {/* Previews */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        {[["Front · drag to move him", frontUrl, true], ["Back · results & percentiles", backUrl, false]].map(([t, u, front]) => (
          <div key={t}>
            <div style={label}>{t}</div>
            {u ? <img src={u} alt={t} {...(front && photoUrl ? drag.handlers : {})} style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}`, borderRadius: "8px", border: "1px solid #d5dce6", ...(front && photoUrl ? drag.handlers.style : {}) }} />
              : <div style={{ aspectRatio: `${IG_W} / ${IG_H}`, borderRadius: "8px", background: "#eef1f5", display: "grid", placeItems: "center", fontSize: "12px", fontWeight: 800, color: "#8a97ab" }}>Drawing…</div>}
          </div>
        ))}
        {!photoUrl && <div style={{ gridColumn: "1 / -1", fontSize: "12px", fontWeight: 700, color: GOLD }}>Add an action shot for the front — paste a link, upload a photo{playerShots.length ? ", or pick one of his" : ""}.</div>}
      </div>
    </div>
  );
}
