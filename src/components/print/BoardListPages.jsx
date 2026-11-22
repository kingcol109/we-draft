// src/components/print/BoardListPages.jsx
//
// A board list (utils/boardLists.js loadBoardList) as printed pages for
// Profile → My Binder: the personal print format — letter, centered, room
// to hole-punch, no page numbers. The first page opens with the list's
// title card; later pages carry a running head. Rows flow page to page;
// a section (a round, or a position) never starts with fewer than three
// rows left on a page, carries on with "(cont.)", and — position by
// position (newPagePer) — each position starts a new page so it can sit
// behind its own binder tab.
//
// Two styles:
//   compact — one line a player: rank · school logo · name · position ·
//     school · the round or overall rank (sub) · their grade (user lists) ·
//     the community grade · star / red flag (user lists).
//   snapshot — a bigger card a player: his headshot with the school logo,
//     name, position · school · height · weight, the community's top
//     strengths, and the grades (list.extras: utils/boardLists.js
//     loadSnapshotExtras).
import { TRIM_H, TRIM_W, PERSONAL_SIDE, PERSONAL_TOP } from "../../utils/printLayouts";
import { gradeLook } from "../../utils/gradeScale";
import { fmtInches } from "../../utils/boardLists";
import { useDisplayFont } from "./EvaluationPage";

const DISPLAY = "'WD Bebas', 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
const BODY = "Arial, Helvetica, sans-serif";
const INK = "#111418";
const MUTED = "#5b6472";
const RULE = "#d9dde3";
const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const FIRST_HEAD = 104; // the title card + gap
const RUN_HEAD = 40; // later pages' running head + gap
const FOOT = 34;
const COLS = 24; // the column headings
const SECTION = 32;
const ROW = 23;
const SNAP_ROW = 66;
const rowH = (style) => (style === "snapshot" ? SNAP_ROW : ROW);

// Grade label → a short form for the list ("Early 1st", "2nd", "UDFA").
const shortGrade = (label) => {
  if (!label) return "";
  if (/First Round$/.test(label)) return `${label.replace(" First Round", "")} 1st`;
  if (label === "Watchlist" || label === "UDFA") return label;
  return gradeLook(label).short;
};

// → [[item, …], …] — items: { type: "section", title, cont } | { type: "row", … }
export function paginate(sections, { newPagePer = false, style = "compact" } = {}) {
  const ROW = rowH(style);
  const body = TRIM_H - PERSONAL_TOP * 2 - FOOT - (style === "snapshot" ? 0 : COLS);
  const capOf = (i) => body - (i === 0 ? FIRST_HEAD : RUN_HEAD);
  const pages = [[]];
  let used = 0;
  const next = () => { pages.push([]); used = 0; };
  const cur = () => pages[pages.length - 1];
  sections.forEach((s) => {
    if (newPagePer && cur().length) next();
    if (used + SECTION + Math.min(style === "snapshot" ? 2 : 3, s.rows.length) * ROW > capOf(pages.length - 1)) next();
    cur().push({ type: "section", title: s.title, count: s.rows.length });
    used += SECTION;
    s.rows.forEach((r) => {
      if (used + ROW > capOf(pages.length - 1)) {
        next();
        cur().push({ type: "section", title: s.title, cont: true });
        used += SECTION;
      }
      cur().push({ type: "row", ...r });
      used += ROW;
    });
  });
  return pages.filter((p) => p.length);
}

/**
 * One printed page of a board list. list: { title, subtitle, cls };
 * items: this page's (paginate); first: the first page; user: a user list
 * (their grade + star / flag columns); bw: black and white.
 */
