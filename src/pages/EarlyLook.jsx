// src/pages/EarlyLook.jsx
//
// The Early Look (working name — utils/earlyLook.js EARLY_LOOK): WX
// content promoting high school prospects in the classes after 2030. One
// ranked list (Admin → Content → Early Look, components/AdminEarlyLook.jsx),
// filterable by draft class (?class=2031), one row per player: his graphic
// (components/ProspectIntroGraphic.jsx), rank, name, position, high school
// and state, his class, his commitment (to its team page) when he has one,
// the admin's write-up. Every admin Save is a dated edition: the latest
// here, a past one at {path}/{date} (noindex), with the archive at the
// bottom. These players have no We-Draft.com pages yet — names don't link.
// Unreleased (live false): admins only, with a preview banner; 404 for
// everyone else, and noindex.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useSchools } from "../components/DraftArchiveList";
import { useProspectGraphic, stateAbbrOf } from "../components/ProspectIntroGraphic";
import StateShape from "../components/StateShape";
import LoadingSpinner from "../components/LoadingSpinner";
import { PreviewBanner, ReadError } from "./ClassIntro";
import { useIsAdmin } from "../utils/prospectYears";
import { schoolHref } from "../utils/events";
import { stateName } from "../utils/highSchoolMatch";
import {
  EARLY_LOOK, EL_DOC, EL_ID, EL_EDITIONS, draftClassOf, earlyRanked, earlyClasses,
  isEarlyEditionDate, earlyEditionPath, earlyEditionLabel, earlyEditionDate,
} from "../utils/earlyLook";

