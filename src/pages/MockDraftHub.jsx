// src/pages/MockDraftHub.jsx
//
// /mocks — Mock Draft Central. Up top, a masthead (with On the Clock's
// LIVE pill while the nightly broadcast is on, OnTheClockLive.jsx) and the
// three ways in: the Weekly Mock (/mocks/{year}, ViewMock.js
// WeeklyYearPage), the Draft Sim (DraftSim.jsx) and writing a mock
// (CreateMock.jsx). Then the current
// Weekly Mock's first round as a board (its mockDrafts doc — the class's
// summary names it), with every team's page a logo away; the newest public
// Draft Sims (publicSims.js); and the community's mock drafts — hand-built
// and written up by their authors (an intro plus a note on each pick), read
// like a column rather than run like a simulator. Each opens in ViewMock.js.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { fetchNflBranding } from "../utils/draftProfileData";
import {
  loadWeeklyMockSummary, weeklyYearHref, weeklyMockHref, weeklyMockDate, hasTeamPages, WEEKLY_YEARS, MAIN_WEEKLY_YEAR,
} from "../utils/weeklyMockNews";
import { loadRecentSims, RECENT_PATH, COMMUNITY_PATH } from "../utils/draftSim/publicSims";
import { SIM_YEAR } from "../utils/draftSim/years";
import OnTheClockLive from "../components/draftSim/OnTheClockLive";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { textOn } from "../utils/teamColors";
import {
  BLUE, GOLD, INK, MUTED, CARD_SHADOW, BODY_FONT, FONT, MOCK_CARD_CSS,
  useIsMobile, MockPageShell, chip, button, SectionTitle, PhoneAd,
} from "../components/MockDraftKit";

const ACTIVE_YEARS = ["2027", "2028"];
const ARCHIVE_YEARS = ["2026"];
// Phones: the Homage card goes after this many mocks.
const PHONE_AD_AFTER = 3;
// The Weekly Mock board: this many first-round picks until it's opened up.
const BOARD_PREVIEW = 10;
// The Draft Sim strip: this many sims, one a team.
const SIM_CARDS = 4;
const NAVY = "#070d18";
// The team logo grid's hover.
const HUB_CSS = `
  .wd-hub-team { transition: background 0.14s ease; }
  .wd-hub-team:hover { background: #e3ebf6; }
`;

