// src/components/events/SeniorBowlPerformances.jsx
//
// /events/senior-bowl/{year}/performances — the Senior Bowl Top Performers
// (utils/seniorBowlPerf.js), the Senior Bowl page's "Top Performers" tab
// (pages/EventPage.jsx renders it under the event's hero and tabs, and
// leaves the SEO to it). WX content, laid out like the Draft Risers
// (pages/Risers.jsx): one ranked list, one row per player — his graphic on a
// flip card (the back: his scouting card), rank, name, school, his team,
// the days he stood out, the admin's write-up. A past edition
// (/performances/2027-01-27) shows the list as published that day, noindex.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { useSchools } from "../DraftArchiveList";
import { placedShots } from "../RiserGraphic";
import { usePerfGraphic } from "../SeniorBowlPerfGraphic";
import { FlipCard, CardBack, FLIP_CSS } from "../ScoutCard";
import { communityFor } from "../../utils/communityGrades";
import { playerHref, schoolHref, eventPath } from "../../utils/events";
import {
  SBP_DOC, SBP_EDITIONS, SBP_THEME, sbpDays, perfRanked, performancesPath, perfImageUrl,
  isPerfEditionDate, perfEditionId, perfEditionPath, perfEditionLabel, perfEditionDate,
} from "../../utils/seniorBowlPerf";

const SITE = "https://we-draft.com";
const BODY = "Arial, sans-serif";
const NAVY = "#0b1a2e";
const T = SBP_THEME;
const SR_ONLY = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 };
const nameOf = (r) => `${r.first} ${r.last}`;
const graphicAlt = (r, year) => `${nameOf(r)} ${year} Senior Bowl top performer${r.pos ? `, ${r.pos}` : ""}${r.school ? ` from ${r.school}` : ""}`;

