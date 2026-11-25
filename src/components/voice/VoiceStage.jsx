// src/components/voice/VoiceStage.jsx
//
// /voice's pictures (user, 2026-11-25): the We-Draft.com circle logo is the
// button — tap it to talk; it pulses while it listens, spins while it
// thinks, and beats with each word while it talks. Under it, the answer as
// graphics: a player snapshot (headshot, school, size, class), the numbers
// as tiles, what changed (before → after) when something was edited, and
// where to go next (his page, Compare, the team page…). Phones: one column.
//
//   <Orb mode="idle" | "listening" | "thinking" | "speaking" beat={n} size onClick />
//   <Stage item={{ said, reply }} pending busy voiceMode onPick onConfirm onNext onAsk />
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useHeadshot } from "../draftSim/simHeadshots";
import { useSchools } from "../DraftArchiveList";
import { portalTeamSlug } from "../../utils/portalTeams";

export const V = { bg: "#0b1220", panel: "#121b2e", panel2: "#0f172a", line: "#24324d", ink: "#eef2f8", soft: "#8f9db5", gold: "#f6a21d", blue: "#0055a5", sky: "#3b82f6", good: "#4ade80", bad: "#ff8a80" };
const TONE = { answer: V.ink, done: V.good, ask: V.gold, miss: V.bad };

// ── The animations, once ──
const CSS = `
.wdv-orb{position:relative;border:none;padding:0;background:transparent;cursor:pointer;border-radius:50%;-webkit-tap-highlight-color:transparent;transition:width .35s ease,height .35s ease}
.wdv-orb img{position:relative;z-index:2;width:100%;height:100%;border-radius:50%;display:block;user-select:none;-webkit-user-drag:none}
.wdv-orb .wdv-face{position:relative;z-index:2;width:100%;height:100%;border-radius:50%}
.wdv-orb::before,.wdv-orb::after{content:"";position:absolute;inset:0;border-radius:50%;z-index:1;pointer-events:none}
.wdv-idle .wdv-face{animation:wdvBreathe 3.6s ease-in-out infinite}
.wdv-idle::before{box-shadow:0 0 0 0 rgba(246,162,29,.0);animation:wdvGlow 3.6s ease-in-out infinite}
.wdv-listening::before,.wdv-listening::after{border:3px solid #f6a21d;animation:wdvRipple 1.6s ease-out infinite}
.wdv-listening::after{animation-delay:.8s}
.wdv-listening .wdv-face{animation:wdvBreathe 1.2s ease-in-out infinite}
.wdv-thinking::before{inset:-7px;background:conic-gradient(from 0deg,#f6a21d,transparent 40%,#3b82f6 60%,transparent 85%,#f6a21d);animation:wdvSpin 1s linear infinite;-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px))}
.wdv-speaking::before,.wdv-speaking::after{border:3px solid #3b82f6;animation:wdvRipple 1.3s ease-out infinite}
.wdv-speaking::after{animation-delay:.65s}
.wdv-standby::before{border:2px solid rgba(74,222,128,.75);animation:wdvRipple 3s ease-out infinite}
.wdv-standby .wdv-face{animation:wdvBreathe 4.5s ease-in-out infinite}
.wdv-beat{animation:wdvBeat .28s ease-out}
@keyframes wdvBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
@keyframes wdvGlow{0%,100%{box-shadow:0 0 18px 2px rgba(246,162,29,.18)}50%{box-shadow:0 0 34px 8px rgba(246,162,29,.32)}}
@keyframes wdvRipple{0%{transform:scale(1);opacity:.85}100%{transform:scale(1.55);opacity:0}}
@keyframes wdvSpin{to{transform:rotate(360deg)}}
@keyframes wdvBeat{0%{transform:scale(1)}40%{transform:scale(1.07)}100%{transform:scale(1)}}
@keyframes wdvIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.wdv-in{animation:wdvIn .35s ease-out both}
.wdv-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.wdv-hero{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center}
.wdv-ctas{display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:600px){
  .wdv-hero{grid-template-columns:1fr;justify-items:center;text-align:center;gap:12px}
  .wdv-hero .wdv-chips{justify-content:center}
  .wdv-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .wdv-ctas{flex-direction:column}
  .wdv-ctas>*{text-align:center}
}
@media (prefers-reduced-motion:reduce){.wdv-orb::before,.wdv-orb::after,.wdv-orb .wdv-face,.wdv-in{animation:none!important}}
`;
function useCss() {
  useEffect(() => {
    if (document.getElementById("wdv-css")) return;
    const el = document.createElement("style");
    el.id = "wdv-css";
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
}

/** The We-Draft.com circle logo — the button. */
export function Orb({ mode = "idle", beat = 0, size = 128, onClick, label }) {
  useCss();
  const [bump, setBump] = useState(false);
  // A beat on each spoken word: restart the little scale bump.
  useEffect(() => {
    if (mode !== "speaking" || !beat) return undefined;
    setBump(false);
    const t = requestAnimationFrame(() => setBump(true));
    return () => cancelAnimationFrame(t);
  }, [beat, mode]);
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`wdv-orb wdv-${mode}`} style={{ width: size, height: size }}>
      <div className={`wdv-face${bump && mode === "speaking" ? " wdv-beat" : ""}`} onAnimationEnd={() => setBump(false)}>
        <img src="/wd-icon-512.png" alt="We-Draft.com" draggable={false} />
      </div>
    </button>
  );
}

