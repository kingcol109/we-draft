// src/components/ScoutCard.jsx
//
// A player's flip card: the front is his graphic, the back his scouting
// report laid out like the back of a baseball card — a band with his number
// and name, a bio strip (age, height, weight), his draft class and high
// school, his season in a table, the community's grade with his top
// strengths and weaknesses, a line from his bio. Hover flips it on a
// desktop, a tap on a phone. Used by the Draft Risers (pages/Risers.jsx —
// in his label's colors) and the Weekly Mock's first-round cards
// (pages/ViewMock.js CardPickRow — in his NFL team's).
//
// The back is sized off the card's own width (cqw), so it reads the same at
// 280px and full screen. theme: { c1, c2 (the two colors), deep (the dark
// they fade to), mid (the band behind the type), accent (labels and stat
// numbers — light enough to read on the dark) } — teamTheme() makes one
// from an NFL team's colors.
import { useLayoutEffect, useRef, useState } from "react";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { communityFor, gradeLabel, gradeLook } from "../utils/communityGrades";
import { fetchEspnSeason } from "./PlayerStatsCard";
import { seasonHeadline } from "../utils/profileHub";
import StateShape from "./StateShape";

const HEAD = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";

// The flip turns the card right edge first, toward the viewer (rotateY
// negative — user, 2026-11-19); the back face's own 180° undoes it.
export const FLIP_CSS = `
.rs-card { perspective: 1400px; container-type: inline-size; }
.rs-card-inner { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform 0.65s cubic-bezier(.2,.75,.25,1); border-radius: inherit; }
@media (hover: hover) { .rs-card:hover .rs-card-inner { transform: rotateY(-180deg); } }
.rs-card.is-flipped .rs-card-inner { transform: rotateY(-180deg); }
.rs-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow: hidden; border-radius: inherit; }
.rs-back { transform: rotateY(180deg); }
.rs-flip-hint { transition: opacity 0.2s; }
.rs-card:hover .rs-flip-hint { opacity: 0; }
`;

const canHover = () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches;

// The card. front / back: what's on each face (the front's background —
// frontBg — shows while its image loads); width: its width (CSS); label:
// what a screen reader hears ("Dante Moore: flip his card"); radius.
// hintAt: where the "Flip" hint sits — "top" (right corner, the default), or
// "corner": just a small, faint ↻ in the bottom right corner (the draft
// card — the hint stays out of the graphic's way).
export function FlipCard({ front, back, frontBg, width, label, radius = 12, hintAt = "top" }) {
  const [flipped, setFlipped] = useState(false);
  const hoverable = canHover();
  return (
    <button type="button" className={`rs-card${flipped ? " is-flipped" : ""}`}
      onClick={() => { if (!hoverable) setFlipped((f) => !f); }}
      aria-label={label} aria-pressed={flipped}
      style={{ width, aspectRatio: "1080 / 1350", alignSelf: "flex-start", borderRadius: radius, flexShrink: 0, position: "relative", border: "none", padding: 0, display: "block", background: "transparent", cursor: "pointer" }}>
      <div className="rs-card-inner">
        <div className="rs-face" style={{ background: frontBg }}>
          {front}
          {hintAt === "corner" ? (
            <span className="rs-flip-hint" aria-hidden="true" title="Flip" style={{
              position: "absolute", right: "1.6cqw", bottom: "1.2cqw", width: "max(18px, 5cqw)", height: "max(18px, 5cqw)", borderRadius: "50%",
              display: "grid", placeItems: "center", background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)", fontFamily: BODY, fontSize: "max(11px, 3cqw)", fontWeight: 900, lineHeight: 1,
            }}>↻</span>
          ) : (
            <span className="rs-flip-hint" aria-hidden="true" style={{
              position: "absolute", right: "3cqw", top: "3cqw", padding: "1cqw 2.6cqw", borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff",
              fontFamily: BODY, fontSize: "max(10px, 2.8cqw)", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase",
            }}>↻ {hoverable ? "Flip" : "Tap to flip"}</span>
          )}
        </div>
        <div className="rs-face rs-back">{back}</div>
      </div>
    </button>
  );
}

