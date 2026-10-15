// src/components/PlayerHeaderShell.js
//
// Stand-in for PlayerProfile.js's hero card while the page is still
// loading — shown both as the route's Suspense fallback (while the
// PlayerProfile chunk downloads) and by PlayerProfile itself until the
// player doc lands, so a cold visit sees a header straight away instead of
// a bare full-page spinner. Everything it shows comes from the URL slug
// (name, class, position) — no fetch — and it sits in the same grid slot
// as the real hero, which replaces it in place. Lives outside the
// PlayerProfile chunk on purpose: it has to render before that chunk loads.
import { useParams } from "react-router-dom";
import LoadingSpinner from "./LoadingSpinner";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

const POSITIONS = new Set([
  "qb", "rb", "fb", "wr", "te", "ol", "ot", "og", "oc", "c", "iol", "dl", "de", "dt", "idl",
  "edge", "lb", "ilb", "olb", "cb", "s", "fs", "ss", "db", "saf", "k", "p", "ls", "ath",
]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

// "kanye-udoh-2027-rb", "ashton-hampton-2027-db-1", "…-2026s-qb" and
// year-last "sam-darnold-qb-2017" → { first, last, year, position }.
export function parsePlayerSlug(slug = "") {
  const parts = slug.toLowerCase().split("-").filter(Boolean);
  const yi = parts.findIndex((p) => /^\d{4}s?$/.test(p));
  let nameParts = yi >= 0 ? parts.slice(0, yi) : parts;
  let position = yi >= 0 ? parts.slice(yi + 1).find((p) => POSITIONS.has(p)) : null;
  if (nameParts.length > 1 && POSITIONS.has(nameParts[nameParts.length - 1])) {
    position = position || nameParts[nameParts.length - 1];
    nameParts = nameParts.slice(0, -1);
  }
  const word = (w) => (SUFFIXES.has(w) ? (w === "jr" || w === "sr" ? w[0].toUpperCase() + w.slice(1) + "." : w.toUpperCase()) : w[0].toUpperCase() + w.slice(1));
  const words = nameParts.map(word);
  return {
    first: words[0] || "",
    last: words.slice(1).join(" "),
    year: yi >= 0 ? parts[yi].replace(/s$/, "") : null,
    position: position ? position.toUpperCase() : null,
  };
}

export default function PlayerHeaderShell() {
  const { slug } = useParams();
  const { first, last, year, position } = parsePlayerSlug(slug);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const subline = [position, year && `${year} Class`].filter(Boolean).join(" · ");

  const hero = (
    <div className="mb-6 rounded-lg overflow-hidden" style={{ border: `3px solid ${SITE_BLUE}` }}>
      <div style={{ display: "flex", alignItems: "center", backgroundColor: SITE_BLUE, padding: isMobile ? "10px 12px" : "12px 20px" }}>
        <button onClick={() => window.history.back()} className="text-white font-extrabold"
          style={{ border: "2px solid #fff", background: "rgba(255,255,255,0.12)", fontSize: isMobile ? "14px" : "16px", padding: isMobile ? "8px 16px" : "10px 22px", borderRadius: "8px", cursor: "pointer", letterSpacing: "0.04em" }}>
          ← Back
        </button>
      </div>
      <div style={{
        background: [
          `radial-gradient(circle 220px at top left, ${SITE_GOLD}55, transparent 100%)`,
          `radial-gradient(circle 220px at bottom right, ${SITE_GOLD}55, transparent 100%)`,
          "linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4))",
          `linear-gradient(120deg, ${SITE_BLUE} 0%, ${SITE_BLUE} 55%, ${SITE_GOLD} 100%)`,
        ].join(", "),
        padding: isMobile ? "16px 10px 18px" : "28px 24px 30px",
        textAlign: "center",
      }}>
        <h1 className="font-black uppercase leading-none" style={{ fontSize: isMobile ? "clamp(20px,6vw,30px)" : "clamp(36px,5vw,58px)", color: "#fff", letterSpacing: "0.02em", textShadow: "0 2px 8px rgba(0,0,0,0.4)", margin: 0 }}>
          <div>{first}</div>
          <div style={{ marginTop: isMobile ? "2px" : "4px" }}>{last}</div>
        </h1>
        {subline && (
          <div style={{ marginTop: isMobile ? "8px" : "12px", color: "rgba(255,255,255,0.85)", fontWeight: 900, fontSize: isMobile ? "12px" : "15px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {subline}
          </div>
        )}
      </div>
    </div>
  );

  const body = (
    <div>
      {hero}
      <LoadingSpinner label="Loading scouting report" size={40} minHeight="200px" />
    </div>
  );

  // Same outer geometry as PlayerProfile.js's main grid, so the real hero
  // takes this one's exact spot.
  return isMobile ? (
    <div className="mx-auto" style={{ padding: "10px 10px 160px" }}>{body}</div>
  ) : (
    <div className="mx-auto" style={{ maxWidth: "1600px", margin: "-24px auto 0", padding: "0 60px 160px", display: "grid", gridTemplateColumns: "260px minmax(0, 800px) 260px", gap: "18px", alignItems: "start", justifyContent: "center" }}>
      <div />
      {body}
      <div />
    </div>
  );
}
