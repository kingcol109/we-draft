// src/pages/Support.jsx — /support (voluntary contributions to
// We-Draft.com) and /support/thanks (after Stripe Checkout). Public, linked
// only from signed-in profiles (Profile → Store), noindex. Not a charity;
// nothing on the site is locked behind it. API: api/shop.js "contribute".

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "../components/LoadingSpinner";
import { BLUE, GOLD, NAVY, money, shopGet, shopPost } from "../utils/shop";

const FONT = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";
const card = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)" };
const DEFAULT_CONFIG = { presetsCents: [500, 1000, 2500, 5000], minCents: 100, maxCents: 50000, portalLoginUrl: null };

const FUNDS = [
  ["Scouting & data", "Prospect profiles, player data and the stats behind every board."],
  ["Hosting & tools", "Servers, video, and the sims you play for free."],
  ["New features", "More classes, more teams, more ways to follow the draft."],
];

function Shell({ children, isMobile }) {
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: isMobile ? "12px 16px 60px" : "24px 20px 60px", fontFamily: FONT, color: "#0f1b2d" }}>
      <Helmet>
        <title>Support We-Draft.com</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 18, background: "linear-gradient(120deg, #062a55 0%, #0055a5 70%, #1f74c8 100%)", color: "#fff", padding: isMobile ? "18px 16px" : "24px 26px", boxShadow: "0 10px 30px rgba(0,40,90,.18)" }}>
        <span aria-hidden="true" style={{ position: "absolute", right: -10, top: 0, font: "italic 900 80px/1 Arial, sans-serif", color: "rgba(255,255,255,.06)", pointerEvents: "none", whiteSpace: "nowrap" }}>We-Draft.com</span>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.1 }}>Support We-Draft.com</div>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,.8)", fontFamily: BODY, lineHeight: 1.5 }}>
            We-Draft.com is free and always will be. If it&apos;s part of your draft season, you can chip in to help keep it growing.
          </div>
        </div>
      </div>
      <div style={{ marginTop: 22 }}>{children}</div>
    </div>
  );
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const on = () => setM(window.innerWidth < 640);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return m;
}

