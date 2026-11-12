// src/components/draftSim/SimShareCards.jsx
//
// The Draft Sim's share images, 9:16 for stories and phones: drawn off
// screen at 720 × 1280 and captured at 1.5× (1080 × 1920) by SimResults.jsx's
// ShareFlow.
//   SimReportStory — the user's draft: one team gets the full report card
//                    (logo, grade, every pick graded); two or three teams
//                    stack as compact cards.
//   BoardStory     — round one as a board, two columns of sixteen, for Mock
//                    Draft mode and a sim the user only watched.
// Same look as the Whiteboard's share graphics (utils/whiteboardGraphic.js):
// the blue grid background with an accent glow, a gold "NFL DRAFT" pill, a
// huge headline with a hard drop shadow over angled stripes and a giant
// outlined mark, translucent rows, and the dark "BUILD YOURS" footer — with
// the header kept compact so the picks get the room.
// Logos are plain <img>s; ShareFlow inlines them (utils/exportImages.js)
// before the capture.
import { forwardRef } from "react";
import { textOn, isReadable } from "../../utils/teamColors";
import { groupedNeeds, needName } from "../../utils/draftSim/engine";
import siteLogo from "../../assets/Logo2.png";

export const STORY_W = 720;
export const STORY_H = 1280;
const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const NAVY = "#04203f";
const INK = "#0b1220";
const BODY = "Arial, Helvetica, sans-serif";
const HEAVY = "'Arial Black', Arial, sans-serif";
const teamLogo = (b) => b?.LogoDark || b?.Logo1;
const schoolLogo = (p) => p?.logoDark || p?.logo;
export const gradeColor = (l) => (l.startsWith("A") ? "#3fb950" : l.startsWith("B") ? "#58a6ff" : l.startsWith("C") ? GOLD : "#f85149");
const clip = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
// The biggest size, up to max, that fits text in width — Arial Black runs
// about 0.8em a capital.
const fitSize = (text, max, width, min = 16) => Math.max(min, Math.min(max, Math.floor(width / (Math.max(text.length, 1) * 0.8))));
// A team's accent on the dark background: its primary if it shows there,
// else its secondary, else gold.
const accentFor = (c1, c2) => [c1, c2].find((c) => c && isReadable(c, NAVY, 2)) || GOLD;

// The whiteboard background: a navy gradient, a faint grid, and the accent
// glowing from the top right.
const background = (accent) => [
  `radial-gradient(620px 520px at 100% 0%, ${accent}66, transparent 70%)`,
  "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px) 0 0 / 27px 27px",
  "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px) 0 0 / 27px 27px",
  `linear-gradient(135deg, #0a3a6e 0%, ${NAVY} 55%, ${INK} 100%)`,
].join(", ");

