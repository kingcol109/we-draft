// src/components/draftSim/SimProfile.jsx
//
// The Sim Profile (/draftsim/profile, a tab of the Draft Sim page): the
// signed-in user's running totals for one class (2027 or 2028 — a profile
// each) over the sims they've finished on the default settings, saved or
// not (users/{uid}/simProfile/{year}, utils/draftSim/simProfile.js) — sims
// run, their daily streak, the teams they draft for, positions, the first
// pick they make, favorite schools and players, their average grade, their
// best single draft, and their best value pick and biggest reach. It's all
// there before the first sim (zeros), and signed out with a prompt to sign
// in to start tracking. SimSnapshot: a few of those numbers and the streak
// for the end of a sim (SimResults.jsx). Under the rest, the
// badges they've earned (utils/draftSim/badges.js), by rarity.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { getDoc } from "firebase/firestore";
import { useAuth } from "../../context/AuthContext";
import { simProfileRef, streakRef, liveStreak, averageGrade, profileWritten, PROFILE_PATH } from "../../utils/draftSim/simProfile";
import { SIM_YEAR, SIM_YEARS } from "../../utils/draftSim/data";
import { PANEL, action } from "./SavedSims";
import { BadgeShelf } from "./SimBadges";
import { loadBadges, loadEarned, badgesWritten } from "../../utils/draftSim/badges";
import LoadingSpinner from "../LoadingSpinner";

const GOLD = "#f6a21d";
const BODY = "Arial, sans-serif";
const gradeColor = (l = "") => (l.startsWith("A") ? "#3fb950" : l.startsWith("B") ? "#58a6ff" : l.startsWith("C") ? GOLD : "#f85149");
const HEAD = { padding: "10px 14px", color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.14em", borderBottom: "1px solid #1f2b42" };
const top = (m = {}, n = Infinity) => Object.entries(m).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, n);

// The signed-in user's profile for a class, with their streak (as it
// stands today) on it as `streak` / `bestStreak`: undefined while loading,
// zeros with none yet or signed out. Read after the last finished run's
// write lands.
function useSimProfile(user, year) {
  const [prof, setProf] = useState(undefined);
  useEffect(() => {
    if (!user) { setProf({}); return undefined; }
    let live = true;
    setProf(undefined);
    const data = (s) => (s.exists() ? s.data() : {});
    // A tick first: the run's write starts in DraftSim's effect, which runs
    // after this one (a child's) in the same commit.
    new Promise((r) => setTimeout(r, 0)).then(profileWritten)
      .then(() => Promise.all([getDoc(simProfileRef(user.uid, year)), getDoc(streakRef(user.uid))]))
      .then(([p, s]) => live && setProf({ ...data(p), streak: liveStreak(data(s)), bestStreak: data(s).best || 0 }))
      .catch((e) => { console.error("Sim profile load error:", e); if (live) setProf({}); });
    return () => { live = false; };
  }, [user, year]);
  return prof;
}

// The badges there are and the ones the user's earned ({ badges, earned }),
// after the last finished run's award lands; signed out, none earned.
function useBadgeShelf(user, admin) {
  const [shelf, setShelf] = useState(null);
  useEffect(() => {
    let live = true;
    new Promise((r) => setTimeout(r, 0)).then(badgesWritten)
      .then(() => Promise.all([loadBadges(admin), user ? loadEarned(user.uid) : {}]))
      .then(([badges, earned]) => live && setShelf({ badges, earned }))
      .catch((e) => { console.warn("Sim badges:", e?.code || e); if (live) setShelf(null); });
    return () => { live = false; };
  }, [user, admin]);
  return shelf;
}

const streakText = (n) => (n ? `🔥 ${n}-day streak` : "No streak going");
// Who counts, said once wherever the profile shows.
const RULE = "Only finished single-team drafts on the default settings go on your profile — speed and desk chatter don't matter. Any finished sim keeps your streak going.";