const pickList = (mock) => Object.values(mock.picks || {}).sort((a, b) => a.pickNumber - b.pickNumber);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function MockDraftHub() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mocks, setMocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userMap, setUserMap] = useState({});
  const [teams, setTeams] = useState({});
  const [classFilter, setClassFilter] = useState("2027");
  const [sort, setSort] = useState("latest");
  const [weekly, setWeekly] = useState(undefined);
  const [boardYear, setBoardYear] = useState(MAIN_WEEKLY_YEAR);
  // The Weekly Mocks' own docs, a class at a time: { [year]: mock | null }.
  const [boards, setBoards] = useState({});
  const [sims, setSims] = useState(null);

  useEffect(() => { fetchNflBranding().then(setTeams).catch(() => {}); }, []);
  // Each class's summary, in WEEKLY_YEARS order.
  useEffect(() => { Promise.all(WEEKLY_YEARS.map((y) => loadWeeklyMockSummary(y))).then(setWeekly); }, []);
  useEffect(() => {
    loadRecentSims({ max: 24 }).then(setSims).catch((e) => { console.error("Recent draft sims load error:", e); setSims([]); });
  }, []);

  const weeklyClasses = useMemo(
    () => WEEKLY_YEARS.map((year, i) => ({ year, summary: weekly?.[i] || null })).filter((c) => c.year === MAIN_WEEKLY_YEAR || c.summary),
    [weekly],
  );
  const boardSummary = weeklyClasses.find((c) => c.year === boardYear)?.summary || null;

  // The board's class's mock, once its summary says which.
  useEffect(() => {
    if (weekly === undefined || boardYear in boards) return;
    const id = boardSummary?.mockId;
    if (!id) { setBoards((b) => ({ ...b, [boardYear]: null })); return; }
    getDoc(doc(db, "mockDrafts", id))
      .then((s) => setBoards((b) => ({ ...b, [boardYear]: s.exists() ? { id: s.id, ...s.data() } : null })))
      .catch(() => setBoards((b) => ({ ...b, [boardYear]: null })));
  }, [weekly, boardYear, boardSummary, boards]);

  // Prerender.io's cue (public/index.html): the mocks list, the Weekly
  // Mock summaries and the main class's board in. 8s cap, then a frame for
  // Helmet.
  const settled = !loading && weekly !== undefined && MAIN_WEEKLY_YEAR in boards;
  useEffect(() => {
    window.prerenderReady = false;
    const t = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!settled) return undefined;
    const frame = requestAnimationFrame(() => { window.prerenderReady = true; });
    return () => cancelAnimationFrame(frame);
  }, [settled]);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db, "mockDrafts"), where("visibility", "==", "public"), orderBy("updatedAt", "desc")));
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMocks(rows);
        // Author names: just the listed mocks' authors, not the whole users
        // collection.
        const missing = [...new Set(rows.map((m) => m.ownerId).filter(Boolean))];
        const entries = await Promise.all(missing.map(async (uid) => {
          try {
            const u = await getDoc(doc(db, "users", uid));
            return [uid, u.exists() ? (u.data().username || u.data().email || "") : ""];
          } catch { return [uid, ""]; }
        }));
        setUserMap(Object.fromEntries(entries));
      } catch (err) { console.error("Failed to load mock drafts", err); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  // (A whole-mock-only Weekly Mock's post — 2029's — is unlisted: it's on the Weekly Mock links only.)
  const listed = mocks.filter((m) => !m.unlisted);
  const filtered = useMemo(() => {
    const rows = listed.filter((m) => (m.draftClass || "2026") === classFilter);
    if (sort !== "notes") return rows;
    const notes = (m) => Object.values(m.picks || {}).filter((p) => p.note?.trim()).length;
    return [...rows].sort((a, b) => notes(b) - notes(a));
  }, [listed, classFilter, sort]);
  const isArchive = ARCHIVE_YEARS.includes(classFilter);
  const activeCount = listed.filter((m) => ACTIVE_YEARS.includes(m.draftClass || "2026")).length;
  const mainSummary = weeklyClasses[0]?.summary;
  const description = "Mock Draft Central: We-Draft's weekly 7-round NFL mock draft for all 32 teams, the live Draft Sim, and mock drafts written by the community for the 2027 and 2028 NFL Drafts.";

  return (
    <>
      <Helmet>
        <title>NFL Mock Drafts | We-Draft.com</title>
        <meta name="description" content={description} />
        <meta property="og:title" content="NFL Mock Drafts | We-Draft.com" />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://we-draft.com/mocks" />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="NFL Mock Drafts | We-Draft.com" />
        <meta name="twitter:description" content={description} />
        <link rel="canonical" href="https://we-draft.com/mocks" />
      </Helmet>
      <style>{MOCK_CARD_CSS + HUB_CSS}</style>

      <MockPageShell year={boardYear} isMobile={isMobile}>
        <Masthead
          isMobile={isMobile}
          weeklyDate={weeklyMockDate(mainSummary?.publishedAt, { month: "short", day: "numeric" })}
          weeklyRounds={mainSummary?.rounds}
          communityCount={loading ? null : activeCount}
        />

        <WeeklyBoard
          isMobile={isMobile} teams={teams} classes={weeklyClasses} year={boardYear} onYear={setBoardYear}
          summary={boardSummary} mock={boards[boardYear]}
        />

        <SimStrip sims={sims} teams={teams} isMobile={isMobile} />

        <section id="community">
          <SectionTitle
            isMobile={isMobile}
            right={!loading && <span style={{ fontSize: 12, fontWeight: 800, color: MUTED, fontFamily: BODY_FONT }}>{plural(filtered.length, "mock")}</span>}
          >
            {isArchive ? `${classFilter} Archive` : "Community Mock Drafts"}
          </SectionTitle>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 14 }}>
            {ACTIVE_YEARS.map((y) => (
              <button key={y} onClick={() => setClassFilter(y)} aria-pressed={classFilter === y} style={chip(classFilter === y, isMobile)}>{y} Draft</button>
            ))}
            {ARCHIVE_YEARS.map((y) => (
              <button key={y} onClick={() => setClassFilter(y)} aria-pressed={classFilter === y} style={chip(classFilter === y, isMobile)}>{y} · Archive</button>
            ))}
            <span style={{ flex: 1 }} />
            <Segmented
              isMobile={isMobile} value={sort} onChange={setSort} label="Sort mocks"
              options={[{ value: "latest", label: "Latest" }, { value: "notes", label: "Most written" }]}
            />
          </div>

          {loading ? (
            <LoadingSpinner label="Loading" size={28} minHeight="200px" />
          ) : filtered.length === 0 ? (
            <>
              <div style={{ background: "#fff", borderRadius: 14, boxShadow: CARD_SHADOW, padding: "44px 24px", textAlign: "center" }}>
              <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                No {classFilter} mocks yet
              </div>
              <div style={{ fontSize: 14, color: MUTED, fontFamily: BODY_FONT, marginBottom: 18 }}>
                {isArchive ? "Nothing was published for this class." : `Be the first to publish a ${classFilter} mock draft.`}
              </div>
              {!isArchive && <button onClick={() => navigate("/mocks/create")} style={button("blue", isMobile)}>+ Write the First One</button>}
              </div>
              <div style={{ marginTop: 16 }}><PhoneAd isMobile={isMobile} /></div>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((mock, i) => (
                <Fragment key={mock.id}>
                  <MockCard mock={mock} author={userMap[mock.ownerId] || ""} teams={teams} isMobile={isMobile} />
                  {i === Math.min(PHONE_AD_AFTER, filtered.length) - 1 && <PhoneAd isMobile={isMobile} />}
                </Fragment>
              ))}
            </div>
          )}
        </section>
      </MockPageShell>
    </>
  );
}

