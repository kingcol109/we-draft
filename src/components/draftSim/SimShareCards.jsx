// src/components/draftSim/SimShareCards.jsx
//
// The Draft Sim's share images, 9:16 for stories and phones: drawn off
// screen at 720 × 1280 and captured at 1.5× (1080 × 1920) by SimResults.jsx's
// ShareFlow.
//   SimReportStory — the user's draft: one team gets the full report card
//                    (logo, grade, needs met, every pick graded); two or
//                    three teams stack as compact cards.
//   BoardStory     — round one as a board, two columns of sixteen, for Mock
//                    Draft mode and a sim the user only watched.
// Logos are plain <img>s; ShareFlow inlines them (utils/exportImages.js)
// before the capture.
import { forwardRef } from "react";
import { textOn } from "../../utils/teamColors";
import { groupedNeeds, needName } from "../../utils/draftSim/engine";
import siteLogo from "../../assets/Logo2.png";

export const STORY_W = 720;
export const STORY_H = 1280;
const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const NAVY = "#071a33";
const BODY = "Arial, Helvetica, sans-serif";
const HEAVY = "'Arial Black', Arial, sans-serif";
const teamLogo = (b) => b?.LogoDark || b?.Logo1;
const schoolLogo = (p) => p?.logoDark || p?.logo;
export const gradeColor = (l) => (l.startsWith("A") ? "#3fb950" : l.startsWith("B") ? "#58a6ff" : l.startsWith("C") ? GOLD : "#f85149");
const clip = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
// The biggest size, up to max, that fits text in width — Arial Black runs
// about 0.8em a capital.
const fitSize = (text, max, width) => Math.max(16, Math.min(max, Math.floor(width / (text.length * 0.8))));

const Frame = forwardRef(function Frame({ background, children }, ref) {
  return (
    <div ref={ref} style={{ position: "relative", width: STORY_W, height: STORY_H, background, fontFamily: HEAVY, color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
});

// The site's wordmark along the top. center: the logo big across the
// middle, the eyebrow under it (the one-team hero); otherwise the logo left,
// a rule, the eyebrow right.
function TopBar({ eyebrow, center }) {
  if (center) {
    return (
      <div style={{ position: "relative", padding: "34px 40px 0", textAlign: "center" }}>
        <img src={siteLogo} alt="We-Draft.com" style={{ display: "block", width: 470, height: 41, objectFit: "contain", margin: "0 auto" }} />
        <div style={{ fontSize: 14, letterSpacing: "0.3em", marginLeft: "0.3em", marginTop: 12, color: "rgba(255,255,255,0.85)" }}>{eyebrow}</div>
      </div>
    );
  }
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, padding: "34px 40px 0" }}>
      <img src={siteLogo} alt="We-Draft.com" style={{ width: 370, height: 32, objectFit: "contain", objectPosition: "left center", flexShrink: 0 }} />
      <span style={{ flex: 1, height: 2, background: "rgba(255,255,255,0.22)" }} />
      <span style={{ fontSize: 13, letterSpacing: "0.2em", color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" }}>{eyebrow}</span>
    </div>
  );
}

function Footer({ left, right }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 40px", background: GOLD, color: NAVY, flexShrink: 0 }}>
      <span style={{ fontSize: 30, letterSpacing: "0.06em" }}>{left}</span>
      <span style={{ fontSize: 24, letterSpacing: "0.04em" }}>{right}</span>
    </div>
  );
}

// ── The user's draft. teams: [{ haul, brand, name }]; site: the sim's
// address, along the bottom. ──
export const SimReportStory = forwardRef(function SimReportStory({ year, teams, site }, ref) {
  const shown = teams.slice(0, 3);
  const extra = teams.length - shown.length;
  // Two or three teams: every row the same height, as tall as the picks
  // allow — the room left after each card's header and needs (~150 apiece).
  const maxRows = Math.floor(21 / Math.max(shown.length, 1));
  const totalRows = shown.reduce((n, t) => n + Math.max(1, Math.min(t.haul.rows.length, maxRows)), 0);
  const room = 1090 - shown.length * 150 - (extra > 0 ? 30 : 0);
  const rowH = Math.max(34, Math.min(86, Math.floor(room / Math.max(totalRows, 1))));
  if (shown.length === 1) {
    return (
      <Frame ref={ref} background="linear-gradient(180deg, #0a1a33 0%, #050d1c 100%)">
        <SoloReport {...shown[0]} eyebrow={`${year} NFL DRAFT SIM`} />
        <Footer left="MAKE YOURS" right={site} />
      </Frame>
    );
  }
  return (
    <Frame ref={ref} background={`linear-gradient(165deg, #0a2a52 0%, ${NAVY} 45%, #050d1c 100%)`}>
      <TopBar eyebrow={`${year} NFL DRAFT SIM`} />
      {(
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: "24px 32px" }}>
          {shown.map((t) => <CompactReport key={t.haul.team} {...t} maxRows={maxRows} rowH={rowH} />)}
          {extra > 0 && <div style={{ textAlign: "center", fontFamily: BODY, fontWeight: 700, fontSize: 16, color: "rgba(255,255,255,0.6)" }}>+ {extra} more team{extra > 1 ? "s" : ""}</div>}
        </div>
      )}
      <Footer left="MAKE YOURS" right={site} />
    </Frame>
  );
});

