// src/components/profileHub/BinderBoards.jsx
//
// Profile → My Binder → Board Lists: print a class's board, round by round
// or position by position — their own (from their Whiteboard, with their
// grades, stars and red flags) or the community's (by community grade).
// Data: utils/boardLists.js; pages: components/print/BoardListPages.jsx.
//
// The section itself is just "Create a board list"; the builder opens with
// the pages, its options beside them (class, board, organize, positions,
// how many, style), and the pages follow each change. Two styles: Compact
// (one line a player) and Snapshot (a bigger card — headshot, size, the
// community's top strengths). onPreview tells My Binder when the builder
// takes over the tab.
import { useEffect, useMemo, useRef, useState } from "react";
import LoadingSpinner from "../LoadingSpinner";
import PrintRoot, { printAs } from "../print/PrintRoot";
import { Seg } from "../print/LayoutControls";
import { BoardListPage, paginate } from "../print/BoardListPages";
import { BOARD_POSITIONS, loadBoardList, loadSnapshotExtras } from "../../utils/boardLists";
import { FORMATS } from "../../utils/printLayouts";
import { PUBLIC_PROSPECT_YEARS } from "../../utils/prospectYears";

const BLUE = "#0055a5";
const BODY = "Arial, sans-serif";
const F = FORMATS.personal;
const label = { fontSize: 10, fontWeight: 900, color: "#6b7686", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, display: "block" };
// Whiteboard classes (pages/Whiteboard.js) that are public.
const CLASSES = PUBLIC_PROSPECT_YEARS.filter((y) => ["2027", "2028"].includes(y));

