// src/components/TransferStars.jsx
//
// A transfer-star badge (2–6, utils/portalStars.mjs) — the admin's Grades
// tab now, the public portal when it shows them. Number + star, colored by
// tier.
export const STAR_COLORS = {
  6: { fg: "#fff", bg: "linear-gradient(135deg, #7b2ff7 0%, #c026d3 100%)", border: "#6d28d9" },
  5: { fg: "#fff", bg: "#f6a21d", border: "#c77700" },
  4: { fg: "#fff", bg: "#0055a5", border: "#003f7d" },
  3: { fg: "#2e7d32", bg: "#e8f5e9", border: "#2e7d32" },
  2: { fg: "#5b6b84", bg: "#eef1f5", border: "#b8c2d1" },
};

export default function TransferStars({ stars, size = "md", title }) {
  if (!stars) return <span style={{ color: "#c3cad4", fontWeight: 900 }}>—</span>;
  const c = STAR_COLORS[stars] || STAR_COLORS[2];
  const sm = size === "sm";
  return (
    <span title={title || `${stars}-star transfer`} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "2px", flexShrink: 0,
      minWidth: sm ? 34 : 44, height: sm ? 22 : 28, padding: "0 7px", borderRadius: "8px",
      background: c.bg, color: c.fg, border: `1.5px solid ${c.border}`, fontWeight: 900, fontSize: sm ? "12px" : "15px", lineHeight: 1,
    }}>
      {stars}<span style={{ fontSize: sm ? "11px" : "13px" }}>★</span>
    </span>
  );
}
