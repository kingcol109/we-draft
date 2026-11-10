// src/components/PortalThumbControls.jsx
//
// The Transfer Portal thumbnail's own controls in Admin → Videos → Graphics →
// Thumbnail (AdminYouTubeGraphics.jsx; drawn by utils/youtube/portalthumb.js):
// which look (entered the portal / transferred), where he's coming from and
// going to (any school of ours, or a name typed in), the kicker and headline,
// and the layout (LayoutEditor — shared with Game Review).
import { field, label, btn, linkBtn } from "./SocialMakerKit";
import { LayoutEditor } from "./GameReviewControls";
import { PT_ELEMENTS, PT_LABELS, PT_KINDS, portalDefaults } from "../utils/youtube/portalthumb";

// pt: { kind, fromName, toName, kicker, headline, layout }.
export default function PortalThumbControls({ pt, setPt, schools, selected, setSelected, adjust, setAdjust, setMsg }) {
  const set = (patch) => setPt((x) => ({ ...x, ...patch }));
  const words = portalDefaults(pt.kind, pt.toName);
  // A new look (or new school, on the transfer) rewrites the words unless they've been typed over.
  const setKind = (kind) => setPt((x) => ({ ...x, kind, ...(x.wordsTouched ? {} : portalDefaults(kind, x.toName)) }));
  const setTo = (toName) => setPt((x) => ({ ...x, toName, ...(x.wordsTouched || x.kind !== "transfer" ? {} : { headline: toName || portalDefaults("transfer").headline }) }));
  return (
    <>
      <div>
        <div style={label}>Look</div>
        <div style={{ display: "flex", gap: "4px" }}>
          {Object.entries(PT_KINDS).map(([k, t]) => <button key={k} onClick={() => setKind(k)} style={{ ...btn(pt.kind === k), padding: "5px 12px" }}>{t}</button>)}
        </div>
      </div>
      <datalist id="pt-schools">{(schools || []).map((s) => <option key={s.School} value={s.School} />)}</datalist>
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ flex: 1 }}><div style={label}>From</div><input list="pt-schools" style={field} value={pt.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder={schools ? "His old school" : "Loading schools…"} /></div>
        <div style={{ flex: 1 }}><div style={label}>To {pt.kind === "portal" ? "(blank: “?”)" : ""}</div><input list="pt-schools" style={field} value={pt.toName} onChange={(e) => setTo(e.target.value)} placeholder="His new school" /></div>
      </div>
      <div>
        <div style={{ ...label, display: "flex" }}>
          Kicker
          {pt.wordsTouched && <button style={{ ...linkBtn, marginLeft: "auto", fontSize: "10px" }} onClick={() => set({ ...words, wordsTouched: false })}>RESET WORDS</button>}
        </div>
        <input style={field} value={pt.kicker} onChange={(e) => set({ kicker: e.target.value, wordsTouched: true })} placeholder={words.kicker} />
      </div>
      <div>
        <div style={label}>Headline (a line a line)</div>
        <textarea rows={2} style={{ ...field, resize: "vertical", fontWeight: 800 }} value={pt.headline} onChange={(e) => set({ headline: e.target.value, wordsTouched: true })} placeholder={words.headline} />
      </div>
      <LayoutEditor elements={PT_ELEMENTS} labels={PT_LABELS} layout={pt.layout} setLayout={(fn) => setPt((x) => ({ ...x, layout: fn(x.layout || {}) }))}
        selected={selected} setSelected={setSelected} adjust={adjust} setAdjust={setAdjust} storageKey="ptLayoutDefault" templateName="Transfer Portal" setMsg={setMsg}
        noSpacing={["schools", "logo"]} lineSpacing={["headline"]} />
    </>
  );
}