// ── Pieces ──
const card = { background: V.panel, border: `1px solid ${V.line}`, borderRadius: 18, padding: 18 };
const chip = { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: V.panel2, border: `1px solid ${V.line}`, fontSize: 13, fontWeight: 800, color: V.ink };
const btn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 16px", borderRadius: 12, border: `1px solid ${V.line}`, background: V.panel2, color: V.ink, fontWeight: 900, fontSize: 14, textDecoration: "none", cursor: "pointer" };

const heightText = (h) => { const m = String(h || "").match(/^(\d)'(\d+)/); return m ? `${m[1]}'${m[2]}"` : h || ""; };
const weightText = (w) => (w ? `${String(w).replace(/\s*lbs?$/i, "")} lbs` : "");

function Headshot({ player, ring, size }) {
  const wd = useHeadshot(player?.cfbdOnly ? null : player?.id);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [player?.id]);
  // A CFBD-only player: ESPN's college headshot (his CFBD id is ESPN's on FBS rosters).
  const url = player?.cfbdOnly ? (player.cfbd ? `https://a.espncdn.com/i/headshots/college-football/players/full/${player.cfbd}.png` : "") : wd;
  const initials = `${(player?.First || "")[0] || ""}${(player?.Last || "")[0] || ""}`;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: `radial-gradient(circle at 50% 35%, ${ring || V.blue}55, ${V.panel2} 70%)`, border: `3px solid ${ring || V.gold}`, overflow: "hidden", display: "grid", placeItems: "center", flex: `0 0 ${size}px` }}>
      {url && !broken
        ? <img src={url} alt="" onError={() => setBroken(true)} style={{ width: "128%", marginTop: "18%", objectFit: "cover" }} />
        : <span style={{ fontSize: size * 0.34, fontWeight: 900, color: V.ink }}>{initials}</span>}
    </div>
  );
}

