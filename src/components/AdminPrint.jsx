// src/components/AdminPrint.jsx
//
// Admin → Print: the print layouts (utils/printLayouts.js). For now the
// evaluation page — one player per page, shown as a left + right spread at
// 8.75 × 11.25 in (8.5 × 11 trim + bleed). Search any player and drag them
// (or tap L / R) onto either page; drag one page onto the other to swap.
// The layout controls (header, colors, which blocks go in which column and
// in what order) save to config/printLayouts and drive every printed page.
// "Print" prints the two pages at true size (Save as PDF works).
//
// Two formats, each its own saved layout: the magazine spread, and the
// personal page users print from Profile → My Binder (centered letter page,
// room for a hole punch, no page numbers — previewed here with the top
// public report standing in for "my evaluation").
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import EvaluationPage from "./print/EvaluationPage";
import PrintRoot, { printAs } from "./print/PrintRoot";
import AdminCards from "./AdminCards";
import LayoutControls, { Seg, miniBtn } from "./print/LayoutControls";
import { FORMATS, fmtClass, loadLayout, loadPrintPlayer, normalizeLayout, saveLayout } from "../utils/printLayouts";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const RED = "#c0392b";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: 12 };
const input = { border: "1px solid #d5dbe4", borderRadius: 6, padding: "7px 9px", fontSize: 13, fontFamily: "Arial, sans-serif", boxSizing: "border-box", width: "100%" };
const btn = (color, filled = false) => ({
  padding: "6px 12px", fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em",
  border: `2px solid ${color}`, borderRadius: 7, cursor: "pointer", background: filled ? color : "#fff", color: filled ? "#fff" : color,
  fontFamily: "Arial, sans-serif",
});
const label = { fontSize: 10, fontWeight: 900, color: "#6b7686", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, display: "block" };

// Starters when nothing's been saved: Jeremiah Smith (left), Jordan Seaton (right).
const STARTER_NAMES = { left: ["Jeremiah", "Smith"], right: ["Jordan", "Seaton"] };
const SPREAD_GAP = 28;



// Admin → Print: its tabs — the evaluation pages and the trading cards
// (components/AdminCards.jsx). Only the open tab is mounted, so only its
// pages are in the print.
const PRINT_TABS = [["evaluation", "Evaluation Pages"], ["cards", "Trading Cards"]];
export default function AdminPrint() {
  const [tab, setTab] = useState("evaluation");
  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {PRINT_TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} style={{
            padding: "6px 14px", fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "Arial, sans-serif",
            border: "2px solid #f6a21d", borderRadius: 999, cursor: "pointer", background: tab === k ? "#f6a21d" : "#fff", color: tab === k ? "#fff" : "#9a5d00",
          }}>{l}</button>
        ))}
      </div>
      {tab === "evaluation" ? <EvaluationDesigner /> : <AdminCards />}
    </>
  );
}

