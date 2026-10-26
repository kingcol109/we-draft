// src/components/draftSim/SimResults.jsx
//
// The end of a Draft Sim: the user's teams' report cards (engine teamHaul —
// board value for the slot plus staff fit) with Isaac's take on each
// grade, every team's grade, and the full draft round by round.
//
// No account is needed to play. From here the user can share (a branded
// image to save, post to X or text) or save their own teams' picks — never
// the CPU's — to their profile (users/{uid}/draftSims, listed on the sim's
// My Drafts tab and UserProfile.js). Saving signed out opens the sign-in / sign-up modal and
// saves as soon as they're in.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { haulRecords, simShareText, simCallToAction, mockShareText, simUrl } from "../../utils/draftSim/share";
import MockShareCard, { shareRow } from "../MockShareCard";
import * as htmlToImage from "html-to-image";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../context/AuthContext";
import { teamHaul, NEED_KEY_NAMES, pickName } from "../../utils/draftSim/engine";
import { gradeTake } from "../../utils/draftSim/analysts";
import { SIM_YEAR } from "../../utils/draftSim/data";
import { NFL_TEAM_ABBRS } from "../../utils/coachHistory";
import { textOn } from "../../utils/teamColors";
import { withoutPageZoom } from "../../utils/pageZoom";
import { Avatar } from "./SimFeed";
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
export default function SimResults({ sim, data, ctx, speed, isMobile, onRerun, onNew, mock = false, onUndo }) {
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
          <MockShare sim={sim} data={data} isMobile={isMobile} />
          <button onClick={onRerun} style={{ ...btn, background: "#1a2438", color: "#fff" }}>START OVER</button>
          <button onClick={onNew} style={{ ...btn, background: "#1a2438", color: "#fff" }}>SETTINGS</button>
        </div>
        <MockExport sim={sim} year={data.year} isMobile={isMobile} onUndo={onUndo} />
        <FullDraft sim={sim} data={data} isMobile={isMobile} cols={isMobile ? 1 : 4} />
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
        {/* Mobile: Share and Save side by side under the title (Share
            alone runs full width), then New Sim across the bottom — no Run
            It Back. */}
        {isMobile ? (
          <div style={{ flexBasis: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ display: "grid", gridColumn: hasMine ? "auto" : "1 / -1" }}>
              <ShareButton sim={sim} data={data} hauls={userHauls} takes={takes} isMobile />
            </div>
            {hasMine && <div style={{ display: "grid" }}><SaveButton sim={sim} data={data} hauls={userHauls} speed={speed} full /></div>}
            <button onClick={onNew} style={{ ...btn, gridColumn: "1 / -1", padding: "12px 16px", fontSize: 13, background: GOLD, color: "#fff" }}>NEW SIM</button>
          </div>
        ) : (
          <>
            <ShareButton sim={sim} data={data} hauls={userHauls} takes={takes} />
            {hasMine && <SaveButton sim={sim} data={data} hauls={userHauls} speed={speed} />}
            <button onClick={onRerun} style={{ ...btn, background: GOLD, color: "#fff" }}>RUN IT BACK</button>
            <button onClick={onNew} style={{ ...btn, background: "#1a2438", color: "#fff" }}>NEW SIM</button>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 400px", gap: 12, alignItems: "start", marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          {userHauls.map((h) => <ReportCard key={h.team} h={h} b={brand(h.team)} take={takes[h.team]} isMobile={isMobile} />)}
          {userHauls.length === 0 && <FullDraft sim={sim} data={data} isMobile={isMobile} cols={isMobile ? 1 : 3} />}
        </div>
        <LeagueGrades league={league} sim={sim} brand={brand} />
      </div>

      {userHauls.length > 0 && <FullDraft sim={sim} data={data} isMobile={isMobile} cols={isMobile ? 1 : 4} />}
    </div>
  );
}

function ReportCard({ h, b, take, isMobile }) {
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
        <div style={{ textAlign: "center", background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: isMobile ? "6px 12px" : "8px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", color: "#fff", opacity: 0.8 }}>GRADE</div>
          <div style={{ fontSize: isMobile ? 30 : 40, fontWeight: 900, lineHeight: 1, color: "#fff" }}>{h.letter}</div>
        </div>
      </div>
      {take && (
        <div style={{ display: "flex", gap: 10, padding: "12px 16px", borderBottom: "1px solid #1f2b42", background: "rgba(246,162,29,0.06)" }}>
          <Avatar analyst={take.analyst} size={34} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: 12 }}>{take.analyst.name} <span style={{ color: "#6f7f99", fontWeight: 700, fontFamily: BODY }}>{take.analyst.handle}</span></div>
            <div style={{ color: "#dbe4f0", fontSize: 14, fontFamily: BODY, lineHeight: 1.4, marginTop: 2 }}>{take.text}</div>
          </div>
        </div>
      )}
      {/* The grade balances value and needs: which of the needs the team
          came in with it met, and which it left open. */}
      {(h.needs?.met.length > 0 || h.needs?.open.length > 0) && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid #1f2b42", fontSize: 12, fontFamily: BODY }}>
          <span style={{ color: "#4ade80", fontWeight: 800 }}>Needs met: {h.needs.met.length ? h.needs.met.map((n) => NEED_KEY_NAMES[n.key] || n.key).join(", ") : "none"}</span>
          {h.needs.open.length > 0 && <span style={{ color: "#ff8a9a", fontWeight: 800 }}>Still open: {h.needs.open.map((n) => NEED_KEY_NAMES[n.key] || n.key).join(", ")}</span>}
        </div>
      )}
      {h.rows.length === 0 && <div style={{ padding: 16, color: "#8b9bb4", fontFamily: BODY, fontSize: 13 }}>No picks in this sim — they traded out.</div>}
      <div style={{ display: "grid", gridTemplateColumns: isMobile || h.rows.length < 3 ? "1fr" : "1fr 1fr" }}>
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
                <span style={{ display: "block", color: need.label === "Crowded Room" ? "#ff8a9a" : "#ffb3bf", fontSize: 11, fontWeight: 800, fontFamily: BODY }}>
                  {need.label === "Crowded Room" ? "Crowded room" : "Need"}: {NEED_KEY_NAMES[need.key] || need.key} ({need.label})
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

