// src/components/TeamTargetsWX.jsx
//
// The NFL team page's Targets tab (/nfl/{team}) as WX content (user,
// 2026-11-21 — utils/nflTargets.js):
//   2027        the admin's curated list once it's published — 5 featured
//               players (his draft card as a flip card — the back: his
//               headshot, bio, season stats and draft snapshot — the
//               write-up, and his staff fit when he fits the staff), then up
//               to 30 more as full-width rows (headshot, 2026 stats, fit). Nobody is numbered (user's
//               call — it's a set of targets, not a ranking). A fit chip
//               always says whose fit it is.
//               Unpublished: an admin sees it as a preview; everyone else
//               keeps the legacy coach-fit view.
//   2028, 2029  the legacy coach-fit view (ProjectedPicks.jsx), offered only
//               when the class has a fit for this team.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ProjectedPicks, { comparisonSentence, FitBadge } from "./ProjectedPicks";
import { useSchools } from "./DraftArchiveList";
import { useDraftCard, playerShots } from "./DraftCardGraphic";
import { FlipCard, CardBack, FLIP_CSS, loadScoutBacks } from "./ScoutCard";
import { useVisibleProspectYears } from "../utils/prospectYears";
import { playerHref, schoolHref } from "../utils/events";
import { loadPhotos } from "../utils/profileHub";
import { loadWeeklyMockSummary } from "../utils/weeklyMockNews";
import { loadBlurbs, writeUpFor } from "../utils/prospectBlurbs";
import { fitTier } from "../utils/draftProfiles";
import { TARGETS_YEAR, byOrder, fitFor, legacyYearsWithFits, draftCardImageUrl } from "../utils/nflTargets";
import { LOCAL } from "./RiserGraphic";