export function BoardListPage({ list, items, first, user, bw, style = "compact" }) {
  useDisplayFont();
  const W = TRIM_W;
  const accent = bw ? INK : BLUE;
  const accent2 = bw ? "#8a929e" : GOLD;
  const col = { fontSize: 8.5, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" };
  const grid = user
    ? "38px 22px minmax(0, 1fr) 44px 128px 42px 74px 74px 26px"
    : "38px 22px minmax(0, 1fr) 44px 150px 46px 90px";
  return (
    <div className="wd-print-page" style={{ position: "relative", width: W, height: TRIM_H, background: "#fff", overflow: "hidden", fontFamily: BODY, color: INK, boxSizing: "border-box", padding: `${PERSONAL_TOP}px ${PERSONAL_SIDE}px`, filter: bw ? "grayscale(1)" : undefined }}>
      {first ? (
        <div style={{ height: FIRST_HEAD - 14, marginBottom: 14, boxSizing: "border-box", border: `1px solid ${RULE}`, borderBottom: `6px solid ${accent}`, borderRadius: 12, padding: "14px 22px", display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.22em", textTransform: "uppercase", color: MUTED }}>{user ? "My Board" : "Community Board"}</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 40, lineHeight: 0.95, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{list.title}</div>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: accent, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 3 }}>{list.subtitle}</div>
          </div>
          <div style={{ flexShrink: 0, background: accent, color: "#fff", fontFamily: DISPLAY, fontSize: 22, letterSpacing: "0.06em", padding: "8px 12px 6px", borderBottom: `3px solid ${accent2}`, textAlign: "center", lineHeight: 1 }}>
            {list.cls}<div style={{ fontSize: 11, letterSpacing: "0.14em", marginTop: 2 }}>Draft Class</div>
          </div>
        </div>
      ) : (
        <div style={{ height: RUN_HEAD - 12, marginBottom: 12, display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderBottom: `2px solid ${accent}` }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 20, color: INK, letterSpacing: "0.04em" }}>{list.title}</span>
          <span style={{ fontSize: 9.5, fontWeight: 900, color: MUTED, letterSpacing: "0.12em", textTransform: "uppercase", paddingBottom: 3 }}>{list.subtitle}</span>
        </div>
      )}

      {/* Column headings (compact) */}
      {style !== "snapshot" && <div style={{ display: "grid", gridTemplateColumns: grid, alignItems: "end", gap: 6, height: COLS, borderBottom: `1.5px solid ${INK}`, paddingBottom: 3, boxSizing: "border-box" }}>
        <span style={col}>#</span><span />
        <span style={col}>Player</span>
        <span style={col}>Pos</span>
        <span style={col}>School</span>
        <span style={{ ...col, textAlign: "center" }}>{user ? "Rd" : "Ovr"}</span>
        {user && <span style={col}>My grade</span>}
        <span style={col}>Community</span>
        {user && <span />}
      </div>}

      {items.map((it, i) => (it.type === "section" ? (
        <div key={i} style={{ height: SECTION, display: "flex", alignItems: "flex-end", gap: 8, paddingBottom: 4, boxSizing: "border-box" }}>
          <span style={{ width: 5, height: 18, background: accent }} />
          <span style={{ fontFamily: DISPLAY, fontSize: 19, letterSpacing: "0.06em", color: INK, lineHeight: 1 }}>{it.title}{it.cont ? " (cont.)" : ""}</span>
          {!it.cont && it.count != null && <span style={{ fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", paddingBottom: 1 }}>{it.count} player{it.count === 1 ? "" : "s"}</span>}
          <span style={{ flex: 1, height: 1, background: RULE, marginBottom: 5 }} />
        </div>
      ) : style === "snapshot" ? (
        <SnapshotRow key={i} it={it} user={user} accent={accent} extra={list.extras?.[it.id]} />
      ) : (
        <div key={i} style={{ display: "grid", gridTemplateColumns: grid, alignItems: "center", gap: 6, height: ROW, borderBottom: `1px solid ${RULE}`, boxSizing: "border-box" }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 17, color: accent, lineHeight: 1 }}>{it.rank}</span>
          {it.logo ? <img draggable={false} src={it.logo} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} /> : <span />}
          <span style={{ minWidth: 0, fontSize: 11.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {it.first} {it.last}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 900, color: MUTED }}>{it.pos}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.school}</span>
          <span style={{ fontSize: 10, fontWeight: 900, color: MUTED, textAlign: "center" }}>{it.sub || ""}</span>
          {user && <GradePill label={it.mine} />}
          <span style={{ fontSize: 10, fontWeight: 800, color: INK, whiteSpace: "nowrap" }}>{shortGrade(it.community) || "–"}</span>
          {user && <span style={{ fontSize: 11, fontWeight: 900, color: it.flagged ? "#b91c1c" : "#b7791f", textAlign: "center" }}>{it.starred ? "★" : ""}{it.flagged ? "⚑" : ""}</span>}
        </div>
      )))}

      <div style={{ position: "absolute", left: PERSONAL_SIDE, right: PERSONAL_SIDE, bottom: PERSONAL_TOP - 22, height: 20, display: "flex", justifyContent: "center", gap: 8, borderTop: `1px solid ${RULE}`, paddingTop: 6, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED }}>
        <span>We-Draft.com · {user ? "My Board" : "Community Board"}</span>
      </div>
    </div>
  );
}

function GradePill({ label }) {
  if (!label) return <span style={{ fontSize: 10, color: MUTED }}>–</span>;
  const look = gradeLook(label);
  return (
    <span style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 4, background: look.bg, color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 9.5, fontWeight: 900, whiteSpace: "nowrap" }}>
      {shortGrade(label)}
    </span>
  );
}

