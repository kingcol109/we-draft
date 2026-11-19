// src/pages/Risers.jsx
//
// /risers/{year} — the class's Draft Risers (utils/risers.js): one ranked
// board in the admin's order (Admin → Content → Rising Page), each player
// labeled On Fire, Trending Up or Breakout, one row per player, with the
// admin's note on him when there is one. One read for the class (risers/{year}), one per riser for
// his photos (playerPhotos: his headshot, and whether he has an action shot
// placed for the graphic). A riser with a placed shot gets the big card with
// his graphic (RiserGraphic.jsx / api/riser-graphic.js); the rest get the
// compact card with his headshot. /risers goes to the current class.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import MarginAds from "../components/MarginAds";
import { TopProspectsRail } from "../components/DraftSideRails";
import { SimRailCard, WeeklyMockRailCard } from "../components/DraftPromoRail";
import { viewportCssWidth } from "../utils/pageZoom";
import { useSchools } from "../components/DraftArchiveList";
import { useRiserGraphic, placedShots } from "../components/RiserGraphic";
import { riserIconSvg } from "../utils/instagram/riser";
import {
  RISER_YEARS, RISER_TYPES, RISER_INTROS, RISER_EDITIONS, risersRanked, riserImageUrl, risersPath,
  isEditionDate, editionId, editionPath, editionLabel, editionDate,
} from "../utils/risers";
import { playerHref, schoolHref } from "../utils/events";
import { recentSummary } from "../utils/riserRecent";
import { bestRecentLine } from "../utils/profileHub";
import { communityFor } from "../utils/communityGrades";
import { FlipCard, CardBack, FLIP_CSS } from "../components/ScoutCard";

const SITE = "https://we-draft.com";
const GOLD = "#f6a21d";
const NAVY = "#070d18";
const BODY = "Arial, sans-serif";
const HEAD = "'Arial Black', Arial, sans-serif";
const COLUMN = 1000;
// The list's title (its H2, "Biggest 2027 NFL Draft Risers") shows above the
// list; false hides it visually (crawlers and screen readers still get it).
const SHOW_LIST_TITLE = true;
// Text for crawlers and screen readers that the design shows another way.
const SR_ONLY = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 };
// A position, spelled out — the graphics' alt text ("…, quarterback at Oregon").
const POSITION_NAMES = {
  QB: "quarterback", RB: "running back", FB: "fullback", WR: "wide receiver", TE: "tight end", OL: "offensive lineman", OT: "offensive tackle",
  OG: "offensive guard", IOL: "interior offensive lineman", C: "center", EDGE: "edge rusher", DL: "defensive lineman", DT: "defensive tackle",
  LB: "linebacker", DB: "defensive back", CB: "cornerback", S: "safety", K: "kicker", P: "punter", LS: "long snapper",
};
const graphicAlt = (r, year) => `${r.first} ${r.last} ${year} NFL Draft riser${r.pos ? `, ${POSITION_NAMES[r.pos] || r.pos}` : ""}${r.school ? ` at ${r.school}` : ""}`;
// Side rails beside the column (the class's Big Board left, the Draft Sim
// right) when the screen fits them — the margin ads take the outer edges,
// as on the draft calendar and the other draft pages.
const RAIL_WIDTH = 220;
const SIDE = RAIL_WIDTH + 16;
const railsFit = () => viewportCssWidth() >= COLUMN + 2 * SIDE + 32;
function useRails(isMobile) {
  const [fit, setFit] = useState(() => typeof window !== "undefined" && railsFit());
  useEffect(() => {
    const f = () => setFit(railsFit());
    window.addEventListener("resize", f);
    window.addEventListener("pagezoomchange", f);
    return () => { window.removeEventListener("resize", f); window.removeEventListener("pagezoomchange", f); };
  }, []);
  return fit && !isMobile;
}

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => { const f = () => setM(window.innerWidth < 768); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return m;
}

// The type's icon (the graphic's own), inline.
function RiserIcon({ type, size = 28, fill = "#fff", accent }) {
  const t = RISER_TYPES[type];
  return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flexShrink: 0, display: "block" }} dangerouslySetInnerHTML={{ __html: riserIconSvg(type, 0, 0, 100, fill, accent || t.deep) }} />;
}

