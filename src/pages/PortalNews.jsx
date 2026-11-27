// src/pages/PortalNews.jsx
//
// /portal/news — Portal News (utils/portalNews.js): the Transfer Portal's
// editorial page, the live portal's (/portal) companion — laid out like the
// Draft Risers (pages/Risers.jsx), with a portal focus. Two sections:
//   Entered     notable players who just entered, still uncommitted
//   Committed   players who've picked their new school
// Each player: his flip card (front: his graphic — PortalNewsGraphic.jsx,
// the Instagram portal / transfer cover; back: his profile, season and
// updated career path — ScoutCard.jsx CardBack, in his school's colors), where he's coming from
// and going to, the write-up, his season stats, and the ways on: his
// profile, the Portal Sim (entered), his new team's portal page (committed).
// The Portal Sim and the live portal are promoted in the rails and in the
// feed (components/PortalPromo.jsx).
//
// One read for the board (portalNews/current); per player, his playerPhotos
// doc (his placed shots, his headshot) and players doc; the schools by name;
// his career path's schools and honors (useCareerPath). Before there's a published
// board, localhost (or ?sim=1) shows the simulation, under a banner.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import MarginAds from "../components/MarginAds";
import { viewportCssWidth } from "../utils/pageZoom";
import { useSchools } from "../components/DraftArchiveList";
import { playerHref, schoolHref } from "../utils/events";
import { FlipCard, CardBack, FLIP_CSS, teamTheme } from "../components/ScoutCard";
import { usePortalCover, placedShots } from "../components/PortalNewsGraphic";
import { useCareerPath, CareerStop } from "../components/PlayerEligibilityInfo";
import { fetchPortalTeamPage } from "../utils/portalData";
// (PortalSimBanner — the "where should he go?" banner — is out of the list for now: user, 2026-11-19.)
import { PortalSimRailCard, PortalBoardRailCard, PortalBoardBanner } from "../components/PortalPromo";
import { portalTeamSlug } from "../utils/portalTeams";
import { seasonsLeft, activePortalSeason } from "../utils/eligibility";
import { DRAFT_EVENTS, parseDay } from "../utils/draftCalendar";
import {
  PORTAL_NEWS_PATH, NEWS_STATUS, isProjected, newsStatusOf, projectedGraphicIds, getsGraphic, inPortalCount, NEWS_POSITIONS, NEWS_POSITION_NAMES, newsSection, newsDate, statsTitleOf, loadPortalNews,
  newsPosGroup, newsPosFromSlug, newsPath, eligibilityText, NEWS_SIDES, NEWS_POSITION_PLURAL, NEWS_POSITION_PERSON, portalImageUrl,
} from "../utils/portalNews";

// Latest Moves (/portal/news/updates): the portal's updates feed, drawn by
// the portal page itself (TransferPortal embedded) inside this page.
const PortalFeed = lazy(() => import("./TransferPortal"));
const SEASON = activePortalSeason();
const UPDATES_PATH = "/portal/news/updates";

const SITE = "https://we-draft.com";
const GOLD = "#f6a21d";
const NAVY = "#070d18";
const BLUE = "#0055a5";
const BODY = "Arial, sans-serif";
const HEAD = "'Arial Black', Arial, sans-serif";
const COLUMN = 1000;
const SR_ONLY = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 };
const POSITION_NAMES = {
  QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end", OL: "offensive lineman", OT: "offensive tackle", IOL: "interior offensive lineman",
  EDGE: "edge rusher", DL: "defensive lineman", DT: "defensive tackle", LB: "linebacker", DB: "defensive back", CB: "cornerback", S: "safety", K: "kicker", P: "punter",
};
const nameOf = (e) => `${e.first} ${e.last}`;
const graphicAlt = (e) => (e.status === "committed"
  ? `${nameOf(e)}, ${POSITION_NAMES[e.pos] || e.pos}, transfers from ${e.from} to ${e.to}`
  : isProjected(e) ? `${nameOf(e)}, ${POSITION_NAMES[e.pos] || e.pos} from ${e.from}, projected to enter the transfer portal`
  : `${nameOf(e)}, ${POSITION_NAMES[e.pos] || e.pos} from ${e.from}, enters the transfer portal`);
// "Pittsburgh, in the transfer portal" / "…, projected to enter the transfer portal".
const whereOf = (e) => `${e.from}, ${isProjected(e) ? "projected to enter" : "in"} the transfer portal`;

// Side rails beside the column when the screen fits them (as on Risers).
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

// A school's colors for a player's row: { c1, c2, deep, mid, accent } (teamTheme).
const themeOf = (school) => teamTheme(school ? { Color1: school.Color1, Color2: school.Color2 } : {});
// The site's own (We-Draft blue and gold): the card back of a player still in
// the portal — he has no new school's colors yet.
const SITE_THEME = { c1: BLUE, c2: GOLD, deep: NAVY, mid: "#0b2a55", accent: GOLD };
// His new school's logo, while there isn't one: a gold question mark.
const UNKNOWN_LOGO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="80" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="84" text-anchor="middle" fill="#f6a21d">?</text></svg>')}`;

