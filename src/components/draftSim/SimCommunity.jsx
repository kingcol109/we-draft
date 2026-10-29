// src/components/draftSim/SimCommunity.jsx
//
// The Draft Sim's Community tab (/draftsim/community): what everyone
// running the sim does — the community insights (compSnapshots/simInsights,
// utils/draftSim/insights.js: simulations ran and picks made, the most
// picked players (with their schools' logos) —
// or, once there's the volume for them (favoritesReady), the community's
// favorites, the players users take furthest ahead of the board — with
// the top one up top, the teams users draft as, the community's first
// round), this week or all time,
// by class — and Recent Drafts (/draftsim/recent, RecentSims.jsx) under it.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { getDocs, collection, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { getSiteSnapshot } from "../../utils/siteSnapshots";
import { SIM_YEARS, SIM_YEAR } from "../../utils/draftSim/data";
import { INSIGHTS_DOC, FAVORITE_MIN, TOP_FAVORITES, favoritesReady } from "../../utils/draftSim/insights";
import RecentSims from "./RecentSims";
import { PANEL } from "./SavedSims";
import LoadingSpinner from "../LoadingSpinner";

const GOLD = "#f6a21d";
const BODY = "Arial, sans-serif";
const TOP_TEAMS = 5;
const chip = (on) => ({
  border: `2px solid ${on ? GOLD : "#24324d"}`, background: on ? GOLD : "#0e1626", color: on ? "#fff" : "#c9d4e5",
  borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: 11, letterSpacing: "0.05em",
});
const label = { color: "#8b9bb4", fontSize: 10, fontWeight: 900, letterSpacing: "0.14em" };
const heading = { color: "#fff", fontSize: 13, fontWeight: 900, letterSpacing: "0.12em", marginBottom: 10 };

// The sub-tabs, as the Sim Profile's: Insights and Recent Drafts.
export const COMMUNITY_VIEWS = [["insights", "Insights"], ["recent", "Recent Drafts"]];
export function SubTabs({ views, view, onView }) {
  return (
    <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
      {views.map(([k, text]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => onView(k)} style={chip(view === k)}>{text.toUpperCase()}</button>)}
    </div>
  );
}

// view / onView: the sub-tab; branding / names / order: the sim's setup
// (order: this class's draft order, for the first round's teams).
export default function SimCommunity({ view, onView, branding = {}, names, order = [], orderYear, isMobile }) {
  return (
    <div>
      <SubTabs views={COMMUNITY_VIEWS} view={view} onView={onView} />
      {view === "recent"
        ? <RecentSims branding={branding} names={names} isMobile={isMobile} />
        : <Insights branding={branding} names={names} order={order} orderYear={orderYear} isMobile={isMobile} />}
    </div>
  );
}

