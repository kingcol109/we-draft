// src/components/AdminProDayIcons.jsx
//
// Admin → Branding → Pro Day: every FBS school's pro day badge
// (utils/proDayIcon.js), drawn from its branding (schools — its logos,
// Color1, Color2). Per school: which logo (a dark one gets a team-color
// outline), where it sits and how big, and "Swap colors" (shield ↔ band);
// Save stores the choice in config/proDayIcons, which /calendar uses
// for that school's pro day. Each badge downloads as a 1000×1000 PNG or SVG.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, where, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { FBS_CONFERENCES, portalTeamSlug } from "../utils/portalTeams";
import { proDayIconSvg, PRO_DAY_SIZE, PRO_DAY_LOGO_FIELDS, PRO_DAY_CONFIG, PRO_DAY_LOGO_X, PRO_DAY_LOGO_Y, PRO_DAY_LOGO_SCALE, PRO_DAY_DEFAULTS, isDarkLogoField, proDayLook } from "../utils/proDayIcon";
import { BLUE, GOLD, field, label, btn, fileName, loadFont, loadFeatureImage, downloadSvg } from "./SocialMakerKit";

const DEFAULT_YEAR = "2027";

export default function AdminProDayIcons() {
  const [teams, setTeams] = useState(null);
  const [saved, setSaved] = useState(null);
  const [fontCss, setFontCss] = useState(null);
  const [search, setSearch] = useState("");
  const [conf, setConf] = useState("");
  const [year, setYear] = useState(DEFAULT_YEAR);

  useEffect(() => {
    getDocs(query(collection(db, "schools"), where("Conference", "in", FBS_CONFERENCES)))
      .then((snap) => setTeams(snap.docs.map((d) => d.data()).filter((t) => t.School).map((t) => ({ ...t, slug: portalTeamSlug(t.School) }))))
      .catch((e) => { console.error("Pro day schools load error:", e); setTeams([]); });
    getDoc(doc(db, ...PRO_DAY_CONFIG)).then((s) => setSaved(s.exists() ? s.data().schools || {} : {}))
      .catch((e) => { console.error("Pro day prefs load error:", e); setSaved({}); });
    loadFont().then(setFontCss).catch(() => setFontCss(""));
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (teams || [])
      .filter((t) => (!conf || t.Conference === conf) && (!q || `${t.School} ${t.Short} ${t.Mascot}`.toLowerCase().includes(q)))
      .sort((a, b) => a.School.localeCompare(b.School));
  }, [teams, search, conf]);

  const savePref = async (slug, pref) => {
    await setDoc(doc(db, ...PRO_DAY_CONFIG), { schools: { [slug]: pref }, updatedAt: serverTimestamp() }, { merge: true });
    setSaved((s) => ({ ...s, [slug]: pref }));
  };

  if (!teams || !saved || fontCss === null) return <div style={{ padding: 20, fontWeight: 800, color: "#7a8597" }}>Loading schools…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 10, padding: "14px 16px" }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: BLUE, textTransform: "uppercase" }}>Pro Day Icons</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#5a6475", marginTop: 4, lineHeight: 1.5 }}>
          A badge for every FBS school, drawn from its Branding (logos, Color1, Color2). Pick a logo and colors, then <b>Save</b> — the saved
          badge is the one the Draft Calendar shows on that school's pro day. Downloads are {PRO_DAY_SIZE}×{PRO_DAY_SIZE} transparent PNGs.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 200px" }}>
            <div style={label}>Search</div>
            <input style={field} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="School or mascot" />
          </div>
          <div style={{ flex: "0 1 180px" }}>
            <div style={label}>Conference</div>
            <select style={field} value={conf} onChange={(e) => setConf(e.target.value)}>
              <option value="">All FBS</option>
              {FBS_CONFERENCES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: "0 1 100px" }}>
            <div style={label}>Year</div>
            <input style={field} value={year} onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#7a8597", paddingBottom: 8 }}>
            {shown.length} schools · {Object.keys(saved).length} saved
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {shown.map((t) => <ProDayCard key={t.slug} team={t} year={year} fontCss={fontCss} saved={saved[t.slug] || null} onSave={savePref} />)}
      </div>
    </div>
  );
}

