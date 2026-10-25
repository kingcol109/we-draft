// src/components/GradeChip.jsx
//
// A round grade as the player pages draw it (PlayerProfile.js GradeBadge),
// at list size: the qualifier ("EARLY") over the round ("1st") over
// "ROUND", in the grade's colors with its darker border
// (utils/communityGrades.js gradeLook). The Draft Sim's pick cards draw
// the same thing.
import { gradeLook } from "../utils/communityGrades";

const small = { fontWeight: 900, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1, textAlign: "center" };

export default function GradeChip({ label, title }) {
  if (!label) return null;
  const { short, bg, border, qualifier } = gradeLook(label);
  return (
    <span title={title || label} style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, flexShrink: 0,
      minWidth: 44, boxSizing: "border-box", background: bg, border: `3px solid ${border}`, borderRadius: 6, padding: "4px 6px", fontFamily: "Arial, sans-serif",
    }}>
      {qualifier && <span style={{ ...small, fontSize: 7 }}>{qualifier}</span>}
      <span style={{ fontSize: 18, fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>{short}</span>
      <span style={{ ...small, fontSize: 7, fontWeight: 800, color: "rgba(255,255,255,0.8)", letterSpacing: "0.07em" }}>ROUND</span>
    </span>
  );
}
