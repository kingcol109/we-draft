// src/pages/ClassIntro.jsx
//
// /class-of-2030 — "Meet the Class of 2030" (utils/classIntro.js): the
// one-time WX article introducing the 2030 NFL Draft class. Set in Admin →
// Content → Class of 2030 (components/AdminClassIntro.jsx).
//   Hero      the class, the position jump links, the admin's intro
//   Positions one section per position (H2), 3–5 cards each: his graphic
//             (components/ProspectIntroGraphic.jsx), name (to his page once
//             the class is public), the school he signed with (to its team
//             page — the article ties every player to his team), high
//             school and home state, the write-up
//   Headed    "Where They're Headed": every school with a signee here, its
//             players under it — each school to its team page
// Unreleased (live false): admins only, with a preview banner; everyone
// else gets the 404, and it's noindex until it's out.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { collection, doc, getDoc, getDocs, query, where, documentId } from "firebase/firestore";
import { db } from "../firebase";
import { useSchools } from "../components/DraftArchiveList";
import { useProspectGraphic, stateAbbrOf } from "../components/ProspectIntroGraphic";
import { placedShots } from "../components/RiserGraphic";
import StateShape from "../components/StateShape";
import LoadingSpinner from "../components/LoadingSpinner";
import { useIsAdmin, isUnreleasedYear } from "../utils/prospectYears";
import { playerHref, schoolHref } from "../utils/events";
import { stateName } from "../utils/highSchoolMatch";
import { CLASS_INTRO_YEAR, CLASS_INTRO_DOC, CI_POSITIONS, classIntroPath, picksIn, allPicks, signingClassOf } from "../utils/classIntro";

