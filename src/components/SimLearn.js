// src/components/SimLearn.js
// ── Learn mode's pieces (/sim → 📖 Learn), laid out by SimPage.js: the
// concept list down the left, the article in the middle, the live field
// (sticky) on the right. Content lives in src/sim/lessons.js. ──
import { LESSONS, COMING_SOON } from "../sim/lessons";
import { FRONTS } from "../sim/playbook";

const ORANGE = "#F6A21D";

export function LessonList({ current, onPick }) {
  const head = { fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em", color: "#64748b", textTransform: "uppercase", padding: "6px 12px 4px" };
  return (
    <div style={{ width: "180px", flexShrink: 0, maxHeight: "calc(100vh / var(--pz, 1) - 70px)", overflowY: "auto", background: "#0f172a", border: "1px solid #1f2937", borderRadius: "6px", padding: "8px 0" }}>
      {[["offense", "Offense"], ["defense", "Defense"]].map(([side, name], gi) => (
        <div key={side} style={{ marginBottom: "6px" }}>
          <div style={{ ...head, marginTop: gi ? "8px" : 0 }}>{name}</div>
          {Object.entries(LESSONS)
            .filter(([, l]) => (l.side || "offense") === side)
            .map(([id, l]) => {
              const active = id === current;
              return (
                <button
                  key={id}
                  onClick={(e) => { onPick(id); e.currentTarget.blur(); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                    borderLeft: `3px solid ${active ? ORANGE : "transparent"}`,
                    background: active ? "rgba(246,162,29,0.12)" : "transparent",
                    color: active ? ORANGE : "#e2e8f0", fontWeight: 800, fontSize: "13px", padding: "7px 12px",
                  }}
                >
                  {l.title}
                </button>
              );
            })}
        </div>
      ))}
      <div style={{ ...head, marginTop: "10px" }}>Coming soon</div>
      {COMING_SOON.map((name) => (
        <div key={name} style={{ fontSize: "12px", fontWeight: 600, color: "#475569", padding: "5px 15px" }}>{name}</div>
      ))}
    </div>
  );
}

const pill = (active) => ({
  padding: "5px 11px", borderRadius: "999px", cursor: "pointer", fontSize: "12px", fontWeight: 800,
  border: `1px solid ${active ? ORANGE : "#475569"}`,
  background: active ? "rgba(246,162,29,0.18)" : "#1e293b",
  color: active ? ORANGE : "#e2e8f0",
});

// The article. `active` is the key of the demo playing on the field
// ("d:<section>:<i>"), so its button lights up.
// tryIt: { on, sel: { play, front }, onStart, onSelect } — the Try it card.
export function LessonArticle({ id, active, onDemo, tryIt }) {
  const lesson = LESSONS[id];
  if (!lesson) return null;
  const blur = (fn) => (e) => { fn(); e.currentTarget.blur(); };
  return (
    <article style={{ width: "420px", flexShrink: 0, maxHeight: "calc(100vh / var(--pz, 1) - 70px)", overflowY: "auto", paddingRight: "6px" }}>
      <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em", color: "#64748b", textTransform: "uppercase" }}>Concept</div>
      <h1 style={{ margin: "2px 0 4px", fontSize: "28px", fontWeight: 900, color: "#f8fafc" }}>{lesson.title}</h1>
      <p style={{ margin: "0 0 18px", fontSize: "15px", color: "#cbd5e1", lineHeight: 1.5 }}>{lesson.intro}</p>
      {lesson.sections.map((s, si) => {
        const here = active && active.split(":")[1] === String(si);
        return (
          <section
            key={s.heading}
            style={{ marginBottom: "22px", paddingLeft: "12px", borderLeft: `3px solid ${here ? ORANGE : "#1f2937"}`, transition: "border-color 0.2s" }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 900, letterSpacing: "0.1em", color: ORANGE, textTransform: "uppercase" }}>{s.heading}</h2>
            {s.demos && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {s.demos.map((d, i) => (
                  <button key={d.label} style={pill(active === `d:${si}:${i}`)} onClick={blur(() => onDemo(si, i))}>
                    ▶ {d.label}
                  </button>
                ))}
              </div>
            )}
            {s.body.map((b, i) => (
              <p key={i} style={{ margin: "0 0 10px", fontSize: "14.5px", lineHeight: 1.65, color: "#cbd5e1" }}>
                {typeof b === "string" ? b : (
                  <>
                    <strong style={{ color: "#f8fafc" }}>{b.term}:</strong> {b.text}
                  </>
                )}
              </p>
            ))}
          </section>
        );
      })}
      {lesson.tryIt && tryIt && <TryCard lesson={lesson} {...tryIt} />}
      <div style={{ height: "30px" }} />
    </article>
  );
}