const Frame = forwardRef(function Frame({ accent, children }, ref) {
  return (
    <div ref={ref} style={{ position: "relative", width: STORY_W, height: STORY_H, background: background(accent), fontFamily: HEAVY, fontWeight: 900, color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
});

// The compact header: stripes and a giant outlined mark behind; the gold
// pill ("2027 NFL DRAFT") and a tag; then an optional logo beside the
// kicker (gold) and the headline (white, drop shadow in the accent); and
// whatever goes on the right (a grade).
function Header({ pill, tag, kicker, title, accent, mark, logo, right }) {
  const size = fitSize(title, 62, right ? 400 : logo ? 500 : 620, 30);
  return (
    <div style={{ position: "relative", flexShrink: 0, padding: "28px 36px 20px", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "62%", background: `repeating-linear-gradient(115deg, transparent 0 40px, ${accent} 40px 54px)`, opacity: 0.16, WebkitMaskImage: "linear-gradient(90deg, transparent, #000 60%)", maskImage: "linear-gradient(90deg, transparent, #000 60%)" }} />
      {mark && (
        <div aria-hidden="true" style={{ position: "absolute", right: -10, top: 6, fontSize: 170, lineHeight: 1, color: "transparent", WebkitTextStroke: `3px ${accent}`, opacity: 0.28, transform: "rotate(-5deg)", whiteSpace: "nowrap" }}>{mark}</div>
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ background: GOLD, color: INK, borderRadius: 999, padding: "6px 14px", fontSize: 15, letterSpacing: "0.04em" }}>{pill}</span>
        {tag && <span style={{ fontSize: 15, letterSpacing: "0.06em", color: "rgba(255,255,255,0.85)" }}>{tag}</span>}
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18, marginTop: 14 }}>
        {logo && <img src={logo} alt="" style={{ width: 92, height: 92, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.4))" }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          {kicker && <div style={{ fontSize: 22, lineHeight: 1.1, color: GOLD, letterSpacing: "0.02em", ...clip }}>{kicker}</div>}
          <div style={{ fontSize: size, lineHeight: 1, textTransform: "uppercase", textShadow: `5px 5px 0 ${accent}, 0 8px 22px rgba(0,0,0,0.35)`, marginTop: kicker ? 4 : 0, ...clip, paddingBottom: 6 }}>{title}</div>
        </div>
        {right}
      </div>
      <div style={{ position: "relative", display: "flex", marginTop: 12 }}>
        <span style={{ width: 120, height: 7, background: accent }} />
        <span style={{ width: 32, height: 7, background: GOLD }} />
        <span style={{ width: 10, height: 7, background: "#fff" }} />
      </div>
    </div>
  );
}

function Footer({ site }) {
  return (
    <div style={{ position: "relative", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 36px", background: "rgba(4,12,26,0.92)", borderTop: `4px solid ${GOLD}` }}>
      <img src={siteLogo} alt="We-Draft.com" style={{ width: 230, height: 40, objectFit: "contain", objectPosition: "left center", flexShrink: 0 }} />
      <div style={{ textAlign: "right", lineHeight: 1.15, minWidth: 0 }}>
        <div style={{ fontSize: 17, letterSpacing: "0.04em" }}>BUILD YOURS:</div>
        <div style={{ fontSize: fitSize(site, 19, 380, 12), color: GOLD, letterSpacing: "0.02em", ...clip }}>{site}</div>
      </div>
    </div>
  );
}

// "2027 NFL DRAFT SIM" → pill "2027 NFL DRAFT", tag "DRAFT SIM"; "2027 MOCK
// DRAFT · RD 1" → pill "2027 NFL DRAFT", tag "MOCK DRAFT · RD 1".
function splitEyebrow(eyebrow, year) {
  const rest = String(eyebrow || "").replace(String(year || ""), "").replace(/\bNFL\b/, "").replace(/\s+/g, " ").trim();
  return { pill: `${year} NFL DRAFT`, tag: rest || "DRAFT SIM" };
}

// ── The user's draft. teams: [{ haul, brand, name }]; site: the sim's
// address, along the bottom. ──
export const SimReportStory = forwardRef(function SimReportStory({ year, teams, site }, ref) {
  const shown = teams.slice(0, 3);
  const extra = teams.length - shown.length;
  if (shown.length === 1) {
    const { brand } = shown[0];
    const accent = accentFor(brand.Color1, brand.Color2);
    return (
      <Frame ref={ref} accent={accent}>
        <SoloReport {...shown[0]} year={year} accent={accent} />
        <Footer site={site} />
      </Frame>
    );
  }
  // Two or three teams: every row the same height, as tall as the picks
  // allow — the room left under the header (~200) and above the footer
  // (~90) after each card's own header and needs (~118 apiece). Too many
  // picks for 28px rows: each card shows what fits, then "+ N more".
  const room = 1280 - 200 - 90 - 26 - (shown.length - 1) * 14 - shown.length * 118 - (extra > 0 ? 30 : 0);
  const maxRows = Math.max(1, Math.min(Math.floor(22 / Math.max(shown.length, 1)), Math.floor(room / shown.length / 28)));
  const totalRows = shown.reduce((n, t) => n + Math.max(1, Math.min(t.haul.rows.length, maxRows)) + (t.haul.rows.length > maxRows ? 0.6 : 0), 0);
  const rowH = Math.max(28, Math.min(80, Math.floor(room / Math.max(totalRows, 1))));
  return (
    <Frame ref={ref} accent={GOLD}>
      <Header pill={`${year} NFL DRAFT`} tag="DRAFT SIM" kicker="MY" title={`${shown.length} Team Draft`} accent={GOLD} mark="SIM" />
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 14, padding: "6px 28px 20px", overflow: "hidden" }}>
        {shown.map((t) => <CompactReport key={t.haul.team} {...t} maxRows={maxRows} rowH={rowH} />)}
        {extra > 0 && <div style={{ textAlign: "center", fontFamily: BODY, fontWeight: 700, fontSize: 16, color: "rgba(255,255,255,0.6)" }}>+ {extra} more team{extra > 1 ? "s" : ""}</div>}
      </div>
      <Footer site={site} />
    </Frame>
  );
});

// The grade, as a plate on the header's right.
function GradePlate({ letter }) {
  const gc = gradeColor(letter);
  return (
    <div style={{ flexShrink: 0, textAlign: "center", padding: "8px 16px 10px", background: "rgba(5,13,28,0.75)", border: `4px solid ${gc}`, borderRadius: 18, boxShadow: "0 12px 28px rgba(0,0,0,0.45)" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.2em", color: "rgba(255,255,255,0.75)" }}>GRADE</div>
      <div style={{ fontSize: 64, lineHeight: 1, color: gc }}>{letter}</div>
    </div>
  );
}

// One team: the compact header (logo, city, team, grade), then every pick as
// a row — the pick number on the team's color, the school logo, name,
// position · school, the pick's grade. Rows grow with fewer picks.
const MAX_SOLO_ROWS = 14;
function SoloReport({ haul, brand, name, year, accent }) {
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || GOLD;
  const rows = haul.rows.slice(0, MAX_SOLO_ROWS);
  const more = haul.rows.length - rows.length;
  const team = (brand.Team || name).toUpperCase();
  const g = groupedNeeds(haul.needs);
  const chips = [...g.met.map((n) => ({ key: n.key, ok: true })), ...g.late.map((n) => ({ key: n.key, ok: true })), ...g.open.map((n) => ({ key: n.key, ok: false }))].slice(0, 5);
  // 1 pick → a 340px row, 2 → 260, then 200 down to ~62 at 14.
  const rowMax = rows.length <= 1 ? 340 : rows.length === 2 ? 260 : Math.round(200 - (Math.min(rows.length, MAX_SOLO_ROWS) - 1) * 10.5);
  const nameSize = Math.round(Math.max(20, Math.min(46, rowMax * 0.3)));
  const logoSize = Math.round(Math.max(36, Math.min(120, rowMax * 0.55)));
  // The pick block's width; the name gets the row (664) less the block, the
  // logo slot, the grade and padding.
  const blockW = rowMax >= 250 ? 120 : 84;
  const nameRoom = 664 - blockW - (logoSize + 24) - 90;
  const fullName = (p) => `${p.First} ${p.Last}`.toUpperCase();
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Header pill={`${year} NFL DRAFT`} tag="DRAFT SIM" kicker={(brand.City || "").toUpperCase()} title={team} accent={accent}
        mark={brand.Abbr || haul.team} logo={teamLogo(brand)} right={<GradePlate letter={haul.letter} />} />
      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 36px 12px", flexShrink: 0 }}>
          {chips.map((n) => (
            <span key={n.key} style={{ fontFamily: BODY, fontWeight: 800, fontSize: 14, padding: "5px 11px", borderRadius: 999, background: n.ok ? "rgba(63,185,80,0.18)" : "rgba(248,81,73,0.18)", color: n.ok ? "#7ee28b" : "#ff9b94" }}>
              {n.ok ? "✓" : "✗"} {needName(n.key)}
            </span>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, padding: "4px 28px 22px" }}>
        {rows.length === 0 && <div style={{ textAlign: "center", fontFamily: BODY, fontWeight: 700, fontSize: 22, color: "rgba(255,255,255,0.6)" }}>No picks — they traded out.</div>}
        {rows.map(({ pick, prospect, letter }, i) => (
          <div key={pick.overall} style={{ flex: "1 1 0", maxHeight: rowMax, minHeight: 0, display: "flex", alignItems: "stretch", borderRadius: 16, overflow: "hidden", background: i === 0 ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.07)" }}>
            <div style={{ width: blockW, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: c1, color: textOn(c1, c2), lineHeight: 1.05 }}>
              <div style={{ fontSize: 12, letterSpacing: "0.14em", opacity: 0.8 }}>RD {pick.round}</div>
              {/* Up to three digits fit the block. */}
              <div style={{ fontSize: Math.min(Math.round(nameSize * 1.15), Math.floor((blockW - 14) / (String(pick.overall).length * 0.78))) }}>{pick.overall}</div>
            </div>
            <div style={{ width: logoSize + 24, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {schoolLogo(prospect) && <img src={schoolLogo(prospect)} alt="" style={{ width: logoSize, height: logoSize, objectFit: "contain" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingRight: 8 }}>
              <div style={{ fontSize: fitSize(fullName(prospect), nameSize, nameRoom), lineHeight: 1.08, ...clip }}>{fullName(prospect)}</div>
              <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: Math.round(Math.max(13, nameSize * 0.55)), color: "rgba(255,255,255,0.68)", marginTop: 4, ...clip }}>{prospect.Position} · {prospect.School}{pick.via ? ` · via ${pick.via}` : ""}</div>
            </div>
            <div style={{ flexShrink: 0, minWidth: 64, paddingRight: 18, display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: Math.round(nameSize * 1.3), color: gradeColor(letter) }}>{letter}</div>
          </div>
        ))}
        {more > 0 && <div style={{ textAlign: "right", fontSize: 16, color: GOLD, flexShrink: 0 }}>+ {more} MORE</div>}
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
  const big = rowH >= 56;
  const nameSize = rowH >= 70 ? 23 : rowH >= 50 ? 20 : rowH >= 34 ? 17 : 15;
  const logo = Math.min(42, rowH - 14);
  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", borderRadius: 18, overflow: "hidden", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 16px", background: `linear-gradient(110deg, ${c1}, ${c1} 65%, ${c2} 150%)`, color: textOn(c1, c2) }}>
        {teamLogo(brand) && <img src={teamLogo(brand)} alt="" style={{ width: 50, height: 50, objectFit: "contain", flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: 27, lineHeight: 1, textTransform: "uppercase", ...clip }}>{name}</div>
        <div style={{ background: "rgba(5,13,28,0.72)", borderRadius: 12, padding: "3px 15px", border: `3px solid ${gradeColor(haul.letter)}`, color: gradeColor(haul.letter), fontSize: 34, lineHeight: 1.1 }}>{haul.letter}</div>
      </div>
      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "nowrap", gap: 6, padding: "9px 16px 4px", overflow: "hidden" }}>
          {chips.map((n) => (
            <span key={n.key} style={{ flexShrink: 0, fontFamily: BODY, fontWeight: 800, fontSize: 12, padding: "4px 9px", borderRadius: 999, background: n.ok ? "rgba(63,185,80,0.18)" : "rgba(248,81,73,0.18)", color: n.ok ? "#7ee28b" : "#ff9b94" }}>
              {n.ok ? "✓" : "✗"} {needName(n.key)}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", padding: "4px 0 6px" }}>
        {rows.map(({ pick, prospect, letter }) => (
          <div key={pick.overall} style={{ height: rowH, display: "flex", alignItems: "center", gap: 14, padding: "0 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ width: 56, flexShrink: 0, lineHeight: 1.05, textAlign: "center" }}>
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
        {rows.length === 0 && <div style={{ padding: "8px 16px", fontFamily: BODY, fontWeight: 700, fontSize: 15, color: "rgba(255,255,255,0.6)" }}>No picks — they traded out.</div>}
        {more > 0 && <div style={{ padding: "4px 16px 0", fontFamily: BODY, fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.55)" }}>+ {more} more</div>}
      </div>
    </div>
  );
}

// ── Round one as a board. rows: [{ pickNumber, team, color1, color2,
// logo, player, via }]; eyebrow ("2027 MOCK DRAFT · RD 1"), title ("My 2027
// Mock Draft"); site: the sim's address, along the bottom. ──
export const BoardStory = forwardRef(function BoardStory({ eyebrow, title, rows, site }, ref) {
  const perCol = Math.max(1, Math.ceil(rows.length / 2));
  const year = (String(eyebrow).match(/\d{4}/) || [""])[0];
  const { pill, tag } = splitEyebrow(eyebrow, year);
  // "My 2027 Mock Draft" → kicker "MY", headline "2027 MOCK DRAFT".
  const mine = /^my\s+/i.test(title || "");
  const headline = mine ? title.replace(/^my\s+/i, "") : title;
  return (
    <Frame ref={ref} accent={GOLD}>
      <Header pill={pill} tag={tag} kicker={mine ? "MY" : ""} title={headline} accent={BLUE} mark="R1" />
      <div style={{ position: "relative", flex: 1, minHeight: 0, padding: "4px 22px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${perCol}, minmax(0, 1fr))`, gridAutoFlow: "column", columnGap: 12, rowGap: 6 }}>
        {rows.map((r) => {
          const c1 = r.color1 || BLUE;
          const c2 = r.color2 || GOLD;
          return (
            <div key={r.pickNumber} style={{ display: "flex", alignItems: "stretch", minWidth: 0, minHeight: 0, background: "rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ width: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, color: textOn(c1, c2), background: c1 }}>{r.pickNumber}</div>
              <div style={{ width: 48, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.22)", borderRight: `3px solid ${c2}`, fontSize: 12 }}>
                {r.logo ? <img src={r.logo} alt={r.team} style={{ width: 34, height: 34, objectFit: "contain" }} /> : r.team}
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
      <Footer site={site} />
    </Frame>
  );
});