const SITE = "https://we-draft.com";
const GOLD = "#f6a21d";
const BLUE = "#0055a5";
const NAVY = "#070d18";
const BODY = "Arial, sans-serif";
const HEAD = "'Arial Black', Arial, sans-serif";
const COLUMN = 1100;
const nameOf = (p) => `${p.first} ${p.last}`;
const posAnchor = (k) => k.toLowerCase();

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => { const f = () => setM(window.innerWidth < 768); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return m;
}
const paragraphs = (t) => String(t || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

export default function ClassIntro() {
  const year = CLASS_INTRO_YEAR;
  const isMobile = useIsMobile();
  const { isAdmin, authReady } = useIsAdmin();
  const [data, setData] = useState(undefined); // undefined loading, null none / not allowed
  const [readError, setReadError] = useState(""); // an admin's read refused (rules not deployed)
  const [photos, setPhotos] = useState({});

  // Read once auth is known: before release the rules let only an admin read it.
  // An admin with nothing saved yet gets the empty draft, not the 404.
  useEffect(() => {
    if (!authReady) return undefined;
    let live = true;
    setReadError("");
    getDoc(doc(db, CLASS_INTRO_DOC, year))
      .then((s) => live && setData(s.exists() ? s.data() : isAdmin ? { live: false, positions: {}, intro: "" } : null))
      .catch((e) => {
        if (!live) return;
        if (isAdmin) { setReadError(e?.code || e?.message || "read refused"); setData({ live: false, positions: {}, intro: "" }); } else setData(null);
      });
    return () => { live = false; };
  }, [authReady, isAdmin, year]);

  const picks = useMemo(() => allPicks(data?.positions), [data]);
  const idsKey = picks.map((p) => p.id).join(",");
  // His placed action shots (a class of 2030 player can have them).
  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (!ids.length) return undefined;
    let live = true;
    const chunks = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    Promise.all(chunks.map((c) => getDocs(query(collection(db, "playerPhotos"), where(documentId(), "in", c))).catch(() => null)))
      .then((snaps) => {
        const out = {};
        snaps.forEach((s) => s?.docs.forEach((d) => { out[d.id] = d.data(); }));
        if (live) setPhotos(out);
      });
    return () => { live = false; };
  }, [idsKey]);
  const schools = useSchools(picks.map((p) => p.school));

  useEffect(() => { if (data !== undefined) window.prerenderReady = true; }, [data]);

  if (data === undefined) return <LoadingSpinner size={48} minHeight="calc(60vh / var(--pz, 1))" />;
  if (!data || (!data.live && !isAdmin)) {
    return (
      <>
        <Helmet><meta name="robots" content="noindex" /></Helmet>
        <div style={{ textAlign: "center", color: "red", fontWeight: "bold" }}>404 – Route not found</div>
      </>
    );
  }

  // ── SEO ──
  const url = `${SITE}${classIntroPath(year)}`;
  const title = `Meet the Class of ${year}: The ${year} NFL Draft Class's Top Prospects`;
  const named = picks.slice(0, 3).map(nameOf);
  const description = `Meet the ${year} NFL Draft class — the class of ${signingClassOf(year)} high school signees, position by position${named.length ? `, from ${named.join(", ")}` : ""}: where they signed, where they're from, and why they matter.`;
  const released = data.releasedAt?.toDate ? data.releasedAt.toDate() : null;
  const updated = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article", "@id": `${url}#article`, headline: title, description, url, inLanguage: "en-US",
        mainEntityOfPage: url, publisher: { "@type": "Organization", name: "We-Draft.com", url: SITE },
        ...(released ? { datePublished: released.toISOString() } : {}), ...(updated ? { dateModified: updated.toISOString() } : {}),
      },
      {
        "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: `Meet the Class of ${year}`, item: url },
        ],
      },
      ...(picks.length ? [{
        "@type": "ItemList", name: `Class of ${year} NFL Draft prospects`, numberOfItems: picks.length,
        itemListElement: picks.map((p, i) => ({ "@type": "ListItem", position: i + 1, name: nameOf(p), ...(playerHref(p) ? { url: `${SITE}${playerHref(p)}` } : {}) })),
      }] : []),
    ],
  };

  const shown = CI_POSITIONS.filter((p) => picksIn(data.positions, p.key).length);
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        {!data.live && <meta name="robots" content="noindex, nofollow" />}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <div style={{ maxWidth: COLUMN, margin: `${isMobile ? -14 : -12}px auto 0`, padding: isMobile ? "4px 10px 60px" : "10px 24px 60px", fontFamily: HEAD }}>
        {!data.live && <PreviewBanner />}
        {readError && <ReadError code={readError} />}
        <Hero year={year} isMobile={isMobile} positions={shown} />
        {paragraphs(data.intro).length > 0 && (
          <div style={{ margin: isMobile ? "16px 4px 0" : "22px 0 0", padding: isMobile ? "0 0 0 14px" : "2px 0 2px 20px", borderLeft: `4px solid ${GOLD}`, fontFamily: BODY, fontSize: isMobile ? 16 : 19, lineHeight: 1.65, fontWeight: 600, color: "#2a3140" }}>
            {paragraphs(data.intro).map((t, i) => <p key={i} style={{ margin: i ? "12px 0 0" : 0 }}>{t}</p>)}
          </div>
        )}

        {!shown.length ? (
          <div style={{ marginTop: 18, border: "2px dashed #d5dbe4", background: "#f8fafc", borderRadius: 16, padding: "28px 20px", textAlign: "center", color: "#5a6475", fontFamily: BODY, fontWeight: 700 }}>
            No players picked yet — add them in Admin → Content → Class of {year}.
          </div>
        ) : shown.map((pos) => (
          <section key={pos.key} id={posAnchor(pos.key)} style={{ marginTop: isMobile ? 26 : 36, scrollMarginTop: 90 }}>
            <h2 style={{ margin: "0 0 12px", display: "flex", alignItems: "center", gap: 10, fontSize: isMobile ? 22 : 30, fontWeight: 900, color: NAVY, textTransform: "uppercase", lineHeight: 1.05 }}>
              <span style={{ fontSize: isMobile ? 12 : 14, color: "#fff", background: BLUE, borderRadius: 6, padding: "4px 8px", letterSpacing: "0.06em" }}>{pos.key}</span>
              {pos.name}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: isMobile ? 14 : 18 }}>
              {picksIn(data.positions, pos.key).map((p) => (
                <PickCard key={p.id} p={p} year={year} school={schools[p.school]} photos={photos[p.id]} isMobile={isMobile} />
              ))}
            </div>
          </section>
        ))}

        {picks.length > 0 && <Headed picks={picks} schools={schools} year={year} isMobile={isMobile} />}

        {!isUnreleasedYear(year) && (
          <div style={{ marginTop: 30, textAlign: "center" }}>
            <Link to={`/community/${year}`} style={{ display: "inline-block", padding: "12px 22px", borderRadius: 999, background: NAVY, color: "#fff", fontWeight: 900, textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 14 }}>
              The full {year} big board →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

export function PreviewBanner({ where = "Admin → Content → WX → Class of 2030" }) {
  return (
    <div style={{ margin: "6px 0 12px", padding: "10px 14px", borderRadius: 10, background: "#fff4e0", border: `2px solid ${GOLD}`, fontFamily: BODY, fontSize: 13, fontWeight: 800, color: "#7a4a00" }}>
      Preview — not released. Only admins can see this page (noindex). Release it in {where}.
    </div>
  );
}

// An admin's read was refused — almost always the new firestore.rules
// (classIntro / earlyLook) not deployed yet.
export function ReadError({ code }) {
  return (
    <div style={{ margin: "0 0 12px", padding: "10px 14px", borderRadius: 10, background: "#fdecea", border: "2px solid #c0392b", fontFamily: BODY, fontSize: 13, fontWeight: 800, color: "#7a1f15" }}>
      The database refused this page's data ({code}). The Firestore rules for it probably aren't deployed yet — saving in Admin will fail too until they are.
    </div>
  );
}

function Hero({ year, isMobile, positions }) {
  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 20, color: "#fff", padding: isMobile ? "20px 16px 18px" : "28px 40px 24px", textAlign: "center",
      background: `radial-gradient(circle at 10% 120%, ${BLUE}cc 0, transparent 45%), radial-gradient(circle at 95% -10%, ${GOLD}66 0, transparent 40%), ${NAVY}`,
      boxShadow: "0 16px 40px rgba(7,13,24,0.35)",
    }}>
      <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 900, letterSpacing: "0.18em", color: GOLD, textTransform: "uppercase" }}>{year} NFL Draft</div>
      <h1 style={{ margin: "6px 0 0", fontWeight: 900, textTransform: "uppercase", lineHeight: 0.92, letterSpacing: "-0.01em" }}>
        <span style={{ display: "block", fontSize: isMobile ? 24 : 40, color: "rgba(255,255,255,0.9)" }}>Meet the</span>
        <span style={{ display: "block", fontSize: isMobile ? 54 : 104, background: `linear-gradient(100deg, #ffffff 30%, ${GOLD} 95%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", paddingBottom: 4 }}>Class of {year}</span>
      </h1>
      <div style={{ marginTop: 4, fontSize: isMobile ? 12 : 16, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>
        The {signingClassOf(year)} signees, position by position
      </div>
      {positions.length > 0 && (
        <nav aria-label="Positions" style={{ marginTop: isMobile ? 14 : 18, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {positions.map((p) => (
            <a key={p.key} href={`#${posAnchor(p.key)}`} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 900, color: "#fff", textDecoration: "none", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)" }}>{p.key}</a>
          ))}
        </nav>
      )}
    </div>
  );
}

