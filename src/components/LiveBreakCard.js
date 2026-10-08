// src/components/LiveBreakCard.js
//
// The natural breaks of a live game — end of the 1st and 3rd quarters and
// halftime — turned into one card in /live's game feed. While play is
// stopped it takes over the top "next play" slot and rotates through a few
// panels (rotate); it's gone the moment the next snap is revealed. After
// that the same card stays in the play log as a static recap of the break,
// just above its end-of-period play.
//
// Everything on it is precomputed by the ingester (server/live/breaks.js,
// liveGames/{id}.breaks); the We-Pick panel is the one thing read here
// (the caller passes `pick`, the game's community picks summary).
//
// Panels are a list built per break (panelsFor) — every panel has the same
// footprint, so rotating never moves the page. Adding a kind is one more
// entry there. Team trivia (admin Branding > Trivia) rides along as a
// "Did you know?" panel (one fact) and in timeouts.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import WdWordmark from "../assets/Logo2.png";

const SITE_BLUE = "#0055a5";
const GOLD = "#f6a21d";
const ROTATE_MS = 11 * 1000;

const GRADE_BADGE = {
  "Watchlist":          { short: "W",   bg: "#5F5E5A", border: "#444441" },
  "Early First Round":  { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Late First Round":   { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Second Round":       { short: "2nd", bg: "#0F6E56", border: "#085041" },
  "Third Round":        { short: "3rd", bg: "#185FA5", border: "#0C447C" },
  "Fourth Round":       { short: "4th", bg: "#BA7517", border: "#854F0B" },
  "Fifth Round":        { short: "5th", bg: "#BA7517", border: "#854F0B" },
  "Sixth Round":        { short: "6th", bg: "#993C1D", border: "#712B13" },
  "Seventh Round":      { short: "7th", bg: "#993C1D", border: "#712B13" },
  "UDFA":               { short: "U",   bg: "#A32D2D", border: "#791F1F" },
};

const short = (t) => t?.short || t?.school || t?.name || "";
const logoOf = (t) => t?.logoDark || t?.logo || null;
const CAT = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defense: "Defense" };

