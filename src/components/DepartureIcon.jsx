// src/components/DepartureIcon.jsx
//
// Where a player goes when he isn't going to another school (user,
// 2026-11-17): the NFL shield for the draft, a graduation cap for out of
// eligibility — used where a new school's logo would go (the Transfer
// Portal's rosters and player card, the Portal Sim). The cap comes in black
// (light backgrounds) and white (dark ones — the sim, team-color fills); the
// shield reads on both. Files: public/logos/nfl-shield.png,
// grad-cap-black.png, grad-cap-white.png.
export const NFL_ICON = "/logos/nfl-shield.png";
export const GRAD_ICON = { light: "/logos/grad-cap-black.png", dark: "/logos/grad-cap-white.png" };
export const departureIcon = (kind, dark = false) => (kind === "nfl" ? NFL_ICON : dark ? GRAD_ICON.dark : GRAD_ICON.light);

// kind: "nfl" | "grad"; dark: on a dark background.
export default function DepartureIcon({ kind, dark = false, size = 26, title }) {
  const label = title || (kind === "nfl" ? "NFL Draft" : "Out of eligibility");
  return (
    <span title={label} style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <img src={departureIcon(kind, dark)} alt={label} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
    </span>
  );
}