// The page's header: the title over the three ways into a mock draft —
// read ours, run the sim, write your own — each a door of its own.
function Masthead({ isMobile, weeklyDate, weeklyRounds, communityCount }) {
  const doors = [
    {
      to: weeklyYearHref(MAIN_WEEKLY_YEAR), kicker: "Read", title: "The Weekly Mock",
      text: `We-Draft's ${weeklyRounds || 7}-round mock for all 32 teams, run fresh every week.`,
      meta: weeklyDate ? `Updated ${weeklyDate}` : "Updated weekly", cta: "Read the mock",
      bg: `linear-gradient(135deg, #00305c 0%, ${BLUE} 100%)`, accent: GOLD,
    },
    {
      to: "/draftsim", kicker: "Run", title: "The Draft Sim", badge: "New",
      text: "Run your team's war room against 31 CPU front offices — trades and a grade at the end.",
      meta: "2027 & 2028 classes", cta: "Start drafting",
      bg: "linear-gradient(135deg, #5c0a17 0%, #c8102e 100%)", accent: "#fff",
    },
    {
      to: "/mocks/create", kicker: "Write", title: "Your Own Mock",
      text: "Make every pick, trade up or down, and write the case for each one.",
      meta: communityCount == null ? "Community mocks" : `${plural(communityCount, "community mock")} published`, cta: "Write a mock",
      bg: "linear-gradient(135deg, #3d2a05 0%, #b8740a 100%)", accent: "#fff",
    },
  ];
  return (
    <header style={{
      position: "relative", overflow: "hidden", borderRadius: 18, marginBottom: 18, padding: isMobile ? "20px 14px 14px" : "30px 28px 24px",
      background: `radial-gradient(700px 260px at 15% -30%, #163a6e 0%, ${NAVY} 70%), ${NAVY}`, boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
    }}>
      {!isMobile && (
        <div aria-hidden="true" style={{
          position: "absolute", top: 6, right: 18, fontSize: 132, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.02em",
          color: "rgba(255,255,255,0.045)", pointerEvents: "none", whiteSpace: "nowrap",
        }}>MOCK</div>
      )}
      <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: isMobile ? 16 : 22 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: GOLD }}>NFL Draft · 2027 & 2028</span>
            {/* On the Clock, while the nightly broadcast is live. */}
            <OnTheClockLive isMobile={isMobile} />
          </div>
          <h1 style={{ margin: "6px 0 8px", fontSize: isMobile ? 30 : 46, fontWeight: 900, color: "#fff", textTransform: "uppercase", lineHeight: 1, letterSpacing: "0.005em" }}>
            Mock Draft Central
          </h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "rgba(255,255,255,0.78)", lineHeight: 1.5, fontFamily: BODY_FONT }}>
            Our weekly mock, a live simulator and the community&apos;s own boards — every pick and the case for it.
          </p>
        </div>
        {!isMobile && <Link to="/mocks/my" style={button("ghost", isMobile)}>My Mocks</Link>}
      </div>
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 8 : 12 }}>
        {doors.map((d) => <Door key={d.to} door={d} isMobile={isMobile} />)}
      </div>
      {isMobile && (
        <Link to="/mocks/my" style={{ position: "relative", display: "block", marginTop: 12, textAlign: "center", color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none" }}>
          My Mocks →
        </Link>
      )}
    </header>
  );
}

