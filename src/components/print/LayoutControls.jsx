// src/components/print/LayoutControls.jsx
//
// The print layout editor's controls (utils/printLayouts.js layouts):
// header style, colors, sidebar and headshot sides, report / note line
// counts, footer text, the ranks' source (a user's own page), and the
// blocks — which column each sits in (sidebar / main / off) and in what
// order. Shared by Admin → Print (components/AdminPrint.jsx) and Profile →
// My Binder (components/profileHub/MyBinderTab.jsx).
//
// personal: the personal format (nothing mirrored: Left / Right rather
// than outside edge / gutter, one report). user: a user editing their own
// layout (no footer text; the rank source shows). onReset: the Reset
// button's action (omitted: no button).
import { BLOCKS } from "../../utils/printLayouts";

const BLUE = "#0055a5";
const INK = "#0b1a2e";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: 12 };
const input = { border: "1px solid #d5dbe4", borderRadius: 6, padding: "7px 9px", fontSize: 13, fontFamily: "Arial, sans-serif", boxSizing: "border-box", width: "100%" };
const label = { fontSize: 10, fontWeight: 900, color: "#6b7686", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, display: "block" };

export function Seg({ value, options, onChange }) {
  return (
    <div style={{ display: "flex", border: `2px solid ${BLUE}`, borderRadius: 7, overflow: "hidden" }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} style={{
          flex: 1, padding: "5px 6px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 900, textTransform: "uppercase",
          background: value === v ? BLUE : "#fff", color: value === v ? "#fff" : BLUE, fontFamily: "Arial, sans-serif",
        }}>{l}</button>
      ))}
    </div>
  );
}

export function miniBtn(disabled) {
  return {
    padding: "2px 6px", fontSize: 10, fontWeight: 900, border: "1px solid #c9d1dc", borderRadius: 4, background: "#fff",
    color: disabled ? "#c9d1dc" : BLUE, cursor: disabled ? "default" : "pointer", fontFamily: "Arial, sans-serif",
  };
}

// Blocks a user's own page leaves out entirely (the community breakdown).
const USER_HIDDEN = new Set(["spread"]);

