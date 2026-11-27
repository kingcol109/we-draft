// src/components/film/FilmPlayerCard.jsx
//
// The Film Manager's quick player card (user, 2026-11-27): a name in the
// Rosters window opens it, like the transfer portal's card — header in his
// school's colors with his headshot, the basics, this game's box score line,
// his CFBD season with national ranks, career path, and a link to his page.
// Admin-only, so the back-office bits (Flair, notes) show too.
//
// Rendered inside the pop-out window (a portal into its document), so Esc is
// read from that window and the profile link opens a new tab on this site.
import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useSchools } from "../DraftArchiveList";
import { useHeadshot } from "../draftSim/simHeadshots";
import { CareerStop, useCareerPath } from "../PlayerEligibilityInfo";

const INK = "#0f1b2d";
const BLUE = "#1d4ed8";
const GOLD = "#f6c66b";
const espnHeadshot = (id) => (id && /^\d+$/.test(String(id)) ? `https://a.espncdn.com/i/headshots/college-football/players/full/${id}.png` : "");
const heightOf = (p) => {
  if (p?.Height) return String(p.Height);
  const n = Number(p?.HeightInches);
  return n ? `${Math.floor(n / 12)}'${n % 12}"` : "";
};

// The box score's categories, in order, with their columns (any extra column
// CFBD sends goes on the end) and the stat that sorts each table.
export const BOX_CATS = [
  ["passing", "Passing", ["C/ATT", "YDS", "AVG", "TD", "INT", "QBR"], "YDS"],
  ["rushing", "Rushing", ["CAR", "YDS", "AVG", "TD", "LONG"], "YDS"],
  ["receiving", "Receiving", ["REC", "YDS", "AVG", "TD", "LONG"], "YDS"],
  ["defensive", "Defense", ["TOT", "SOLO", "TFL", "SACKS", "PD", "QB HUR", "TD"], "TOT"],
  ["interceptions", "Interceptions", ["INT", "YDS", "TD"], "INT"],
  ["fumbles", "Fumbles", ["FUM", "LOST", "REC"], "FUM"],
  ["kicking", "Kicking", ["FG", "PCT", "LONG", "XP", "PTS"], "PTS"],
  ["punting", "Punting", ["NO", "YDS", "AVG", "TB", "In 20", "LONG"], "NO"],
  ["kickReturns", "Kick Returns", ["NO", "YDS", "AVG", "LONG", "TD"], "YDS"],
  ["puntReturns", "Punt Returns", ["NO", "YDS", "AVG", "LONG", "TD"], "YDS"],
];
export const colsOf = (base, rows) => [...base, ...[...new Set(rows.flatMap((r) => Object.keys(r || {})))].filter((k) => !base.includes(k))];

// His CFBD season: one short row per category, with his national rank when CFBD has one.
const SEASON_CATS = [
  ["passing", "Passing", ["YDS", "TD", "INT", "PCT"]],
  ["rushing", "Rushing", ["CAR", "YDS", "YPC", "TD"]],
  ["receiving", "Receiving", ["REC", "YDS", "YPR", "TD"]],
  ["defensive", "Defense", ["TOT", "TFL", "SACKS", "PD", "QB HUR"]],
  ["interceptions", "Interceptions", ["INT", "YDS", "TD"]],
];

