// src/components/LoadingSpinner.js
//
// The one loading indicator for the whole site. Before this, there were
// ~34 independent loading states across 19 files: a couple of hand-built
// ring spinners (AdminRoute.js's being the best of them — this component is
// that same design, generalized), a tiny ad-hoc mini-spinner, and a pile of
// plain "Loading..." text in at least four different gray shades. This
// replaces all of them with one ring (brand blue track + blue/gold rotating
// arc) plus an optional animated-ellipsis label, sized for three contexts:
// full-page, section-level, and inline.
const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function LoadingSpinner({ label, size = 40, minHeight, inline = false }) {
  const ringThickness = Math.max(3, Math.round(size / 11));

  const ring = (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `${ringThickness}px solid ${BLUE}`, opacity: 0.15 }} />
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: `${ringThickness}px solid transparent`, borderTopColor: BLUE, borderRightColor: GOLD,
          animation: "wdLoadingSpin 0.9s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite",
        }}
      />
    </div>
  );

  const content = label ? (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: size >= 48 ? "18px" : "10px" }}>
      {ring}
      <div
        style={{
          fontSize: size >= 48 ? "18px" : size >= 32 ? "14px" : "12px",
          fontWeight: 900, color: BLUE, letterSpacing: "0.03em",
          fontFamily: "'Arial Black', Arial, sans-serif",
          display: "flex", alignItems: "baseline",
        }}
      >
        {label}
        <span style={{ display: "inline-flex", marginLeft: "3px" }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ animation: "wdLoadingDotPulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.15}s` }}>.</span>
          ))}
        </span>
      </div>
    </div>
  ) : ring;

  return (
    <>
      <style>{`
        @keyframes wdLoadingSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes wdLoadingDotPulse { 0%, 80%, 100% { opacity: 0.15; } 40% { opacity: 1; } }
      `}</style>
      {inline ? (
        content
      ) : (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: minHeight || "160px", width: "100%" }}>
          {content}
        </div>
      )}
    </>
  );
}
