// src/components/PlayersMentionedList.js
//
// "Players Mentioned" chips — shared by NewsArticle.jsx and
// PerformancePage.js so both read as the exact same feature instead of two
// slightly different hand-rolled versions (article's was the fuller one —
// chevron/hover polish, Position+School subtitle — and became the base
// here).
//
// Each chip is colored by the mentioned player's own school (Color1/
// Color2/LogoDark from the schools collection, via `schoolInfo` — see
// either page's own schoolInfo fetch) rather than the site's fixed BLUE/
// GOLD: name + chip border in Color1, the logo box filled Color1 with a
// Color2 stroke, LogoDark (not the plain Logo1) since that box's fill is a
// saturated color. On hover the whole chip inverts to a solid Color1 fill
// (name flips white, the Position/School subtitle flips Color2) and the
// little logo box's own fill/stroke fade to
// transparent — since the chip behind it is now that same Color1, the box
// visually dissolves into it rather than just sitting there recolored —
// while the logo itself scales up dramatically from its own center. The
// box's transform is left alone entirely (no translate) so nothing couples
// with the logo's own scale; without that, growth reads as sliding
// downward instead of expanding in place. A chevron on the right slides
// into view on hover, same as MorePerformancesList.js's own chips.
import { Link } from "react-router-dom";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// showHeader/title/padding let a caller with its own card chrome (e.g.
// MarginSidebars.js's "⭐ Top 2027 Prospects" BLUE header + GOLD bar) drop
// just the chip list in without also getting this component's own
// "Players Mentioned" label — the chips/hover behavior are the reusable
// part, the label treatment isn't always wanted verbatim.
//
// compact shrinks the whole chip (smaller logo box/fonts/padding) for
// narrow contexts like MarginSidebars.js's ~190-300px sidebar column,
// where the full size (built for NewsArticle.jsx's fixed 300px column)
// reads as oversized — and forces First/Last onto their own line each,
// always, rather than wrapping only once a long name actually runs out of
// room. Off by default; NewsArticle.jsx/PerformancePage.js don't pass it.
export default function PlayersMentionedList({ players, schoolInfo, showHeader = true, title = "Players Mentioned", padding, compact = false }) {
  if (!players || players.length === 0) return null;
  return (
    <div>
      {showHeader && (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
            {title}
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>
      )}

      <style>{`
        .wd-mentioned-chip {
          display: flex; align-items: center; gap: 14px; padding: 16px 18px;
          text-decoration: none; border-radius: 10px; background: #fff;
          border: 2px solid var(--c1);
          transition: background 0.18s ease;
        }
        .wd-mentioned-chip:hover { background: var(--c1); }
        /* No white-space/overflow constraints here on purpose — a name too
           wide for the chip wraps onto a second line and the row (a flex
           column, auto height) just grows to fit rather than truncating or
           overflowing. */
        .wd-mentioned-chip-name {
          color: var(--c1); font-weight: 900; font-size: 20px; line-height: 1.25;
          word-break: break-word;
          transition: color 0.18s ease;
        }
        .wd-mentioned-chip:hover .wd-mentioned-chip-name { color: #fff; }
        .wd-mentioned-chip-sub {
          color: #777; font-weight: 700; font-size: 14px; margin-top: 3px;
          transition: color 0.18s ease;
        }
        .wd-mentioned-chip:hover .wd-mentioned-chip-sub { color: var(--c2); }
        .wd-mentioned-chip-logobox {
          flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          width: 52px; height: 52px; border-radius: 8px;
          /* Permanently visible, not toggled per hover state — at rest the
             logo is exactly 80% of this box so nothing actually spills
             regardless, and keeping it visible the whole time (rather than
             snapping to hidden the instant the mouse leaves) lets the still-
             oversized logo shrink back down smoothly on its own 0.22s
             transition instead of getting hard-clipped back to the box's
             edges a beat before it's done shrinking. */
          overflow: visible;
          background: var(--c1); border: 2px solid var(--c2);
          /* Delayed on this, the base/resting rule, only — this is what
             governs the transition back to resting (mouse-leave): a beat
             of delay, then the fill/stroke fade back in (rather than
             snapping in one frame), so the box reappears a moment after
             the logo starts shrinking back down instead of right away.
             The :hover rule below sets its own undelayed transition so
             entering hover is unaffected. */
          transition: background 0.35s ease 0.1s, border-color 0.35s ease 0.1s;
        }
        .wd-mentioned-chip:hover .wd-mentioned-chip-logobox {
          background: transparent; border-color: transparent;
          transition: background 0.18s ease, border-color 0.18s ease;
        }
        .wd-mentioned-chip-logo-img {
          width: 80%; height: 80%; object-fit: contain;
          transform-origin: center;
          transition: transform 0.22s ease;
        }
        /* Dramatic, and purely a scale — no translate anywhere in this
           chain — so it reads as growing outward from its own center,
           not sliding in any direction. */
        .wd-mentioned-chip:hover .wd-mentioned-chip-logo-img { transform: scale(1.7); }
        .wd-mentioned-chip-chevron {
          flex-shrink: 0; color: var(--c1); font-size: 22px; font-weight: 900;
          opacity: 0; transform: translateX(-6px);
          transition: opacity 0.18s ease, transform 0.18s ease, color 0.18s ease;
        }
        .wd-mentioned-chip:hover .wd-mentioned-chip-chevron {
          opacity: 1; transform: translateX(0); color: #fff;
        }
        /* Compact modifier — see the "compact" prop doc above. Only sizing
           changes here; colors/hover behavior are inherited as-is from the
           base rules above. */
        .wd-mentioned-chip.wd-compact { gap: 10px; padding: 10px 12px; }
        .wd-mentioned-chip.wd-compact .wd-mentioned-chip-logobox { width: 36px; height: 36px; }
        .wd-mentioned-chip.wd-compact .wd-mentioned-chip-name { font-size: 14px; }
        .wd-mentioned-chip.wd-compact .wd-mentioned-chip-sub { font-size: 11px; margin-top: 2px; }
        .wd-mentioned-chip.wd-compact .wd-mentioned-chip-chevron { font-size: 16px; }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: padding || 0 }}>
        {players.map((p) => {
          const info = schoolInfo?.[p.School] || {};
          const color1 = info.color1 || BLUE;
          const color2 = info.color2 || GOLD;
          // LogoDark, not the plain Logo1 — this box's own fill is a
          // saturated team color, and the light-background Logo1 variant
          // often disappears against it.
          const logo = info.logoDark || info.logo;
          return (
            <Link
              key={p.id}
              to={`/player/${p.Slug}`}
              className={"wd-mentioned-chip" + (compact ? " wd-compact" : "")}
              style={{ "--c1": color1, "--c2": color2 }}
            >
              <div className="wd-mentioned-chip-logobox">
                {logo ? (
                  <img
                    className="wd-mentioned-chip-logo-img"
                    src={logo} alt={p.School || ""}
                    referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ) : (
                  <span style={{ color: "#fff", opacity: 0.85, fontSize: "22px", fontWeight: 900 }}>?</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                {/* compact: First and Last always on their own line each
                    (a flex column of two spans), not a single text run
                    that only wraps once it runs out of room. */}
                {compact ? (
                  <span className="wd-mentioned-chip-name" style={{ display: "flex", flexDirection: "column" }}>
                    <span>{p.First}</span>
                    <span>{p.Last}</span>
                  </span>
                ) : (
                  <span className="wd-mentioned-chip-name">{p.First} {p.Last}</span>
                )}
                <span className="wd-mentioned-chip-sub">
                  <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{p.Position || "—"}</span>
                  {p.School && <span> · {p.School}</span>}
                </span>
              </div>
              <span className="wd-mentioned-chip-chevron">›</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
