// src/components/PlayerEligibilityInfo.jsx
//
// The player page's Info tab (pages/PlayerProfile.js, next to Stats):
//   In Their Own Words  players.Answers [{ q, a, date, sample? }] — the
//                        player's answers to our outreach questions (Admin →
//                        Social → Pitch), each as the question over the quoted
//                        answer, signed "— First Last, Month Year" (date:
//                        "YYYY-MM-DD", when they answered); an InfoTip by
//                        the title explains the campaign.
//                        sample: true shows to admins only (a SAMPLE tag) —
//                        for laying the section out on a real page.
//   College Eligibility  one plain sentence (utils/eligibility.js
//                        eligibilityInfo — the admin's True / +1 tags are
//                        never shown); an InfoTip by the title holds the
//                        estimate disclaimer
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
import { ELIGIBILITY_DISCLAIMER, currentDraftClass, inHighSchool } from "../utils/eligibility";
import { stopSpan, championSeasons } from "../utils/careerStops";
import { stateName, STATE_ABBR } from "../utils/highSchoolMatch";
import { useAccoladeIcons, accoladeIcon } from "../utils/accoladeIcons";
import { draftLogo, PORTAL_LOGO } from "../utils/draftLogos";
import { useEventYear, playerEvents } from "../utils/events";
import { useIsAdmin } from "../utils/prospectYears";
import { usePreviewMode } from "../utils/previewLinks";

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
// age today and on Sept. 1 of their draft class (week 1 of their rookie
// season), each to the tenth of a year, rounded down ("24.2" — the draft
// analyst's age), or null if it doesn't parse ("U" = admin couldn't find it).
// estimated: the date is a stand-in (estimatedBirthday below) — never shown,
// and ages are whole years with a "~" ("~21").
function birthday(value, draftClass, estimated = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  const ageAt = (ms) => {
    const years = (ms - date.getTime()) / (365.25 * 86400000);
    return estimated ? `~${Math.floor(years)}` : (Math.floor(years * 10) / 10).toFixed(1);
  };
  const now = new Date();
  const age = ageAt(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const cls = Number(draftClass);
  const rookieAge = cls > 1900 ? ageAt(Date.UTC(cls, 8, 1)) : null;
  const text = estimated ? null : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { text, age, rookieAge };
}

// No known birthday: assume they turned 18 on Jan. 1 of their recruiting
// class year (players.RecruitYear) — "2005-01-01" for a 2023 recruit.
function estimatedBirthday(recruitYear) {
  const y = Number(recruitYear);
  return y > 1900 ? `${y - 18}-01-01` : null;
}

// A gold accolade line: "2025 · Lou Groza Award", "4-Star Recruit · No. 45 Nationally".
// The marker is the conference logo / award icon when one is set.
function Accolade({ children, title, icon, isMobile, dark = false }) {
  const [broken, setBroken] = useState(false);
  const size = isMobile ? 18 : 20;
  return (
    <div title={title || undefined} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: isMobile ? 12 : 13, fontWeight: 800, color: dark ? "#f6c35a" : "#8a5a00" }}>
      {icon && !broken
        ? <img src={icon} alt="" aria-hidden="true" onError={() => setBroken(true)} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
        : <span aria-hidden="true" style={{ display: "inline-flex", width: 16, height: 16, margin: (size - 16) / 2, borderRadius: "50%", background: "#f6a21d", color: "#fff", fontSize: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>★</span>}
      <span>{children}</span>
    </div>
  );
}

// The player's high school doc (for its branding), matched on name + state
// (one read — six schools share "Liberty"), else the one school by that
// name in any state (IMG and other national schools, or no state on file);
// and that state's silhouette (stateSilhouettes/{state name}, cached per
// state) for a school without a logo. → { hs, silhouette }
const silhouetteCache = new Map();
const silhouetteOf = (st) => {
  if (!silhouetteCache.has(st)) silhouetteCache.set(st, getDoc(doc(db, "stateSilhouettes", st)).then((s) => s.data()?.Silhouette || null).catch(() => null));
  return silhouetteCache.get(st);
};
async function findHighSchool(name, st) {
  const byName = (...w) => getDocs(query(collection(db, "highSchools"), where("Name", "==", name), ...w)).then((s) => s.docs.map((d) => d.data()));
  if (st) {
    const [hit] = await byName(where("State", "==", st));
    if (hit) return hit;
  }
  const docs = await byName();
  return docs.length === 1 ? docs[0] : null;
}
function useHighSchool(name, state) {
  const [found, setFound] = useState({ hs: null, silhouette: null });
  useEffect(() => {
    setFound({ hs: null, silhouette: null });
    if (!name) return undefined;
    let cancelled = false;
    const st = stateName(state);
    Promise.all([
      findHighSchool(name, st).catch(() => null),
      st ? silhouetteOf(st) : null,
    ]).then(([hs, silhouette]) => {
      if (!cancelled) setFound({ hs, silhouette });
    });
    return () => { cancelled = true; };
  }, [name, state]);
  return found;
}

const GAP = 12; // between stops
// fallback: the marker's text with no logo (default: the name's initials).
// Exported as CareerStop: the Transfer Portal's player card draws its career
// path with it (pages/TransferPortal.jsx — same look as here).
// dark (the Portal Sim's card, user 2026-11-18): light text; schools on
// their own color with the dark-background logo; the high school (and marks
// with no colors — the portal arrows, the draft) keep a light gray circle.
export function CareerStop(props) { return <Stop {...props} />; }
function Stop({ name, sub, span, current, brand, label, to, accolades, fallback, isMobile, last, dark = false }) {
  const c1 = isHex(brand?.Color1) ? brand.Color1 : "#5f6b7a";
  const filled = dark ? label !== "High School" && isHex(brand?.Color1) : current && isHex(brand?.Color1);
  const logo = filled ? brand.LogoDark || brand.Logo1 : brand?.Logo1;
  const line = dark ? "#2a3850" : "#e6ebf2";
  const size = isMobile ? 38 : 44;
  const nameLine = isMobile ? 18 : 20;
  const marker = (
    <div style={{
      position: "relative", zIndex: 1, flexShrink: 0, width: size, height: size, borderRadius: "50%", background: filled ? c1 : dark ? "#e9edf3" : "#fff",
      boxShadow: `0 0 0 3px ${current ? (isHex(brand?.Color2) && filled ? brand.Color2 : c1) : line}, 0 2px 6px rgba(0,0,0,0.08)`,
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
      {!last && <div aria-hidden="true" style={{ position: "absolute", left: size / 2 - 1.5, top: size / 2, bottom: -(GAP + size / 2), width: 3, borderRadius: 2, background: line }} />}
      {to ? <Link to={to} style={{ display: "flex", flexShrink: 0, borderRadius: "50%", position: "relative", zIndex: 1 }}>{marker}</Link> : marker}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Padded down so the name sits at the logo's vertical middle, with
            the location and accolade lines tucked right under it (not under
            the logo's full height). The tag hugs the name; the years follow
            it on mobile and sit at the right edge on desktop. */}
        <div style={{ paddingTop: (size - nameLine) / 2, display: "flex", alignItems: "center", flexWrap: "wrap", gap: isMobile ? "0 8px" : "0 10px" }}>
          <span style={{ minWidth: 0, display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: isMobile ? 14 : 16, lineHeight: `${nameLine}px`, fontWeight: 900, color: dark ? "#eef2f8" : "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em" }}>
              {to ? <Link to={to} style={{ color: "inherit" }}>{name}</Link> : name}
            </span>
            {label && <span style={{ fontSize: 9, lineHeight: "12px", fontWeight: 900, color: dark ? "#9fb0c8" : "#6b7685", background: dark ? "#1f2b42" : "#eef1f5", borderRadius: 4, padding: "2px 5px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>}
          </span>
          {span && <span style={{ marginLeft: isMobile ? 0 : "auto", fontSize: isMobile ? 14 : 17, lineHeight: `${nameLine}px`, fontWeight: 900, color: dark ? (current ? "#fff" : "#b8c4d6") : current ? c1 : "#4a5466", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", letterSpacing: "0.01em" }}>{span}</span>}
        </div>
        {sub && <div style={{ marginTop: 2, fontSize: 12, fontWeight: 600, color: dark ? "#8b9bb4" : "#7a8594" }}>{sub}</div>}
        {(accolades || []).map((a) => <Accolade key={a.key} title={a.title} icon={a.icon} isMobile={isMobile} dark={dark}>{a.text}</Accolade>)}
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

// What the answers' InfoTip says about the campaign.
export const ANSWERS_ABOUT = "We-Draft.com regularly reaches out to prospects on social media to add their own words to their profile.";

// A small italic "i" (no circle) beside a section title; hover, focus or tap
// opens a dark card with the note. Used by In Their Own Words and College
// Eligibility alike.
function InfoTip({ note, label, color1, isMobile }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", verticalAlign: "baseline" }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={() => setOpen((v) => !v)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        aria-expanded={open} aria-label={label} title={label}
        style={{
          background: "none", border: "none", padding: "0 4px", marginLeft: 2, cursor: "pointer", lineHeight: 1,
          color: color1, fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 900, fontSize: isMobile ? "15px" : "17px",
        }}>
        i
      </button>
      {open && (
        <span role="tooltip" style={{
          position: "absolute", left: 0, top: "100%", marginTop: 6, zIndex: 20, width: isMobile ? 230 : 300,
          background: "#0f1b2d", color: "#fff", borderRadius: 8, padding: "10px 12px", boxShadow: "0 8px 22px rgba(0,0,0,0.25)",
          fontSize: "13px", fontWeight: 600, fontStyle: "normal", lineHeight: 1.45, whiteSpace: "normal", textAlign: "left",
        }}>
          {note}
        </span>
      )}
    </span>
  );
}

// "YYYY-MM-DD" (or "YYYY-MM") → "January 2026"; "" when there's no date.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthYear = (date) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(date || ""));
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
};

// players.Answers with something in them; sample ones for admins only.
export const playerAnswers = (player, isAdmin) => (Array.isArray(player?.Answers) ? player.Answers : [])
  .filter((x) => x && String(x.q || "").trim() && String(x.a || "").trim() && (isAdmin || !x.sample));

// draft: { team (abbr), round, pick } from PlayerProfile.js's draftOrder
// lookup, once he's been picked.
export default function PlayerEligibilityInfo({ player, text, espnId, draft, color1, isMobile }) {
  const { isAdmin } = useIsAdmin();
  // Preview links (utils/previewLinks.js) leave out the birthday and ages.
  const preview = usePreviewMode();
  const answers = playerAnswers(player, isAdmin);
  const { rows, hometown, born, age } = useCareerPath(player, espnId, draft);
  // Hometown on its own line; birthday and ages on the line under it — on
  // mobile the birthday gets its own line and the two ages share the next.
  const bornFact = !preview && born?.text && ["Born", born.text];
  const ageFacts = [!preview && age && ["Current Age", String(age)], !preview && born?.rookieAge && ["Rookie Age", born.rookieAge, `Age at Week 1 of the ${player.Eligible} NFL season (Sept. 1)`]];
  const factRows = [
    [hometown && ["Hometown", hometown]],
    ...(isMobile ? [[bornFact], ageFacts] : [[bornFact, ...ageFacts]]),
  ].map((r) => r.filter(Boolean)).filter((r) => r.length);
  const facts = factRows.flat();
  const heading = (label) => (
    <div className="font-black uppercase" style={{ color: color1, fontSize: isMobile ? "12px" : "14px", letterSpacing: "0.08em" }}>{label}</div>
  );
  return (
    <InfoBody {...{ answers, text, facts, factRows, rows, heading, player, color1, isMobile }} />
  );
}

// The Info tab's data, shared with Draft Sim's player card
// (draftSim/ProspectCard.jsx): the Career Path rows (NFL team / declared /
// portal on top, the college stops with their accolades, the high school
// with its recruiting line), hometown, birthday and ages.
// → { rows: [{ key, name, sub, span, current, brand, label, to, accolades, fallback }],
//     hometown, born: { text, age, rookieAge } | null, age }
export function useCareerPath(player, espnId, draft) {
  const saved = player?.CareerStops || [];
  // Newest first. Without saved stops, just their current school — and a
  // transfer's new school leads until CFBD's stops catch up.
  const stops = saved.length ? [...saved].reverse() : player?.School ? [{ School: player.School }] : [];
  if (saved.length && player?.School && stops[0].School !== player.School && !player.InPortal) stops.unshift({ School: player.School });
  // Draft-season events he took part in (utils/events.js — the Combine, the
  // all-star games, his pro day), once he's declared or been drafted.
  const eventYear = player?.Declared || draft ? Number(player?.Eligible) || null : null;
  const eventData = useEventYear(eventYear);
  const eventRows = playerEvents(eventData, player?.id, eventYear);
  const brands = useSchools([...stops.filter((s) => s.Level !== "JUCO").map((s) => s.School), ...eventRows.map((r) => r.school).filter(Boolean)]);
  const { hs, silhouette } = useHighSchool(player?.HighSchool, player?.State);
  const stillInSchool = Number(player?.Eligible) >= Number(currentDraftClass());
  // A promoted recruit still in high school: the college is where they're
  // committed (not current), and the high school is the current stop.
  const hsSenior = inHighSchool(player);
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
  // Saved birthday, else ESPN's, else an estimate from the recruiting class
  // (ages only, "~21" — the made-up date is never shown).
  const born = birthday(player?.Birthday, player?.Eligible) || birthday(bio?.dob, player?.Eligible)
    || birthday(estimatedBirthday(player?.RecruitYear), player?.Eligible, true);
  const age = born?.age ?? (bio?.age || null);
  const hometown = player?.Hometown || bio?.hometown || "";
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
    ...eventRows.map((r) => ({
      key: `event-${r.slug}`, name: r.name, brand: r.logo ? { Logo1: r.logo } : brands[r.school] || null, fallback: "PD",
      span: r.span, sub: r.sub, to: r.to, accolades: r.results ? [{ key: "results", text: r.results }] : [],
    })),
    ...(player?.InPortal ? [{ key: "portal", name: "Transfer Portal", brand: { Logo1: PORTAL_LOGO }, span: "Entered", accolades: [] }] : []),
    ...stops.map((s, i) => ({
      key: `${s.School}-${s.From}`, name: s.School, label: s.Level === "JUCO" ? "JUCO" : null, brand: s.Level === "JUCO" ? null : brands[s.School],
      current: !draft && !hsSenior && i === 0 && stillInSchool && s.School === player.School,
      span: hsSenior && !s.From && s.School === player.School ? "Committed"
        : s.From ? stopSpan(s, { current: !draft && i === 0 && stillInSchool && s.School === player.School }) : !draft && i === 0 && stillInSchool && s.School === player.School ? "Present" : null,
      to: s.Level !== "JUCO" && brands[s.School] ? `/team/${brands[s.School].slug || teamSlug(s.School)}` : null,
      accolades: s.Level === "JUCO" ? [] : awardsAt(i, s),
    })),
    ...(player?.HighSchool ? [{
      key: "hs", name: player.HighSchool, label: "High School",
      brand: hs?.Logo1 ? hs : silhouette ? { Logo1: silhouette } : null,
      // No school logo or state silhouette: the state's shorthand ("TX").
      fallback: STATE_ABBR[stateName(player.State)] || null,
      sub: [hs?.City, stateName(player.State)].filter(Boolean).join(", "),
      current: hsSenior,
      span: player.RecruitYear ? `${hsSenior ? "Class of" : "Graduated"} ${player.RecruitYear}` : null,
      accolades: recruitLine,
      to: hs?.Ranking === 3 ? `/hs/${hsSlug(hs.Name, hs.State)}` : null,
    }] : []),
  ];
  return { rows, hometown, born, age };
}

function InfoBody({ answers, text, facts, factRows, rows, heading, player, color1, isMobile }) {
  return (
    <div style={{ border: `2px solid ${color1}`, borderRadius: "8px", background: "#fff", padding: isMobile ? "12px" : "16px 20px" }}>
      {answers.length > 0 && (
        <div style={{ marginBottom: text || facts.length || rows.length ? (isMobile ? 18 : 22) : 0 }}>
          <div style={{ marginBottom: 10, display: "flex", alignItems: "center" }}>
            {heading("In Their Own Words")}
            <InfoTip note={ANSWERS_ABOUT} label="About these answers" color1={color1} isMobile={isMobile} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 14 : 16 }}>
            {answers.map((x, i) => (
              <div key={i}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: isMobile ? "13px" : "14px", fontWeight: 800, color: "#5b6676", lineHeight: 1.4 }}>
                  <span>{x.q}</span>
                  {x.sample && <span style={{ flexShrink: 0, fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", color: "#fff", background: "#c0392b", borderRadius: 4, padding: "2px 6px" }}>SAMPLE · ADMIN ONLY</span>}
                </div>
                <blockquote style={{ margin: "6px 0 0", padding: "2px 0 2px 14px", borderLeft: `4px solid ${color1}`, fontSize: isMobile ? "16px" : "19px", fontWeight: 700, fontStyle: "italic", lineHeight: 1.45, color: "#1f2937" }}>
                  “{x.a}”
                </blockquote>
                <div style={{ marginTop: 4, paddingLeft: 18, fontSize: isMobile ? "14px" : "15px", fontWeight: 800, color: "#5b6676" }}>
                  — {[`${player.First || ""} ${player.Last || ""}`.trim(), monthYear(x.date)].filter(Boolean).join(", ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {text && (
        <>
          <div style={{ marginBottom: "8px", display: "flex", alignItems: "center" }}>
            {heading("College Eligibility")}
            <InfoTip note={ELIGIBILITY_DISCLAIMER} label="About college eligibility" color1={color1} isMobile={isMobile} />
          </div>
          <p style={{ margin: 0, fontSize: isMobile ? "15px" : "17px", fontWeight: 700, lineHeight: 1.5, color: "#1f2937" }}>{text}</p>
        </>
      )}
      {facts.length > 0 && (
        <div style={{ marginTop: text ? (isMobile ? 18 : 22) : 0, display: "flex", flexDirection: "column", gap: isMobile ? 12 : 14 }}>
          {factRows.map((r) => (
            <div key={r[0][0]} style={{ display: "flex", flexWrap: isMobile ? "nowrap" : "wrap", gap: isMobile ? "10px 22px" : "10px 36px" }}>
              {r.map(([label, value, note]) => (
                <div key={label} style={{ minWidth: 0, flexShrink: note ? 1 : 0 }}>
                  {heading(label)}
                  <div style={{ marginTop: 2, fontSize: isMobile ? "15px" : "17px", fontWeight: 700, color: "#1f2937" }}>{value}</div>
                  {note && <div style={{ marginTop: 1, fontSize: isMobile ? "11px" : "12px", fontWeight: 600, color: "#7a8594" }}>{note}</div>}
                </div>
              ))}
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
