// src/components/draftSim/ProspectCard.jsx
//
// Draft Sim's player card — a prospect's name anywhere in the sim (the
// Draft grid, Draft Board, War Room, My Picks, the results) opens it over
// the sim instead of leaving for his player page (user, 2026-11-16: "like it
// does in transfer portal" — components/portalSim/PlayerCard.jsx).
//   header    his name, school (in its colors), position, the grade badge,
//             his headshot (playerPhotos — simHeadshots.js)
//   status    drafted in this sim (pick, team) or still on the board — with
//             DRAFT when you're on the clock
//   bio       height / weight, age (not rookie age), hometown (no
//             evaluation count — user, 2026-11-16)
//   scouting  board / position / class rank, community (or My Board)
//             grade, strengths and weaknesses
//   season    CFBD season stat tiles and national top-50 spots — the sim's
//             stats (national tables, top 50s only), else his school's
//             cfbRosters row (every player, defense included)
//   career    his Career Path with accolades — the player page's Info tab
//             (PlayerEligibilityInfo.jsx useCareerPath), dark, his sim
//             team on top once he.s picked, a gray stem; from his
//             players doc and his ESPN id (playerPhotos), read on open
//   link      his full We-Draft.com profile, in a new tab
// ProspectCardProvider holds which card is open; PlayerLink is the name —
// a button that opens the card inside a provider, his page's link outside
// one (or for a player who isn't on this sim's board).
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { gradeLabel, gradeLook } from "../../utils/communityGrades";
import { useSchools } from "../DraftArchiveList";
import { statTiles } from "../portalSim/PlayerCard";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { NFL_TEAMS } from "../../utils/coachHistory";
import { useCareerPath } from "../PlayerEligibilityInfo";
import { useHeadshot } from "./simHeadshots";
import StateShape from "../StateShape";

// His players doc and ESPN id, once a session each.
const playerCache = new Map();
function usePlayerRecord(id) {
  const [rec, setRec] = useState(() => playerCache.get(id)?.done || null);
  useEffect(() => {
    let live = true;
    if (!playerCache.has(id)) {
      const entry = {};
      entry.promise = Promise.all([
        getDoc(doc(db, "players", id)).then((s) => (s.exists() ? { id: s.id, ...s.data() } : null)).catch(() => null),
        getDoc(doc(db, "playerPhotos", id)).then((s) => (s.exists() && s.data().headshot?.espnId ? String(s.data().headshot.espnId) : "")).catch(() => ""),
      ]).then(([player, espnId]) => { entry.done = { player, espnId }; return entry.done; });
      playerCache.set(id, entry);
    }
    playerCache.get(id).promise.then((r) => { if (live) setRec(r); });
    return () => { live = false; };
  }, [id]);
  return rec;
}

// His season stats from his school's cfbRosters doc (one read per school a
// session) — the row whose slug is his. → { defensive: {…}, … } | null
const rosterCache = new Map();
function useRosterStats(school, slug, skip) {
  const [s, setS] = useState(null);
  useEffect(() => {
    setS(null);
    if (skip || !school || !slug) return undefined;
    let live = true;
    if (!rosterCache.has(school)) {
      rosterCache.set(school, getDocs(query(collection(db, "cfbRosters"), where("school", "==", school), limit(1)))
        .then((snap) => snap.docs[0]?.data()?.players || [])
        .catch(() => []));
    }
    rosterCache.get(school).then((rows) => { if (live) setS(rows.find((r) => r.slug === slug)?.s || null); });
    return () => { live = false; };
  }, [school, slug, skip]);
  return s;
}