const BODY = "Arial, sans-serif";
const GOLD = "#f6a21d";
// The draft card's colors (utils/instagram/draftCard.js) — the back matches
// the front: a blue → navy band (no gold gradient — user), gold labels.
// The card is the same for every team that lists him: nothing on it (front
// or back) is about one team — no staff fit, no mock pick (those go beside it).
const NIGHT = { c1: "#0055a5", c2: "#0a2a57", deep: "#02060f", mid: "#061a36", accent: GOLD };
const card = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2", overflow: "hidden" };
const tint = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${a}` : "transparent");
const paragraphs = (t) => String(t || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
const nameOf = (p) => `${p.first} ${p.last}`;
const SLOT_NAMES = { GM: "General Manager", HC: "Head Coach", OC: "Offensive Coordinator", DC: "Defensive Coordinator" };

export default function TeamTargetsWX({ teamKey, teamName, staff, staffLoading, curated, targets, isAdmin, color1, color2, isMobile }) {
  const visible = useVisibleProspectYears();
  const legacy = useMemo(() => legacyYearsWithFits(targets), [targets]);
  const years = [TARGETS_YEAR, ...legacy].filter((y) => visible.includes(y));
  const [year, setYear] = useState(TARGETS_YEAR);
  useEffect(() => { setYear(TARGETS_YEAR); }, [teamKey]);
  const featured = byOrder(curated?.featured);
  const list = byOrder(curated?.list);
  const hasList = featured.length + list.length > 0;
  const showWx = year === TARGETS_YEAR && hasList && (curated?.published || isAdmin);
  const fixed = useMemo(() => [year], [year]);

  const chip = (on) => ({
    border: `2px solid ${on ? color1 : tint(color1, "33")}`, borderRadius: 8, padding: "6px 14px",
    background: on ? color1 : "#fff", color: on ? "#fff" : color1, cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: 12, letterSpacing: "0.05em",
  });

  return (
    <div>
      {years.length > 1 && (
        <div role="tablist" aria-label="Draft class" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: "#6b7685", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>Class</span>
          {years.map((y) => <button key={y} type="button" role="tab" aria-selected={year === y} onClick={() => setYear(y)} style={chip(year === y)}>{y}</button>)}
        </div>
      )}
      {showWx
        ? <CuratedList teamKey={teamKey} teamName={teamName} curated={curated} featured={featured} list={list} targets={targets} color1={color1} color2={color2} isMobile={isMobile} />
        : <ProjectedPicks staff={staff} staffLoading={staffLoading} teamKey={teamKey} color1={color1} color2={color2} isMobile={isMobile} fixedYears={fixed} />}
    </div>
  );
}

// His best fit with this staff, said plainly — whose fit it is and why:
// → { score, tier, who, why } or null.
//   staff blend   "Staff fit" · "with the players this front office and staff have drafted"
//   one person    "Kevin O'Connell" · "Head Coach"
//   a match       "Like Justin Jefferson" · "drafted by Kwesi Adofo-Mensah, 2020"
export function fitReason(fit, members) {
  if (!fit) return null;
  const name = (slot) => members[slot]?.person?.Name || "";
  const opts = [];
  if (fit.score != null) opts.push({ score: fit.score, who: "Staff fit", why: "with the players this front office and coaching staff have drafted" });
  // (A staff member by name only — no title; user.)
  fit.parts.forEach((x) => opts.push({ score: x.score, who: name(x.slot) || SLOT_NAMES[x.slot] || x.slot, why: "" }));
  fit.matches.forEach((m) => opts.push({ score: m.s, who: `Like ${m.pl}`, why: `drafted by ${m.pn}${m.y ? `, ${m.y}` : ""}` }));
  const best = opts.sort((a, b) => b.score - a.score)[0];
  return best ? { ...best, tier: fitTier(best.score) } : null;
}

function CuratedList({ teamKey, teamName, curated, featured, list, targets, color1, color2, isMobile }) {
  const all = useMemo(() => [...featured, ...list], [featured, list]);
  const schools = useSchools(all.map((p) => p.school));
  const updated = curated.updatedAt?.toDate ? curated.updatedAt.toDate() : null;
  const intro = paragraphs(curated.intro);
  const members = Object.fromEntries((targets?.members || []).map((m) => [m.slot, m]));
  const idKey = all.map((p) => p.id).join(",");
  // Headshots (every player), the featured backs' data, and the latest Weekly Mock.
  const [photos, setPhotos] = useState({});
  const [backs, setBacks] = useState({});
  const [mock, setMock] = useState(null);
  const [blurbs, setBlurbs] = useState({});
  // Which featured players have an action shot placed (their draft card's
  // photo): { [id]: true | false } — one without shows in the list until he
  // has one (user); one not checked yet shows in neither, so nobody jumps.
  const [hasShot, setHasShot] = useState({});
  useEffect(() => {
    let live = true;
    const ids = all.map((p) => p.id).filter(Boolean);
    featured.forEach((p) => playerShots(p.id).then((s) => live && setHasShot((m) => ({ ...m, [p.id]: s.length > 0 }))).catch(() => live && setHasShot((m) => ({ ...m, [p.id]: false }))));
    loadBlurbs().then((b) => live && setBlurbs(b)).catch(() => {});
    loadPhotos(ids).then((ph) => {
      if (!live) return;
      setPhotos(ph);
      loadScoutBacks(all.map((p) => ({ id: p.id, pos: p.pos, espnId: ph[p.id]?.espnId || "" })))
        .then((b) => live && setBacks(b)).catch(() => {});
    }).catch(() => {});
    loadWeeklyMockSummary(TARGETS_YEAR).then((m) => live && setMock(m)).catch(() => {});
    return () => { live = false; };
  }, [idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownFeatured = featured.filter((p) => hasShot[p.id] === true);
  const rows = [...featured.filter((p) => hasShot[p.id] === false), ...list];

  return (
    <div>
      <style>{FLIP_CSS}</style>
      {!curated.published && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, background: "#fff4e0", border: `2px solid ${GOLD}`, fontFamily: BODY, fontSize: 13, fontWeight: 800, color: "#7a4a00" }}>
          Preview — not published. Everyone else still sees the coach-fit view. Publish it in Admin → Content → WX → NFL Targets.
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginBottom: intro.length ? 8 : 14 }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 20 : 26, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", lineHeight: 1.1 }}>
          {teamName} {TARGETS_YEAR} Draft Targets
        </h2>
        {updated && <span style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: BODY }}>Updated {updated.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
      </div>
      {intro.length > 0 && (
        <div style={{ margin: "0 0 18px", padding: "2px 0 2px 16px", borderLeft: `4px solid ${color2 || GOLD}`, fontFamily: BODY, fontSize: isMobile ? 15 : 17, lineHeight: 1.6, fontWeight: 600, color: "#2a3140" }}>
          {intro.map((t, i) => <p key={i} style={{ margin: i ? "10px 0 0" : 0 }}>{t}</p>)}
        </div>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
        {shownFeatured.map((p) => (
          <li key={p.id}>
            <Featured p={p} teamKey={teamKey} version={curated.updatedAt?.toMillis?.() || ""} writeUp={writeUpFor(p, blurbs)} school={schools[p.school]} fit={fitFor(targets, p.id)} members={members} photo={photos[p.id]?.headshot || ""}
              back={backs[p.id]} mockPick={mock?.players?.[p.id] ? { ...mock.players[p.id], teamName: mock.teams?.[mock.players[p.id].team]?.name || mock.players[p.id].team } : null}
              color1={color1} color2={color2} isMobile={isMobile} />
          </li>
        ))}
      </ul>

      {rows.length > 0 && (
        <section style={{ marginTop: shownFeatured.length ? 28 : 0 }}>
          <h3 style={{ margin: "0 0 12px", display: "flex", alignItems: "center", gap: 10, fontSize: isMobile ? 15 : 18, fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {shownFeatured.length ? `More ${teamName} Targets` : `${teamName} Targets`}
            <span style={{ flex: 1, height: 3, borderRadius: 2, background: `linear-gradient(to right, ${color2}, ${tint(color2, "00")})` }} />
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: isMobile ? 8 : 10 }}>
            {rows.map((p) => (
              <li key={p.id}>
                <TargetRow p={p} blurb={blurbs[p.id] || paragraphs(p.note)[0] || ""} school={schools[p.school]} photo={photos[p.id]?.headshot || ""} back={backs[p.id]} reason={fitReason(fitFor(targets, p.id), members)} color1={color1} color2={color2} isMobile={isMobile} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div style={{ marginTop: 16, fontSize: 11, fontWeight: 700, color: "#5f6b7a", fontFamily: BODY, lineHeight: 1.5 }}>
        Targets picked by We-Draft.com, in no particular order. Fits compare a prospect's height, weight and community-graded traits with the players the {teamName} general
        manager and coaches have drafted — each fit names the staff member (or the drafted player he matches) it's with. 70+ strong, 80+ very strong, 90+ extremely strong.
      </div>
    </div>
  );
}

// A list target, the full row: his headshot (school logo on its corner),
// name, position and school; his 2026 season numbers (height and weight
// for a lineman, or when there's no season line); then his fit — whose it
// is — when he has one.
function TargetRow({ p, blurb = "", school, photo, back, reason, color1, color2, isMobile }) {
  const href = playerHref(p);
  const logo = school?.Logo1 || school?.LogoDark || "";
  const H = isMobile ? 64 : 78;
  const bio = [["Height", back?.profile?.Height], ["Weight", back?.profile?.Weight ? `${back.profile.Weight} lbs` : ""]].filter(([, v]) => v).map(([label, value]) => ({ label, value }));
  const season = (back?.stats || []).length > 0;
  const nums = season ? back.stats : bio;
  const name = <span style={{ display: "block", fontSize: isMobile ? 17 : 21, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(p)}</span>;
  const stats = nums.length > 0 && (
    <span style={{ display: "flex", alignItems: "stretch", flexShrink: 0, width: isMobile ? "100%" : "auto", borderRadius: 10, background: "#f5f7fa", border: "1px solid #e6ebf2", overflow: "hidden" }}>
      <span style={{ display: "grid", placeItems: "center", padding: "0 8px", background: tint(color1, "14"), color: color1, fontFamily: BODY, fontSize: 9, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
        {season ? "2026" : "Bio"}
      </span>
      {nums.map((s, i) => (
        <span key={s.label} style={{ minWidth: isMobile ? 0 : 74, flex: isMobile ? 1 : "none", textAlign: "center", padding: isMobile ? "6px 6px" : "8px 10px", borderLeft: i ? "1px solid #e6ebf2" : "none" }}>
          <span style={{ display: "block", fontSize: isMobile ? 17 : 20, fontWeight: 900, color: "#1a1f2b", fontVariantNumeric: "tabular-nums", lineHeight: 1.05 }}>{s.value}</span>
          <span style={{ display: "block", marginTop: 3, fontFamily: BODY, fontSize: 9.5, fontWeight: 900, color: "#6b7685", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{s.label}</span>
        </span>
      ))}
    </span>
  );
  return (
    <div style={{ ...card, borderLeft: `5px solid ${color1}`, background: `linear-gradient(100deg, ${tint(color1, "10")} 0%, #ffffff 30%)` }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: isMobile ? "wrap" : "nowrap", gap: isMobile ? 12 : 18, padding: isMobile ? "12px 12px" : "14px 18px" }}>
      <span style={{ position: "relative", width: H, height: H, flexShrink: 0 }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", background: `radial-gradient(circle at 50% 30%, ${tint(color1, "55")}, ${color1})`, boxShadow: `0 0 0 3px #fff, 0 0 0 5px ${tint(color2 || GOLD, "cc")}` }}>
          {photo
            ? <img src={photo} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
            : logo && <img src={school?.LogoDark || logo} alt="" loading="lazy" style={{ position: "absolute", inset: "18%", width: "64%", height: "64%", objectFit: "contain" }} />}
        </span>
        {photo && logo && (
          <span style={{ position: "absolute", right: -6, bottom: -4, width: H * 0.42, height: H * 0.42, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.25)", display: "grid", placeItems: "center" }}>
            <img src={logo} alt="" loading="lazy" style={{ width: "72%", height: "72%", objectFit: "contain" }} />
          </span>
        )}
      </span>
      <span style={{ flex: 1, minWidth: isMobile ? "calc(100% - 90px)" : 0, display: "grid", gap: 6 }}>
        {href ? <Link to={href} style={{ color: "inherit", textDecoration: "none", minWidth: 0 }}>{name}</Link> : name}
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontFamily: BODY, fontSize: 13, fontWeight: 800, color: "#5f6b7a" }}>
          <span style={{ flexShrink: 0, background: color1, color: "#fff", borderRadius: 5, padding: "2px 8px", fontWeight: 900, fontSize: 12, letterSpacing: "0.04em" }}>{p.pos}</span>
          {p.school && <Link to={schoolHref(p.school)} style={{ color: "inherit", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.school}</Link>}
        </span>
      </span>
      {stats && <span style={{ display: "flex", width: isMobile ? "100%" : "auto" }}>{stats}</span>}
      </div>
      {blurb && (
        <div style={{ padding: isMobile ? "0 12px 12px" : `0 18px 14px ${18 + H + 18}px`, fontFamily: BODY, fontSize: isMobile ? 14 : 15, lineHeight: 1.55, fontWeight: 600, color: "#3a4352" }}>
          {blurb}
        </div>
      )}
      {reason && (
        <div style={{ borderTop: "1px solid #eef1f5", padding: isMobile ? "8px 12px" : "8px 18px", background: tint(color1, "07") }}>
          <FitLine reason={reason} color1={color1} />
        </div>
      )}
    </div>
  );
}