export default function SeniorBowlPerformances({ year, edition: editionParam = "", isMobile }) {
  const edition = isPerfEditionDate(editionParam) ? editionParam : "";
  const [data, setData] = useState(undefined);
  const [photos, setPhotos] = useState(undefined);
  const [profiles, setProfiles] = useState({});
  const [community, setCommunity] = useState({});
  const [editions, setEditions] = useState([]);

  useEffect(() => {
    let live = true;
    setData(undefined); setPhotos(undefined);
    // Tests: a stand-in list (as pages/Risers.jsx takes window.__RISERS_TEST__).
    const read = window.__SBP_TEST__ ? Promise.resolve({ exists: () => true, data: () => window.__SBP_TEST__ })
      : edition ? getDoc(doc(db, SBP_EDITIONS, perfEditionId(year, edition))) : getDoc(doc(db, SBP_DOC, String(year)));
    read.then(async (s) => {
      const raw = s.exists() ? s.data() : null;
      const d = raw && edition ? { ...raw, updatedAt: raw.publishedAt } : raw;
      if (!live) return;
      setData(d);
      const ids = [...new Set((d?.players || []).map((r) => r.id).filter(Boolean))];
      const docs = await Promise.all(ids.map((id) => getDoc(doc(db, "playerPhotos", id)).then((p) => [id, p.exists() ? p.data() : null]).catch(() => [id, null])));
      if (!live) return;
      setPhotos(Object.fromEntries(docs));
      Promise.all(ids.map((id) => getDoc(doc(db, "players", id)).then((p) => [id, p.exists() ? p.data() : null]).catch(() => [id, null])))
        .then((pairs) => live && setProfiles(Object.fromEntries(pairs)));
      communityFor(ids).then((c) => live && setCommunity(c || {})).catch(() => {});
    }).catch((e) => { console.error("Senior Bowl performers load error:", e); if (live) { setData(null); setPhotos({}); } });
    return () => { live = false; };
  }, [year, edition]);

  useEffect(() => {
    let live = true;
    getDocs(query(collection(db, SBP_EDITIONS), where("year", "==", String(year))))
      .then((snap) => live && setEditions(snap.docs.map((d) => d.data().date).filter(isPerfEditionDate).sort().reverse()))
      .catch(() => live && setEditions([]));
    return () => { live = false; };
  }, [year]);

  // Prerender.io: ready once the list and its photos are in.
  const settled = data !== undefined && photos !== undefined;
  useEffect(() => { if (settled) window.prerenderReady = true; }, [settled]);

  const ordered = useMemo(() => perfRanked(data?.players || []), [data]);
  const schools = useSchools(ordered.map((r) => r.school));

  // ── SEO ──
  const editionName = edition ? perfEditionLabel(edition, { month: "long", day: "numeric", year: "numeric" }) : "";
  const title = edition ? `${year} Senior Bowl Top Performers — ${editionName} Edition` : `${year} Senior Bowl Top Performers: Practice Week Standouts | NFL Draft`;
  const named = ordered.slice(0, 3).map(nameOf);
  const description = ordered.length
    ? `The ${year} Senior Bowl's top performers from practice week and the game in Mobile${named.length ? `, led by ${named.join(", ")}` : ""}: who stood out each day and why it matters for the NFL Draft.`
    : `The ${year} Senior Bowl's top performers from practice week and the game in Mobile, Alabama: who stood out each day and what it means for their NFL Draft stock.`;
  const url = `${SITE}${edition ? perfEditionPath(year, edition) : performancesPath(year)}`;
  const updated = data?.updatedAt?.toDate ? data.updatedAt.toDate() : null;
  const version = updated ? updated.getTime() : "";
  const firstGraphic = photos ? ordered.find((r) => placedShots(photos[r.id]).length) : null;
  const img = firstGraphic ? perfImageUrl(firstGraphic.slug, year, false, version, "png", edition) : "";
  const listId = `${url}#performers`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage", "@id": `${url}#webpage`, url, name: title, description, inLanguage: "en-US",
        breadcrumb: { "@id": `${url}#breadcrumb` },
        ...(ordered.length ? { mainEntity: { "@id": listId } } : {}),
        ...(updated ? { dateModified: updated.toISOString() } : {}),
        ...(img ? { primaryImageOfPage: { "@type": "ImageObject", url: img, width: 1080, height: 1350 } } : {}),
      },
      {
        "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Events", item: `${SITE}/events` },
          { "@type": "ListItem", position: 2, name: `${year} Senior Bowl`, item: `${SITE}${eventPath("senior-bowl", year)}` },
          { "@type": "ListItem", position: 3, name: "Top Performers", item: `${SITE}${performancesPath(year)}` },
          ...(edition ? [{ "@type": "ListItem", position: 4, name: `${editionName} Edition`, item: url }] : []),
        ],
      },
      ...(ordered.length ? [{
        "@type": "ItemList", "@id": listId, name: `${year} Senior Bowl Top Performers`, url,
        itemListOrder: "https://schema.org/ItemListOrderDescending", numberOfItems: ordered.length,
        itemListElement: ordered.map((r, i) => ({
          "@type": "ListItem", position: i + 1, name: nameOf(r),
          ...(playerHref(r) ? { url: `${SITE}${playerHref(r)}` } : {}),
          ...(photos && placedShots(photos[r.id]).length ? { image: perfImageUrl(r.slug, year, false, version, "png", edition) } : {}),
        })),
      }] : []),
    ],
  };

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        {edition && <meta name="robots" content="noindex, follow" />}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta property="og:image" content={img || `${SITE}/logos/senior-bowl.png`} />
        {img && <meta property="og:image:width" content="1080" />}
        {img && <meta property="og:image:height" content="1350" />}
        {img && <meta property="og:image:alt" content={graphicAlt(firstGraphic, year)} />}
        <meta name="twitter:card" content={img ? "summary_large_image" : "summary"} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {img && <meta name="twitter:image" content={img} />}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <style>{FLIP_CSS}</style>

      {edition && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", marginBottom: 14, borderRadius: 12, background: "#fff8e6", border: `1px solid ${T.gold}`, fontFamily: BODY, fontSize: 14, fontWeight: 700, color: "#3a4352" }}>
          <span>You're reading the <strong>{editionName}</strong> edition.</span>
          <Link to={performancesPath(year)} style={{ marginLeft: "auto", color: T.ink, fontWeight: 900, textDecoration: "none", whiteSpace: "nowrap" }}>See the latest →</Link>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: isMobile ? "0 2px 6px" : "0 0 6px" }}>
        <h2 style={{ margin: 0, fontSize: isMobile ? 22 : 30, fontWeight: 900, color: NAVY, textTransform: "uppercase", lineHeight: 1.05 }}>{year} Senior Bowl Top Performers</h2>
        {(edition || updated) && (
          <span style={{ fontFamily: BODY, fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7a8597" }}>
            {perfEditionLabel(edition || perfEditionDate(updated))} edition
          </span>
        )}
      </div>
      <p style={{ margin: isMobile ? "0 2px 16px" : "0 0 20px", fontFamily: BODY, fontSize: isMobile ? 15 : 16, lineHeight: 1.6, fontWeight: 600, color: "#3a4352" }}>
        The players who did the most for their draft stock in Mobile — ranked by We-Draft.com and updated through practice week and the game, with the days each one stood out.
      </p>

      {data === undefined ? (
        <div style={{ padding: 40, textAlign: "center", color: "#8a94a6", fontWeight: 800 }}>Loading…</div>
      ) : !ordered.length ? (
        <div style={{ border: `2px dashed ${T.red}44`, background: "#f8fafc", borderRadius: 14, padding: "24px 18px", color: "#5a6475", fontSize: 15, fontWeight: 700, fontFamily: BODY, textAlign: "center" }}>
          Top performers post here during Senior Bowl week — starting with the first day of practice.
        </div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {ordered.map((r, i) => (
            <li key={r.slug || r.id} id={r.slug} style={{ scrollMarginTop: 90 }}>
              <PerfRow r={r} rank={i + 1} year={year} edition={edition} version={version} photos={photos?.[r.id]} profile={profiles[r.id]} scout={community[r.id]} school={schools[r.school]} isMobile={isMobile} />
            </li>
          ))}
        </ol>
      )}

      {editions.length > 1 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ margin: 0, fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", color: "#5a6475", textTransform: "uppercase" }}>{year} Top Performers Editions</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {editions.map((d, i) => {
              const here = edition ? d === edition : i === 0;
              return (
                <Link key={d} to={i === 0 ? performancesPath(year) : perfEditionPath(year, d)} aria-current={here ? "page" : undefined} style={{
                  padding: "6px 11px", borderRadius: 8, fontFamily: BODY, fontSize: 12, fontWeight: 800, textDecoration: "none",
                  background: here ? T.red : "#fff", color: here ? "#fff" : T.ink, border: "1px solid #ecd0ce",
                }}>{perfEditionLabel(d)}{i === 0 ? " · Latest" : ""}</Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function TeamChip({ team, big }) {
  if (!team) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: big ? "5px 12px" : "3px 9px", borderRadius: 999, background: T[team] || T.red, color: "#fff", fontSize: big ? 12 : 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      {team} Team
    </span>
  );
}
function Days({ r, big }) {
  const days = sbpDays(r);
  if (!days.length) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7a8597", fontFamily: BODY }}>Stood out</span>
      {days.map((d) => (
        <span key={d.key} title={d.long} style={{ padding: big ? "4px 10px" : "3px 8px", borderRadius: 6, background: d.key === "game" ? T.gold : T.tint, color: d.key === "game" ? "#1c1c1c" : T.ink, fontSize: big ? 12 : 11, fontWeight: 900, textTransform: "uppercase" }}>{d.label}</span>
      ))}
    </span>
  );
}
function Note({ note, size = 15 }) {
  if (!note) return null;
  return (
    <div style={{ fontSize: size, lineHeight: 1.6, fontWeight: 600, fontFamily: BODY, color: "#3a4352", borderLeft: `3px solid ${T.red}`, paddingLeft: 12 }}>
      {String(note).split(/\n{2,}/).map((p, i) => <p key={i} style={{ margin: i ? "8px 0 0" : 0 }}>{p}</p>)}
    </div>
  );
}
function SchoolLine({ r, school, size = 14 }) {
  const logo = school?.Logo1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: size, fontWeight: 800, fontFamily: BODY, color: "#5a6475", minWidth: 0 }}>
      <span style={{ fontWeight: 900 }}>{r.pos}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      {logo && <img src={logo} alt="" style={{ width: size + 7, height: size + 7, objectFit: "contain" }} />}
      {r.school ? <Link to={schoolHref(r.school)} style={{ color: "inherit", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.school}</Link> : null}
    </div>
  );
}
function NameLink({ r }) {
  const href = playerHref(r);
  return href ? <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>{nameOf(r)}</Link> : <span>{nameOf(r)}</span>;
}

