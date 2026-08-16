// src/components/TeamsMentionedList.js
//
// "Teams Mentioned" chips — same pre-hover look as PlayersMentionedList.js
// (border/name in the team's own Color1, logo box filled Color1 with a
// Color2 stroke, LogoDark against it) so both read as the same feature.
// The hover itself is deliberately different, though: the little logo (and
// its box) never grows here the way a player's does — it just fades away —
// and in its place the team's own wordmark (WordmarkDark, falling back to
// the plain Wordmark, same TeamPage.js hero fields) grows to fill the
// *entire chip*, not just the old 52px icon slot, since a wordmark reads as
// a banner graphic rather than something that belongs in a square icon
// slot. A team with no wordmark art at all still just gets the logo fading
// away with nothing replacing it — no fallback grow — matching "the logo
// doesn't grow, it fades" as the one consistent rule here regardless of
// whether a wordmark exists. The chip's own name text (which would
// otherwise sit on top of the wordmark) fades out for the wordmark case
// specifically — see the wd-has-wordmark class below — rather than staying
// on to collide with it.
import { Link } from "react-router-dom";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function TeamsMentionedList({ teams }) {
  if (!teams || teams.length === 0) return null;
  return (
    <div>
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
          Teams Mentioned
        </div>
        <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
        <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
      </div>

      <style>{`
        .wd-mentioned-team-chip {
          position: relative; overflow: hidden;
          display: flex; align-items: center; gap: 14px; padding: 16px 18px;
          text-decoration: none; border-radius: 10px; background: #fff;
          border: 2px solid var(--c1);
          transition: background 0.18s ease;
        }
        .wd-mentioned-team-chip:hover { background: var(--c1); }
        .wd-mentioned-team-name {
          color: var(--c1); font-weight: 900; font-size: 18px; line-height: 1.25;
          transition: color 0.18s ease, opacity 0.18s ease;
        }
        .wd-mentioned-team-chip:hover .wd-mentioned-team-name { color: #fff; }
        /* Wordmark case only — the plain-text name would otherwise sit
           directly where the wordmark spills out to; it fades away instead
           of turning white like the no-wordmark case above. */
        .wd-mentioned-team-chip.wd-has-wordmark:hover .wd-mentioned-team-name { opacity: 0; }
        .wd-mentioned-team-logobox {
          position: relative; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          width: 52px; height: 52px; border-radius: 8px; overflow: hidden;
          background: var(--c1); border: 2px solid var(--c2);
          transition: background 0.18s ease, border-color 0.18s ease;
        }
        .wd-mentioned-team-chip:hover .wd-mentioned-team-logobox {
          background: transparent; border-color: transparent;
          overflow: visible;
        }
        /* Unlike Players Mentioned, this logo never grows — it just fades
           away (box included, via the background/border-color rule above)
           on any team hover, wordmark or not. */
        .wd-mentioned-team-logo-img {
          width: 80%; height: 80%; object-fit: contain;
          transition: opacity 0.22s ease;
        }
        .wd-mentioned-team-chip:hover .wd-mentioned-team-logo-img { opacity: 0; }
        /* Sized/centered against the whole chip (its containing block —
           see position:relative on .wd-mentioned-team-chip above), not the
           little logo box — inset:0 fills it completely (the chip's own
           padding doesn't constrain an absolutely-positioned child, so this
           reaches all the way to the chip's border), so growth genuinely
           fills the entire chip rather than some inset fraction of it.
           Scale is the only thing the hover transition touches, so growth
           can only ever read as expanding from dead center. */
        .wd-mentioned-team-wordmark-img {
          position: absolute; inset: 0;
          width: 100%; height: 100%; object-fit: contain;
          transform: scale(0.5);
          opacity: 0; pointer-events: none;
          transition: transform 0.24s ease, opacity 0.24s ease;
        }
        .wd-mentioned-team-chip:hover .wd-mentioned-team-wordmark-img {
          opacity: 1; transform: scale(1);
        }
        /* position:relative (not the default static) so this stacks above
           the absolutely-positioned wordmark by DOM order — placed after it
           below — instead of unconditionally behind it the way a plain
           static-positioned sibling always is next to a positioned one. */
        .wd-mentioned-team-chevron {
          position: relative; flex-shrink: 0; color: var(--c1); font-size: 22px; font-weight: 900;
          opacity: 0; transform: translateX(-6px);
          transition: opacity 0.18s ease, transform 0.18s ease, color 0.18s ease;
        }
        .wd-mentioned-team-chip:hover .wd-mentioned-team-chevron {
          opacity: 1; transform: translateX(0); color: #fff;
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {teams.map((t) => {
          const color1 = t.color1 || BLUE;
          const color2 = t.color2 || GOLD;
          const logo = t.logoDark || t.logo;
          const wordmark = t.wordmarkDark || t.wordmark || "";
          return (
            <Link
              key={t.slug}
              to={`/team/${t.slug}`}
              className={"wd-mentioned-team-chip" + (wordmark ? " wd-has-wordmark" : "")}
              style={{ "--c1": color1, "--c2": color2 }}
            >
              <div className="wd-mentioned-team-logobox">
                {logo ? (
                  <img
                    className="wd-mentioned-team-logo-img"
                    src={logo} alt={t.name}
                    referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ) : (
                  <span style={{ color: "#fff", opacity: 0.85, fontSize: "22px", fontWeight: 900 }}>?</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span className="wd-mentioned-team-name">{t.name}</span>
              </div>
              {/* Direct child of the chip (not nested in the little logo
                  box) — sized/centered against the chip itself, see the
                  CSS above. */}
              {wordmark && (
                <img
                  className="wd-mentioned-team-wordmark-img"
                  src={wordmark} alt=""
                  referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              )}
              <span className="wd-mentioned-team-chevron">›</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
