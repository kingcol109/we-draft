// src/components/UpcomingPicks.jsx
//
// NFL team page's Projected Picks tab (NFLTeamPage.jsx) — an SEO landing
// page for "{team} 2027 draft picks": the team's draft capital for each
// upcoming draft (picks, first-rounders, earliest pick, and its league rank
// by trade-chart value — config/draftTradeChart), a plain-language summary,
// a round-by-round board, and when the order was last saved.
//
// Data: one draftOrders/{year} doc per draft, all seven rounds
// (utils/draftOrder.js; edited in Admin → Draft Order and re-sorted from the
// standings every Tuesday). A later draft follows the upcoming draft's
// order with its own trades. A year not saved in that format yet falls back
// to its old round-1 collection.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import LoadingSpinner from "./LoadingSpinner";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { textOn } from "../utils/teamColors";
import {
  picksFromOrder, followsOrder, withEffectiveOrder, orderFromLegacyPicks, ORDER_YEAR, DRAFT_ROUNDS,
} from "../utils/draftOrder";

export const UPCOMING_DRAFTS = [
  { year: "2027", legacy: "draftOrder2027" },
  { year: "2028", legacy: "draftOrder2028" },
];

const nickname = (abbr) => (NFL_TEAMS[abbr] || abbr).split(" ").pop();
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
const ROUND_WORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null);

// ── Data (all cached for the session — every team page shares them) ──
const cache = {};
const once = (key, load) => {
  if (!cache[key]) cache[key] = load().catch((e) => { delete cache[key]; throw e; });
  return cache[key];
};
const readOrderDoc = (year) => once(`doc:${year}`, () => getDoc(doc(db, "draftOrders", year)).then((s) => (s.exists() ? s.data() : null)));
const readTradeChart = () => once("chart", () => getDoc(doc(db, "config", "draftTradeChart")).then((s) => (s.exists() ? s.data().values || {} : {})));

// One draft: every pick + when its order/trades were last saved. Also the
// /draftorder page's data.
// → { picks, updatedAt: Date | null, source: "standings" | "admin" | "" }
export function fetchDraft({ year, legacy }) {
  return once(`draft:${year}`, async () => {
    let own = await readOrderDoc(year);
    const base = followsOrder(year) ? await readOrderDoc(ORDER_YEAR) : own;
    if (base?.order?.length) {
      // A later draft not saved in the new format yet keeps its old trades.
      if (!own && followsOrder(year)) own = { trades: orderFromLegacyPicks((await getDocs(collection(db, legacy))).docs.map((d) => d.data())).trades };
      const stamps = [toDate(own?.updatedAt), toDate(base?.updatedAt)].filter(Boolean);
      return {
        picks: picksFromOrder(withEffectiveOrder(year, own, base)),
        updatedAt: stamps.length ? new Date(Math.max(...stamps)) : null,
        source: base.source || "",
      };
    }
    const old = await getDocs(collection(db, legacy));
    return { picks: old.docs.map((d) => d.data()), updatedAt: null, source: "" };
  });
}

// A team's draft capital in one draft, ranked against the league:
// { held, tradedAway, firsts, earliest, value, rank }.
function capitalFor(team, picks, chart) {
  const holder = (p) => p.Traded || p.Team;
  const value = (list) => list.reduce((a, p) => a + (Number(chart[p.Pick]) || 0), 0);
  const order = (a, b) => a.Pick - b.Pick;
  const held = picks.filter((p) => holder(p) === team).sort(order);
  const byTeam = NFL_TEAM_ABBRS.map((t) => ({ t, v: value(picks.filter((p) => holder(p) === t)) })).sort((a, b) => b.v - a.v);
  return {
    held,
    tradedAway: picks.filter((p) => p.Team === team && holder(p) !== team).sort(order),
    firsts: held.filter((p) => p.Round === 1).length,
    earliest: held[0] || null,
    value: Math.round(value(held)),
    rank: byTeam.findIndex((x) => x.t === team) + 1,
  };
}

