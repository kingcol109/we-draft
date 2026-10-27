// src/pages/WeeklyTeamMock.jsx
//
// /mocks/{team} (/mocks/nyj) — one team's picks in the site's official
// Weekly Mock (utils/draftSim/weeklyMock.js; published from Admin → Mock
// Draft → Weekly Mock). Each pick shows, underneath, what the same pick —
// its original team and round, since the number moves with the order —
// was in the week before, with last week's number. Then the trades the team
// made. The header reads like an article's (MockDraftKit's ArticleHero), with the sim under it
// for anyone who'd draft it differently; the left rail (phones: the bottom)
// goes to every other team's page. Each pick is the mock card without the
// team name — the player's college logo instead, and a View more link to
// his page. Each class with a Weekly Mock has its own page — 2027's at
// /mocks/{team}, the next class's at /mocks/{team}/2028 (`year`) — with a
// switch between them in the header. Reads: the class's summary (config,
// cached — it names this week's and last week's weeklyMocks docs), those
// two docs, and the other classes' summaries for the switch (a player the
// editor swapped in, with no saved logo, costs his position's class snapshot).
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import { fetchNflBranding } from "../utils/draftProfileData";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { teamWeek, teamChanges } from "../utils/draftSim/weeklyMock";
import {
  weeklyMockDate, weeklyMockHref, weeklyYearHref, loadWeeklyMockSummary, carriedTradeOf, carriedTradeText, WEEKLY_YEARS, MAIN_WEEKLY_YEAR,
} from "../utils/weeklyMockNews";
import { WEEKLY_ROUNDS_BY_YEAR } from "../utils/draftSim/weeklyMock";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { textOn } from "../utils/teamColors";
import { PickRow } from "./ViewMock";
import {
  BLUE, CARD_SHADOW, BODY_FONT, MOCK_CARD_CSS, useIsMobile, MockPageShell, ArticleHero, WeeklyByline, MakeYourOwnBanner,
  Breadcrumbs, breadcrumbLd, SITE_PUBLISHER, TeamMocksRail, WeeklyYearSwitch,
} from "../components/MockDraftKit";

const playerText = (p) => (p ? `${p.First} ${p.Last}, ${[p.Position, p.School].filter(Boolean).join(", ")}` : "no selection");
// A team whose header looks better off its branding colors: { c1, c2 (the
// background), ink (text), accent (date badge, kicker, bottom edge),
// lightWordmark (the other wordmark — Wordmark, not WordmarkDark) }.
const HERO_LOOKS = {
  PIT: { c1: "#101820", c2: "#101820", ink: "#ffffff", accent: "#FFB612" },
};
const NUMBER_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven" };

// A class's latest two published weeks, newest first: by the ids its
// summary names, or — a summary from before it named them — every week of
// the class (no composite index needed), sorted here.
async function loadWeeks(year) {
  const summary = await loadWeeklyMockSummary(year);
  if (summary?.weekId) {
    const ids = [summary.weekId, summary.prevWeekId].filter(Boolean);
    const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, "weeklyMocks", id))));
    return snaps.filter((s) => s.exists() && s.data().publishedAt).map((s) => ({ id: s.id, ...s.data() }));
  }
  const snap = await getDocs(query(collection(db, "weeklyMocks"), where("year", "==", String(year))));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((w) => w.publishedAt)
    .sort((a, b) => b.publishedAt.toMillis() - a.publishedAt.toMillis()).slice(0, 2);
}

