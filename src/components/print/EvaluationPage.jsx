// src/components/print/EvaluationPage.jsx
//
// One printed evaluation page — a player page on paper, one player per
// page, drawn at true size (96 px/in). Two formats (utils/printLayouts.js
// FORMATS):
//   • "spread" — the magazine: 840 × 1080 px = 8.75 × 11.25 in, the
//     8.5 × 11 trim plus a 0.125 in bleed. `side` ("left" / "right")
//     mirrors it: the gutter (binding) margin is wider, the page number sits
//     on the outside corner, the sidebar and headshot follow the layout's
//     outside / inside setting, and the header band runs off the edges.
//   • "personal" — a user printing their own evaluation at home: letter
//     size with no bleed, centered (equal 0.75 in side margins, room for a
//     3-hole punch), the header inset as a card, no page number. With
//     `data.mine` (their own evaluation) the grade, traits, fit and report
//     are theirs; the community's grade stays alongside for comparison.
// The layout decides which blocks show, in which column and in what order.
//
// Anything marked wd-print-screen-only (guides, overflow warning) is for
// the editor and never prints.
import { useLayoutEffect, useRef, useState } from "react";
import BebasNeue from "../../assets/fonts/BebasNeue-Regular.ttf";
import { BLEED, GUTTER, MARGIN, PAGE_H, PAGE_W, TRIM_H, TRIM_W, PERSONAL_SIDE, PERSONAL_TOP, PUNCH_HOLES } from "../../utils/printLayouts";
import { GRADE_SCALE, gradeLook } from "../../utils/gradeScale";
import { textOn } from "../../utils/teamColors";
import { useCareerPath } from "../PlayerEligibilityInfo";
import StateShape from "../StateShape";

const DISPLAY = "'WD Bebas', 'Bebas Neue', Impact, 'Arial Narrow', sans-serif";
const BODY = "Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const INK = "#111418";
const MUTED = "#5b6472";
const RULE = "#d9dde3";
const RULE_DARK = "#9aa3ae";
const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";
const GOOD = "#15803d";
const BAD = "#b91c1c";

let fontInjected = false;
export function useDisplayFont() {
  if (fontInjected || typeof document === "undefined") return;
  fontInjected = true;
  const st = document.createElement("style");
  st.textContent = `@font-face{font-family:'WD Bebas';src:url(${BebasNeue}) format('truetype');font-display:block;}`;
  document.head.appendChild(st);
}

const HEADER_H = 205; // spread: from the trim's top edge
const PERSONAL_HEADER_H = 180; // personal: the inset card
const FOOTER_H = 34;

// About how wide Bebas runs per character, for fitting the last name.
const fit = (text, max, width, min = 36) => Math.max(min, Math.min(max, Math.floor(width / (Math.max(1, text.length) * 0.43))));
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function Heading({ children, c }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
      <span style={{ width: 4, height: 16, background: c.accent, borderRadius: 1 }} />
      <span style={{ fontFamily: DISPLAY, fontSize: 21, letterSpacing: "0.06em", color: INK, lineHeight: 1 }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: RULE }} />
    </div>
  );
}

function Rows({ rows }) {
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "3px 0", borderBottom: `1px solid ${RULE}`, fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10, flexShrink: 0 }}>{r.label}</span>
          <span style={{ marginLeft: "auto", fontWeight: 800, color: INK, textAlign: "right" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ fontSize: 11, color: MUTED, fontStyle: "italic" }}>{children}</div>;
}

