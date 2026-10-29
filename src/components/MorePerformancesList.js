// src/components/MorePerformancesList.js
//
// "More Performances" chips (PerformancePage.js's own sidebar) — same
// team-colored chip as PlayersMentionedList.js (border/name in Color1, logo
// box filled Color1 with a Color2 stroke, LogoDark, logo grows dramatically
// from center on hover, chevron slides in) with two differences: the
// subtitle is the performance's statLine instead of Position/School, and
// that subtitle turns white on hover instead of Color2. Otherwise identical
// on purpose, so the two read as the same feature applied to two different
// kinds of "other stuff to look at" list — but with its own class names
// (wd-more-perf-chip*, not wd-mentioned-chip*): this and
// PlayersMentionedList.js both render on PerformancePage.js at once, and
// reusing the same class names would mean whichever component's <style>
// block landed later in the DOM would win the cascade for *both* lists'
// hover colors (equal specificity, so it's pure source order), silently
// breaking one of them depending on render order.
//
// One more difference: a red "N MINUTES AGO" tag (with a red dot, like a
// live/freshness indicator) built from the performance's own createdAt —
// sits outside the chip's own box entirely, directly below it, rather than
// inside as another line of chip content, so it reads as a freshness
// stamp on the row rather than something the chip itself is saying. Always
// red regardless of hover, unlike everything else in this chip that flips
// color on hover — it's a status indicator, not chip content. Exported
// (not just used here) since PerformancePage.js shows the same tag on the
// performance page itself, under the title.
//
// The statLine also gets the same grade "pop" (Dominant/Great/Good) as
// every other statLine sitewide — see statLineGlow.js.
import { Link } from "react-router-dom";
import { gradeStatLineClass, STAT_LINE_GLOW_STYLE } from "./statLineGlow";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const RED = "#c0392b";

// "5 minutes ago" etc — rendered all-caps via CSS (text-transform), not by
// upper-casing the string here.
export function timeAgo(ts) {
  const date = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
  if (!date) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} month${diffMonth !== 1 ? "s" : ""} ago`;
  const diffYear = Math.floor(diffMonth / 12);
  return `${diffYear} year${diffYear !== 1 ? "s" : ""} ago`;
}

export default function MorePerformancesList({ performances, schoolInfo }) {
  if (!performances || performances.length === 0) return null;
  return (
    <div>
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
          More Performances
        </div>
        <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
        <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
      </div>

      <style>{`
        .wd-more-perf-chip {
          display: flex; align-items: center; gap: 14px; padding: 16px 18px;
          text-decoration: none; border-radius: 10px; background: #fff;
          border: 2px solid var(--c1);
          transition: background 0.18s ease;
        }
        .wd-more-perf-chip:hover { background: var(--c1); }
        /* No white-space/overflow constraints on purpose — a name too wide
           for the chip wraps onto a second line and the row (a flex column,
           auto height) just grows to fit rather than truncating. */
        .wd-more-perf-chip-name {
          color: var(--c1); font-weight: 900; font-size: 20px; line-height: 1.25;
          word-break: break-word;
          transition: color 0.18s ease;
        }
        .wd-more-perf-chip:hover .wd-more-perf-chip-name { color: #fff; }
        .wd-more-perf-chip-sub {
          color: #777; font-weight: 700; font-size: 16px; margin-top: 3px;
          font-family: 'Courier New', monospace;
          transition: color 0.18s ease;
        }
        .wd-more-perf-chip:hover .wd-more-perf-chip-sub { color: #fff; }
        /* Sits below the chip's own box (see the JSX — it's a sibling of
           the chip Link, not nested inside it), so it's free to be sized
           generously without growing the box itself. Always red regardless
           of the chip above it being hovered — a freshness indicator, not
           chip content. */
        .wd-more-perf-chip-time {
          display: flex; align-items: center; gap: 6px; margin: 6px 0 0 4px;
          color: ${RED}; font-weight: 900; font-size: 13px;
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .wd-more-perf-chip-time-dot {
          flex-shrink: 0; width: 9px; height: 9px; border-radius: 50%; background: ${RED};
          animation: wdFreshDotPulse 1.4s ease-in-out infinite;
        }
        /* Same "live" pulse PerformancePage.js's own copy of this dot uses
           (below the title) — plain opacity flash, no movement. */
        @keyframes wdFreshDotPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
        .wd-more-perf-chip-logobox {
          flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          width: 52px; height: 52px; border-radius: 8px; overflow: visible;
          background: var(--c1); border: 2px solid var(--c2);
          /* A beat of delay, then the fill/stroke fade back in (rather
             than snapping in one frame), same as PlayersMentionedList.js's
             logobox. */
          transition: background 0.35s ease 0.1s, border-color 0.35s ease 0.1s;
        }
        .wd-more-perf-chip:hover .wd-more-perf-chip-logobox {
          background: transparent; border-color: transparent;
          transition: background 0.18s ease, border-color 0.18s ease;
        }
        .wd-more-perf-chip-logo-img {
          width: 80%; height: 80%; object-fit: contain;
          transform-origin: center;
          transition: transform 0.22s ease;
        }
        .wd-more-perf-chip:hover .wd-more-perf-chip-logo-img { transform: scale(1.7); }
        .wd-more-perf-chip-chevron {
          flex-shrink: 0; color: var(--c1); font-size: 22px; font-weight: 900;
          opacity: 0; transform: translateX(-6px);
          transition: opacity 0.18s ease, transform 0.18s ease, color 0.18s ease;
        }
        .wd-more-perf-chip:hover .wd-more-perf-chip-chevron {
          opacity: 1; transform: translateX(0); color: #fff;
        }
        ${STAT_LINE_GLOW_STYLE}
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {performances.map((p) => {
          const info = schoolInfo?.[p.school] || {};
          const color1 = info.color1 || BLUE;
          const color2 = info.color2 || GOLD;
          const logo = info.logoDark || info.logo;
          const name = p.playerName || p.titleShort;
          const subtitle = p.statLine || p.titleShort || "";
          const createdLabel = timeAgo(p.createdAt);
          return (
            <div key={p.id}>
              <Link
                to={`/performance/${p.slug}`}
                className="wd-more-perf-chip"
                style={{ "--c1": color1, "--c2": color2 }}
              >
                <div className="wd-more-perf-chip-logobox">
                  {logo ? (
                    <img
                      className="wd-more-perf-chip-logo-img"
                      src={logo} alt={p.school || ""}
                      referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  ) : (
                    <span style={{ color: "#fff", opacity: 0.85, fontSize: "22px", fontWeight: 900 }}>?</span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span className="wd-more-perf-chip-name">{name}</span>
                  {subtitle && (
                    <span className={`wd-more-perf-chip-sub ${p.statLine ? gradeStatLineClass(p.grade) : ""}`}>{subtitle}</span>
                  )}
                </div>
                <span className="wd-more-perf-chip-chevron">›</span>
              </Link>
              {createdLabel && (
                <span className="wd-more-perf-chip-time">
                  <span className="wd-more-perf-chip-time-dot" />
                  {createdLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