export const BREAK_CARD_STYLE = `
.lbk { --ac: #2a4a7a; --hc: #7a2a2a; position: relative; margin-bottom: 10px; border-radius: 14px; overflow: hidden; color: #eef2f8;
  background: #0c1322; border: 1px solid #26324a; }
.lbk.live { box-shadow: 0 0 0 2px #eef2f8, 0 12px 34px -14px #4d9fff; }
.lbk-head { position: relative; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; padding: 12px 16px;
  background: linear-gradient(105deg, color-mix(in srgb, var(--ac) 70%, #0c1322) 0 49%, color-mix(in srgb, var(--hc) 70%, #0c1322) 51% 100%); }
.lbk-label { font-family: "Bebas Neue", system-ui, sans-serif; font-size: clamp(28px, 2.4vw, 38px); line-height: 0.9; letter-spacing: 0.03em; text-transform: uppercase; color: #fff; }
.lbk-label small { display: block; margin-top: 3px; font-family: system-ui, sans-serif; font-size: 10px; font-weight: 900; letter-spacing: 0.16em; color: rgba(255,255,255,0.75); }
.lbk-score { display: flex; align-items: center; justify-content: center; gap: 14px; font-weight: 900; font-variant-numeric: tabular-nums; }
.lbk-score .t { display: flex; align-items: center; gap: 7px; font-size: 15px; letter-spacing: 0.03em; }
.lbk-score .t img { width: 28px; height: 28px; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }
.lbk-score b { font-size: 30px; color: #fff; }
.lbk-score .t.lose { opacity: 0.7; }
.lbk-ls { border-collapse: collapse; font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.85); }
.lbk-ls th { font-size: 10px; font-weight: 900; letter-spacing: 0.1em; color: rgba(255,255,255,0.6); padding: 0 6px; }
.lbk-ls td { padding: 1px 6px; text-align: center; }
.lbk-ls td:first-child { text-align: left; }
.lbk-body { position: relative; padding: 14px 16px 12px; }
.lbk.live .lbk-body, .lbk.rot .lbk-body { min-height: 236px; }
.lbk-panel { animation: lbk-in 0.45s ease-out; }
@keyframes lbk-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
.lbk-pt { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 11px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase;
  color: #0a0f1a; background: #eef2f8; border-radius: 999px; padding: 3px 10px; }
.lbk-pt img { width: 15px; height: 15px; }
.lbk-pt.wd { background: ${SITE_BLUE}; color: #fff; }
/* team comparison */
.lbk-cmp { display: grid; grid-template-columns: 1fr auto 1fr; gap: 5px 12px; align-items: center; font-variant-numeric: tabular-nums; }
.lbk-cmp .h { font-size: 12px; font-weight: 900; letter-spacing: 0.06em; color: #9fb0c8; display: flex; align-items: center; gap: 6px; }
.lbk-cmp .h img { width: 18px; height: 18px; object-fit: contain; }
.lbk-cmp .h.home { justify-content: flex-end; }
.lbk-cmp .k { text-align: center; font-size: 11px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: #6f819c; white-space: nowrap; }
.lbk-cmp .v { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 900; color: #fff; }
.lbk-cmp .v.home { flex-direction: row-reverse; }
.lbk-cmp .v i { height: 6px; border-radius: 3px; background: var(--c); opacity: 0.85; min-width: 3px; }
.lbk-cmp .v.dim { color: #8193ad; }
/* people rows */
.lbk-rows { display: flex; flex-direction: column; gap: 8px; }
.lbk-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lbk-row img.l { width: 26px; height: 26px; object-fit: contain; flex-shrink: 0; }
.lbk-row .k { flex: 0 0 82px; font-size: 10px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #6f819c; }
.lbk-row .n { font-size: 17px; font-weight: 900; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lbk-row a.n { text-decoration: none; } .lbk-row a.n:hover { text-decoration: underline; }
.lbk-row .s { margin-left: auto; font-size: 14px; font-weight: 800; color: #c9d5e6; white-space: nowrap; font-variant-numeric: tabular-nums; }
.lbk-top { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #1d2840; }
.lbk-top .k { font-size: 10px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: ${GOLD}; }
.lbk-top .n { font-size: 16px; font-weight: 900; color: #fff; }
.lbk-top .s { font-size: 13px; font-weight: 800; color: #c9d5e6; }
.lbk-moments { display: flex; flex-direction: column; gap: 10px; }
.lbk-moment { border-left: 3px solid var(--c); padding-left: 10px; }
.lbk-moment b { display: block; font-size: 12px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb0c8; }
.lbk-moment span { font-size: 18px; font-weight: 900; color: #fff; line-height: 1.25; }
/* prospects (site blue) */
.lbk-pros { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.lbk-pro { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; text-decoration: none; color: #fff; min-width: 0;
  background: linear-gradient(155deg, ${SITE_BLUE}, #003b78 80%); border: 1px solid rgba(255,255,255,0.14); }
.lbk-pro:hover { border-color: rgba(255,255,255,0.4); }
.lbk-badge { flex-shrink: 0; width: 42px; padding: 6px 0; border-radius: 5px; border: 2px solid; text-align: center; font-size: 16px; font-weight: 900; color: #fff; }
.lbk-pro .i { min-width: 0; display: flex; flex-direction: column; }
.lbk-pro .n { font-size: 15px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lbk-pro .m { font-size: 10px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.7); display: flex; gap: 6px; align-items: center; }
.lbk-pro .m img { width: 14px; height: 14px; object-fit: contain; }
.lbk-pro .m .r { color: ${GOLD}; }
.lbk-pro .s { font-size: 12px; font-weight: 800; color: #dbe7f6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lbk-pro .s.none { color: rgba(255,255,255,0.5); font-weight: 700; }
/* We-Pick */
.lbk-pick-big { font-size: 26px; font-weight: 900; color: #fff; font-variant-numeric: tabular-nums; }
.lbk-pick-big small { display: block; font-size: 11px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #9fb0c8; margin-bottom: 2px; }
.lbk-split { display: flex; height: 12px; border-radius: 6px; overflow: hidden; margin: 12px 0 6px; background: #1d2840; }
.lbk-split i { display: block; height: 100%; }
.lbk-split-l { display: flex; justify-content: space-between; font-size: 13px; font-weight: 900; color: #c9d5e6; }
.lbk-note { margin-top: 10px; font-size: 13px; font-weight: 700; color: #9fb0c8; }
/* chat + promo */
.lbk-ask { font-size: clamp(20px, 1.7vw, 26px); font-weight: 900; color: #fff; line-height: 1.2; }
.lbk-btn { display: inline-flex; align-items: center; gap: 8px; margin-top: 14px; padding: 10px 16px; border-radius: 999px; border: 0; cursor: pointer; font-family: inherit;
  font-size: 13px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; text-decoration: none; background: #eef2f8; color: #0a0f1a; }
.lbk-btn:hover { background: #fff; }
.lbk-promo { display: flex; flex-direction: column; justify-content: center; min-height: 190px; border-radius: 12px; padding: 18px 20px;
  background: linear-gradient(140deg, ${SITE_BLUE}, #003b78 70%); border: 1px solid rgba(255,255,255,0.16); }
.lbk-promo img { height: 26px; width: auto; align-self: flex-start; margin-bottom: 12px; }
.lbk-promo .lbk-ask { max-width: 560px; }
.lbk-promo .lbk-btn { align-self: flex-start; background: ${GOLD}; color: #0a0f1a; }
.lbk-promo .lbk-btn:hover { background: #ffb53d; }
/* rotation controls */
.lbk-foot { display: flex; align-items: center; gap: 10px; padding: 0 16px 12px; }
.lbk-dots { display: flex; gap: 6px; }
.lbk-dots button { width: 8px; height: 8px; padding: 0; border-radius: 50%; border: 0; cursor: pointer; background: #33415c; }
.lbk-dots button.on { background: #eef2f8; width: 22px; border-radius: 4px; }
.lbk-arrows { margin-left: auto; display: flex; gap: 6px; }
.lbk-arrows button { width: 30px; height: 30px; border-radius: 50%; border: 1px solid #26324a; background: transparent; color: #c9d5e6; cursor: pointer; font-size: 15px; font-weight: 900; }
.lbk-arrows button:hover { background: #172238; }
.lbk-prog { position: absolute; left: 0; bottom: 0; height: 2px; background: rgba(238,242,248,0.5); animation: lbk-prog linear forwards; }
@keyframes lbk-prog { from { width: 0; } to { width: 100%; } }
@media (max-width: 640px) {
  .lbk-head { grid-template-columns: 1fr auto; }
  .lbk-ls { display: none; }
  .lbk-pros { grid-template-columns: 1fr; }
  .lbk-row .k { flex-basis: 64px; }
  .lbk-row .s { font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) { .lbk-panel, .lbk-prog { animation: none; } }
/* a timeout's one extra line (inside the "TIMEOUT" next-play box) */
.lto { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #1d2840; min-width: 0; }
.lto-k { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #b8a6ff; }
.lto-k.wd { color: #7fb4ff; }
.lto-k img { width: 14px; height: 14px; }
.lto img.l { width: 22px; height: 22px; object-fit: contain; flex-shrink: 0; }
.lto-t { font-size: clamp(15px, 1.15vw, 18px); font-weight: 900; color: #eef2f8; min-width: 0; }
.lto-b { flex-shrink: 0; min-width: 36px; padding: 3px 5px; border-radius: 4px; border: 2px solid; text-align: center; font-size: 13px; font-weight: 900; color: #fff; }
.lto a { color: #fff; text-decoration: none; } .lto a:hover { text-decoration: underline; }
.lto-t.wrap { font-size: clamp(14px, 1.05vw, 16px); font-weight: 800; line-height: 1.35; }
.lbk-trivia { display: flex; flex-direction: column; gap: 14px; }
.lbk-fact { display: flex; gap: 12px; align-items: flex-start; }
.lbk-fact img { width: 34px; height: 34px; object-fit: contain; flex-shrink: 0; }
.lbk-fact span { font-size: clamp(17px, 1.35vw, 21px); font-weight: 800; color: #fff; line-height: 1.35; }
.lto-m { font-size: 13px; font-weight: 800; color: #9fb0c8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

// ── Timeouts ── one extra line in the "TIMEOUT" box, chosen here from what
// the ingester keeps on the game doc (teamNow, prospects — server/live/
// breaks.js timeoutExtras). On 3rd / 4th down: how the offense has done on
// that down tonight. Otherwise a We-Draft prospect in the game, a different
// one each timeout (seed = the play the timeout follows).
const hashStr = (x) => { let h = 0; for (const c of String(x || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
export function pickTimeoutTip({ situation: s, game, teamNow, prospects, trivia = [], seed }) {
  const off = s?.offense;
  if (off && (s.down === 3 || s.down === 4) && teamNow?.[off]) {
    const [c, a] = (s.down === 3 ? teamNow[off].third : teamNow[off].fourth) || [0, 0];
    if (a >= (s.down === 3 ? 3 : 1)) {
      return { kind: "stat", side: off, text: `${game[off]?.school || short(game[off])} is ${c}/${a} on ${s.down === 3 ? "third" : "fourth"} down tonight` };
    }
  }
  const list = prospects || [];
  const played = list.filter((p) => p.line);
  const pool = [
    ...(played.length >= 2 ? played : list).map((p) => ({ kind: "prospect", p })),
    ...(trivia || []).map((t) => ({ kind: "trivia", side: t.side, text: t.text })),
  ];
  return pool.length ? pool[hashStr(seed) % pool.length] : null;
}

export function TimeoutTip({ tip, game }) {
  if (!tip) return null;
  if (tip.kind === "trivia") {
    return (
      <div className="lto">
        <span className="lto-k">Did you know?</span>
        {logoOf(game[tip.side]) && <img className="l" src={logoOf(game[tip.side])} alt="" />}
        <span className="lto-t wrap">{tip.text}</span>
      </div>
    );
  }
  if (tip.kind === "stat") {
    return (
      <div className="lto">
        <span className="lto-k">Tonight</span>
        {logoOf(game[tip.side]) && <img className="l" src={logoOf(game[tip.side])} alt="" />}
        <span className="lto-t">{tip.text}</span>
      </div>
    );
  }
  const p = tip.p;
  const label = p.grade || "Watchlist";
  const b = GRADE_BADGE[label] || GRADE_BADGE.Watchlist;
  return (
    <div className="lto">
      <span className="lto-k wd"><img src="/wd-icon.png" alt="" />Prospect to watch</span>
      <span className="lto-b" style={{ background: b.bg, borderColor: b.border }} title={label}>{b.short}</span>
      {logoOf(game[p.side]) && <img className="l" src={logoOf(game[p.side])} alt="" />}
      <span className="lto-t"><Link to={`/player/${p.slug}`} target="_blank" rel="noopener noreferrer">{p.name}</Link></span>
      <span className="lto-m">{[p.pos, p.cls].filter(Boolean).join(" · ")}{p.classRank ? ` · No. ${p.classRank} in class` : ""} · {p.line || `${label} grade`}</span>
    </div>
  );
}

// ── Panels ──────────────────────────────────────────────────────────────

function Compare({ brk, game }) {
  const H = brk.teams?.home || {}, A = brk.teams?.away || {};
  const rows = [
    ["Total yards", A.totalYds, H.totalYds],
    ["Passing", A.passYds, H.passYds],
    ["Rushing", A.rushYds, H.rushYds],
    ["First downs", A.firstDowns, H.firstDowns],
    ["3rd down", A.third ? `${A.third[0]}/${A.third[1]}` : null, H.third ? `${H.third[0]}/${H.third[1]}` : null, A.third && A.third[1] ? A.third[0] / A.third[1] : 0, H.third && H.third[1] ? H.third[0] / H.third[1] : 0],
    ["Turnovers", A.turnovers, H.turnovers, -(A.turnovers || 0), -(H.turnovers || 0)],
  ].filter((r) => r[1] != null || r[2] != null);
  const cell = (side, v, mine, theirs, max) => {
    const better = mine > theirs;
    return (
      <div className={`v ${side}${better ? "" : " dim"}`} style={{ "--c": game[side]?.color || "#4d9fff" }}>
        {v ?? "–"}
        {typeof v === "number" && max > 0 && <i style={{ width: `${Math.max(4, (Math.max(0, v) / max) * 90)}px` }} />}
      </div>
    );
  };
  return (
    <div className="lbk-cmp">
      <div className="h">{logoOf(game.away) && <img src={logoOf(game.away)} alt="" />}{short(game.away)}</div>
      <div />
      <div className="h home">{short(game.home)}{logoOf(game.home) && <img src={logoOf(game.home)} alt="" />}</div>
      {rows.map(([k, a, h, av = a, hv = h]) => {
        const max = Math.max(Number(a) || 0, Number(h) || 0);
        return [
          <div key={`${k}a`}>{cell("away", a, av ?? 0, hv ?? 0, typeof a === "number" ? max : 0)}</div>,
          <div key={`${k}k`} className="k">{k}</div>,
          <div key={`${k}h`}>{cell("home", h, hv ?? 0, av ?? 0, typeof h === "number" ? max : 0)}</div>,
        ];
      })}
    </div>
  );
}

function Name({ p, className = "n" }) {
  return p.slug
    ? <Link className={className} to={`/player/${p.slug}`} target="_blank" rel="noopener noreferrer">{p.name}</Link>
    : <span className={className}>{p.name}</span>;
}

function Leaders({ brk, game }) {
  return (
    <div className="lbk-rows">
      {["passing", "rushing", "receiving"].map((cat) => {
        const e = brk.leaders?.[cat];
        if (!e) return null;
        return (
          <div key={cat} className="lbk-row">
            <span className="k">{CAT[cat]}</span>
            {logoOf(game[e.side]) && <img className="l" src={logoOf(game[e.side])} alt="" />}
            <Name p={e} />
            <span className="s">{e.line}</span>
          </div>
        );
      })}
    </div>
  );
}

function TopLine({ brk, game, label }) {
  const t = brk.top;
  if (!t) return null;
  return (
    <div className="lbk-top">
      <span className="k">{label}</span>
      {logoOf(game[t.side]) && <img src={logoOf(game[t.side])} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />}
      <Name p={t} />
      <span className="s">{t.lines?.[0]?.[1]}</span>
    </div>
  );
}

function Moments({ brk, game }) {
  return (
    <div className="lbk-moments">
      {brk.moments.map((m, i) => (
        <div key={i} className="lbk-moment" style={{ "--c": game[m.side]?.color || "#4d9fff" }}>
          <b>{m.title}</b><span>{m.context}</span>
        </div>
      ))}
    </div>
  );
}

function Prospects({ brk, game }) {
  return (
    <div className="lbk-pros">
      {brk.prospects.map((p) => {
        const label = p.grade || "Watchlist";
        const b = GRADE_BADGE[label] || GRADE_BADGE.Watchlist;
        return (
          <Link key={p.slug} className="lbk-pro" to={`/player/${p.slug}`} target="_blank" rel="noopener noreferrer" title={`${p.name} — ${label}`}>
            <span className="lbk-badge" style={{ background: b.bg, borderColor: b.border }}>{b.short}</span>
            <span className="i">
              <span className="n">{p.name}</span>
              <span className="m">{logoOf(game[p.side]) && <img src={logoOf(game[p.side])} alt="" />}{[p.pos, p.cls].filter(Boolean).join(" · ")}{p.classRank ? <span className="r">No. {p.classRank}</span> : null}</span>
              <span className={`s${p.line ? "" : " none"}`}>{p.line || "No stats yet tonight"}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function WePick({ pick, game }) {
  const a = pick.split.away, h = pick.split.home;
  const tot = a + h || 1;
  return (
    <div>
      {pick.avg && <div className="lbk-pick-big"><small>Fans predicted</small>{short(game.away)} {pick.avg.away} – {short(game.home)} {pick.avg.home}</div>}
      <div className="lbk-split">
        <i style={{ width: `${(100 * a) / tot}%`, background: game.away?.color || "#2a4a7a" }} />
        <i style={{ width: `${(100 * h) / tot}%`, background: game.home?.color || "#7a2a2a" }} />
      </div>
      <div className="lbk-split-l"><span>{Math.round((100 * a) / tot)}% picked {short(game.away)}</span><span>{Math.round((100 * h) / tot)}% picked {short(game.home)}</span></div>
      <div className="lbk-note">{pick.mine ? `Your pick: ${short(game.away)} ${pick.mine.away} – ${short(game.home)} ${pick.mine.home}` : `${a + h} We-Pick ${a + h === 1 ? "pick" : "picks"} on this game`}</div>
    </div>
  );
}

// The panels for one break, in rotation order. (Team trivia joins here.)
// One fact (either team), a different pick each break.
function triviaFor(brk, trivia) {
  const list = trivia || [];
  return list.length ? [list[hashStr(brk.key) % list.length]] : [];
}

function panelsFor(brk, game, { pick, onChat, trivia }) {
  const half = brk.key === "half";
  const P = [];
  if (half) {
    P.push({ key: "report", tag: "Halftime report", body: <><Compare brk={brk} game={game} /><TopLine brk={brk} game={game} label="Top performer" /></> });
    if (brk.leaders && Object.keys(brk.leaders).length) P.push({ key: "leaders", tag: "First-half leaders", body: <Leaders brk={brk} game={game} /> });
    if (brk.moments?.length) P.push({ key: "moments", tag: "What mattered", body: <Moments brk={brk} game={game} /> });
    if (brk.prospects?.length) P.push({ key: "prospects", tag: "We-Draft prospects in this game", wd: true, body: <Prospects brk={brk} game={game} /> });
    if (pick && pick.split.away + pick.split.home > 0) P.push({ key: "pick", tag: "We-Pick", body: <WePick pick={pick} game={game} /> });
  } else {
    P.push({ key: "recap", tag: `${brk.period === 1 ? "1st" : "3rd"} quarter`, body: <><Compare brk={brk} game={game} /><TopLine brk={brk} game={game} label="Player of the quarter" /></> });
    if (brk.moments?.length) P.push({ key: "moments", tag: "What mattered", body: <Moments brk={brk} game={game} /> });
  }
  const facts = triviaFor(brk, trivia);
  if (facts.length) {
    P.push({
      key: "trivia", tag: "Did you know?",
      body: (
        <div className="lbk-trivia">
          {facts.map((f) => <div key={f.id || f.text} className="lbk-fact">{logoOf(game[f.side]) && <img src={logoOf(game[f.side])} alt="" />}<span>{f.text}</span></div>)}
        </div>
      ),
    });
  }
  if (onChat) {
    // "Who's been better" only when both sides have a player having a
    // genuinely good game; no "who will win" question in a blowout.
    const a = brk.standouts?.away, h = brk.standouts?.home;
    const blowout = Math.abs((brk.score?.home ?? 0) - (brk.score?.away ?? 0)) >= 21;
    const ask = a && h ? `Who's been better so far — ${a.name} or ${h.name}?`
      : blowout ? "Talk about the game with other fans in the game chat."
        : half ? "What changes in the second half?" : "Who will win today?";
    P.push({ key: "chat", tag: "Game chat", body: <div><div className="lbk-ask">{ask}</div><button type="button" className="lbk-btn" onClick={onChat}>💬 Join the chat</button></div> });
  }
  P.push({
    key: "promo", tag: "We-Draft.com", wd: true,
    body: (
      <div className="lbk-promo">
        <img src={WdWordmark} alt="We-Draft.com" />
        <div className="lbk-ask">Evaluate players and create your own draft board on We-Draft.com.</div>
        <Link className="lbk-btn" to="/boards" target="_blank" rel="noopener noreferrer">Build your board →</Link>
      </div>
    ),
  });
  return P;
}

