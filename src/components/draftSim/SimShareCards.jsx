// src/components/draftSim/SimShareCards.jsx
//
// The Draft Sim's share images, Instagram's 4:5 portrait post: drawn off
// screen at 720 × 900 and captured at 1.5× (1080 × 1350) by SimResults.jsx's
// ShareFlow.
//   SimReportStory — the user's draft, "MY 2027 MOCK DRAFT": one team gets
//                    the full card in the team's own colors (logo, every
//                    pick); two or three teams stack as compact cards.
//                    Grades only with `grades` (the share dialog's toggle).
//   BoardStory     — round one as a board, two columns of sixteen, for Mock
//                    Draft mode and a sim the user only watched.
// Same look as the Whiteboard's share graphics (utils/whiteboardGraphic.js):
// a grid background with an accent glow, a pill, a huge headline with a hard
// drop shadow over angled stripes and a giant outlined mark, translucent
// rows, and the dark "BUILD YOURS" footer — with the header kept compact so
// the picks get the room.
// Logos are plain <img>s; ShareFlow inlines them (utils/exportImages.js)
// before the capture.
import { forwardRef } from "react";
import { textOn, isReadable } from "../../utils/teamColors";
import siteLogo from "../../assets/Logo2.png";

export const STORY_W = 720;
export const STORY_H = 900;
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
export const fitSize = (text, max, width, min = 16) => Math.max(min, Math.min(max, Math.floor(width / (Math.max(text.length, 1) * 0.8))));

// The whiteboard background: a navy gradient, a faint grid, and the accent
// glowing from the top right.
const background = (accent) => [
  `radial-gradient(620px 520px at 100% 0%, ${accent}66, transparent 70%)`,
  "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px) 0 0 / 27px 27px",
  "linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px) 0 0 / 27px 27px",
  `linear-gradient(135deg, #0a3a6e 0%, ${NAVY} 55%, ${INK} 100%)`,
].join(", ");

// One team's card: its primary color, deepening toward near-black at the
// bottom so white type reads for every team, the secondary glowing from
// the top right, and the same faint grid.
const teamBackground = (c1, c2) => [
  `radial-gradient(640px 540px at 100% 0%, ${c2}55, transparent 70%)`,
  "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 27px 27px",
  "linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 27px 27px",
  "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.78) 100%)",
  // The color as a gradient layer, not a bare color: html-to-image drops a
  // plain color at the end of a layered background, and the capture came
  // out with no team color at all.
  `linear-gradient(${c1}, ${c1})`,
].join(", ");

// The colors a card is drawn in.
//   SITE_THEME  — the board: gold on the blue grid.
//   teamTheme   — one team's card: the pill in its secondary (white when
//                 that doesn't show on the primary), the city, mark and
//                 accents in whichever of its colors reads on the dark.
//   MULTI_THEME — two or three teams: the navy grid in white, each team's
//                 colors on its own card.
const SITE_THEME = { bg: background(GOLD), accent: GOLD, shadow: BLUE, pillBg: GOLD, pillInk: INK, kicker: GOLD, bar: [BLUE, GOLD, "#fff"], footer: GOLD };
const MULTI_THEME = { bg: background("#ffffff"), accent: "#ffffff", shadow: BLUE, pillBg: "#ffffff", pillInk: NAVY, kicker: "rgba(255,255,255,0.8)", bar: [BLUE, "#ffffff", "#ffffff"], footer: "#ffffff" };
export function teamTheme(brand) {
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || "#ffffff";
  const accent = [c2, c1].find((c) => isReadable(c, INK, 3)) || "#ffffff";
  const pillBg = isReadable(c2, c1, 1.6) ? c2 : "#ffffff";
  // On the near-black footer and the header's bar: a color that shows there.
  const edge = [c2, c1].find((c) => isReadable(c, INK, 1.8)) || "#ffffff";
  // The city over the team name sits on the primary: the secondary when it
  // shows there and on the dark (gold, say), else white.
  const kicker = isReadable(c2, c1, 3) && isReadable(c2, INK, 3) ? c2 : "#ffffff";
  return {
    c1, c2, bg: teamBackground(c1, c2), accent,
    shadow: "rgba(0,0,0,0.5)",
    pillBg, pillInk: textOn(pillBg, c1), kicker, bar: [edge, accent, "#fff"], footer: edge,
  };
}