export default function LayoutControls({ layout, setLayout, personal = false, user = false, onReset }) {
  const set = (patch) => setLayout((l) => ({ ...l, ...patch }));
  const moveBlock = (key, dir) => setLayout((l) => {
    const blocks = [...l.blocks];
    const i = blocks.findIndex((b) => b.key === key);
    const zone = blocks[i].zone;
    // The next block in the same zone, in that direction.
    let j = i + dir;
    while (j >= 0 && j < blocks.length && blocks[j].zone !== zone) j += dir;
    if (j < 0 || j >= blocks.length) return l;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    return { ...l, blocks };
  });
  const setZone = (key, zone) => setLayout((l) => ({ ...l, blocks: [...l.blocks.filter((b) => b.key !== key), { key, zone }] })); // to the bottom of its new column

  // Spread: outside edge / gutter; personal (nothing mirrored): left / right.
  const sideOptions = personal ? [["outside", "Left"], ["inside", "Right"]] : [["outside", "Outside edge"], ["inside", "Gutter side"]];

  const zoneList = (zone, title) => {
    const list = layout.blocks.filter((b) => b.zone === zone && !(user && USER_HIDDEN.has(b.key)));
    return (
      <div style={{ marginBottom: 10 }}>
        <span style={label}>{title}</span>
        {!list.length && <div style={{ fontSize: 12, color: "#9aa3af", padding: "4px 0" }}>Empty</div>}
        {list.map((b, i) => (
          <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 6px", border: "1px solid #e3e8ef", borderRadius: 6, marginBottom: 4, background: zone === "off" ? "#f7f8fa" : "#fff" }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 800, color: zone === "off" ? "#9aa3af" : INK }}>{BLOCKS[b.key].label}</span>
            {zone !== "off" && <>
              <button type="button" disabled={i === 0} onClick={() => moveBlock(b.key, -1)} style={miniBtn(i === 0)} aria-label="Move up">↑</button>
              <button type="button" disabled={i === list.length - 1} onClick={() => moveBlock(b.key, 1)} style={miniBtn(i === list.length - 1)} aria-label="Move down">↓</button>
            </>}
            {zone !== "side" && <button type="button" onClick={() => setZone(b.key, "side")} style={miniBtn()} title="Move to the sidebar">Side</button>}
            {zone !== "main" && <button type="button" onClick={() => setZone(b.key, "main")} style={miniBtn()} title="Move to the main column">Main</button>}
            {zone !== "off" && <button type="button" onClick={() => setZone(b.key, "off")} style={miniBtn()} title="Hide">Off</button>}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 14, fontFamily: "Arial, sans-serif" }}>
      <div style={{ ...card, padding: 12, display: "grid", gap: 10 }}>
        <span style={{ ...label, marginBottom: 0, color: INK, fontSize: 11 }}>Layout</span>
        <div><span style={label}>Header</span><Seg value={layout.header} onChange={(v) => set({ header: v })} options={[["band", "Color band"], ["clean", "Clean white"]]} /></div>
        <div><span style={label}>Colors</span><Seg value={layout.accent} onChange={(v) => set({ accent: v })} options={[["school", "School"], ["website", "Website"]]} /></div>
        <div><span style={label}>Print in</span><Seg value={layout.bw ? "bw" : "color"} onChange={(v) => set({ bw: v === "bw" })} options={[["color", "Color"], ["bw", "Black & white"]]} /></div>
        <div><span style={label}>Sidebar</span><Seg value={layout.sidebar} onChange={(v) => set({ sidebar: v })} options={sideOptions} /></div>
        <div><span style={label}>Headshot</span><Seg value={layout.headshot} onChange={(v) => set({ headshot: v })} options={sideOptions} /></div>
        {user && (
          <div>
            <span style={label}>Pages start as</span>
            <Seg value={layout.pageVersion || "mine"} onChange={(v) => set({ pageVersion: v })} options={[["mine", "My eval"], ["community", "Community"], ["blank", "Fill-in"]]} />
          </div>
        )}
        {personal && (
          <div>
            <span style={label}>{user ? "My ranks come from" : "Ranks on a user's own page"}</span>
            <Seg value={layout.rankSource || "mine"} onChange={(v) => set({ rankSource: v })} options={[["mine", "My grades"], ["whiteboard", "My Whiteboard"]]} />
            {user && (
              <a href="/whiteboard" target="_blank" rel="noopener noreferrer" style={{
                display: "block", marginTop: 6, textAlign: "center", padding: "6px 10px", border: `2px solid ${BLUE}`, borderRadius: 7,
                fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", color: BLUE, textDecoration: "none", background: "#fff",
              }}>📋 Open my Whiteboard ↗</a>
            )}
          </div>
        )}
        {/* Community pages have no reports, so the line limit is the user's evaluation's. */}
        <div style={{ display: "grid", gridTemplateColumns: personal ? "1fr 1fr" : "1fr", gap: 6 }}>
          {personal && <div><span style={label}>Max eval lines</span><input type="number" min={2} max={80} value={layout.reportLines} onChange={(e) => set({ reportLines: Math.max(2, Math.min(80, +e.target.value || 2)) })} style={input} /></div>}
          <div><span style={label}>Note lines</span><input type="number" min={1} max={30} value={layout.notesLines} onChange={(e) => set({ notesLines: Math.max(1, Math.min(30, +e.target.value || 1)) })} style={input} /></div>
        </div>
        {!user && <div><span style={label}>Footer text</span><input value={layout.folio} onChange={(e) => set({ folio: e.target.value })} style={input} /></div>}
      </div>

      <div style={{ ...card, padding: 12 }}>
        {zoneList("side", "Sidebar (narrow column)")}
        {zoneList("main", "Main column")}
        {zoneList("off", "Not shown")}
        {onReset && (
          <button type="button" onClick={onReset} style={{
            width: "100%", marginTop: 4, padding: "6px 12px", fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em",
            border: "2px solid #6b7686", borderRadius: 7, cursor: "pointer", background: "#fff", color: "#6b7686", fontFamily: "Arial, sans-serif",
          }}>Reset to default</button>
        )}
      </div>
    </div>
  );
}