function Door({ door, isMobile }) {
  return (
    <Link to={door.to} className="wd-mock-card" style={{
      position: "relative", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, textDecoration: "none", color: "#fff",
      borderRadius: 14, padding: isMobile ? "12px 14px" : "16px 18px", background: door.bg, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: door.accent, opacity: 0.9 }}>{door.kicker}</span>
        {door.badge && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", background: "rgba(0,0,0,0.3)", borderRadius: 999, padding: "2px 7px" }}>
            {door.badge}
          </span>
        )}
      </span>
      <span style={{ fontSize: isMobile ? 19 : 22, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05 }}>{door.title}</span>
      {!isMobile && <span style={{ fontSize: 13, lineHeight: 1.45, fontFamily: BODY_FONT, color: "rgba(255,255,255,0.85)", flex: 1 }}>{door.text}</span>}
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: isMobile ? 0 : 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: BODY_FONT, color: "rgba(255,255,255,0.7)" }}>{door.meta}</span>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", color: door.accent, whiteSpace: "nowrap" }}>{door.cta} →</span>
      </span>
    </Link>
  );
}

// The current Weekly Mock's first round, a tile a pick (to that team's
// page in the mock, for a class with team pages), the first BOARD_PREVIEW
// until it's opened up; then every team's logo, to its page. classes: the
// published ones (WEEKLY_YEARS order) — a switch when there's more than one.
function WeeklyBoard({ isMobile, teams, classes, year, onYear, summary, mock }) {
  const [open, setOpen] = useState(false);
  const firstRound = useMemo(() => (mock ? pickList(mock).filter((p) => (p.round || 1) === 1) : []), [mock]);
  const shown = open ? firstRound : firstRound.slice(0, BOARD_PREVIEW);
  const date = weeklyMockDate(summary?.publishedAt);
  const teamPages = hasTeamPages(year);
  const allTeams = useMemo(() => [...NFL_TEAM_ABBRS].sort((a, b) => (NFL_TEAMS[a] || a).localeCompare(NFL_TEAMS[b] || b)), []);

  return (
    <section style={{ background: "#fff", borderRadius: 16, boxShadow: CARD_SHADOW, overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: isMobile ? "12px 12px" : "16px 20px", borderBottom: "1px solid #edf0f5" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "#b8740a" }}>
            We-Draft Weekly Mock{date ? ` · ${date}` : ""}
          </div>
          <h2 style={{ margin: "3px 0 0", fontSize: isMobile ? 18 : 22, fontWeight: 900, color: INK, textTransform: "uppercase", lineHeight: 1.1 }}>
            {year} First Round
          </h2>
        </div>
        {classes.length > 1 && (
          <Segmented
            isMobile={isMobile} value={year} label="Weekly Mock class"
            onChange={(y) => { onYear(y); setOpen(false); }}
            options={classes.map((c) => ({ value: c.year, label: `${c.year}${c.summary?.rounds ? ` · ${c.summary.rounds}R` : ""}` }))}
          />
        )}
      </div>

      <div style={{ padding: isMobile ? 10 : 16 }}>
        {mock === undefined ? (
          <LoadingSpinner label="Loading" size={28} minHeight="180px" />
        ) : !firstRound.length ? (
          <div style={{ padding: "30px 10px", textAlign: "center", fontFamily: BODY_FONT, color: MUTED, fontWeight: 700 }}>
            The first {year} Weekly Mock isn&apos;t out yet.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 6 : 8 }}>
              {shown.map((p) => <BoardPick key={p.pickNumber} pick={p} brand={teams[p.currentTeam] || {}} year={year} teamPages={teamPages} isMobile={isMobile} />)}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
              {firstRound.length > BOARD_PREVIEW ? (
                <button onClick={() => setOpen((o) => !o)} style={{ ...button("outline", isMobile), ...(isMobile ? { flex: "1 1 100%", justifyContent: "center" } : {}) }}>
                  {open ? "Show fewer ▴" : `Show all ${firstRound.length} picks ▾`}
                </button>
              ) : <span />}
              <Link to={weeklyYearHref(year)} style={{ ...button("blue", isMobile), ...(isMobile ? { flex: "1 1 100%", justifyContent: "center" } : {}) }}>
                Full {summary?.rounds || mock?.rounds || 7}-round mock →
              </Link>
            </div>
          </>
        )}
      </div>

      {teamPages && (
        <div style={{ padding: isMobile ? "10px 10px 12px" : "12px 16px 16px", background: "#f7f9fc", borderTop: "1px solid #edf0f5" }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7a8597", margin: "0 0 8px 2px" }}>
            Every team&apos;s {year} mock draft
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 8 : 16}, 1fr)`, gap: 2 }}>
            {allTeams.map((t) => {
              const b = teams[t] || {};
              return (
                <Link key={t} to={weeklyMockHref(t, year)} title={`${NFL_TEAMS[t] || t} ${year} mock draft`} className="wd-hub-team" style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "5px 0", borderRadius: 8, textDecoration: "none",
                }}>
                  {b.Logo1 ? <img src={b.Logo1} alt="" style={{ width: isMobile ? 26 : 30, height: isMobile ? 26 : 30, objectFit: "contain" }} /> : <span style={{ height: isMobile ? 26 : 30 }} />}
                  <span style={{ fontSize: 9, fontWeight: 900, color: MUTED }}>{t}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// One pick on the board: the number on the team's colors, its logo, the
// player and his position and school.
function BoardPick({ pick, brand, year, teamPages, isMobile }) {
  const player = pick.selection;
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || GOLD;
  const teamName = brand.Team || NFL_TEAMS[pick.currentTeam] || pick.currentTeam;
  const to = teamPages ? weeklyMockHref(pick.currentTeam, year) : player?.Slug ? `/player/${player.Slug}` : weeklyYearHref(year);
  return (
    <Link to={to} className="wd-mock-card" title={`${teamName}: ${player ? `${player.First} ${player.Last}` : "No selection"}`} style={{
      display: "flex", alignItems: "stretch", minWidth: 0, overflow: "hidden", textDecoration: "none", borderRadius: 10, background: "#fff",
      boxShadow: "0 0 0 1px #e6ebf2",
    }}>
      <span style={{
        flexShrink: 0, width: isMobile ? 40 : 46, display: "flex", alignItems: "center", justifyContent: "center",
        background: c1, color: textOn(c1, c2), borderRight: `3px solid ${c2}`,
        fontSize: isMobile ? 17 : 19, fontWeight: 900, fontVariantNumeric: "tabular-nums",
      }}>{pick.pickNumber}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "7px 10px" : "8px 12px" }}>
        {brand.Logo1
          ? <img src={brand.Logo1} alt="" style={{ width: isMobile ? 30 : 34, height: isMobile ? 30 : 34, objectFit: "contain", flexShrink: 0 }} />
          : <span style={{ width: isMobile ? 30 : 34, flexShrink: 0 }} />}
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          {player ? (
            <>
              <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 900, color: INK, textTransform: "uppercase", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {player.First} {player.Last}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[player.Position, player.School].filter(Boolean).join(" · ")}
                {pick.tradedFrom ? <span style={{ color: "#8a5a00" }}> · via {pick.tradedFrom}</span> : null}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 800, color: "#b0b8c4", fontStyle: "italic" }}>No selection</span>
          )}
        </span>
      </span>
    </Link>
  );
}

// The newest public Draft Sims, one a team: its colors and grade, its first
// picks, and a link to draft as that team.
function SimStrip({ sims, teams, isMobile }) {
  const cols = isMobile ? 2 : SIM_CARDS;
  const cards = useMemo(() => {
    const seen = new Set();
    return (sims || []).filter((s) => s.team && (s.picks || []).length && !seen.has(s.team) && seen.add(s.team)).slice(0, cols);
  }, [sims, cols]);

  return (
    <section style={{ borderRadius: 16, marginBottom: 22, padding: isMobile ? "14px 10px" : "18px 20px", background: NAVY, boxShadow: "0 10px 28px rgba(0,0,0,0.2)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 12, padding: "0 2px" }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD }}>Draft Sim</div>
          <h2 style={{ margin: "3px 0 0", fontSize: isMobile ? 18 : 22, fontWeight: 900, color: "#fff", textTransform: "uppercase", lineHeight: 1.1 }}>Fresh off the clock</h2>
        </div>
        <span style={{ display: "flex", gap: 14, fontSize: 12, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          <Link to={COMMUNITY_PATH} style={{ color: "#c9d4e5", textDecoration: "none" }}>Community trends</Link>
          <Link to={RECENT_PATH} style={{ color: GOLD, textDecoration: "none" }}>All recent drafts →</Link>
        </span>
      </div>
      {!sims ? (
        <div style={{ minHeight: 150 }} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: isMobile ? 8 : 10 }}>
          {cards.map((s) => <SimCard key={s.id} sim={s} brand={teams[s.team] || {}} isMobile={isMobile} />)}
          {/* Fewer sims than slots: the rest is a way in. */}
          {cards.length < cols && (
            <Link to="/draftsim" className="wd-mock-card" style={{
              gridColumn: `span ${cols - cards.length}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
              minHeight: 120, borderRadius: 12, border: "2px dashed #2a3a58", textDecoration: "none", textAlign: "center", padding: 12,
            }}>
              <span style={{ fontSize: isMobile ? 14 : 17, fontWeight: 900, color: "#fff", textTransform: "uppercase", lineHeight: 1.15 }}>Your draft could be here</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#8b9bb4", fontFamily: BODY_FONT }}>Finish a one-team sim and save it to post your grade.</span>
              <span style={{ ...button("gold", isMobile), marginTop: 2 }}>Run the sim →</span>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