function ProDayCard({ team, year, fontCss, saved, onSave }) {
  const options = PRO_DAY_LOGO_FIELDS.filter(([f]) => team[f]);
  // Saved settings, else the defaults (dark logo, 85%, −15).
  const base = proDayLook(team, saved);
  const startField = team[base.logoField] ? base.logoField : options[0]?.[0] || "";
  const [logoField, setLogoField] = useState(startField);
  const [swap, setSwap] = useState(!!saved?.swap);
  const [logoX, setLogoX] = useState(base.logoX);
  const [logoY, setLogoY] = useState(base.logoY);
  const [logoScale, setLogoScale] = useState(base.logoScale);
  const [logo, setLogo] = useState(undefined);
  const [busy, setBusy] = useState("");
  const src = team[logoField] || "";
  const dirty = logoField !== startField || swap !== base.swap || (!!saved && saved.logo !== src)
    || logoX !== base.logoX || logoY !== base.logoY || logoScale !== base.logoScale;
  const look = { color1: team.Color1, color2: team.Color2, year, swap, logoX, logoY, logoScale, darkLogo: isDarkLogoField(logoField) };

  useEffect(() => {
    let live = true;
    setLogo(undefined);
    if (!src) { setLogo(null); return undefined; }
    loadFeatureImage(src, true, { ink: true }).then((img) => { if (live) setLogo(img || null); });
    return () => { live = false; };
  }, [src]);

  // The preview uses the page's Bebas Neue (loadFont registered it); the download embeds it.
  const preview = useMemo(() => (logo === undefined ? "" : proDayIconSvg({ ...look, logo, id: `pd-${team.slug}` })), [logo, team.slug, ...Object.values(look)]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = `${fileName(team.School)}-pro-day${year ? `-${year}` : ""}`;

  const download = async (kind) => {
    const svg = proDayIconSvg({ ...look, logo, fontCss, id: "pd" });
    if (kind === "svg") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      a.download = `${name}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return;
    }
    setBusy("png");
    try { await downloadSvg(svg, name, PRO_DAY_SIZE, PRO_DAY_SIZE); } catch (e) { alert(e.message || "Couldn't export the PNG."); } finally { setBusy(""); }
  };
  const save = async () => {
    setBusy("save");
    try { await onSave(team.slug, { logoField, logo: src, swap, logoX, logoY, logoScale }); } catch (e) { alert(`Couldn't save: ${e.message || e}`); } finally { setBusy(""); }
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${saved && !dirty ? "#9fd8b4" : "#e2e7ef"}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ aspectRatio: "1 / 1", borderRadius: 8, background: "repeating-conic-gradient(#f1f4f8 0% 25%, #fff 0% 50%) 50% / 16px 16px", display: "grid", placeItems: "center", overflow: "hidden" }}>
        {preview
          ? <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: preview.replace(`width="${PRO_DAY_SIZE}" height="${PRO_DAY_SIZE}"`, 'width="100%" height="100%"') }} />
          : <span style={{ fontSize: 11, fontWeight: 800, color: "#9aa4b5" }}>Loading…</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 900, color: "#1c2330", lineHeight: 1.2 }}>{team.School}</div>
        {saved && <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: dirty ? "#b7791f" : "#15803d" }}>{dirty ? "Unsaved" : "✓ Saved"}</span>}
      </div>
      {logo === null && <div style={{ fontSize: 10, fontWeight: 800, color: "#a52a1e" }}>That logo didn't load — pick another or fix it under Teams → CFB.</div>}
      {options.length > 1 && (
        <select style={{ ...field, padding: "5px 7px", fontSize: 12 }} value={logoField} onChange={(e) => setLogoField(e.target.value)} aria-label="Logo">
          {options.map(([f, l]) => <option key={f} value={f}>{l}</option>)}
        </select>
      )}
      <Slider label="Left / right" value={logoX} range={PRO_DAY_LOGO_X} step={5} onChange={setLogoX} />
      <Slider label="Up / down" value={logoY} range={PRO_DAY_LOGO_Y} step={5} onChange={setLogoY} />
      <Slider label="Size" value={logoScale} range={PRO_DAY_LOGO_SCALE} step={0.05} onChange={setLogoScale} format={(v) => `${Math.round(v * 100)}%`} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: "#5a6475", cursor: "pointer" }}>
          <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} /> Swap colors
        </label>
        {(logoX !== PRO_DAY_DEFAULTS.logoX || logoY !== PRO_DAY_DEFAULTS.logoY || logoScale !== PRO_DAY_DEFAULTS.logoScale) ? (
          <button type="button" onClick={() => { setLogoX(PRO_DAY_DEFAULTS.logoX); setLogoY(PRO_DAY_DEFAULTS.logoY); setLogoScale(PRO_DAY_DEFAULTS.logoScale); }} style={{ border: "none", background: "none", color: BLUE, fontSize: 10, fontWeight: 900, cursor: "pointer", padding: 0 }}>Reset logo</button>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" disabled={!src || busy === "save" || (saved && !dirty)} onClick={save}
          style={{ ...btn(true), flex: 1.4, padding: "6px 8px", fontSize: 11, background: saved && !dirty ? "#9aa4b5" : BLUE, cursor: saved && !dirty ? "default" : "pointer" }}>
          {busy === "save" ? "Saving…" : saved && !dirty ? "Saved" : "Save"}
        </button>
        <button type="button" disabled={!preview || busy === "png"} onClick={() => download("png")} style={{ ...btn(true), flex: 1, padding: "6px 8px", fontSize: 11, background: GOLD }}>{busy === "png" ? "…" : "PNG"}</button>
        <button type="button" disabled={!preview} onClick={() => download("svg")} style={{ ...btn(false), flex: 1, padding: "6px 8px", fontSize: 11 }}>SVG</button>
      </div>
    </div>
  );
}

function Slider({ label: text, value, range, step, onChange, format = (v) => (v > 0 ? `+${v}` : String(v)) }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.04em" }}>
      <span style={{ width: 62, flexShrink: 0 }}>{text}</span>
      <input type="range" min={range[0]} max={range[1]} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} />
      <span style={{ width: 34, textAlign: "right", color: "#33415a" }}>{format(value)}</span>
    </label>
  );
}
