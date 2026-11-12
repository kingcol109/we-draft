// src/components/PlayerEvalGraphic.jsx
//
// The player page's share graphics, as an Instagram post (4:5): drawn off
// screen at 720 × 900 and captured at 1.5× (1080 × 1350) by
// ShareTextButton. Two of them —
//   Share Evaluation: the user's own report ("MY SCOUTING REPORT", my grade,
//     scouted by them, a piece of the written evaluation);
//   Share (the page's toolbar): the community's ("COMMUNITY SCOUTING
//     REPORT", the community grade, how many evaluations, the class ranks
//     in place of the quote — `ranks`).
// Same look as the Draft Sim's share cards (draftSim/SimShareCards.jsx) in
// the school's colors:
//   • the badge, the school logo with position · school · class, the name
//     (first over a big last), height and weight — his headshot cutout
//     standing on the right, the logo faded behind it;
//   • the grade as a plate in its round's color, and who graded him;
//   • strengths and weaknesses, side by side;
//   • the quote, as much as fits — or the ranks;
//   • the footer, with the page's address.
// Anything the report doesn't have is left out and the rest closes up, and
// text that doesn't fit ends in "…" rather than just stopping.
// Images are plain <img>s; ShareTextButton inlines them before the capture.
import { forwardRef } from "react";
import { STORY_W, STORY_H, teamTheme, Footer, fitSize } from "./draftSim/SimShareCards";

const BODY = "Arial, Helvetica, sans-serif";
const HEAVY = "'Arial Black', Arial, sans-serif";
const clip = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const MAX_TAGS = 5;
// About how many characters of the quote fit a line.
const CHARS_PER_LINE = 58;
// Heights (px) the quote's room is worked out from: the header (with its
// border), the body's padding, the grade row, a tag list's heading and each
// tag, the gaps, the quote box's padding, its line, and the footer.
const H = { header: 320, pad: 40, grade: 76, tagHead: 24, tag: 34, tagGap: 6, gap: 16, quotePad: 28, line: 19 * 1.45, footer: 80 };