const gradeColor = (l = "") => (l.startsWith("A") ? "#3fb950" : l.startsWith("B") ? "#58a6ff" : l.startsWith("C") ? GOLD : "#f85149");

function SimCard({ sim, brand, isMobile }) {
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || GOLD;
  const ink = textOn(c1, c2);
  const nick = brand.Team || NFL_TEAMS[sim.team] || sim.team;
  const year = String(sim.year || SIM_YEAR);
  const to = `/draftsim${year !== SIM_YEAR ? `/${year}` : ""}/${sim.team.toLowerCase()}`;
  const picks = (sim.picks || []).slice(0, isMobile ? 2 : 3);
  return (
    <Link to={to} className="wd-mock-card" style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRadius: 12, overflow: "hidden", textDecoration: "none", border: `1px solid ${c2}55`, background: "#0e1626" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, padding: isMobile ? "7px 8px" : "8px 10px", background: `linear-gradient(120deg, ${c1} 0%, ${c1} 65%, ${c2} 140%)`, color: ink }}>
        {(brand.LogoDark || brand.Logo1) && <img src={brand.LogoDark || brand.Logo1} alt="" style={{ width: isMobile ? 22 : 26, height: isMobile ? 22 : 26, objectFit: "contain", flexShrink: 0 }} />}
        <span style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 12 : 13, fontWeight: 900, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{year} {nick}</span>
        {sim.grade && <span style={{ background: "rgba(0,0,0,0.32)", color: "#fff", borderRadius: 7, padding: "1px 8px", fontSize: isMobile ? 15 : 17, fontWeight: 900 }}>{sim.grade}</span>}
      </span>
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, padding: isMobile ? "6px 8px" : "8px 10px" }}>
        {picks.map((p) => (
          <span key={p.overall} style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, fontSize: 12 }}>
            <span style={{ flexShrink: 0, width: 26, color: "#6f7f99", fontWeight: 900, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{p.overall}</span>
            <span style={{ flex: 1, minWidth: 0, color: "#fff", fontWeight: 900, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {p.last}<span style={{ color: "#8b9bb4", fontFamily: BODY_FONT, fontWeight: 700, textTransform: "none" }}> {p.pos}</span>
            </span>
            {p.grade && <span style={{ flexShrink: 0, fontWeight: 900, color: gradeColor(p.grade) }}>{p.grade}</span>}
          </span>
        ))}
      </span>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 6, padding: isMobile ? "6px 8px" : "7px 10px", borderTop: "1px solid #1f2b42", fontSize: 10, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        <span style={{ color: "#8b9bb4", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: BODY_FONT, textTransform: "none", fontWeight: 700 }}>{sim.username ? `by ${sim.username}` : ""}</span>
        <span style={{ color: GOLD, whiteSpace: "nowrap" }}>Draft →</span>
      </span>
    </Link>
  );
}