function Insights({ branding, names, order, orderYear, isMobile }) {
  const [doc, setDoc] = useState(undefined);
  const [year, setYear] = useState(SIM_YEAR);
  const [period, setPeriod] = useState("week");
  useEffect(() => {
    let live = true;
    getSiteSnapshot(INSIGHTS_DOC).then((d) => live && setDoc(d || null)).catch(() => live && setDoc(null));
    return () => { live = false; };
  }, []);
  // The schools' dark logos (the panels are dark), for the players listed.
  const schoolLogos = useSchoolLogos(doc?.players);

  const head = (
    <Helmet>
      <title>Draft Sim Community Insights | We-Draft</title>
      <meta name="description" content="What We-Draft Draft Sim users do: the players they take ahead of the board, the teams they draft as, and the community's first round." />
      <link rel="canonical" href="https://we-draft.com/draftsim/community" />
    </Helmet>
  );
  if (doc === undefined) return <>{head}<LoadingSpinner label="Loading insights" size={32} minHeight="30vh" /></>;
  const y = doc?.years?.[year]?.[period];
  const totals = doc?.totals?.[period];
  const players = doc?.players || {};
  const nameOf = (id) => (players[id] ? `${players[id].F} ${players[id].L}` : "Unknown player");
  const logo = (t) => branding[t]?.LogoDark || branding[t]?.Logo1 || "";
  const schoolLogo = (id, size) => <SchoolLogo src={schoolLogos[players[id]?.s]} school={players[id]?.s} size={size} />;
  // Who holds each first-round slot, when it's the class on the setup screen.
  const slotTeam = (overall) => (String(orderYear) === String(year) ? order.find((p) => p.Pick === overall) : null);
  const empty = !y || (!y.teams.length && !y.firstRound.length);
  // The favorites once there's a full list of them (older docs have none);
  // the most picked until then.
  const favorites = y?.favorites || [];
  const ready = favoritesReady(favorites);
  const mostPicked = (y?.players || []).slice(0, TOP_FAVORITES);
  const top = ready ? favorites[0] : mostPicked[0];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {head}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ marginRight: "auto" }}>
          <div style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.16em" }}>FROM THE COMMUNITY</div>
          <div style={{ color: "#fff", fontSize: isMobile ? 22 : 28, fontWeight: 900, lineHeight: 1.05 }}>SIM INSIGHTS</div>
        </div>
        {[["week", "THIS WEEK"], ["all", "ALL TIME"]].map(([k, t]) => <button key={k} onClick={() => setPeriod(k)} aria-pressed={period === k} style={chip(period === k)}>{t}</button>)}
        {SIM_YEARS.length > 1 && SIM_YEARS.map((c) => <button key={c} onClick={() => setYear(c)} aria-pressed={year === c} style={chip(year === c)}>{c}</button>)}
      </div>

      {totals && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr)", gap: 10 }}>
          {[["SIMULATIONS RAN", totals.sims], ["PICKS MADE", totals.picks]].map(([k, n]) => (
            <div key={k} style={{ ...PANEL, padding: "10px 14px" }}>
              <div style={label}>{k}</div>
              <div style={{ color: "#fff", fontSize: 22, fontWeight: 900, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{(n || 0).toLocaleString()}</div>
            </div>
          ))}
          {/* The favorite — the one users take furthest ahead of the board — or, until there's the volume, the most picked. */}
          <div style={{ ...PANEL, padding: "10px 14px", minWidth: 0, gridColumn: isMobile ? "1 / -1" : "auto" }}>
            <div style={label}>{ready ? "FAVORITE PLAYER" : "MOST PICKED PLAYER"}</div>
            {top ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap", fontFamily: BODY }}>
                {schoolLogo(top.id, 28)}
                <PlayerLink p={players[top.id]} name={nameOf(top.id)} big />
                <span style={{ color: "#8b9bb4", fontSize: 12 }}>{players[top.id]?.pos} {players[top.id]?.s}</span>
                <span style={{ marginLeft: "auto", color: GOLD, fontSize: 13, fontWeight: 900 }}>{ready ? spotsEarly(top.median) : picksText(top.n)}</span>
              </div>
            ) : (
              <div style={{ color: "#8b9bb4", fontSize: 13, fontFamily: BODY, marginTop: 6 }}>No picks yet — run a sim and you&apos;re on the board.</div>
            )}
          </div>
        </div>
      )}

      {empty ? (
        <div style={{ ...PANEL, padding: 28, textAlign: "center", color: "#c9d4e5", fontFamily: BODY, fontSize: 14, lineHeight: 1.6 }}>
          {doc ? `No ${year} sims ${period === "week" ? "this week" : ""} yet — run one and you're on the board.` : "Insights aren't available right now — check back soon."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <TeamBars teams={y.teams} names={names} logo={logo} />
            <div style={{ ...PANEL, padding: 14 }}>
              <div style={heading}>{ready ? "COMMUNITY FAVORITES" : "MOST PICKED PLAYERS"}</div>
              {ready && <div style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY, marginBottom: 8 }}>The players users take furthest ahead of their board spot — their median pick ({FAVORITE_MIN}+ selections).</div>}
              {(ready ? favorites : mostPicked).map((p, i) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: i ? "1px solid #18233a" : "none", fontFamily: BODY }}>
                  <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 18, textAlign: "right" }}>{i + 1}</span>
                  {schoolLogo(p.id, 20)}
                  <PlayerLink p={players[p.id]} name={nameOf(p.id)} />
                  <span style={{ color: "#8b9bb4", fontSize: 11 }}>{players[p.id]?.pos} {players[p.id]?.s}</span>
                  <span style={{ marginLeft: "auto", color: "#dbe4f0", fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums" }} title={`${p.n} selections`}>{ready ? spotsEarly(p.median) : picksText(p.n)}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...PANEL, padding: 14 }}>
            <div style={heading}>THE COMMUNITY&apos;S FIRST ROUND</div>
            <div style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY, marginBottom: 8 }}>The player users take most at each pick when it&apos;s theirs.</div>
            {y.firstRound.map((p, i) => {
              const slot = slotTeam(p.overall);
              const team = slot ? slot.Traded || slot.Team : null;
              return (
                <div key={p.overall} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: i ? "1px solid #18233a" : "none", fontFamily: BODY }}>
                  <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 22, textAlign: "right" }}>{p.overall}</span>
                  {team && (logo(team) ? <img src={logo(team)} alt={names(team)} title={names(team)} style={{ width: 20, height: 20, objectFit: "contain" }} /> : <span style={{ width: 20 }} />)}
                  <PlayerLink p={players[p.id]} name={nameOf(p.id)} />
                  <span style={{ color: "#8b9bb4", fontSize: 11 }}>{players[p.id]?.pos}</span>
                  <span style={{ marginLeft: "auto", color: "#dbe4f0", fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums" }} title={`${p.n} of ${p.of} picks`}>{Math.round((p.n / p.of) * 100)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const PlayerLink = ({ p, name, big = false }) => (p?.sl
  ? <Link to={`/player/${p.sl}`} style={{ color: "#fff", fontWeight: 900, fontSize: big ? 18 : 13, textDecoration: "none" }}>{name}</Link>
  : <span style={{ color: "#fff", fontWeight: 900, fontSize: big ? 18 : 13 }}>{name}</span>);

// A school's logo, or the same space empty so the names line up.
const SchoolLogo = ({ src, school, size }) => (src
  ? <img src={src} alt={school || ""} title={school || ""} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
  : <span style={{ width: size, flexShrink: 0 }} />);

// The insights doc's players' schools → { [School]: dark logo } (LogoBlack,
// else LogoDark, else Logo1 — as the sim's), 30 names per query.
function useSchoolLogos(players) {
  const [logos, setLogos] = useState({});
  const key = [...new Set(Object.values(players || {}).map((p) => p.s).filter(Boolean))].sort().join("|");
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const names = key.split("|");
    const chunks = [];
    for (let i = 0; i < names.length; i += 30) chunks.push(names.slice(i, i + 30));
    Promise.all(chunks.map((c) => getDocs(query(collection(db, "schools"), where("School", "in", c))).catch(() => null)))
      .then((snaps) => {
        if (!live) return;
        const out = {};
        snaps.forEach((snap) => snap?.docs.forEach((d) => { const s = d.data(); out[s.School] = s.LogoBlack || s.LogoDark || s.Logo1 || ""; }));
        setLogos(out);
      });
    return () => { live = false; };
  }, [key]);
  return logos;
}