// Text cut to about max characters, at a word, ending in "…" when any of
// it was left off.
function cutText(t, max) {
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, "").replace(/[,;:.!?\s]+$/, "")}…`;
}
// The evaluation as one paragraph — bullets and line breaks flattened — as
// much as its lines hold. (The box clamps to its lines too, in case a line
// runs short.)
const excerptOf = (evaluation, max) => cutText(String(evaluation || "").split("\n").map((l) => l.trim().replace(/^[•\-*]\s+/, "")).filter(Boolean).join(" "), max);
// About how many characters of a strength or weakness fit its row — half
// the width, or all of it when the other column is empty.
const TAG_CHARS = { half: 24, full: 52 };

// player: { First, Last, Position, School }; facts: "WR · Ohio State · 2027";
// size: "6'3\" · 205 lbs"; badge: the pill's words; grade: { short, bg,
// border }, gradeTitle ("MY GRADE") and gradeLabel ("Early First Round");
// byTitle and by: who graded him ("SCOUTED BY" King Cold Sports, or
// "EVALUATIONS" 14); evaluation: the quote's text; ranks: [{ rank, of,
// label }] — shown instead of the quote; color1/color2: the school's; logo:
// the school's (its dark-background version); headshot: his cutout; site:
// the page's address, shown in the footer.
const PlayerEvalGraphic = forwardRef(function PlayerEvalGraphic({
  player, facts, size, badge = "MY SCOUTING REPORT", grade, gradeTitle = "MY GRADE", gradeLabel,
  byTitle = "SCOUTED BY", by, strengths = [], weaknesses = [], evaluation, ranks = [],
  color1, color2, logo, headshot, site,
}, ref) {
  const theme = teamTheme({ Color1: color1, Color2: color2 });
  const first = String(player.First || "").toUpperCase();
  const last = String(player.Last || "").toUpperCase();
  // The name's column: the frame less the padding and the headshot's side.
  const nameW = headshot ? 400 : 560;
  const lastSize = fitSize(last, 76, nameW, 34);
  const s = strengths.slice(0, MAX_TAGS);
  const w = weaknesses.slice(0, MAX_TAGS);
  // The quote gets whole lines in what's left — "…" where it stops.
  const tagRows = Math.max(s.length, w.length);
  const quoteRoom = STORY_H - H.header - H.pad - H.footer - 8
    - (grade || by ? H.grade + H.gap : 0)
    - (tagRows ? H.tagHead + tagRows * H.tag + (tagRows - 1) * H.tagGap + H.gap : 0)
    - H.quotePad;
  const quoteLines = Math.floor(quoteRoom / H.line);
  const excerpt = ranks.length ? "" : excerptOf(evaluation, quoteLines * CHARS_PER_LINE);
  const tagChars = s.length && w.length ? TAG_CHARS.half : TAG_CHARS.full;
  const tagCol = (title, items, ok) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, letterSpacing: "0.16em", color: ok ? "#7ee28b" : "#ff9b94", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: H.tagGap }}>
        {items.map((t) => (
          <div key={t} style={{ height: H.tag, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "0 12px", fontFamily: BODY, fontWeight: 800, fontSize: 16, minWidth: 0 }}>
            <span style={{ color: ok ? "#3fb950" : "#f85149", flexShrink: 0, fontFamily: HEAVY }}>{ok ? "✓" : "✕"}</span>
            <span style={{ ...clip, textTransform: "uppercase", letterSpacing: "0.02em" }}>{cutText(String(t), tagChars)}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div ref={ref} style={{ position: "relative", width: STORY_W, height: STORY_H, background: theme.bg, fontFamily: HEAVY, fontWeight: 900, color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* The header: badge, logo and facts, name, size — the headshot on the right. */}
      <div style={{ position: "relative", flexShrink: 0, height: 316, padding: "26px 36px 0", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "62%", background: `repeating-linear-gradient(115deg, transparent 0 40px, ${theme.accent} 40px 54px)`, opacity: 0.12, WebkitMaskImage: "linear-gradient(90deg, transparent, #000 60%)", maskImage: "linear-gradient(90deg, transparent, #000 60%)" }} />
        {logo && <img src={logo} alt="" style={{ position: "absolute", right: headshot ? 40 : 30, top: headshot ? 30 : 60, width: headshot ? 280 : 240, height: headshot ? 280 : 240, objectFit: "contain", opacity: headshot ? 0.16 : 0.22 }} />}
        {headshot && <img src={headshot} alt="" style={{ position: "absolute", right: 0, bottom: 0, height: 300, width: 320, objectFit: "contain", objectPosition: "bottom right", filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.45))" }} />}
        <div style={{ position: "relative", width: nameW }}>
          <span style={{ display: "inline-block", background: theme.pillBg, color: theme.pillInk, borderRadius: 999, padding: "9px 20px", fontSize: fitSize(badge, 21, 470, 15), letterSpacing: "0.06em", whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.3)" }}>{badge}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20 }}>
            {logo && <img src={logo} alt="" style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0 }} />}
            {facts && <div style={{ fontSize: 17, letterSpacing: "0.04em", color: theme.kicker, ...clip }}>{facts.toUpperCase()}</div>}
          </div>
          <div style={{ fontSize: 34, lineHeight: 1, marginTop: 14, ...clip }}>{first}</div>
          <div style={{ fontSize: lastSize, lineHeight: 1, marginTop: 4, textShadow: `5px 5px 0 ${theme.shadow}`, ...clip, paddingBottom: 6 }}>{last}</div>
          {size && <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 18, color: "rgba(255,255,255,0.8)", marginTop: 6 }}>{size}</div>}
        </div>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 16, padding: "18px 36px 22px", background: "linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.05))", borderTop: `4px solid ${theme.footer}` }}>
        {(grade || by) && (
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
            {grade && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: grade.bg, border: `4px solid ${grade.border}`, borderRadius: 16, padding: "8px 18px 8px 14px", boxShadow: "0 10px 24px rgba(0,0,0,0.35)" }}>
                <span style={{ fontSize: 50, lineHeight: 1 }}>{grade.short}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 12, letterSpacing: "0.18em", opacity: 0.8 }}>{gradeTitle}</span>
                  <span style={{ fontSize: 20, lineHeight: 1.1, textTransform: "uppercase" }}>{gradeLabel}</span>
                </span>
              </div>
            )}
            {by && (
              <div style={{ minWidth: 0, marginLeft: "auto", textAlign: "right" }}>
                <div style={{ fontSize: 12, letterSpacing: "0.18em", color: "rgba(255,255,255,0.65)" }}>{byTitle}</div>
                <div style={{ fontSize: 22, marginTop: 3, color: theme.kicker, ...clip }}>{by}</div>
              </div>
            )}
          </div>
        )}
        {(s.length > 0 || w.length > 0) && (
          <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
            {s.length > 0 && tagCol("STRENGTHS", s, true)}
            {w.length > 0 && tagCol("WEAKNESSES", w, false)}
          </div>
        )}
        {ranks.length > 0 && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 14, letterSpacing: "0.16em", color: theme.kicker, marginBottom: 8, flexShrink: 0 }}>CLASS RANK</div>
            <div style={{ flex: 1, minHeight: 0, maxHeight: 150, display: "flex", gap: 16 }}>
              {ranks.map((r) => (
                <div key={r.label} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 14, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", borderLeft: `6px solid ${theme.footer}`, borderRadius: 14, padding: "10px 16px" }}>
                  <span style={{ fontSize: fitSize(`#${r.rank}`, 64, 150, 34), lineHeight: 1, flexShrink: 0 }}><span style={{ fontSize: "0.55em", color: theme.kicker, verticalAlign: "0.55em" }}>#</span>{r.rank}</span>
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontFamily: BODY, fontWeight: 800, fontSize: 15, color: "rgba(255,255,255,0.7)" }}>of {r.of}</span>
                    <span style={{ fontSize: 17, lineHeight: 1.1, textTransform: "uppercase" }}>{cutText(r.label, 22)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {excerpt && quoteLines >= 2 && (
          <div style={{ flexShrink: 0, overflow: "hidden", display: "flex", gap: 14, background: "rgba(0,0,0,0.3)", borderRadius: 14, padding: "14px 18px 14px 14px", borderLeft: `6px solid ${theme.footer}` }}>
            <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 64, lineHeight: 0.8, color: theme.kicker, flexShrink: 0 }}>“</span>
            <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic", fontWeight: 400, fontSize: 19, lineHeight: 1.45, color: "rgba(255,255,255,0.92)", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: quoteLines }}>{excerpt}</div>
          </div>
        )}
      </div>
      <Footer site={site} theme={theme} label="FULL REPORT:" />
    </div>
  );
});

export default PlayerEvalGraphic;
