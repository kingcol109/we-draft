// src/components/LegalPageLayout.jsx
//
// Shared shell for the site's legal pages (Terms of Service, Privacy
// Policy, Community Guidelines, Cookie Policy) — one place for the
// title banner, in-page table of contents, and section typography so
// each doc's own file is just its content (see TermsOfService.jsx etc.),
// not ~150 lines of repeated markup per page.
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const LEGAL_PAGES = [
  { path: "/terms", label: "Terms of Service" },
  { path: "/privacy", label: "Privacy Policy" },
  { path: "/guidelines", label: "Community Guidelines" },
  { path: "/cookies", label: "Cookie Policy" },
];

// sections: [{ id, heading, body: [{ type: "p"|"ul", text?, items? }] }]
export default function LegalPageLayout({ title, description, lastUpdated, intro, sections }) {
  return (
    <>
      <Helmet>
        <title>{title} — We-Draft.com</title>
        <meta name="description" content={description} />
      </Helmet>

      <div style={{ background: BLUE, padding: "36px 20px 28px" }}>
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <div style={{ fontSize: "11px", fontWeight: 900, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "8px" }}>
            We-Draft.com
          </div>
          <h1 style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontSize: "clamp(26px, 4vw, 38px)", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.02em", margin: 0 }}>
            {title}
          </h1>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.75)", marginTop: "10px" }}>
            Last updated: {lastUpdated}
          </div>
        </div>
      </div>
      <div style={{ height: "4px", background: GOLD }} />

      <div style={{ maxWidth: "820px", margin: "0 auto", padding: "32px 20px 60px" }}>
        {intro && (
          <p style={{ fontSize: "15px", lineHeight: 1.7, color: "#333", marginBottom: "28px" }}>
            {intro}
          </p>
        )}

        {/* Table of contents */}
        <nav style={{ background: "#f7f8fa", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px 20px", marginBottom: "36px" }}>
          <div style={{ fontSize: "11px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
            On this page
          </div>
          <ol style={{ margin: 0, paddingLeft: "20px", display: "grid", gap: "6px" }}>
            {sections.map((s) => (
              <li key={s.id} style={{ fontSize: "13.5px" }}>
                <a href={`#${s.id}`} style={{ color: "#333", fontWeight: 700, textDecoration: "none" }}
                   onMouseEnter={(e) => { e.currentTarget.style.color = BLUE; e.currentTarget.style.textDecoration = "underline"; }}
                   onMouseLeave={(e) => { e.currentTarget.style.color = "#333"; e.currentTarget.style.textDecoration = "none"; }}>
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((s) => (
          <section key={s.id} id={s.id} style={{ marginBottom: "34px", scrollMarginTop: "90px" }}>
            <h2 style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontSize: "18px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.02em", borderBottom: `2px solid ${BLUE}`, paddingBottom: "8px", marginBottom: "14px" }}>
              {s.heading}
            </h2>
            {s.body.map((block, i) =>
              block.type === "ul" ? (
                <ul key={i} style={{ margin: "0 0 14px", paddingLeft: "22px", display: "grid", gap: "6px" }}>
                  {block.items.map((item, j) => (
                    <li key={j} style={{ fontSize: "14.5px", lineHeight: 1.7, color: "#333" }}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={i} style={{ fontSize: "14.5px", lineHeight: 1.7, color: "#333", margin: "0 0 14px" }}>
                  {block.text}
                </p>
              )
            )}
          </section>
        ))}

        {/* Cross-links to the other legal docs */}
        <div style={{ borderTop: "1px solid #e5e7eb", marginTop: "20px", paddingTop: "20px", display: "flex", flexWrap: "wrap", gap: "10px 20px" }}>
          {LEGAL_PAGES.map((p) => (
            <Link key={p.path} to={p.path} style={{ fontSize: "13px", fontWeight: 800, color: BLUE, textDecoration: "underline" }}>
              {p.label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