const SITE = "https://we-draft.com";
const GOLD = "#f6a21d";
const BLUE = "#0055a5";
const NAVY = "#070d18";
const TEAL = "#0e7c86";
const BODY = "Arial, sans-serif";
const HEAD = "'Arial Black', Arial, sans-serif";
const COLUMN = 1000;
const nameOf = (r) => `${r.first} ${r.last}`;
const paragraphs = (t) => String(t || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => { const f = () => setM(window.innerWidth < 768); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return m;
}

export default function EarlyLook() {
  const { edition: editionParam = "" } = useParams();
  const edition = isEarlyEditionDate(editionParam) ? editionParam : "";
  const [params, setParams] = useSearchParams();
  const cls = params.get("class") || "";
  const isMobile = useIsMobile();
  const { isAdmin, authReady } = useIsAdmin();
  const [data, setData] = useState(undefined);
  const [readError, setReadError] = useState("");
  const [editions, setEditions] = useState([]);

  // An admin with nothing saved yet gets the empty draft, not the 404.
  useEffect(() => {
    if (!authReady) return undefined;
    let live = true;
    setData(undefined);
    setReadError("");
    const empty = { live: false, players: [], intro: "" };
    const read = edition ? getDoc(doc(db, EL_EDITIONS, edition)) : getDoc(doc(db, EL_DOC, EL_ID));
    read.then((s) => {
      const raw = s.exists() ? s.data() : null;
      if (live) setData(raw && edition ? { ...raw, updatedAt: raw.publishedAt } : raw || (isAdmin && !edition ? empty : null));
    }).catch((e) => {
      if (!live) return;
      if (isAdmin && !edition) { setReadError(e?.code || e?.message || "read refused"); setData(empty); } else setData(null);
    });
    return () => { live = false; };
  }, [authReady, isAdmin, edition]);

  // The archive: every edition for an admin, released ones for everyone else.
  useEffect(() => {
    if (!authReady) return undefined;
    let live = true;
    const q = isAdmin ? collection(db, EL_EDITIONS) : query(collection(db, EL_EDITIONS), where("live", "==", true));
    getDocs(q).then((snap) => live && setEditions(snap.docs.map((d) => d.id).filter(isEarlyEditionDate).sort().reverse())).catch(() => live && setEditions([]));
    return () => { live = false; };
  }, [authReady, isAdmin]);

  const all = useMemo(() => earlyRanked(data?.players), [data]);
  const classes = useMemo(() => earlyClasses(all), [all]);
  const shown = cls ? all.filter((r) => draftClassOf(r.rc) === cls) : all;
  const schools = useSchools(all.map((r) => r.commit));
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
  const editionName = edition ? earlyEditionLabel(edition, { month: "long", day: "numeric", year: "numeric" }) : "";
  const span = classes.length ? (classes.length > 1 ? `${classes[0]}–${classes[classes.length - 1]}` : classes[0]) : "2031";
  const title = edition ? `${EARLY_LOOK.name}: High School Prospects — ${editionName} Edition` : `${EARLY_LOOK.name}: Top High School Football Prospects | ${span} NFL Draft Classes`;
  const named = all.slice(0, 3).map(nameOf);
  const description = `An early look at the high school football prospects who'll make up the ${span} NFL Draft class${classes.length > 1 ? "es" : ""}${named.length ? `, led by ${named.join(", ")}` : ""} — ranked by We-Draft.com.`;
  const url = `${SITE}${edition ? earlyEditionPath(edition) : EARLY_LOOK.path}`;
  const updated = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `${url}#webpage`, url, name: title, description, inLanguage: "en-US", ...(updated ? { dateModified: updated.toISOString() } : {}) },
      ...(all.length ? [{
        "@type": "ItemList", name: `${EARLY_LOOK.name} — high school prospects`, url, itemListOrder: "https://schema.org/ItemListOrderDescending", numberOfItems: all.length,
        itemListElement: all.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: nameOf(r) })),
      }] : []),
    ],
  };

  const pickClass = (c) => { const next = new URLSearchParams(params); if (c) next.set("class", c); else next.delete("class"); setParams(next, { replace: true }); };
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`${SITE}${edition ? earlyEditionPath(edition) : EARLY_LOOK.path}`} />
        {(!data.live || edition) && <meta name="robots" content={data.live ? "noindex, follow" : "noindex, nofollow"} />}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta name="twitter:card" content="summary" />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <div style={{ maxWidth: COLUMN, margin: `${isMobile ? -14 : -12}px auto 0`, padding: isMobile ? "4px 10px 60px" : "10px 24px 60px", fontFamily: HEAD }}>
        {!data.live && <PreviewBanner where={`Admin → Content → WX → ${EARLY_LOOK.name}`} />}
        {readError && <ReadError code={readError} />}
        <div style={{
          position: "relative", overflow: "hidden", borderRadius: 20, color: "#fff", padding: isMobile ? "20px 16px 18px" : "26px 40px 22px", textAlign: "center",
          background: `radial-gradient(circle at 8% 120%, ${TEAL}cc 0, transparent 45%), radial-gradient(circle at 95% -10%, ${GOLD}55 0, transparent 40%), ${NAVY}`,
          boxShadow: "0 16px 40px rgba(7,13,24,0.35)",
        }}>
          <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 900, letterSpacing: "0.18em", color: GOLD, textTransform: "uppercase" }}>High School Prospects</div>
          <h1 style={{ margin: "6px 0 0", fontSize: isMobile ? 52 : 96, fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, background: `linear-gradient(100deg, #ffffff 30%, ${GOLD} 95%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", paddingBottom: 4 }}>
            {EARLY_LOOK.name}
          </h1>
          <div style={{ marginTop: 4, fontSize: isMobile ? 12 : 16, fontWeight: 900, letterSpacing: "0.12em", color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>
            The {span} NFL Draft class{classes.length > 1 ? "es" : ""}, before anyone else
          </div>
          {(edition || updated) && (
            <div style={{ marginTop: 12, display: "inline-block", padding: "5px 12px", borderRadius: 999, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.22)", fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {earlyEditionLabel(edition || earlyEditionDate(updated))} edition
            </div>
          )}
        </div>
        {edition && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderRadius: 12, background: "#fff8e6", border: `1px solid ${GOLD}`, fontFamily: BODY, fontSize: 14, fontWeight: 700, color: "#3a4352" }}>
            <span>You're reading the <strong>{editionName}</strong> edition.</span>
            <Link to={EARLY_LOOK.path} style={{ marginLeft: "auto", color: BLUE, fontWeight: 900, textDecoration: "none" }}>See the latest →</Link>
          </div>
        )}
        {paragraphs(data.intro).length > 0 && (
          <div style={{ margin: isMobile ? "16px 4px 0" : "22px 0 0", padding: isMobile ? "0 0 0 14px" : "2px 0 2px 20px", borderLeft: `4px solid ${GOLD}`, fontFamily: BODY, fontSize: isMobile ? 16 : 19, lineHeight: 1.65, fontWeight: 600, color: "#2a3140" }}>
            {paragraphs(data.intro).map((t, i) => <p key={i} style={{ margin: i ? "12px 0 0" : 0 }}>{t}</p>)}
          </div>
        )}

        {classes.length > 1 && (
          <div role="tablist" aria-label="Draft class" style={{ marginTop: 20, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["", ...classes].map((c) => (
              <button key={c || "all"} type="button" role="tab" aria-selected={cls === c} onClick={() => pickClass(c)} style={{
                padding: "7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 900, cursor: "pointer", fontFamily: HEAD,
                border: `2px solid ${NAVY}`, background: cls === c ? NAVY : "#fff", color: cls === c ? "#fff" : NAVY,
              }}>{c ? `Class of ${c}` : "All"}</button>
            ))}
          </div>
        )}

        <h2 style={{ margin: "22px 0 12px", fontSize: isMobile ? 20 : 26, fontWeight: 900, color: NAVY, textTransform: "uppercase" }}>
          {cls ? `Class of ${cls} prospects` : "The prospects"}
        </h2>
        {!shown.length ? (
          <div style={{ border: "2px dashed #d5dbe4", background: "#f8fafc", borderRadius: 16, padding: "28px 20px", textAlign: "center", color: "#5a6475", fontFamily: BODY, fontWeight: 700 }}>
            No prospects yet — add them in Admin → Content → {EARLY_LOOK.name}.
          </div>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {shown.map((r) => (
              <li key={r.id}><EarlyRow r={r} rank={all.indexOf(r) + 1} school={schools[r.commit]} isMobile={isMobile} /></li>
            ))}
          </ol>
        )}

        {editions.length > 1 && (
          <section style={{ marginTop: 28 }}>
            <h2 style={{ margin: 0, fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", color: "#5a6475", textTransform: "uppercase" }}>{EARLY_LOOK.name} editions</h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {editions.map((d, i) => {
                const here = edition ? d === edition : i === 0;
                return (
                  <Link key={d} to={i === 0 ? EARLY_LOOK.path : earlyEditionPath(d)} aria-current={here ? "page" : undefined} style={{
                    padding: "6px 11px", borderRadius: 8, fontFamily: BODY, fontSize: 12, fontWeight: 800, textDecoration: "none",
                    background: here ? NAVY : "#fff", color: here ? "#fff" : NAVY, border: "1px solid #d5dbe4",
                  }}>{earlyEditionLabel(d)}{i === 0 ? " · Latest" : ""}</Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function EarlyRow({ r, rank, school, isMobile }) {
  const dc = draftClassOf(r.rc);
  const g = useProspectGraphic({
    kind: "early", entry: { ...r, school: r.commit }, tag: `CLASS OF ${dc}`, kicker: EARLY_LOOK.tag, address: `WE-DRAFT.COM${EARLY_LOOK.path.toUpperCase()}`,
    key: `${r.id}|${r.commit}|${r.hs}|${r.state}`,
  });
  const [loaded, setLoaded] = useState(false);
  const abbr = stateAbbrOf(r.state);
  const notes = paragraphs(r.note);
  const badge = (size) => (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: 12, display: "grid", placeItems: "center", color: "#fff", background: `linear-gradient(135deg, ${TEAL}, ${NAVY})`, fontSize: rank > 9 ? size * 0.42 : size * 0.5, fontWeight: 900 }}>{rank}</span>
  );
  const media = (
    <div ref={g.ref} style={{ position: "relative", width: isMobile ? "100%" : 280, flexShrink: 0, aspectRatio: "1080 / 1350", borderRadius: isMobile ? 0 : 12, overflow: "hidden", background: `radial-gradient(circle at 50% 38%, ${school?.Color1 || TEAL} 0%, ${NAVY} 100%)` }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: loaded ? 0 : 1, transition: "opacity 0.3s" }}>
        {abbr && <StateShape abbr={abbr} size={140} glow={false} light />}
      </div>
      {g.src && <img src={g.src} alt={`${nameOf(r)}, class of ${dc} ${r.pos}${r.hs ? ` from ${r.hs}` : ""}`} onLoad={() => setLoaded(true)} width={1080} height={1350}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", opacity: loaded ? 1 : 0, transition: "opacity 0.3s" }} />}
    </div>
  );
  const facts = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: BODY, fontSize: isMobile ? 14 : 16, fontWeight: 800, color: "#5a6475" }}>
        <span style={{ fontWeight: 900, color: BLUE }}>{r.pos}</span>
        {abbr && <StateShape abbr={abbr} size={isMobile ? 22 : 26} glow={false} title={stateName(abbr)} />}
        <span>{[r.hs, abbr].filter(Boolean).join(", ")}</span>
        {(r.ht || r.wt) && <span style={{ color: "#8a94a6" }}>· {[r.ht, r.wt ? `${r.wt} lbs` : ""].filter(Boolean).join(", ")}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ padding: "4px 10px", borderRadius: 999, background: NAVY, color: "#fff", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>Class of {dc}</span>
        {r.commit ? (
          <Link to={schoolHref(r.commit)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 4px", borderRadius: 999, border: "1px solid #d5dbe4", textDecoration: "none", color: "#1c2330", fontFamily: BODY, fontSize: 12, fontWeight: 900 }}>
            {school?.Logo1 && <img src={school.Logo1} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />}Committed to {r.commit}
          </Link>
        ) : <span style={{ fontFamily: BODY, fontSize: 12, fontWeight: 800, color: "#8a94a6" }}>Uncommitted</span>}
      </div>
      {notes.length > 0 && (
        <div style={{ fontFamily: BODY, fontSize: 16, lineHeight: 1.6, fontWeight: 600, color: "#3a4352", borderLeft: `3px solid ${TEAL}`, paddingLeft: 12 }}>
          {notes.map((t, i) => <p key={i} style={{ margin: i ? "8px 0 0" : 0 }}>{t}</p>)}
        </div>
      )}
    </>
  );
  if (isMobile) {
    return (
      <article style={{ margin: "0 -10px", background: "#fff", borderBottom: "1px solid #e2e7ef" }}>
        {media}
        <div style={{ padding: "12px 14px 16px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {badge(46)}
            <h3 style={{ margin: 0, fontSize: 23, fontWeight: 900, lineHeight: 1.02, color: "#1c2330", textTransform: "uppercase" }}>{nameOf(r)}</h3>
          </div>
          {facts}
        </div>
      </article>
    );
  }
  return (
    <article style={{ position: "relative", background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #e2e7ef", boxShadow: "0 4px 16px rgba(0,30,70,0.06)", padding: 14 }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, background: `linear-gradient(180deg, ${TEAL}, ${GOLD})` }} />
      <div style={{ display: "flex", alignItems: "stretch", gap: 18 }}>
        {media}
        <div style={{ flex: 1, minWidth: 0, paddingTop: 6, display: "grid", alignContent: "start", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {badge(56)}
            <h3 style={{ margin: 0, minWidth: 0, fontSize: 40, fontWeight: 900, lineHeight: 1, color: "#1c2330", textTransform: "uppercase" }}>{nameOf(r)}</h3>
          </div>
          {facts}
        </div>
      </div>
    </article>
  );
}