// Every team's grade, two columns down (1–16, then 17–32).
function LeagueGrades({ league, sim, brand }) {
  const rows = Math.ceil(league.length / 2) || 1;
  return (
    <div style={PANEL}>
      <div style={HEAD}>EVERY TEAM&apos;S GRADE</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${rows}, auto)`, gridAutoFlow: "column" }}>
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
// sim's Draft tab.
function FullDraft({ sim, data, isMobile, cols }) {
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
function SaveButton({ sim, data, hauls, speed, full }) {
  const { user, login } = useAuth();
  const [state, setState] = useState("idle"); // idle | waiting (for sign-in) | saving | saved | error
  const save = async (uid) => {
    setState("saving");
    try {
      await addDoc(collection(db, "users", uid, "draftSims"), {
        year: data.year, rounds: Math.max(...sim.picks.map((p) => p.round)), speed: speed || null, createdAt: serverTimestamp(),
        teams: haulRecords(hauls),
      });
      setState("saved");
    } catch (e) {
      console.error("Draft sim save error:", e);
      setState("error");
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
    return <Link to={`/draftsim${data.year === SIM_YEAR ? "" : `/${data.year}`}?tab=saved`} style={{ ...btn, background: "#163a24", color: "#7ee2a0", textDecoration: "none", ...(full ? { textAlign: "center", whiteSpace: "normal" } : {}) }}>{full ? "SAVED ✓ MY DRAFTS" : "SAVED ✓ VIEW MY DRAFTS"}</Link>;
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

// ── Share: a branded image (save it, or post to X / text with the
// summary). On mobile there's no image — just X and Message. The image is
// text only — an external logo can taint the canvas and blank the export,
// same as ShareMockButton.jsx. ──
// Mock Draft mode's two shares: SAVE IMAGE downloads round one as a board
// (every pick, team colors), SHARE TEXT sends every pick as a post or a
// text (utils/draftSim/share.js mockShareText).
function MockShare({ sim, data, isMobile }) {
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const name = (t) => { const b = data.branding[t] || {}; return b.Team ? `${b.City || ""} ${b.Team}`.trim() : t; };
  const text = mockShareText({ year: data.year, sim, teamName: name });
  const roundOne = sim.picks.filter((p) => p.round === 1 && p.selection);
  const multi = sim.picks.some((p) => p.round > 1);

  const saveImage = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const url = await withoutPageZoom(() => htmlToImage.toPng(cardRef.current, {
        pixelRatio: 2, backgroundColor: "#06162c", skipFonts: true, filter: (node) => node.tagName !== "IMG",
      }));
      const a = document.createElement("a");
      a.download = `WeDraft_MockDraft_${data.year}.png`;
      a.href = url;
      a.click();
    } catch (e) {
      alert("Couldn't build the image. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };
  const shareLink = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 8, padding: 10, color: BLUE, fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "pointer", fontFamily: "inherit" };

  return (
    <>
      <button onClick={saveImage} style={{ ...btn, background: BLUE, color: "#fff" }}>{busy ? "BUILDING…" : "SAVE IMAGE"}</button>
      <button onClick={() => setOpen(true)} style={{ ...btn, background: BLUE, color: "#fff" }}>SHARE TEXT</button>

      {/* The image (MockShareCard), drawn off screen: round one. */}
      <div style={{ position: "absolute", left: -9999, top: 0 }} aria-hidden="true">
        <MockShareCard ref={cardRef} eyebrow={`${data.year} NFL MOCK DRAFT${multi ? " · ROUND 1" : ""}`} title={`My ${data.year} Mock Draft`}
          rows={roundOne.map((p) => shareRow(data.branding, { pickNumber: p.overall, team: p.owner, player: sim.byId[p.selection], via: p.via }))}
          footer={`Make yours at ${simUrl(data.year)}`} />
      </div>

      {open && isMobile && <MobileShareSheet text={text} onClose={() => setOpen(false)} />}
      {open && !isMobile && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 16, maxWidth: 480, width: "100%", maxHeight: "calc(90vh / var(--pz, 1))", overflowY: "auto", padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ color: BLUE, fontWeight: 900, fontSize: 14, letterSpacing: "0.06em" }}>SHARE YOUR MOCK</div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "#999", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ background: "#f4f6fa", border: "1px solid #d8dee8", borderRadius: 10, padding: "10px 12px", maxHeight: 320, overflowY: "auto", color: "#1d2733", fontFamily: BODY, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-line", marginBottom: 14 }}>{text}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" style={shareLink}>𝕏 Post</a>
              <a href={`sms:?&body=${encodeURIComponent(text)}`} style={shareLink}>💬 Message</a>
              <button onClick={copy} style={{ ...shareLink, background: BLUE, color: "#fff" }}>{copied ? "✓ Copied" : "📋 Copy"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ShareButton({ sim, data, hauls, takes, isMobile }) {
  const cardRef = useRef(null);
  const [image, setImage] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const build = async () => {
    if (isMobile) { setOpen(true); return; }
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const url = await withoutPageZoom(() => htmlToImage.toPng(cardRef.current, {
        pixelRatio: 2, backgroundColor: "#06162c", skipFonts: true, filter: (node) => node.tagName !== "IMG",
      }));
      setImage(url);
      setOpen(true);
    } catch (e) {
      alert("Couldn't build the share image. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const saveImage = () => {
    const a = document.createElement("a");
    a.download = `WeDraft_DraftSim_${data.year}.png`;
    a.href = image;
    a.click();
  };
  const shareLink = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 8, padding: 10, color: BLUE, fontWeight: 800, fontSize: 13, textDecoration: "none", cursor: "pointer", fontFamily: "inherit" };

  return (
    <>
      <button onClick={build} style={{ ...btn, background: BLUE, color: "#fff" }}>{busy ? "BUILDING…" : "SHARE"}</button>

      {/* The share image, drawn off screen. */}
      <div style={{ position: "absolute", left: -9999, top: 0 }} aria-hidden="true">
        <div ref={cardRef} style={{ width: 640, background: "linear-gradient(180deg, #06162c, #0d2544)", border: `3px solid ${GOLD}`, borderRadius: 22, fontFamily: "'Arial Black', Arial, sans-serif", overflow: "hidden", color: "#fff" }}>
          <div style={{ padding: "24px 28px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: GOLD, letterSpacing: "0.05em" }}>WE-DRAFT.COM</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.16em", marginTop: 4 }}>{data.year} NFL DRAFT SIM</div>
          </div>
          <div style={{ padding: "12px 24px 20px", display: "grid", gap: 12 }}>
            {mine.length ? mine.slice(0, 3).map((h) => {
              const b = data.branding[h.team] || {};
              const c1 = b.Color1 || BLUE;
              return (
                <div key={h.team} style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${b.Color2 || GOLD}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: c1, color: textOn(c1, b.Color2 || GOLD) }}>
                    <div style={{ flex: 1, fontSize: 20, fontWeight: 900, textTransform: "uppercase" }}>{name(h.team)}</div>
                    <div style={{ background: "rgba(0,0,0,0.3)", color: "#fff", borderRadius: 10, padding: "4px 14px", fontSize: 28, fontWeight: 900 }}>{h.letter}</div>
                  </div>
                  <div style={{ background: "rgba(0,0,0,0.25)", padding: "6px 0" }}>
                    {h.rows.slice(0, 10).map(({ pick, prospect, letter }) => (
                      <div key={pick.overall} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 16px", fontSize: 13 }}>
                        <span style={{ width: 54, color: "rgba(255,255,255,0.55)", fontSize: 11 }}>R{pick.round} · {pick.overall}</span>
                        <span style={{ flex: 1, fontWeight: 900, textTransform: "uppercase" }}>{prospect.First} {prospect.Last}</span>
                        <span style={{ color: "rgba(255,255,255,0.7)", fontFamily: BODY, fontSize: 12 }}>{prospect.Position} · {prospect.School}</span>
                        <span style={{ width: 26, textAlign: "right", color: gradeColor(letter) }}>{letter}</span>
                      </div>
                    ))}
                  </div>
                  {takes[h.team] && (
                    <div style={{ padding: "10px 16px", background: "rgba(246,162,29,0.1)", fontFamily: BODY, fontSize: 13, lineHeight: 1.4 }}>
                      <span style={{ color: GOLD, fontWeight: 900 }}>{takes[h.team].analyst.name}: </span>{takes[h.team].text}
                    </div>
                  )}
                </div>
              );
            }) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${Math.ceil(roundOne.length / 2) || 1}, auto)`, gridAutoFlow: "column", gap: 5 }}>
                {roundOne.map((p) => {
                  const pl = sim.byId[p.selection];
                  const b = data.branding[p.owner] || {};
                  return (
                    <div key={p.overall} style={{ display: "flex", gap: 8, alignItems: "center", background: b.Color1 || BLUE, borderRadius: 6, padding: "5px 8px", fontSize: 11 }}>
                      <span style={{ width: 18, opacity: 0.75 }}>{p.overall}</span>
                      <PlayerName p={pl} style={{ flex: 1, minWidth: 0, fontWeight: 900 }} />
                      <span style={{ opacity: 0.8 }}>{pl.Position}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ height: 3, background: GOLD }} />
          <div style={{ padding: 14, textAlign: "center", background: "rgba(0,0,0,0.2)", color: GOLD, fontSize: 16, fontWeight: 900, letterSpacing: "0.04em" }}>WE-DRAFT.COM/DRAFTSIM</div>
        </div>
      </div>

      {open && isMobile && <MobileShareSheet text={text} onClose={() => setOpen(false)} />}
      {open && !isMobile && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 16, maxWidth: 460, width: "100%", maxHeight: "calc(90vh / var(--pz, 1))", overflowY: "auto", padding: 20, boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ color: BLUE, fontWeight: 900, fontSize: 14, letterSpacing: "0.06em" }}>SHARE YOUR DRAFT</div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "#999", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <img src={image} alt="Draft sim results" style={{ width: "100%", display: "block", borderRadius: 10, marginBottom: 16 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <button onClick={saveImage} style={{ ...shareLink, background: BLUE, color: "#fff" }}>💾 Save</button>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" style={shareLink}>𝕏 Post</a>
              <a href={`sms:?&body=${encodeURIComponent(text)}`} style={shareLink}>💬 Message</a>
            </div>
            <div style={{ color: "#888", fontSize: 11, fontFamily: BODY, marginTop: 10 }}>Save the image, then attach it to your post or message.</div>
          </div>
        </div>
      )}
    </>
  );
}