// His card: the graphic in front (a placeholder in Senior Bowl colors until
// it loads), his scouting card on the back.
function Media({ r, rank, year, school, profile, scout, isMobile, g }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [g.src]);
  const logo = school?.LogoDark || school?.Logo1;
  return (
    <FlipCard width={isMobile ? "100%" : 300} radius={isMobile ? 0 : 12} label={`${nameOf(r)}: flip his card`}
      frontBg={`radial-gradient(circle at 50% 40%, ${T.red} 0%, #3b0907 55%, ${T.deep} 100%)`}
      front={(
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: loaded ? 0 : 1, transition: "opacity 0.3s" }}>
            <img src={logo || "/logos/senior-bowl.png"} alt="" style={{ width: "60%", height: "60%", objectFit: "contain" }} />
          </div>
          {g.src && (
            <picture>
              {g.webpSrcSet && <source type="image/webp" srcSet={g.webpSrcSet} sizes={isMobile ? "100vw" : "300px"} />}
              <img src={g.src} srcSet={g.srcSet || undefined} sizes={isMobile ? "100vw" : "300px"} width={1080} height={1350} onError={g.onError} onLoad={() => setLoaded(true)} decoding="async"
                loading={rank <= 2 ? "eager" : "lazy"} fetchpriority={rank === 1 ? "high" : undefined} alt={graphicAlt(r, year)}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", objectFit: "cover", opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }} />
            </picture>
          )}
        </>
      )}
      back={(
        <CardBack theme={{ c1: T.red, c2: T.gold, deep: T.deep, mid: "#3b0907", accent: T.gold }} number={rank} name={nameOf(r)} pos={r.pos} school={r.school} logo={logo}
          profile={profile} scout={scout} year={year} chip={<>{r.team ? `${r.team} Team` : "Senior Bowl"}</>} footer={`We-Draft.com · ${year} Senior Bowl`} />
      )} />
  );
}