/** The player snapshot: headshot, name, school, size, class. */
function PlayerHero({ player, brand, isNow }) {
  const logo = brand?.LogoDark || brand?.Logo1 || "";
  const ring = brand?.Color1 || V.gold;
  const facts = [player.Height && ["Height", heightText(player.Height)], player.Weight && ["Weight", weightText(player.Weight)], player.Eligible && ["Class", player.Eligible], player.Hometown && ["From", player.Hometown]].filter(Boolean);
  return (
    <div className="wdv-hero">
      <Headshot player={player} ring={ring} size={isNow ? 112 : 64} />
      <div style={{ minWidth: 0, display: "grid", gap: 8 }}>
        <div style={{ fontSize: isNow ? 30 : 18, fontWeight: 900, lineHeight: 1.05 }}>
          {player.Slug && !player.cfbdOnly ? <Link to={`/player/${player.Slug}`} style={{ color: "inherit", textDecoration: "none" }}>{player.First} {player.Last}</Link> : `${player.First || ""} ${player.Last || ""}`}
        </div>
        <div className="wdv-chips" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {player.Position && <span style={{ ...chip, background: ring, borderColor: ring, color: "#fff" }}>{player.Position}</span>}
          {player.School && <span style={chip}>{logo && <img src={logo} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}{player.School}</span>}
          {player.cfbdOnly && <span style={{ ...chip, color: V.soft }}>Not on We-Draft.com yet</span>}
        </div>
        {isNow && facts.length > 0 && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: V.soft, fontSize: 13, fontWeight: 800 }}>
            {facts.map(([k, v]) => <span key={k}>{k} <span style={{ color: V.ink }}>{v}</span></span>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** A team header: logo + name (team records, who to watch). */
function TeamHero({ name, brand, sub }) {
  const logo = brand?.LogoDark || brand?.Logo1 || "";
  return (
    <div className="wdv-hero">
      <div style={{ width: 84, height: 84, borderRadius: 18, background: brand?.Color1 || V.panel2, display: "grid", placeItems: "center", border: `1px solid ${V.line}` }}>
        {logo ? <img src={logo} alt="" style={{ width: 62, height: 62, objectFit: "contain" }} /> : <span style={{ fontWeight: 900, fontSize: 28 }}>{String(name || "?")[0]}</span>}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.05 }}>{name}</div>
        {sub && <div style={{ color: V.soft, fontWeight: 800, fontSize: 14 }}>{sub}</div>}
      </div>
    </div>
  );
}

/** The numbers: the first one big (what was asked), the rest as tiles. */
// lead: the first row is what was asked — it gets the big tile.
// Short values are tiles; long ones (a game, a list) go in a row list.
const isShort = ([, v]) => String(v ?? "").length <= 16;
function Tiles({ rows, accent, lead = true }) {
  const big = lead ? rows[0] : null;
  const rest = lead ? rows.slice(1) : rows;
  const tiles = rest.filter(isShort);
  const long = rest.filter((r) => !isShort(r));
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {big && (
        <div style={{ borderRadius: 16, padding: "16px 18px", background: `linear-gradient(135deg, ${accent || V.blue}, ${V.panel2})`, border: `1px solid ${V.line}` }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#ffffffcc" }}>{big[0]}</div>
          <div style={{ fontSize: String(big[1]).length > 14 ? 26 : 46, fontWeight: 900, lineHeight: 1.05, marginTop: 4 }}>{big[1]}</div>
        </div>
      )}
      {tiles.length > 0 && (
        <div className="wdv-tiles">
          {tiles.map(([k, v]) => (
            <div key={k} style={{ borderRadius: 14, padding: "12px 14px", background: V.panel2, border: `1px solid ${V.line}` }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: V.soft }}>{k}</div>
              <div style={{ fontSize: 24, fontWeight: 900, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {long.length > 0 && <RowList rows={long} />}
    </div>
  );
}

function RowList({ rows }) {
  return (
    <div style={{ display: "grid", gap: 1, borderRadius: 12, overflow: "hidden", border: `1px solid ${V.line}` }}>
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 14px", background: V.panel2, alignItems: "baseline" }}>
          <span style={{ color: V.soft, fontWeight: 800, fontSize: 14, minWidth: 0, overflowWrap: "anywhere" }}>{k}</span>
          <span style={{ fontWeight: 900, fontSize: 15, textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** What changed: before → after (asking), then saved. */
function ChangeCard({ change }) {
  const saved = !!change.saved;
  return (
    <div style={{ borderRadius: 16, border: `2px solid ${saved ? V.good : V.gold}`, background: saved ? "#0d2a1a" : "#2a210a", padding: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: saved ? V.good : V.gold }}>
        <span style={{ fontSize: 16 }}>{saved ? "✓" : "✎"}</span>{change.scope}{saved ? " · saved" : change.isNew ? " · new" : " · change"}
      </div>
      {(change.items || []).map((x, i) => (
        <div key={`${x.label}-${i}`} style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: V.soft, textTransform: "uppercase", letterSpacing: "0.06em" }}>{x.label}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 17, fontWeight: 900 }}>
            {x.from ? <span style={{ color: V.soft, textDecoration: "line-through", textDecorationThickness: 2 }}>{x.from}</span> : <span style={{ color: V.soft, fontSize: 13 }}>(none)</span>}
            <span style={{ color: saved ? V.good : V.gold }}>→</span>
            <span>{x.to || "(removed)"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Lists of players: a headshot each; tap one to ask about him ──
function PersonRow({ p, onAsk }) {
  const player = asPlayer(p);
  const askFor = player.School ? `who is ${player.School}'s ${player.First} ${player.Last}` : `who is ${player.First} ${player.Last}`;
  return (
    <button type="button" onClick={() => onAsk(askFor)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "8px 12px", background: V.panel2, border: "none", borderBottom: `1px solid ${V.line}`, color: V.ink, cursor: "pointer", textAlign: "left" }}>
      <Headshot player={player} size={40} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 900, fontSize: 15 }}>{player.First} {player.Last}</span>
        <span style={{ display: "block", color: V.soft, fontWeight: 700, fontSize: 12 }}>{[player.Position, player.School].filter(Boolean).join(" · ")}</span>
      </span>
      {p.note && <span style={{ fontWeight: 900, fontSize: 13, color: V.gold, textAlign: "right" }}>{p.note}</span>}
    </button>
  );
}
function PeopleList({ people, onAsk }) {
  return <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${V.line}` }}>{people.map((p, i) => <PersonRow key={`${p.id || p.first}-${i}`} p={p} onAsk={onAsk} />)}</div>;
}

// ── Games: logos, score or kickoff, a link to the game on /live ──
function GameCard({ g }) {
  const team = (t, won) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: g.status === "final" && !won ? 0.6 : 1 }}>
      {(t?.logoDark || t?.logo) ? <img src={t.logoDark || t.logo} alt="" style={{ width: 30, height: 30, objectFit: "contain" }} /> : <span style={{ width: 30 }} />}
      <span style={{ flex: 1, fontWeight: 900, fontSize: 16 }}>{t?.rank ? <span style={{ color: V.soft, fontSize: 12, marginRight: 4 }}>#{t.rank}</span> : null}{t?.school || t?.name}</span>
      {g.status !== "scheduled" && <span style={{ fontWeight: 900, fontSize: 22 }}>{t?.points ?? 0}</span>}
    </div>
  );
  const h = g.home || {};
  const a = g.away || {};
  const homeWon = (h.points ?? 0) > (a.points ?? 0);
  const status = g.status === "final" ? "Final" : g.status === "in_progress" ? `LIVE${g.period ? ` · Q${g.period}` : ""}${g.clock ? ` ${g.clock}` : ""}` : g.startTimeTBD ? "TBA" : new Date(g.startDate).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const body = (
    <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 14, background: V.panel2, border: `1px solid ${g.status === "in_progress" ? V.bad : V.line}`, color: V.ink }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", color: g.status === "in_progress" ? V.bad : V.soft }}>
        <span>{status}</span><span>{g.tv || ""}</span>
      </div>
      {team(a, !homeWon)}
      {team(h, homeWon)}
    </div>
  );
  return g.slug ? <Link to={`/live/${g.slug}`} style={{ textDecoration: "none" }}>{body}</Link> : body;
}

// ── Two players, side by side: each stat's two numbers, the higher one's bar full ──
function ComparePanel({ compare }) {
  const [a, b] = compare.players.map(asPlayer);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
        {[a, b].map((p, i) => (
          <div key={p.id} style={{ display: "grid", justifyItems: "center", gap: 6, textAlign: "center", gridColumn: i === 0 ? 1 : 3 }}>
            <Headshot player={p} size={72} ring={i === 0 ? V.gold : V.sky} />
            <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.1 }}>{p.First} {p.Last}</div>
            <div style={{ color: V.soft, fontWeight: 700, fontSize: 12 }}>{[p.Position, p.School].filter(Boolean).join(" · ")}</div>
          </div>
        ))}
        <div style={{ gridColumn: 2, gridRow: 1, fontWeight: 900, color: V.soft }}>vs</div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {compare.rows.map(([label, va, vb, ta, tb]) => {
          const max = Math.max(Math.abs(va || 0), Math.abs(vb || 0)) || 1;
          const bar = (v, color, left) => <div style={{ height: 6, borderRadius: 3, background: V.line, overflow: "hidden", display: "flex", justifyContent: left ? "flex-end" : "flex-start" }}><div style={{ width: `${v == null ? 0 : Math.round((Math.abs(v) / max) * 100)}%`, background: color }} /></div>;
          return (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
              <div style={{ display: "grid", gap: 4, textAlign: "right" }}><span style={{ fontWeight: 900, fontSize: 17, color: (va ?? -Infinity) >= (vb ?? -Infinity) ? V.ink : V.soft }}>{ta}</span>{bar(va, V.gold, true)}</div>
              <div style={{ fontSize: 11, fontWeight: 900, color: V.soft, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center", maxWidth: 110 }}>{label}</div>
              <div style={{ display: "grid", gap: 4 }}><span style={{ fontWeight: 900, fontSize: 17, color: (vb ?? -Infinity) >= (va ?? -Infinity) ? V.ink : V.soft }}>{tb}</span>{bar(vb, V.sky, false)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── What to ask next (user, 2026-11-25): a few follow-ups that fit the answer ──
export function followUps(reply) {
  const id = reply?.intent || "";
  const p = asPlayer(reply?.player);
  if (reply?.confirm || reply?.tone === "miss") return [];
  if (p && (p.First || p.Last)) {
    const all = [
      ["stats.line", "his stats"], ["player.background", "his career path"], ["stats.max", "his best game"], ["live.player", "how is he doing today"],
      ["player.accolades", "his awards"], ["player.measure", "how big is he"],
      ...(p.cfbdOnly ? [] : [["player.rank", "where does he rank"], ["player.comps", "who does he compare to"]]),
    ];
    return all.filter(([i]) => i !== id).slice(0, 4).map(([, q]) => q);
  }
  if (/^(?:team\.|live\.score)/.test(id) && reply?.title) return ["who's playing today", "who's hot this week"];
  if (id === "live.today") return ["who's hot this week"];
  if (id === "risers.hot") return ["who's playing today"];
  return [];
}

// ── Where to go next ──
const STAT = /^(?:stats?\.|games\.best|stat\.)/;
export function linksFor(reply, { brand, voiceMode } = {}) {
  const p = asPlayer(reply?.player);
  const id = reply?.intent || "";
  const out = [];
  const add = (to, label, primary) => { if (to && !out.some((x) => x.to === to)) out.push({ to, label, primary }); };
  // The answer's own (a live game, the risers page, both compared players).
  (reply?.links || []).forEach((l) => add(l.to, l.label, l.primary));
  if (p && !p.cfbdOnly && p.Slug) {
    add(`/player/${p.Slug}`, `Open ${p.First || ""} ${p.Last || ""}'s page`.replace(/\s+/g, " "), true);
    if (STAT.test(id) || id === "player.comps" || id === "player.profile") add(`/comparison/${p.Slug}`, "Find his comparisons");
    if (["player.rank", "draft.projection", "community.traits"].includes(id) && p.Eligible && p.Position) add(`/community/${p.Eligible}/${String(p.Position).toLowerCase()}`, `${p.Eligible} ${p.Position} community board`);
  }
  const school = p?.School || (/^(?:team\.|watch\.)/.test(id) ? reply?.title : "");
  if (brand?.Slug && school) add(`/team/${brand.Slug}`, `${school} team page`, !p);
  if (school && (id.startsWith("team.") || p?.cfbdOnly)) add(`/portalsim/${portalTeamSlug(school)}`, `Portal Sim as ${school}`);
  if (/^(?:my\.|board\.mine|watchlist\.)/.test(id) || reply?.change?.scope?.startsWith("Your")) add("/profile", "My board");
  if (id === "board.community") add("/community", "Community board", true);
  if (/^draft\./.test(id) && id !== "draft.projection") add("/draftsim", "Run the Draft Sim");
  if (id === "draft.projection") add("/mocks", "Mock Draft Central");
  if (voiceMode === "admin" && id === "admin.requests") add("/admin?section=requests", "Open Requests", true);
  if (voiceMode === "admin" && id === "admin.readout") add("/admin?section=requests", "Open Requests");
  if (voiceMode === "admin" && (/^analytics\.|^admin\.readout/.test(id))) add("/admin?section=analytics", "Open Analytics", true);
  if (/^(?:request\.|feedback\.)/.test(id) || /Sent\./.test(reply?.say || "")) add("/profile", "My messages");
  return out.slice(0, 4);
}

/** The answer as graphics. */
// A reply's player is a players doc (First, Last…) or a name-list row (first, last…).
const asPlayer = (x) => (!x ? null : { ...x, First: x.First || x.first || "", Last: x.Last || x.last || "", Position: x.Position || x.pos || "", School: x.School || x.school || "", Eligible: x.Eligible || x.cls || "", Slug: x.Slug || x.slug || "" });

export function Stage({ item, pending, busy, voiceMode, onPick, onConfirm, onNext, onAsk, isNow = true }) {
  const r = item.reply || {};
  const p = asPlayer(r.player);
  const teamName = !p && /^(?:team\.|watch\.)/.test(r.intent || "") ? r.title : "";
  const brands = useSchools([p?.School, teamName].filter(Boolean));
  const brand = (p?.School && brands[p.School]) || (teamName && brands[teamName]) || null;
  const accent = brand?.Color1 || V.blue;
  const live = isNow && pending;
  const links = isNow ? linksFor(r, { brand, voiceMode }) : [];
  const rows = (r.rows || []).filter(([k, v]) => k && v != null && v !== "");
  const tiles = rows.length > 0 && (STAT.test(r.intent || "") || /^(?:analytics\.|admin\.readout|player\.measure|draft\.projection|team\.record)/.test(r.intent || "") || (!!p && rows.length <= 8));
  return (
    <div className={isNow ? "wdv-in" : ""} style={{ ...card, display: "grid", gap: 16, borderColor: isNow && brand?.Color1 ? `${brand.Color1}88` : V.line, padding: isNow ? 18 : 12 }}>
      {p ? <PlayerHero player={p} brand={brand} isNow={isNow} /> : teamName ? <TeamHero name={teamName} brand={brand} sub={r.sub} /> : r.title && (
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: isNow ? 26 : 17, fontWeight: 900, lineHeight: 1.1 }}>{r.title}</div>
          {r.sub && <div style={{ color: V.soft, fontWeight: 800, fontSize: 14 }}>{r.sub}</div>}
        </div>
      )}

      <div style={{ fontSize: isNow ? 20 : 14, fontWeight: 800, lineHeight: 1.4, color: TONE[r.tone] || V.ink }}>{r.say}</div>

      {r.change && <ChangeCard change={r.change} />}
      {r.compare && <ComparePanel compare={r.compare} />}
      {r.games?.length > 0 && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>{r.games.map((g) => <GameCard key={g.id} g={g} />)}</div>
      )}
      {r.people?.length > 0 && <PeopleList people={r.people} onAsk={onAsk} />}
      {!r.change && !r.compare && !r.people?.length && !(r.games?.length && !p) && rows.length > 0 && (tiles ? <Tiles rows={rows} accent={accent} lead={STAT.test(r.intent || "") || /^draft\.projection|^team\.record/.test(r.intent || "")} /> : <RowList rows={rows} />)}

      {r.body && <div style={{ padding: "12px 14px", borderRadius: 12, background: V.panel2, border: `1px solid ${V.line}`, fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>{r.body}</div>}

      {r.help && (
        <div style={{ display: "grid", gap: 10 }}>
          {r.help.map((h) => (
            <div key={h.title} style={{ borderTop: `1px solid ${V.line}`, paddingTop: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>{h.title}{h.mode === "admin" && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 900, color: "#1a1300", background: V.gold, borderRadius: 999, padding: "2px 7px", verticalAlign: "middle" }}>ADMIN</span>}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {h.examples.map((e) => <button key={e} type="button" onClick={() => onAsk(e)} style={{ ...chip, cursor: "pointer" }}>“{e}”</button>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {live && r.confirm && pending.kind === "confirm" && (
        <div className="wdv-ctas">
          <button type="button" disabled={busy} onClick={() => onConfirm(true)} style={{ ...btn, background: V.good, borderColor: V.good, color: "#052e12", fontSize: 16 }}>Yes (Y)</button>
          <button type="button" disabled={busy} onClick={() => onConfirm(false)} style={{ ...btn, fontSize: 16 }}>No (N)</button>
        </div>
      )}
      {live && r.hasMore && pending.kind === "more" && (
        <div><button type="button" disabled={busy} onClick={onNext} style={{ ...btn, background: V.sky, borderColor: V.sky, color: "#fff" }}>Next (say “next”)</button></div>
      )}
      {live && r.choices?.length > 0 && pending.kind === "choose" && (
        <div style={{ display: "grid", gap: 8 }}>
          {r.choices.map((c, i) => (
            <button key={c.id} type="button" disabled={busy} onClick={() => onPick(c)} style={{ ...btn, justifyContent: "flex-start", textAlign: "left", fontSize: 15 }}>
              <span style={{ color: V.gold, marginRight: 4 }}>{i + 1}</span>{c.label}
            </button>
          ))}
          {pending.teach && <div style={{ fontSize: 12, color: V.soft, fontWeight: 700 }}>Picking one teaches it: next time “{pending.said}” means him.</div>}
        </div>
      )}

      {isNow && !live && followUps(r).length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: V.soft, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 4 }}>Try</span>
          {followUps(r).map((q) => <button key={q} type="button" onClick={() => onAsk(q)} style={{ ...chip, cursor: "pointer", color: V.ink }}>“{q}”</button>)}
        </div>
      )}

      {links.length > 0 && (
        <div className="wdv-ctas">
          {links.map((l) => (
            <Link key={l.to} to={l.to} style={{ ...btn, ...(l.primary ? { background: accent, borderColor: accent, color: "#fff" } : {}) }}>{l.label} →</Link>
          ))}
        </div>
      )}
    </div>
  );
}
