// src/components/events/CombineSearch.jsx
//
// "Find a player" on a Combine position page (/events/combine/{pos} — between
// Best Performer and the leaderboards): type a name, pick him, and see his
// whole Combine — every drill and measurement with its percentile among his
// position, and his Combine score (combineData.js combinePools /
// combineCardFor — the same math as the Best Performer list). Every
// position is searchable; his own position is listed first. Every year's
// rows load the first time someone types (fetchCombineYear, cached).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSchools } from "../DraftArchiveList";
import { combinePools, combineCardFor, formatCombine } from "../../utils/combineData";
import { fetchCombineIndex, fetchCombineYear, playerHref, schoolHref } from "../../utils/events";
import { NAVY, GOLD, BODY_FONT, Icon, SectionHead } from "./EventKit";

const METRICS = [
  ["forty", "40", true], ["vertical", "Vert"], ["broad", "Broad"], ["bench", "Bench"], ["threeCone", "3-Cone", true], ["shuttle", "Shuttle", true],
];
const BUILD = [["height", "Height"], ["weight", "Weight"], ["arm", "Arm"], ["hand", "Hand"]];
const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "");
const kicker = (color = "#8a94a6") => ({ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color });
const valueText = (k, v) => (k === "weight" ? `${Math.round(v)} lbs` : formatCombine(k, v));

let allP = null;
// Every year's rows → { rows: [{ ...row, year }], pools }.
function loadAll() {
  if (!allP) {
    allP = fetchCombineIndex().then(async (index) => {
      const years = Object.keys(index?.years || {});
      const lists = await Promise.all(years.map((y) => fetchCombineYear(y)));
      const byYear = Object.fromEntries(years.map((y, i) => [y, lists[i] || []]));
      return { rows: years.flatMap((y, i) => (lists[i] || []).map((r) => ({ ...r, year: Number(y) }))), pools: combinePools(byYear) };
    }).catch((e) => { allP = null; throw e; });
  }
  return allP;
}

export default function CombineSearch({ ev, pos, isMobile }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const boxRef = useRef(null);

  const start = () => { if (!data && !err) loadAll().then(setData).catch(() => setErr("Couldn't load the Combine results.")); };
  // A click outside closes the list.
  useEffect(() => {
    const off = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, []);

  const matches = useMemo(() => {
    const n = norm(q).trim();
    if (!data || n.length < 2) return [];
    const words = n.split(/\s+/);
    // Whole-word matches first ("watt" → J.J. Watt before Watts), then this
    // page's position, then the newest.
    const whole = (r) => { const parts = norm(r.name).split(/\s+/); return words.every((w) => parts.includes(w)) ? 0 : 1; };
    return data.rows.filter((r) => { const name = norm(r.name); return words.every((w) => name.includes(w)); })
      .sort((a, b) => whole(a) - whole(b) || (a.position === pos ? 0 : 1) - (b.position === pos ? 0 : 1) || b.year - a.year)
      .slice(0, 8);
  }, [data, q, pos]);

  const pick = (r) => { setPicked(r); setOpen(false); setQ(r.name); };
  const card = useMemo(() => (picked && data ? combineCardFor(data.pools, picked, picked.year) : null), [picked, data]);

  return (
    <>
      <SectionHead icon="users" title="Find a Player" isMobile={isMobile} color={ev.color} />
      <div ref={boxRef} style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `2px solid ${open ? ev.color : "#d8dee8"}`, borderRadius: 14, padding: isMobile ? "10px 12px" : "12px 16px", boxShadow: "0 4px 14px rgba(0,30,70,0.06)" }}>
          <Icon name="scan" size={20} stroke={2.4} style={{ color: ev.color }} />
          <input value={q} placeholder="Search any player's Combine results…" aria-label="Search a player's Combine results"
            onFocus={() => { start(); setOpen(true); }}
            onChange={(e) => { setQ(e.target.value); setOpen(true); start(); if (!e.target.value) setPicked(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) pick(matches[0]); if (e.key === "Escape") setOpen(false); }}
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", fontSize: isMobile ? 15 : 16, fontWeight: 700, fontFamily: BODY_FONT, color: "#1c2330", background: "transparent" }} />
          {q && <button type="button" onClick={() => { setQ(""); setPicked(null); }} aria-label="Clear" style={{ border: "none", background: "#eef2f7", color: "#5a6475", borderRadius: 999, width: 26, height: 26, cursor: "pointer", fontWeight: 900 }}>×</button>}
        </div>
        {open && norm(q).trim().length >= 2 && (
          <div role="listbox" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", zIndex: 20, background: "#fff", border: "1px solid #e2e7ef", borderRadius: 12, boxShadow: "0 14px 34px rgba(0,30,70,0.18)", overflow: "hidden" }}>
            {err ? <div style={{ padding: 14, color: "#c0392b", fontWeight: 800, fontSize: 13 }}>{err}</div>
              : !data ? <div style={{ padding: 14, color: "#8a94a6", fontWeight: 800, fontSize: 13 }}>Loading every Combine…</div>
                : !matches.length ? <div style={{ padding: 14, color: "#8a94a6", fontWeight: 800, fontSize: 13, fontFamily: BODY_FONT }}>No one by that name at the Combine.</div>
                  : matches.map((r, i) => (
                    <button key={`${r.id}-${r.year}`} type="button" role="option" aria-selected={false} onClick={() => pick(r)} style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", border: "none", borderTop: i ? "1px solid #eef1f5" : "none",
                      background: "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: r.position === pos ? "#fff" : "#3a4352", background: r.position === pos ? ev.color : "#eef2f7", borderRadius: 6, padding: "3px 7px", minWidth: 34, textAlign: "center" }}>{r.position}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 900, color: "#1c2330", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT, whiteSpace: "nowrap" }}>{[r.school, r.year].filter(Boolean).join(" · ")}</span>
                    </button>
                  ))}
          </div>
        )}
      </div>
      {picked && card && <PlayerCard ev={ev} p={picked} card={card} isMobile={isMobile} />}
    </>
  );
}