export default function Risers() {
  const { year = "", edition: editionParam = "" } = useParams();
  // A past edition (/risers/2027/2026-11-17), or "" for the latest.
  const edition = isEditionDate(editionParam) ? editionParam : "";
  const isMobile = useIsMobile();
  const contentRef = useRef(null);
  const rails = useRails(isMobile);
  const valid = RISER_YEARS.includes(year) && (!editionParam || !!edition);
  const [data, setData] = useState(undefined); // undefined loading, null none
  const [photos, setPhotos] = useState(undefined); // { [playerId]: playerPhotos doc }
  const [games, setGames] = useState({}); // { [playerId]: his recent line (riserRecent.js recentSummary) | null }
  const [editions, setEditions] = useState([]); // the class's published editions' dates, newest first
  const [profiles, setProfiles] = useState({}); // { [playerId]: players doc } — the back of his card
  const [community, setCommunity] = useState({}); // { [playerId]: { avg, strengths, weaknesses } } — the back of his card

  useEffect(() => {
    if (!valid) return undefined;
    let live = true;
    setData(undefined);
    setPhotos(undefined);
    const read = window.__RISERS_TEST__ ? Promise.resolve({ exists: () => true, data: () => window.__RISERS_TEST__ })
      : edition ? getDoc(doc(db, RISER_EDITIONS, editionId(year, edition))) : getDoc(doc(db, "risers", year));
    read
      .then(async (s) => {
        const raw = s.exists() ? s.data() : null;
        // An edition reads like the list: its players, "updated" when it was published.
        const d = raw && edition ? { ...raw, updatedAt: raw.publishedAt } : raw;
        if (!live) return;
        setData(d);
        const ids = [...new Set((d?.players || []).map((r) => r.id).filter(Boolean))];
        const docs = await Promise.all(ids.map((id) => getDoc(doc(db, "playerPhotos", id)).then((p) => [id, p.exists() ? p.data() : null]).catch(() => [id, null])));
        if (!live) return;
        setPhotos(Object.fromEntries(docs));
        // His profile (height, weight, high school, recruiting, bio) for the
        // back of his card.
        Promise.all(ids.map((id) => getDoc(doc(db, "players", id)).then((p) => [id, p.exists() ? p.data() : null]).catch(() => [id, null])))
          .then((pairs) => live && setProfiles(Object.fromEntries(pairs)));
        // His community grade and top strengths / weaknesses (one snapshot read).
        communityFor(ids).then((c) => live && setCommunity(c || {})).catch(() => {});
        // Each one's recent line — his last game or his last 3. An edition
        // has it as it read that day; the latest asks ESPN (his headshot's id).
        if (edition) {
          setGames(Object.fromEntries((d?.players || []).map((r) => [r.id, r.recent || null])));
          return;
        }
        setGames({});
        const posOf = Object.fromEntries((d?.players || []).map((r) => [r.id, r.pos]));
        docs.forEach(([id, ph]) => {
          const espnId = ph?.headshot?.espnId;
          if (!espnId) return;
          bestRecentLine(espnId).then((b) => live && setGames((m) => ({ ...m, [id]: recentSummary(posOf[id], b) }))).catch(() => {});
        });
      })
      .catch((e) => { console.error("Risers load error:", e); if (live) { setData(null); setPhotos({}); } });
    return () => { live = false; };
  }, [year, edition, valid]);

  // The class's editions (the archive at the bottom).
  useEffect(() => {
    if (!RISER_YEARS.includes(year) || window.__RISERS_TEST__) return undefined;
    let live = true;
    getDocs(query(collection(db, RISER_EDITIONS), where("year", "==", year)))
      .then((snap) => live && setEditions(snap.docs.map((d) => d.data().date).filter(isEditionDate).sort().reverse()))
      .catch(() => live && setEditions([]));
    return () => { live = false; };
  }, [year]);


  // Prerender.io: ready once the risers and their photos are in (8s cap).
  const settled = data !== undefined && photos !== undefined;
  useEffect(() => {
    window.prerenderReady = false;
    const t = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(t);
  }, [year]);
  useEffect(() => {
    if (!settled) return undefined;
    const frame = requestAnimationFrame(() => { window.prerenderReady = true; });
    return () => cancelAnimationFrame(frame);
  }, [settled]);

  const players = useMemo(() => data?.players || [], [data]);
  const ordered = useMemo(() => risersRanked(players), [players]);
  const schools = useSchools(players.map((r) => r.school));

  if (!valid) return <Navigate to={RISER_YEARS.includes(year) ? risersPath(year) : risersPath(RISER_YEARS[0])} replace />;

  // ── SEO ──
  const editionName = edition ? editionLabel(edition, { month: "long", day: "numeric", year: "numeric" }) : "";
  const title = edition ? `${year} NFL Draft Risers — ${editionName} Edition` : `${year} NFL Draft Risers | Prospects on the Rise`;
  const named = ordered.slice(0, 3).map((r) => `${r.first} ${r.last}`);
  const description = players.length
    ? `The ${year} NFL Draft prospects on the rise — who's on fire, trending up and breaking out${named.length ? `, from ${named.join(", ")} on down` : ""}. Stats, graphics and why their stock is climbing.`
    : `The ${year} NFL Draft prospects on the rise: the players on fire, trending up and breaking out this season, with stats and why their draft stock is climbing.`;
  const url = `${SITE}${edition ? editionPath(year, edition) : risersPath(year)}`;
  const latestUrl = `${SITE}${risersPath(year)}`;
  const updated = data?.updatedAt?.toDate ? data.updatedAt.toDate() : null;
  const version = updated ? updated.getTime() : "";
  const firstGraphic = photos ? ordered.find((r) => placedShots(photos[r.id]).length) : null;
  // Structured data, one graph: the site, this page (a CollectionPage), its
  // breadcrumb, and the ranked list itself — the published players in the
  // order the page shows them, each to his We-Draft profile.
  const pageId = `${url}#webpage`;
  const listId = `${url}#risers`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: "We-Draft.com" },
      {
        "@type": "CollectionPage", "@id": pageId, url, name: edition ? `${year} NFL Draft Risers — ${editionName} Edition` : `${year} NFL Draft Risers`, description, inLanguage: "en-US",
        isPartOf: { "@id": `${SITE}/#website` }, breadcrumb: { "@id": `${url}#breadcrumb` },
        ...(ordered.length ? { mainEntity: { "@id": listId } } : {}),
        ...(updated ? { dateModified: updated.toISOString() } : {}),
        ...(firstGraphic ? { primaryImageOfPage: { "@type": "ImageObject", url: riserImageUrl(firstGraphic.slug, year, false, version, "png", edition), width: 1080, height: 1350 } } : {}),
      },
      {
        "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: `${year} NFL Draft Risers`, item: latestUrl },
          ...(edition ? [{ "@type": "ListItem", position: 3, name: `${editionName} Edition`, item: url }] : []),
        ],
      },
      ...(ordered.length ? [{
        "@type": "ItemList", "@id": listId, name: edition ? `${year} NFL Draft Risers — ${editionName}` : `${year} NFL Draft Risers`, url,
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        numberOfItems: ordered.length,
        itemListElement: ordered.map((r, i) => ({
          "@type": "ListItem", position: i + 1, name: `${r.first} ${r.last}`,
          ...(playerHref(r) ? { url: `${SITE}${playerHref(r)}` } : {}),
          ...(photos && placedShots(photos[r.id]).length ? { image: riserImageUrl(r.slug, year, false, version, "png", edition) } : {}),
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
        {/* A past edition stays out of search (as past Weekly Mock weeks do); the latest is the page that ranks. */}
        {edition && <meta name="robots" content="noindex, follow" />}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        {firstGraphic && <meta property="og:image" content={riserImageUrl(firstGraphic.slug, year, false, version, "png", edition)} />}
        {firstGraphic && <meta property="og:image:width" content="1080" />}
        {firstGraphic && <meta property="og:image:height" content="1350" />}
        {firstGraphic && <meta property="og:image:type" content="image/png" />}
        {firstGraphic && <meta property="og:image:alt" content={graphicAlt(firstGraphic, year)} />}
        {firstGraphic && <meta name="twitter:image" content={riserImageUrl(firstGraphic.slug, year, false, version, "png", edition)} />}
        {firstGraphic && <meta name="twitter:image:alt" content={graphicAlt(firstGraphic, year)} />}
        <meta name="twitter:card" content={firstGraphic ? "summary_large_image" : "summary"} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {firstGraphic && !edition && <meta name="robots" content="max-image-preview:large" />}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={rails ? 0 : 24} watch={[rails]} />

      {/* (marginTop: pulls the page up under the navbar — the site's layout adds 25px above every page.) */}
      <div ref={contentRef} style={{ position: "relative", maxWidth: rails ? COLUMN + 2 * SIDE : COLUMN, margin: `${isMobile ? -14 : -12}px auto 0`, padding: rails ? `0 ${SIDE}px` : 0, boxSizing: "border-box" }}>
        {rails && (
          <>
            <div style={{ position: "absolute", top: 10, bottom: 60, left: 0, width: RAIL_WIDTH }}>
              <div style={{ position: "sticky", top: 16 }}><TopProspectsRail year={year} /></div>
            </div>
            <div style={{ position: "absolute", top: 10, bottom: 60, right: 0, width: RAIL_WIDTH }}>
              <div style={{ position: "sticky", top: 16, display: "grid", gap: 16 }}><SimRailCard year={year} /><WeeklyMockRailCard year={year} /></div>
            </div>
          </>
        )}
      <div style={{ maxWidth: COLUMN, margin: "0 auto", padding: isMobile ? "4px 10px 60px" : "10px 24px 60px", fontFamily: HEAD }}>
        <Hero year={year} isMobile={isMobile} updated={updated} />
        {edition && (
          <div style={{
            marginTop: isMobile ? 14 : 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderRadius: 12,
            background: "#fff8e6", border: `1px solid ${GOLD}`, fontFamily: BODY, fontSize: 14, fontWeight: 700, color: "#3a4352",
          }}>
            <span>You're reading the <strong>{editionName}</strong> edition of the {year} risers list.</span>
            <Link to={risersPath(year)} style={{ marginLeft: "auto", color: "#0055a5", fontWeight: 900, textDecoration: "none", whiteSpace: "nowrap" }}>See the latest →</Link>
          </div>
        )}
        {RISER_INTROS[year] && (
          <p style={{
            margin: isMobile ? "16px 4px 0" : "22px 0 0", padding: isMobile ? "0 0 0 14px" : "2px 0 2px 20px",
            borderLeft: `4px solid ${GOLD}`, fontFamily: BODY, fontSize: isMobile ? 16 : 19, lineHeight: 1.65, fontWeight: 600, color: "#2a3140",
          }}>
            {RISER_INTROS[year]}
          </p>
        )}

        {data === undefined ? (
          <div style={{ padding: 40, textAlign: "center", color: "#8a94a6", fontWeight: 800 }}>Loading…</div>
        ) : !players.length ? (
          <div style={{ marginTop: 18, border: "2px dashed #d5dbe4", background: "#f8fafc", borderRadius: 16, padding: "28px 20px", textAlign: "center", color: "#5a6475", fontFamily: BODY, fontWeight: 700, fontSize: 15 }}>
            The {year} risers board is on its way — check back soon.
          </div>
        ) : (
          <Board list={ordered} year={year} edition={edition} updated={updated} version={version} photos={photos} games={games} profiles={profiles} community={community} schools={schools} isMobile={isMobile} />
        )}

        <About year={year} isMobile={isMobile} editions={editions} edition={edition} />
      </div>
      </div>
    </>
  );
}

// ── The hero: the class ──
function Hero({ year, isMobile, updated }) {
  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 20, color: "#fff", padding: isMobile ? "22px 16px 24px" : "30px 40px 32px",
      background: `radial-gradient(circle at 8% 110%, ${RISER_TYPES.onFire.c1}bb 0, transparent 42%), radial-gradient(circle at 95% -10%, ${RISER_TYPES.breakout.c1}bb 0, transparent 45%), radial-gradient(circle at 60% 130%, ${RISER_TYPES.up.c1}88 0, transparent 40%), ${NAVY}`,
      boxShadow: "0 16px 40px rgba(7,13,24,0.35)",
    }}>
      {/* A rising line across the back. */}
      <svg aria-hidden="true" viewBox="0 0 1000 300" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.2 }}>
        <path d="M0 270 L140 230 L260 245 L400 170 L520 190 L660 110 L780 125 L1000 20" fill="none" stroke="#fff" strokeWidth="5" strokeLinejoin="round" />
      </svg>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <nav aria-label="Draft class" style={{ display: "flex", gap: 6 }}>
          {RISER_YEARS.map((y) => (
            <Link key={y} to={risersPath(y)} aria-current={y === year ? "page" : undefined} style={{
              padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 900, textDecoration: "none",
              background: y === year ? GOLD : "rgba(255,255,255,0.12)", color: "#fff", border: `1px solid ${y === year ? GOLD : "rgba(255,255,255,0.25)"}`,
            }}>{y}</Link>
          ))}
        </nav>
        <h1 style={{ margin: isMobile ? "16px 0 0" : "22px 0 0", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 0.9 }}>
          <span style={{ display: "block", fontSize: isMobile ? 30 : 52, color: "rgba(255,255,255,0.92)", letterSpacing: "0.02em" }}>{year} NFL Draft</span>{" "}
          <span style={{ display: "block", fontSize: isMobile ? 76 : 150, background: `linear-gradient(100deg, #ffffff 25%, ${GOLD} 95%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", paddingBottom: 6 }}>Risers</span>
        </h1>
        <div style={{ marginTop: isMobile ? 6 : 10, fontSize: isMobile ? 14 : 20, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.8)" }}>Prospects on the rise</div>
        {updated && (
          <div style={{
            marginTop: isMobile ? 14 : 18, display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 10px", borderRadius: 999,
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.22)", backdropFilter: "blur(4px)",
          }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 0 3px rgba(74,222,128,0.25), 0 0 10px #4ade80" }} />
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap" }}>Updated</span>
            <time dateTime={updated.toISOString()} style={{ whiteSpace: "nowrap", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: "#fff" }}>
              {updated.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </time>
          </div>
        )}
      </div>
    </div>
  );
}

// ── The board: every riser ranked together, one row each, each wearing
// his label ──
function Board({ list, year, edition, updated, version, photos, games, profiles, community, schools, isMobile }) {
  const shown = list.map((r, i) => ({ r, rank: i + 1 }));
  return (
    <section id="board" aria-labelledby="board-title" style={{ marginTop: isMobile ? 16 : 24, scrollMarginTop: 80 }}>
      {SHOW_LIST_TITLE ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: isMobile ? "0 4px 12px" : "0 0 14px" }}>
          <h2 id="board-title" style={{ margin: 0, fontSize: isMobile ? 22 : 30, fontWeight: 900, color: NAVY, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.05 }}>
            Biggest {year} NFL Draft Risers
          </h2>
          {(edition || updated) && (
            <span style={{ fontFamily: BODY, fontSize: isMobile ? 12 : 13, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7a8597" }}>
              {editionLabel(edition || editionDate(updated))} edition
            </span>
          )}
        </div>
      ) : (
        <h2 id="board-title" style={SR_ONLY}>Biggest {year} NFL Draft Risers</h2>
      )}
      <style>{FLIP_CSS}</style>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
        {shown.map(({ r, rank }) => (
          <li key={r.slug} id={r.slug} style={{ scrollMarginTop: 90 }}><RiserRow riser={r} rank={rank} year={year} edition={edition} version={version} photos={photos?.[r.id]} game={games?.[r.id]} profile={profiles?.[r.id]} scout={community?.[r.id]} school={schools[r.school]} isMobile={isMobile} /></li>
        ))}
      </ol>
    </section>
  );
}

const nameOf = (r) => `${r.first} ${r.last}`;
// His heading's tail: " – QB, Oregon".
const headingTail = (r) => [r.pos, r.school].filter(Boolean).length ? ` – ${[r.pos, r.school].filter(Boolean).join(", ")}` : "";
function NameLink({ r, style }) {
  const href = playerHref(r);
  return href ? <Link to={href} style={{ color: "inherit", textDecoration: "none", ...style }}>{nameOf(r)}</Link> : <span style={style}>{nameOf(r)}</span>;
}
function SchoolLine({ r, school, color, size = 13 }) {
  const logo = school?.Logo1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: size, fontWeight: 800, fontFamily: BODY, color, minWidth: 0 }}>
      <span style={{ fontWeight: 900 }}>{r.pos}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      {logo && <img src={logo} alt="" style={{ width: size + 7, height: size + 7, objectFit: "contain" }} />}
      {r.school ? <Link to={schoolHref(r.school)} style={{ color: "inherit", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.school}</Link> : null}
    </div>
  );
}
function Stats({ stats, t, small }) {
  const list = (stats || []).filter((s) => s?.value !== "" && s?.value != null);
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", gap: small ? 6 : 8, flexWrap: "wrap" }}>
      {list.map((s) => (
        <div key={s.key} style={{ borderRadius: 10, padding: small ? "6px 10px" : "8px 14px", minWidth: small ? 64 : 84, textAlign: "center", background: t.tint }}>
          <div style={{ fontSize: small ? 17 : 22, fontWeight: 900, lineHeight: 1, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4, color: "#5a6475", fontFamily: BODY }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}
// The admin's write-up, when there is one.
function Note({ note, t, size = 14 }) {
  if (!note) return null;
  return (
    <div style={{ fontSize: size, lineHeight: 1.6, fontWeight: 600, fontFamily: BODY, color: "#3a4352", borderLeft: `3px solid ${t.c1}`, paddingLeft: 12 }}>
      {String(note).split(/\n{2,}/).map((p, i) => <p key={i} style={{ margin: i ? "8px 0 0" : 0 }}>{p}</p>)}
    </div>
  );
}
function TypeBadge({ type, big }) {
  const t = RISER_TYPES[type];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: big ? 7 : 5, padding: big ? "6px 14px 6px 10px" : "4px 10px 4px 7px", borderRadius: 999, fontSize: big ? 14 : 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
      background: `linear-gradient(135deg, ${t.c1}, ${t.c2})`, color: "#fff",
    }}>
      <RiserIcon type={type} size={big ? 18 : 14} fill="#fff" accent={t.deep} />{t.label}
    </span>
  );
}

// His card (components/ScoutCard.jsx): the front is his graphic, in a box
// the graphic's size from the start — until it loads (or if it can't) a
// placeholder in his label's colors with his school's dark logo, so nothing
// on the page moves. Hover (tap on a phone) flips it to his scouting report,
// in his label's colors.
function Media({ r, rank, year, school, profile, scout, isMobile, g }) {
  const t = RISER_TYPES[r.type] || RISER_TYPES.up;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [g.src]);
  const logo = school?.LogoDark || school?.Logo1;
  const season = (r.stats || []).find((s) => s?.season)?.season;
  return (
    <FlipCard width={isMobile ? "100%" : 320} radius={isMobile ? 0 : 12} label={`${nameOf(r)}: flip his card`}
      frontBg={`radial-gradient(circle at 50% 40%, ${t.c1} 0%, ${t.top[1]} 55%, ${t.deep} 100%)`}
      front={(
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: loaded ? 0 : 1, transition: "opacity 0.3s" }}>
            {logo ? <img src={logo} alt="" style={{ width: "62%", height: "62%", objectFit: "contain" }} />
              : school === null ? <RiserIcon type={r.type} size={90} fill="rgba(255,255,255,0.85)" accent={t.deep} /> : null}
          </div>
          {g.src && (
            <picture>
              {g.webpSrcSet && <source type="image/webp" srcSet={g.webpSrcSet} sizes={isMobile ? "100vw" : "320px"} />}
              {/* The first rows are above the fold: load them now (the first as the page's main image); the rest as they near. */}
              <img src={g.src} srcSet={g.srcSet || undefined} sizes={isMobile ? "100vw" : "320px"} width={1080} height={1350} onError={g.onError} onLoad={() => setLoaded(true)} decoding="async"
                loading={rank <= 2 ? "eager" : "lazy"} fetchpriority={rank === 1 ? "high" : undefined}
                alt={graphicAlt(r, year)}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", objectFit: "cover", opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }} />
            </picture>
          )}
        </>
      )}
      back={(
        <CardBack theme={{ c1: t.c1, c2: t.c2, deep: t.deep, mid: t.top[1], accent: t.c2 }} number={rank} name={nameOf(r)} pos={r.pos} school={r.school} logo={logo}
          profile={profile} stats={r.stats} statsTitle={season ? `${season} Season` : "Season"} scout={scout} year={year}
          chip={<><RiserIcon type={r.type} size={11} fill="#fff" accent={t.deep} />{t.label}</>} footer={`We-Draft.com · ${year} Risers`} />
      )} />
  );
}

// His recent line (utils/riserRecent.js recentSummary): his last game —
// "Last game · @ PSU · W 31-17 · Nov 15" — or, when his last 3 add up to
// more, "Last 3 games · Oct 25 – Nov 15"; then the stats ("22/30 pass,
// 289 pass yds, 3 TD"). Live from ESPN on the latest; as published on an
// edition. Nothing until it loads, or when there's no game for him.
function LastGame({ g, t, isMobile, big, tight }) {
  if (!g?.kind) return null;
  const three = g.kind === "last3";
  const line = g.line || "";
  const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const date = three ? [day(g.first), day(g.last)].filter(Boolean).join(" – ") : day(g.date);
  const result = three ? "" : [g.result, g.score].filter(Boolean).join(" ");
  const size = big && !isMobile ? 16 : 14;
  return (
    <div style={{ marginTop: tight ? 0 : big ? 14 : 10, borderRadius: 12, background: t.tint, padding: big && !isMobile ? "10px 14px" : "9px 12px", fontFamily: BODY, maxWidth: tight || (big && !isMobile) ? "none" : 560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: t.ink }}>
        <span>{three ? `Last ${g.games} games` : "Last game"}</span>
        <span style={{ color: "#5a6475", display: "inline-flex", alignItems: "center", gap: 5 }}>
          {!three && <>· {g.at} {g.oppLogo && <img src={g.oppLogo} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} />}{g.opp}</>}
          {result && <> · <span style={{ color: three ? "#5a6475" : g.result === "W" ? "#15803d" : g.result === "L" ? "#b91c1c" : "#5a6475" }}>{result}</span></>}
          {date && <> · {date}</>}
        </span>
      </div>
      {line && (
        <div style={{ marginTop: 4, fontSize: size, fontWeight: 800, color: "#1c2330" }}>
          {/* Each stat ("129 rec yds") stays whole — lines break only between stats. */}
          {line.split(", ").map((bit, i, all) => (
            <span key={i} style={{ whiteSpace: "nowrap" }}>{bit}{i < all.length - 1 ? ", " : ""}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// One riser, one row: rank, picture, then him — label, name, school, stats, note.
function RiserRow({ riser: r, rank, year, edition, version, photos, game, profile, scout, school, isMobile }) {
  const t = RISER_TYPES[r.type] || RISER_TYPES.up;
  const href = playerHref(r);
  // His graphic carries his stats — with one, the row doesn't repeat them.
  const g = useRiserGraphic({ riser: r, rank, year, photos, version, edition });
  // Every riser gets the graphic layout from the first paint (the admin
  // makes sure each has a graphic) — the placeholder holds its place.
  const big = true;
  // Phone, with a graphic: the graphic across the whole screen, him below it.
  if (big && isMobile) {
    // Phone: the card edge to edge, then a tight block — his number in his
    // label's colors, name and school beside it, the profile arrow at the
    // end; his label and recent line under it, then the note.
    return (
      <article style={{ margin: "0 -10px", background: "#fff", borderBottom: "1px solid #e2e7ef" }}>
        <Media r={r} rank={rank} year={year} school={school} profile={profile} scout={scout} isMobile g={g} />
        <div style={{ padding: "12px 14px 16px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 50, height: 50, flexShrink: 0, borderRadius: 12, background: `linear-gradient(135deg, ${t.c1}, ${t.c2})`, color: "#fff", display: "grid", placeItems: "center", fontFamily: HEAD, fontSize: rank > 9 ? 22 : 26, fontWeight: 900, boxShadow: `0 4px 12px ${t.c1}55` }}>{rank}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 24, fontWeight: 900, lineHeight: 1.02, color: "#1c2330", textTransform: "uppercase" }}><NameLink r={r} /><span style={SR_ONLY}>{headingTail(r)}</span></h3>
              <div style={{ marginTop: 4 }}><SchoolLine r={r} school={school} color="#5a6475" size={14} /></div>
            </div>
            {href && (
              <Link to={href} aria-label={`${nameOf(r)}'s profile`} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", border: `2px solid ${t.c1}`, color: t.ink, display: "grid", placeItems: "center", textDecoration: "none", fontSize: 18, fontWeight: 900 }}>→</Link>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TypeBadge type={r.type} big />
          </div>
          <Note note={r.note} t={t} size={16} />
          <LastGame g={game} t={t} isMobile tight />
        </div>
      </article>
    );
  }
  return (
    <article style={{
      background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #e2e7ef", boxShadow: "0 4px 16px rgba(0,30,70,0.06)",
      padding: isMobile ? 10 : 14, position: "relative",
    }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: `linear-gradient(180deg, ${t.c1}, ${t.c2})` }} />
      <div style={{ display: "flex", alignItems: "stretch", gap: isMobile ? 10 : 18 }}>
      <Media r={r} rank={rank} year={year} school={school} profile={profile} scout={scout} isMobile={isMobile} g={g} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: big ? "flex-start" : "center", paddingTop: big ? 6 : 0, gap: isMobile ? 6 : 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, paddingRight: !isMobile && href ? 130 : 0 }}>
            <span style={{
              width: big ? 56 : 40, height: big ? 56 : 40, flexShrink: 0, borderRadius: 14, display: "grid", placeItems: "center", color: "#fff",
              background: `linear-gradient(135deg, ${t.c1}, ${t.c2})`, fontFamily: HEAD, fontSize: big ? (rank > 9 ? 24 : 28) : 18, fontWeight: 900, boxShadow: `0 4px 12px ${t.c1}55`,
            }}>{rank}</span>
            <h3 style={{ margin: 0, minWidth: 0, fontSize: big ? (isMobile ? 26 : 50) : (isMobile ? 19 : 28), fontWeight: 900, lineHeight: 1, color: "#1c2330", textTransform: "uppercase" }}><NameLink r={r} /><span style={SR_ONLY}>{headingTail(r)}</span></h3>
          </div>
          <div style={{ marginTop: big ? 8 : 4 }}><SchoolLine r={r} school={school} color="#5a6475" size={big ? (isMobile ? 14 : 20) : (isMobile ? 12 : 14)} /></div>
          <div style={{ marginTop: big ? 12 : 8 }}><TypeBadge type={r.type} big={big && !isMobile} /></div>
          {/* The admin's note: under his info, above his recent line. */}
          {!isMobile && r.note && <div style={{ marginTop: big ? 14 : 10 }}><Note note={r.note} t={t} size={big ? 17 : 15} /></div>}
          <LastGame g={game} t={t} isMobile={isMobile} big={big} />
        </div>
        {!isMobile && !big && <Stats stats={r.stats} t={t} />}
      </div>
      {/* Profile, top right — over the row, so his note and recent line can run its full width. */}
      {!isMobile && href && (
        <div style={{ position: "absolute", top: big ? 24 : "50%", right: 20, transform: big ? "none" : "translateY(-50%)" }}>
          <Link to={href} style={{ padding: "9px 14px", borderRadius: 999, border: `2px solid ${t.c1}`, color: t.ink, textDecoration: "none", fontSize: 12, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            Profile →
          </Link>
        </div>
      )}
    </div>
      {isMobile && ((!big && r.stats?.length > 0) || r.note) && (
        <div style={{ display: "grid", gap: 8, marginTop: 10, paddingLeft: 6 }}>
          {!big && <Stats stats={r.stats} t={t} small />}
          <Note note={r.note} t={t} />
        </div>
      )}
    </article>
  );
}