// One player: his graphic, then who he is and where he signed.
function PickCard({ p, year, school, photos, isMobile }) {
  const shots = placedShots(photos);
  const shot = shots.find((s) => s.url === p.shot) || shots[0] || null;
  const g = useProspectGraphic({
    kind: "intro", entry: p, tag: `CLASS OF ${year}`, kicker: "MEET THE CLASS", address: `WE-DRAFT.COM/CLASS-OF-${year}`, shot,
    key: `${p.id}|${p.school}|${p.hs}|${shot?.url || ""}`,
  });
  const [loaded, setLoaded] = useState(false);
  const href = playerHref(p);
  const c1 = school?.Color1 || NAVY;
  const logo = school?.Logo1;
  const abbr = stateAbbrOf(p.state);
  const notes = paragraphs(p.note);
  return (
    <article style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #e2e7ef", boxShadow: "0 4px 16px rgba(0,30,70,0.06)", display: "flex", flexDirection: "column" }}>
      <div ref={g.ref} style={{ position: "relative", aspectRatio: "1080 / 1350", background: `radial-gradient(circle at 50% 38%, ${c1} 0%, ${NAVY} 100%)` }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: loaded ? 0 : 1, transition: "opacity 0.3s" }}>
          {(school?.LogoDark || logo) && <img src={school?.LogoDark || logo} alt="" style={{ width: "50%", height: "50%", objectFit: "contain" }} />}
        </div>
        {g.src && <img src={g.src} alt={`${nameOf(p)}, class of ${year} ${p.pos}${p.school ? ` signed with ${p.school}` : ""}`} onLoad={() => setLoaded(true)} width={1080} height={1350}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }} />}
      </div>
      <div style={{ padding: isMobile ? "12px 14px 16px" : "14px 16px 18px", display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: isMobile ? 22 : 24, fontWeight: 900, lineHeight: 1.05, color: "#1c2330", textTransform: "uppercase" }}>
          {href ? <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>{nameOf(p)}</Link> : nameOf(p)}
        </h3>
        {p.school && (
          <Link to={schoolHref(p.school)} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "#1c2330", fontFamily: BODY, fontSize: 14, fontWeight: 800 }}>
            {logo && <img src={logo} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />}
            <span><span style={{ color: "#7a8597", fontWeight: 700 }}>Signed with</span> {p.school}</span>
          </Link>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: BODY, fontSize: 13, fontWeight: 700, color: "#5a6475" }}>
          {abbr && <StateShape abbr={abbr} size={24} glow={false} title={stateName(abbr)} />}
          <span>{[p.pos, [p.ht, p.wt ? `${p.wt} lbs` : ""].filter(Boolean).join(", "), [p.hs, abbr].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
        </div>
        {notes.length > 0 && (
          <div style={{ fontFamily: BODY, fontSize: 15, lineHeight: 1.6, fontWeight: 600, color: "#3a4352", borderLeft: `3px solid ${GOLD}`, paddingLeft: 12, marginTop: 2 }}>
            {notes.map((t, i) => <p key={i} style={{ margin: i ? "8px 0 0" : 0 }}>{t}</p>)}
          </div>
        )}
      </div>
    </article>
  );
}