export default function WeeklyTeamMock({ team, year = MAIN_WEEKLY_YEAR }) {
  const isMobile = useIsMobile();
  const [weeks, setWeeks] = useState(null);
  const [teams, setTeams] = useState(null);
  // Which classes have a published Weekly Mock, for the switch: { [year]: bool }.
  const [classes, setClasses] = useState(null);

  useEffect(() => { fetchNflBranding().then(setTeams).catch(() => setTeams({})); }, []);
  useEffect(() => {
    loadWeeks(year).then(setWeeks).catch((e) => { console.error(e); setWeeks([]); });
  }, [year]);
  useEffect(() => {
    Promise.all(WEEKLY_YEARS.map((y) => loadWeeklyMockSummary(y))).then((all) => setClasses(Object.fromEntries(WEEKLY_YEARS.map((y, i) => [y, !!all[i]]))));
  }, []);
  // College logos the picks don't carry, from their positions' class snapshots.
  const [logos, setLogos] = useState({});
  useEffect(() => {
    const missing = (weeks?.[0]?.picks || []).filter((p) => p.owner === team && p.player && !p.player.logo).map((p) => p.player);
    if (!missing.length) return undefined;
    let live = true;
    const year = weeks[0].year;
    Promise.all([...new Set(missing.map((p) => p.Position))].map((pos) => getSiteSnapshot(`class_${year}_${pos}`).catch(() => null))).then((docs) => {
      if (!live) return;
      const map = {};
      docs.forEach((d) => {
        (d?.rows || []).forEach((r) => { if (r.lg) map[r.i] = r.lg; });
        Object.entries(d?.hidden || {}).forEach(([id, h]) => { if (h.lg) map[id] = h.lg; });
      });
      setLogos(map);
    });
    return () => { live = false; };
  }, [weeks, team]);

  // Prerender.io (public/index.html, middleware.js) snapshots the page for
  // crawlers once prerenderReady is true: here when the weeks and team
  // branding are in (the whole page — every round, note and link — renders
  // from those), or straight away for a code that isn't a team. The same
  // 8s cap every page has, and one frame for Helmet to write the head.
  const validTeam = NFL_TEAM_ABBRS.includes(team);
  const settled = !validTeam || (weeks !== null && teams !== null && classes !== null);
  useEffect(() => {
    window.prerenderReady = false;
    const t = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(t);
  }, [team, year]);
  useEffect(() => {
    if (!settled) return undefined;
    const frame = requestAnimationFrame(() => { window.prerenderReady = true; });
    return () => cancelAnimationFrame(frame);
  }, [settled]);

  // Not a team: a real 404 for crawlers (Prerender.io returns this status).
  if (!validTeam) return (
    <div style={{ maxWidth: 600, margin: "80px auto", padding: "0 20px", textAlign: "center", fontFamily: BODY_FONT }}>
      <Helmet>
        <title>Mock Draft Not Found | We-Draft</title>
        <meta name="robots" content="noindex, follow" />
        <meta name="prerender-status-code" content="404" />
      </Helmet>
      <div style={{ fontWeight: 900, fontSize: 18, color: BLUE, marginBottom: 16 }}>Mock draft not found.</div>
      <Link to="/mocks" style={{ color: BLUE, fontWeight: 800 }}>← All Mocks</Link>
    </div>
  );
  const brand = teams?.[team] || {};
  const teamName = brand.Team ? `${brand.City || ""} ${brand.Team}`.trim() : NFL_TEAMS[team] || team;
  // The header in the team's colors; its logo goes to the team's page.
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || c1;
  const look = HERO_LOOKS[team] || {};
  const heroTeam = {
    c1, c2, ink: textOn(c1, c2), logo: brand.LogoDark || brand.Logo1 || "", href: `/nfl/${team.toLowerCase()}`, logoTitle: `${teamName} team page`,
    wordmark: (look.lightWordmark ? brand.Wordmark || brand.WordmarkDark : brand.WordmarkDark || brand.Wordmark) || "",
    ...look,
  };
  const nick = (abbr) => teams?.[abbr]?.Team || (NFL_TEAMS[abbr] || abbr).split(" ").pop();
  if (!settled) return <LoadingSpinner label="Loading" size={56} minHeight="calc(60vh / var(--pz, 1))" />;

  // The class is the route's (`year`) — the published week's own class, not the calendar year.
  const [latest, previous] = weeks;
  const nextClass = year !== MAIN_WEEKLY_YEAR;
  const { picks, trades } = teamWeek(latest, previous, team);
  const changes = latest ? teamChanges(latest, previous, team) : null;
  // "2027 Round 1 (No. 9)", "2028 Round 2", with the original team when it isn't either side's own.
  const pickText = (p, side) => `${p.year} Round ${p.round}${p.overall ? ` (No. ${p.overall})` : ""}${p.original !== side ? ` — originally the ${nick(p.original)}'` : ""}`;
  const rounds = [...new Set(picks.map((p) => p.round))];
  // The H1 — "Miami Dolphins 7-Round Mock Draft 2027" (also the In The News
  // title, utils/weeklyMockNews.js) — the <title>, the meta description,
  // and the intro under the H1. Every NFL nickname is a plural, so "the
  // Dolphins'" reads right for all 32. Last week only comes up when there
  // is one to compare against.
  const roundsCount = latest?.rounds || WEEKLY_ROUNDS_BY_YEAR[year] || 7;
  const roundsWord = NUMBER_WORDS[roundsCount] || String(roundsCount);
  const plural = roundsCount === 1 ? "" : "s";
  const headline = `${teamName} ${roundsCount}-Round Mock Draft ${year}`;
  const title = `${teamName} ${year} NFL Mock Draft: ${roundsCount} Round${plural} | We-Draft`;
  const description = `Explore the latest ${teamName} ${year} NFL Mock Draft: ${roundsWord} round${plural} of projected picks, prospect evaluations and how each pick fits the ${nick(team)}' needs. Updated weekly.`;
  // The next class's is drafted after our 2027 mock — say so, it's why its needs look the way they do.
  const intro = nextClass
    ? `Explore We-Draft's latest ${teamName} ${year} NFL Mock Draft, with ${roundsWord} round${plural} of projected picks, prospect evaluations, team needs and how each selection fits the ${nick(team)}' roster — a year on from the picks they make in our ${MAIN_WEEKLY_YEAR} mock draft.${previous ? " See what's changed from last week." : ""}`
    : `Explore We-Draft's latest ${teamName} ${year} NFL Mock Draft, with ${roundsWord} round${plural} of projected picks, prospect evaluations, team needs and how each selection fits the ${nick(team)}' roster.${previous ? " See what's changed from last week." : ""}`;
  // The whole draft, linked under the team list.
  const fullMock = latest ? { href: weeklyYearHref(year), label: `Full ${roundsCount}-round ${year} mock draft` } : null;
  const path = weeklyMockHref(team, year);
  const url = `https://we-draft.com${path}`;
  const crumbs = [
    { name: "Home", href: "/" }, { name: "Mock Drafts", href: "/mocks" },
    ...(nextClass ? [{ name: `${teamName} Mock Draft`, href: weeklyMockHref(team) }] : []),
    { name: nextClass ? `${year} Mock Draft` : `${teamName} Mock Draft`, href: path },
  ];
  // The switch between classes: each one that's been published, this one marked.
  const switchYears = WEEKLY_YEARS.filter((y) => y === year || classes?.[y]);
  const switcher = switchYears.length > 1 && (
    <WeeklyYearSwitch years={switchYears} current={year} hrefOf={(y) => weeklyMockHref(team, y)} ink={heroTeam.ink} bg={c1} isMobile={isMobile} />
  );
  // This class's picks a trade in the main class's mock moved — the team's
  // own (got) and the ones it sent away (gave): [{ round, original, from, to }].
  const carried = latest?.carriedTrades || [];
  const carriedGot = carried.filter((c) => c.to === team);
  const carriedGave = carried.filter((c) => c.from === team);
  // The edition's publish time, machine-readable (ISO 8601, UTC) and as shown.
  const publishedIso = latest?.publishedAt?.toDate?.()?.toISOString() || "";
  const updated = weeklyMockDate(latest?.publishedAt);
  // What this pick was last week — or that it's new to the mock.
  const subOf = (p) => {
    if (!previous) return null;
    if (!p.prev) return "New pick this week";
    const theirs = p.prev.owner !== team ? ` (the ${nick(p.prev.owner)}' pick)` : "";
    return `Last week: No. ${p.prev.overall}${theirs} — ${playerText(p.prev.player)}`;
  };

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        {!latest && <meta name="robots" content="noindex, follow" />}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {publishedIso && <meta property="article:modified_time" content={publishedIso} />}
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org", "@type": "WebPage", url, name: headline, description,
          ...(publishedIso ? { dateModified: publishedIso } : {}), inLanguage: "en-US",
          isPartOf: { "@type": "WebSite", name: "We-Draft", url: "https://we-draft.com" }, publisher: SITE_PUBLISHER,
          ...(brand.Logo1 ? { primaryImageOfPage: { "@type": "ImageObject", url: brand.Logo1 } } : {}),
        })}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbLd(crumbs))}</script>
      </Helmet>
      <style>{MOCK_CARD_CSS}</style>

      <MockPageShell year={year} isMobile={isMobile} leftRail={<TeamMocksRail current={team} year={year} teams={teams || {}} full={fullMock} />}>
        <Breadcrumbs items={crumbs} />
        <ArticleHero hero={heroTeam} isMobile={isMobile} kicker={`Weekly Mock Draft · ${year}`}
          headline={headline} dek={intro} date={updated ? <time dateTime={publishedIso}>Updated {updated}</time> : ""}
          byline={latest && <WeeklyByline />} actions={switcher} />

        {/* The sim, as this team and class, for anyone who'd draft it differently. */}
        <MakeYourOwnBanner team={team} year={year} teamName={teamName} nick={nick(team)} c1={heroTeam.c1} c2={heroTeam.c2} ink={heroTeam.ink} isMobile={isMobile} />

        {!latest ? (
          <div style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: 24, textAlign: "center", fontFamily: BODY_FONT, color: "#2a313d" }}>
            The first {year} weekly mock draft isn&apos;t out yet. <Link to="/mocks" style={{ color: BLUE, fontWeight: 800 }}>See all mock drafts →</Link>
          </div>
        ) : (
          <>
            {!picks.length && (
              <div style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: 20, marginBottom: 12, fontFamily: BODY_FONT, color: "#2a313d" }}>
                The {nick(team)} don&apos;t make a pick in this week&apos;s mock.
              </div>
            )}
            {changes && <WhatChanged changes={changes} isMobile={isMobile} />}
            {rounds.map((r) => (
              <Fragment key={r}>
                <h2 style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.14em", textTransform: "uppercase", margin: "14px 0 8px" }}>Round {r}</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {picks.filter((p) => p.round === r).map((p) => (
                    <PickRow key={p.slot} isMobile={isMobile} brand={brand} sub={subOf(p)} teamPage collegeLogo={p.player?.logo || logos[p.player?.id] || ""}
                      tradeNote={carriedTradeText(carriedTradeOf(carried, p), nick)}
                      pick={{ pickNumber: p.overall, round: p.round, currentTeam: p.owner, tradedFrom: p.original !== p.owner ? p.original : null, selection: p.player, note: p.note || "" }} />
                  ))}
                </div>
              </Fragment>
            ))}
            {/* This class's picks the main class's mock traded, to the team and away. */}
            {(carriedGot.length > 0 || carriedGave.length > 0) && (
              <div style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: isMobile ? "12px 14px" : "16px 20px", marginTop: 18, fontFamily: BODY_FONT, fontSize: 14, color: "#2a313d", lineHeight: 1.55 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
                  {year} picks traded in our {MAIN_WEEKLY_YEAR} mock draft
                </div>
                {carriedGot.map((c, i) => (
                  <div key={`got-${i}`} style={{ marginTop: i ? 6 : 0 }}>
                    Got {c.original === c.from ? "their" : `the ${nick(c.original)}'`} {year} Round {c.round} pick from the {nick(c.from)}.
                  </div>
                ))}
                {carriedGave.map((c, i) => (
                  <div key={`gave-${i}`} style={{ marginTop: i || carriedGot.length ? 6 : 0 }}>
                    Sent {c.original === team ? "their own" : `the ${nick(c.original)}'`} {year} Round {c.round} pick to the {nick(c.to)}.
                  </div>
                ))}
              </div>
            )}
            {/* The deals this team made — just the picks that changed hands. */}
            {trades.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: isMobile ? "12px 14px" : "16px 20px", marginTop: 18, fontFamily: BODY_FONT, fontSize: 14, color: "#2a313d", lineHeight: 1.55 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
                  Trade{trades.length === 1 ? "" : "s"}
                </div>
                {trades.map((t, i) => (
                  <div key={i} style={{ marginTop: i ? 10 : 0 }}>
                    <strong>{t.at ? `${t.up ? "Traded up to" : "Traded down from"} No. ${t.at}` : "Trade"} with the {nick(t.with)}.</strong>
                    {" "}Got {t.got.map((p) => pickText(p, t.with)).join(", ")}; sent {t.gave.map((p) => pickText(p, team)).join(", ")}.
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {/* Phones have no side rail: every team's mock, at the bottom. */}
        {isMobile && <div style={{ marginTop: 22 }}><TeamMocksRail current={team} year={year} teams={teams || {}} full={fullMock} columns={8} /></div>}
      </MockPageShell>
    </>
  );
}

// "What changed this week?" — teamChanges' facts, a line each: who's new
// to the team's picks and who's gone, who moved rounds, and the positions
// it took more or fewer of. Nothing at all when nothing did.
function WhatChanged({ changes, isMobile }) {
  const name = (p) => (p.Slug
    ? <Link to={`/player/${p.Slug}`} style={{ color: BLUE, fontWeight: 800 }}>{p.First} {p.Last}</Link>
    : <strong>{p.First} {p.Last}</strong>);
  const join = (items) => items.map((x, i) => <Fragment key={i}>{i ? (i === items.length - 1 ? " and " : ", ") : ""}{x}</Fragment>);
  const lines = [
    changes.added.length > 0 && <>New this week: {join(changes.added.map((a) => <>{name(a.player)} ({a.player.Position}, Round {a.round})</>))}.</>,
    changes.dropped.length > 0 && <>No longer projected here: {join(changes.dropped.map((d) => <>{name(d.player)} ({d.player.Position}, Round {d.round} last week)</>))}.</>,
    changes.moved.length > 0 && <>Moved: {join(changes.moved.map((m) => <>{name(m.player)} from Round {m.from} to Round {m.to}</>))}.</>,
    changes.positions.length > 0 && <>By position: {join(changes.positions.map((p) => `${p.pos} ${p.was} → ${p.now}`))}.</>,
  ].filter(Boolean);
  if (!lines.length) return null;
  return (
    <section style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: isMobile ? "12px 14px" : "16px 20px", marginBottom: 6, fontFamily: BODY_FONT, fontSize: 14, color: "#2a313d", lineHeight: 1.55 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.14em", textTransform: "uppercase" }}>What changed this week?</h2>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {lines.map((l, i) => <li key={i} style={{ marginTop: i ? 4 : 0 }}>{l}</li>)}
      </ul>
    </section>
  );
}