// view: "news" (the board, /portal/news and its positions) or "updates" (Latest Moves).
export default function PortalNews({ view = "news" }) {
  const isUpdates = view === "updates";
  // The route: a position (/portal/news/qb), IN or OUT (/portal/news/in,
  // /portal/news/qb/out) — each its own page. IN: in the portal; OUT:
  // committed; neither: both. (/portal/news/in has no position: its one
  // segment is the side.)
  const { pos: seg1 = "", side: seg2 = "" } = useParams();
  const oneSide = !seg2 && NEWS_SIDES.includes(seg1);
  const posSlug = oneSide ? "" : seg1;
  const sideSlug = oneSide ? seg1 : seg2;
  const pos = newsPosFromSlug(posSlug) || "";
  const show = NEWS_SIDES.includes(sideSlug) ? sideSlug : "";
  const badRoute = (posSlug && !pos) || (sideSlug && !show);
  const isMobile = useIsMobile();
  const rails = useRails(isMobile);
  const contentRef = useRef(null);
  const [news, setNews] = useState(undefined); // { entries, updatedAt, simulated }
  const [photos, setPhotos] = useState({}); // { [id]: playerPhotos doc | null } (missing: loading)
  const [profiles, setProfiles] = useState({}); // { [id]: players doc | null }
  // { [id]: CFBD id } — looked up for a player whose entry has none (saved
  // before entries carried it) and who has no ESPN id on his photos: his
  // ESPN headshot and career path fall back on it.
  const [cfbdIds, setCfbdIds] = useState({});

  useEffect(() => {
    let live = true;
    loadPortalNews().then((n) => {
      if (!live) return;
      setNews(n);
      const ids = [...new Set(n.entries.map((e) => e.id).filter(Boolean))];
      const read = (col, id) => getDoc(doc(db, col, id)).then((s) => [id, s.exists() ? s.data() : null]).catch(() => [id, null]);
      Promise.all(ids.map((id) => read("playerPhotos", id))).then((p) => {
        if (!live) return;
        const ph = Object.fromEntries(p);
        setPhotos(ph);
        const want = n.entries.filter((e) => e.id && !e.cfbdId && !ph[e.id]?.headshot?.espnId).map((e) => e.id);
        Promise.all(want.map((id) => getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", id)))
          .then((s) => {
            const lines = s.docs.filter((d) => d.data().mappingStatus !== "rejected");
            const best = lines.find((d) => d.data().mappingStatus === "verified") || lines[0];
            return [id, best ? String(best.id) : ""];
          }).catch(() => [id, ""])))
          .then((pairs) => live && setCfbdIds(Object.fromEntries(pairs.filter(([, v]) => v))));
      });
      Promise.all(ids.map((id) => read("players", id))).then((p) => live && setProfiles(Object.fromEntries(p)));
    });
    return () => { live = false; };
  }, []);

  const all = useMemo(() => news?.entries || [], [news]);
  // How many on the board at each position (the filters' counts).
  const posCounts = useMemo(() => {
    const c = {};
    all.forEach((e) => { const g = newsPosGroup(e.pos); c[g] = (c[g] || 0) + 1; });
    return c;
  }, [all]);
  const entries = useMemo(() => (pos ? all.filter((e) => newsPosGroup(e.pos) === pos) : all), [all, pos]);
  const entered = useMemo(() => newsSection(entries, "entered"), [entries]);
  const committed = useMemo(() => newsSection(entries, "committed"), [entries]);
  // The IN count leaves the projected players out (they aren't in yet).
  const inCount = useMemo(() => inPortalCount(entered), [entered]);
  // Which projected players get a graphic: the top 3 at each position, over the whole board.
  const graphicIds = useMemo(() => projectedGraphicIds(all), [all]);
  const schools = useSchools(all.flatMap((e) => [e.from, e.to, ...(e.destinations || [])]));

  // Prerender.io: ready once the board is in (8s cap).
  useEffect(() => {
    window.prerenderReady = false;
    const t = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (news === undefined) return undefined;
    const frame = requestAnimationFrame(() => { window.prerenderReady = true; });
    return () => cancelAnimationFrame(frame);
  }, [news]);

  // ── SEO ── (each position its own page; Latest Moves its own)
  const url = `${SITE}${isUpdates ? UPDATES_PATH : newsPath(pos, show)}`;
  const posName = pos ? NEWS_POSITION_NAMES[pos] : ""; // "Offensive Line"
  const posPlural = pos ? NEWS_POSITION_PLURAL[pos] : ""; // "Offensive Linemen"
  const posPerson = pos ? NEWS_POSITION_PERSON[pos] : ""; // "Offensive Lineman"
  const title = isUpdates ? `${SEASON} Transfer Portal Updates: Latest Entries, Commitments and Withdrawals | We-Draft.com`
    // IN / OUT (user, 2026-11-19): "Top Players in the Transfer Portal | 2027 Rankings" ("Players" → the
    // position: "Top QBs …"); "Top Transfer Portal Moves | 2027 Rankings" (the position after Top: "Top QB …").
    : show === "in" ? `Top ${pos ? posPlural : "Players"} in the Transfer Portal | ${SEASON} Rankings`
    : show === "out" ? `Top ${pos ? `${posName} ` : ""}Transfer Portal Moves | ${SEASON} Rankings`
    : pos ? `${posName} Transfer Portal News: ${posPlural} Who Entered & Committed | We-Draft.com`
    : "Transfer Portal News: Who's In, Who's Committed | We-Draft.com";
  const names = [...entered, ...committed].slice(0, 3).map(nameOf);
  // "Colin Simmons, Isaac Brown and Trey'Dez Green" (the first three).
  const listOf = (list) => { const n = list.slice(0, 3).map(nameOf); return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0] || ""; };
  const description = isUpdates
    ? `The latest ${SEASON} college football transfer portal moves, newest first: who entered, who committed and where, and who withdrew, with transfer star ratings.`
    : show === "in"
    ? `The top ${pos ? `${posPlural.toLowerCase()} (${pos}s)` : "players"} in the ${SEASON} college football transfer portal, ranked${inCount ? `: ${listOf(entered.filter((e) => !isProjected(e)))}` : ""}. Stats, years of eligibility, potential destinations and the We-Draft.com prediction for where each one lands.`
    : show === "out"
    ? `The top ${pos ? `${posName.toLowerCase()} ` : ""}transfer portal moves of ${SEASON}, ranked${committed.length ? `: ${listOf(committed)}` : ""}. Where each ${pos ? posPerson.toLowerCase() : "player"} committed, his stats, his career path and what his new school is getting.`
    : pos
    ? `${posName} transfer portal news and analysis: the notable ${pos}s who just entered the college football transfer portal and where the top ${pos}s committed${names.length ? `, from ${names.join(", ")} on down` : ""}. Stats, graphics and what every move means.`
    : `College football transfer portal news and analysis: the notable players who just entered the portal and the commitments that matter${names.length ? `, from ${names.join(", ")} on down` : ""}. Stats, graphics and what every move means.`;
  const updated = news?.updatedAt || null;
  // The ranked list this page shows (IN, OUT, or both — IN first).
  const ranked = isUpdates ? [] : show === "in" ? entered : show === "out" ? committed : [...entered, ...committed];
  // The graphics are served (one permanent URL each — api/portal-graphic.js)
  // once the board is published; the simulation has none.
  const served = !!news && !news.simulated;
  const version = updated ? updated.getTime() : "";
  const hasGraphic = (e) => served && getsGraphic(e, graphicIds) && placedShots(photos[e.id]).length > 0;
  // His graphic, or the headshot view: projected past his position's top 3,
  // or no action shot placed for him (once his photos are in) → headshot.
  const graphicView = (e) => getsGraphic(e, graphicIds) && !(photos[e.id] !== undefined && !placedShots(photos[e.id]).length);
  const rowOf = (e0, i) => {
    const e = !e0.cfbdId && cfbdIds[e0.id] ? { ...e0, cfbdId: cfbdIds[e0.id] } : e0;
    return graphicView(e)
    ? <PlayerRow entry={e} i={i} photos={photos[e.id]} player={profiles[e.id]} schools={schools} isMobile={isMobile} served={served} version={version} />
    : <HeadshotRow entry={e} photos={photos[e.id]} player={profiles[e.id]} schools={schools} isMobile={isMobile} />;
  };
  const firstGraphic = ranked.find(hasGraphic) || null;
  const imageOf = (e) => portalImageUrl(e.slug, false, version, "png");
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: "We-Draft.com" },
      {
        "@type": "CollectionPage", "@id": `${url}#webpage`, url, name: title.replace(/ \| We-Draft\.com$/, ""), description, inLanguage: "en-US",
        isPartOf: { "@id": `${SITE}/#website` }, breadcrumb: { "@id": `${url}#breadcrumb` }, ...(updated ? { dateModified: updated.toISOString() } : {}),
        ...(ranked.length ? { mainEntity: { "@id": `${url}#rankings` } } : {}),
        ...(firstGraphic ? { primaryImageOfPage: { "@type": "ImageObject", url: imageOf(firstGraphic), width: 1080, height: 1350 } } : {}),
      },
      // The rankings themselves, in the page's order, each to his profile.
      ...(ranked.length ? [{
        "@type": "ItemList", "@id": `${url}#rankings`, name: title.split(" | ")[0], url,
        itemListOrder: "https://schema.org/ItemListOrderDescending", numberOfItems: ranked.length,
        itemListElement: ranked.map((e, i) => ({
          "@type": "ListItem", position: i + 1, name: nameOf(e),
          ...(playerHref(e) ? { url: `${SITE}${playerHref(e)}` } : {}),
          description: e.status === "committed" ? `${e.pos}, ${e.from} to ${e.to}` : `${e.pos}, ${whereOf(e)}`,
          ...(hasGraphic(e) ? { image: imageOf(e) } : {}),
        })),
      }] : []),
      {
        "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "Transfer Portal", item: `${SITE}/portal` },
          { "@type": "ListItem", position: 3, name: "News", item: `${SITE}${PORTAL_NEWS_PATH}` },
          ...(isUpdates ? [{ "@type": "ListItem", position: 4, name: "Latest Moves", item: url }]
            : [pos && { name: pos, item: `${SITE}${newsPath(pos)}` }, show && { name: show === "in" ? "In the Portal" : "Committed", item: url }]
              .filter(Boolean).map((x, i) => ({ "@type": "ListItem", position: 4 + i, ...x }))),
        ],
      },
    ],
  };
  const ready = news !== undefined;
  const empty = ready && !all.length;

  if (badRoute) return <Navigate to={newsPath(pos, show)} replace />;

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        {/* Live and indexable (user, 2026-11-19). Only the SIMULATED preview
            board (localhost / ?sim=1) stays out of search — it's fake data. */}
        {!isUpdates && news?.simulated && <meta name="robots" content="noindex, follow" />}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        {/* The first ranked player's graphic: the page's preview (as on Risers). */}
        {firstGraphic && <meta property="og:image" content={imageOf(firstGraphic)} />}
        {firstGraphic && <meta property="og:image:width" content="1080" />}
        {firstGraphic && <meta property="og:image:height" content="1350" />}
        {firstGraphic && <meta property="og:image:type" content="image/png" />}
        {firstGraphic && <meta property="og:image:alt" content={graphicAlt(firstGraphic)} />}
        {firstGraphic && <meta name="twitter:image" content={imageOf(firstGraphic)} />}
        {firstGraphic && <meta name="twitter:image:alt" content={graphicAlt(firstGraphic)} />}
        {firstGraphic && ranked.length > 0 && <meta name="robots" content="max-image-preview:large" />}
        <meta name="twitter:card" content={firstGraphic ? "summary_large_image" : "summary"} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={rails ? 0 : 24} watch={[rails]} />

      <div ref={contentRef} style={{ position: "relative", maxWidth: rails ? COLUMN + 2 * SIDE : COLUMN, margin: `${isMobile ? -14 : -12}px auto 0`, padding: rails ? `0 ${SIDE}px` : 0, boxSizing: "border-box" }}>
        {rails && (
          <>
            <div style={{ position: "absolute", top: 10, bottom: 60, left: 0, width: RAIL_WIDTH }}>
              <div style={{ position: "sticky", top: 16 }}><PortalBoardRailCard /></div>
            </div>
            <div style={{ position: "absolute", top: 10, bottom: 60, right: 0, width: RAIL_WIDTH }}>
              <div style={{ position: "sticky", top: 16 }}><PortalSimRailCard /></div>
            </div>
          </>
        )}
        <div style={{ maxWidth: COLUMN, margin: "0 auto", padding: isMobile ? "4px 10px 60px" : "10px 24px 60px", fontFamily: HEAD }}>
          {news?.simulated && !isUpdates && <SimNotice isMobile={isMobile} />}
          <Hero isMobile={isMobile} updated={updated} pos={pos} updates={isUpdates} side={show} />

          {isUpdates && (
            <>
              <PositionFilters pos="" updates counts={posCounts} total={all.length} isMobile={isMobile} />
              <div style={{ marginTop: isMobile ? 12 : 14 }}>
                <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#8a94a6", fontWeight: 800 }}>Loading…</div>}>
                  <PortalFeed view="updates" embedded />
                </Suspense>
              </div>
              <div style={{ marginTop: isMobile ? 22 : 30 }}><PortalBoardBanner isMobile={isMobile} onMoves /></div>
            </>
          )}

          {isUpdates ? null : !ready ? (
            <div style={{ padding: 40, textAlign: "center", color: "#8a94a6", fontWeight: 800 }}>Loading…</div>
          ) : empty ? (
            <div style={{ marginTop: 18, border: "2px dashed #d5dbe4", background: "#f8fafc", borderRadius: 16, padding: "28px 20px", textAlign: "center", color: "#5a6475", fontFamily: BODY, fontWeight: 700, fontSize: 15 }}>
              Portal News is on its way. In the meantime, follow every move on the <Link to="/portal" style={{ color: BLUE }}>live Transfer Portal</Link>.
            </div>
          ) : (
            <>
              <PositionFilters pos={pos} side={show} counts={posCounts} total={all.length} isMobile={isMobile} />
              <InOut show={show} pos={pos} inCount={inCount} outCount={committed.length} isMobile={isMobile} />
              {!entries.length && (
                <div style={{ marginTop: 18, border: "2px dashed #d5dbe4", background: "#f8fafc", borderRadius: 16, padding: "28px 20px", textAlign: "center", color: "#5a6475", fontFamily: BODY, fontWeight: 700, fontSize: 15, lineHeight: 1.6 }}>
                  No {posPerson.toLowerCase()} moves on Portal News yet. Every {pos} in the portal is on the{" "}
                  <Link to={`/portal/${pos.toLowerCase()}`} style={{ color: BLUE }}>live {pos} Transfer Portal board</Link>.
                </div>
              )}
              {entered.length > 0 && show !== "out" && (
                <Section status="entered" count={inCount} isMobile={isMobile} sub="Notable names who just hit the portal, and where they could land.">
                  {entered.map((e, i) => (
                    <li key={e.id} id={e.slug} style={{ scrollMarginTop: 90 }}>
                      {rowOf(e, i)}
                    </li>
                  ))}
                </Section>
              )}
              {committed.length > 0 && show !== "in" && (
                <Section status="committed" count={committed.length} isMobile={isMobile} sub="The commitments that change what a team can be next season.">
                  {committed.map((e, i) => (
                    <li key={e.id} id={e.slug} style={{ scrollMarginTop: 90 }}>
                      {rowOf(e, i)}
                    </li>
                  ))}
                </Section>
              )}
              <div style={{ marginTop: isMobile ? 22 : 30 }}><PortalBoardBanner isMobile={isMobile} /></div>
            </>
          )}
          <About isMobile={isMobile} pos={pos} side={show} posName={posName} posPlural={posPlural} posPerson={posPerson} inCount={inCount} outCount={committed.length} />
        </div>
      </div>
    </>
  );
}