// ── "Try it": the bottom of every lesson. Off, a button; on, the field is
// playable — pick a play (this concept from different formations) and a
// front, or leave either on Rotate to get a new one each rep. ──
const tryLabel = { fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em", color: "#94a3b8", textTransform: "uppercase", marginBottom: "4px" };
const trySelect = {
  width: "100%", background: "#0b1220", color: "#e2e8f0", border: "1px solid #475569", borderRadius: "6px",
  padding: "7px 8px", fontSize: "13px", fontWeight: 700, fontFamily: "inherit",
};
function TryCard({ lesson, on, sel, onStart, onSelect }) {
  const blurAfter = (fn) => (e) => { fn(e); e.currentTarget.blur(); };
  return (
    <section style={{ marginTop: "8px", padding: "14px", borderRadius: "8px", border: `2px solid ${on ? ORANGE : "#1f2937"}`, background: on ? "rgba(246,162,29,0.06)" : "#0f172a" }}>
      <h2 style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 900, letterSpacing: "0.1em", color: ORANGE, textTransform: "uppercase" }}>Try it</h2>
      {!on ? (
        <>
          <p style={{ margin: "0 0 10px", fontSize: "14px", lineHeight: 1.55, color: "#cbd5e1" }}>
            {lesson.side === "defense"
              ? `Take the offense against the ${lesson.title}: run zone, gap and play-action at it and watch the fits.`
              : `Take the field yourself: run ${lesson.title.toLowerCase()} from different formations against different fronts.`}
          </p>
          <button
            onClick={blurAfter(onStart)}
            style={{ width: "100%", padding: "11px", borderRadius: "8px", border: "none", cursor: "pointer", background: ORANGE, color: "#0b1220", fontSize: "14px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}
          >
            ▶ Try it yourself
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gap: "10px", marginBottom: "10px" }}>
            <label>
              <div style={tryLabel}>Play</div>
              <select style={trySelect} value={sel.play} onChange={blurAfter((e) => onSelect({ play: e.target.value === "rotate" ? "rotate" : Number(e.target.value) }))}>
                <option value="rotate">Rotate: a new one each rep</option>
                {lesson.tryIt.plays.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
              </select>
            </label>
            {lesson.tryIt.front ? (
              <div>
                <div style={tryLabel}>Defensive front</div>
                <div style={{ ...trySelect, borderColor: "#334155", color: "#94a3b8" }}>{FRONTS[lesson.tryIt.front]} (this lesson's front, random coverage)</div>
              </div>
            ) : (
              <label>
                <div style={tryLabel}>Defensive front</div>
                <select style={trySelect} value={sel.front} onChange={blurAfter((e) => onSelect({ front: e.target.value }))}>
                  <option value="rotate">Rotate: a new one each rep</option>
                  {Object.entries(FRONTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            )}
          </div>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.55, color: "#cbd5e1" }}>{lesson.tryIt.controls}</p>
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#64748b" }}>Pick any ▶ above to go back to the demos.</p>
        </>
      )}
    </section>
  );
}
