// src/components/draftSim/SimResults.jsx
//
// The end of a Draft Sim: the user's teams' report cards (engine teamHaul —
// value for the slot balanced against the needs answered, on one scale for
// every team) with Isaac's take on each
// grade, every team's grade, and the full draft round by round.
//
// No account is needed to play. From here the user can share (a branded
// image to save, post to X or text) or save their own teams' picks — never
// the CPU's — to their profile (users/{uid}/draftSims, listed on the sim's
// My Drafts tab and UserProfile.js). Saving signed out opens the sign-in / sign-up modal and
// saves as soon as they're in.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { haulRecords, simShareText, simCallToAction, mockShareText, simUrl } from "../../utils/draftSim/share";
import { shareRow } from "../MockShareCard";
import { SimReportStory, BoardStory } from "./SimShareCards";
import { useAuth } from "../../context/AuthContext";
import { teamHaul, needName, groupedNeeds, pickName } from "../../utils/draftSim/engine";
import { gradeTake } from "../../utils/draftSim/analysts";
import { teamNamer } from "../../utils/draftSim/data";
import { PROFILE_PATH } from "../../utils/draftSim/simProfile";
import { NFL_TEAM_ABBRS } from "../../utils/coachHistory";
import { textOn } from "../../utils/teamColors";
import { renderShareImage } from "../../utils/exportImages";
import { Avatar, Verified } from "./SimFeed";
import { saveSim, setSimVisibility, listable, RECENT_PATH } from "../../utils/draftSim/publicSims";
import { SimSnapshot } from "./SimProfile";
import { RunBadges, EndBadges, SignUpPanel } from "./SimBadges";
import MockExport from "./MockExport";
import { PlayerName } from "./FitName";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const BODY = "Arial, sans-serif";
const PANEL = { background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, overflow: "hidden" };
const HEAD = { padding: "10px 14px", color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.14em", borderBottom: "1px solid #1f2b42" };
const gradeColor = (l) => (l.startsWith("A") ? "#3fb950" : l.startsWith("B") ? "#58a6ff" : l.startsWith("C") ? GOLD : "#f85149");
const teamLogo = (b) => b.LogoDark || b.Logo1;
const schoolLogo = (p) => p.logoDark || p.logo;
const btn = { border: "none", borderRadius: 999, padding: "9px 16px", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", whiteSpace: "nowrap" };

// mock: a Mock Draft mode run — the export-as-mock-draft panel up top.
// onUndo (Mock Draft mode): take back the last pick, back into the draft.
// counted: this run counts toward the Sim Profile (default settings — utils/draftSim/simProfile.js onDefaults).
// badges: the badges this run unlocked (useSimBadges runEarned) — under the
// profile snapshot, or signed out in the sign-up pitch in its place (a Mock
// Draft's: across the top); badgeTotal: how many there are to earn.
export default function SimResults({ sim, data, ctx, speed, isMobile, onRerun, onNew, mock = false, counted = false, onUndo, badges = [], badgeTotal = 0 }) {
  const { user, login, signup } = useAuth();
  const brand = (t) => data.branding[t] || {};
  const userHauls = useMemo(() => sim.userTeams.map((t) => teamHaul(sim, t)), [sim]);
  // Isaac's line per team, picked once (it draws on the desk's rng).
  const takes = useMemo(() => Object.fromEntries(userHauls.map((h) => [h.team, gradeTake(h, ctx)])), [userHauls, ctx]);
  const league = useMemo(() => NFL_TEAM_ABBRS.map((t) => teamHaul(sim, t)).filter((h) => h.rows.length).sort((a, b) => b.score - a.score), [sim]);
  const hasMine = userHauls.some((h) => h.rows.length);

  // Mock Draft mode: no grades — the export and the draft itself.
  if (mock) {
    return (
      <div className="wd-sim-in">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ marginRight: "auto" }}>
            <div style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.16em" }}>FINAL · {data.year} NFL MOCK DRAFT</div>
            <div style={{ color: "#fff", fontSize: isMobile ? 24 : 34, fontWeight: 900, lineHeight: 1 }}>THE MOCK IS COMPLETE</div>
          </div>
          <button onClick={onRerun} style={{ ...btn, background: "#1a2438", color: "#fff" }}>START OVER</button>
          <button onClick={onNew} style={{ ...btn, background: "#1a2438", color: "#fff" }}>SETTINGS</button>
        </div>
        <RunBadges badges={badges} signedIn={!!user} login={login} />
        <FullDraft sim={sim} data={data} isMobile={isMobile} cols={isMobile ? 1 : 4} action={<MockShare sim={sim} data={data} isMobile={isMobile} />} />
        {/* Post it as a mock draft, under the picks. */}
        <div style={{ marginTop: 12 }}><MockExport sim={sim} year={data.year} isMobile={isMobile} onUndo={onUndo} /></div>
      </div>
    );
  }

  return (
    <div className="wd-sim-in">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ marginRight: "auto", flexBasis: isMobile ? "100%" : "auto" }}>
          <div style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.16em" }}>FINAL · {data.year} NFL DRAFT SIM</div>
          <div style={{ color: "#fff", fontSize: isMobile ? 24 : 34, fontWeight: 900, lineHeight: 1 }}>THE DRAFT IS COMPLETE</div>
        </div>
        {/* Mobile: Save under the title, then New Sim across the bottom.
            Share sits on the report card, beside the grade (on the full
            draft when the user only watched). */}
        {isMobile ? (
          <div style={{ flexBasis: "100%", display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
            {hasMine && <div style={{ display: "grid" }}><SaveButton sim={sim} data={data} hauls={userHauls} speed={speed} full /></div>}
            <button onClick={onNew} style={{ ...btn, padding: "12px 16px", fontSize: 13, background: GOLD, color: "#fff" }}>NEW SIM</button>
            <Link to={RECENT_PATH} style={{ ...btn, textAlign: "center", textDecoration: "none", background: "#1a2438", color: "#fff" }}>SEE RECENT USER DRAFTS →</Link>
          </div>
        ) : (
          <>
            {hasMine && <SaveButton sim={sim} data={data} hauls={userHauls} speed={speed} />}
            <button onClick={onNew} style={{ ...btn, background: "#1a2438", color: "#fff" }}>NEW SIM</button>
            <Link to={RECENT_PATH} style={{ ...btn, textDecoration: "none", background: "#1a2438", color: "#fff" }}>RECENT DRAFTS</Link>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 400px", gap: 12, alignItems: "start", marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          {userHauls.map((h, i) => <ReportCard key={h.team} h={h} b={brand(h.team)} take={takes[h.team]} isMobile={isMobile}
            action={i === 0 && <SimShare sim={sim} data={data} hauls={userHauls} isMobile={isMobile} />} />)}
          {userHauls.length === 0 && <FullDraft sim={sim} data={data} isMobile={isMobile} cols={isMobile ? 1 : 3}
            action={<SimShare sim={sim} data={data} hauls={userHauls} isMobile={isMobile} size="big" />} />}
        </div>
        {/* The user's Sim Profile beside their report card; every team's grade at the bottom. */}
        {user ? (
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <SimSnapshot branding={data.branding} names={teamNamer(data.branding).teamName} year={data.year} counted={counted} />
            <EndBadges badges={badges} max={isMobile ? 3 : 4} />
          </div>
        ) : <SignUpPanel badges={badges} total={badgeTotal} login={login} signup={signup} />}
      </div>

      {userHauls.length > 0 && <FullDraft sim={sim} data={data} isMobile={isMobile} cols={isMobile ? 1 : 4} />}
      <div style={{ marginTop: 12 }}><LeagueGrades league={league} sim={sim} brand={brand} cols={isMobile ? 2 : 4} /></div>
    </div>
  );
}