function EvaluationDesigner() {
  const [players, setPlayers] = useState(null);
  const [format, setFormat] = useState("spread");
  const [layouts, setLayouts] = useState(null); // { spread, personal }
  const [savedJson, setSavedJson] = useState({}); // format → the saved layout's JSON
  const [slots, setSlots] = useState({ left: "", right: "" }); // player ids
  const [cache, setCache] = useState({}); // id → loadPrintPlayer() data | "loading" | "error"
  const [search, setSearch] = useState("");
  const [guides, setGuides] = useState(true);
  const [previewAs, setPreviewAs] = useState("mine"); // personal: "mine" | "community" | "blank"
  const [dropOver, setDropOver] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(1000);
  const stageRef = useRef(null);

  // Players + the saved layout.
  useEffect(() => {
    getDocs(collection(db, "players"))
      .then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First || p.Last)))
      .catch((e) => { console.error("Print players load error:", e); setPlayers([]); });
    const keys = Object.keys(FORMATS);
    Promise.all(keys.map((k) => loadLayout(k).catch((e) => { console.error("Print layout load error:", e); return normalizeLayout(null, FORMATS[k].defaults); })))
      .then((ls) => {
        setLayouts(Object.fromEntries(keys.map((k, i) => [k, ls[i]])));
        setSavedJson(Object.fromEntries(keys.map((k, i) => [k, JSON.stringify(ls[i])])));
      });
  }, []);
  const layout = layouts?.[format] || null;
  const starters = layouts?.spread?.starters;
  const setLayout = (fn) => setLayouts((ls) => ({ ...ls, [format]: typeof fn === "function" ? fn(ls[format]) : fn }));
  const f = FORMATS[format];
  const personal = format === "personal";

  // Starters: the saved pair, else Jeremiah Smith / Jordan Seaton (newest class if there are two).
  useEffect(() => {
    if (!players || !starters || slots.left || slots.right) return;
    const byName = ([f, l]) => players
      .filter((p) => String(p.First).trim().toLowerCase() === f.toLowerCase() && String(p.Last).trim().toLowerCase() === l.toLowerCase())
      .sort((a, b) => parseInt(b.Eligible, 10) - parseInt(a.Eligible, 10))[0]?.id || "";
    const has = (id) => id && players.some((p) => p.id === id);
    setSlots({
      left: has(starters.left) ? starters.left : byName(STARTER_NAMES.left),
      right: has(starters.right) ? starters.right : byName(STARTER_NAMES.right),
    });
  }, [players, starters]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map((players || []).map((p) => [p.id, p])), [players]);

  // Load each placed player's page data once.
  useEffect(() => {
    [slots.left, slots.right].filter(Boolean).forEach((id) => {
      if (cache[id] || !byId.get(id)) return;
      setCache((c) => ({ ...c, [id]: "loading" }));
      loadPrintPlayer(byId.get(id))
        .then((d) => setCache((c) => ({ ...c, [id]: d })))
        .catch((e) => { console.error("Print player load error:", e); setCache((c) => ({ ...c, [id]: "error" })); });
    });
  }, [slots, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the spread to the stage's width.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [layouts]);
  const scale = Math.min(1, Math.max(0.2, (width - 2) / (f.w * 2 + SPREAD_GAP)));

  const dirty = layout && JSON.stringify(layout) !== savedJson[format];

  // Saves this format's layout — or, for starters, the spread's.
  async function save(extra, fmt = format) {
    setBusy(true); setMsg("");
    try {
      const next = normalizeLayout({ ...layouts[fmt], ...(extra || {}) }, FORMATS[fmt].defaults);
      await saveLayout(fmt, next);
      setLayouts((ls) => ({ ...ls, [fmt]: next })); setSavedJson((j) => ({ ...j, [fmt]: JSON.stringify(next) })); setMsg("Saved");
    } catch (e) {
      console.error("Print layout save error:", e); setMsg("Couldn't save — " + (e.message || e));
    } finally { setBusy(false); }
  }


  // ── Drag and drop ──
  const place = (slot, id) => setSlots((s) => {
    const other = slot === "left" ? "right" : "left";
    // Dropping the other page's player swaps the two.
    return s[other] === id ? { ...s, [slot]: id, [other]: s[slot] } : { ...s, [slot]: id };
  });
  const onDrop = (slot) => (e) => {
    e.preventDefault(); setDropOver("");
    const id = e.dataTransfer.getData("text/wd-player");
    if (id) place(slot, id);
  };
  const dragPlayer = (id) => (e) => { e.dataTransfer.setData("text/wd-player", id); e.dataTransfer.effectAllowed = "copyMove"; };

  const q = search.trim().toLowerCase();
  const matches = !players || q.length < 2 ? [] : players
    .filter((p) => `${p.First} ${p.Last} ${p.School || ""} ${p.Position || ""}`.toLowerCase().includes(q))
    .sort((a, b) => parseInt(b.Eligible, 10) - parseInt(a.Eligible, 10))
    .slice(0, 30);

  // Personal: the top public report stands in for "my evaluation".
  // previewAs: which version of the personal page to show.
  const pageData = (d) => {
    if (!personal || previewAs === "community") return d;
    if (previewAs === "blank") return { ...d, blank: true };
    return { ...d, mine: d.sampleMine || { grade: "", strengths: [], weaknesses: [], nflFit: "", text: "", by: "", at: 0 } };
  };

  if (!layout) return <div style={{ ...card, padding: 20, fontFamily: "Arial, sans-serif" }}>Loading print layouts…</div>;

  const pageFor = (slot, n) => {
    const id = slots[slot];
    const d = id ? cache[id] : null;
    const box = { width: f.w, height: f.h };
    let inner;
    if (!id) inner = <div style={{ ...box, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa3af", fontSize: 28, fontWeight: 900, fontFamily: "Arial, sans-serif", textAlign: "center" }}>Drag a player here</div>;
    else if (d === "error") inner = <div style={{ ...box, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: RED, fontSize: 24, fontWeight: 900, fontFamily: "Arial, sans-serif" }}>Couldn't load this player</div>;
    else if (!d || d === "loading") inner = <div style={{ ...box, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa3af", fontSize: 24, fontWeight: 900, fontFamily: "Arial, sans-serif" }}>Loading…</div>;
    else inner = <EvaluationPage data={pageData(d)} layout={layout} format={format} side={slot} page={n} guides={guides} />;
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); if (dropOver !== slot) setDropOver(slot); }}
        onDragLeave={() => setDropOver((s) => (s === slot ? "" : s))}
        onDrop={onDrop(slot)}
        style={{ position: "relative", width: f.w * scale, height: f.h * scale, flexShrink: 0 }}
      >
        <div
          draggable={!!id}
          onDragStart={id ? dragPlayer(id) : undefined}
          title={id ? "Drag onto the other page to swap" : ""}
          style={{ width: f.w, height: f.h, transform: `scale(${scale})`, transformOrigin: "top left", boxShadow: "0 6px 24px rgba(10,20,40,.22)", cursor: id ? "grab" : "default" }}
        >
          {inner}
        </div>
        {dropOver === slot && <div style={{ position: "absolute", inset: 0, border: `4px dashed ${GOLD}`, background: "rgba(246,162,29,.12)", pointerEvents: "none" }} />}
        <div style={{ position: "absolute", top: -22, [slot === "left" ? "left" : "right"]: 0, fontSize: 11, fontWeight: 900, color: "#6b7686", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "Arial, sans-serif" }}>
          {personal ? (slot === "left" ? "Preview 1" : "Preview 2") : slot === "left" ? "Left page" : "Right page"}{id && byId.get(id) ? ` · ${byId.get(id).First} ${byId.get(id).Last}` : ""}
        </div>
      </div>
    );
  };


  const printPages = [["left", 1], ["right", 2]].filter(([s]) => cache[slots[s]] && typeof cache[slots[s]] === "object");

  return (
    <div style={{ display: "grid", gap: 14, fontFamily: "Arial, sans-serif" }}>
      {/* Toolbar */}
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, color: INK, fontSize: 15 }}>Evaluation Page</div>
        <div style={{ width: 290 }}>
          <Seg value={format} onChange={(v) => { setFormat(v); setMsg(""); }} options={Object.entries(FORMATS).map(([k, x]) => [k, x.label])} />
        </div>
        <span style={{ fontSize: 12, color: "#6b7686", fontWeight: 700 }}>
          {personal ? "Users print this from Profile → My Binder · letter, centered, hole-punch room, no page numbers" : "8.5 × 11 trim · 8.75 × 11.25 with bleed · one player per page"}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {msg && <span style={{ fontSize: 12, fontWeight: 800, color: msg.startsWith("Couldn't") ? RED : "#15803d" }}>{msg}</span>}
          <label style={{ fontSize: 12, fontWeight: 800, color: INK, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Guides
          </label>
          <button type="button" onClick={() => save({ starters: { ...slots } }, "spread")} disabled={busy} style={btn(BLUE)} title="These two load first next time">Set as starters</button>
          <button type="button" onClick={() => printAs(`${printPages.map(([s]) => `${cache[slots[s]].first} ${cache[slots[s]].last}`).join(" & ")} - ${personal ? "Personal Evaluation" : "Evaluation Spread"}`)} disabled={!printPages.length} style={btn(BLUE)}>{personal ? "Print pages" : "Print spread"}</button>
          <button type="button" onClick={() => save()} disabled={busy || !dirty} style={{ ...btn(GOLD, true), opacity: busy || !dirty ? 0.5 : 1 }}>{busy ? "Saving…" : dirty ? "Save layout" : "Saved"}</button>
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "290px minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        {/* Controls */}
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ ...card, padding: 12 }}>
            <span style={label}>Players — drag onto a page</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? "Search name, school, position" : "Loading players…"} style={input} />
            <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 6 }}>
              {matches.map((p) => (
                <div key={p.id} draggable onDragStart={dragPlayer(p.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 6px", borderBottom: "1px solid #eef1f5", cursor: "grab" }}>
                  <span style={{ color: "#b8c0cc", fontSize: 14 }}>⠿</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.First} {p.Last}</div>
                    <div style={{ fontSize: 11, color: "#6b7686", fontWeight: 700 }}>{[p.Position, p.School, fmtClass(p.Eligible)].filter(Boolean).join(" · ")}</div>
                  </div>
                  <button type="button" onClick={() => place("left", p.id)} style={miniBtn()} title="Put on the left page">L</button>
                  <button type="button" onClick={() => place("right", p.id)} style={miniBtn()} title="Put on the right page">R</button>
                </div>
              ))}
              {q.length >= 2 && players && !matches.length && <div style={{ fontSize: 12, color: "#9aa3af", padding: 6 }}>No matches</div>}
            </div>
          </div>

          {personal && (
            <div style={{ ...card, padding: 12 }}>
              <span style={label}>Preview as</span>
              <Seg value={previewAs} onChange={setPreviewAs} options={[["mine", "User's eval"], ["community", "Community"], ["blank", "Fill-in"]]} />
            </div>
          )}
          <LayoutControls
            layout={layout}
            setLayout={(fn) => { setLayout(fn); setMsg(""); }}
            personal={personal}
            onReset={() => { if (window.confirm("Reset the layout to the defaults? (Save to keep it.)")) setLayout(normalizeLayout({ ...f.defaults, starters: layout.starters }, f.defaults)); }}
          />


        </div>

        {/* The spread */}
        <div ref={stageRef} style={{ ...card, padding: "34px 0 20px", background: "#e9ecf1", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: SPREAD_GAP * scale }}>
            {pageFor("left", 1)}
            {pageFor("right", 2)}
          </div>
          {guides && (
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 14, fontSize: 11, fontWeight: 800, color: "#6b7686" }}>
              {!personal && <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(255,0,90,.25)", marginRight: 4 }} />Bleed (trimmed off)</span>}
              <span><span style={{ display: "inline-block", width: 10, height: 2, background: "#00b7ff", marginRight: 4, verticalAlign: "middle" }} />{personal ? "Page 8.5 × 11" : "Trim 8.5 × 11"}</span>
              <span><span style={{ display: "inline-block", width: 10, borderTop: "2px dashed #c800c8", marginRight: 4, verticalAlign: "middle" }} />{personal ? "Safe area (centered)" : "Safe area (wider gutter)"}</span>
              {personal && <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", border: "1.5px dashed #8a929e", marginRight: 4, verticalAlign: "middle" }} />3-hole punch</span>}
            </div>
          )}
        </div>
      </div>

      {/* What prints: the pages at true size, without the guides. */}
      <PrintRoot pageSize={f.pageSize}>
        {printPages.map(([s, n]) => <EvaluationPage key={s} data={pageData(cache[slots[s]])} layout={layout} format={format} side={s} page={n} guides={false} />)}
      </PrintRoot>
    </div>
  );
}

