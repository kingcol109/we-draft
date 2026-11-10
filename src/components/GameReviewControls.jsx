// src/components/GameReviewControls.jsx
//
// The Game Review thumbnail's own controls in Admin → Videos → Graphics →
// Thumbnail (AdminYouTubeGraphics.jsx): its fonts (read from this computer —
// utils/youtube/localFonts.js), the headline, the colors, the dots, and the
// layout: pick an element (or click it on the preview) and move, size and
// space it. The player's photo is moved and sized with PhotoAdjust.
import { field, label, btn, linkBtn, PhotoAdjust, NO_ADJUST } from "./SocialMakerKit";
import { GR_ELEMENTS, GR_LABELS } from "../utils/youtube/gamereview";
import { LOCAL_FONTS, canQueryLocalFonts, fontsFromComputer, fontFromFile } from "../utils/youtube/localFonts";

const LAYOUT_KEY = "grLayoutDefault";
export function defaultLayout() {
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") || {}; } catch { return {}; }
}
const saveDefaultLayout = (layout) => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout || {})); } catch { /* blocked */ } };

const row = { display: "flex", gap: "8px", alignItems: "center" };
const small = { fontSize: "11px", fontWeight: 800, color: "#5b6b84" };

function Slider({ name, value, min, max, step, fmt, onChange, reset }) {
  return (
    <div>
      <div style={{ ...label, display: "flex" }}>
        {name}<span style={{ marginLeft: "auto" }}>{fmt(value)}</span>
        {value !== reset && <button style={{ ...linkBtn, fontSize: "10px" }} onClick={() => onChange(reset)}>RESET</button>}
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%" }} />
    </div>
  );
}