export default function BinderBoards({ uid, evals, isMobile, bw, card, btn, section, onPreview }) {
  const [building, setBuilding] = useState(false);
  const [cls, setCls] = useState(CLASSES[0] || "2027");
  const [source, setSource] = useState("mine");
  const [by, setBy] = useState("round");
  const [pos, setPos] = useState("ALL");
  const [limit, setLimit] = useState(100);
  const [style, setStyle] = useState("compact");
  const [list, setList] = useState(null); // null (loading) | { title, subtitle, sections, empty }
  const [extras, setExtras] = useState({}); // id → { headshot, strengths } (Snapshot)
  const [width, setWidth] = useState(800);
  const stageRef = useRef(null);

  // The list, rebuilt whenever an option that changes who's on it does.
  useEffect(() => {
    if (!building) return undefined;
    let live = true;
    setList(null);
    loadBoardList({ uid, cls, source, by, pos, limit, evals })
      .then((l) => live && setList(l))
      .catch((e) => { console.error("Board list load error:", e); if (live) setList({ title: "", subtitle: "", sections: [], empty: "Couldn't load that board." }); });
    return () => { live = false; };
  }, [building, uid, cls, source, by, pos, limit, evals]);

  // Snapshot: headshots and strengths for anyone not loaded yet.
  useEffect(() => {
    if (style !== "snapshot" || !list) return;
    const missing = [...new Set(list.sections.flatMap((s) => s.rows.map((r) => r.id)))].filter((id) => id && !(id in extras));
    if (!missing.length) return;
    loadSnapshotExtras(missing).then((x) => setExtras((e) => ({ ...e, ...x }))).catch(() => {});
  }, [style, list]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = useMemo(() => (list ? paginate(list.sections, { newPagePer: by === "position", style }) : []), [list, by, style]);
  const shown = list && { ...list, cls, extras };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [building]);
  const scale = Math.min(1, (width - 2) / F.w);

  const open = () => { setBuilding(true); onPreview(true); };
  const close = () => { setBuilding(false); setList(null); onPreview(false); };

  if (!building) {
    return section("boards", "📋 Board Lists", "Print a board round by round or position by position — yours from your Whiteboard, or the community's.", (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={open} style={btn(true)}>➕ Create a board list</button>
        <span style={{ fontSize: 12, color: "#667", fontFamily: BODY }}>Pick the class, board and layout next to the preview.</span>
      </div>
    ));
  }

  const ready = !!list && pages.length > 0;
  const user = source === "mine";
  const options = (
    <div style={{ ...card, padding: 14, display: "grid", gap: 12, alignContent: "start" }}>
      <span style={{ ...label, marginBottom: 0, color: "#0b1a2e", fontSize: 11 }}>Board list</span>
      {CLASSES.length > 1 && <div><span style={label}>Draft class</span><Seg value={cls} onChange={setCls} options={CLASSES.map((y) => [y, y])} /></div>}
      <div><span style={label}>Board</span><Seg value={source} onChange={setSource} options={[["mine", "My Whiteboard"], ["community", "Community"]]} /></div>
      <div><span style={label}>Organize</span><Seg value={by} onChange={setBy} options={[["round", "By round"], ["position", "By position"]]} /></div>
      <div>
        <span style={label}>Positions</span>
        <select value={pos} onChange={(e) => setPos(e.target.value)} style={{ width: "100%", border: "2px solid #d8e0ea", borderRadius: 8, padding: "7px 9px", fontSize: isMobile ? 16 : 13, fontFamily: BODY, fontWeight: 700 }}>
          <option value="ALL">All positions</option>
          {BOARD_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {!user && (
        <div>
          <span style={label}>{by === "round" ? "How many players" : "How many per position"}</span>
          <Seg value={String(limit)} onChange={(v) => setLimit(Number(v))} options={(by === "round" ? [50, 100, 200, 500] : [10, 25, 50, 100]).map((n) => [String(n), `${n}`])} />
        </div>
      )}
      <div><span style={label}>Style</span><Seg value={style} onChange={setStyle} options={[["compact", "Compact"], ["snapshot", "Snapshot"]]} /></div>
      <div style={{ fontSize: 11, color: "#667", fontFamily: BODY, lineHeight: 1.45 }}>
        {style === "snapshot" ? "Snapshot: a bigger look at each player — headshot, size and top strengths." : "Compact: one line a player."}
        {by === "position" ? " Each position starts a new page." : ""}
      </div>
      {user && <a href="/whiteboard" target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", padding: "6px 10px", border: `2px solid ${BLUE}`, borderRadius: 7, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", color: BLUE, textDecoration: "none" }}>📋 Open my Whiteboard ↗</a>}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...card, padding: isMobile ? 14 : 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={close} style={btn(false)}>← Back</button>
        <div style={{ fontSize: 13, color: "#556", fontFamily: BODY, fontWeight: 700 }}>
          {!list ? "Building your board…" : ready ? `${list.title} · ${pages.length} page${pages.length === 1 ? "" : "s"}` : list.empty}
        </div>
        <button type="button" onClick={() => printAs(`${list.title} - ${by === "round" ? "Round by Round" : "Position by Position"}${style === "snapshot" ? " (Snapshot)" : ""}`)} disabled={!ready} style={{ ...btn(true, !ready), marginLeft: "auto" }}>🖨️ Print</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "270px minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        {options}
        <div ref={stageRef} style={{ display: "grid", gap: 22, justifyItems: "center", minWidth: 0 }}>
          {!list && <LoadingSpinner size={32} minHeight="30vh" />}
          {list && !ready && <div style={{ ...card, padding: 18, fontSize: 14, color: "#556", fontFamily: BODY, justifySelf: "stretch" }}>{list.empty}</div>}
          {ready && pages.map((items, i) => (
            <div key={i} style={{ width: F.w * scale, height: F.h * scale, boxShadow: "0 6px 24px rgba(10,20,40,.18)", overflow: "hidden" }}>
              <div style={{ width: F.w, height: F.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                <BoardListPage list={shown} items={items} first={i === 0} user={user} bw={bw} style={style} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {ready && (
        <PrintRoot pageSize={F.pageSize}>
          {pages.map((items, i) => <BoardListPage key={i} list={shown} items={items} first={i === 0} user={user} bw={bw} style={style} />)}
        </PrintRoot>
      )}
    </div>
  );
}
