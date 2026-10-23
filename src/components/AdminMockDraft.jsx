// src/components/AdminMockDraft.jsx
//
// Admin → Mock Draft. Personalities: the Draft Sim analyst desk
// (utils/draftSim/analysts.js) — who each personality is, when they post,
// and every line they can say, situation by situation, with the {variables}
// filled in per pick. Lines are editable here: add, change, remove, reset
// to the built-ins. Saved to config/draftSimDesk (only situations that
// differ from analysts.js), which the sim loads over the built-ins
// (data.js loadDeskLines). "Preview" runs the desk on a real prospect from
// the live board so you can see the lines with actual stats, traits, fits
// and his big CFBD game. Davin's panel also edits his favorite players
// (name, positions, school) and the made-up "other schools" they can go to,
// with their own logos and colors (config/draftSimDesk.legends /
// .otherSchools).
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import {
  ANALYSTS, CHATTER, VARIABLES, VARIABLE_GROUPS, DEFAULT_CHATTER, lineText, defaultLines, applyDeskLines, defaultAvatar, applyDeskAvatars,
  LEGEND_POSITIONS, DEFAULT_LEGENDS, davinLegends, otherSchools, applyDeskLegends,
} from "../utils/draftSim/analysts";
import { loadSimData, loadDeskLines, loadBestGame, SIM_YEAR, teamNamer } from "../utils/draftSim/data";
import { fetchNflBranding } from "../utils/draftProfileData";
import { NFL_TEAMS } from "../utils/coachHistory";
import { initSim, makePick, rngNext } from "../utils/draftSim/engine";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const TABS = [{ key: "personalities", label: "Personalities" }];

const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden" };

function Avatar({ a, size = 40 }) {
  if (a.avatar) return <img src={a.avatar} alt="" style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "cover" }} />;
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: `linear-gradient(140deg, ${a.color}, #111a2e)`, color: "#fff", fontWeight: 900, fontSize: size * 0.34, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {a.initials}
    </span>
  );
}

// "{last} has {YDS} yards" with the variables picked out.
function Line({ text }) {
  const parts = text.split(/(\{[\w ]+\})/g);
  return (
    <span>
      {parts.map((p, i) => (/^\{[\w ]+\}$/.test(p)
        ? <span key={i} title={VARIABLES[p.slice(1, -1)] || ""} style={{ background: "#eef3fa", color: BLUE, borderRadius: "4px", padding: "0 4px", fontFamily: "monospace", fontSize: "12px" }}>{p}</span>
        : <span key={i}>{p}</span>))}
    </span>
  );
}

export default function AdminMockDraft() {
  const [tab, setTab] = useState("personalities");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "6px" }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "8px 16px", borderRadius: "8px", border: `2px solid ${tab === t.key ? BLUE : "#d8dee8"}`, cursor: "pointer",
            background: tab === t.key ? BLUE : "#fff", color: tab === t.key ? "#fff" : BLUE, fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
          }}>{t.label}</button>
        ))}
      </div>
      {tab === "personalities" && <Personalities />}
    </div>
  );
}

// An uploaded photo → a small square (center-cropped) data: URL, so it
// lives in the config doc itself — no Storage bucket needed. WebP where
// the browser can write it (keeps transparency), else PNG.
const AVATAR_PX = 160;
// fit "contain" (school logos) keeps the whole image, centered on a
// transparent square, instead of cropping it.
function squareImage(file, fit = "cover") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = AVATAR_PX;
      c.height = AVATAR_PX;
      const ctx2d = c.getContext("2d");
      if (fit === "contain") {
        const k = AVATAR_PX / Math.max(img.width, img.height);
        const w = img.width * k;
        const h = img.height * k;
        ctx2d.drawImage(img, (AVATAR_PX - w) / 2, (AVATAR_PX - h) / 2, w, h);
      } else {
        const m = Math.min(img.width, img.height);
        ctx2d.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, AVATAR_PX, AVATAR_PX);
      }
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/webp", 0.85));
    };
    img.onerror = () => reject(new Error("Not an image."));
    img.src = URL.createObjectURL(file);
  });
}