// ── Before a board is published: the simulation, said plainly ──
function SimNotice({ isMobile }) {
  return (
    <div role="note" style={{
      margin: isMobile ? "8px 0 12px" : "4px 0 14px", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12,
      background: "repeating-linear-gradient(135deg, #fff4d6 0 14px, #ffecb8 14px 28px)", border: `1px solid ${GOLD}`, fontFamily: BODY, fontSize: 13, fontWeight: 700, color: "#5a3a00",
    }}>
      <span style={{ fontFamily: HEAD, fontWeight: 900, letterSpacing: "0.08em", background: "#5a3a00", color: "#fff", borderRadius: 6, padding: "3px 8px", fontSize: 11 }}>SIMULATED</span>
      <span>Preview data: these moves haven't happened. Real players and their real 2026 stats; the entries and commitments are made up.</span>
    </div>
  );
}

// ── The hero: compact, so the first player is in view ──
// "Top Transfer Portal Players" (a position's page: "… QBs"); Latest Moves
// its own. One line under it, and the board's last update.
function Hero({ isMobile, updated, pos, updates = false, side = "" }) {
  // IN: "Top QBs / In the Portal"; OUT: "Top QB Transfer Portal / Moves"; both: "Top Transfer Portal / QBs".
  const top = updates ? "Transfer Portal" : side === "in" ? `Top ${pos ? `${pos}s` : "Players"}` : side === "out" ? `Top ${pos ? `${pos} ` : ""}Transfer Portal` : "Top Transfer Portal";
  const big = updates ? "Latest Moves" : side === "in" ? "In the Portal" : side === "out" ? "Moves" : pos ? `${pos}s` : "Players";
  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 18, color: "#fff", padding: isMobile ? "16px 16px 14px" : "16px 32px 14px",
      background: `radial-gradient(circle at 50% 140%, ${GOLD}99 0, transparent 50%), radial-gradient(circle at 0% -30%, #1d5fbf 0, transparent 50%), radial-gradient(circle at 100% -10%, #3a1d7c 0, transparent 45%), ${NAVY}`,
      boxShadow: "0 12px 30px rgba(7,13,24,0.3)",
    }}>
      {/* The portal, swirling behind the title. */}
      <svg aria-hidden="true" viewBox="0 0 1000 260" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.45 }}>
        {[[440, 190, GOLD, "260 40 90 30", 7, -5], [380, 160, "#4f8fe0", "200 30 60 24", 5, 8], [320, 132, GOLD, "160 26 50 20", 8, -12], [260, 104, "#4f8fe0", "120 22 40 16", 4, 15]].map(([rx, ry, c, d, w, rot]) => (
          <ellipse key={rx} cx="500" cy="140" rx={rx} ry={ry} fill="none" stroke={c} strokeWidth={w} strokeDasharray={d} strokeLinecap="round" transform={`rotate(${rot} 500 140)`} opacity="0.55" />
        ))}
      </svg>
      {/* Hazard tape across the top corner (not on a phone: it would cross the title). */}
      {!isMobile && <div aria-hidden="true" style={{
        position: "absolute", top: isMobile ? 10 : 16, right: isMobile ? -64 : -54, transform: "rotate(14deg)", background: GOLD, color: NAVY, padding: "3px 70px",
        fontFamily: HEAD, fontWeight: 900, fontSize: isMobile ? 8 : 10, letterSpacing: "0.2em", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", whiteSpace: "nowrap",
      }}>TRANSFER PORTAL /// TRANSFER PORTAL</div>}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <h1 style={{ margin: 0, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.02em", lineHeight: 0.92 }}>
          <span style={{ display: "block", fontSize: isMobile ? 17 : 24, color: "rgba(255,255,255,0.92)", letterSpacing: "0.06em" }}>{top}</span>{" "}
          <span style={{ display: "block", fontSize: big.length > 10 ? (isMobile ? 38 : 70) : (isMobile ? 48 : 74), background: `linear-gradient(100deg, #ffffff 20%, ${GOLD} 90%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", paddingBottom: 4 }}>{big}</span>
        </h1>
        <div style={{ marginTop: isMobile ? 6 : 8, display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 8 : 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: isMobile ? 11 : 14, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.82)" }}>
            {updates ? "Every entry, commitment and withdrawal" : "Who's in. Who's committed. What it means."}
          </span>
          {updated && !updates && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.22)" }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" }} />
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>Updated</span>
              <time dateTime={updated.toISOString()} style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>{updated.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── The filter bar: New (Latest Moves) first, then All and the positions —
// one row, in a card; each its own page. A phone scrolls it sideways. ──
function PositionFilters({ pos, counts, total, isMobile, updates = false, side = "" }) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, padding: isMobile ? "7px 10px" : "7px 12px", borderRadius: 9, textDecoration: "none", whiteSpace: "nowrap",
    fontFamily: HEAD, fontSize: isMobile ? 12 : 13, fontWeight: 900, letterSpacing: "0.04em", border: "none",
  };
  const chip = (key, label, n) => {
    const on = !updates && (key || "") === pos;
    const none = !n;
    return (
      <Link key={key || "all"} to={newsPath(key, side)} aria-current={on ? "page" : undefined} style={{
        ...base, background: on ? NAVY : "transparent", color: on ? "#fff" : none ? "#a3acba" : "#1c2330",
      }}>
        {label}
        <span style={{ fontFamily: BODY, fontSize: 10, fontWeight: 900, borderRadius: 999, padding: "1px 6px", minWidth: 8, textAlign: "center", background: on ? GOLD : none ? "#f1f4f8" : "#e9eef5", color: on ? NAVY : none ? "#b3bcc9" : "#5a6475" }}>{n || 0}</span>
      </Link>
    );
  };
  return (
    <nav aria-label="Filter" style={{
      marginTop: isMobile ? 14 : 18, display: "flex", alignItems: "center", gap: 2, padding: 5, borderRadius: 13, background: "#fff",
      border: "1px solid #e2e7ef", boxShadow: "0 2px 8px rgba(0,30,70,0.05)", overflowX: "auto", scrollbarWidth: "none",
    }}>
      {/* New: every move, newest first (the portal's updates feed). */}
      <Link to={UPDATES_PATH} aria-current={updates ? "page" : undefined} style={{
        ...base, background: updates ? BLUE : "#eef5ff", color: updates ? "#fff" : BLUE,
      }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 0 3px rgba(34,197,94,0.22)" }} />New
      </Link>
      <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "#e2e7ef", margin: "4px 4px", flexShrink: 0 }} />
      {chip("", "Top", total)}
      {NEWS_POSITIONS.map((p) => chip(p, p, counts[p]))}
    </nav>
  );
}

// ── IN / OUT: just the players in the portal, or just the committed ones
// (neither on: both). Quiet, under the filter bar. ──
function InOut({ show, pos, inCount, outCount, isMobile }) {
  const btn = (k, label, n, color) => {
    const on = show === k;
    return (
      <Link to={newsPath(pos, on ? "" : k)} aria-current={on ? "page" : undefined} title={k === "in" ? "Players in the portal" : "Players who've committed"} style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", border: "none", borderRadius: 999, cursor: "pointer", textDecoration: "none",
        fontFamily: HEAD, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", background: on ? color : "transparent", color: on ? "#fff" : "#5a6475",
      }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: on ? "#fff" : color }} />
        {label}<span style={{ fontFamily: BODY, fontSize: 10, opacity: 0.75 }}>{n}</span>
      </Link>
    );
  };
  return (
    // Desktop: it takes no room of its own — the first section's heading slides up beside it.
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: isMobile ? 10 : 12, marginBottom: isMobile ? 0 : -32, position: "relative", zIndex: 1 }}>
      <div role="group" aria-label="In the portal or committed" style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 999, background: "#f1f4f8", border: "1px solid #e2e7ef" }}>
        {btn("in", "IN", inCount, NEWS_STATUS.entered.c1)}
        {btn("out", "OUT", outCount, NEWS_STATUS.committed.c1)}
      </div>
    </div>
  );
}

// A section's icon: the portal (entered), a check (committed).
function StatusIcon({ status, size = 20, color = "#fff" }) {
  return status === "committed" ? (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" fill={color} /><path d="M7 12.5 L10.5 16 L17 9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}><ellipse cx="12" cy="12" rx="9" ry="10.5" fill="none" stroke={color} strokeWidth="2.4" /><ellipse cx="12" cy="12" rx="4.5" ry="6" fill={color} /></svg>
  );
}

// ── A section: its header, then its players ──
function Section({ status, count, sub, isMobile, children }) {
  const s = NEWS_STATUS[status];
  return (
    <section id={status} aria-labelledby={`${status}-title`} style={{ marginTop: isMobile ? 20 : 24, scrollMarginTop: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, margin: isMobile ? "0 4px 12px" : "0 0 12px" }}>
        <span style={{ width: isMobile ? 40 : 44, height: isMobile ? 40 : 44, flexShrink: 0, borderRadius: 12, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${s.c1}, ${s.c2})`, boxShadow: `0 6px 16px ${s.c1}55` }}>
          <StatusIcon status={status} size={isMobile ? 22 : 26} color={status === "committed" ? "rgba(0,0,0,0.25)" : "#fff"} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 id={`${status}-title`} style={{ margin: 0, fontSize: isMobile ? 19 : 28, whiteSpace: "nowrap", fontWeight: 900, color: NAVY, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1 }}>
            {s.section} <span style={{ color: s.c1 }}>({count})</span>
          </h2>
          <div style={{ marginTop: 5, fontFamily: BODY, fontSize: isMobile ? 13 : 15, fontWeight: 700, color: "#5a6475" }}>{sub}</div>
        </div>
      </div>
      <style>{FLIP_CSS}</style>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: isMobile ? 0 : 14 }}>{children}</ol>
    </section>
  );
}