// ── Below: what a riser is, and where to go next ──
function About({ year, isMobile, editions = [], edition = "" }) {
  const link = { padding: "9px 14px", borderRadius: 999, border: "2px solid #0055a5", color: "#0055a5", textDecoration: "none", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase" };
  return (
    <section style={{ marginTop: isMobile ? 30 : 42, background: "#f6f8fb", border: "1px solid #e2e7ef", borderRadius: 16, padding: isMobile ? "18px 16px" : "22px 26px" }}>
      <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 900, color: NAVY, textTransform: "uppercase" }}>How We-Draft Identifies NFL Draft Risers</h2>
      <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.7, fontWeight: 600, fontFamily: BODY, color: "#3a4352" }}>
        These are the {year} NFL Draft prospects whose stock is climbing fastest, ranked on one board. Each wears a label: <strong>On Fire</strong> players are stacking up strong weeks,
        <strong> Trending Up</strong> players have been rising draft boards through consistent good play, and <strong>Breakouts</strong> are the new names forcing their way into the draft conversation.
        The board is updated through the season as performances, film and buzz change.
      </p>
      <h2 style={{ margin: "18px 0 0", fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", color: "#5a6475", textTransform: "uppercase" }}>Explore More {year} NFL Draft Coverage</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <Link to={`/community/${year}`} style={link}>{year} Big Board →</Link>
        <Link to="/mocks" style={link}>Mock Drafts →</Link>
        <Link to="/draftsim" style={link}>Draft Simulator →</Link>
        {RISER_YEARS.filter((y) => y !== year).map((y) => <Link key={y} to={risersPath(y)} style={link}>{y} Risers →</Link>)}
      </div>
      {/* Every edition of this class's list, newest first (the newest is the latest page). */}
      {editions.length > 1 && (
        <>
          <h2 style={{ margin: "18px 0 0", fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", color: "#5a6475", textTransform: "uppercase" }}>{year} Risers Editions</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {editions.map((d, i) => {
              const here = edition ? d === edition : i === 0;
              return (
                <Link key={d} to={i === 0 ? risersPath(year) : editionPath(year, d)} aria-current={here ? "page" : undefined} style={{
                  padding: "6px 11px", borderRadius: 8, fontFamily: BODY, fontSize: 12, fontWeight: 800, textDecoration: "none",
                  background: here ? "#0055a5" : "#fff", color: here ? "#fff" : "#0055a5", border: "1px solid #c9d6e8",
                }}>
                  {editionLabel(d)}{i === 0 ? " · Latest" : ""}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