function PerfRow({ r, rank, year, edition, version, photos, profile, scout, school, isMobile }) {
  const g = usePerfGraphic({ perf: r, year, photos, version, edition });
  const href = playerHref(r);
  const badge = (size) => (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: 12, display: "grid", placeItems: "center", color: "#fff", background: `linear-gradient(135deg, ${T.red}, #7a1410)`, fontSize: rank > 9 ? size * 0.42 : size * 0.5, fontWeight: 900, boxShadow: `0 4px 12px ${T.red}55` }}>{rank}</span>
  );
  const tail = <span style={SR_ONLY}>{[r.pos, r.school].filter(Boolean).length ? ` – ${[r.pos, r.school].filter(Boolean).join(", ")}` : ""}</span>;
  if (isMobile) {
    return (
      <article style={{ margin: "0 -10px", background: "#fff", borderBottom: "1px solid #e2e7ef" }}>
        <Media r={r} rank={rank} year={year} school={school} profile={profile} scout={scout} isMobile g={g} />
        <div style={{ padding: "12px 14px 16px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {badge(48)}
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 23, fontWeight: 900, lineHeight: 1.02, color: "#1c2330", textTransform: "uppercase" }}><NameLink r={r} />{tail}</h3>
              <div style={{ marginTop: 4 }}><SchoolLine r={r} school={school} /></div>
            </div>
            {href && <Link to={href} aria-label={`${nameOf(r)}'s profile`} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", border: `2px solid ${T.red}`, color: T.ink, display: "grid", placeItems: "center", textDecoration: "none", fontSize: 18, fontWeight: 900 }}>→</Link>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><TeamChip team={r.team} big /><Days r={r} big /></div>
          <Note note={r.note} size={16} />
        </div>
      </article>
    );
  }
  return (
    <article style={{ position: "relative", background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #e2e7ef", boxShadow: "0 4px 16px rgba(0,30,70,0.06)", padding: 14 }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: `linear-gradient(180deg, ${T.red}, ${T.gold})` }} />
      <div style={{ display: "flex", alignItems: "stretch", gap: 18 }}>
        <Media r={r} rank={rank} year={year} school={school} profile={profile} scout={scout} g={g} />
        <div style={{ flex: 1, minWidth: 0, paddingTop: 6, display: "grid", alignContent: "start", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, paddingRight: href ? 130 : 0 }}>
            {badge(56)}
            <h3 style={{ margin: 0, minWidth: 0, fontSize: 44, fontWeight: 900, lineHeight: 1, color: "#1c2330", textTransform: "uppercase" }}><NameLink r={r} />{tail}</h3>
          </div>
          <SchoolLine r={r} school={school} size={18} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><TeamChip team={r.team} big /><Days r={r} big /></div>
          <Note note={r.note} size={16} />
        </div>
      </div>
      {href && (
        <Link to={href} style={{ position: "absolute", top: 24, right: 20, padding: "9px 14px", borderRadius: 999, border: `2px solid ${T.red}`, color: T.ink, textDecoration: "none", fontSize: 12, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Profile →</Link>
      )}
    </article>
  );
}