// One Career Path stop, dark: logo marker, name and years, accolades under.
function CareerStop({ r, last, isMobile }) {
  const size = isMobile ? 32 : 36;
  const filled = r.current && r.brand?.Color1;
  // High schools have no dark logos: theirs sit on light gray.
  const light = r.key === "hs";
  const logo = filled ? r.brand.LogoDark || r.brand.Logo1 : light ? r.brand?.Logo1 : r.brand?.LogoDark || r.brand?.Logo1;
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 12, paddingBottom: last ? 0 : 12 }}>
      {!last && <div aria-hidden="true" style={{ position: "absolute", left: size / 2 - 1, top: size / 2, bottom: 0, width: 2, background: "#5b6880" }} />}
      <div style={{ position: "relative", zIndex: 1, flexShrink: 0, width: size, height: size, borderRadius: "50%", background: filled ? r.brand.Color1 : light ? "#eef1f5" : "#111a2b", border: `2px solid ${r.current ? GOLD : LINE}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {logo ? <img src={logo} alt="" style={{ width: "70%", height: "70%", objectFit: "contain" }} /> : r.state ? <StateShape abbr={r.state} size={Math.round(size * 0.68)} glow={false} /> : <span style={{ fontSize: 10, fontWeight: 900, color: light ? "#5b6676" : SUB }}>{r.fallback || String(r.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 3)}</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingTop: (size - 18) / 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, lineHeight: "18px", fontWeight: 900, textTransform: "uppercase" }}>{r.name}</span>
          {r.label && <span style={{ fontSize: 9, fontWeight: 900, color: SUB, border: `1px solid ${LINE}`, borderRadius: 4, padding: "1px 5px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{r.label}</span>}
          {r.span && <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 900, color: r.current ? GOLD : SUB, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.span}</span>}
        </div>
        {r.sub && <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginTop: 1 }}>{r.sub}</div>}
        {(r.accolades || []).map((a) => (
          <div key={a.key} title={a.title || undefined} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12, fontWeight: 800, color: GOLD }}>
            {a.icon
              ? <img src={a.icon} alt="" aria-hidden="true" style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
              : <span aria-hidden="true" style={{ display: "inline-flex", width: 16, height: 16, borderRadius: "50%", background: GOLD, color: "#111", fontSize: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>★</span>}
            <span>{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#eef2f8";
const SUB = "#8b9bb4";
const LINE = "#1f2b42";
const GREEN = "#7ee2a8";
const RED = "#ff8a7a";
const ft = (inches) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null);

const CardCtx = createContext(null);

// sim: the sim state (byId, picks, userTeams); data: the sim's data
// (branding, season); onDraft(id): when the user's on the clock.
export function ProspectCardProvider({ sim, data, isMobile, onDraft = null, children }) {
  const [id, setId] = useState(null);
  const value = useMemo(() => ({ open: setId, has: (pid) => !!sim?.byId?.[pid] }), [sim]);
  const p = id ? sim?.byId?.[id] : null;
  return (
    <CardCtx.Provider value={value}>
      {children}
      {p && <ProspectCard p={p} sim={sim} data={data} isMobile={isMobile} onDraft={onDraft} onClose={() => setId(null)} />}
    </CardCtx.Provider>
  );
}

// A prospect's name: opens his card in the sim, else his page.
// newTab: the page link opens in a new tab (the live sim's).
export function PlayerLink({ p, style, className, newTab = true, children }) {
  const ctx = useContext(CardCtx);
  if (ctx && p?.id && ctx.has(p.id)) {
    return (
      <button type="button" className={["wd-sim-pname", className].filter(Boolean).join(" ")} title={`${p.First} ${p.Last}`}
        onClick={(e) => { e.stopPropagation(); ctx.open(p.id); }}
        style={{ all: "unset", cursor: "pointer", boxSizing: "border-box", maxWidth: "100%", ...(style?.display === "block" ? { width: "100%" } : null), ...style }}>{children}</button>
    );
  }
  if (!p?.Slug) return <span className={className} style={style}>{children}</span>;
  return (
    <Link className={className} to={`/player/${p.Slug}`} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})} style={{ textDecoration: "none", ...style }}>{children}</Link>
  );
}

const H = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "18px 0 8px", flexWrap: "wrap" }}>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", color: SUB, textTransform: "uppercase" }}>{children}</div>
    <span style={{ flex: 1, height: 1, background: LINE, minWidth: 20 }} />
    {right}
  </div>
);
const Box = ({ label, children }) => (
  <div style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 10px", minWidth: 0 }}>
    <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 900, marginTop: 2 }}>{children}</div>
  </div>
);
const NflLogo = ({ b, team, size }) => {
  const src = b?.LogoDark || b?.Logo1;
  return src
    ? <img src={src} alt={team} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
    : <span style={{ width: size, flexShrink: 0, fontSize: 11, fontWeight: 900 }}>{team}</span>;
};

function ProspectCard({ p, sim, data, isMobile, onDraft, onClose }) {
  const headshot = useHeadshot(p.id);
  const schools = useSchools(p.School ? [p.School] : []);
  const school = schools[p.School] || {};
  const c1 = school.Color1 || BLUE;
  const c2 = school.Color2 || GOLD;
  // On the school-color fill: the dark logo (LogoDark), else the main one.
  const fillLogo = school.LogoDark || school.Logo1 || p.logo || p.logoDark;
  const panelLogo = p.logoDark || p.logo;

  // Esc closes; the page behind doesn't scroll.
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);

  const pick = sim.picks.find((x) => x.selection === p.id) || null;
  const pickBrand = pick ? data.branding?.[pick.owner] || {} : null;
  const canDraft = !pick && !!onDraft;
  const label = gradeLabel(p.avg);
  const look = label ? gradeLook(label) : null;
  const posRank = p.positionRank ? `${p.Position}${p.positionRank}` : null;
  // The sim's stats cover the national top 50s only; anyone else (most
  // defenders) gets his roster row's.
  const simTiles = statTiles(p.Position, p.stats?.lines);
  const rosterStats = useRosterStats(p.School, p.Slug, simTiles.length > 0);
  const tiles = simTiles.length ? simTiles : statTiles(p.Position, rosterStats);
  const leaders = (p.stats?.leaders || []).slice().sort((a, b) => a.rank - b.rank).slice(0, 4);
  // His players doc: the career path, hometown and age. (No sim pick on the
  // path — the status box above has it.)
  const rec = usePlayerRecord(p.id);
  const career = useCareerPath(rec?.player || null, rec?.espnId || "", null);
  const bio = [
    p.height || p.weight ? ["Height / Weight", [ft(p.height), p.weight ? `${p.weight} lbs` : null].filter(Boolean).join(" · ")] : null,
    career.age ? ["Age", String(career.age)] : null,
    career.hometown ? ["Hometown", career.hometown] : null,
    p.subPosition && p.subPosition !== p.Position ? ["Role", p.subPosition] : null,
  ].filter(Boolean);
  // His ranks lead the Scouting section (user, 2026-11-16).
  const ranks = [
    ["Board", `#${p.rank}`],
    posRank ? ["Position rank", posRank] : null,
    p.cr != null ? ["Class rank", `#${p.cr}`] : null,
  ].filter(Boolean);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(3,7,14,0.72)", display: "flex", alignItems: isMobile ? "stretch" : "flex-start", justifyContent: "center", padding: isMobile ? 0 : "70px 16px 24px", overflowY: "auto", whiteSpace: "normal", textAlign: "left" }}>
      <div role="dialog" aria-modal="true" aria-label={`${p.First} ${p.Last}`} onClick={(e) => e.stopPropagation()} className="wd-sim-pop wd-sim-scroll" style={{
        position: "relative", width: "100%", maxWidth: 760, background: "#0e1626", border: isMobile ? "none" : `1px solid ${LINE}`, borderRadius: isMobile ? 0 : 18, overflow: "hidden", color: INK,
        maxHeight: isMobile ? "100%" : "none", overflowY: isMobile ? "auto" : "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", fontFamily: "inherit",
      }}>
        {/* Header, in his school's colors. */}
        <div style={{ position: "relative", overflow: "hidden", background: `linear-gradient(115deg, ${c1} 0%, ${c1} 50%, color-mix(in srgb, ${c2} 70%, ${c1}) 100%)` }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 85% 120%, rgba(0,0,0,0.05), rgba(0,0,0,0.55) 70%)" }} />
          {fillLogo && <img src={fillLogo} alt="" aria-hidden="true" style={{ position: "absolute", right: -30, top: -40, width: isMobile ? 190 : 260, opacity: 0.12, pointerEvents: "none" }} />}
          <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: isMobile ? 10 : 18, padding: isMobile ? "14px 14px 0" : "18px 22px 0" }}>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: isMobile ? 14 : 18 }}>
              <div style={{ fontSize: isMobile ? 14 : 18, fontWeight: 900, textTransform: "uppercase", opacity: 0.85, paddingRight: 50 }}>{p.First}</div>
              <div style={{ fontSize: isMobile ? 30 : 46, fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, letterSpacing: "-0.01em", textShadow: "0 2px 12px rgba(0,0,0,0.35)", overflowWrap: "anywhere" }}>{p.Last}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: isMobile ? 10 : 14, flexWrap: "wrap" }}>
                {fillLogo && <img src={fillLogo} alt="" style={{ width: isMobile ? 30 : 38, height: isMobile ? 30 : 38, objectFit: "contain", flexShrink: 0 }} />}
                <span style={{ fontSize: isMobile ? 13 : 15, fontWeight: 900 }}>{p.School}</span>
                <span style={{ fontSize: 11, fontWeight: 900, background: "rgba(0,0,0,0.35)", borderRadius: 6, padding: "3px 7px" }}>{p.Position}</span>
                {look && (
                  <span title={`${p.mine ? "My Grade" : "Community grade"}: ${label}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: look.bg, border: `2px solid ${look.border}`, borderRadius: 6, padding: "1px 6px", color: "#fff" }}>
                    {look.qualifier && <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.06em" }}>{look.qualifier}</span>}
                    <span style={{ fontSize: 12, fontWeight: 900, lineHeight: 1.2 }}>{look.short}</span>
                    <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.06em" }}>RD</span>
                  </span>
                )}
              </div>
            </div>
            {headshot && <img src={headshot} alt="" style={{ flexShrink: 0, height: isMobile ? 110 : 160, width: "auto", maxWidth: "45%", objectFit: "contain", alignSelf: "flex-end", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }} />}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 10, right: 10, border: "none", background: "rgba(0,0,0,0.4)", color: "#fff", borderRadius: 999, padding: "7px 11px", fontWeight: 900, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>

        <div style={{ padding: isMobile ? "4px 14px 20px" : "6px 22px 22px" }}>
          {/* Where he stands in this sim. */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "10px 12px", borderRadius: 10, flexWrap: "wrap",
            background: pick ? "rgba(126,226,168,0.08)" : "#111a2b", border: `1px solid ${pick ? "rgba(126,226,168,0.45)" : LINE}` }}>
            {pick ? (
              <>
                <NflLogo b={pickBrand} team={pick.owner} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 14 }}>Drafted by {NFL_TEAMS[pick.owner] || pick.owner}{sim.userTeams?.includes(pick.owner) ? " — your pick" : ""}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: SUB }}>Round {pick.round} · No. {pick.overall}{pick.via ? ` · via ${pick.via}` : ""}{p.rank ? ` · Board #${p.rank}` : ""}</div>
                </div>
              </>
            ) : (
              <>
                {panelLogo && <img src={panelLogo} alt="" style={{ width: 30, height: 30, objectFit: "contain", flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 14, color: GOLD }}>Still on the board</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: SUB }}>Board #{p.rank}{posRank ? ` · ${posRank}` : ""}</div>
                </div>
                {canDraft && (
                  <button type="button" className="wd-sim-draft" onClick={() => { onDraft(p.id); onClose(); }}
                    style={{ border: "none", borderRadius: 999, padding: "10px 22px", fontWeight: 900, fontSize: 13, letterSpacing: "0.08em", background: GOLD, color: "#111", cursor: "pointer", fontFamily: "inherit" }}>DRAFT</button>
                )}
              </>
            )}
          </div>

          {/* Bio. */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 3}, minmax(0, 1fr))`, gap: 8, marginTop: 10 }}>
            {bio.map(([k, v]) => <Box key={k} label={k}>{v}</Box>)}
          </div>

          {/* His ranks, the grade, strengths and weaknesses. */}
          <>
              <H right={look ? <span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{p.mine ? "Your grade" : "Community grade on We-Draft.com"}</span> : null}>Scouting</H>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${ranks.length}, minmax(0, 1fr))`, gap: 8, marginBottom: look || p.strengths?.length || p.weaknesses?.length ? 10 : 0 }}>
                {ranks.map(([k, v]) => <Box key={k} label={k}>{v}</Box>)}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
                {look && (
                  <div style={{ flex: "0 0 auto", minWidth: 150, background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ background: look.bg, border: `2px solid ${look.border}`, borderRadius: 10, padding: "6px 12px", fontWeight: 900, fontSize: 22, lineHeight: 1, textAlign: "center" }}>
                      {look.qualifier && <div style={{ fontSize: 9, letterSpacing: "0.12em", marginBottom: 3 }}>{look.qualifier}</div>}{look.short}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 900 }}>{label}</div>
                  </div>
                )}
                {[["Strengths", p.strengths, GREEN], ["Weaknesses", p.weaknesses, RED]].map(([k, list, color]) => (list?.length ? (
                  <div key={k} style={{ flex: "1 1 200px", background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color, textTransform: "uppercase" }}>{k}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {list.map((x) => <span key={x} style={{ fontSize: 12, fontWeight: 900, borderRadius: 999, padding: "4px 10px", border: `1px solid ${color}55`, color }}>{x}</span>)}
                    </div>
                  </div>
                ) : null))}
              </div>
          </>

          {/* This season — only when there's something. */}
          {(tiles.length > 0 || leaders.length > 0) && (
            <>
              <H>{data.season ? `${data.season} season` : "This season"}</H>
              {tiles.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 92 : 104}px, 1fr))`, gap: 8 }}>
                  {tiles.map(([k, v]) => (
                    <div key={k} style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 900 }}>{v}</div>
                      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: SUB, textTransform: "uppercase" }}>{k}</div>
                    </div>
                  ))}
                </div>
              )}
              {leaders.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: tiles.length ? 8 : 0 }}>
                  {leaders.map((l) => (
                    <span key={l.key} style={{ fontSize: 12, fontWeight: 900, borderRadius: 999, padding: "4px 10px", border: `1px solid ${GOLD}66`, color: GOLD }}>
                      {l.tied ? "T-" : "#"}{l.rank} nationally · {l.title}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          {/* Career Path, with his accolades under each stop. */}
          {career.rows.length > 0 && (
            <>
              <H>Career path</H>
              <div style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: isMobile ? "10px 12px" : "12px 16px" }}>
                {career.rows.map((r, i) => <CareerStop key={r.key} r={r} last={i === career.rows.length - 1} isMobile={isMobile} />)}
              </div>
            </>
          )}

          {p.Slug && <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 16, fontSize: 12, fontWeight: 900, color: GOLD }}>Full We-Draft.com profile ↗</a>}
        </div>
      </div>
    </div>
  );
}