// Signed out: sign in (or sign up — the same modal) to start tracking.
function SignInPrompt({ login, compact }) {
  return (
    <div style={{ ...PANEL, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: compact ? "10px 14px" : "14px 18px", borderColor: GOLD, background: "rgba(246,162,29,0.08)" }}>
      <div style={{ flex: "1 1 240px", color: "#dbe4f0", fontFamily: BODY, fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ color: "#fff", fontFamily: "inherit" }}>Track every sim you run.</strong> Sign in or create a free account and each draft you finish builds your Sim Profile — your teams, positions, favorite schools, best and worst picks.
      </div>
      <button onClick={login} style={{ ...action, background: GOLD, color: "#fff", border: "none", padding: "9px 18px" }}>SIGN IN / SIGN UP</button>
    </div>
  );
}

// branding / names: the sim's setup (names: abbr → "New York Jets").
export default function SimProfile({ branding = {}, names, isMobile }) {
  const { user, login, profile } = useAuth();
  const [year, setYear] = useState(SIM_YEAR);
  const prof = useSimProfile(user, year);
  const shelf = useBadgeShelf(user, profile?.role === "admin");
  const years = SIM_YEARS.length > 1 && (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 18 : 22, marginRight: "auto" }}>{year} SIM PROFILE</span>
      {SIM_YEARS.map((y) => (
        <button key={y} onClick={() => setYear(y)} aria-pressed={year === y} style={{ ...action, ...(year === y ? { background: GOLD, borderColor: GOLD } : {}) }}>{y} CLASS</button>
      ))}
    </div>
  );
  if (prof === undefined) return <div style={{ display: "grid", gap: 12 }}>{years}<LoadingSpinner label="Loading your profile" size={32} minHeight="30vh" /></div>;

  const teams = top(prof.teams);
  const positions = top(prof.positions);
  const firsts = top(prof.firsts, 3);
  const schools = top(prof.schools, 5);
  const players = top(prof.players, 5).map(([id, n]) => ({ id, n, ...(prof.playerInfo?.[id] || {}) }));
  const avg = averageGrade(prof.grades);
  const fav = teams[0]?.[0];
  const favB = fav ? branding[fav] || {} : {};
  const totalPicks = positions.reduce((t, [, n]) => t + n, 0) || 1;

  // The headline tiles: the number big, centered in its tile.
  const tile = { ...PANEL, padding: isMobile ? "12px 14px" : "14px 18px", minWidth: 0, display: "flex", flexDirection: "column", minHeight: isMobile ? 112 : 132 };
  const label = { color: "#8b9bb4", fontSize: isMobile ? 10 : 11, fontWeight: 900, letterSpacing: "0.14em" };
  const big = { color: "#fff", fontSize: isMobile ? 32 : 44, fontWeight: 900, lineHeight: 1, marginTop: "auto", paddingTop: 6 };
  const sub = { color: "#8b9bb4", fontSize: isMobile ? 12 : 13, fontFamily: BODY, marginTop: 6, marginBottom: "auto" };

  const none = (text) => <div style={{ padding: "10px 14px", color: "#6f7f99", fontSize: 12, fontFamily: BODY }}>{text}</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Helmet>
        <title>My Sim Profile | We-Draft Draft Simulator</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      {years}
      {!user && <SignInPrompt login={login} />}
      <div style={{ color: "#9fb0c8", fontSize: 12, fontFamily: BODY }}>
        {user && !prof.sims ? `Your ${year} profile fills in as you draft — finish a ${year} sim, saved or not, and it starts counting. ` : ""}{RULE}
      </div>
      {/* The headline numbers. */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
        <div style={tile}>
          <div style={label}>SIMS FINISHED</div><div style={big}>{prof.sims || 0}</div>
          <div style={sub}>{prof.picks || 0} picks made</div>
        </div>
        <div style={tile}><div style={label}>AVERAGE GRADE</div><div style={{ ...big, color: avg ? gradeColor(avg) : "#fff" }}>{avg || "—"}</div><div style={sub}>across your teams</div></div>
        <div style={{ ...tile, ...(prof.streak ? { borderColor: GOLD, background: "rgba(246,162,29,0.08)" } : {}) }}>
          <div style={label}>DAILY STREAK</div>
          <div style={big}>{prof.streak ? `🔥 ${prof.streak}` : 0}<span style={{ fontSize: isMobile ? 13 : 15, color: "#8b9bb4", fontFamily: BODY, fontWeight: 700 }}> day{prof.streak === 1 ? "" : "s"}</span></div>
          <div style={sub}>Best: {prof.bestStreak || 0}</div>
        </div>
        <FavoriteTeam fav={fav} b={favB} sims={teams[0]?.[1]} names={names} style={tile} label={label} big={big} logoSize={isMobile ? 64 : 84} />
      </div>

      {/* Best single draft, best value and biggest reach. */}
      {(prof.bestDraft || prof.best || prof.worst) && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
          {prof.bestDraft && <BestDraft d={prof.bestDraft} b={branding[prof.bestDraft.team] || {}} names={names} />}
          {prof.best && <PickTile title="BEST VALUE PICK" p={prof.best} color="#4ade80" note={prof.best.value > 0 ? `${prof.best.value} spots after his board rank` : "right on his board rank"} names={names} />}
          {prof.worst && prof.worst.value < 0 && <PickTile title="BIGGEST REACH" p={prof.worst} color="#ff8a9a" note={`${-prof.worst.value} spots before his board rank`} names={names} />}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, alignItems: "start" }}>
        {/* Positions, as bars. */}
        <div style={PANEL}>
          <div style={HEAD}>POSITION BREAKDOWN</div>
          <div style={{ padding: "8px 14px 12px", display: "grid", gap: 6 }}>
            {!positions.length && none("No picks yet.")}
            {positions.map(([pos, n]) => (
              <div key={pos} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ width: 42, color: "#fff", fontWeight: 900 }}>{pos}</span>
                <span style={{ flex: 1, height: 10, background: "#18233a", borderRadius: 999, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${(n / positions[0][1]) * 100}%`, background: GOLD, borderRadius: 999 }} />
                </span>
                <span style={{ width: 70, textAlign: "right", color: "#9fb0c8", fontFamily: BODY, fontSize: 11 }}>{n} · {Math.round((n / totalPicks) * 100)}%</span>
              </div>
            ))}
            {firsts.length > 0 && (
              <div style={{ color: "#8b9bb4", fontSize: 11, fontFamily: BODY, marginTop: 6 }}>
                Your first pick is usually a <strong style={{ color: "#fff" }}>{firsts[0][0]}</strong>
                {firsts.length > 1 ? ` (then ${firsts.slice(1).map(([p]) => p).join(", ")})` : ""}.
              </div>
            )}
          </div>
        </div>

        {/* Teams drafted for. */}
        <div style={PANEL}>
          <div style={HEAD}>TEAMS YOU DRAFT FOR</div>
          <div style={{ padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6 }}>
            {!teams.length && none("No teams yet.")}
            {teams.map(([t, n]) => {
              const b = branding[t] || {};
              return (
                <Link key={t} to={`/nfl/${t.toLowerCase()}`} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderRadius: 10, background: "#121c2f", border: "1px solid #1a2640", textDecoration: "none", minWidth: 0 }}>
                  {(b.LogoDark || b.Logo1) && <img src={b.LogoDark || b.Logo1} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />}
                  <span style={{ flex: 1, minWidth: 0, color: "#dbe4f0", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.Team || names(t)}</span>
                  <span style={{ color: GOLD, fontWeight: 900, fontSize: 12 }}>{n}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Schools. */}
        <div style={PANEL}>
          <div style={HEAD}>FAVORITE SCHOOLS</div>
          <div style={{ padding: "4px 0" }}>
            {!schools.length && none("No schools yet.")}
            {schools.map(([s, n], i) => (
              <div key={s} style={{ display: "flex", gap: 8, padding: "5px 14px", fontSize: 12, borderBottom: i < schools.length - 1 ? "1px solid #18233a" : "none" }}>
                <span style={{ width: 18, color: "#6f7f99", fontWeight: 900 }}>{i + 1}</span>
                <span style={{ flex: 1, color: "#fff", fontWeight: 900 }}>{s}</span>
                <span style={{ color: "#9fb0c8", fontFamily: BODY }}>{n} pick{n === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Players taken most, and the grades. */}
        <div style={{ display: "grid", gap: 12 }}>
          <div style={PANEL}>
            <div style={HEAD}>YOUR GUYS — DRAFTED MOST</div>
            <div style={{ padding: "4px 0" }}>
              {!players.length && none("No players yet.")}
              {players.map((p, i) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 14px", fontSize: 12, borderBottom: i < players.length - 1 ? "1px solid #18233a" : "none" }}>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.slug ? <Link to={`/player/${p.slug}`} style={{ color: "#fff", fontWeight: 900, textDecoration: "none", textTransform: "uppercase" }}>{p.name}</Link> : <span style={{ color: "#fff", fontWeight: 900, textTransform: "uppercase" }}>{p.name}</span>}
                    <span style={{ color: "#8b9bb4", fontFamily: BODY }}> · {p.pos}{p.school ? ` · ${p.school}` : ""}</span>
                  </span>
                  <span style={{ color: GOLD, fontWeight: 900 }}>{p.n}×</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {user && shelf && <BadgeShelf badges={shelf.badges} earned={shelf.earned} panel={PANEL} head={HEAD} />}
      <div style={{ color: "#6f7f99", fontSize: 11, fontFamily: BODY, textAlign: "center" }}>Counts every sim you finish while signed in, saved or not.</div>
    </div>
  );
}

// The team they draft for most: its sim count up by the label, and its
// logo big and centered on its colors — the name's in the logo. A wide
// wordmark runs the tile's width (up to logoSize × 2.6), logoSize tall.
function FavoriteTeam({ fav, b, sims, names, style, label, big, logoSize = 64 }) {
  const logo = b.LogoDark || b.Logo1;
  return (
    <div style={{ ...style, display: "flex", flexDirection: "column", ...(fav && b.Color1 ? { background: b.Color1, borderColor: b.Color2 || "#1f2b42" } : {}) }}>
      <div style={{ ...label, color: fav ? "rgba(255,255,255,0.8)" : label.color }}>
        FAVORITE TEAM{fav ? <span style={{ color: "#fff" }}> · {sims} SIM{sims === 1 ? "" : "S"}</span> : null}
      </div>
      {fav ? (
        <Link to={`/nfl/${fav.toLowerCase()}`} title={names(fav)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 0 2px", color: "#fff", textDecoration: "none" }}>
          {logo ? <img src={logo} alt={names(fav)} style={{ width: "100%", maxWidth: logoSize * 2.6, height: logoSize, objectFit: "contain" }} /> : <span style={{ fontWeight: 900, fontSize: 24 }}>{fav}</span>}
        </Link>
      ) : <div style={big}>—</div>}
    </div>
  );
}

// The end of a sim: a few of the profile's numbers and a way to the rest —
// signed out, the prompt to sign in and start tracking. Two columns, to sit
// beside the report card.
// year: the sim's class (its profile); counted: whether this run counted.
export function SimSnapshot({ branding = {}, names, year = SIM_YEAR, counted = true }) {
  const { user, login } = useAuth();
  const prof = useSimProfile(user, year);
  if (!user) return <SignInPrompt login={login} compact />;
  if (!prof) return null;
  const fav = top(prof.teams, 1)[0];
  const pos = top(prof.positions, 1)[0];
  const school = top(prof.schools, 1)[0];
  const avg = averageGrade(prof.grades);
  const favB = fav ? branding[fav[0]] || {} : {};
  const cell = { minWidth: 0, padding: "10px 14px", borderBottom: "1px solid #1f2b42" };
  const label = { color: "#8b9bb4", fontSize: 9, fontWeight: 900, letterSpacing: "0.14em" };
  const val = { color: "#fff", fontSize: 20, fontWeight: 900, lineHeight: 1.2, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div style={PANEL}>
      <div style={{ ...HEAD, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1 }}>YOUR {year} SIM PROFILE</span>
        <Link to={PROFILE_PATH} style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textDecoration: "none" }}>VIEW FULL PROFILE →</Link>
      </div>
      {/* The streak — or why this one didn't count. */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #1f2b42", fontSize: 12, fontFamily: BODY, ...(counted && prof.streak ? { background: "rgba(246,162,29,0.1)", color: "#fff", fontWeight: 800 } : { color: "#9fb0c8" }) }}>
        {counted
          ? <>{streakText(prof.streak)}{prof.streak ? <span style={{ color: "#9fb0c8", fontWeight: 400 }}> · best {prof.bestStreak}</span> : null}<span style={{ color: "#9fb0c8", fontWeight: 400 }}> — finish a sim each day to keep it going.</span></>
          : <>{streakText(prof.streak)} — this draft doesn&apos;t go on your profile (only single-team drafts on the default settings do), but it keeps your streak going.</>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ ...cell, borderRight: "1px solid #1f2b42" }}><div style={label}>SIMS</div><div style={val}>{prof.sims || 0}</div></div>
        <div style={cell}><div style={label}>AVG GRADE</div><div style={{ ...val, color: avg ? gradeColor(avg) : "#fff" }}>{avg || "—"}</div></div>
        <div style={{ gridColumn: "1 / -1" }}>
          <FavoriteTeam fav={fav?.[0]} b={favB} sims={fav?.[1]} names={names} logoSize={56} label={label} big={val}
            style={{ ...cell, borderRadius: 0 }} />
        </div>
        <div style={{ ...cell, borderBottom: "none", borderRight: "1px solid #1f2b42" }}><div style={label}>TOP POSITION</div><div style={val}>{pos ? pos[0] : "—"}</div></div>
        <div style={{ ...cell, borderBottom: "none" }}><div style={label}>TOP SCHOOL</div><div style={val}>{school ? school[0] : "—"}</div></div>
      </div>
    </div>
  );
}

// Their highest-graded team: the grade big, on the team's colors.
function BestDraft({ d, b, names }) {
  const date = d.day ? new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  const logo = b.LogoDark || b.Logo1;
  return (
    <div style={{ ...PANEL, padding: "12px 14px", borderColor: GOLD, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: GOLD, fontSize: 10, fontWeight: 900, letterSpacing: "0.14em" }}>BEST DRAFT</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          {logo && <img src={logo} alt="" style={{ width: 30, height: 30, objectFit: "contain" }} />}
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 15, textTransform: "uppercase", lineHeight: 1.1 }}>{names(d.team)}</span>
        </div>
        <div style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY, marginTop: 4 }}>{[`${d.year} class`, date].filter(Boolean).join(" · ")}</div>
      </div>
      <div style={{ fontSize: 40, fontWeight: 900, color: gradeColor(d.letter), lineHeight: 1 }}>{d.letter}</div>
    </div>
  );
}

function PickTile({ title, p, color, note, names }) {
  return (
    <div style={{ ...PANEL, padding: "12px 14px", borderColor: color }}>
      <div style={{ color, fontSize: 10, fontWeight: 900, letterSpacing: "0.14em" }}>{title}</div>
      <div style={{ marginTop: 4 }}>
        {p.slug ? <Link to={`/player/${p.slug}`} style={{ color: "#fff", fontWeight: 900, fontSize: 17, textDecoration: "none", textTransform: "uppercase" }}>{p.name}</Link> : <span style={{ color: "#fff", fontWeight: 900, fontSize: 17, textTransform: "uppercase" }}>{p.name}</span>}
      </div>
      <div style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY, marginTop: 2 }}>
        {p.pos}{p.school ? ` · ${p.school}` : ""} · No. {p.overall} (R{p.round}) for the {names(p.team)} · {p.year}
      </div>
      <div style={{ color, fontSize: 12, fontWeight: 800, fontFamily: BODY, marginTop: 4 }}>{note}</div>
    </div>
  );
}