// Where They're Headed: each school with a signee in the article, most first.
function Headed({ picks, schools, year, isMobile }) {
  const groups = Object.values(picks.reduce((m, p) => {
    if (!p.school) return m;
    (m[p.school] = m[p.school] || { school: p.school, list: [] }).list.push(p);
    return m;
  }, {})).sort((a, b) => b.list.length - a.list.length || a.school.localeCompare(b.school));
  if (!groups.length) return null;
  return (
    <section id="schools" style={{ marginTop: isMobile ? 30 : 44 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: isMobile ? 22 : 30, fontWeight: 900, color: NAVY, textTransform: "uppercase" }}>Where They're Headed</h2>
      <p style={{ margin: "0 0 14px", fontFamily: BODY, fontSize: 15, fontWeight: 600, color: "#5a6475" }}>The programs landing the class of {year} prospects above.</p>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {groups.map(({ school, list }) => {
          const s = schools[school];
          const c1 = s?.Color1 || BLUE;
          return (
            <div key={school} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e7ef", borderTop: `4px solid ${c1}`, padding: "12px 14px" }}>
              <Link to={schoolHref(school)} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "#1c2330" }}>
                {s?.Logo1 && <img src={s.Logo1} alt="" style={{ width: 36, height: 36, objectFit: "contain" }} />}
                <span style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase" }}>{school}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 900, color: "#fff", background: c1, borderRadius: 999, padding: "2px 8px" }}>{list.length}</span>
              </Link>
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 4, fontFamily: BODY, fontSize: 13, fontWeight: 700 }}>
                {list.map((p) => (
                  <li key={p.id}>
                    <a href={`#${posAnchor(p.sec || p.pos)}`} style={{ color: "#3a4352", textDecoration: "none" }}>
                      <span style={{ color: BLUE, fontWeight: 900 }}>{p.pos}</span> {nameOf(p)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
