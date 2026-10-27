// src/pages/MockDraftHub.jsx
//
// /mocks — the public mock drafts: hand-built and written up by their
// authors (an intro plus a note on each pick), read like a column rather
// than run like a simulator. Anyone signed in can write one (CreateMock.jsx);
// each opens in ViewMock.js. Above them, a link to each class's Weekly Mock
// (/mocks/2027, /mocks/2028 once it's published), which links on to every
// team's page.
import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { fetchNflBranding } from "../utils/draftProfileData";
import { loadWeeklyMockSummary, weeklyYearHref, WEEKLY_YEARS, MAIN_WEEKLY_YEAR } from "../utils/weeklyMockNews";
import {
  BLUE, GOLD, INK, MUTED, CARD_SHADOW, BODY_FONT, MOCK_CARD_CSS,
  useIsMobile, MockPageShell, MockHero, heroText, chip, button, SectionTitle, PhoneAd,
} from "../components/MockDraftKit";

const ACTIVE_YEARS = ["2027", "2028"];
const ARCHIVE_YEARS = ["2026"];
// Phones: the Homage card goes after this many mocks.
const PHONE_AD_AFTER = 3;

const pickList = (mock) => Object.values(mock.picks || {}).sort((a, b) => a.pickNumber - b.pickNumber);

export default function MockDraftHub() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mocks, setMocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userMap, setUserMap] = useState({});
  const [teams, setTeams] = useState({});
  const [classFilter, setClassFilter] = useState("2027");
  const [weekly, setWeekly] = useState(undefined);

  useEffect(() => { fetchNflBranding().then(setTeams).catch(() => {}); }, []);
  // Each class's summary, in WEEKLY_YEARS order.
  useEffect(() => { Promise.all(WEEKLY_YEARS.map((y) => loadWeeklyMockSummary(y))).then(setWeekly); }, []);

  // Prerender.io's cue (public/index.html): the mocks list and the Weekly
  // Mock summary in. 8s cap, then a frame for Helmet.
  const settled = !loading && weekly !== undefined;
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

  const filtered = mocks.filter((m) => (m.draftClass || "2026") === classFilter);
  const isArchive = ARCHIVE_YEARS.includes(classFilter);
  const description = "NFL mock drafts: We-Draft's weekly 7-round mock for all 32 teams, plus mock drafts written by the community for the 2027 and 2028 NFL Drafts.";

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
      <style>{MOCK_CARD_CSS}</style>

      <MockPageShell year={classFilter} isMobile={isMobile}>
        {/* Draft Sim (DraftSim.jsx) — first thing on the page. */}
        <Link to="/draftsim" className="wd-mock-card" style={{
          position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 12 : 20, flexWrap: "wrap", overflow: "hidden", textDecoration: "none",
          borderRadius: 16, padding: isMobile ? "16px" : "20px 26px", marginBottom: 18,
          background: "radial-gradient(600px 200px at 20% -20%, #12305c 0%, #070d18 70%), #070d18", boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
        }}>
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <span style={{ display: "inline-block", background: "#c8102e", color: "#fff", borderRadius: 6, padding: "3px 9px", fontWeight: 900, fontSize: 11, letterSpacing: "0.14em" }}>
              NEW · DRAFT SIM
            </span>
            <div style={{ margin: "8px 0 6px", color: "#fff", fontSize: isMobile ? 22 : 30, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05 }}>
              Run the draft live
            </div>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: isMobile ? 13 : 14, fontFamily: BODY_FONT, lineHeight: 1.5, maxWidth: 560 }}>
              Take your team&apos;s war room against 31 CPU front offices that draft like their real staffs — trades, a live analyst desk and a report card at the end.
            </div>
          </div>
          <span style={{ ...button("gold", isMobile), flexShrink: 0 }}>Start the Draft Sim →</span>
        </Link>
        <MockHero
          eyebrow="NFL Draft"
          title="Mock Drafts"
          isMobile={isMobile}
          actions={
            <>
              <button onClick={() => navigate("/mocks/create")} style={button("gold", isMobile)}>+ Write a Mock</button>
              <button onClick={() => navigate("/mocks/my")} style={button("ghost", isMobile)}>My Mocks</button>
            </>
          }
        >
          <p style={heroText(isMobile)}>
            Every pick, and the case for it. Build your board, trade picks, and explain each selection — then publish it for the community to read.
          </p>
        </MockHero>

        <WeeklyMockLinks isMobile={isMobile}
          classes={WEEKLY_YEARS.map((year, i) => ({ year, summary: weekly?.[i] || null })).filter((c) => c.year === MAIN_WEEKLY_YEAR || c.summary)} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {ACTIVE_YEARS.map((y) => (
            <button key={y} onClick={() => setClassFilter(y)} aria-pressed={classFilter === y} style={chip(classFilter === y, isMobile)}>{y} Draft</button>
          ))}
          {ARCHIVE_YEARS.map((y) => (
            <button key={y} onClick={() => setClassFilter(y)} aria-pressed={classFilter === y} style={chip(classFilter === y, isMobile)}>{y} · Archive</button>
          ))}
        </div>

        <SectionTitle
          isMobile={isMobile}
          right={!loading && <span style={{ fontSize: 12, fontWeight: 800, color: MUTED, fontFamily: BODY_FONT }}>{filtered.length} mock{filtered.length !== 1 ? "s" : ""}</span>}
        >
          {isArchive ? `${classFilter} Archive` : `${classFilter} Mock Drafts`}
        </SectionTitle>

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
      </MockPageShell>
    </>
  );
}

// The Weekly Mock: one link a published class, to its page (/mocks/{year},
// ViewMock.js WeeklyYearPage — every team's page is linked from there), with
// its rounds and date once the summaries (config/weeklyMock…) are in.
function WeeklyMockLinks({ classes, isMobile }) {
  return (
    <section style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18, borderRadius: 14, boxShadow: CARD_SHADOW,
      background: "#fff", borderLeft: `5px solid ${GOLD}`, padding: isMobile ? "12px 14px" : "14px 20px",
    }}>
      <h2 style={{ flex: "1 1 220px", margin: 0, fontSize: isMobile ? 15 : 17, fontWeight: 900, color: INK, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        We-Draft Weekly Mock Draft
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, ...(isMobile ? { flex: "1 1 100%" } : {}) }}>
        {classes.map(({ year, summary }) => (
          <Link key={year} to={weeklyYearHref(year)} style={{ ...button("blue", isMobile), ...(isMobile ? { flex: 1, justifyContent: "center" } : {}) }}>
            {year}{summary?.rounds ? ` · ${summary.rounds} Rounds` : ""} →
          </Link>
        ))}
      </div>
    </section>
  );
}

// One mock: its No. 1 pick in the leading team's colors, then the title,
// byline and the start of the intro.
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
            No. 1 · {first.selection.Last}
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
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          <Tag>{rounds} Round{rounds !== 1 ? "s" : ""}</Tag>
          <Tag>{made} Pick{made !== 1 ? "s" : ""}</Tag>
          {notes > 0 && <Tag gold>{notes} Note{notes !== 1 ? "s" : ""}</Tag>}
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
