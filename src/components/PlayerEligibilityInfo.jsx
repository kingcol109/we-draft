// src/components/PlayerEligibilityInfo.jsx
//
// The player page's Info tab (pages/PlayerProfile.js, next to Stats):
//   College Eligibility  one plain sentence (utils/eligibility.js
//                        eligibilityInfo — the admin's True / +1 tags are
//                        never shown) and an ⓘ button with the estimate
//                        disclaimer
//   Career Path          players.CareerStops (utils/careerStops.js), newest
//                        first, then the high school ("Graduated" + their
//                        recruit year) — like the coach pages' career
//                        timeline. College logos from schools
//                        (DraftArchiveList useSchools); the high school's
//                        from its highSchools doc when it's branded, else
//                        its state's silhouette (stateSilhouettes/{state}),
//                        else the state's shorthand ("TX").
//   Hometown / Born / Age  players.Hometown / Birthday when entered, else the
//                        ESPN athlete record (useEspnBio) — shown only if known
//   Accolades            under each stop: national awards won there (ESPN,
//                        awards/_byAthlete by the player's ESPN id — see
//                        server/awards/nationalAwards.js), placed by season;
//                        all-conference teams (honors/_byCfbd + _byPlayer, from
//                        scripts/importHonors.js), placed by school + season;
//                        under the high school, their recruiting stars and
//                        national rank (players.RecruitStars / RecruitRank).
//                        Each line's icon is its conference logo / award icon
//                        when one is set (utils/accoladeIcons.js, Admin →
//                        Branding → Misc), else a gold star.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useSchools } from "./DraftArchiveList";
import { ELIGIBILITY_DISCLAIMER, currentDraftClass } from "../utils/eligibility";
import { stopSpan, championSeasons } from "../utils/careerStops";
import { stateName, STATE_ABBR } from "../utils/highSchoolMatch";
import { useAccoladeIcons, accoladeIcon } from "../utils/accoladeIcons";
import { draftLogo, PORTAL_LOGO } from "../utils/draftLogos";

const isHex = (hex) => /^#[0-9a-f]{6}$/i.test(hex || "");
const initials = (name) => String(name || "?").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
// Same slugs as the team pages (PlayerProfile.js toTeamSlug) and high
// school pages (HighSchoolTeamPage.js toHsSlug).
const teamSlug = (school) => String(school || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
const hsSlug = (name, state) => `${name || ""} ${STATE_ABBR[state] || state || ""}`.replace(/['’`.]/g, "").replace(/[^a-zA-Z0-9\- ]/g, "").trim().replace(/\s+/g, "-").toLowerCase().replace(/-+/g, "-");

// ESPN national award winners, one doc for every season — fetched once per
// page load and shared. → { [espnId]: [[season, name, desc], …] }
let awardsPromise = null;
function useNationalAwards(espnId) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    setRows([]);
    if (!espnId) return undefined;
    let cancelled = false;
    awardsPromise = awardsPromise || getDoc(doc(db, "awards", "_byAthlete")).then((s) => s.data()?.rows || {}).catch(() => ({}));
    awardsPromise.then((all) => { if (!cancelled) setRows(all[String(espnId)] || []); });
    return () => { cancelled = true; };
  }, [espnId]);
  return rows;
}

// All-conference (and other hand-entered) honors (scripts/importHonors.js):
// honors/_byCfbd, keyed by CFBD athlete — reached through the player's
// cfbdPlayers links, so a player linked after the import still has his — and
// honors/_byPlayer for players with no CFBD link. The two big docs are
// fetched once per page load. → [[season, label, school], …], deduped.
let honorDocs = null;
function useHonors(playerId) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    setRows([]);
    if (!playerId) return undefined;
    let cancelled = false;
    honorDocs = honorDocs || Promise.all(["_byCfbd", "_byPlayer"].map((id) => getDoc(doc(db, "honors", id)).then((s) => s.data()?.rows || {}).catch(() => ({}))));
    const links = getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", playerId)))
      .then((snap) => snap.docs.filter((d) => ["suggested", "verified"].includes(d.data().mappingStatus)).map((d) => d.id))
      .catch(() => []);
    Promise.all([honorDocs, links]).then(([[byCfbd, byPlayer], ids]) => {
      const seen = new Set();
      const out = [...ids.flatMap((id) => byCfbd[id] || []), ...(byPlayer[playerId] || [])]
        .filter((h) => { const k = `${h[0]}|${h[1]}`; if (seen.has(k)) return false; seen.add(k); return true; });
      if (!cancelled) setRows(out);
    });
    return () => { cancelled = true; };
  }, [playerId]);
  return rows;
}