function SupportForm({ isMobile }) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [recurring, setRecurring] = useState(false);
  const [preset, setPreset] = useState(1000);
  const [custom, setCustom] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { shopGet("supportConfig").then((c) => setCfg({ ...DEFAULT_CONFIG, ...c })).catch(() => {}); }, []);
  useEffect(() => { if (user?.email) setEmail((e) => e || user.email); }, [user]);

  const customCents = custom.trim() ? Math.round(Number(custom.replace(/[$,\s]/g, "")) * 100) : null;
  const amount = custom.trim() ? customCents : preset;
  const valid = Number.isInteger(amount) && amount >= cfg.minCents && amount <= cfg.maxCents;

  const go = async () => {
    if (!valid) { setErr(`Please enter an amount between ${money(cfg.minCents)} and ${money(cfg.maxCents)}.`); return; }
    setErr(null);
    setBusy(true);
    try {
      const r = await shopPost("contribute", { amountCents: amount, recurring, email: email.trim() || undefined });
      window.location.assign(r.url);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const tab = (on) => ({
    flex: 1, padding: "11px 10px", border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 900, letterSpacing: "0.08em",
    textTransform: "uppercase", background: on ? BLUE : "#fff", color: on ? "#fff" : BLUE,
  });

  return (
    <>
      <div style={{ ...card, padding: isMobile ? 16 : 24 }}>
        <div style={{ display: "flex", border: `2px solid ${BLUE}`, borderRadius: 10, overflow: "hidden" }}>
          <button onClick={() => setRecurring(false)} aria-pressed={!recurring} style={tab(!recurring)}>One time</button>
          <button onClick={() => setRecurring(true)} aria-pressed={recurring} style={tab(recurring)}>Monthly</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : cfg.presetsCents.length}, 1fr)`, gap: 10, marginTop: 18 }}>
          {cfg.presetsCents.map((c) => {
            const on = !custom.trim() && preset === c;
            return (
              <button key={c} onClick={() => { setPreset(c); setCustom(""); }} aria-pressed={on}
                style={{ padding: "16px 8px", borderRadius: 10, cursor: "pointer", fontFamily: FONT, fontSize: 20, fontWeight: 900, border: `2px solid ${on ? GOLD : "#cfd8e3"}`, background: on ? "#fff7e8" : "#fff", color: NAVY }}>
                {money(c).replace(".00", "")}
              </button>
            );
          })}
        </div>

        <label style={{ display: "block", marginTop: 14 }}>
          <span style={{ display: "block", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", color: "#667", textTransform: "uppercase", marginBottom: 4 }}>Or enter an amount</span>
          <div style={{ display: "flex", alignItems: "center", border: `2px solid ${custom.trim() ? GOLD : "#cfd8e3"}`, borderRadius: 8, padding: "0 12px" }}>
            <span style={{ fontWeight: 900, color: "#667" }}>$</span>
            <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="decimal" placeholder="Custom amount"
              style={{ flex: 1, border: "none", outline: "none", padding: "11px 8px", fontSize: 16, fontFamily: BODY, minWidth: 0 }} />
            {recurring && <span style={{ fontSize: 12, color: "#667", fontFamily: BODY }}>/ month</span>}
          </div>
        </label>

        <label style={{ display: "block", marginTop: 12 }}>
          <span style={{ display: "block", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", color: "#667", textTransform: "uppercase", marginBottom: 4 }}>Email for your receipt</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email"
            style={{ width: "100%", boxSizing: "border-box", border: "2px solid #cfd8e3", borderRadius: 8, padding: "11px 12px", fontSize: 16, fontFamily: BODY, outline: "none" }} />
        </label>

        {err && <div role="alert" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#fdecea", color: "#b3261e", fontSize: 13, fontWeight: 900, fontFamily: BODY }}>{err}</div>}

        <button onClick={go} disabled={busy} style={{ width: "100%", marginTop: 16, padding: "14px", borderRadius: 10, border: `2px solid ${GOLD}`, background: GOLD, color: NAVY, fontFamily: FONT, fontSize: 15, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Opening secure checkout…" : valid ? `Contribute ${money(amount)}${recurring ? " / month" : ""}` : "Contribute"}
        </button>
        <div style={{ marginTop: 10, fontSize: 12, color: "#667", fontFamily: BODY, lineHeight: 1.5, textAlign: "center" }}>
          Payments are processed securely by Stripe. Contributions are voluntary, aren&apos;t charitable donations, and aren&apos;t tax-deductible.
          {recurring && " Monthly contributions can be canceled anytime."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12, marginTop: 18 }}>
        {FUNDS.map(([t, d]) => (
          <div key={t} style={{ ...card, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: BLUE }}>{t}</div>
            <div style={{ marginTop: 6, fontSize: 13, color: "#555", fontFamily: BODY, lineHeight: 1.45 }}>{d}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, fontSize: 13, color: "#555", fontFamily: BODY, lineHeight: 1.6, textAlign: "center" }}>
        Already giving monthly? {user
          ? <><Link to="/profile?tab=store" style={{ color: BLUE, fontWeight: 700 }}>Manage it from your profile</Link>.</>
          : cfg.portalLoginUrl
            ? <><a href={cfg.portalLoginUrl} style={{ color: BLUE, fontWeight: 700 }}>Manage or cancel it here</a>.</>
            : <>Use the link in your Stripe receipt email to manage or cancel it.</>}
        {" "}Prefer merch? <Link to="/shop" style={{ color: BLUE, fontWeight: 700 }}>Visit the shop</Link>.
      </div>
    </>
  );
}

function Thanks() {
  const [params] = useSearchParams();
  const sid = params.get("session_id") || "";
  const [r, setR] = useState(null);
  useEffect(() => {
    if (!sid) { setR({}); return; }
    let live = true;
    let tries = 0;
    const tick = () => shopGet("receipt", { session_id: sid })
      .then((x) => { if (live) { setR(x); if (x.status === "pending" && ++tries < 8) setTimeout(tick, 2500); } })
      .catch(() => { if (live) { if (++tries < 5) setTimeout(tick, 2500); else setR({}); } });
    tick();
    return () => { live = false; };
  }, [sid]);
  if (!r) return <LoadingSpinner size={36} minHeight="30vh" />;
  return (
    <div style={{ ...card, padding: "28px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", color: GOLD }}>THANK YOU</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: NAVY, marginTop: 6 }}>You&apos;re helping keep We-Draft.com free.</div>
      {r.amountCents && (
        <div style={{ marginTop: 8, fontSize: 14, color: "#444", fontFamily: BODY }}>
          {money(r.amountCents)}{r.recurring ? " / month" : ""} · A receipt from Stripe is on its way.
        </div>
      )}
      <div style={{ marginTop: 18, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <Link to="/" style={{ padding: "11px 18px", borderRadius: 8, background: BLUE, color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.08em", textDecoration: "none" }}>BACK TO WE-DRAFT.COM</Link>
      </div>
    </div>
  );
}

export default function Support({ view = "main" }) {
  const isMobile = useIsMobile();
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  return <Shell isMobile={isMobile}>{view === "thanks" ? <Thanks /> : <SupportForm isMobile={isMobile} />}</Shell>;
}