// gr: { headline, color, accent, headColor, dotColor, dots, logoWhite,
// photoBehind, layout }; school: { color, accent } (his school's, to reset to).
export default function GameReviewControls({ gr, setGr, selected, setSelected, adjust, setAdjust, school, fonts, setFonts, setMsg }) {
  const set = (patch) => setGr((g) => ({ ...g, ...patch }));
  const el = gr.layout?.[selected] || {};
  const setEl = (patch) => setGr((g) => ({ ...g, layout: { ...g.layout, [selected]: { ...(g.layout?.[selected] || {}), ...patch } } }));
  const useComputer = () => fontsFromComputer().then((f) => { setFonts(f); setMsg(f.missing.length ? `Couldn't find ${f.missing.join(" and ")} on this computer: pick its file instead.` : "Fonts loaded."); })
    .catch((e) => setMsg(`Couldn't read this computer's fonts: ${e.message}`));
  const fromFile = (family) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) fontFromFile(family, file).then(setFonts).catch((er) => setMsg(`Couldn't use that font file: ${er.message}`));
  };
  const color = (k, t) => (
    <label style={{ ...small, display: "flex", flexDirection: "column", gap: "3px", flex: 1 }}>
      {t}
      <input type="color" value={gr[k] || "#000000"} onChange={(e) => set({ [k]: e.target.value })} style={{ width: "100%", height: "30px", border: "1px solid #d5dce6", borderRadius: "6px", padding: 0 }} />
    </label>
  );

  return (
    <>
      {fonts.missing.length > 0 && (
        <div style={{ border: "1px solid #f3d9a4", background: "#fff8ea", borderRadius: "8px", padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ fontSize: "12px", fontWeight: 800, color: "#8a5a00" }}>
            {fonts.missing.join(" and ")} {fonts.missing.length === 1 ? "isn't" : "aren't"} loaded yet, so a stand-in font shows. Load {fonts.missing.length === 1 ? "it" : "them"} once and this browser keeps {fonts.missing.length === 1 ? "it" : "them"}.
          </div>
          {canQueryLocalFonts() && <button style={{ ...btn(true), alignSelf: "flex-start", padding: "5px 12px" }} onClick={useComputer}>Use this computer&apos;s fonts</button>}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {LOCAL_FONTS.filter((f) => fonts.missing.includes(f.label)).map((f) => (
              <label key={f.family} style={{ ...linkBtn, cursor: "pointer" }}>
                {f.label} file…<input type="file" accept=".otf,.ttf,.woff,.woff2" onChange={fromFile(f.family)} style={{ display: "none" }} />
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={label}>Headline (a line a line)</div>
        <textarea rows={3} style={{ ...field, resize: "vertical", fontWeight: 800 }} value={gr.headline} onChange={(e) => set({ headline: e.target.value })} />
      </div>

      <div>
        <div style={{ ...label, display: "flex" }}>
          Colors
          {(gr.color !== school.color || gr.accent !== school.accent) && <button style={{ ...linkBtn, marginLeft: "auto", fontSize: "10px" }} onClick={() => set({ color: school.color, accent: school.accent, dotColor: "" })}>HIS SCHOOL&apos;S</button>}
        </div>
        <div style={row}>
          {color("color", "Ground")}
          {color("accent", "Name")}
          {color("headColor", "Headline")}
          <label style={{ ...small, display: "flex", flexDirection: "column", gap: "3px", flex: 1 }}>
            Dots
            <span style={{ display: "flex", gap: "3px", alignItems: "center" }}>
              <input type="color" value={gr.dotColor || gr.accent || "#f6a21d"} onChange={(e) => set({ dotColor: e.target.value })} style={{ width: "100%", height: "30px", border: "1px solid #d5dce6", borderRadius: "6px", padding: 0 }} />
              {gr.dotColor && <button style={{ ...linkBtn, padding: 0 }} title="Back to his school's second color" onClick={() => set({ dotColor: "" })}>↺</button>}
            </span>
          </label>
        </div>
      </div>
      <Slider name="Dots" value={gr.dots} min={0} max={1.5} step={0.05} reset={1} fmt={(v) => (v ? `${Math.round(v * 100)}%` : "Off")} onChange={(v) => set({ dots: v })} />
      <label style={{ ...small, display: "flex", gap: "6px", alignItems: "center" }}><input type="checkbox" checked={gr.logoWhite !== false} onChange={(e) => set({ logoWhite: e.target.checked })} /> White We-Draft logo</label>
      <label style={{ ...small, display: "flex", gap: "6px", alignItems: "center" }}><input type="checkbox" checked={!!gr.photoBehind} onChange={(e) => set({ photoBehind: e.target.checked })} /> Player behind the words</label>

      <div style={{ borderTop: "1px solid #eef1f5", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ ...label, marginBottom: 0 }}>Layout · pick one, or click it on the preview and drag</div>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {GR_ELEMENTS.map((k) => <button key={k} onClick={() => setSelected(k)} style={{ ...btn(selected === k), padding: "4px 10px" }}>{GR_LABELS[k]}</button>)}
        </div>
        {selected === "photo" ? (
          <PhotoAdjust value={adjust} onChange={setAdjust} />
        ) : (
          <>
            <Slider name="Left / right" value={Number(el.dx) || 0} min={-960} max={960} step={2} reset={0} fmt={(v) => `${v > 0 ? "+" : ""}${v}px`} onChange={(v) => setEl({ dx: v })} />
            <Slider name="Up / down" value={Number(el.dy) || 0} min={-540} max={540} step={2} reset={0} fmt={(v) => `${v > 0 ? "+" : ""}${v}px`} onChange={(v) => setEl({ dy: v })} />
            <Slider name="Size" value={el.scale ?? 1} min={0.2} max={3} step={0.01} reset={1} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setEl({ scale: v })} />
            {selected !== "logo" && <Slider name="Letter spacing" value={Number(el.spacing) || 0} min={-20} max={80} step={1} reset={0} fmt={(v) => `${v}px`} onChange={(v) => setEl({ spacing: v })} />}
            {selected === "headline" && <Slider name="Line spacing" value={el.lh ?? 1} min={0.5} max={2} step={0.01} reset={1} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setEl({ lh: v })} />}
          </>
        )}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button style={linkBtn} onClick={() => (selected === "photo" ? setAdjust(NO_ADJUST) : setGr((g) => ({ ...g, layout: { ...g.layout, [selected]: {} } })))}>Reset {GR_LABELS[selected].toLowerCase()}</button>
          <button style={linkBtn} onClick={() => { setGr((g) => ({ ...g, layout: defaultLayout() })); setAdjust(NO_ADJUST); }}>Reset all</button>
          <button style={linkBtn} onClick={() => { saveDefaultLayout(gr.layout); setMsg("This layout is now where Game Review starts."); }} title="New Game Review thumbnails start from this layout">Make this the default</button>
        </div>
      </div>
    </>
  );
}