function GradeBadge({ label, size = 74 }) {
  const look = gradeLook(label);
  return (
    <div style={{ width: size, height: size, flexShrink: 0, borderRadius: 10, background: look.bg, border: `3px solid ${look.border}`, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
      {look.qualifier && <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", opacity: 0.9 }}>{look.qualifier}</span>}
      <span style={{ fontFamily: DISPLAY, fontSize: size * 0.54, lineHeight: 0.9 }}>{look.short}</span>
    </div>
  );
}

// ── Blocks ── each gets the player's data, the layout, the colors and its
// zone ("side" — narrow, or "main" — wide).
const BLOCK_VIEWS = {
  grade({ d, c, zone }) {
    const cm = d.community;
    const mine = d.mine;
    // Fill-in: every round as a bubble to darken.
    if (d.blank) {
      return (
        <>
          <Heading c={c}>My Grade</Heading>
          <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Darken one</div>
          <div style={{ display: "grid", gridTemplateColumns: zone === "side" ? "1fr 1fr" : "repeat(5, 1fr)", gap: "7px 10px" }}>
            {BUBBLE_GRADES.map(([label, short]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 15, height: 15, flexShrink: 0, borderRadius: "50%", border: `1.6px solid ${INK}`, boxSizing: "border-box" }} />
                <span style={{ fontSize: 10.5, fontWeight: 900, color: INK, textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>{short}</span>
              </div>
            ))}
          </div>
        </>
      );
    }
    // Personal: their grade, the community's underneath.
    if (mine) {
      const graded = mine.grade && (GRADE_SCALE[mine.grade] || mine.grade === "Watchlist");
      return (
        <>
          <Heading c={c}>My Grade</Heading>
          {graded ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <GradeBadge label={mine.grade} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: DISPLAY, fontSize: zone === "side" ? 22 : 28, lineHeight: 1, color: INK }}>{mine.grade}</div>
                {cm.label && <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginTop: 4 }}>Community: {cm.label} ({cm.count} grade{cm.count === 1 ? "" : "s"})</div>}
              </div>
            </div>
          ) : <Empty>No grade given.</Empty>}
        </>
      );
    }
    if (!cm.label) return (<><Heading c={c}>Community Grade</Heading><Empty>Not graded yet.</Empty></>);
    return (
      <>
        <Heading c={c}>Community Grade</Heading>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <GradeBadge label={cm.label} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: zone === "side" ? 22 : 28, lineHeight: 1, color: INK }}>{cm.label}</div>
            <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, marginTop: 4 }}>
              {cm.count} community grade{cm.count === 1 ? "" : "s"} · avg {cm.avg.toFixed(1)}
            </div>
          </div>
        </div>
      </>
    );
  },

  // Community pages: the class ranks. A user's own page: their ranks —
  // from their grades or their Whiteboard (layout.rankSource; d.myRanks,
  // utils/printLayouts.js loadMyRanks) — else the community's when there
  // are none (the admin preview). Fill-in: boxes to write the ranks in.
  // The draft class is spelled out on a banner over the boxes.
  ranks({ d, c, layout }) {
    const cls = String(d.eligible || "").replace(/s$/i, "");
    const banner = (text) => (
      <div style={{ background: c.accent, color: textOn(c.accent, c.accent2), fontFamily: DISPLAY, fontSize: 16, letterSpacing: "0.08em", lineHeight: 1, padding: "5px 8px 4px", marginBottom: 6 }}>{text}</div>
    );
    const box = (n, label, sub) => (
      <div style={{ flex: 1, minWidth: 0, border: `1px solid ${RULE}`, borderTop: `3px solid ${c.accent}`, padding: "6px 8px" }}>
        <div style={{ fontSize: 9, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 32, lineHeight: 1, color: INK, marginTop: 2 }}>{n == null ? <span style={{ display: "inline-block", width: "70%", borderBottom: `1.5px solid ${INK}`, height: 26, verticalAlign: "bottom" }}>#</span> : `#${n}`}</div>
        {sub && <div style={{ fontSize: 8.5, fontWeight: 700, color: MUTED, marginTop: 2 }}>{sub}</div>}
      </div>
    );
    if (d.blank) {
      return (
        <>
          <Heading c={c}>My Rank</Heading>
          {banner(`${cls} Draft Class`)}
          <div style={{ display: "flex", gap: 8 }}>
            {box(null, "Overall", `in the ${cls} class`)}
            {box(null, `Among ${d.position}s`, `in the ${cls} class`)}
          </div>
        </>
      );
    }
    if (d.mine && d.myRanks) {
      const wb = layout.rankSource === "whiteboard";
      const r = d.myRanks[wb ? "whiteboard" : "mine"];
      return (
        <>
          <Heading c={c}>{wb ? "My Whiteboard" : "My Rank"}</Heading>
          {r ? (
            <>
              {banner(`${r.cls} Draft Class`)}
              <div style={{ display: "flex", gap: 8 }}>
                {r.classRank > 0 && box(r.classRank, "Overall", `of ${r.classOf} ${wb ? "on my board" : "I've graded"}`)}
                {r.positionRank > 0 && box(r.positionRank, `Among ${r.pos}s`, `of ${r.positionOf}`)}
              </div>
              {wb && r.round && <div style={{ fontSize: 10, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 5 }}>On my board: {r.round}</div>}
            </>
          ) : <Empty>{wb ? `Not on my ${cls} Whiteboard yet.` : "Grade him to rank him."}</Empty>}
        </>
      );
    }
    const r = d.ranks;
    if (!r?.classRank && !r?.positionRank) return null;
    return (
      <>
        <Heading c={c}>{d.mine ? "Community Rank" : "Class Rank"}</Heading>
        {banner(`${cls} Draft Class`)}
        <div style={{ display: "flex", gap: 8 }}>
          {r.classRank && box(r.classRank, "Overall")}
          {r.positionRank && box(r.positionRank, `Among ${d.position}s`)}
        </div>
      </>
    );
  },

  measurables({ d, c }) {
    if (!d.measurables.length) return null;
    return (<><Heading c={c}>Measurables</Heading><Rows rows={d.measurables} /></>);
  },

  bio({ d, c }) {
    if (!d.bio.length) return null;
    return (<><Heading c={c}>Bio</Heading><Rows rows={d.bio} /></>);
  },

  // The player page Info tab's Career Path (PlayerEligibilityInfo
  // useCareerPath): colleges newest first with logos and accolades, then
  // the high school with its recruiting line.
  career({ d, c }) {
    if (!d.player) return null;
    return <CareerPathPrint d={d} c={c} />;
  },

  // College stats (ESPN): the lead category as a showcase — its career
  // totals as big numbers, a season-by-season bar chart of its headline
  // stat with the best season called out — then a table for each category.
  // The side column gets just the big numbers.
  stats({ d, c, zone }) {
    if (!d.stats?.length) return null;
    return <StatsShowcase stats={d.stats} c={c} zone={zone} />;
  },

  traits({ d, c, zone }) {
    const mine = d.mine;
    if (d.blank) {
      const col = (title, color) => (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 900, color, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>{title}</div>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 24 }}>
              <span style={{ fontSize: 10, fontWeight: 900, color, width: 10 }}>{n}</span>
              <span style={{ flex: 1, borderBottom: `1px solid ${INK}`, height: 18 }} />
            </div>
          ))}
        </div>
      );
      return (
        <>
          <Heading c={c}>Strengths & Weaknesses</Heading>
          <div style={{ display: "flex", flexDirection: zone === "side" ? "column" : "row", gap: zone === "side" ? 10 : 22 }}>
            {col("Strengths", GOOD)}
            {col("Weaknesses", BAD)}
          </div>
        </>
      );
    }
    const strengths = mine ? mine.strengths.map((term) => ({ term })) : d.community.strengths;
    const weaknesses = mine ? mine.weaknesses.map((term) => ({ term })) : d.community.weaknesses;
    if (!strengths.length && !weaknesses.length) return (<><Heading c={c}>Strengths & Weaknesses</Heading><Empty>No traits picked yet.</Empty></>);
    const list = (title, items, color) => (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 900, color, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{title}</div>
        {items.length ? items.map((t) => (
          <div key={t.term} style={{ marginBottom: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, color: INK, textTransform: "uppercase", letterSpacing: "0.02em" }}>
              {t.pct == null && <span style={{ width: 6, height: 6, background: color, flexShrink: 0 }} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.term}</span>
              {t.pct != null && <span style={{ marginLeft: "auto", paddingLeft: 6, color: MUTED, fontSize: 10 }}>{Math.round(t.pct)}%</span>}
            </div>
            {t.pct != null && (
              <div style={{ height: 5, background: "#eef0f3", marginTop: 2 }}>
                <div style={{ height: "100%", width: `${Math.min(100, t.pct)}%`, background: color }} />
              </div>
            )}
          </div>
        )) : <Empty>None</Empty>}
      </div>
    );
    return (
      <>
        <Heading c={c}>Strengths & Weaknesses</Heading>
        <div style={{ display: "flex", flexDirection: zone === "side" ? "column" : "row", gap: zone === "side" ? 10 : 22 }}>
          {list("Strengths", strengths, GOOD)}
          {list("Weaknesses", weaknesses, BAD)}
        </div>
      </>
    );
  },

  fits({ d, c }) {
    if (d.blank) {
      return (
        <>
          <Heading c={c}>My NFL Fit</Heading>
          <div style={{ display: "flex", gap: 18 }}>
            {["Best fit", "Also fits"].map((t) => (
              <div key={t} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 6, height: 22 }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{t}</span>
                <span style={{ flex: 1, borderBottom: `1px solid ${INK}`, height: 16 }} />
              </div>
            ))}
          </div>
        </>
      );
    }
    const fits = d.mine ? (d.mine.nflFit ? [{ team: d.mine.nflFit }] : []) : d.community.fits;
    if (!fits.length) return null;
    // Each team with its logo (d.nflLogos), the community's top fit outlined.
    return (
      <>
        <Heading c={c}>{d.mine ? "My NFL Fit" : "Best NFL Fits"}</Heading>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {fits.map((f, i) => {
            const logo = d.nflLogos?.[f.team] || "";
            return (
              <div key={f.team} style={{ display: "flex", alignItems: "center", gap: 8, border: `1.5px solid ${i === 0 ? c.accent : RULE}`, padding: "5px 10px 5px 6px" }}>
                {logo && <img draggable={false} src={logo} alt="" style={{ width: 30, height: 30, objectFit: "contain" }} />}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: INK, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.15 }}>{f.team}</div>
                  {f.count != null && <div style={{ fontSize: 9, fontWeight: 700, color: MUTED }}>{f.count} vote{f.count === 1 ? "" : "s"}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  },

  // Elastic: takes whatever height the column has left (see Column).
  reports({ d, c, layout }) {
    if (d.blank) {
      return (
        <>
          <Heading c={c}>My Evaluation</Heading>
          <div style={{ flex: "1 1 0", minHeight: 0, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent 25px, ${RULE_DARK} 25px, ${RULE_DARK} 26px)` }} />
          <div style={{ display: "flex", gap: 18, marginTop: 8 }}>
            {["Scouted by", "Date"].map((t, i) => (
              <div key={t} style={{ flex: i ? "0 0 150px" : 1, display: "flex", alignItems: "flex-end", gap: 6, height: 20 }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{t}</span>
                <span style={{ flex: 1, borderBottom: `1px solid ${INK}`, height: 14 }} />
              </div>
            ))}
          </div>
        </>
      );
    }
    if (d.mine) {
      const r = d.mine;
      return (
        <>
          <Heading c={c}>My Evaluation</Heading>
          {r.text
            ? <ReportsFit list={[{ text: r.text, by: r.by, byline: [r.by && `Scouted by ${r.by}`, fmtDate(r.at)].filter(Boolean).join(" · ") }]} c={c} maxLines={layout.reportLines || 60} />
            : <Empty>No written evaluation.</Empty>}
        </>
      );
    }
    // Community pages: no scouting reports.
    return null;
  },

  notes({ c, layout }) {
    return (
      <>
        <Heading c={c}>Notes</Heading>
        {Array.from({ length: layout.notesLines || 6 }).map((_, i) => (
          <div key={i} style={{ height: 26, borderBottom: `1px solid ${RULE}` }} />
        ))}
      </>
    );
  },
};

// The fill-in page's grade bubbles.
const BUBBLE_GRADES = [
  ["Early First Round", "Early 1st"], ["Middle First Round", "Mid 1st"], ["Late First Round", "Late 1st"],
  ["Second Round", "2nd Rd"], ["Third Round", "3rd Rd"], ["Fourth Round", "4th Rd"], ["Fifth Round", "5th Rd"],
  ["Sixth Round", "6th Rd"], ["Seventh Round", "7th Rd"], ["UDFA", "UDFA"],
];

// The stats a category leads with (ESPN labels) — the first is the one
// charted by season.
const STAT_KEYS = {
  passing: ["YDS", "TD", "CMP%", "INT"], rushing: ["YDS", "TD", "AVG", "CAR"], receiving: ["YDS", "TD", "REC", "AVG"],
  defensive: ["TOT", "SACK", "TFL", "PD", "INT", "FF"], interceptions: ["INT", "YDS", "TD"],
  kicking: ["FGM", "FG%", "LNG", "PTS"], punting: ["AVG", "LNG", "IN 20"],
};
const STAT_WORDS = { YDS: "Yards", TD: "Touchdowns", REC: "Receptions", AVG: "Per Catch", CAR: "Carries", "CMP%": "Comp %", INT: "Interceptions", TOT: "Tackles", SACK: "Sacks", TFL: "For Loss", PD: "Passes Defended", FF: "Forced Fumbles", FGM: "Field Goals", "FG%": "FG %", LNG: "Long", PTS: "Points", "IN 20": "Inside 20" };
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

function StatsShowcase({ stats, c, zone }) {
  const lead = stats[0];
  const key = (lead.key || "").toLowerCase();
  const wanted = (STAT_KEYS[key] || lead.labels).filter((l) => lead.labels.includes(l));
  const tiles = (wanted.length ? wanted : lead.labels).slice(0, zone === "side" ? 4 : 4);
  const idx = (l) => lead.labels.indexOf(l);
  const chartLabel = tiles[0];
  const ci = idx(chartLabel);
  const seasons = lead.rows.map((r) => ({ ...r, v: num(r.stats[ci]) }));
  const best = seasons.reduce((b, x) => (x.v > (b?.v ?? -1) ? x : b), null);
  const word = (l) => STAT_WORDS[l] ? (key === "rushing" && l === "AVG" ? "Per Carry" : STAT_WORDS[l]) : l;
  const total = (l) => (lead.totals ? lead.totals[idx(l)] : lead.rows[lead.rows.length - 1]?.stats[idx(l)]) ?? "–";
  const th = { padding: "3px 4px", fontSize: 8.5, fontWeight: 900, color: MUTED, letterSpacing: "0.06em", textAlign: "right", borderBottom: `1.5px solid ${INK}`, whiteSpace: "nowrap" };
  const td = { padding: "2.5px 4px", fontSize: 10.5, fontWeight: 700, color: INK, textAlign: "right", borderBottom: `1px solid ${RULE}`, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  return (
    <>
      <Heading c={c}>College Stats</Heading>
      {/* Career totals, big */}
      <div style={{ fontSize: 9, fontWeight: 900, color: c.accent, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
        Career {lead.title}{lead.rows.length ? ` · ${lead.rows[0].year}–${lead.rows[lead.rows.length - 1].year}` : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${zone === "side" ? 2 : tiles.length}, 1fr)`, gap: 6 }}>
        {tiles.map((l, i) => (
          <div key={l} style={{ background: i === 0 ? c.accent : "#f3f5f8", color: i === 0 ? textOn(c.accent, c.accent2) : INK, padding: "7px 9px 6px", borderBottom: `3px solid ${c.accent2}` }}>
            <div style={{ fontFamily: DISPLAY, fontSize: zone === "side" ? 30 : 40, lineHeight: 0.9, letterSpacing: "0.01em" }}>{total(l)}</div>
            <div style={{ fontSize: 8.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 3, opacity: i === 0 ? 0.9 : 0.65 }}>{word(l)}</div>
          </div>
        ))}
      </div>
      {zone !== "side" && seasons.length > 0 && (
        <>
          {/* The lead category season by season — the best season in
              color with a star (the career row is the big numbers above). */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BODY, marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Season</th>
                <th style={{ ...th, textAlign: "left" }}>Team</th>
                {lead.labels.slice(0, 9).map((l, i) => <th key={i} style={th}>{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {seasons.map((r, i) => {
                const top = r === best && seasons.length > 1;
                const cell = top ? { color: c.accent, fontWeight: 900 } : null;
                return (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: "left", color: top ? c.accent : MUTED, fontWeight: top ? 900 : 700 }}>{top ? "★ " : ""}{r.year}</td>
                    <td style={{ ...td, textAlign: "left", ...cell }}>{r.team}</td>
                    {lead.labels.slice(0, 9).map((_, k) => <td key={k} style={{ ...td, ...cell }}>{r.stats[k] ?? ""}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Any other category: one career line */}
          {stats.slice(1).map((t) => {
            const keys = (STAT_KEYS[(t.key || "").toLowerCase()] || t.labels).filter((l) => t.labels.includes(l)).slice(0, 4);
            const tot = t.totals || t.rows[t.rows.length - 1]?.stats || [];
            return (
              <div key={t.title} style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6, fontSize: 10.5, fontWeight: 800, color: INK }}>
                <span style={{ fontSize: 8.5, fontWeight: 900, color: c.accent, textTransform: "uppercase", letterSpacing: "0.1em" }}>Career {t.title}</span>
                {keys.map((l) => <span key={l}><b style={{ fontWeight: 900 }}>{tot[t.labels.indexOf(l)] ?? "–"}</b> <span style={{ color: MUTED, fontSize: 9 }}>{l}</span></span>)}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

// The Career Path, as the Info tab draws it but sized for paper: a logo in
// a ring for each stop (filled in the school's color for the current one),
// joined by a line; the name, its tag (JUCO / High School) and years; the
// location; up to three accolades under it.
const STOP = 26;
const MAX_ACCOLADES = 3;
const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
function CareerPathPrint({ d, c }) {
  const { rows } = useCareerPath(d.player, d.espnId);
  if (!rows.length) return null;
  return (
    <>
      <Heading c={c}>Career Path</Heading>
      <div>
        {rows.map((r, i) => {
          const last = i === rows.length - 1;
          const c1 = isHex(r.brand?.Color1) ? r.brand.Color1 : "#8a929e";
          const filled = r.current && isHex(r.brand?.Color1);
          const logo = filled ? r.brand.LogoDark || r.brand.Logo1 : r.brand?.Logo1;
          const acc = (r.accolades || []).slice(0, MAX_ACCOLADES);
          return (
            <div key={r.key} style={{ position: "relative", display: "flex", gap: 9, paddingBottom: last ? 0 : 8 }}>
              {!last && <span style={{ position: "absolute", left: STOP / 2 - 1, top: STOP / 2, bottom: -STOP / 2 + 8, width: 2, background: RULE }} />}
              <div style={{
                position: "relative", flexShrink: 0, width: STOP, height: STOP, borderRadius: "50%", background: filled ? c1 : "#fff",
                boxShadow: `0 0 0 2px ${r.current ? (filled && isHex(r.brand?.Color2) ? r.brand.Color2 : c1) : RULE}`,
                display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
              }}>
                {logo
                  ? <img draggable={false} src={logo} alt="" style={{ width: "74%", height: "74%", objectFit: "contain" }} />
                  : r.state ? <StateShape abbr={r.state} size={17} glow={false} />
                  : <span style={{ fontSize: 8, fontWeight: 900, color: filled ? "#fff" : MUTED }}>{r.fallback || String(r.name || "").split(/\s+/).map((w) => w[0]).join("").slice(0, 3)}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ minWidth: 0, fontSize: 11, lineHeight: "13px", fontWeight: 900, color: INK, textTransform: "uppercase", letterSpacing: "0.02em" }}>{r.name}</span>
                  {r.label && <span style={{ flexShrink: 0, fontSize: 7.5, fontWeight: 900, color: MUTED, background: "#eef1f5", padding: "1px 3px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{r.label === "High School" ? "HS" : r.label}</span>}
                  {r.span && <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 9.5, fontWeight: 900, color: r.current ? c1 : MUTED, whiteSpace: "nowrap" }}>{r.span}</span>}
                </div>
                {r.sub && <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, marginTop: 1 }}>{r.sub}</div>}
                {acc.map((a) => (
                  <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, fontSize: 9, fontWeight: 800, color: "#8a5a00", lineHeight: 1.2 }}>
                    {a.icon ? <img draggable={false} src={a.icon} alt="" style={{ width: 11, height: 11, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ flexShrink: 0 }}>★</span>}
                    <span>{a.text}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// The scouting reports, fitted to the room they're given: each gets up to
// maxLines, ending at a whole line ("…"); a report that would get fewer
// than 3 lines is left off, along with any after it. Measured off an
// unclamped, invisible copy of the same texts at the same width.
const REPORT_FONT = 12.5;
const REPORT_LH = REPORT_FONT * 1.5;
const BYLINE_H = 18;
const REPORT_GAP = 12;
const reportText = { fontFamily: SERIF, fontSize: REPORT_FONT, lineHeight: 1.5, color: "#262b33", whiteSpace: "pre-line" };

function ReportsFit({ list, c, maxLines }) {
  const boxRef = useRef(null);
  const measureRef = useRef(null);
  const [lines, setLines] = useState(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const meas = measureRef.current;
    if (!box || !meas) return undefined;
    const fitLines = () => {
      const avail = box.clientHeight;
      const out = [];
      let used = 0;
      let stopped = false;
      Array.from(meas.children).forEach((el, i) => {
        const natural = Math.max(1, Math.round(el.offsetHeight / REPORT_LH));
        const room = avail - used - BYLINE_H - (i ? REPORT_GAP : 0);
        const n = Math.min(natural, maxLines, Math.floor(room / REPORT_LH));
        if (stopped || n < Math.min(3, natural)) { stopped = true; out.push(0); return; }
        out.push(n);
        used += n * REPORT_LH + BYLINE_H + (i ? REPORT_GAP : 0);
      });
      setLines((prev) => (prev && prev.join() === out.join() ? prev : out));
    };
    fitLines();
    const ro = new ResizeObserver(fitLines);
    ro.observe(box);
    return () => ro.disconnect();
  }, [list, maxLines]);
  return (
    <div ref={boxRef} style={{ position: "relative", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
      <div ref={measureRef} aria-hidden="true" style={{ position: "absolute", left: 15, right: 0, top: 0, visibility: "hidden", pointerEvents: "none" }}>
        {list.map((r, i) => <div key={i} style={reportText}>{r.text}</div>)}
      </div>
      {list.map((r, i) => {
        const n = lines ? lines[i] : maxLines;
        if (!n) return null;
        return (
          <div key={i} style={{ marginTop: i ? REPORT_GAP : 0, paddingLeft: 12, borderLeft: `3px solid ${c.accent2}` }}>
            <div style={{ ...reportText, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: n, overflow: "hidden" }}>{r.text}</div>
            <div style={{ height: BYLINE_H, boxSizing: "border-box", paddingTop: 5, fontSize: 10, fontWeight: 900, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              — {r.byline || `${r.by}${r.verified ? " ✓" : ""}${r.grade ? ` · ${r.grade}` : ""}`}
            </div>
          </div>
        );
      })}
      {lines && !lines[0] && <div className="wd-print-screen-only" style={{ fontSize: 11, color: "#c0392b", fontWeight: 800 }}>No room for a report here — move or turn off a block.</div>}
    </div>
  );
}

function Column({ blocks, d, c, layout, zone, onOverflow }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => onOverflow(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    Array.from(el.children).forEach((ch) => ro.observe(ch));
    ro.observe(el);
    return () => ro.disconnect();
  });
  return (
    <div ref={ref} style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", gap: 16 }}>
      {blocks.map((b) => {
        const View = BLOCK_VIEWS[b.key];
        const out = View ? View({ d, c, layout, zone }) : null;
        if (!out) return null;
        // The reports stretch into whatever height is left.
        return b.key === "reports"
          ? <section key={b.key} style={{ flex: "1 1 0", minHeight: 60, display: "flex", flexDirection: "column" }}>{out}</section>
          : <section key={b.key} style={{ flexShrink: 0 }}>{out}</section>;
      })}
    </div>
  );
}

/**
 * data: utils/printLayouts.js loadPrintPlayer() (+ `mine` for a personal
 * page) · layout: the normalized layout · format: "spread" | "personal" ·
 * side: "left" | "right" (spread) · page: the page number (spread) ·
 * guides: show trim / bleed / safe lines and punch holes (screen only).
 */
export default function EvaluationPage({ data: d, layout, format = "spread", side = "right", page, guides = true }) {
  useDisplayFont();
  const [over, setOver] = useState({});
  const personal = format === "personal";
  // Colors: the school's, We-Draft.com's, or (bw) black and grays — the
  // whole page then goes grayscale, headshot and logos too.
  const bw = !!layout.bw;
  const site = layout.accent === "website";
  const c = bw
    ? { band: "#16191d", accent: INK, accent2: "#8a929e" }
    : site ? { band: SITE_BLUE, accent: SITE_BLUE, accent2: SITE_GOLD }
    : { band: d.color1, accent: d.color1, accent2: d.color2 };
  const band = layout.header === "band";
  const bandInk = band ? textOn(c.band, bw ? "#fff" : c.accent2) : INK;

  // Page box and margins. Spread: the outside edge and the gutter swap
  // with the side. Personal: centered, nothing mirrored — "outside" means
  // left.
  const W = personal ? TRIM_W : PAGE_W;
  const H = personal ? TRIM_H : PAGE_H;
  const left = personal || side === "left";
  const padL = personal ? PERSONAL_SIDE : BLEED + (left ? MARGIN : GUTTER);
  const padR = personal ? PERSONAL_SIDE : BLEED + (left ? GUTTER : MARGIN);
  const sidebarLeft = layout.sidebar === "inside" ? !left : left;
  const shotLeft = layout.headshot === "inside" ? !left : left;

  // The header: spread — full width from the page's top edge (bleeding off
  // it); personal — a card inside the margins.
  const hdr = personal
    ? { left: padL, top: PERSONAL_TOP, width: W - padL - padR, height: PERSONAL_HEADER_H, radius: 12 }
    : { left: 0, top: 0, width: W, height: BLEED + HEADER_H, radius: 0 };
  // The name's sides, inside the header box.
  const inL = personal ? 26 : padL;
  const inR = personal ? 26 : padR;
  const shotW = d.headshot ? (personal ? 200 : 220) : 0;
  const nameW = hdr.width - inL - inR - shotW - 10;
  const last = d.last.toUpperCase();
  const first = d.first.toUpperCase();
  const lastSize = fit(last, personal ? 84 : 96, nameW);
  const facts = [d.position, d.school, d.eligible && `${String(d.eligible).replace(/s$/i, "")} Draft Class`].filter(Boolean).join("  ·  ");
  const hdrBottom = hdr.top + hdr.height;
  const nameTop = personal ? 18 : BLEED + MARGIN - 14;

  const side_ = layout.blocks.filter((b) => b.zone === "side");
  const main_ = layout.blocks.filter((b) => b.zone === "main");
  const sidebarW = 218;
  const bodyTop = hdrBottom + 24;
  const bodyBottom = H - (personal ? PERSONAL_TOP : BLEED + MARGIN) + 6 - FOOTER_H;
  const overflow = over.side || over.main;
  const logo = band ? d.logoDark : d.logo;

  return (
    <div className="wd-print-page" style={{ position: "relative", width: W, height: H, background: "#fff", overflow: "hidden", fontFamily: BODY, color: INK, boxSizing: "border-box", filter: bw ? "grayscale(1)" : undefined }}>
      {/* ── Header ── */}
      <div style={{
        position: "absolute", left: hdr.left, top: hdr.top, width: hdr.width, height: hdr.height, overflow: "hidden", borderRadius: hdr.radius,
        background: band ? `linear-gradient(160deg, ${c.band} 0%, ${c.band} 62%, ${shade(c.band, -0.28)} 100%)` : "#fff",
        border: !band && personal ? `1px solid ${RULE}` : "none",
        boxSizing: "border-box",
      }}>
        {/* The school logo, big and faded, centered behind his head — the
            only place it appears. */}
        {logo && (
          <div style={{
            position: "absolute", top: -hdr.height * 0.2, bottom: -hdr.height * 0.2, [shotLeft ? "left" : "right"]: (shotLeft ? inL : inR) - 95, width: shotW + 180,
            display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
          }}>
            <img draggable={false} src={logo} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", opacity: band ? 0.18 : 0.09 }} />
          </div>
        )}
        {d.headshot && (
          <img draggable={false} src={d.headshot} alt="" style={{
            position: "absolute", bottom: 0, [shotLeft ? "left" : "right"]: (shotLeft ? inL : inR) - 8,
            height: hdr.height - (personal ? 14 : 22), maxWidth: shotW + 30, objectFit: "contain", objectPosition: "bottom",
          }} />
        )}
        {/* Name block */}
        <div style={{
          position: "absolute", top: nameTop, bottom: personal ? 18 : 22,
          left: shotLeft ? inL + shotW + 10 : inL, right: shotLeft ? inR : inR + shotW + 10,
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
          alignItems: shotLeft ? "flex-end" : "flex-start", textAlign: shotLeft ? "right" : "left",
          color: bandInk,
        }}>
          <span style={{ marginBottom: "auto", fontSize: 10.5, fontWeight: 900, letterSpacing: "0.22em", textTransform: "uppercase", opacity: 0.85 }}>
            {d.mine || d.blank ? "Prospect Evaluation" : "Community Evaluation"}
          </span>
          <div style={{ fontFamily: DISPLAY, fontSize: 34, lineHeight: 0.9, letterSpacing: "0.02em", color: band ? bandInk : c.accent }}>{first}</div>
          <div style={{ fontFamily: DISPLAY, fontSize: lastSize, lineHeight: 0.86, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>{last}</div>
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>{facts}</div>
        </div>
        {/* Bottom rule: the secondary color on the band, the primary on white. */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: band ? 7 : 6, background: band ? c.accent2 : c.accent }} />
      </div>

      {/* ── Body: sidebar + main ── */}
      <div style={{
        position: "absolute", top: bodyTop, bottom: H - bodyBottom, left: padL, right: padR,
        display: "flex", flexDirection: sidebarLeft ? "row" : "row-reverse", gap: 28,
      }}>
        {side_.length > 0 && (
          <div style={{ width: sidebarW, flexShrink: 0 }}>
            <Column blocks={side_} d={d} c={c} layout={layout} zone="side" onOverflow={(v) => v !== !!over.side && setOver((o) => ({ ...o, side: v }))} />
          </div>
        )}
        {side_.length > 0 && <div style={{ width: 1, background: RULE, flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Column blocks={main_} d={d} c={c} layout={layout} zone="main" onOverflow={(v) => v !== !!over.main && setOver((o) => ({ ...o, main: v }))} />
        </div>
      </div>

      {/* ── Footer: spread — page number on the outside corner; personal — centered, no number ── */}
      <div style={{
        position: "absolute", left: padL, right: padR, bottom: (personal ? PERSONAL_TOP : BLEED + MARGIN) - 22, height: 20,
        display: "flex", alignItems: "center", gap: 10, flexDirection: left ? "row" : "row-reverse",
        justifyContent: personal ? "center" : "flex-start",
        borderTop: `1px solid ${RULE}`, paddingTop: 6, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED,
      }}>
        {!personal && page != null && <span style={{ fontFamily: DISPLAY, fontSize: 18, letterSpacing: "0.04em", color: INK }}>{page}</span>}
        <span>{layout.folio}</span>
        {personal && <span>·</span>}
        <span style={{ marginLeft: !personal && left ? "auto" : 0, marginRight: !personal && !left ? "auto" : 0, letterSpacing: "0.08em", textTransform: "none" }}>we-draft.com/player/{d.slug}</span>
      </div>

      {/* ── Editor-only: guides + overflow ── */}
      {guides && (
        <div className="wd-print-screen-only" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {!personal && <div style={{ position: "absolute", inset: 0, border: `${BLEED}px solid rgba(255, 0, 90, 0.12)` }} />}
          <div style={{ position: "absolute", left: personal ? 0 : BLEED, top: personal ? 0 : BLEED, width: TRIM_W, height: TRIM_H, outline: "1px solid #00b7ff", outlineOffset: personal ? -1 : 0 }} />
          <div style={{ position: "absolute", left: padL, right: padR, top: personal ? PERSONAL_TOP : BLEED + MARGIN, bottom: personal ? PERSONAL_TOP : BLEED + MARGIN, outline: "1px dashed rgba(200, 0, 200, 0.55)" }} />
          {personal && PUNCH_HOLES.ys.map((y) => (
            <span key={y} style={{ position: "absolute", left: PUNCH_HOLES.x - PUNCH_HOLES.d / 2, top: y - PUNCH_HOLES.d / 2, width: PUNCH_HOLES.d, height: PUNCH_HOLES.d, borderRadius: "50%", border: "1.5px dashed #8a929e", boxSizing: "border-box" }} />
          ))}
        </div>
      )}
      {overflow && (
        <div className="wd-print-screen-only" style={{ position: "absolute", left: padL, right: padR, bottom: (personal ? PERSONAL_TOP : BLEED + MARGIN) + 4, background: "#c0392b", color: "#fff", fontSize: 13, fontWeight: 900, padding: "6px 10px", textAlign: "center", letterSpacing: "0.04em" }}>
          ⚠ {over.side && over.main ? "Both columns" : over.side ? "Sidebar" : "Main column"} overflow — content is cut off. Turn a block off, move it, or shorten reports.
        </div>
      )}
    </div>
  );
}

// "#rrggbb" darkened (amt < 0) or lightened.
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `#${[n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, "0")).join("")}`;
}