// A small segmented switch on white: options [{ value, label }].
function Segmented({ options, value, onChange, label, isMobile }) {
  return (
    <div role="group" aria-label={label} style={{ display: "inline-flex", padding: 3, gap: 2, borderRadius: 999, background: "#eef2f7" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={on} style={{
            border: "none", borderRadius: 999, padding: isMobile ? "5px 11px" : "6px 14px", cursor: "pointer", fontFamily: FONT, fontWeight: 900,
            fontSize: isMobile ? 11 : 12, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap",
            background: on ? "#fff" : "transparent", color: on ? BLUE : "#5f6b7a", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// One mock: its No. 1 pick in the leading team's colors, then the title,
// byline, the start of the intro and the top of its board.
function MockCard({ mock, author, teams, isMobile }) {
  const picks = pickList(mock);
  const first = picks.find((p) => p.selection) || picks[0];
  const brand = (first && teams[first.currentTeam]) || {};
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || GOLD;
  const made = picks.filter((p) => p.selection).length;
  const notes = picks.filter((p) => p.note?.trim()).length;
  const rounds = mock.rounds || 1;
  const date = mock.updatedAt?.toDate?.()?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const leadW = isMobile ? 76 : 120;
  const top = picks.filter((p) => p.selection).slice(1, isMobile ? 3 : 5);

  return (
    <Link
      to={`/mocks/${mock.id}/view`} className="wd-mock-card"
      style={{ display: "flex", alignItems: "stretch", overflow: "hidden", textDecoration: "none", borderRadius: 14, background: "#fff", boxShadow: CARD_SHADOW, minHeight: isMobile ? 96 : 112 }}
    >
      <span style={{
        position: "relative", flexShrink: 0, width: leadW, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
        background: `linear-gradient(160deg, ${c1} 0%, ${c1} 70%, ${c2} 100%)`, borderRight: `4px solid ${c2}`, padding: "8px 4px",
      }}>
        {brand.LogoDark || brand.Logo1
          ? <img src={brand.LogoDark || brand.Logo1} alt="" style={{ width: isMobile ? 40 : 56, height: isMobile ? 40 : 56, objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" }} />
          : <span style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>{first?.currentTeam || "—"}</span>}
        {first?.selection && (
          <span style={{ fontSize: isMobile ? 9 : 10, fontWeight: 900, color: "#fff", textAlign: "center", lineHeight: 1.15, letterSpacing: "0.03em", textTransform: "uppercase", textShadow: "0 1px 3px rgba(0,0,0,0.35)" }}>
            No. {first.pickNumber} · {first.selection.Last}
          </span>
        )}
      </span>

      <span style={{ flex: 1, minWidth: 0, padding: isMobile ? "10px 12px" : "14px 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
        <span style={{ fontSize: isMobile ? 16 : 21, fontWeight: 900, color: INK, textTransform: "uppercase", lineHeight: 1.1, letterSpacing: "0.01em", overflowWrap: "anywhere" }}>
          {mock.name || "Untitled Mock Draft"}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, fontFamily: BODY_FONT }}>
          {author && <>By <strong style={{ color: BLUE }}>{author}</strong></>}
          {author && date && " · "}
          {date}
        </span>
        {mock.description?.trim() && (
          <span style={{
            fontSize: 13, color: "#3a4352", fontFamily: BODY_FONT, lineHeight: 1.45,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {mock.description}
          </span>
        )}
        {top.length > 0 && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 8 : 12, marginTop: 2 }}>
            {top.map((p) => {
              const b = teams[p.currentTeam] || {};
              return (
                <span key={p.pickNumber} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 900, color: "#3a4352", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  <span style={{ color: "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{p.pickNumber}</span>
                  {b.Logo1 && <img src={b.Logo1} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} />}
                  {p.selection.Last}
                </span>
              );
            })}
          </span>
        )}
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          <Tag>{plural(rounds, "Round")}</Tag>
          <Tag>{plural(made, "Pick")}</Tag>
          {notes > 0 && <Tag gold>{plural(notes, "Note")}</Tag>}
        </span>
      </span>
    </Link>
  );
}

function Tag({ gold, children }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", borderRadius: 999, padding: "3px 9px",
      background: gold ? "#fff1d6" : "#eef3fa", color: gold ? "#8a5a00" : BLUE, border: `1px solid ${gold ? "#f6c56b" : "#d8e3f2"}`,
    }}>
      {children}
    </span>
  );
}