/**
 * brk: one entry of liveGames/{id}.breaks. game: the game (teams with colors
 * and logos). rotate: cycle the panels (the live slot, or a preview);
 * otherwise just the recap panel (the play log). live: it's the break
 * happening now (slot styling). pick: { split: { away, home }, avg, mine }
 * or null. onChat: opens the game's chat tab. trivia: both teams' trivia
 * ([{ side, text }], liveGames/{id}.trivia).
 */
export default function LiveBreakCard({ brk, game, rotate = false, live = false, pick = null, onChat = null, trivia = [] }) {
  const panels = panelsFor(brk, game, { pick, onChat, trivia });
  const shown = rotate ? panels : panels.slice(0, 1);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = shown.length;
  const at = i % n;
  useEffect(() => {
    if (!rotate || paused || n < 2) return undefined;
    const t = setTimeout(() => setI((x) => (x + 1) % n), ROTATE_MS);
    return () => clearTimeout(t);
  }, [rotate, paused, n, i]);
  const p = shown[at];
  const hp = brk.score?.home ?? 0, ap = brk.score?.away ?? 0;
  const q = brk.quarters || { home: [], away: [] };
  return (
    <div className={`lbk${live ? " live" : ""}${rotate ? " rot" : ""}`} style={{ "--ac": game.away?.color || "#2a4a7a", "--hc": game.home?.color || "#7a2a2a" }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="lbk-head">
        <div className="lbk-label">{brk.label}<small>{brk.key === "half" ? "Second half up next" : "Teams switch ends"}</small></div>
        <div className="lbk-score">
          <span className={`t${ap < hp ? " lose" : ""}`}>{logoOf(game.away) && <img src={logoOf(game.away)} alt="" />}{short(game.away)} <b>{ap}</b></span>
          <span className={`t${hp < ap ? " lose" : ""}`}><b>{hp}</b> {short(game.home)}{logoOf(game.home) && <img src={logoOf(game.home)} alt="" />}</span>
        </div>
        <table className="lbk-ls">
          <thead><tr><th />{q.home.map((_, k) => <th key={k}>Q{k + 1}</th>)}</tr></thead>
          <tbody>
            <tr><td>{short(game.away)}</td>{q.away.map((v, k) => <td key={k}>{v}</td>)}</tr>
            <tr><td>{short(game.home)}</td>{q.home.map((v, k) => <td key={k}>{v}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <div className="lbk-body">
        <div key={p.key} className="lbk-panel">
          <span className={`lbk-pt${p.wd ? " wd" : ""}`}>{p.wd && <img src="/wd-icon.png" alt="" />}{p.tag}</span>
          {p.body}
        </div>
        {rotate && n > 1 && !paused && <div key={`${p.key}-${i}`} className="lbk-prog" style={{ animationDuration: `${ROTATE_MS}ms` }} />}
      </div>
      {rotate && n > 1 && (
        <div className="lbk-foot">
          <div className="lbk-dots">{shown.map((x, k) => <button key={x.key} type="button" className={k === at ? "on" : ""} onClick={() => setI(k)} aria-label={x.tag} />)}</div>
          <div className="lbk-arrows">
            <button type="button" onClick={() => setI((x) => (x - 1 + n) % n)} aria-label="Previous">‹</button>
            <button type="button" onClick={() => setI((x) => (x + 1) % n)} aria-label="Next">›</button>
          </div>
        </div>
      )}
    </div>
  );
}