// Hometown / birthday from the player's ESPN athlete record (the same
// endpoint NflPlayerPage.jsx reads): displayBirthPlace is the hometown ESPN
// lists for college players ("Mays Landing, NJ"); dateOfBirth / age only
// come through once they're in the NFL. Cached per page load.
// → { hometown, dob, age }
const bioCache = new Map();
function useEspnBio(espnId) {
  const [bio, setBio] = useState(null);
  useEffect(() => {
    setBio(null);
    if (!espnId) return undefined;
    let cancelled = false;
    if (!bioCache.has(espnId)) {
      bioCache.set(espnId, fetch(`https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/${espnId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { const a = j?.athlete || {}; return { hometown: a.displayBirthPlace || "", dob: a.dateOfBirth || "", age: a.age || null }; })
        .catch(() => null));
    }
    bioCache.get(espnId).then((b) => { if (!cancelled) setBio(b); });
    return () => { cancelled = true; };
  }, [espnId]);
  return bio;
}

// A birthday ("2004-03-09" or an ISO timestamp) → "March 9, 2004" and the
// age today, or null if it doesn't parse.
function birthday(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const age = now.getFullYear() - y - (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d) ? 1 : 0);
  return { text: date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }), age };
}

// A gold accolade line: "2025 · Lou Groza Award", "4-Star Recruit · No. 45 Nationally".
// The marker is the conference logo / award icon when one is set.
function Accolade({ children, title, icon, isMobile }) {
  const [broken, setBroken] = useState(false);
  const size = isMobile ? 18 : 20;
  return (
    <div title={title || undefined} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: isMobile ? 12 : 13, fontWeight: 800, color: "#8a5a00" }}>
      {icon && !broken
        ? <img src={icon} alt="" aria-hidden="true" onError={() => setBroken(true)} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
        : <span aria-hidden="true" style={{ display: "inline-flex", width: 16, height: 16, margin: (size - 16) / 2, borderRadius: "50%", background: "#f6a21d", color: "#fff", fontSize: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>★</span>}
      <span>{children}</span>
    </div>
  );
}

// The player's high school doc (for its branding), matched on name + state,
// and that state's silhouette (stateSilhouettes/{state name}) for a school
// without a logo. → { hs, silhouette }
function useHighSchool(name, state) {
  const [found, setFound] = useState({ hs: null, silhouette: null });
  useEffect(() => {
    setFound({ hs: null, silhouette: null });
    if (!name) return undefined;
    let cancelled = false;
    const st = stateName(state);
    Promise.all([
      getDocs(query(collection(db, "highSchools"), where("Name", "==", name))).catch(() => null),
      st ? getDoc(doc(db, "stateSilhouettes", st)).catch(() => null) : null,
    ]).then(([snap, sil]) => {
      const docs = snap ? snap.docs.map((d) => d.data()) : [];
      const hs = docs.find((d) => d.State === st) || (docs.length === 1 ? docs[0] : null);
      if (!cancelled) setFound({ hs, silhouette: sil?.data()?.Silhouette || null });
    });
    return () => { cancelled = true; };
  }, [name, state]);
  return found;
}

const GAP = 12; // between stops
// fallback: the marker's text with no logo (default: the name's initials).
function Stop({ name, sub, span, current, brand, label, to, accolades, fallback, isMobile, last }) {
  const c1 = isHex(brand?.Color1) ? brand.Color1 : "#5f6b7a";
  const filled = current && isHex(brand?.Color1);
  const logo = filled ? brand.LogoDark || brand.Logo1 : brand?.Logo1;
  const size = isMobile ? 38 : 44;
  const nameLine = isMobile ? 18 : 20;
  const marker = (
    <div style={{
      position: "relative", zIndex: 1, flexShrink: 0, width: size, height: size, borderRadius: "50%", background: filled ? c1 : "#fff",
      boxShadow: `0 0 0 3px ${current ? (isHex(brand?.Color2) && filled ? brand.Color2 : c1) : "#e6ebf2"}, 0 2px 6px rgba(0,0,0,0.08)`,
      display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
    }}>
      {logo
        ? <img src={logo} alt="" style={{ width: "72%", height: "72%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        : <span style={{ fontSize: 11, fontWeight: 900, color: filled ? "#fff" : "#9aa5b4" }}>{fallback || initials(name)}</span>}
    </div>
  );
  return (
    // The logo stays at the top of its stop, level with the name, however
    // many accolade lines run under it.
    <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: isMobile ? 12 : 16, marginBottom: last ? 0 : GAP }}>
      {/* The line to the next stop: this marker's center to the next one's
          (none under the last stop, however many lines it has). */}
      {!last && <div aria-hidden="true" style={{ position: "absolute", left: size / 2 - 1.5, top: size / 2, bottom: -(GAP + size / 2), width: 3, borderRadius: 2, background: "#e6ebf2" }} />}
      {to ? <Link to={to} style={{ display: "flex", flexShrink: 0, borderRadius: "50%", position: "relative", zIndex: 1 }}>{marker}</Link> : marker}
      <div style={{ flex: 1, minWidth: 0, paddingTop: (size - nameLine) / 2, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: isMobile ? 14 : 16, lineHeight: `${nameLine}px`, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em" }}>
            {to ? <Link to={to} style={{ color: "inherit" }}>{name}</Link> : name}
          </span>
          {label && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 900, color: "#6b7685", background: "#eef1f5", borderRadius: 4, padding: "2px 6px", letterSpacing: "0.06em", verticalAlign: "2px" }}>{label}</span>}
          {sub && <div style={{ fontSize: 12, fontWeight: 600, color: "#7a8594" }}>{sub}</div>}
          {(accolades || []).map((a) => <Accolade key={a.key} title={a.title} icon={a.icon} isMobile={isMobile}>{a.text}</Accolade>)}
        </div>
        {span && <span style={{ fontSize: isMobile ? 15 : 17, lineHeight: `${nameLine}px`, fontWeight: 900, color: current ? c1 : "#4a5466", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", letterSpacing: "0.01em" }}>{span}</span>}
      </div>
    </div>
  );
}

// The NFL team that drafted him (nfl/{abbr}: City, Team, Color1/2, Logo1, LogoDark).
function useNflTeam(abbr) {
  const [team, setTeam] = useState(null);
  useEffect(() => {
    setTeam(null);
    if (!abbr) return undefined;
    let cancelled = false;
    getDoc(doc(db, "nfl", abbr)).then((s) => { if (!cancelled) setTeam(s.exists() ? s.data() : null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [abbr]);
  return team;
}

// draft: { team (abbr), round, pick } from PlayerProfile.js's draftOrder
// lookup, once he's been picked.
export default function PlayerEligibilityInfo({ player, text, espnId, draft, color1, isMobile }) {
  const [showNote, setShowNote] = useState(false);
  const saved = player?.CareerStops || [];
  // Newest first. Without saved stops, just their current school — and a
  // transfer's new school leads until CFBD's stops catch up.
  const stops = saved.length ? [...saved].reverse() : player?.School ? [{ School: player.School }] : [];
  if (saved.length && player?.School && stops[0].School !== player.School && !player.InPortal) stops.unshift({ School: player.School });
  const brands = useSchools(stops.filter((s) => s.Level !== "JUCO").map((s) => s.School));
  const { hs, silhouette } = useHighSchool(player?.HighSchool, player?.State);
  const stillInSchool = Number(player?.Eligible) >= Number(currentDraftClass());
  // Each award goes under the college stop whose seasons include it — the
  // newest stop when none does (no saved stops yet, a CFBD gap).
  // All-conference honors carry their school: the stop at that school that
  // season, else any stop at that school, else the newest stop.
  const awards = useNationalAwards(espnId);
  const honors = useHonors(player?.id);
  const icons = useAccoladeIcons();
  const covers = (x, season) => x.From && season >= x.From && season <= x.To;
  const honorStop = ([season, , school]) => {
    const at = stops.findIndex((x) => x.School === school && covers(x, season));
    if (at >= 0) return at;
    const any = stops.findIndex((x) => x.School === school);
    return any >= 0 ? any : 0;
  };
  const awardsAt = (i, s) => [
    // National title teams they were on — first in their season.
    ...championSeasons(s).map((season) => ({ season, rank: -1, key: `${season}-champ`, text: `${season} · National Champion`, icon: accoladeIcon(icons, "award", "National Champion") })),
    ...awards
      .filter(([season]) => covers(s, season) || (i === 0 && !stops.some((x) => covers(x, season))))
      .map(([season, name, desc]) => ({ season, rank: 0, key: `${season}-${name}`, text: `${season} · ${name}`, title: desc, icon: accoladeIcon(icons, "award", name) })),
    ...honors
      .filter((h) => honorStop(h) === i)
      // All-America honors ahead of all-conference ones from the same season.
      .map(([season, label]) => ({ season, rank: /All-American/.test(label) ? 1 : 2, key: `${season}-${label}`, text: `${season} · ${label}`, icon: accoladeIcon(icons, "honor", label) })),
  ].sort((a, b) => b.season - a.season || a.rank - b.rank);
  const stars = Number(player?.RecruitStars) || 0;
  const recruitLine = stars
    // Icon: the "{n}-Star Recruit" award row's (else the fallback's).
    ? [{ key: "stars", text: `${stars}-Star Recruit${player.RecruitRank ? ` · No. ${player.RecruitRank} Nationally` : ""}`, icon: accoladeIcon(icons, "award", `${stars}-Star Recruit`) }]
    : [];
  // Bio: a hand-entered players.Hometown / Birthday wins over ESPN's. Not
  // the high school's city — prep-school players (IMG etc.) aren't from
  // there. Only what we have is shown.
  const bio = useEspnBio(espnId);
  const born = birthday(player?.Birthday || bio?.dob);
  const age = born?.age ?? (bio?.age || null);
  const hometown = player?.Hometown || bio?.hometown || "";
  const facts = [
    hometown && ["Hometown", hometown],
    born && ["Born", born.text],
    age && ["Age", String(age)],
  ].filter(Boolean);
  const heading = (label) => (
    <div className="font-black uppercase" style={{ color: color1, fontSize: isMobile ? "12px" : "14px", letterSpacing: "0.08em" }}>{label}</div>
  );
  // Status stops on top (utils/draftLogos.js): declared — the draft he's
  // entered, under that year's draft logo ("NFL" when the year has none
  // yet); in the transfer portal — the portal arrows (once he picks a
  // school, the new school simply leads, above).
  const draftYear = player?.Declared && stillInSchool && !draft ? Number(player.Eligible) : null;
  // Drafted: his NFL team on top, in its colors, with the round and pick.
  const nfl = useNflTeam(draft?.team);
  const rows = [
    ...(draft ? [{
      key: "nfl", name: nfl ? `${nfl.City || ""} ${nfl.Team || ""}`.trim() : draft.team,
      brand: nfl, current: true, fallback: draft.team,
      sub: `${player?.Eligible || ""} NFL Draft`.trim(),
      span: draft.round ? `Round ${draft.round}${draft.pick ? `, Pick ${draft.pick}` : ""}` : "Drafted",
      to: `/nfl/${String(draft.team).toLowerCase()}`, accolades: [],
    }] : []),
    ...(draftYear ? [{
      key: "draft", name: `${draftYear} NFL Draft`, brand: draftLogo(draftYear) ? { Logo1: draftLogo(draftYear) } : null,
      fallback: "NFL", span: "Declared", accolades: [],
    }] : []),
    ...(player?.InPortal ? [{ key: "portal", name: "Transfer Portal", brand: { Logo1: PORTAL_LOGO }, span: "Entered", accolades: [] }] : []),
    ...stops.map((s, i) => ({
      key: `${s.School}-${s.From}`, name: s.School, label: s.Level === "JUCO" ? "JUCO" : null, brand: s.Level === "JUCO" ? null : brands[s.School],
      current: !draft && i === 0 && stillInSchool && s.School === player.School,
      span: s.From ? stopSpan(s, { current: !draft && i === 0 && stillInSchool && s.School === player.School }) : !draft && i === 0 && stillInSchool && s.School === player.School ? "Present" : null,
      to: s.Level !== "JUCO" && brands[s.School] ? `/team/${brands[s.School].slug || teamSlug(s.School)}` : null,
      accolades: s.Level === "JUCO" ? [] : awardsAt(i, s),
    })),
    ...(player?.HighSchool ? [{
      key: "hs", name: player.HighSchool, label: "High School",
      brand: hs?.Logo1 ? hs : silhouette ? { Logo1: silhouette } : null,
      // No school logo or state silhouette: the state's shorthand ("TX").
      fallback: STATE_ABBR[stateName(player.State)] || null,
      sub: [hs?.City, stateName(player.State)].filter(Boolean).join(", "),
      span: player.RecruitYear ? `Graduated ${player.RecruitYear}` : null,
      accolades: recruitLine,
      to: hs?.Ranking === 3 ? `/hs/${hsSlug(hs.Name, hs.State)}` : null,
    }] : []),
  ];

  return (
    <div style={{ border: `2px solid ${color1}`, borderRadius: "8px", background: "#fff", padding: isMobile ? "12px" : "16px 20px" }}>
      {text && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
            {heading("College Eligibility")}
            <button
              type="button" onClick={() => setShowNote((v) => !v)} aria-expanded={showNote} aria-label="About college eligibility"
              title="About college eligibility"
              style={{
                width: "24px", height: "24px", borderRadius: "50%", border: `2px solid ${color1}`, cursor: "pointer", flexShrink: 0,
                background: showNote ? color1 : "#fff", color: showNote ? "#fff" : color1,
                fontWeight: 900, fontSize: "13px", lineHeight: 1, fontFamily: "Georgia, serif", fontStyle: "italic", padding: 0,
              }}
            >
              i
            </button>
          </div>
          <p style={{ margin: 0, fontSize: isMobile ? "15px" : "17px", fontWeight: 700, lineHeight: 1.5, color: "#1f2937" }}>{text}</p>
          {showNote && (
            <p style={{ margin: "10px 0 0", padding: "8px 10px", borderRadius: "6px", background: "#f3f5f8", fontSize: isMobile ? "12px" : "13px", fontWeight: 600, lineHeight: 1.45, color: "#5b6676" }}>
              {ELIGIBILITY_DISCLAIMER}
            </p>
          )}
        </>
      )}
      {facts.length > 0 && (
        <div style={{ marginTop: text ? (isMobile ? 18 : 22) : 0, display: "flex", flexWrap: "wrap", gap: isMobile ? "10px 22px" : "10px 36px" }}>
          {facts.map(([label, value]) => (
            <div key={label} style={{ minWidth: 0 }}>
              {heading(label)}
              <div style={{ marginTop: 2, fontSize: isMobile ? "15px" : "17px", fontWeight: 700, color: "#1f2937" }}>{value}</div>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div style={{ marginTop: text || facts.length ? (isMobile ? 18 : 22) : 0, marginBottom: 12 }}>{heading("Career Path")}</div>
          <div style={{ position: "relative" }}>
            {rows.map((r, i) => <Stop key={r.key} {...r} isMobile={isMobile} last={i === rows.length - 1} />)}
          </div>
        </>
      )}
    </div>
  );
}