// A median, in board spots ahead: "+12.5 spots early".
const spotsEarly = (spots) => `+${spots} ${spots === 1 ? "spot" : "spots"} early`;
const picksText = (n) => `${n.toLocaleString()} ${n === 1 ? "pick" : "picks"}`;

// The teams users draft as, the top TOP_TEAMS: one bar each, against the most.
function TeamBars({ teams, names, logo }) {
  const top = teams.slice(0, TOP_TEAMS);
  const max = Math.max(1, ...top.map((t) => t.n));
  return (
    <div style={{ ...PANEL, padding: 14 }}>
      <div style={heading}>MOST POPULAR TEAMS</div>
      {top.map((t) => (
        <div key={t.t} title={names(t.t)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
          {logo(t.t) ? <img src={logo(t.t)} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 22, flexShrink: 0 }} />}
          <span style={{ color: "#dbe4f0", fontSize: 12, fontWeight: 900, width: 38, flexShrink: 0 }}>{t.t}</span>
          <span style={{ flex: 1, minWidth: 0, height: 10, background: "#121c2f", borderRadius: 4 }}>
            <span style={{ display: "block", width: `${(t.n / max) * 100}%`, height: "100%", background: GOLD, borderRadius: 4 }} />
          </span>
        </div>
      ))}
    </div>
  );
}