export default function FilmPlayerCard({ p, jersey, stats, onClose }) {
  const ref = useRef(null);
  const [wd, setWd] = useState(undefined); // undefined = loading, null = none
  const [cf, setCf] = useState(undefined);
  useEffect(() => {
    let c = false;
    setWd(p.wd ? undefined : null);
    setCf(p.cfbd ? undefined : null);
    if (p.wd) getDoc(doc(db, "players", String(p.wd))).then((d) => { if (!c) setWd(d.exists() ? { id: d.id, ...d.data() } : null); }).catch(() => { if (!c) setWd(null); });
    if (p.cfbd) getDoc(doc(db, "cfbdPlayers", String(p.cfbd))).then((d) => { if (!c) setCf(d.exists() ? d.data() : null); }).catch(() => { if (!c) setCf(null); });
    return () => { c = true; };
  }, [p.wd, p.cfbd]);
  // Esc closes it — read from the pop-out's own window.
  useEffect(() => {
    const w = ref.current?.ownerDocument?.defaultView;
    if (!w) return undefined;
    const on = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    w.addEventListener("keydown", on, true);
    return () => w.removeEventListener("keydown", on, true);
  }, [onClose]);

  const school = wd?.School || p.team || "";
  const brands = useSchools([school]);
  const tb = brands[school] || null;
  const h1 = tb?.Color1 || BLUE;
  const h2 = tb?.Color2 || GOLD;
  const mark = tb?.LogoDark || tb?.Logo1 || "";
  const wdShot = useHeadshot(p.wd || "");
  const [espnOk, setEspnOk] = useState(true);
  useEffect(() => { setEspnOk(true); }, [p.key]);
  const shot = wdShot || (espnOk ? espnHeadshot(p.cfbd) : "");
  const careerPlayer = useMemo(() => (wd === undefined ? null : wd || (school ? { School: school } : null)), [wd, school]);
  const career = useCareerPath(careerPlayer, p.cfbd ? String(p.cfbd) : "", null);

  const [fn, ...rest] = String(p.name || "").split(" ");
  const ln = rest.join(" ");
  const pos = wd?.Position || p.pos || "";
  const num = jersey ?? cf?.jersey ?? null;
  const seasonYr = cf?.seasons ? Object.keys(cf.seasons).sort().pop() : null;
  const season = seasonYr ? cf.seasons[seasonYr] : null;
  const ranks = seasonYr ? cf?.seasonRanks?.[seasonYr] || {} : {};
  const page = wd?.Slug ? `${window.location.origin}/player/${wd.Slug}` : "";

  const box = (label, value) => (
    <div style={{ flex: 1, minWidth: 0, background: "#f7f9fc", border: "1px solid #eef1f5", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 17, fontWeight: 900, color: INK, lineHeight: 1.1 }}>{value || "—"}</div>
      <div style={{ marginTop: 3, fontSize: 9, fontWeight: 900, color: "#8a97ab", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
  const head = (t) => <div style={{ margin: "16px 0 8px", fontSize: 12, fontWeight: 900, color: h1, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t}</div>;
  const table = (cols, rows) => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>
        <thead><tr>{["", ...cols].map((c) => <th key={c} style={{ padding: "3px 8px", textAlign: c ? "right" : "left", fontSize: 10, color: "#8a97ab", fontWeight: 900, whiteSpace: "nowrap" }}>{c}</th>)}</tr></thead>
        <tbody>{rows.map(([label, vals, rk = {}]) => (
          <tr key={label} style={{ borderTop: "1px solid #eef1f5" }}>
            <td style={{ padding: "4px 8px 4px 0", fontWeight: 900, whiteSpace: "nowrap" }}>{label}</td>
            {cols.map((c) => <td key={c} style={{ padding: "4px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{vals?.[c] ?? "—"}{rk[c] ? <span style={{ marginLeft: 4, fontSize: 10, color: "#8a97ab" }}>#{String(rk[c]).replace(/^T-/, "T")}</span> : null}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  const gameRows = BOX_CATS.filter(([k]) => stats?.[k]);

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${p.name} — player card`} onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 2000, background: "rgba(5,10,20,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 500, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", overscrollBehavior: "contain", background: "#fff", color: INK,
        borderRadius: 16, boxShadow: "0 20px 50px rgba(0,0,0,0.45)", fontFamily: "'Arial Black', Arial, sans-serif", colorScheme: "light",
      }}>
        {/* Header: his school's colors, name, number · position · school; headshot over the faded logo. */}
        <div style={{ position: "relative", overflow: "hidden", color: "#fff", borderBottom: `4px solid ${h2}`,
          background: `linear-gradient(115deg, ${h1} 0%, ${h1} 50%, color-mix(in srgb, ${h2} 70%, ${h1}) 100%)` }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 85% 120%, rgba(0,0,0,0.05), rgba(0,0,0,0.5) 70%)" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 12, padding: "18px 0 0 20px", minHeight: 140 }}>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 16 }}>
              {ln && <div style={{ fontSize: 22, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, opacity: 0.9, textShadow: "0 2px 12px rgba(0,0,0,0.35)" }}>{fn}</div>}
              <div style={{ fontSize: (ln || fn).length > 12 ? 30 : 40, fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, letterSpacing: "-0.01em", textShadow: "0 2px 12px rgba(0,0,0,0.35)", overflowWrap: "anywhere" }}>{ln || fn}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {num != null && <span style={{ fontSize: 22, fontWeight: 900, color: h2 === "#ffffff" || !tb ? GOLD : "#fff", textShadow: "0 1px 6px rgba(0,0,0,0.4)" }}>#{num}</span>}
                {pos && <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 5, background: "#fff", color: h1, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em" }}>{pos}</span>}
                <span style={{ fontSize: 12, fontWeight: 900, textShadow: "0 1px 6px rgba(0,0,0,0.4)" }}>{school}</span>
              </div>
            </div>
            {shot ? (
              <div style={{ position: "relative", flexShrink: 0, alignSelf: "flex-end", display: "flex" }}>
                {mark && <img src={mark} alt="" aria-hidden="true" style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%, -50%)", width: 160, height: 160, objectFit: "contain", opacity: 0.16, pointerEvents: "none" }} />}
                <img src={shot} alt="" onError={() => setEspnOk(false)} style={{ position: "relative", height: 136, width: "auto", objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }} />
              </div>
            ) : mark ? <img src={mark} alt={school} style={{ flexShrink: 0, width: 108, height: 108, objectFit: "contain", alignSelf: "center", marginRight: 22 }} /> : null}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", top: 8, right: 8, zIndex: 2, background: "rgba(0,0,0,0.4)", border: "none", borderRadius: "50%", width: 28, height: 28, color: "#fff", fontSize: 17, lineHeight: "28px", cursor: "pointer", padding: 0 }}>×</button>
        </div>

        <div style={{ padding: "14px 18px 18px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {box("Height", heightOf(wd))}
            {box("Weight", wd?.Weight ? String(wd.Weight) : "")}
            {box("Draft Class", wd?.Eligible || "")}
            {box("Home", wd?.State || "")}
          </div>
          {(career.hometown || wd?.HighSchool || wd?.RecruitStars) && (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: "#5b6b84", display: "grid", gap: 2 }}>
              {career.hometown && <div>Hometown: <span style={{ color: INK }}>{career.hometown}</span></div>}
              {(wd?.HighSchool || wd?.RecruitStars) && <div>Recruit: <span style={{ color: INK }}>{[wd.RecruitStars ? `${wd.RecruitStars}★` : "", wd.RecruitRank ? `#${wd.RecruitRank}` : "", wd.HighSchool || "", wd.RecruitYear ? `Class of ${wd.RecruitYear}` : ""].filter(Boolean).join(" · ")}</span></div>}
            </div>
          )}
          {(wd?.Flair || wd?.Flag) && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {wd.Flair && <span style={{ padding: "3px 9px", borderRadius: 999, background: "#fff6dd", border: `1px solid ${GOLD}`, fontSize: 11, fontWeight: 900, color: "#7a5300" }}>{wd.Flair}</span>}
              {wd.Flag && <span style={{ padding: "3px 9px", borderRadius: 999, background: "#ffe9e6", border: "1px solid #ff9b8f", fontSize: 11, fontWeight: 900, color: "#a3261a" }}>⚑ {String(wd.Flag)}</span>}
            </div>
          )}
          {!p.wd && <div style={{ marginTop: 8, fontSize: 11, fontWeight: 800, color: "#8a97ab" }}>Not on We-Draft — CFBD roster player.</div>}

          {head("This Game")}
          {gameRows.length ? gameRows.map(([k, label, base]) => (
            <div key={k} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 900, color: "#8a97ab", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
              {table(colsOf(base, [stats[k]]), [["", stats[k]]])}
            </div>
          )) : <div style={{ fontSize: 12, fontWeight: 700, color: "#8a97ab" }}>No box score line in this game.</div>}

          {season && SEASON_CATS.some(([k]) => season[k]) && (
            <>
              {head(`${seasonYr} Season`)}
              {SEASON_CATS.filter(([k]) => season[k]).map(([k, label, base]) => (
                <div key={k} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "#8a97ab", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                  {table(base.filter((c) => season[k][c] != null), [["", season[k], ranks[k] || {}]])}
                </div>
              ))}
            </>
          )}

          {head("Career Path")}
          {wd === undefined ? <div style={{ fontSize: 12, fontWeight: 700, color: "#8a97ab" }}>Loading…</div>
            : career.rows.length === 0 ? <div style={{ fontSize: 12, fontWeight: 700, color: "#8a97ab" }}>No career history on file.</div> : (
              <div style={{ position: "relative" }}>
                {career.rows.map(({ key, ...x }, i) => <CareerStop key={key} {...x} isMobile last={i === career.rows.length - 1} />)}
              </div>
            )}

          {wd?.AdminNotes && (
            <>
              {head("Admin Notes")}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", whiteSpace: "pre-wrap", fontFamily: "Arial, sans-serif", lineHeight: 1.45 }}>{wd.AdminNotes}</div>
            </>
          )}

          {page && (
            <a href={page} target="_blank" rel="noreferrer" style={{ marginTop: 16, display: "block", textAlign: "center", padding: 11, borderRadius: 10, background: BLUE, color: "#fff", fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", textDecoration: "none" }}>
              View We-Draft Profile ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