// One team: a hero in the team's colors — logo, city, name — with the
// grade on a plate across its bottom edge, then every pick. Everything
// scales with the class: a short one (three picks or fewer) gets the
// biggest hero and the tallest rows, a long one (twelve) the most compact,
// so a one-pick run and a seven-round haul both fill the frame.
const MAX_SOLO_ROWS = 12;
function SoloReport({ haul, brand, name, eyebrow }) {
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || GOLD;
  const ink = textOn(c1, c2);
  const rows = haul.rows.slice(0, MAX_SOLO_ROWS);
  const more = haul.rows.length - rows.length;
  const k = Math.max(0, Math.min(1, (MAX_SOLO_ROWS - Math.max(rows.length, 1)) / 9));
  const sz = (lo, hi) => Math.round(lo + (hi - lo) * k);
  const team = (brand.Team || name).toUpperCase();
  const teamSize = fitSize(team, sz(60, 104), 620);
  const letterSize = sz(62, 92);
  const plateH = letterSize + sz(16, 24) * 2 + 8;
  const gc = gradeColor(haul.letter);
  // One or two picks get a card each, the school logo up top; more, a row
  // each. A name shrinks to fit its line rather than cut off.
  const featured = rows.length > 0 && rows.length <= 2;
  const rowMax = sz(70, 130);
  const rowName = sz(21, 28);
  const rowLogo = sz(38, 58);
  const fullName = (p) => `${p.First} ${p.Last}`.toUpperCase();
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Hero */}
      <div style={{ position: "relative", flexShrink: 0, background: c1, color: ink, textAlign: "center", paddingBottom: Math.round(plateH / 2) + sz(22, 34), overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(125deg, transparent 0 54px, rgba(255,255,255,0.045) 54px 108px)" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.38) 100%)" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: c2 }} />
        <TopBar eyebrow={eyebrow} center />
        {teamLogo(brand) && <img src={teamLogo(brand)} alt="" style={{ position: "relative", display: "block", margin: `${sz(18, 36)}px auto 0`, width: "84%", height: sz(160, 270), objectFit: "contain", filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.35))" }} />}
        <div style={{ position: "relative", fontSize: sz(17, 24), letterSpacing: "0.32em", marginTop: sz(14, 24), marginLeft: "0.32em", opacity: 0.85 }}>{(brand.City || "").toUpperCase()}</div>
        <div style={{ position: "relative", fontSize: teamSize, lineHeight: 1, marginTop: 4, padding: "0 30px", ...clip }}>{team}</div>
      </div>
      {/* The grade, on a plate across the hero's edge */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center", marginTop: -Math.round(plateH / 2), flexShrink: 0 }}>
        <div style={{ height: plateH, boxSizing: "border-box", display: "flex", alignItems: "center", gap: sz(16, 22), padding: `0 ${sz(24, 34)}px`, background: "#0a1424", border: `4px solid ${gc}`, borderRadius: 22, boxShadow: "0 16px 36px rgba(0,0,0,0.5)" }}>
          <div style={{ textAlign: "left", fontSize: sz(14, 18), lineHeight: 1.2, letterSpacing: "0.22em", color: "rgba(255,255,255,0.8)" }}>DRAFT<br />GRADE</div>
          <div style={{ width: 3, alignSelf: "stretch", margin: "16px 0", background: "rgba(255,255,255,0.15)" }} />
          <div style={{ fontSize: letterSize, lineHeight: 1, color: gc }}>{haul.letter}</div>
        </div>
      </div>
      {/* The picks fill what's left */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: `${sz(20, 30)}px 40px 26px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 15, letterSpacing: "0.22em", color: GOLD }}>THE PICKS</span>
          <span style={{ flex: 1, height: 2, background: GOLD, opacity: 0.4 }} />
          <span style={{ fontSize: 13, letterSpacing: "0.16em", color: "rgba(255,255,255,0.6)" }}>{haul.rows.length} {haul.rows.length === 1 ? "PICK" : "PICKS"}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: sz(8, 12) }}>
          {rows.length === 0 && <div style={{ textAlign: "center", fontFamily: BODY, fontWeight: 700, fontSize: 22, color: "rgba(255,255,255,0.6)" }}>No picks — they traded out.</div>}
          {featured ? rows.map(({ pick, prospect, letter }) => (
            <div key={pick.overall} style={{ position: "relative", flex: "1 1 0", maxHeight: rows.length === 1 ? 440 : 290, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "20px 28px", borderRadius: 20, background: "rgba(255,255,255,0.055)", borderTop: `7px solid ${c2}`, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 18, left: 26, textAlign: "left", lineHeight: 1.05 }}>
                <div style={{ fontSize: 14, letterSpacing: "0.16em", color: "rgba(255,255,255,0.55)" }}>ROUND {pick.round}</div>
                <div style={{ fontSize: 44, color: GOLD }}>{pick.overall}</div>
              </div>
              <div style={{ position: "absolute", top: 14, right: 26, fontSize: 64, lineHeight: 1, color: gradeColor(letter) }}>{letter}</div>
              {schoolLogo(prospect) && <img src={schoolLogo(prospect)} alt="" style={{ width: rows.length === 1 ? 140 : 96, height: rows.length === 1 ? 140 : 96, objectFit: "contain", flexShrink: 0 }} />}
              <div style={{ fontSize: fitSize(fullName(prospect), rows.length === 1 ? 50 : 42, 600), lineHeight: 1.05, marginTop: 16, maxWidth: "100%", ...clip }}>{fullName(prospect)}</div>
              <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 22, color: "rgba(255,255,255,0.75)", marginTop: 8, ...clip }}>{prospect.Position} · {prospect.School}{pick.via ? ` · via ${pick.via}` : ""}</div>
            </div>
          )) : rows.map(({ pick, prospect, letter }) => (
            <div key={pick.overall} style={{ flex: "1 1 0", maxHeight: rowMax, minHeight: 0, display: "flex", alignItems: "center", gap: 18, paddingRight: 22, borderRadius: 16, background: "rgba(255,255,255,0.055)", borderLeft: `7px solid ${c2}`, overflow: "hidden" }}>
              <div style={{ width: 80, flexShrink: 0, textAlign: "center", lineHeight: 1.05 }}>
                <div style={{ fontSize: 12, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)" }}>RD {pick.round}</div>
                <div style={{ fontSize: Math.round(rowName * 1.1), color: GOLD }}>{pick.overall}</div>
              </div>
              {schoolLogo(prospect) ? <img src={schoolLogo(prospect)} alt="" style={{ width: rowLogo, height: rowLogo, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: rowLogo, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: fitSize(fullName(prospect), rowName, 410 - rowLogo), lineHeight: 1.1, ...clip }}>{fullName(prospect)}</div>
                <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: Math.round(rowName * 0.62), color: "rgba(255,255,255,0.7)", marginTop: 4, ...clip }}>{prospect.Position} · {prospect.School}{pick.via ? ` · via ${pick.via}` : ""}</div>
              </div>
              <div style={{ fontSize: Math.round(rowName * 1.35), color: gradeColor(letter), flexShrink: 0, minWidth: 48, textAlign: "right" }}>{letter}</div>
            </div>
          ))}
          {more > 0 && <div style={{ textAlign: "center", fontFamily: BODY, fontWeight: 700, fontSize: 16, color: "rgba(255,255,255,0.6)", flexShrink: 0 }}>+ {more} more pick{more > 1 ? "s" : ""}</div>}
        </div>
      </div>
    </div>
  );
}

function CompactReport({ haul, brand, name, maxRows, rowH }) {
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || GOLD;
  const rows = haul.rows.slice(0, maxRows);
  const more = haul.rows.length - rows.length;
  const g = groupedNeeds(haul.needs);
  const chips = [...g.met.map((n) => ({ key: n.key, ok: true })), ...g.late.map((n) => ({ key: n.key, ok: true })), ...g.open.map((n) => ({ key: n.key, ok: false }))].slice(0, 4);
  const big = rowH >= 60;
  const nameSize = rowH >= 72 ? 23 : rowH >= 52 ? 20 : 17;
  const logo = Math.min(42, rowH - 16);
  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", borderRadius: 18, overflow: "hidden", background: "rgba(5,13,28,0.6)", border: `2px solid ${c2}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", background: `linear-gradient(110deg, ${c1}, ${c1} 65%, ${c2} 150%)`, color: textOn(c1, c2) }}>
        {teamLogo(brand) && <img src={teamLogo(brand)} alt="" style={{ width: 54, height: 54, objectFit: "contain", flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: 28, lineHeight: 1, textTransform: "uppercase", ...clip }}>{name}</div>
        <div style={{ background: "rgba(5,13,28,0.72)", borderRadius: 12, padding: "4px 16px", border: `3px solid ${gradeColor(haul.letter)}`, color: gradeColor(haul.letter), fontSize: 36, lineHeight: 1.1 }}>{haul.letter}</div>
      </div>
      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "nowrap", gap: 6, padding: "10px 18px 4px", overflow: "hidden" }}>
          {chips.map((n) => (
            <span key={n.key} style={{ flexShrink: 0, fontFamily: BODY, fontWeight: 800, fontSize: 12, padding: "4px 9px", borderRadius: 999, background: n.ok ? "rgba(63,185,80,0.18)" : "rgba(248,81,73,0.18)", color: n.ok ? "#7ee28b" : "#ff9b94" }}>
              {n.ok ? "✓" : "✗"} {needName(n.key)}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", padding: "4px 0 8px" }}>
        {rows.map(({ pick, prospect, letter }) => (
          <div key={pick.overall} style={{ height: rowH, display: "flex", alignItems: "center", gap: 14, padding: "0 18px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ width: 58, flexShrink: 0, lineHeight: 1.05, textAlign: "center" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)" }}>RD {pick.round}</div>
              <div style={{ fontSize: big ? 22 : 17, color: GOLD }}>{pick.overall}</div>
            </div>
            {schoolLogo(prospect) ? <img src={schoolLogo(prospect)} alt="" style={{ width: logo, height: logo, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: logo, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: nameSize, lineHeight: 1.1, textTransform: "uppercase", ...clip }}>{prospect.First} {prospect.Last}</div>
              {big && <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 14, color: "rgba(255,255,255,0.7)", marginTop: 3, ...clip }}>{prospect.Position} · {prospect.School}{pick.via ? ` · via ${pick.via}` : ""}</div>}
            </div>
            {!big && <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>{prospect.Position}</span>}
            <span style={{ minWidth: 38, textAlign: "right", fontSize: big ? 28 : 20, color: gradeColor(letter), flexShrink: 0 }}>{letter}</span>
          </div>
        ))}
        {rows.length === 0 && <div style={{ padding: "8px 18px", fontFamily: BODY, fontWeight: 700, fontSize: 15, color: "rgba(255,255,255,0.6)" }}>No picks — they traded out.</div>}
        {more > 0 && <div style={{ padding: "4px 18px 0", fontFamily: BODY, fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.55)" }}>+ {more} more</div>}
      </div>
    </div>
  );
}

// ── Round one as a board. rows: [{ pickNumber, team, color1, color2,
// logo, player, via }]; site: the sim's address, along the bottom. ──
export const BoardStory = forwardRef(function BoardStory({ eyebrow, title, rows, site }, ref) {
  const perCol = Math.max(1, Math.ceil(rows.length / 2));
  return (
    <Frame ref={ref} background={NAVY}>
      <div style={{ position: "relative", padding: "0 0 26px", background: `linear-gradient(130deg, #0a2a52 0%, ${BLUE} 70%, #1c6fc4 100%)`, flexShrink: 0 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, background: GOLD }} />
        <TopBar eyebrow={eyebrow} />
        <div style={{ padding: "18px 40px 0", fontSize: title.length > 20 ? 50 : 60, lineHeight: 1.02, textTransform: "uppercase" }}>{title}</div>
      </div>
      <div style={{ height: 6, background: GOLD, flexShrink: 0 }} />
      <div style={{ flex: 1, minHeight: 0, padding: "20px 22px 22px", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${perCol}, minmax(0, 1fr))`, gridAutoFlow: "column", columnGap: 12, rowGap: 6 }}>
        {rows.map((r) => {
          const c1 = r.color1 || BLUE;
          const c2 = r.color2 || GOLD;
          return (
            <div key={r.pickNumber} style={{ display: "flex", alignItems: "stretch", minWidth: 0, minHeight: 0, background: "rgba(255,255,255,0.06)", borderRadius: 9, overflow: "hidden" }}>
              <div style={{ width: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: GOLD, background: "rgba(0,0,0,0.25)" }}>{r.pickNumber}</div>
              <div style={{ width: 50, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: c1, color: textOn(c1, c2), fontSize: 13, borderRight: `4px solid ${c2}` }}>
                {r.logo ? <img src={r.logo} alt={r.team} style={{ width: 36, height: 36, objectFit: "contain" }} /> : r.team}
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "0 10px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                {r.player ? (
                  <>
                    <div style={{ fontSize: 16, lineHeight: 1.1, textTransform: "uppercase", ...clip }}>{r.player.First} {r.player.Last}</div>
                    <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2, ...clip }}>
                      {r.player.Position}{r.player.School ? ` · ${r.player.School}` : ""}{r.via ? ` · via ${r.via}` : ""}
                    </div>
                  </>
                ) : <div style={{ fontFamily: BODY, fontWeight: 700, fontStyle: "italic", fontSize: 14, color: "rgba(255,255,255,0.4)" }}>TBD</div>}
              </div>
            </div>
          );
        })}
      </div>
      <Footer left="MAKE YOURS" right={site} />
    </Frame>
  );
});