// A fit, with whose it is — a name and the degree, no title: "84 · Very Strong fit · Kevin O'Connell".
function FitLine({ reason, color1 }) {
  return (
    <span style={{ display: "flex", alignItems: "flex-start", gap: 7, minWidth: 0, fontFamily: BODY, fontSize: 11.5, fontWeight: 700, color: "#3a4352", lineHeight: 1.35 }}>
      <span style={{ flexShrink: 0, minWidth: 28, textAlign: "center", background: tint(color1, "18"), color: color1, border: `1.5px solid ${tint(color1, "66")}`, borderRadius: 6, padding: "1px 5px", fontWeight: 900, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{Math.round(reason.score)}</span>
      <span style={{ minWidth: 0, paddingTop: 1 }}>
        <b style={{ color: "#1a1f2b" }}>{reason.tier ? `${reason.tier.label} fit` : "Fit"}</b> · {reason.who}{reason.why ? `, ${reason.why}` : ""}
      </span>
    </span>
  );
}

// One featured target: his draft card (flip it for his stats and draft
// snapshot), who he is, the write-up, his fit.
// writeUp: the team's own write-up, else his generic one (utils/prospectBlurbs.js).
// The card: on the live site the server's image (api/draft-card.js — one
// permanent URL per player and team, the one Google Images indexes; the
// version is the list's last save); local dev (no api/), or if it fails,
// drawn here.
function Featured({ p, teamKey, version, writeUp, school, fit, members, photo, back, mockPick, color1, color2, isMobile }) {
  const [serverFailed, setServerFailed] = useState(false);
  const useServer = !LOCAL && !!p.slug && !!teamKey && !serverFailed;
  const g = useDraftCard({ player: p, year: TARGETS_YEAR, skip: useServer });
  const url = (small, fmt) => draftCardImageUrl(p.slug, TARGETS_YEAR, teamKey, { small, fmt, v: version });
  const [loaded, setLoaded] = useState(false);
  const alt = `${nameOf(p)}, ${p.pos} from ${p.school}, ${TARGETS_YEAR} NFL Draft prospect`;
  const imgStyle = { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", opacity: loaded ? 1 : 0, transition: "opacity 0.3s" };
  const sizes = isMobile ? "100vw" : "280px";
  const href = playerHref(p);
  const notes = paragraphs(writeUp);
  const media = (
    <FlipCard width={isMobile ? "100%" : 280} radius={isMobile ? 0 : 12} label={`${nameOf(p)}: flip his card`} hintAt="corner"
      frontBg="radial-gradient(circle at 50% 40%, #0055a5 0%, #02060f 100%)"
      front={(
        <>
          <div ref={g.ref} aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: loaded ? 0 : 1, transition: "opacity 0.3s" }}>
            {(school?.LogoDark || school?.Logo1) && <img src={school.LogoDark || school.Logo1} alt="" style={{ width: "50%", height: "50%", objectFit: "contain" }} />}
          </div>
          {useServer ? (
            <picture>
              <source type="image/webp" srcSet={`${url(true, "webp")} 600w, ${url(false, "webp")} 1080w`} sizes={sizes} />
              <img src={url(false, "png")} srcSet={`${url(true, "png")} 600w, ${url(false, "png")} 1080w`} sizes={sizes} alt={alt} width={1080} height={1350}
                loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setServerFailed(true)} style={imgStyle} />
            </picture>
          ) : g.src && <img src={g.src} alt={alt} width={1080} height={1350} onLoad={() => setLoaded(true)} style={imgStyle} />}
        </>
      )}
      back={(
        <CardBack theme={NIGHT} number={null} photo={photo} name={nameOf(p)} pos={p.pos} school={p.school} logo={school?.LogoDark || school?.Logo1 || ""}
          profile={back?.profile} stats={back?.stats || []} statsTitle="2026 Season" scout={back?.scout} year={TARGETS_YEAR}
          footer={`We-Draft.com · ${TARGETS_YEAR} NFL Draft`} />
      )} />
  );
  const body = (
    <div style={{ flex: 1, minWidth: 0, display: "grid", alignContent: "start", gap: 10, padding: isMobile ? "12px 14px 16px" : "6px 0 0" }}>
      <h3 style={{ margin: 0, minWidth: 0, fontSize: isMobile ? 24 : 34, fontWeight: 900, lineHeight: 1.02, color: "#1a1f2b", textTransform: "uppercase" }}>
        {href ? <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>{nameOf(p)}</Link> : nameOf(p)}
      </h3>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: BODY, fontSize: isMobile ? 14 : 16, fontWeight: 800, color: "#5a6475" }}>
        <span style={{ background: color1, color: "#fff", borderRadius: 6, padding: "2px 9px", fontWeight: 900, fontSize: isMobile ? 13 : 14, letterSpacing: "0.04em" }}>{p.pos}</span>
        {school?.Logo1 && <img src={school.Logo1} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />}
        {p.school && <Link to={schoolHref(p.school)} style={{ color: "inherit", textDecoration: "none" }}>{p.school}</Link>}
        {mockPick && (
          <span style={{ fontSize: 12, fontWeight: 900, color: "#7a4a00", background: "#fff4e0", border: `1px solid ${GOLD}`, borderRadius: 999, padding: "2px 10px", letterSpacing: "0.03em" }}>
            Latest mock: Rd {mockPick.round}, Pick {mockPick.overall} · {mockPick.teamName}
          </span>
        )}
      </div>
      {notes.length > 0 && (
        <div style={{ fontFamily: BODY, fontSize: isMobile ? 15 : 16, lineHeight: 1.6, fontWeight: 600, color: "#3a4352", borderLeft: `3px solid ${color2 || GOLD}`, paddingLeft: 12 }}>
          {notes.map((t, i) => <p key={i} style={{ margin: i ? "8px 0 0" : 0 }}>{t}</p>)}
        </div>
      )}
      {fit && <FitSnapshot p={p} fit={fit} members={members} color1={color1} isMobile={isMobile} />}
    </div>
  );
  if (isMobile) return <article style={{ margin: "0 -10px", background: "#fff", borderBottom: "1px solid #e2e7ef" }}>{media}{body}</article>;
  return (
    <article style={{ ...card, display: "flex", gap: 18, padding: 14, borderLeft: `6px solid ${color1}` }}>
      {media}
      {body}
    </article>
  );
}