function PlayerCard({ ev, p, card, isMobile }) {
  const brands = useSchools([p.school]);
  const logo = brands[p.school]?.Logo1;
  const href = playerHref(p);
  const tile = (k, label, x, i, cols, missing = "Didn't run") => (
    <div key={k} style={{ padding: isMobile ? "10px 6px" : "12px 10px", textAlign: "center", borderLeft: i % cols ? "1px solid #eef1f5" : "none", borderTop: i >= cols ? "1px solid #eef1f5" : "none" }}>
      <div style={kicker()}>{label}</div>
      <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 900, color: x ? NAVY : "#c4ccd8", margin: "3px 0 6px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{x ? valueText(k, x.value) : "—"}</div>
      {x && x.pct != null ? (
        <>
          <div style={{ height: 6, borderRadius: 999, background: "#eef1f5", overflow: "hidden" }}>
            <div style={{ width: `${x.pct}%`, height: "100%", borderRadius: 999, background: x.pct >= 90 ? `linear-gradient(90deg, ${ev.color}, ${GOLD})` : ev.color }} />
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, color: x.pct >= 90 ? "#b06f00" : "#8a94a6", marginTop: 4, fontFamily: BODY_FONT }}>{ord(Math.round(x.pct))} pct</div>
        </>
      ) : <div style={{ fontSize: 10, fontWeight: 800, color: "#c4ccd8", fontFamily: BODY_FONT }}>{x ? "" : missing}</div>}
    </div>
  );
  return (
    <div style={{ marginTop: 12, background: "#fff", border: `2px solid ${ev.color}`, borderRadius: 16, boxShadow: "0 8px 22px rgba(0,30,70,0.1)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 16, flexWrap: "wrap", padding: isMobile ? 14 : "16px 22px", background: "linear-gradient(120deg, #eef4fb 0%, #fff 70%)" }}>
        <span style={{ width: isMobile ? 50 : 60, height: isMobile ? 50 : 60, flexShrink: 0, borderRadius: 14, background: "#fff", border: "1px solid #dbe4ef", display: "grid", placeItems: "center" }}>
          {logo ? <img src={logo} alt="" style={{ width: "74%", height: "74%", objectFit: "contain" }} /> : <Icon name="stopwatch" size={26} style={{ color: ev.color }} />}
        </span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={kicker(ev.color)}>{p.position} · {p.year} Combine</div>
          <div style={{ fontSize: isMobile ? 21 : 26, fontWeight: 900, color: NAVY, lineHeight: 1.1, margin: "3px 0" }}>
            {href ? <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>{p.name}</Link> : p.name}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT }}>
            {p.school ? <Link to={schoolHref(p.school)} style={{ color: "inherit", textDecoration: "none" }}>{p.school}</Link> : null}
            {p.round ? ` · Rd ${p.round}${p.pick ? `, #${p.pick}` : ""}` : p.undrafted ? " · Undrafted" : ""}{p.team ? ` · ${p.team}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: isMobile ? 30 : 40, fontWeight: 900, color: card.score != null ? ev.color : "#c4ccd8", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{card.score != null ? card.score.toFixed(1) : "—"}</div>
          <div style={kicker()}>{card.score != null ? "Combine score" : "Too few drills to score"}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderTop: "1px solid #e2e7ef", background: "#fbfcfe" }}>
        {BUILD.map(([k, l], i) => tile(k, l, card.build[k], i, 4, "Not measured"))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : "repeat(6, minmax(0, 1fr))", borderTop: "1px solid #e2e7ef" }}>
        {METRICS.map(([k, l], i) => tile(k, l, card.drills[k], i, isMobile ? 3 : 6))}
      </div>
      <div style={{ padding: "8px 16px", borderTop: "1px solid #eef1f5", fontSize: 11, fontWeight: 600, fontStyle: "italic", color: "#8a94a6", fontFamily: BODY_FONT }}>
        Percentiles among {p.position}s at the Combine.
      </div>
    </div>
  );
}