// Everything the tab (and its meta description) shows, for every upcoming draft.
export async function fetchTeamDraftCapital(team) {
  const [chart, drafts] = await Promise.all([readTradeChart(), Promise.all(UPCOMING_DRAFTS.map(fetchDraft))]);
  return UPCOMING_DRAFTS.map((d, i) => ({ year: d.year, ...drafts[i], ...capitalFor(team, drafts[i].picks, chart) }));
}

// The summary sentence — the page's lead text and its meta description.
export function capitalSentence(teamName, c) {
  if (!c.held.length) return `The ${teamName} don't hold a pick in the ${c.year} NFL Draft yet.`;
  const firsts = c.firsts === 0 ? "no first-round picks" : c.firsts === 1 ? "one first-round pick" : `${c.firsts} first-round picks`;
  const early = c.earliest ? `, with their first selection at No. ${c.earliest.Pick} overall` : "";
  return `The ${teamName} hold ${c.held.length} pick${c.held.length === 1 ? "" : "s"} in the ${c.year} NFL Draft — ${firsts}${early} — ranking ${ordinal(c.rank)} in the league in projected draft capital.`;
}

export default function UpcomingPicks({ team, teamName, color1, color2, isMobile }) {
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState(false);
  const [year, setYear] = useState(UPCOMING_DRAFTS[0].year);
  useEffect(() => {
    let cancelled = false;
    setDrafts(null);
    fetchTeamDraftCapital(team)
      .then((d) => { if (!cancelled) setDrafts(d); })
      .catch((e) => { console.error("Projected picks load error:", e); if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [team]);

  const card = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2", overflow: "hidden" };
  if (error) return <div style={{ ...card, padding: 24, textAlign: "center", color: "#b42318", fontSize: 13 }}>Couldn&apos;t load picks — try again.</div>;
  if (!drafts) return <LoadingSpinner label="Loading picks" size={28} minHeight="200px" />;

  const c = drafts.find((d) => d.year === year);
  const onC1 = textOn(color1, color2);
  const updated = c.updatedAt ? c.updatedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
  const acquired = c.held.filter((p) => p.Team !== team).length;

  const stat = (label, value, sub) => (
    <div style={{ padding: isMobile ? "12px 10px" : "16px 18px", background: "rgba(0,0,0,0.22)", borderRadius: 12, minWidth: 0 }}>
      <div style={{ fontSize: isMobile ? 26 : 38, fontWeight: 900, lineHeight: 1, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.85)" }}>{label}</div>
      {sub && <div style={{ marginTop: 3, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      {/* ── Draft year switch ── */}
      <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {UPCOMING_DRAFTS.map((d) => {
          const on = d.year === year;
          return (
            <button key={d.year} role="tab" aria-selected={on} onClick={() => setYear(d.year)}
              style={{
                border: `2px solid ${on ? color1 : "#d8dee8"}`, background: on ? color1 : "#fff", color: on ? onC1 : "#3a4352",
                borderRadius: 999, padding: "7px 18px", fontFamily: "inherit", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", cursor: "pointer",
              }}>
              {d.year} Draft
            </button>
          );
        })}
      </div>

      {/* ── Draft capital header ── */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 16, padding: isMobile ? "18px 14px" : "24px 26px",
        background: [`linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28))`, `linear-gradient(120deg, ${color1} 0%, ${color1} 55%, ${color2} 100%)`].join(", "),
        boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
      }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.8)" }}>
          {teamName}
        </div>
        <h2 style={{ margin: "4px 0 16px", fontSize: isMobile ? 24 : 34, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.05 }}>
          {c.year} Draft Capital
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: isMobile ? 8 : 12 }}>
          {stat("Total Picks", c.held.length, acquired ? `${acquired} acquired by trade` : "All own picks")}
          {stat("1st-Rounders", c.firsts, c.firsts > 1 ? "Multiple firsts" : null)}
          {stat("First Pick", c.earliest ? `#${c.earliest.Pick}` : "—", c.earliest ? `Round ${c.earliest.Round}` : null)}
          {stat("Capital Rank", c.rank ? ordinal(c.rank) : "—", c.value ? `${c.value.toLocaleString()} trade-chart pts` : null)}
        </div>
      </div>

      {/* ── The summary, in words ── */}
      <p style={{ margin: "16px 4px 18px", fontSize: isMobile ? 14 : 15, fontWeight: 600, color: "#3a4352", lineHeight: 1.6, fontFamily: "Arial, sans-serif" }}>
        {capitalSentence(teamName, c)}
      </p>

      {/* ── Round by round ── */}
      <div style={card}>
        {Array.from({ length: DRAFT_ROUNDS }, (_, i) => i + 1).map((round) => {
          const held = c.held.filter((p) => p.Round === round);
          const gone = c.tradedAway.filter((p) => p.Round === round);
          return (
            <div key={round} style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, padding: isMobile ? "10px 12px" : "12px 18px", borderTop: round > 1 ? "1px solid #f0f2f5" : "none" }}>
              <div style={{ flexShrink: 0, width: isMobile ? 44 : 64 }}>
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: color1, lineHeight: 1 }}>R{round}</div>
                <div style={{ fontSize: 9, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3 }}>{ROUND_WORD[round]}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {held.map((p) => {
                  const viaTrade = p.Team !== team;
                  return (
                    <span key={p.Pick} title={p.Conditional || undefined} style={{
                      display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px", borderRadius: 10,
                      background: viaTrade ? "#fff7e6" : "#f3f6fb", border: `2px solid ${viaTrade ? "#f6a21d" : round === 1 ? color1 : "#e1e7f0"}`,
                    }}>
                      <span style={{
                        minWidth: 40, textAlign: "center", padding: "5px 6px", borderRadius: 7, fontSize: 15, fontWeight: 900, fontVariantNumeric: "tabular-nums",
                        background: round === 1 ? color1 : "#fff", color: round === 1 ? onC1 : "#1a1f2b", boxShadow: round === 1 ? "none" : "inset 0 0 0 1px #e1e7f0",
                      }}>
                        #{p.Pick}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#3a4352", lineHeight: 1.25 }}>
                        {viaTrade ? <>via {nickname(p.Team)}</> : "Own pick"}
                        {p.Conditional && <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#7a8597" }}>Conditional</span>}
                      </span>
                    </span>
                  );
                })}
                {gone.map((p) => (
                  <span key={`gone-${p.Pick}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 10, border: "2px dashed #e1e7f0", color: "#9aa5b4", fontSize: 11, fontWeight: 800 }}>
                    <span style={{ textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>#{p.Pick}</span>
                    to {nickname(p.Traded)}
                  </span>
                ))}
                {!held.length && !gone.length && <span style={{ fontSize: 12, color: "#9aa5b4", fontStyle: "italic", fontFamily: "Arial, sans-serif" }}>No pick</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Freshness ── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "12px 4px 0", fontSize: 12, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif" }}>
        {updated && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#eef6ee", color: "#1f6b2a", fontWeight: 900 }}>
            ● Last updated {updated}
          </span>
        )}
        <span>
          Projected order{followsOrder(c.year) ? ` (follows the ${ORDER_YEAR} order)` : ""} — re-sorted every Tuesday from the standings; trades added as they happen.
        </span>
      </div>
      <Link
        to="/draftorder"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 18,
          padding: isMobile ? "14px 16px" : "16px 24px", borderRadius: 12, textDecoration: "none",
          background: color1, color: onC1, border: `3px solid ${color2}`, boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
          fontSize: isMobile ? 14 : 17, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase",
        }}
      >
        See the Full {c.year} Draft Order <span aria-hidden="true" style={{ fontSize: "1.2em" }}>→</span>
      </Link>
    </div>
  );
}