// His coach fit, from the staff's draft history (the legacy system's data).
function FitSnapshot({ p, fit, members, color1, isMobile }) {
  const prospect = { First: p.first, Last: p.last };
  const who = (slot) => members[slot]?.person?.Name || slot;
  return (
    <div style={{ borderRadius: 10, border: `1px solid ${tint(color1, "40")}`, background: tint(color1, "0a"), padding: isMobile ? "10px 12px" : "12px 14px", display: "grid", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: color1, letterSpacing: "0.1em", textTransform: "uppercase" }}>Staff Fit</div>
      {(fit.score != null || fit.parts.length > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {fit.score != null && <FitBadge score={fit.score} color1={color1} />}
          <div style={{ fontFamily: BODY, fontSize: 13, fontWeight: 700, color: "#3a4352", lineHeight: 1.5, minWidth: 0, flex: 1 }}>
            {fit.score != null && <div><b style={{ color: "#1a1f2b" }}>{fit.tier.label} staff fit</b> with the players this front office and coaching staff have drafted.</div>}
            {fit.parts.length > 0 && (
              <div style={{ color: "#5f6b7a" }}>
                {fit.parts.map((x) => `${who(x.slot)} ${Math.round(x.score)} (${fitTier(x.score)?.label || "Fit"})`).join(" · ")}
              </div>
            )}
          </div>
        </div>
      )}
      {fit.matches.slice(0, 2).map((m) => (
        <div key={m.k} style={{ fontFamily: BODY, fontSize: 13, lineHeight: 1.5, color: "#3a4352" }}>
          {comparisonSentence(prospect, m, { key: m.s >= 90 ? "extreme" : "very", label: m.s >= 90 ? "Extremely Strong" : "Very Strong" })}
        </div>
      ))}
    </div>
  );
}