// The phone's share sheet: up from the bottom in the sim's colors, the
// message as it'll be sent, and two big buttons — X and Messages.
function MobileShareSheet({ text, onClose }) {
  const big = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, padding: "15px 12px", fontWeight: 900, fontSize: 15, letterSpacing: "0.04em", textDecoration: "none", fontFamily: "inherit" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 10002, display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} className="wd-sim-in" style={{
        width: "100%", background: "#0e1626", borderTop: `3px solid ${GOLD}`, borderRadius: "20px 20px 0 0",
        padding: "10px 16px calc(18px + env(safe-area-inset-bottom))", boxSizing: "border-box", boxShadow: "0 -16px 40px rgba(0,0,0,0.5)",
      }}>
        <div aria-hidden="true" style={{ width: 42, height: 5, borderRadius: 999, background: "#2a3753", margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: 18, letterSpacing: "0.04em" }}>SHARE YOUR DRAFT</div>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "#1a2438", border: "none", color: "#9fb0c8", width: 32, height: 32, borderRadius: "50%", fontSize: 18, lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>
        <div className="wd-sim-scroll" style={{ background: "#070d18", border: "1px solid #1f2b42", borderRadius: 12, padding: "12px 14px", maxHeight: "38vh", overflowY: "auto", color: "#dbe4f0", fontFamily: BODY, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-line", marginBottom: 14 }}>
          {text}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" style={{ ...big, background: "#000", color: "#fff", border: "1px solid #2f3336" }}>𝕏 Post</a>
          <a href={`sms:?&body=${encodeURIComponent(text)}`} style={{ ...big, background: "#2ea043", color: "#fff" }}>💬 Message</a>
        </div>
      </div>
    </div>
  );
}