// ── One player ──
function Logo({ school, size }) {
  const src = school?.Logo1 || school?.LogoDark;
  return src ? <img src={src} alt="" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} /> : null;
}
// Where he's coming from → going to (a question mark while he's in the portal).
function Route({ e, schools, isMobile, big }) {
  const size = big ? 30 : 24;
  const font = big ? 17 : 14;
  const school = (name, strong) => (
    <Link to={schoolHref(name)} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: strong ? "#1c2330" : "#5a6475", textDecoration: "none", fontWeight: strong ? 900 : 800, minWidth: 0 }}>
      <Logo school={schools[name]} size={size} /><span style={{ whiteSpace: "nowrap" }}>{name}</span>
    </Link>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, flexWrap: "wrap", fontFamily: BODY, fontSize: font }}>
      {school(e.from, false)}
      <svg width={big ? 34 : 26} height={14} viewBox="0 0 34 14" aria-hidden="true" style={{ flexShrink: 0 }}>
        {[0, 10, 20].map((x, i) => <path key={x} d={`M${x + 2} 2 L${x + 9} 7 L${x + 2} 12`} fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity={0.45 + i * 0.27} />)}
      </svg>
      {e.status === "committed" ? school(e.to, true) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `2px dashed ${GOLD}`, borderRadius: 8, padding: big ? "3px 10px" : "2px 8px", fontWeight: 900, color: "#9a5b00", fontSize: font - 2, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          <span style={{ fontFamily: HEAD, fontSize: font + 2 }}>?</span> Undecided
        </span>
      )}
    </div>
  );
}
// Projected players (not in the portal yet) wear their own violet, dashed pill.
function StatusPill({ e }) {
  const s = newsStatusOf(e);
  const proj = isProjected(e);
  const day = proj ? "" : newsDate(e.date); // (no "entered on" day: he hasn't)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px 5px 8px", borderRadius: 999, fontFamily: BODY, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", background: s.tint, color: s.ink, border: proj ? `1.5px dashed ${s.c1}` : `1px solid ${s.c1}55` }}>
      <StatusIcon status={e.status} size={14} color={s.c1} />{s.short}{day && <span style={{ opacity: 0.7 }}>· {day}</span>}
    </span>
  );
}
function Bio({ e, p }) {
  // His years of eligibility left (for the season the portal feeds), not his draft class.
  const bits = [e.pos, p?.Height, p?.Weight ? `${p.Weight} lbs` : "", eligibilityText(p, seasonsLeft)].filter(Boolean);
  return <div style={{ fontFamily: BODY, fontSize: 13, fontWeight: 800, color: "#7a8597", letterSpacing: "0.02em" }}>{bits.join("  ·  ")}</div>;
}
function Note({ note, color, size = 15 }) {
  if (!note) return null;
  return (
    <div style={{ fontSize: size, lineHeight: 1.65, fontWeight: 600, fontFamily: BODY, color: "#3a4352", borderLeft: `3px solid ${color}`, paddingLeft: 12 }}>
      {String(note).split(/\n{2,}/).map((t, i) => <p key={i} style={{ margin: i ? "8px 0 0" : 0 }}>{t}</p>)}
    </div>
  );
}
// An entered player's potential destinations (the admin's three), in place
// of his stats — each to its team's portal page, We-Draft.com's pick marked.
function Destinations({ e, schools, isMobile }) {
  const list = (e.destinations || []).filter(Boolean);
  return (
    <div>
      <div style={{ fontFamily: BODY, fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a8597", marginBottom: list.includes(e.prediction) ? 16 : 6 }}>Potential destinations</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))`, gap: isMobile ? 6 : 8 }}>
        {list.map((name) => {
          const sc = schools[name];
          const pick = name === e.prediction;
          const c1 = /^#?[0-9a-f]{6}$/i.test(sc?.Color1 || "") ? `#${String(sc.Color1).replace("#", "")}` : "#5a6475";
          return (
            <Link key={name} to={`/portal/${portalTeamSlug(name)}`} title={`${name}'s transfer portal page`} style={{
              position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, textAlign: "center", textDecoration: "none",
              padding: isMobile ? (pick ? "18px 4px 9px" : "10px 4px 9px") : (pick ? "17px 8px 8px" : "9px 8px 8px"), borderRadius: 12,
              background: pick ? `linear-gradient(180deg, ${GOLD}1f, #fff 70%)` : "#f6f8fb",
              border: pick ? `2px solid ${GOLD}` : "1px solid #e2e7ef", boxShadow: pick ? `0 6px 16px ${GOLD}33` : "none",
            }}>
              {pick && (
                <span style={{ position: "absolute", top: -1, left: "50%", transform: "translate(-50%, -50%)", whiteSpace: "nowrap", background: GOLD, color: NAVY, borderRadius: 999, padding: isMobile ? "3px 7px" : "3px 10px", fontFamily: BODY, fontSize: isMobile ? 8 : 9, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>
                  ★ We-Draft.com Prediction
                </span>
              )}
              <span style={{ width: isMobile ? 34 : 34, height: isMobile ? 34 : 34, display: "grid", placeItems: "center" }}>
                {sc?.Logo1 || sc?.LogoDark ? <img src={sc.Logo1 || sc.LogoDark} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : <span style={{ fontFamily: HEAD, fontWeight: 900, color: c1, fontSize: 14 }}>{name.slice(0, 3).toUpperCase()}</span>}
              </span>
              <span style={{ fontFamily: HEAD, fontSize: isMobile ? 11 : 13, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, color: pick ? NAVY : "#3a4352" }}>{name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
// His stats on the row — or, while he's in the portal and the admin has
// named some, his potential destinations instead.
function RowFacts({ e, t, schools, isMobile }) {
  return e.status === "entered" && (e.destinations || []).some(Boolean)
    ? <Destinations e={e} schools={schools} isMobile={isMobile} />
    : <Stats e={e} t={t} isMobile={isMobile} />;
}
function Stats({ e, t, isMobile }) {
  const list = (e.stats || []).filter((s) => s?.value !== "" && s?.value != null);
  if (!list.length) return null;
  return (
    <div>
      <div style={{ fontFamily: BODY, fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a8597", marginBottom: 6 }}>{statsTitleOf(e)}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))`, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e7ef" }}>
        {list.map((s, i) => (
          <div key={s.key || s.label} style={{ padding: isMobile ? "8px 4px" : "10px 6px", textAlign: "center", background: i % 2 ? "#fbfcfe" : "#f4f7fb", borderLeft: i ? "1px solid #e2e7ef" : "none" }}>
            <div style={{ fontFamily: HEAD, fontSize: isMobile ? 18 : 22, fontWeight: 900, lineHeight: 1, color: t.c1, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
            <div style={{ fontFamily: BODY, fontSize: 10, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", marginTop: 4, color: "#5a6475" }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
// The ways on: his profile, then the sim (entered) or his new team's portal page (committed).
function Actions({ e, t, isMobile }) {
  const href = playerHref(e);
  const pill = { display: "inline-flex", alignItems: "center", gap: 6, padding: isMobile ? "9px 12px" : "10px 16px", borderRadius: 999, fontFamily: BODY, fontSize: 12, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap" };
  const team = e.status === "committed" ? e.to : "";
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {e.status === "committed" ? (
        <Link to={`/portal/${portalTeamSlug(team)}`} style={{ ...pill, background: t.c1, color: "#fff", boxShadow: `0 4px 12px ${t.c1}44` }}>{team} portal moves →</Link>
      ) : (
        <Link to="/portalsim" style={{ ...pill, background: GOLD, color: NAVY, boxShadow: `0 4px 12px ${GOLD}55` }}>▶ Land him in the Portal Sim</Link>
      )}
      {href && <Link to={href} style={{ ...pill, border: "2px solid #c9d3e1", color: "#1c2330", padding: isMobile ? "7px 12px" : "8px 14px" }}>Scouting report →</Link>}
    </div>
  );
}

function PlayerRow({ entry: e, i, photos, player, schools, isMobile, served = false, version = "" }) {
  const fromDoc = schools[e.from];
  const toDoc = e.to ? schools[e.to] : null;
  // His colors: his new school's once he's committed, his old one's while he's in the portal.
  const home = e.status === "committed" ? toDoc : fromDoc;
  const t = themeOf(home);
  const g = usePortalCover({ entry: e, photos, player, from: fromDoc, to: toDoc, served, version });

  const card = <Card e={e} i={i} g={g} t={t} home={home} player={player} photos={photos} isMobile={isMobile} />;
  const heading = (
    <h3 style={{ margin: 0, fontSize: isMobile ? 26 : 40, fontWeight: 900, lineHeight: 1, color: "#1c2330", textTransform: "uppercase", letterSpacing: "-0.01em" }}>
      {playerHref(e) ? <Link to={playerHref(e)} style={{ color: "inherit", textDecoration: "none" }}>{nameOf(e)}</Link> : nameOf(e)}
      <span style={SR_ONLY}> – {e.pos}, {e.status === "committed" ? `${e.from} to ${e.to}` : whereOf(e)}</span>
    </h3>
  );
  if (isMobile) {
    return (
      <article style={{ margin: "0 -10px", background: "#fff", borderBottom: "1px solid #e2e7ef" }}>
        {card}
        <div style={{ padding: "14px 14px 18px", display: "grid", gap: 10, borderTop: `4px solid ${t.c1}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><StatusPill e={e} /></div>
          {heading}
          <Bio e={e} p={player} />
          <Route e={e} schools={schools} isMobile />
          <Note note={e.note} color={t.c1} size={16} />
          <RowFacts e={e} t={t} schools={schools} isMobile />
          <Actions e={e} t={t} isMobile />
        </div>
      </article>
    );
  }
  return (
    <article style={{ position: "relative", background: "#fff", borderRadius: 18, overflow: "hidden", border: "1px solid #e2e7ef", boxShadow: "0 6px 20px rgba(0,30,70,0.07)", padding: 14 }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: `linear-gradient(180deg, ${t.c1}, ${t.c2})` }} />
      {/* A faint wash of his colors behind the words. */}
      <div aria-hidden="true" style={{ position: "absolute", right: -80, top: -80, width: 320, height: 320, borderRadius: "50%", background: `radial-gradient(circle, ${t.c1}14 0%, transparent 70%)` }} />
      <div style={{ position: "relative", display: "flex", alignItems: "stretch", gap: 22 }}>
        {card}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10, paddingTop: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <StatusPill e={e} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>{heading}<Bio e={e} p={player} /></div>
          <Route e={e} schools={schools} big />
          <Note note={e.note} color={t.c1} size={15} />
          <div style={{ marginTop: "auto", display: "grid", gap: 12 }}>
            <RowFacts e={e} t={t} schools={schools} />
            <Actions e={e} t={t} />
          </div>
        </div>
      </div>
    </article>
  );
}

// ── CFBD fallbacks (a player new to We-Draft — added from the CFB Universe —
// has no headshot, career stops or high school of ours yet), the way the
// Portal Sim fills them: ESPN's headshot by his CFBD id (CFBD = ESPN ids),
// his college stops and high school from his school's portal team page
// (compSnapshots/_portal_{slug} roster row: cp, hs, rs, rr). ──
const espnHeadshot = (id) => (id ? `https://a.espncdn.com/i/headshots/college-football/players/full/${id}.png` : "");
const espnIdOf = (e, photos) => String(photos?.headshot?.espnId || e.cfbdId || "");
// → his players doc with CFBD's career filled in where ours is empty
// (undefined while his doc loads).
function useCfbdProfile(e, player, photos) {
  const espnId = espnIdOf(e, photos);
  const needs = player !== undefined && !(player?.CareerStops || []).length && !!espnId && !!e.from;
  const [row, setRow] = useState(null);
  useEffect(() => {
    if (!needs) { setRow(null); return undefined; }
    let live = true;
    fetchPortalTeamPage(portalTeamSlug(e.from))
      .then((d) => { if (live) setRow((d?.roster || []).find((r) => String(r.id) === espnId) || null); })
      .catch(() => { if (live) setRow(null); });
    return () => { live = false; };
  }, [needs, e.from, espnId]);
  return useMemo(() => {
    if (player === undefined || !row) return player;
    const cp = row.cp || [];
    return {
      ...(player || {}),
      CareerStops: cp.map(([From, To, School]) => ({ School, From, To })),
      HighSchool: player?.HighSchool || row.hs?.[0] || "", State: player?.State || row.hs?.[2] || "",
      RecruitStars: player?.RecruitStars ?? row.rs, RecruitRank: player?.RecruitRank ?? row.rr,
      RecruitYear: player?.RecruitYear || (cp[0]?.[0] ? String(cp[0][0]) : ""),
    };
  }, [player, row]);
}
// His career path, moved along: his new school on top once he's committed,
// the portal while he's in it (not a projected player: he isn't).
function useNewsCareer(e, profile, espnId) {
  const moved = useMemo(() => (profile === undefined ? null : {
    ...(profile || {}), id: e.id, School: e.status === "committed" ? e.to : e.from, InPortal: e.status === "entered" && !e.projected,
  }), [profile, e.id, e.status, e.projected, e.to, e.from]);
  const { rows } = useCareerPath(moved, espnId, null);
  return rows.map((r, k) => (k === 0 && e.status === "committed" && r.name === e.to && !/\d/.test(r.span || "") ? { ...r, span: "Committed", current: true } : r));
}

// The headshot view — no graphic: a projected player past his position's top
// 3 (utils/portalNews.js projectedGraphicIds), or anyone with no action shot
// placed. His headshot (ours, else ESPN's, else his school's logo), his name,
// note, stats and career path.
function HeadshotRow({ entry: e, photos, player, schools, isMobile }) {
  const committed = e.status === "committed";
  const home = committed ? schools[e.to] : schools[e.from];
  const t = themeOf(home);
  const espnId = espnIdOf(e, photos);
  const profile = useCfbdProfile(e, player, photos);
  const career = useNewsCareer(e, profile, espnId);
  const [espnOk, setEspnOk] = useState(true);
  const head = photos?.headshot?.url || (espnOk ? espnHeadshot(espnId) : "");
  const logo = home?.Logo1 || home?.LogoDark || "";
  const size = isMobile ? 76 : 112;
  const heading = (
    <h3 style={{ margin: 0, fontSize: isMobile ? 22 : 30, fontWeight: 900, lineHeight: 1, color: "#1c2330", textTransform: "uppercase", letterSpacing: "-0.01em" }}>
      {playerHref(e) ? <Link to={playerHref(e)} style={{ color: "inherit", textDecoration: "none" }}>{nameOf(e)}</Link> : nameOf(e)}
      <span style={SR_ONLY}> – {e.pos}, {committed ? `${e.from} to ${e.to}` : whereOf(e)}</span>
    </h3>
  );
  const shot = (
    <div style={{ width: size, height: size, flexShrink: 0, borderRadius: "50%", overflow: "hidden", background: `radial-gradient(circle at 50% 38%, ${t.c1} 0%, ${t.deep} 100%)`, border: `3px solid ${t.c1}`, display: "grid", placeItems: "center" }}>
      {head ? <img src={head} alt={`${nameOf(e)} headshot`} loading="lazy" decoding="async" onError={() => setEspnOk(false)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        : logo ? <img src={logo} alt="" style={{ width: "62%", height: "62%", objectFit: "contain" }} /> : null}
    </div>
  );
  return (
    <article style={isMobile
      ? { margin: "0 -10px", background: "#fff", borderBottom: "1px solid #e2e7ef", borderLeft: `4px solid ${t.c1}`, padding: "14px 14px 16px" }
      : { position: "relative", background: "#fff", borderRadius: 18, overflow: "hidden", border: "1px solid #e2e7ef", boxShadow: "0 6px 20px rgba(0,30,70,0.07)", padding: "16px 18px 16px 22px" }}>
      {!isMobile && <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: `linear-gradient(180deg, ${t.c1}, ${t.c2})` }} />}
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 18 }}>
        {shot}
        <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><StatusPill e={e} /></div>
          {heading}
          <Bio e={e} p={player} />
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <Route e={e} schools={schools} isMobile={isMobile} />
        <Note note={e.note} color={t.c1} size={isMobile ? 15 : 14} />
        <Stats e={e} t={t} isMobile={isMobile} />
        {career.length > 0 && (
          <div>
            <div style={{ fontFamily: BODY, fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a8597", marginBottom: 6 }}>Career Path</div>
            <div>{career.map(({ key, ...x }, k) => <CareerStop key={key} {...x} to={undefined} isMobile={isMobile} last={k === career.length - 1} />)}</div>
          </div>
        )}
        <Actions e={e} t={t} isMobile={isMobile} />
      </div>
    </article>
  );
}

// His card: the front his graphic (a placeholder in his colors with his
// school's logo until it's drawn), the back his profile, season and
// career path (moved along to his new school, or the portal).
function Card({ e, i, g, t, home, player, photos, isMobile }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [g.src]);
  const logo = home?.LogoDark || home?.Logo1;
  const s = newsStatusOf(e);
  // His career path (CFBD's where ours is empty), moved along.
  const espnId = espnIdOf(e, photos);
  const profile = useCfbdProfile(e, player, photos);
  const career = useNewsCareer(e, profile, espnId);
  return (
    <FlipCard width={isMobile ? "100%" : 330} radius={isMobile ? 0 : 12} label={`${nameOf(e)}: flip his card`}
      frontBg={`radial-gradient(circle at 50% 38%, ${t.c1} 0%, ${t.mid} 55%, ${t.deep} 100%)`}
      front={(
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: loaded ? 0 : 1, transition: "opacity 0.3s" }}>
            {logo && <img src={logo} alt="" style={{ width: "58%", height: "58%", objectFit: "contain", opacity: g.failed ? 1 : 0.85 }} />}
            {!g.failed && <span style={{ position: "absolute", bottom: "8%", fontFamily: BODY, fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(255,255,255,0.7)" }}>LOADING GRAPHIC…</span>}
          </div>
          {g.src && (
            <picture>
            {g.webpSrcSet && <source type="image/webp" srcSet={g.webpSrcSet} sizes={isMobile ? "100vw" : "330px"} />}
            <img src={g.src} srcSet={g.srcSet || undefined} sizes={isMobile ? "100vw" : "330px"} onError={g.onError}
              width={1080} height={1350} alt={graphicAlt(e)} onLoad={() => setLoaded(true)} decoding="async" loading={i < 2 ? "eager" : "lazy"} fetchpriority={i === 0 ? "high" : undefined}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", objectFit: "cover", opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }} />
            </picture>
          )}
        </>
      )}
      back={(
        <CardBack theme={e.status === "committed" ? t : SITE_THEME} name={nameOf(e)} pos={e.pos} school={e.status === "committed" ? e.to : e.from} logo={e.status === "committed" ? logo : UNKNOWN_LOGO}
          photo={photos?.headshot?.url || espnHeadshot(espnId)} logoCircle profile={profile} stats={e.stats} statsTitle={statsTitleOf(e)} career={career} year={player?.Eligible || ""}
          chip={<><StatusIcon status={e.status} size={11} color="#fff" />{s.label}</>} footer="We-Draft.com · Portal News" />
      )} />
  );
}

// ── Below: what this page is, and where to go next ──
// IN and OUT each get their own copy (the rankings, what's in them, the
// window's dates, the way to the other side); the rest share the overview.
const fmtDay = (d) => (d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "");
function portalWindow() {
  const open = DRAFT_EVENTS.find((e) => e.id === "portal-open");
  const close = DRAFT_EVENTS.find((e) => e.id === "portal-close");
  return open && close ? { opens: parseDay(open.date), closes: parseDay(close.date) } : null;
}
function About({ isMobile, pos = "", side = "", posName = "", posPlural = "", posPerson = "", inCount = 0, outCount = 0 }) {
  const link = { padding: "9px 14px", borderRadius: 999, border: `2px solid ${BLUE}`, color: BLUE, textDecoration: "none", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase" };
  const p = { margin: "10px 0 0", fontSize: 14, lineHeight: 1.7, fontWeight: 600, fontFamily: BODY, color: "#3a4352" };
  const a = { color: BLUE, fontWeight: 800 };
  const win = portalWindow();
  const who = pos ? `${pos}s` : "players";
  const whoLong = pos ? posPlural.toLowerCase() : "players";
  const board = pos ? `/portal/${pos.toLowerCase()}` : "/portal";
  const windowLine = win ? <> The {SEASON} transfer window opens {fmtDay(win.opens)} and closes {fmtDay(win.closes)}.</> : null;
  return (
    <section style={{ marginTop: isMobile ? 30 : 42, background: "#f6f8fb", border: "1px solid #e2e7ef", borderRadius: 16, padding: isMobile ? "18px 16px" : "22px 26px" }}>
      {side === "in" ? (
        <>
          <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 900, color: NAVY, textTransform: "uppercase" }}>The Top {pos ? posPlural : "Players"} in the {SEASON} Transfer Portal</h2>
          <p style={p}>
            These are the {whoLong} in the {SEASON} college football transfer portal who matter most, ranked by We-Draft.com{inCount ? ` (${inCount} so far)` : ""}. Every
            player comes with his {SEASON - 1} season stats, his years of eligibility left, his career path, up to three potential destinations and our prediction for where
            he lands — plus a write-up on why he's worth knowing.{windowLine}
          </p>
          <p style={p}>
            Every {pos ? `${pos} ` : "player "}in the portal — with transfer stars, eligibility and his previous school — is on the{" "}
            <Link to={board} style={a}>live {pos ? `${pos} ` : ""}transfer portal board</Link>. Once a player here commits, he moves to the{" "}
            <Link to={newsPath(pos, "out")} style={a}>top {pos ? `${pos} ` : ""}transfer portal moves</Link>.
          </p>
        </>
      ) : side === "out" ? (
        <>
          <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 900, color: NAVY, textTransform: "uppercase" }}>The Top {pos ? `${posName} ` : ""}Transfer Portal Moves of {SEASON}</h2>
          <p style={p}>
            The biggest {pos ? `${pos} ` : ""}transfer portal commitments of the {SEASON} cycle, ranked by We-Draft.com{outCount ? ` (${outCount} so far)` : ""}: where each
            {pos ? ` ${posPerson.toLowerCase()}` : " player"} landed, his {SEASON - 1} season stats, his updated career path and what his new school is getting.{windowLine}
          </p>
          <p style={p}>
            For the {who} still deciding, see the <Link to={newsPath(pos, "in")} style={a}>top {pos ? `${pos}s` : "players"} in the transfer portal</Link>. Every commitment, as it
            happens, is in the <Link to={UPDATES_PATH} style={a}>latest transfer portal moves</Link>, and each school's incoming class is on its team page in the{" "}
            <Link to="/portal" style={a}>Transfer Portal</Link>.
          </p>
        </>
      ) : (
        <>
          <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 900, color: NAVY, textTransform: "uppercase" }}>How We-Draft.com Covers the Transfer Portal</h2>
          <p style={p}>
            The <Link to="/portal" style={a}>Transfer Portal</Link> tracks every entry and commitment as it happens, with transfer stars and
            eligibility for every player and a page for every FBS team. Portal News is where we slow down on the moves that matter most: the{" "}
            <Link to={newsPath(pos, "in")} style={a}>top {pos ? `${pos}s` : "players"} in the portal</Link>, with where they could land, and the{" "}
            <Link to={newsPath(pos, "out")} style={a}>top {pos ? `${pos} ` : ""}transfer portal moves</Link>, with what each new school is getting.{windowLine}
            {" "}Want to run a program through it yourself? The <Link to="/portalsim" style={a}>Transfer Portal Sim</Link> puts you in charge.
          </p>
        </>
      )}
      <h2 style={{ margin: "18px 0 0", fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", color: "#5a6475", textTransform: "uppercase" }}>More Transfer Portal Coverage</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {side !== "in" && <Link to={newsPath(pos, "in")} style={link}>Top {pos ? `${pos}s` : "Players"} in the Portal →</Link>}
        {side !== "out" && <Link to={newsPath(pos, "out")} style={link}>Top {pos ? `${pos} ` : ""}Portal Moves →</Link>}
        <Link to={board} style={link}>{pos ? `${pos} ` : ""}Transfer Portal →</Link>
        <Link to={UPDATES_PATH} style={link}>Latest Moves →</Link>
        <Link to="/portalsim" style={link}>Portal Sim →</Link>
      </div>
    </section>
  );
}