// Needs by name (groupedNeeds — a guard and a center are one Interior
// O-Line, "(1 of 2)" while only one's filled).
const needLabel = (n) => `${needName(n.key)}${n.count && n.count.filled < n.count.of ? ` (${n.count.filled} of ${n.count.of})` : ""}`;
const names = (list) => list.map(needLabel).join(", ");

// action: the Share button, beside the grade (the first card only).
function ReportCard({ h, b, take, isMobile, action }) {
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  return (
    <div style={PANEL}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: isMobile ? 12 : "14px 18px", background: `linear-gradient(115deg, ${c1}, ${c1} 60%, ${c2} 160%)`, color: textOn(c1, c2) }}>
        {teamLogo(b) && <img src={teamLogo(b)} alt="" style={{ width: isMobile ? 48 : 64, height: isMobile ? 48 : 64, objectFit: "contain" }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", opacity: 0.85 }}>DRAFT REPORT CARD</div>
          <div style={{ fontSize: isMobile ? 20 : 28, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05 }}>{b.City} {b.Team || h.team}</div>
        </div>
        {action}
        <div style={{ textAlign: "center", background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: isMobile ? "6px 12px" : "8px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: "#fff", opacity: 0.8 }}>GRADE</div>
          <div style={{ fontSize: isMobile ? 30 : 40, fontWeight: 900, lineHeight: 1, color: "#fff" }}>{h.letter}</div>
        </div>
      </div>
      {take && (
        <div style={{ display: "flex", gap: 10, padding: "12px 16px", borderBottom: "1px solid #1f2b42", background: "rgba(246,162,29,0.06)" }}>
          <Avatar analyst={take.analyst} size={34} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", color: "#fff", fontWeight: 900, fontSize: 12 }}>{take.analyst.name}{take.analyst.verified && <Verified />} <span style={{ color: "#6f7f99", fontWeight: 700, fontFamily: BODY }}>{take.analyst.handle}</span></div>
            <div style={{ color: "#dbe4f0", fontSize: 14, fontFamily: BODY, lineHeight: 1.4, marginTop: 2 }}>{take.text}</div>
          </div>
        </div>
      )}
      {/* The grade balances value and needs: the pressing needs the team
          came in with (as many as it had picks) — met early, answered only
          late (round 3 on), or left open. */}
      {h.needs?.items?.length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid #1f2b42", fontSize: 12, fontFamily: BODY }}>
          <span style={{ color: "#4ade80", fontWeight: 800 }}>Needs met: {groupedNeeds(h.needs).met.length ? names(groupedNeeds(h.needs).met) : "none"}</span>
          {groupedNeeds(h.needs).late.length > 0 && <span style={{ color: GOLD, fontWeight: 800 }}>Answered late: {groupedNeeds(h.needs).late.map((n) => `${needLabel(n)} (R${n.round})`).join(", ")}</span>}
          {groupedNeeds(h.needs).open.length > 0 && <span style={{ color: "#ff8a9a", fontWeight: 800 }}>Still open: {names(groupedNeeds(h.needs).open)}</span>}
        </div>
      )}
      {h.rows.length === 0 && <div style={{ padding: 16, color: "#8b9bb4", fontFamily: BODY, fontSize: 13 }}>No picks in this sim — they traded out.</div>}
      {/* Two columns read down, like the rest of the sim: the first half of the picks on the left. */}
      <div style={isMobile || h.rows.length < 3 ? { display: "grid" } : { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${Math.ceil(h.rows.length / 2)}, auto)`, gridAutoFlow: "column" }}>
        {h.rows.map(({ pick, prospect, letter, need }) => (
          <div key={pick.overall} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 14px", borderBottom: "1px solid #18233a", minWidth: 0 }}>
            <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 52, flexShrink: 0, lineHeight: 1.2 }}>R{pick.round}<br />No. {pick.overall}</span>
            {schoolLogo(prospect) ? <img src={schoolLogo(prospect)} alt="" style={{ width: 24, height: 24, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 24, flexShrink: 0 }} />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <Link to={`/player/${prospect.Slug}`} style={{ display: "block", textDecoration: "none" }}><PlayerName p={prospect} style={{ color: "#fff", fontWeight: 900, fontSize: 13 }} /></Link>
              <span style={{ display: "block", color: "#8b9bb4", fontSize: 11, fontFamily: BODY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {prospect.Position} · {prospect.School} · Board #{prospect.rank}{pick.via ? ` · via ${pick.via}` : ""}
              </span>
              {need && (
                <span style={{ display: "block", color: need.label === "Crowded Room" ? "#ff8a9a" : "#4ade80", fontSize: 11, fontWeight: 800, fontFamily: BODY }}>
                  {need.label === "Crowded Room" ? "Crowded room" : "Need met"}: {needName(need.key)} ({need.label})
                </span>
              )}
            </span>
            <span style={{ fontWeight: 900, fontSize: 17, color: gradeColor(letter), width: 30, textAlign: "center", flexShrink: 0 }}>{letter}</span>
          </div>
        ))}
      </div>
      {/* Every trade the team made, under its picks: what it got and what it gave up. */}
      {h.trades?.length > 0 && (
        <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: "#8b9bb4", fontSize: 10, fontWeight: 900, letterSpacing: "0.16em" }}>TRADES</div>
          {h.trades.map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, fontFamily: BODY }}>
              <span style={{ color: "#fff", fontWeight: 900, fontFamily: "inherit" }}>With {t.partner}</span>
              <span style={{ color: "#4ade80", fontWeight: 800 }}>Got {t.got.map(pickName).join(", ")}</span>
              <span style={{ color: "#ff8a9a", fontWeight: 800 }}>Gave {t.gave.map(pickName).join(", ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Every team's grade, read down the columns (two: 1–16, then 17–32).
function LeagueGrades({ league, sim, brand, cols = 2 }) {
  const rows = Math.ceil(league.length / cols) || 1;
  return (
    <div style={PANEL}>
      <div style={HEAD}>EVERY TEAM&apos;S GRADE</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)`, gridAutoFlow: "column" }}>
        {league.map((h, i) => (
          <div key={h.team} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", borderBottom: "1px solid #18233a", minWidth: 0, background: sim.userTeams.includes(h.team) ? "rgba(246,162,29,0.1)" : "transparent" }}>
            <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 16, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
            {teamLogo(brand(h.team)) && <img src={teamLogo(brand(h.team))} alt="" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} />}
            <span style={{ flex: 1, minWidth: 0, color: "#dbe4f0", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{brand(h.team).Team || h.team}</span>
            <span style={{ fontWeight: 900, fontSize: 13, color: gradeColor(h.letter), flexShrink: 0 }}>{h.letter}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The whole draft, one round at a time, down the columns like the live
// sim's Draft tab. action: the Share button, at the right of the header.
function FullDraft({ sim, data, isMobile, cols, action }) {
  const rounds = [...new Set(sim.picks.map((p) => p.round))];
  const [round, setRound] = useState(rounds[0]);
  const picks = sim.picks.filter((p) => p.round === round && p.selection);
  return (
    <div style={PANEL}>
      <div style={{ ...HEAD, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ marginRight: 6 }}>FULL DRAFT</span>
        {rounds.length > 1 && rounds.map((r) => (
          <button key={r} onClick={() => setRound(r)} aria-pressed={round === r} style={{ border: "none", borderRadius: 999, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, background: round === r ? GOLD : "#1a2438", color: round === r ? "#fff" : "#9fb0c8" }}>R{r}</button>
        ))}
        {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(picks.length / cols) || 1}, auto)`, gridAutoFlow: "column", gap: 6, padding: 10 }}>
        {picks.map((p) => {
          const pl = sim.byId[p.selection];
          const b = data.branding[p.owner] || {};
          const mine = sim.userTeams.includes(p.owner);
          return (
            <div key={p.overall} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderRadius: 10, minWidth: 0, background: "#121c2f", border: `1px solid ${mine ? GOLD : "#1a2640"}` }}>
              <span style={{ color: "#6f7f99", fontWeight: 900, fontSize: 11, width: 22, textAlign: "right", flexShrink: 0 }}>{p.overall}</span>
              {teamLogo(b) && <img src={teamLogo(b)} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />}
              <span style={{ minWidth: 0, flex: 1 }}>
                <Link to={`/player/${pl.Slug}`} style={{ display: "block", textDecoration: "none" }}><PlayerName p={pl} style={{ color: "#fff", fontSize: 12, fontWeight: 900 }} /></Link>
                <span style={{ display: "block", color: "#8b9bb4", fontSize: 10, fontWeight: 800, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.Position} {pl.School}{p.via ? ` · VIA ${p.via}` : ""}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Save to profile: the user's teams' picks only. ──
// full: fill its cell (the mobile button grid), any note under the button.
// Saved public (utils/draftSim/publicSims.js — a one-team sim shows on
// Recent Drafts), with a switch to make it private right there.
function SaveButton({ sim, data, hauls, speed, full }) {
  const { user, profile, login } = useAuth();
  const [state, setState] = useState("idle"); // idle | waiting (for sign-in) | saving | saved | error
  const [saved, setSaved] = useState(null); // the saved sim ({ id, year, rounds, teams, visibility })
  const [toggling, setToggling] = useState(false);
  const save = async (uid) => {
    setState("saving");
    try {
      const rec = { year: data.year, rounds: Math.max(...sim.picks.map((p) => p.round)), speed: speed || null, teams: haulRecords(hauls) };
      const id = await saveSim(uid, profile?.username, rec);
      setSaved({ ...rec, id, visibility: "public" });
      setState("saved");
    } catch (e) {
      console.error("Draft sim save error:", e);
      setState("error");
    }
  };
  const toggle = async () => {
    if (toggling) return;
    const visibility = saved.visibility === "public" ? "private" : "public";
    setToggling(true);
    try {
      await setSimVisibility(user.uid, profile?.username, saved, visibility);
      setSaved((s) => ({ ...s, visibility }));
    } catch (e) {
      console.error("Draft sim visibility error:", e);
      alert("Couldn't change that — try again.");
    } finally {
      setToggling(false);
    }
  };
  // Signed in from the modal → save right away.
  useEffect(() => {
    if (state === "waiting" && user) save(user.uid);
  }, [state, user]); // eslint-disable-line react-hooks/exhaustive-deps
  const onClick = () => {
    if (state === "saving" || state === "saved") return;
    if (user) save(user.uid);
    else { setState("waiting"); login(); }
  };
  if (state === "saved") {
    const isPublic = saved.visibility === "public";
    return (
      <span style={{ display: full ? "flex" : "inline-flex", flexDirection: full ? "column" : "row", alignItems: full ? "stretch" : "center", gap: 6 }}>
        <Link to={`${PROFILE_PATH}?view=drafts`} style={{ ...btn, background: "#163a24", color: "#7ee2a0", textDecoration: "none", ...(full ? { textAlign: "center", whiteSpace: "normal" } : {}) }}>{full ? "SAVED ✓ MY DRAFTS" : "SAVED ✓ VIEW MY DRAFTS"}</Link>
        {listable(saved) && (
          <button onClick={toggle} disabled={toggling} title={isPublic ? "Showing on Recent Drafts — tap to make it private" : "Private — tap to show it on Recent Drafts"}
            style={{ ...btn, padding: "7px 12px", fontSize: 11, background: "transparent", color: isPublic ? "#7ee2a0" : "#9fb0c8", border: `1px solid ${isPublic ? "#2e7d4f" : "#2a3a58"}` }}>
            {toggling ? "…" : isPublic ? "🌐 PUBLIC · MAKE PRIVATE" : "🔒 PRIVATE · MAKE PUBLIC"}
          </button>
        )}
      </span>
    );
  }
  return (
    <span style={{ display: full ? "flex" : "inline-flex", flexDirection: full ? "column-reverse" : "row", alignItems: full ? "stretch" : "center", gap: full ? 6 : 8 }}>
      {state === "waiting" && <span style={{ color: "#9fb0c8", fontSize: 11, fontFamily: BODY, maxWidth: full ? "none" : 200 }}>Sign in or create a free account — it saves as soon as you&apos;re in.</span>}
      <button onClick={onClick} disabled={state === "saving"} style={{ ...btn, background: "#1a2438", color: "#fff", border: `1px solid ${GOLD}`, ...(full ? { whiteSpace: "normal" } : {}) }}>
        {state === "saving" ? "SAVING…" : state === "error" ? "SAVE FAILED — RETRY" : "SAVE TO PROFILE"}
      </button>
    </span>
  );
}

// ── Share: one SHARE button opens the branded image with Save, 𝕏 and
// Message. 𝕏 can't take an image by link, so on a phone it goes through the
// share sheet with the image attached (pick X there); on a computer it opens
// the post with the picks as text (xText, if given, else text). The image
// carries the team and school logos, inlined as data URLs before the
// capture (utils/exportImages.js) — an external logo can taint the canvas
// and blank the export. ──
// size: "big" (Mock Draft mode, beside FULL DRAFT) or "card" (on the
// report card, beside the grade).
function ShareFlow({ card, text, xText = text, fileName, title, isMobile, size, showText = true }) {
  const cardRef = useRef(null);
  const building = useRef(false);
  const [image, setImage] = useState(null); // { url, file }
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const build = async () => {
    if (image || building.current || !cardRef.current) return;
    building.current = true;
    setFailed(false);
    try {
      const url = await renderShareImage(cardRef.current, {
        pixelRatio: 1.5, backgroundColor: "#06162c", // 720 × 1280 → 1080 × 1920
      });
      const blob = await (await fetch(url)).blob();
      setImage({ url, file: new File([blob], fileName, { type: "image/png" }) });
    } catch (e) {
      setFailed(true);
    } finally {
      building.current = false;
    }
  };
  const openShare = () => { setOpen(true); build(); };

  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(xText)}`;
  // Phone: the share sheet with the image attached. No image yet, or no
  // file sharing, and the link opens the plain post.
  const postToX = (e) => {
    if (!image || !navigator.canShare?.({ files: [image.file] })) return;
    e.preventDefault();
    navigator.share({ files: [image.file], text }).catch(() => {});
  };
  const saveImage = () => {
    if (!image) return;
    const a = document.createElement("a");
    a.download = fileName;
    a.href = image.url;
    a.click();
  };

  const trigger = size === "big"
    ? { ...btn, background: GOLD, color: "#fff", padding: isMobile ? "10px 22px" : "12px 30px", fontSize: isMobile ? 14 : 16, letterSpacing: "0.08em", boxShadow: "0 4px 14px rgba(246,162,29,0.35)" }
    : { ...btn, background: "rgba(0,0,0,0.3)", color: "#fff", border: "2px solid rgba(255,255,255,0.55)", padding: isMobile ? "8px 12px" : "12px 22px", fontSize: isMobile ? 12 : 15 };
  const preview = image
    ? <img src={image.url} alt="Your draft, ready to share" style={{ display: "block", margin: "0 auto", maxWidth: "100%", maxHeight: isMobile ? "52vh" : "calc(62vh / var(--pz, 1))", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }} />
    : <div style={{ padding: "90px 12px", textAlign: "center", color: "#8b9bb4", fontFamily: BODY, fontSize: 13, background: "#070d18", borderRadius: 10 }}>{failed ? "Couldn't build the image — 𝕏 and Message still work." : "Building your image…"}</div>;

  return (
    <>
      <button onClick={openShare} style={trigger}>↗ SHARE</button>

      {/* The share image, drawn off screen — at the page root, so it
          inherits nothing from wherever the button sits. */}
      {createPortal(<div style={{ position: "absolute", left: -9999, top: 0 }} aria-hidden="true">{card(cardRef)}</div>, document.body)}

      {open && isMobile && (
        <MobileShareSheet title={title} text={text} showText={showText} preview={preview} intent={intent} onX={postToX} onSave={image ? saveImage : null} onClose={() => setOpen(false)} />
      )}
      {open && !isMobile && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 16, maxWidth: 440, width: "100%", maxHeight: "calc(94vh / var(--pz, 1))", overflowY: "auto", padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ color: BLUE, fontWeight: 900, fontSize: 14, letterSpacing: "0.06em" }}>{title}</div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "#999", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ marginBottom: 16 }}>{preview}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <button onClick={saveImage} disabled={!image} style={{ ...shareLink, background: BLUE, color: "#fff", opacity: image ? 1 : 0.5 }}>💾 Save</button>
              <a href={intent} target="_blank" rel="noopener noreferrer" style={shareLink}>𝕏 Post</a>
              <a href={`sms:?&body=${encodeURIComponent(text)}`} style={shareLink}>💬 Message</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
// X caps a post at 280 characters: the title, as many lines as fit, then
// the call to action.
const X_LIMIT = 280;
function fitPost(title, lines, cta) {
  const out = [title];
  for (const line of lines) {
    if ([...out, line, "", cta].join("\n").length > X_LIMIT) break;
    out.push(line);
  }
  return [...out, "", cta].join("\n");
}
const shareLink = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 8, padding: 10, color: BLUE, fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "pointer", fontFamily: "inherit" };

// Mock Draft mode: round one as a board (every pick, team colors and
// logos); the text is every pick (utils/draftSim/share.js mockShareText).
function MockShare({ sim, data, isMobile }) {
  const name = (t) => { const b = data.branding[t] || {}; return b.Team ? `${b.City || ""} ${b.Team}`.trim() : t; };
  const roundOne = sim.picks.filter((p) => p.round === 1 && p.selection);
  const multi = sim.picks.some((p) => p.round > 1);
  const rows = roundOne.map((p) => ({ ...shareRow(data.branding, { pickNumber: p.overall, team: p.owner, player: sim.byId[p.selection], via: p.via }), logo: teamLogo(data.branding[p.owner] || {}) }));
  const eyebrow = `${data.year} MOCK DRAFT${multi ? " · RD 1" : ""}`;
  // The whole mock is too long for one X post: round one from the top, by
  // team abbreviation, as far as it fits.
  const xText = fitPost(`My ${data.year} NFL Mock Draft`,
    roundOne.map((p) => { const pl = sim.byId[p.selection]; return `${p.overall}. ${p.owner} ${pl.First} ${pl.Last}`; }),
    simCallToAction(data.year));
  return (
    <ShareFlow size="big" isMobile={isMobile} title="SHARE YOUR MOCK" showText={false}
      fileName={`WeDraft_MockDraft_${data.year}.png`}
      text={mockShareText({ year: data.year, sim, teamName: name })} xText={xText}
      card={(ref) => <BoardStory ref={ref} eyebrow={eyebrow} title={`My ${data.year} Mock Draft`} site={simUrl(data.year).toUpperCase()} rows={rows} />} />
  );
}

// The Draft Sim: the user's teams' report cards, or round one when they
// only watched.
function SimShare({ sim, data, hauls, isMobile, size = "card" }) {
  const name = (t) => { const b = data.branding[t] || {}; return b.Team ? `${b.City || ""} ${b.Team}`.trim() : t; };
  const mine = hauls.filter((h) => h.rows.length);
  // No teams of their own: share the first round.
  const roundOne = sim.picks.filter((p) => p.round === 1 && p.selection);

  // Each pick, the grade, then the link (utils/draftSim/share.js); a
  // watch-only sim shares the top of round one.
  const text = mine.length
    ? simShareText({ year: data.year, teams: haulRecords(mine), teamName: name })
    : [
      `My ${data.year} NFL Draft Sim`,
      ...roundOne.slice(0, 10).map((p) => { const pl = sim.byId[p.selection]; return `${p.overall}. ${name(p.owner)} — ${pl.First} ${pl.Last}`; }),
      "",
      simCallToAction(data.year),
    ].join("\n");

  const site = simUrl(data.year).toUpperCase();
  const teams = mine.map((h) => ({ haul: h, brand: data.branding[h.team] || {}, name: name(h.team) }));
  const rows = roundOne.map((p) => ({ ...shareRow(data.branding, { pickNumber: p.overall, team: p.owner, player: sim.byId[p.selection], via: p.via }), logo: teamLogo(data.branding[p.owner] || {}) }));
  return (
    <ShareFlow size={size} isMobile={isMobile} title="SHARE YOUR DRAFT" text={text} fileName={`WeDraft_DraftSim_${data.year}.png`}
      card={(ref) => mine.length
        ? <SimReportStory ref={ref} year={data.year} site={site} teams={teams} />
        : <BoardStory ref={ref} eyebrow={`${data.year} NFL DRAFT SIM`} title={`My ${data.year} Draft Sim`} site={site} rows={rows} />} />
  );
}

// The phone's share sheet: up from the bottom in the sim's colors, the
// image, the message as it'll be sent, and three big buttons — Save, X (the
// phone's share sheet with the image attached) and Messages.
function MobileShareSheet({ title, text, showText, preview, intent, onX, onSave, onClose }) {
  const big = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 14, padding: "15px 8px", fontWeight: 900, fontSize: 14, whiteSpace: "nowrap", letterSpacing: "0.04em", textDecoration: "none", fontFamily: "inherit", border: "none", cursor: "pointer" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 10002, display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} className="wd-sim-in" style={{
        width: "100%", maxHeight: "92vh", overflowY: "auto", background: "#0e1626", borderTop: `3px solid ${GOLD}`, borderRadius: "20px 20px 0 0",
        padding: "10px 16px calc(18px + env(safe-area-inset-bottom))", boxSizing: "border-box", boxShadow: "0 -16px 40px rgba(0,0,0,0.5)",
      }}>
        <div aria-hidden="true" style={{ width: 42, height: 5, borderRadius: 999, background: "#2a3753", margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: 18, letterSpacing: "0.04em" }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "#1a2438", border: "none", color: "#9fb0c8", width: 32, height: 32, borderRadius: "50%", fontSize: 18, lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ marginBottom: 12 }}>{preview}</div>
        {showText && <div className="wd-sim-scroll" style={{ background: "#070d18", border: "1px solid #1f2b42", borderRadius: 12, padding: "12px 14px", maxHeight: "18vh", overflowY: "auto", color: "#dbe4f0", fontFamily: BODY, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-line", marginBottom: 14 }}>
          {text}
        </div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <button onClick={onSave || undefined} disabled={!onSave} style={{ ...big, background: BLUE, color: "#fff", opacity: onSave ? 1 : 0.5 }}>💾 Save</button>
          <a href={intent} onClick={onX} target="_blank" rel="noopener noreferrer" style={{ ...big, background: "#000", color: "#fff", border: "1px solid #2f3336" }}>𝕏 Post</a>
          <a href={`sms:?&body=${encodeURIComponent(text)}`} style={{ ...big, background: "#2ea043", color: "#fff" }}>💬 Message</a>
        </div>
      </div>
    </div>
  );
}