export function ageOf(birthday) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday || "")) return "";
  const b = new Date(`${birthday}T12:00:00`);
  const n = new Date();
  return String(n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0));
}
function firstSentences(text, max = 220) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 60 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

// ── Colors ──
const hexRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => { const x = hexRgb(a); const y = hexRgb(b); return x && y ? rgbHex(x.map((v, i) => v + (y[i] - v) * t)) : a; };
const lum = (h) => { const c = hexRgb(h); return c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : 0; };
// An NFL team's card colors (teams/{abbr}: Color1, Color2).
export function teamTheme(brand = {}) {
  const c1 = hexRgb(brand.Color1) ? `#${String(brand.Color1).replace("#", "")}` : "#0055a5";
  const c2 = hexRgb(brand.Color2) ? `#${String(brand.Color2).replace("#", "")}` : "#f6a21d";
  // The accent: whichever of the two reads on the dark, else c2 lightened.
  const accent = lum(c2) > 0.42 ? c2 : lum(c1) > 0.42 ? c1 : mix(c2, "#ffffff", 0.55);
  return { c1, c2, deep: mix(c1, "#000000", 0.78), mid: mix(c1, "#000000", 0.35), accent };
}

// The card back's career path: every stop, in full (names wrap, nothing is
// cut). It takes the room the rest of the back leaves, and if the stops
// don't fit, everything in it shrinks a step at a time (k) until they do.
const FIT_MIN = 0.5;
function CareerFit({ rows, t, rule, label }) {
  const box = useRef(null);
  const [k, setK] = useState(1);
  const key = rows.map((r) => `${r.key}|${r.span || ""}`).join(",");
  useLayoutEffect(() => { setK(1); }, [key]);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight > el.clientHeight + 1 && k > FIT_MIN) setK((v) => Math.max(FIT_MIN, Math.round(v * 92) / 100));
  }, [k, key]);
  const cq = (n) => `${(n * k).toFixed(2)}cqw`;
  return (
    // (Padded so a marker's ring isn't clipped at the box's edge.)
    <div ref={box} style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden", padding: `0 0.4cqw ${cq(1)} ${cq(1)}`, margin: `0 0 0 -${cq(1)}` }}>
      <div style={{ ...label, fontSize: cq(2.7), borderBottom: `0.3cqw solid ${rule}`, paddingBottom: cq(0.8), marginBottom: cq(1.6) }}>Career path</div>
      {rows.map((r, i, all) => {
        const fill = /^#[0-9a-f]{6}$/i.test(r.brand?.Color1 || "") && r.label !== "High School" ? r.brand.Color1 : "#e9edf3";
        const src = fill !== "#e9edf3" ? r.brand?.LogoDark || r.brand?.Logo1 : r.brand?.Logo1;
        const dot = 8.2;
        return (
          <div key={r.key} style={{ position: "relative", display: "flex", alignItems: "center", gap: cq(2.4), paddingBottom: i < all.length - 1 ? cq(2) : 0 }}>
            {i < all.length - 1 && <div aria-hidden="true" style={{ position: "absolute", left: `calc(${cq(dot / 2)} - 0.25cqw)`, top: cq(dot / 2), bottom: `-${cq(dot / 2)}`, width: "0.5cqw", background: rule }} />}
            <div style={{ position: "relative", width: cq(dot), height: cq(dot), flexShrink: 0, borderRadius: "50%", background: fill, display: "grid", placeItems: "center", overflow: "hidden", boxShadow: r.current || r.key === "portal" ? `0 0 0 ${cq(0.6)} ${t.accent}` : "none" }}>
              {src ? <img src={src} alt="" style={{ width: "70%", height: "70%", objectFit: "contain" }} />
                : r.state ? <StateShape abbr={r.state} size="68%" glow={false} />
                : <span style={{ fontSize: cq(2.4), fontWeight: 900, color: "#5f6b7a" }}>{r.fallback || ""}</span>}
            </div>
            <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: cq(2) }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 900, fontSize: cq(3.4), lineHeight: 1.12, textTransform: "uppercase", overflowWrap: "anywhere", color: r.current || i === 0 ? "#fff" : "rgba(255,255,255,0.85)" }}>{r.name}</div>
                {r.label && <div style={{ fontSize: cq(2.2), fontWeight: 900, color: "rgba(255,255,255,0.55)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: cq(0.3) }}>{r.label}</div>}
              </div>
              {r.span && <span style={{ flexShrink: 0, fontWeight: 900, fontSize: cq(3), color: i === 0 ? t.accent : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.span}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The back. number: in the band's circle (a rank, a pick); name / pos /
// school: his; logo: the band's logo (his school's, his NFL team's);
// profile: his players doc (Birthday, Height, Weight, HighSchool, State,
// Bio); stats: [{ key, label, value }] and statsTitle ("2026 Season");
// scout: communityFor's { avg, strengths, weaknesses }; year: his class;
// chip: the footer's left chip (contents); footer: its right text.
// Options (the Weekly Mock's cards): photo — his headshot in the band's
// circle in place of the number; logoCircle — the band's logo in a circle
// of the theme's main color; draft — the Draft line's text ("Round 1, Pick
// 4") in place of "{year} NFL Draft".
// career (Portal News): his Career Path rows (PlayerEligibilityInfo
// useCareerPath, moved along to his new school or the portal) in place of
// the community's grades and the draft / high school lines.
export function CardBack({ theme: t, number, name, pos, school, logo, profile: p, stats = [], statsTitle = "", scout, year, chip, footer, photo = "", logoCircle = false, draft = "", career = null }) {
  const shown = (stats || []).filter((s) => s?.value !== "" && s?.value != null);
  const bio = [["AGE", ageOf(p?.Birthday)], ["HT", p?.Height], ["WT", p?.Weight ? String(p.Weight) : ""]].filter(([, v]) => v);
  const lines = career ? [] : [
    ["Draft", draft || (year ? `${year} NFL Draft` : "")],
    ["High school", [p?.HighSchool, p?.State].filter(Boolean).join(", ")],
  ].filter(([, v]) => v);
  // The community's read on him (when there is one): grade, strengths, weaknesses.
  const grade = career ? "" : gradeLabel(scout?.avg);
  const look = grade ? gradeLook(grade) : null;
  const strengths = career ? [] : (scout?.strengths || []).slice(0, 3);
  const weaknesses = career ? [] : (scout?.weaknesses || []).slice(0, 3);
  const hasScout = !!(grade || strengths.length || weaknesses.length);
  // A line from his bio — when the scouting section leaves room.
  const blurb = hasScout || career ? "" : firstSentences(p?.Bio);
  // His name, as big as fits the band (Arial Black runs ~0.74em a letter).
  const nameSize = Math.min(6, 54 / (Math.max(1, String(name).length) * 0.74));
  const rule = "rgba(255,255,255,0.18)";
  const label = { fontFamily: BODY, fontSize: "2.7cqw", fontWeight: 900, letterSpacing: "0.12em", color: t.accent, textTransform: "uppercase" };
  return (
    <div style={{
      position: "absolute", inset: 0, padding: "3.2cqw", textAlign: "left", color: "#fff", fontFamily: BODY,
      background: `radial-gradient(circle at 80% 0%, ${t.c1}55 0%, transparent 55%), radial-gradient(circle at 0% 100%, ${t.c1}33 0%, transparent 50%), linear-gradient(180deg, ${t.mid} 0%, ${t.deep} 70%, #000 100%)`,
    }}>
      {/* The card's frame. */}
      <div style={{ position: "absolute", inset: "2.4cqw", borderRadius: "2.4cqw", border: `0.7cqw solid ${t.c1}`, boxShadow: `inset 0 0 4cqw ${t.c1}33`, pointerEvents: "none" }} />
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "3.2cqw", padding: "2cqw" }}>
        {/* The band: his number, name, position and school. */}
        <div style={{ display: "flex", alignItems: "center", gap: "2.6cqw", background: `linear-gradient(120deg, ${t.c1}, ${t.c2})`, borderRadius: "1.6cqw", padding: "2.4cqw 3cqw", boxShadow: `0 1.4cqw 4cqw ${t.c1}44` }}>
          {photo ? (
            <div style={{ width: "13cqw", height: "13cqw", flexShrink: 0, borderRadius: "50%", overflow: "hidden", background: t.deep, border: "0.6cqw solid rgba(255,255,255,0.85)", boxSizing: "border-box" }}>
              <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
            </div>
          ) : number != null && <div style={{ width: "11cqw", height: "11cqw", flexShrink: 0, borderRadius: "50%", background: t.deep, color: "#fff", display: "grid", placeItems: "center", fontFamily: HEAD, fontWeight: 900, fontSize: String(number).length > 2 ? "4.2cqw" : "5.4cqw" }}>{number}</div>}
          <div style={{ minWidth: 0, flex: 1, textShadow: "0 1px 3px rgba(0,0,0,0.35)" }}>
            <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: `${nameSize.toFixed(2)}cqw`, lineHeight: 1.05, textTransform: "uppercase", whiteSpace: "nowrap" }}>{name}</div>
            <div style={{ fontWeight: 900, fontSize: "3.3cqw", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "1cqw", opacity: 0.95 }}>{[pos, school].filter(Boolean).join(" · ")}</div>
          </div>
          {logo && (
            <div style={{
              width: logoCircle ? "13cqw" : "11cqw", height: logoCircle ? "13cqw" : "11cqw", flexShrink: 0, borderRadius: logoCircle ? "50%" : "1.8cqw", display: "grid", placeItems: "center",
              background: logoCircle ? t.c1 : t.deep, ...(logoCircle ? { border: "0.6cqw solid rgba(255,255,255,0.85)", boxSizing: "border-box", boxShadow: "0 0.8cqw 2cqw rgba(0,0,0,0.35)" } : {}),
            }}>
              <img src={logo} alt="" style={{ width: logoCircle ? "70%" : "78%", height: logoCircle ? "70%" : "78%", objectFit: "contain" }} />
            </div>
          )}
        </div>

        {/* Bio: age, height, weight — then his draft class and high school. */}
        {bio.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${bio.length}, 1fr)`, borderTop: `0.4cqw solid ${rule}`, borderBottom: `0.4cqw solid ${rule}` }}>
            {bio.map(([k, v], i) => (
              <div key={k} style={{ textAlign: "center", padding: "1.6cqw 0", borderLeft: i ? `0.3cqw solid ${rule}` : "none" }}>
                <div style={label}>{k}</div>
                <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: "5cqw", lineHeight: 1.1, marginTop: "0.4cqw" }}>{v}</div>
              </div>
            ))}
          </div>
        )}
        {lines.length > 0 && (
          <div style={{ display: "grid", gap: "1.2cqw" }}>
            {lines.map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "baseline", gap: "2cqw", fontSize: "3.5cqw", lineHeight: 1.25 }}>
                <span style={{ ...label, flexShrink: 0, width: "27cqw", whiteSpace: "nowrap" }}>{k}</span>
                <span style={{ fontWeight: 800, minWidth: 0, color: "rgba(255,255,255,0.92)" }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* His season, in a table. */}
        {shown.length > 0 && (
          <div style={{ borderRadius: "1.6cqw", overflow: "hidden", border: `0.3cqw solid ${rule}`, background: "rgba(255,255,255,0.05)" }}>
            <div style={{ background: `linear-gradient(90deg, ${t.c1}, ${t.c1}00)`, fontWeight: 900, fontSize: "2.9cqw", letterSpacing: "0.14em", padding: "1cqw 2.4cqw", textTransform: "uppercase" }}>
              {statsTitle || "Season"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
              {shown.map((s, i) => (
                <div key={s.key || s.label} style={{ textAlign: "center", padding: "2cqw 0.6cqw", borderLeft: i ? `0.3cqw solid ${rule}` : "none" }}>
                  <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: "5.6cqw", lineHeight: 1, color: t.accent, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                  <div style={{ fontWeight: 900, fontSize: "2.4cqw", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: "1cqw", color: "rgba(255,255,255,0.7)" }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The community's read: his grade, then his top strengths and weaknesses. */}
        {hasScout && (
          <div style={{ display: "grid", gap: "2cqw" }}>
            {grade && (
              <div style={{ display: "flex", alignItems: "center", gap: "2cqw" }}>
                <span style={{ ...label, flexShrink: 0 }}>Community grade</span>
                <span style={{ background: look.bg, border: `0.3cqw solid ${look.border}`, color: "#fff", borderRadius: 999, padding: "0.6cqw 2.4cqw", fontWeight: 900, fontSize: "3cqw", letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{grade}</span>
              </div>
            )}
            {(strengths.length > 0 || weaknesses.length > 0) && (
              <div style={{ display: "grid", gridTemplateColumns: strengths.length && weaknesses.length ? "1fr 1fr" : "1fr", gap: "3cqw" }}>
                {[["Strengths", strengths, "#4ade80", "+"], ["Weaknesses", weaknesses, "#f87171", "–"]].filter(([, list]) => list.length).map(([title, list, color, mark]) => (
                  <div key={title} style={{ minWidth: 0 }}>
                    <div style={{ ...label, color, borderBottom: `0.3cqw solid ${rule}`, paddingBottom: "0.8cqw", marginBottom: "1cqw" }}>{title}</div>
                    {list.map((x) => (
                      <div key={x} style={{ display: "flex", gap: "1.4cqw", fontSize: "3.2cqw", fontWeight: 800, lineHeight: 1.35, color: "rgba(255,255,255,0.92)" }}>
                        <span style={{ color, fontWeight: 900 }}>{mark}</span><span style={{ minWidth: 0 }}>{x}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* His career path, newest first — every stop, shrunk to fit what's left of the card. */}
        {career?.length > 0 && <CareerFit rows={career} t={t} rule={rule} label={label} />}

        {/* A line from his bio. */}
        {blurb && (
          <div style={{ fontSize: "3.5cqw", lineHeight: 1.45, fontStyle: "italic", color: "rgba(255,255,255,0.82)", borderLeft: `0.8cqw solid ${t.c1}`, paddingLeft: "2.4cqw", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical" }}>{blurb}</div>
        )}

        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2cqw", fontWeight: 900, fontSize: "2.8cqw", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          {chip ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "1.2cqw", background: `linear-gradient(135deg, ${t.c1}, ${t.c2})`, borderRadius: 999, padding: "0.8cqw 2.4cqw", whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
              {chip}
            </span>
          ) : <span />}
          <span style={{ color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>{footer}</span>
        </div>
      </div>
    </div>
  );
}

// The backs' data for a set of players, in one go: [{ id, pos, espnId }] →
// { [id]: { profile, scout, stats } } — his players doc (30 a query), the
// community's read (one snapshot), and his season line from ESPN (by his
// headshot's ESPN id — no reads; stats: seasonHeadline's numbers for his
// position, nothing for a lineman).
export async function loadScoutBacks(players) {
  const list = (players || []).filter((p) => p?.id);
  if (!list.length) return {};
  const ids = [...new Set(list.map((p) => p.id))];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const [snaps, scout, seasons] = await Promise.all([
    Promise.all(chunks.map((c) => getDocs(query(collection(db, "players"), where(documentId(), "in", c))).catch(() => null))),
    communityFor(ids).catch(() => ({})),
    Promise.all(list.map((p) => (p.espnId ? fetchEspnSeason(p.espnId).catch(() => null) : null))),
  ]);
  const profiles = {};
  snaps.forEach((s) => s?.docs.forEach((d) => { profiles[d.id] = d.data(); }));
  const out = {};
  list.forEach((p, i) => {
    const stats = seasonHeadline(p.pos, seasons[i]).map(([label, value]) => ({ key: label, label, value }));
    out[p.id] = { profile: profiles[p.id] || null, scout: scout?.[p.id] || null, stats: seasons[i] ? stats : [] };
  });
  return out;
}