const Frame = forwardRef(function Frame({ bg, children }, ref) {
  return (
    <div ref={ref} style={{ position: "relative", width: STORY_W, height: STORY_H, background: bg, fontFamily: HEAVY, fontWeight: 900, color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
});

// The compact header: stripes and a giant outlined mark behind; the pill
// ("2027 NFL DRAFT") and an optional tag; then an optional logo beside the
// kicker and the headline (white, hard drop shadow); and whatever goes on
// the right (a grade); then a short bar.
// badge ({ top, bottom }) — the user's draft: no pill row and no bar; the
// badge ("MY 2027" over "MOCK DRAFT", in the pill's colors) sits on the
// headline's row instead, so the picks get the height.
const BADGE_W = 232;
function Header({ pill, tag, kicker, title, theme, mark, logo, right, badge }) {
  const room = badge
    ? STORY_W - 72 - (logo ? 98 : 0) - (BADGE_W + 16) - (right ? 112 : 0)
    : right ? 400 : logo ? 500 : 620;
  const size = fitSize(title, badge ? 58 : 62, room, badge ? 24 : 30);
  return (
    <div style={{ position: "relative", flexShrink: 0, padding: badge ? "26px 36px 18px" : "28px 36px 20px", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "62%", background: `repeating-linear-gradient(115deg, transparent 0 40px, ${theme.accent} 40px 54px)`, opacity: 0.14, WebkitMaskImage: "linear-gradient(90deg, transparent, #000 60%)", maskImage: "linear-gradient(90deg, transparent, #000 60%)" }} />
      {mark && (
        <div aria-hidden="true" style={{ position: "absolute", right: -10, top: badge ? -14 : 6, fontSize: badge ? 150 : 170, lineHeight: 1, color: "transparent", WebkitTextStroke: `3px ${theme.accent}`, opacity: 0.22, transform: "rotate(-5deg)", whiteSpace: "nowrap" }}>{mark}</div>
      )}
      {!badge && (
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ background: theme.pillBg, color: theme.pillInk, borderRadius: 999, padding: "7px 16px", fontSize: 17, letterSpacing: "0.05em", boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}>{pill}</span>
          {tag && <span style={{ fontSize: 15, letterSpacing: "0.06em", color: "rgba(255,255,255,0.85)" }}>{tag}</span>}
        </div>
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: badge ? 16 : 18, marginTop: badge ? 0 : 14 }}>
        {logo && <img src={logo} alt="" style={{ width: badge ? 82 : 92, height: badge ? 82 : 92, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.4))" }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          {kicker && <div style={{ fontSize: badge ? 20 : 22, lineHeight: 1.1, color: theme.kicker, letterSpacing: "0.02em", ...clip }}>{kicker}</div>}
          <div style={{ fontSize: size, lineHeight: 1, textTransform: "uppercase", textShadow: `5px 5px 0 ${theme.shadow}, 0 8px 22px rgba(0,0,0,0.35)`, marginTop: kicker ? 4 : 0, ...clip, paddingBottom: 6 }}>{title}</div>
        </div>
        {badge && (
          <div style={{ width: BADGE_W, flexShrink: 0, boxSizing: "border-box", textAlign: "center", background: theme.pillBg, color: theme.pillInk, borderRadius: 18, padding: "10px 12px 11px", lineHeight: 1.05, boxShadow: "0 6px 16px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 20, letterSpacing: "0.12em" }}>{badge.top}</div>
            <div style={{ fontSize: 28, letterSpacing: "0.01em", marginTop: 2, whiteSpace: "nowrap" }}>{badge.bottom}</div>
          </div>
        )}
        {right}
      </div>
      {!badge && (
        <div style={{ position: "relative", display: "flex", marginTop: 12 }}>
          <span style={{ width: 120, height: 7, background: theme.bar[0] }} />
          <span style={{ width: 32, height: 7, background: theme.bar[1] }} />
          <span style={{ width: 10, height: 7, background: theme.bar[2] }} />
        </div>
      )}
    </div>
  );
}

// label: what the address is for ("BUILD YOURS:"); also the player page's
// evaluation graphic's (components/PlayerEvalGraphic.jsx).
export function Footer({ site, theme = SITE_THEME, label = "BUILD YOURS:" }) {
  return (
    <div style={{ position: "relative", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 36px", background: "rgba(4,8,16,0.9)", borderTop: `4px solid ${theme.footer}` }}>
      <img src={siteLogo} alt="We-Draft.com" style={{ width: 230, height: 40, objectFit: "contain", objectPosition: "left center", flexShrink: 0 }} />
      <div style={{ textAlign: "right", lineHeight: 1.15, minWidth: 0 }}>
        <div style={{ fontSize: 17, letterSpacing: "0.04em" }}>{label}</div>
        <div style={{ fontSize: fitSize(site, 19, 380, 12), color: theme.accent, letterSpacing: "0.02em", ...clip }}>{site}</div>
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
// address, along the bottom; grades: show the team's and each pick's. ──
// headshots: { [prospectId]: url } — shown in place of the school logos
// (the dialog's Headshots switch); a player without one keeps his logo.
export const SimReportStory = forwardRef(function SimReportStory({ year, teams, site, grades = false, headshots = null }, ref) {
  const shown = teams.slice(0, 3);
  const extra = teams.length - shown.length;
  if (shown.length === 1) {
    const theme = teamTheme(shown[0].brand);
    return (
      <Frame ref={ref} bg={theme.bg}>
        <SoloReport {...shown[0]} year={year} theme={theme} grades={grades} headshots={headshots} />
        <Footer site={site} theme={theme} />
      </Frame>
    );
  }
  // Two or three teams: every row the same height, as tall as the picks
  // allow — the room left under the header (~120) and above the footer
  // (~90) after each card's own header (~84 apiece). Too many picks for
  // 28px rows: each card shows what fits, then "+ N more".
  const room = STORY_H - 120 - 90 - 26 - (shown.length - 1) * 14 - shown.length * 84 - (extra > 0 ? 30 : 0);
  const maxRows = Math.max(1, Math.min(Math.floor(22 / Math.max(shown.length, 1)), Math.floor(room / shown.length / 28)));
  const totalRows = shown.reduce((n, t) => n + Math.max(1, Math.min(t.haul.rows.length, maxRows)) + (t.haul.rows.length > maxRows ? 0.6 : 0), 0);
  const rowH = Math.max(28, Math.min(80, Math.floor(room / Math.max(totalRows, 1))));
  return (
    <Frame ref={ref} bg={MULTI_THEME.bg}>
      <Header badge={{ top: `MY ${year}`, bottom: "MOCK DRAFT" }} title={`${shown.length} Team Draft`} theme={MULTI_THEME} mark="SIM" />
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 14, padding: "6px 28px 20px", overflow: "hidden" }}>
        {shown.map((t) => <CompactReport key={t.haul.team} {...t} maxRows={maxRows} rowH={rowH} grades={grades} headshots={headshots} />)}
        {extra > 0 && <div style={{ textAlign: "center", fontFamily: BODY, fontWeight: 700, fontSize: 16, color: "rgba(255,255,255,0.6)" }}>+ {extra} more team{extra > 1 ? "s" : ""}</div>}
      </div>
      <Footer site={site} theme={MULTI_THEME} />
    </Frame>
  );
});

// The grade, as a plate on the header's right.
// small: beside the header's badge.
function GradePlate({ letter, small = false }) {
  const gc = gradeColor(letter);
  return (
    <div style={{ flexShrink: 0, minWidth: small ? 96 : undefined, boxSizing: "border-box", textAlign: "center", padding: small ? "6px 10px 7px" : "8px 16px 10px", background: "rgba(5,13,28,0.75)", border: `4px solid ${gc}`, borderRadius: 18, boxShadow: "0 12px 28px rgba(0,0,0,0.45)" }}>
      <div style={{ fontSize: small ? 11 : 12, letterSpacing: "0.2em", color: "rgba(255,255,255,0.75)" }}>GRADE</div>
      <div style={{ fontSize: small ? 50 : 64, lineHeight: 1, color: gc }}>{letter}</div>
    </div>
  );
}

// One team: the header ("MY 2027 MOCK DRAFT", logo, city, team, the grade
// when shown), then every pick — the pick number on the team's secondary,
// the school logo, name, position · school, the pick's grade when shown.
// Up to four picks run one to a row, as tall as the frame allows; five or
// more go in two columns (1–n down the left, then the right), the first
// name over the last so the names stay big in the narrower rows.
const MAX_SOLO_PICKS = 16;
const TWO_COLUMNS_FROM = 5;
// The room for the picks: the frame less the header (~130), the footer
// (~80) and the list's padding; the list's width less its padding.
const SOLO_ROOM = STORY_H - 130 - 80 - 26;
const SOLO_W = STORY_W - 56;
const COL_GAP = 12;
function SoloReport({ haul, brand, name, year, theme, grades, headshots }) {
  const photoOf = (p) => (headshots && p?.id ? headshots[p.id] || "" : "");
  const blockBg = isReadable(theme.c2, theme.c1, 1.6) ? theme.c2 : "rgba(0,0,0,0.4)";
  const blockInk = blockBg === theme.c2 ? textOn(theme.c2, theme.c1) : "#fff";
  const rows = haul.rows.slice(0, MAX_SOLO_PICKS);
  const more = haul.rows.length - rows.length;
  const team = (brand.Team || name).toUpperCase();
  const cols = rows.length >= TWO_COLUMNS_FROM ? 2 : 1;
  const perCol = Math.max(1, Math.ceil(rows.length / cols));
  const gap = perCol > 6 ? 6 : 8;
  const fit = Math.floor((SOLO_ROOM - (more > 0 ? 22 : 0) - gap * (perCol - 1)) / perCol);
  // One column: 1 pick → a 300px row, 2 → 230, else 180. Two: up to 130.
  const rowH = Math.min(fit, cols === 2 ? 130 : rows.length <= 1 ? 300 : rows.length === 2 ? 230 : 180);
  const colW = (SOLO_W - (cols - 1) * COL_GAP) / cols;
  const two = cols === 2;
  // Two columns: the last name's size; the first name runs smaller above.
  const nameSize = Math.round(two ? Math.max(16, Math.min(30, rowH * 0.25)) : Math.max(18, Math.min(46, rowH * 0.4)));
  const subSize = Math.round(two ? Math.max(11, Math.min(15, rowH * 0.13)) : Math.max(12, Math.min(25, nameSize * 0.55)));
  const logoSize = Math.round(two ? Math.max(28, Math.min(64, rowH * 0.5)) : Math.max(30, Math.min(120, rowH * 0.7)));
  const blockW = two ? 64 : rowH >= 250 ? 120 : 84;
  const logoSlot = logoSize + (two ? 16 : 24);
  // A headshot (ESPN's 600×436 cutouts) stands the row's height; with any
  // on the card, every row's slot is that wide so the names line up.
  const photoSlot = Math.round(Math.min(two ? 120 : 220, rowH * 1.3));
  const anyPhoto = rows.some((r) => photoOf(r.prospect));
  // The name gets the row less the block, the logo slot and the grade —
  // in two columns the grade sits on the last name's line, so only that
  // line gives it room.
  const textRoom = colW - blockW - (anyPhoto ? photoSlot : logoSlot) - (two ? 12 : 26);
  const nameRoom = textRoom - (grades && !two ? 64 : 0);
  // Two columns: the grade beside the last name, and the room it takes.
  const gradeSize = Math.round(nameSize * 0.95);
  const lastRoom = (letter) => (textRoom - (grades ? letter.length * 0.9 * gradeSize + 10 : 0)) * 0.92;
  const up = (s) => String(s || "").toUpperCase();
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Header badge={{ top: `MY ${year}`, bottom: "MOCK DRAFT" }} kicker={up(brand.City)} title={team} theme={theme}
        mark={brand.Abbr || haul.team} logo={teamLogo(brand)} right={grades ? <GradePlate letter={haul.letter} small /> : null} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "4px 28px 22px" }}>
        {rows.length === 0 && <div style={{ textAlign: "center", fontFamily: BODY, fontWeight: 700, fontSize: 22, color: "rgba(255,255,255,0.6)" }}>No picks — they traded out.</div>}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${perCol}, ${rowH}px)`, gridAutoFlow: "column", columnGap: COL_GAP, rowGap: gap }}>
          {rows.map(({ pick, prospect, letter }, i) => (
            <div key={pick.overall} style={{ minWidth: 0, display: "flex", alignItems: "stretch", borderRadius: two ? 14 : 16, overflow: "hidden", background: i === 0 ? "rgba(0,0,0,0.34)" : "rgba(0,0,0,0.24)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div style={{ width: blockW, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: blockBg, color: blockInk, lineHeight: 1.05 }}>
                <div style={{ fontSize: rowH < 56 ? 10 : 12, letterSpacing: "0.14em", opacity: 0.8 }}>RD {pick.round}</div>
                {/* Up to three digits fit the block. */}
                <div style={{ fontSize: Math.min(Math.round(two ? rowH * 0.3 : nameSize * 1.15), Math.floor((blockW - 12) / (String(pick.overall).length * 0.78))) }}>{pick.overall}</div>
                {pick.via && <div style={{ fontSize: rowH < 56 ? 9 : two ? 10 : 12, letterSpacing: "0.06em", opacity: 0.85, marginTop: 1, whiteSpace: "nowrap" }}>VIA {pick.via}</div>}
              </div>
              {photoOf(prospect) ? (
                <div style={{ width: photoSlot, flexShrink: 0, display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden" }}>
                  <img src={photoOf(prospect)} alt="" style={{ width: "100%", height: "94%", objectFit: "contain", objectPosition: "center bottom" }} />
                </div>
              ) : (
                <div style={{ width: anyPhoto ? photoSlot : logoSlot, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {schoolLogo(prospect) && <img src={schoolLogo(prospect)} alt="" style={{ width: logoSize, height: logoSize, objectFit: "contain" }} />}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingRight: two ? 12 : grades ? 4 : 20 }}>
                {two ? (
                  <>
                    <div style={{ fontSize: fitSize(up(prospect.First), Math.round(nameSize * 0.72), textRoom, 12), lineHeight: 1.05, color: "rgba(255,255,255,0.88)", ...clip }}>{up(prospect.First)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: fitSize(up(prospect.Last), nameSize, lastRoom(letter), 14), lineHeight: 1.08, ...clip }}>{up(prospect.Last)}</div>
                      {grades && <span style={{ flexShrink: 0, fontSize: gradeSize, lineHeight: 1, color: gradeColor(letter) }}>{letter}</span>}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: fitSize(`${up(prospect.First)} ${up(prospect.Last)}`, nameSize, nameRoom), lineHeight: 1.08, ...clip }}>{up(prospect.First)} {up(prospect.Last)}</div>
                )}
                <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: subSize, color: "rgba(255,255,255,0.72)", marginTop: rowH < 56 ? 2 : 4, ...clip }}>{prospect.Position} · {prospect.School}</div>
              </div>
              {grades && !two && <div style={{ flexShrink: 0, minWidth: 64, paddingRight: 18, display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: Math.round(nameSize * 1.3), color: gradeColor(letter) }}>{letter}</div>}
            </div>
          ))}
        </div>
        {more > 0 && <div style={{ textAlign: "right", fontSize: 16, color: theme.accent, flexShrink: 0, marginTop: 6 }}>+ {more} MORE</div>}
      </div>
    </div>
  );
}

function CompactReport({ haul, brand, name, maxRows, rowH, grades, headshots }) {
  const photoOf = (p) => (headshots && p?.id ? headshots[p.id] || "" : "");
  const c1 = brand.Color1 || BLUE;
  const c2 = brand.Color2 || "#ffffff";
  // The pick numbers in whichever team color reads on the navy.
  const accent = [c2, c1].find((c) => isReadable(c, NAVY, 3)) || "#ffffff";
  const rows = haul.rows.slice(0, maxRows);
  const more = haul.rows.length - rows.length;
  const big = rowH >= 56;
  const nameSize = rowH >= 70 ? 23 : rowH >= 50 ? 20 : rowH >= 34 ? 17 : 15;
  const logo = Math.min(42, rowH - 14);
  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", borderRadius: 18, overflow: "hidden", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 16px", background: `linear-gradient(110deg, ${c1}, ${c1} 65%, ${c2} 150%)`, color: textOn(c1, c2) }}>
        {teamLogo(brand) && <img src={teamLogo(brand)} alt="" style={{ width: 50, height: 50, objectFit: "contain", flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: 27, lineHeight: 1, textTransform: "uppercase", ...clip }}>{name}</div>
        {grades && <div style={{ background: "rgba(5,13,28,0.72)", borderRadius: 12, padding: "3px 15px", border: `3px solid ${gradeColor(haul.letter)}`, color: gradeColor(haul.letter), fontSize: 34, lineHeight: 1.1 }}>{haul.letter}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "4px 0 6px" }}>
        {rows.map(({ pick, prospect, letter }) => (
          <div key={pick.overall} style={{ height: rowH, display: "flex", alignItems: "center", gap: 14, padding: "0 16px", borderTop: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{ width: 56, flexShrink: 0, lineHeight: 1.05, textAlign: "center" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)" }}>RD {pick.round}</div>
              <div style={{ fontSize: big ? 22 : 17, color: accent }}>{pick.overall}</div>
              {pick.via && <div style={{ fontSize: 9, letterSpacing: "0.06em", color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>VIA {pick.via}</div>}
            </div>
            {photoOf(prospect)
              ? <img src={photoOf(prospect)} alt="" style={{ width: Math.round((rowH - 2) * 1.3), height: rowH - 2, alignSelf: "flex-end", objectFit: "contain", objectPosition: "center bottom", flexShrink: 0 }} />
              : schoolLogo(prospect) ? <img src={schoolLogo(prospect)} alt="" style={{ width: logo, height: logo, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: headshots ? Math.round((rowH - 2) * 1.3) : logo, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: nameSize, lineHeight: 1.1, textTransform: "uppercase", ...clip }}>{prospect.First} {prospect.Last}</div>
              {big && <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 14, color: "rgba(255,255,255,0.7)", marginTop: 3, ...clip }}>{prospect.Position} · {prospect.School}</div>}
            </div>
            {!big && <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>{prospect.Position}</span>}
            {grades && <span style={{ minWidth: 38, textAlign: "right", fontSize: big ? 28 : 20, color: gradeColor(letter), flexShrink: 0 }}>{letter}</span>}
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
    <Frame ref={ref} bg={SITE_THEME.bg}>
      <Header pill={pill} tag={tag} kicker={mine ? "MY" : ""} title={headline} theme={SITE_THEME} mark="R1" />
      <div style={{ position: "relative", flex: 1, minHeight: 0, padding: "4px 22px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${perCol}, minmax(0, 1fr))`, gridAutoFlow: "column", columnGap: 12, rowGap: 6 }}>
        {rows.map((r) => {
          const c1 = r.color1 || BLUE;
          const c2 = r.color2 || GOLD;
          return (
            <div key={r.pickNumber} style={{ display: "flex", alignItems: "stretch", minWidth: 0, minHeight: 0, background: "rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ width: 44, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.05, fontSize: 19, color: textOn(c1, c2), background: c1 }}>
                {r.pickNumber}
                {r.via && <span style={{ fontSize: 8, letterSpacing: "0.04em", opacity: 0.85, whiteSpace: "nowrap" }}>VIA {r.via}</span>}
              </div>
              <div style={{ width: 48, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.22)", borderRight: `3px solid ${c2}`, fontSize: 12 }}>
                {r.logo ? <img src={r.logo} alt={r.team} style={{ width: 34, height: 34, objectFit: "contain" }} /> : r.team}
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "0 10px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                {r.player ? (
                  <>
                    <div style={{ fontSize: 16, lineHeight: 1.1, textTransform: "uppercase", ...clip }}>{r.player.First} {r.player.Last}</div>
                    <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2, ...clip }}>
                      {r.player.Position}{r.player.School ? ` · ${r.player.School}` : ""}
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