// The Snapshot style's row: a bigger look at each player.
function SnapshotRow({ it, user, accent, extra }) {
  const size = [fmtInches(it.ht), it.wt ? `${Math.round(it.wt)} lbs` : ""].filter(Boolean).join(" · ");
  const strengths = (extra?.strengths || []).slice(0, 3);
  const look = it.community ? gradeLook(it.community) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, height: SNAP_ROW, borderBottom: `1px solid ${RULE}`, boxSizing: "border-box" }}>
      <div style={{ width: 44, flexShrink: 0, textAlign: "center" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 30, lineHeight: 0.9, color: accent }}>{it.rank}</div>
        {it.sub && <div style={{ fontSize: 9, fontWeight: 900, color: MUTED, marginTop: 2 }}>{it.sub}</div>}
      </div>
      <div style={{ position: "relative", width: 58, height: 56, flexShrink: 0, borderRadius: 8, background: "#f1f3f6", overflow: "hidden" }}>
        {extra?.headshot && <img draggable={false} src={extra.headshot} alt="" style={{ position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />}
        {it.logo && (
          <span style={{ position: "absolute", right: 2, bottom: 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 1px #d9dde3" }}>
            <img draggable={false} src={it.logo} alt="" style={{ width: 15, height: 15, objectFit: "contain" }} />
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.first} {it.last}</span>
          {user && (it.starred || it.flagged) && <span style={{ fontSize: 13, fontWeight: 900, color: it.flagged ? "#b91c1c" : "#b7791f" }}>{it.starred ? "★" : ""}{it.flagged ? "⚑" : ""}</span>}
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: MUTED, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[it.pos, it.school, size].filter(Boolean).join("  ·  ")}
        </div>
        {strengths.length > 0 && (
          <div style={{ display: "flex", gap: 5, marginTop: 4, overflow: "hidden" }}>
            {strengths.map((t) => (
              <span key={t} style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 900, color: "#15803d", background: "#ecf7ef", padding: "2px 5px", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{t}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{ width: 128, flexShrink: 0, display: "grid", gap: 4, justifyItems: "end" }}>
        {user && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 8, fontWeight: 900, color: MUTED, letterSpacing: "0.08em" }}>MY GRADE</span>
            <GradePill label={it.mine} />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 8, fontWeight: 900, color: MUTED, letterSpacing: "0.08em" }}>COMMUNITY</span>
          {user || !look
            ? <span style={{ fontSize: 10, fontWeight: 900, color: INK }}>{shortGrade(it.community) || "–"}</span>
            : <GradePill label={it.community} />}
        </div>
      </div>
    </div>
  );
}