// Profile picture controls for one personality: upload, paste a URL, or
// back to the default.
function AvatarEditor({ a, value, onChange }) {
  const fileRef = useRef(null);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const preview = { ...a, avatar: value || defaultAvatar(a.id) || undefined };
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { setErr(""); onChange(await squareImage(f)); } catch { setErr("Couldn't read that image."); }
  };
  const smallBtn = { border: `1px solid ${BLUE}`, background: "#fff", color: BLUE, borderRadius: "6px", padding: "5px 10px", fontSize: "12px", fontWeight: 800, cursor: "pointer" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderTop: "1px solid #eef1f5", flexWrap: "wrap" }}>
      <Avatar a={preview} size={56} />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minWidth: 220 }}>
        <span style={{ fontWeight: 900, fontSize: "13px", color: "#1a1f2b" }}>Profile picture {value && <span style={{ fontSize: "10px", fontWeight: 900, padding: "1px 7px", borderRadius: "999px", background: "#eef3fa", color: BLUE, marginLeft: "4px" }}>EDITED</span>}</span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => fileRef.current?.click()} style={{ ...smallBtn, background: BLUE, color: "#fff" }}>Upload photo</button>
          <input ref={fileRef} type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image URL" style={{ flex: "1 1 180px", minWidth: 0, border: "1px solid #d8dee8", borderRadius: "6px", padding: "5px 8px", fontSize: "12px" }} />
          <button onClick={() => { if (/^https?:\/\//i.test(url.trim())) { onChange(url.trim()); setUrl(""); setErr(""); } else setErr("Paste a full https:// image URL."); }} style={smallBtn}>Use URL</button>
          {value && <button onClick={() => onChange("")} style={{ ...smallBtn, borderColor: "#d8dee8", color: "#888" }}>{defaultAvatar(a.id) ? "Reset to default" : "Remove"}</button>}
        </div>
        <span style={{ fontSize: "11px", color: err ? "#b42318" : "#888" }}>{err || `Cropped to a square and shown in a circle. Uploads are shrunk to ${AVATAR_PX}×${AVATAR_PX}.`}</span>
      </div>
    </div>
  );
}

// ── Davin's favorite players: name, positions (several, or ANY) and school
// — a real school (schools collection), an NFL team (full name), or one of
// the other schools below. Typing the school autocompletes from all three. ──
const realSchoolsCache = { list: null };
function useRealSchools() {
  const [list, setList] = useState(realSchoolsCache.list || []);
  useEffect(() => {
    if (realSchoolsCache.list) return;
    getDocs(collection(db, "schools"))
      .then((snap) => {
        realSchoolsCache.list = snap.docs.map((d) => d.data()).filter((d) => d.School)
          .map((d) => ({ name: d.School, logo: d.LogoBlack || d.LogoDark || d.Logo1 || "" }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setList(realSchoolsCache.list);
      })
      .catch((e) => console.error("Schools load error:", e));
  }, []);
  return list;
}

// NFL teams as "schools": [{ name: "New York Jets", logo }].
function useNflSchools() {
  const [list, setList] = useState([]);
  useEffect(() => {
    fetchNflBranding()
      .catch(() => ({}))
      .then((b) => setList(Object.entries(NFL_TEAMS).map(([abbr, name]) => ({ name, logo: b?.[abbr]?.LogoDark || b?.[abbr]?.Logo1 || "" })).sort((x, y) => x.name.localeCompare(y.name))));
  }, []);
  return list;
}

const inputSm = { border: "1px solid #d8dee8", borderRadius: "6px", padding: "5px 8px", fontSize: "13px", fontFamily: "Arial, sans-serif", minWidth: 0 };
const posChip = (on) => ({ border: `1px solid ${on ? BLUE : "#d8dee8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : "#555", borderRadius: "999px", padding: "2px 8px", fontSize: "11px", fontWeight: 800, cursor: "pointer" });

function LegendsEditor({ legends, others, onChange }) {
  const real = useRealSchools();
  const nfl = useNflSchools();
  const known = useMemo(() => new Map([
    ...real.map((r) => [r.name, r.logo]), ...nfl.map((t) => [t.name, t.logo]), ...others.filter((o) => o.name).map((o) => [o.name, o.logo]),
  ]), [real, nfl, others]);
  const set = (i, patch) => onChange(legends.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const isDefault = JSON.stringify(legends) === JSON.stringify(DEFAULT_LEGENDS);
  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid #eef1f5" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 900, fontSize: "13px", color: "#1a1f2b" }}>Favorite players</span>
        <span style={{ fontSize: "12px", color: "#777" }}>— his {"{legend}"} list: good-pick comparisons, &ldquo;the next…&rdquo; for FSU players, and his joke pick on the Suggestions tab (shown with the school&apos;s logo).</span>
        {!isDefault && <button onClick={() => onChange(DEFAULT_LEGENDS)} style={{ marginLeft: "auto", border: "none", background: "none", color: "#888", fontSize: "11px", fontWeight: 800, cursor: "pointer", textDecoration: "underline" }}>Reset to default</button>}
      </div>
      <datalist id="wd-legend-schools">
        {others.filter((o) => o.name).map((o) => <option key={`o-${o.name}`} value={o.name}>Other school</option>)}
        {nfl.map((t) => <option key={`n-${t.name}`} value={t.name}>NFL</option>)}
        {real.map((r) => <option key={r.name} value={r.name} />)}
      </datalist>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
        {legends.map((l, i) => {
          const logo = l.school ? known.get(l.school) : "";
          const unknown = l.school && real.length && !known.has(l.school);
          return (
            <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", paddingBottom: "8px", borderBottom: "1px dashed #eef1f5" }}>
              <input value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Player name" style={{ ...inputSm, flex: "1 1 170px", fontWeight: 700 }} />
              <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", flex: "2 1 300px" }}>
                {LEGEND_POSITIONS.map((pos) => {
                  const on = (l.positions || []).includes(pos);
                  return <button key={pos} onClick={() => set(i, { positions: on ? l.positions.filter((x) => x !== pos) : [...(l.positions || []), pos] })} style={posChip(on)}>{pos}</button>;
                })}
              </div>
              <span style={{ display: "flex", alignItems: "center", gap: "6px", flex: "1 1 200px" }}>
                <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 4, background: logo ? "#0e1626" : "#f1f4f8", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {logo && <img src={logo} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}
                </span>
                <input value={l.school || ""} onChange={(e) => set(i, { school: e.target.value })} list="wd-legend-schools" placeholder="School, NFL team or other school" style={{ ...inputSm, flex: 1, borderColor: unknown ? "#e4a11b" : "#d8dee8" }} />
              </span>
              <button onClick={() => onChange(legends.filter((_, k) => k !== i))} title="Remove" style={{ border: "none", background: "none", color: "#b42318", fontSize: "18px", fontWeight: 900, cursor: "pointer", padding: "2px 6px" }}>×</button>
              {unknown && <span style={{ flexBasis: "100%", fontSize: "11px", color: "#a06200", fontWeight: 800 }}>&ldquo;{l.school}&rdquo; isn&apos;t a school or NFL team on the site — add it under Other schools to give it a logo.</span>}
              {!(l.positions || []).length && <span style={{ flexBasis: "100%", fontSize: "11px", color: "#a06200", fontWeight: 800 }}>Pick at least one position (or ANY) — otherwise he only comes up as a joke pick.</span>}
            </div>
          );
        })}
        <button onClick={() => onChange([...legends, { name: "", positions: [], school: "" }])} style={{ alignSelf: "flex-start", border: `1px dashed ${BLUE}`, background: "#fff", color: BLUE, borderRadius: "6px", padding: "4px 10px", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}>+ Add player</button>
      </div>
    </div>
  );
}

// ── Other schools: made-up schools (Blue Mountain State…) with their own
// logo and colors, for the favorite players above. ──
function OtherSchoolsEditor({ others, onChange }) {
  const [err, setErr] = useState("");
  const set = (i, patch) => onChange(others.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const upload = async (i, e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { setErr(""); set(i, { logo: await squareImage(f, "contain") }); } catch { setErr("Couldn't read that image."); }
  };
  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid #eef1f5" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 900, fontSize: "13px", color: "#1a1f2b" }}>Other schools</span>
        <span style={{ fontSize: "12px", color: "#777" }}>— made-up schools for his favorites, with their own branding. Type the name as a player&apos;s school above.</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
        {others.map((o, i) => (
          <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, background: o.color1 || "#0e1626", border: `2px solid ${o.color2 || "#1f2b42"}`, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              {o.logo && <img src={o.logo} alt="" style={{ width: 30, height: 30, objectFit: "contain" }} />}
            </span>
            <input value={o.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="School name" style={{ ...inputSm, flex: "1 1 170px", fontWeight: 700 }} />
            <label style={{ border: `1px solid ${BLUE}`, background: BLUE, color: "#fff", borderRadius: "6px", padding: "5px 10px", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}>
              Upload logo
              <input type="file" accept="image/*" onChange={(e) => upload(i, e)} style={{ display: "none" }} />
            </label>
            <input value={o.logo && !o.logo.startsWith("data:") ? o.logo : ""} onChange={(e) => set(i, { logo: e.target.value.trim() })} placeholder="…or logo URL" style={{ ...inputSm, flex: "1 1 160px" }} />
            <label style={{ fontSize: "11px", color: "#555", fontWeight: 800, display: "flex", alignItems: "center", gap: "4px" }}>
              Color 1 <input type="color" value={o.color1 || "#0055a5"} onChange={(e) => set(i, { color1: e.target.value })} />
            </label>
            <label style={{ fontSize: "11px", color: "#555", fontWeight: 800, display: "flex", alignItems: "center", gap: "4px" }}>
              Color 2 <input type="color" value={o.color2 || "#f6a21d"} onChange={(e) => set(i, { color2: e.target.value })} />
            </label>
            <button onClick={() => onChange(others.filter((_, k) => k !== i))} title="Remove" style={{ border: "none", background: "none", color: "#b42318", fontSize: "18px", fontWeight: 900, cursor: "pointer", padding: "2px 6px" }}>×</button>
          </div>
        ))}
        {err && <span style={{ fontSize: "11px", color: "#b42318" }}>{err}</span>}
        <button onClick={() => onChange([...others, { name: "", logo: "", color1: "#0055a5", color2: "#f6a21d" }])} style={{ alignSelf: "flex-start", border: `1px dashed ${BLUE}`, background: "#fff", color: BLUE, borderRadius: "6px", padding: "4px 10px", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}>+ Add other school</button>
      </div>
    </div>
  );
}

// Every personality's lines as editable { text, minPick? } rows.
const snapshot = () => Object.fromEntries(ANALYSTS.map((a) => [a.id, Object.fromEntries(
  Object.entries(a.lines || {}).map(([cat, c]) => [cat, c.lines.map((l) => (typeof l === "string" ? { text: l } : { ...l }))]),
)]));
// A row back to how analysts.js / Firestore keep it.
const stored = (l) => (l.minPick ? { text: l.text.trim(), minPick: l.minPick } : l.text.trim());
const same = (rows, lines) => JSON.stringify(rows.map(stored).filter((l) => lineText(l))) === JSON.stringify(lines);
// Every variable a line can use: VARIABLES plus the palette's (the CFBD
// stat-line keys), and the trade side's other coordinators.
const KNOWN = new Set([...Object.keys(VARIABLES), ...VARIABLE_GROUPS.flatMap(([, keys]) => keys), "fromOc", "fromDc"]);
const unknownVars = (text) => (text.match(/\{([\w ]+)\}/g) || []).map((v) => v.slice(1, -1)).filter((v) => !KNOWN.has(v));
const STAT_HINT = "CFBD stat-line value (stat lines only)";

// Click a chip to drop {variable} into the line being edited, at the
// cursor. mousedown is cancelled so the line keeps focus.
function VariablePalette({ target, onInsert }) {
  const [group, setGroup] = useState(VARIABLE_GROUPS[0][0]);
  const keys = VARIABLE_GROUPS.find(([g]) => g === group)[1];
  const chip = (on) => ({ border: "none", borderRadius: "999px", padding: "3px 9px", fontSize: "11px", fontWeight: 800, cursor: "pointer", background: on ? BLUE : "#eef3fa", color: on ? "#fff" : BLUE });
  return (
    <div style={{ borderTop: "1px solid #eef1f5", marginTop: "8px", paddingTop: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", fontWeight: 900, color: "#555", letterSpacing: "0.04em" }}>INSERT VARIABLE</span>
        {VARIABLE_GROUPS.map(([g]) => <button key={g} onMouseDown={(e) => e.preventDefault()} onClick={() => setGroup(g)} style={chip(group === g)}>{g}</button>)}
      </div>
      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "7px" }}>
        {keys.map((k) => (
          <button key={k} onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(k)} disabled={!target} title={VARIABLES[k] || STAT_HINT}
            style={{ border: `1px solid ${target ? "#c9d7ea" : "#e3e8ef"}`, background: "#fff", borderRadius: "6px", padding: "3px 7px", cursor: target ? "pointer" : "default", fontFamily: "monospace", fontSize: "12px", color: target ? BLUE : "#aab4c3" }}>
            {`{${k}}`} <span style={{ fontFamily: "Arial, sans-serif", fontSize: "10px", color: "#888" }}>{VARIABLES[k] || "stat"}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: "11px", color: "#888", marginTop: "5px" }}>
        {target ? <>Inserting into <strong>{target}</strong> at the cursor.</> : "Click into a line below, then click a variable to insert it."}
      </div>
    </div>
  );
}

function Personalities() {
  const [open, setOpen] = useState(() => Object.fromEntries(ANALYSTS.map((a) => [a.id, a.id === "wedraft"])));
  const [showVars, setShowVars] = useState(false);
  const [rows, setRows] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("");
  // Admin-set profile pictures: { [id]: url } ("" / missing = default).
  const [avatars, setAvatars] = useState({});
  // Davin's favorite players and the made-up schools they can go to.
  const [legends, setLegends] = useState(DEFAULT_LEGENDS);
  const [others, setOthers] = useState([]);
  const changeLegends = (v) => { setLegends(v); setDirty(true); setStatus(""); };
  const changeOthers = (v) => { setOthers(v); setDirty(true); setStatus(""); };
  // The line being edited: { id, cat, i, el } (el: its textarea).
  const focused = useRef(null);
  const [target, setTarget] = useState(null);

  const insert = (k) => {
    const f = focused.current;
    if (!f) return;
    const token = `{${k}}`;
    const start = f.el.selectionStart ?? f.el.value.length;
    const end = f.el.selectionEnd ?? start;
    change(f.id, f.cat, (ls) => ls.map((x, idx) => (idx === f.i ? { ...x, text: x.text.slice(0, start) + token + x.text.slice(end) } : x)));
    requestAnimationFrame(() => { f.el.focus(); f.el.setSelectionRange(start + token.length, start + token.length); });
  };

  useEffect(() => {
    loadDeskLines().then(() => {
      setRows(snapshot());
      setAvatars(Object.fromEntries(ANALYSTS.filter((a) => a.avatar && a.avatar !== defaultAvatar(a.id)).map((a) => [a.id, a.avatar])));
      setLegends(davinLegends());
      setOthers(otherSchools());
    });
  }, []);
  const changeAvatar = (id, url) => {
    setAvatars((m) => ({ ...m, [id]: url }));
    setDirty(true);
    setStatus("");
  };

  const change = (id, cat, fn) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], [cat]: fn(r[id][cat]) } }));
    setDirty(true);
    setStatus("");
  };

  const save = async () => {
    // Only situations that differ from the built-ins are stored.
    const overrides = {};
    ANALYSTS.forEach((a) => Object.entries(rows[a.id] || {}).forEach(([cat, list]) => {
      const clean = list.map(stored).filter((l) => lineText(l));
      if (clean.length && !same(list, defaultLines(a.id, cat))) (overrides[a.id] || (overrides[a.id] = {}))[cat] = clean;
    }));
    setStatus("saving");
    try {
      const pics = Object.fromEntries(Object.entries(avatars).filter(([, v]) => v));
      const cleanLegends = legends
        .map((l) => ({ name: l.name.trim(), positions: l.positions || [], school: (l.school || "").trim() }))
        .filter((l) => l.name);
      const cleanOthers = others
        .map((o) => ({ name: o.name.trim(), logo: o.logo || "", color1: o.color1 || "", color2: o.color2 || "" }))
        .filter((o) => o.name);
      // The defaults stay in code — only a changed list is stored.
      const storedLegends = JSON.stringify(cleanLegends) === JSON.stringify(DEFAULT_LEGENDS) ? [] : cleanLegends;
      await setDoc(doc(db, "config", "draftSimDesk"), {
        lines: overrides, avatars: pics, legends: storedLegends, otherSchools: cleanOthers, updatedAt: serverTimestamp(),
      });
      applyDeskLines(overrides);
      applyDeskAvatars(pics);
      applyDeskLegends(storedLegends, cleanOthers);
      setLegends(davinLegends());
      setOthers(otherSchools());
      setRows(snapshot());
      setDirty(false);
      setStatus("saved");
    } catch (e) {
      console.error("Desk lines save error:", e);
      setStatus("error");
    }
  };

  return (
    <>
      <div style={{ ...card, padding: "14px 16px" }}>
        <div style={{ fontWeight: 900, color: BLUE, fontSize: "16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Draft Sim — Analyst Desk</div>
        <div style={{ fontSize: "13px", color: "#555", marginTop: "6px", lineHeight: 1.55 }}>
          We-Draft.com announces every pick with its board rank and one fact, then one personality chimes in — who depends on the pick. The user&apos;s own picks and trades always get one; on CPU picks it&apos;s the sim&apos;s
          <strong> Desk Chatter</strong> setting (default <strong>{CHATTER.find((c) => c.key === DEFAULT_CHATTER).label}</strong>):
        </div>
        <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "13px", color: "#444", lineHeight: 1.6 }}>
          {CHATTER.map((c) => <li key={c.key}><strong>{c.label}</strong> — {c.note}</li>)}
        </ul>
        <div style={{ fontSize: "12px", color: "#888", marginTop: "8px" }}>
          Each situation has several variants; a variant isn&apos;t reused until the others have had a turn. Edit, add or remove lines below, then <strong>Save</strong> — the live sim picks them up on its next load. Hover a <code>{"{variable}"}</code> to see what it fills in.
        </div>
      </div>

      <div style={{ ...card, padding: "10px 16px", position: "sticky", top: 8, zIndex: 2, boxShadow: "0 6px 18px rgba(0,0,0,0.1)", overflow: "visible" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "13px", fontWeight: 800, color: status === "error" ? "#b42318" : dirty ? "#a06200" : "#2e7d32" }}>
          {!rows ? "Loading lines…" : status === "saving" ? "Saving…" : status === "error" ? "Save failed — try again." : dirty ? "Unsaved changes" : status === "saved" ? "Saved — live on the next sim load." : "All lines saved"}
        </span>
        <button onClick={save} disabled={!dirty || status === "saving"} style={{ marginLeft: "auto", padding: "8px 18px", borderRadius: "8px", border: "none", background: dirty ? BLUE : "#c9d2de", color: "#fff", fontWeight: 900, fontSize: "12px", cursor: dirty ? "pointer" : "default", letterSpacing: "0.05em" }}>SAVE</button>
        </div>
        <VariablePalette target={target} onInsert={insert} />
      </div>

      <Preview />

      {rows && ANALYSTS.map((a) => {
        const cats = Object.entries(a.lines || {});
        const total = cats.reduce((n, [cat]) => n + (rows[a.id]?.[cat]?.length || 0), 0);
        return (
          <div key={a.id} style={card}>
            <button onClick={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))} style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", border: "none", background: "#f7f9fc", cursor: "pointer", textAlign: "left" }}>
              <Avatar a={{ ...a, avatar: avatars[a.id] || defaultAvatar(a.id) || undefined }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 900, fontSize: "16px", color: "#1a1f2b" }}>{a.name}</span>
                  <span style={{ fontSize: "12px", color: "#888" }}>{a.handle} · {a.role}</span>
                  <span style={{ fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "999px", background: a.enabled ? "#e8f5e9" : "#fff4e0", color: a.enabled ? "#2e7d32" : "#a06200" }}>
                    {a.enabled ? "LIVE" : "COMING SOON"}
                  </span>
                </span>
                <span style={{ display: "block", fontSize: "12px", color: "#555", marginTop: "3px" }}>{a.about}</span>
                <span style={{ display: "block", fontSize: "12px", color: "#888", marginTop: "2px" }}>When: {a.cadence} · {cats.length} situations · {total} lines</span>
              </span>
              <span style={{ fontWeight: 900, color: BLUE }}>{open[a.id] ? "▾" : "▸"}</span>
            </button>
            {open[a.id] && <AvatarEditor a={a} value={avatars[a.id] || ""} onChange={(url) => changeAvatar(a.id, url)} />}
            {open[a.id] && a.id === "davin" && <LegendsEditor legends={legends} others={others} onChange={changeLegends} />}
            {open[a.id] && a.id === "davin" && <OtherSchoolsEditor others={others} onChange={changeOthers} />}
            {open[a.id] && cats.map(([key, c]) => {
              const list = rows[a.id][key];
              const edited = !same(list, defaultLines(a.id, key));
              return (
                <div key={key} style={{ padding: "12px 16px", borderTop: "1px solid #eef1f5" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 900, fontSize: "13px", color: "#1a1f2b" }}>{c.label}</span>
                    <span style={{ fontSize: "11px", color: "#999", fontFamily: "monospace" }}>{key}</span>
                    <span style={{ fontSize: "12px", color: "#777" }}>— {c.when}</span>
                    {edited && <span style={{ fontSize: "10px", fontWeight: 900, padding: "1px 7px", borderRadius: "999px", background: "#eef3fa", color: BLUE }}>EDITED</span>}
                    {edited && (
                      <button onClick={() => change(a.id, key, () => defaultLines(a.id, key).map((l) => (typeof l === "string" ? { text: l } : { ...l })))} style={{ marginLeft: "auto", border: "none", background: "none", color: "#888", fontSize: "11px", fontWeight: 800, cursor: "pointer", textDecoration: "underline" }}>
                        Reset to default
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                    {list.map((l, i) => {
                      const bad = unknownVars(l.text);
                      return (
                        <div key={i}>
                          <div style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
                            <span style={{ width: "18px", flexShrink: 0, color: "#999", fontSize: "12px", fontWeight: 800, paddingTop: "8px", textAlign: "right" }}>{i + 1}</span>
                            <textarea value={l.text} rows={Math.max(1, Math.ceil(l.text.length / 110))} autoFocus={!l.text && i === list.length - 1}
                              onFocus={(e) => { focused.current = { id: a.id, cat: key, i, el: e.target }; setTarget(`${a.name} · ${c.label} · line ${i + 1}`); }}
                              onChange={(e) => change(a.id, key, (ls) => ls.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
                              style={{ flex: 1, minWidth: 0, border: `1px solid ${bad.length ? "#e4a11b" : "#d8dee8"}`, borderRadius: "6px", padding: "6px 8px", fontSize: "13px", fontFamily: "Arial, sans-serif", lineHeight: 1.45, resize: "vertical" }} />
                            <button onClick={() => { focused.current = null; setTarget(null); change(a.id, key, (ls) => ls.filter((_, k) => k !== i)); }} title="Remove line" disabled={list.length <= 1}
                              style={{ border: "none", background: "none", color: list.length <= 1 ? "#ccc" : "#b42318", fontSize: "18px", fontWeight: 900, cursor: list.length <= 1 ? "default" : "pointer", padding: "2px 6px" }}>×</button>
                          </div>
                          <div style={{ marginLeft: "24px", fontSize: "12px", color: "#555", marginTop: "2px" }}>
                            <Line text={l.text} />
                            {l.minPick && <span style={{ marginLeft: "6px", fontSize: "11px", color: "#a06200", fontWeight: 800 }}>from pick {l.minPick}</span>}
                            {bad.length > 0 && <span style={{ marginLeft: "6px", fontSize: "11px", color: "#a06200", fontWeight: 800 }}>Unknown: {bad.map((v) => `{${v}}`).join(" ")} — shows blank</span>}
                          </div>
                        </div>
                      );
                    })}
                    <button onClick={() => change(a.id, key, (ls) => [...ls, { text: "" }])} style={{ alignSelf: "flex-start", marginLeft: "24px", border: `1px dashed ${BLUE}`, background: "#fff", color: BLUE, borderRadius: "6px", padding: "4px 10px", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}>
                      + Add line
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <div style={card}>
        <button onClick={() => setShowVars((v) => !v)} style={{ width: "100%", padding: "12px 16px", border: "none", background: "#f7f9fc", cursor: "pointer", textAlign: "left", fontWeight: 900, color: BLUE, fontSize: "13px" }}>
          {showVars ? "▾" : "▸"} Variables
        </button>
        {showVars && (
          <div style={{ padding: "10px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "4px 16px", fontSize: "12px" }}>
            {VARIABLE_GROUPS.map(([g, keys]) => (
              <div key={g} style={{ gridColumn: "1 / -1", marginTop: "6px" }}>
                <div style={{ fontWeight: 900, color: "#1a1f2b", marginBottom: "3px" }}>{g}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "2px 16px" }}>
                  {keys.map((k) => <div key={k}><code style={{ color: BLUE }}>{`{${k}}`}</code> <span style={{ color: "#555" }}>{VARIABLES[k] || STAT_HINT}</span></div>)}
                </div>
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1", color: "#888", marginTop: "6px" }}>Coaches &amp; GM are the drafting team&apos;s (on a trade, the team trading up&apos;s). A variable that doesn&apos;t apply to a situation — or a seat the team hasn&apos;t filled — shows blank.</div>
          </div>
        )}
      </div>
    </>
  );
}

// Every analyst's post (Davin included) for a real prospect picked by a
// random team near his board spot.
function Preview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [seed, setSeed] = useState(1);
  const [posts, setPosts] = useState(null);
  const names = useMemo(() => teamNamer(data?.branding || {}), [data]);

  const run = async () => {
    setError("");
    let d = data;
    if (!d) {
      setLoading(true);
      try { d = await loadSimData(SIM_YEAR); setData(d); } catch (e) { setError("Couldn't load the board."); setLoading(false); return; }
      setLoading(false);
    }
    let r = { seed: (seed * 2654435761) | 0 };
    const rand = () => { const x = rngNext(r.seed); r = { seed: x.seed }; return x.value; };
    // Favor prospects with something to say about them.
    const pool = d.board.slice(0, 120).filter((p) => p.stats || p.strengths.length);
    const prospect = (pool.length ? pool : d.board)[Math.floor(rand() * (pool.length || d.board.length))];
    let sim = initSim({ order: d.order, board: d.board, chart: d.chart, rounds: 7, seed });
    const slot = Math.max(0, Math.min(sim.picks.length - 1, prospect.rank - 1 + Math.round((rand() - 0.5) * 16)));
    sim = { ...sim, idx: slot };
    const { event } = makePick(sim, prospect.id);
    const game = await loadBestGame(prospect.id, d.season).catch(() => null);
    const ctx = { ...names, staff: d.staff, season: d.season, year: d.year, chatter: "all", memory: {}, rand, games: game ? { [prospect.id]: game } : {} };
    setPosts(event ? ANALYSTS.map((a) => ({ a, out: a.react(event, ctx), event })) : []);
    setSeed((x) => x + 1);
  };

  return (
    <div style={{ ...card, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, color: "#1a1f2b", fontSize: "14px" }}>Preview on a real pick</div>
        <div style={{ fontSize: "12px", color: "#777" }}>A random {SIM_YEAR} prospect taken near his board spot — every personality&apos;s post, Davin included. Uses saved lines.</div>
        <button onClick={run} disabled={loading} style={{ marginLeft: "auto", padding: "8px 16px", borderRadius: "8px", border: "none", background: GOLD, color: "#111", fontWeight: 900, fontSize: "12px", cursor: loading ? "wait" : "pointer" }}>
          {loading ? "Loading board…" : posts ? "Another one" : "Preview"}
        </button>
      </div>
      {error && <div style={{ color: "#b42318", fontSize: "13px", marginTop: "8px" }}>{error}</div>}
      {posts && posts.length > 0 && (
        <div style={{ marginTop: "12px", background: "#0e1626", borderRadius: "12px", overflow: "hidden" }}>
          {posts.map(({ a, out }) => (
            <div key={a.id} style={{ display: "flex", gap: "10px", padding: "12px 14px", borderBottom: "1px solid #18233a", opacity: a.enabled ? 1 : 0.6 }}>
              <Avatar a={a} size={36} />
              <div style={{ flex: 1, minWidth: 0, fontFamily: "Arial, sans-serif" }}>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px" }}>{a.name} <span style={{ color: "#6f7f99", fontWeight: 400 }}>{a.handle}{a.enabled ? "" : " · not live"}</span></div>
                {out ? (
                  <>
                    <div style={{ color: out.lines ? "#fff" : "#dbe4f0", fontWeight: out.lines ? 800 : 400, fontSize: "13px", marginTop: "3px" }}>{out.text}</div>
                    {(out.lines || []).map((l, i) => <div key={i} style={{ color: "#c9d4e5", fontSize: "13px", marginTop: "4px" }}><span style={{ color: GOLD, fontWeight: 900 }}>›</span> {l}</div>)}
                  </>
                ) : <div style={{ color: "#6f7f99", fontSize: "13px", marginTop: "3px" }}>(no post)</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
