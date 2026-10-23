// src/components/DraftOrderEditor.js
//
// Admin → Players → Content → Draft Order: the upcoming drafts' order, all
// seven rounds, stored as one doc per draft (draftOrders/{year} — see
// utils/draftOrder.js for the shape):
//   1. Team order — the 32 teams, drag (or ▲▼) to re-sort. Every round runs
//      in this order. "Auto-refresh" lets the Tuesday job
//      (scripts/refreshDraftOrder.mjs) re-sort it from the standings;
//      "Pull standings now" previews that sort here first.
//      Later drafts (2028) follow the upcoming draft's order for now — their
//      Team Order is shown read-only and only their trades are saved.
//   2. Picks by round — each pick's holder; pick another team to trade it.
//      Trades are tied to the pick (round + original team), so they follow
//      it whenever the order moves.
// A year with no doc yet starts from its old per-pick collection
// (draftOrder2027/2028, round 1 only) and is saved in the new shape.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { DRAFT_ROUNDS, tradeKey, orderFromLegacyPicks, fetchStandingsOrder, followsOrder, ORDER_YEAR, conditionalHolders } from "../utils/draftOrder";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const UPCOMING = [
  { year: "2027", legacy: "draftOrder2027" },
  { year: "2028", legacy: "draftOrder2028" },
];

export default function DraftOrderEditor() {
  const [year, setYear] = useState(UPCOMING[0].year);
  const [teams, setTeams] = useState([]);
  const [saved, setSaved] = useState(null); // { order, trades, auto } as loaded / last saved
  const [draft, setDraft] = useState(null); // working copy
  const [round, setRound] = useState(1);
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [msg, setMsg] = useState("");
  const [dragIdx, setDragIdx] = useState(null);

  useEffect(() => {
    getDocs(collection(db, "nfl"))
      .then((snap) => setTeams(snap.docs.map((d) => ({ abbr: d.id, ...d.data() })).sort((a, b) => a.abbr.localeCompare(b.abbr))))
      .catch((e) => console.error("Draft order teams load error:", e));
  }, []);

  useEffect(() => {
    let live = true;
    setDraft(null);
    setSaved(null);
    setMsg("");
    // A year's doc, or — first time in the new shape — its old round-1
    // collection.
    const load = async (y) => {
      const snap = await getDoc(doc(db, "draftOrders", y));
      if (snap.exists()) {
        const d = snap.data();
        return { order: d.order || [], trades: d.trades || {}, conditions: d.conditions || [], auto: d.auto !== false, source: d.source || "", asOf: d.asOf || "", fresh: false };
      }
      const legacy = UPCOMING.find((u) => u.year === y).legacy;
      const old = await getDocs(collection(db, legacy));
      return { ...orderFromLegacyPicks(old.docs.map((x) => x.data())), auto: true, source: "", asOf: "", fresh: true, legacy, legacyCount: old.size };
    };
    (async () => {
      const data = await load(year);
      if (followsOrder(year)) data.order = (await load(ORDER_YEAR)).order;
      if (live) {
        if (data.fresh) setMsg(data.legacyCount ? `Started from ${data.legacy} — save to store it in the new format.` : "No order yet — pull standings or arrange the teams.");
        setSaved(data);
        setDraft(data);
      }
    })().catch((e) => { console.error("Draft order load error:", e); if (live) setMsg("Failed to load — check console."); });
    return () => { live = false; };
  }, [year]);

  // Fill in any team missing from the order (e.g. an empty first load).
  useEffect(() => {
    if (!draft || !teams.length) return;
    const missing = teams.map((t) => t.abbr).filter((a) => !draft.order.includes(a));
    if (missing.length) setDraft((d) => ({ ...d, order: [...d.order, ...missing] }));
  }, [draft, teams]);

  const byAbbr = useMemo(() => new Map(teams.map((t) => [t.abbr, t])), [teams]);
  // A later draft's order is the upcoming draft's — shown, not edited here.
  const following = followsOrder(year);
  // Conditional picks (e.g. "earlier of DAL/GB → NYJ") are decided by the
  // current order, not picked here — shown read-only. Saving leaves the
  // doc's `conditions` untouched (merge).
  const conditional = useMemo(() => conditionalHolders(draft?.order || [], draft?.conditions), [draft]);
  const dirty = !!draft && !!saved && JSON.stringify({ o: draft.order, t: draft.trades, a: draft.auto }) !== JSON.stringify({ o: saved.order, t: saved.trades, a: saved.auto });
  const tradesIn = (r) => Object.keys(draft?.trades || {}).filter((k) => k.startsWith(`${r}-`)).length;

  const move = (from, to) => setDraft((d) => {
    if (to < 0 || to >= d.order.length) return d;
    const order = [...d.order];
    const [t] = order.splice(from, 1);
    order.splice(to, 0, t);
    return { ...d, order };
  });
  const setHolder = (team, holder) => setDraft((d) => {
    const trades = { ...d.trades };
    if (!holder || holder === team) delete trades[tradeKey(round, team)];
    else trades[tradeKey(round, team)] = holder;
    return { ...d, trades };
  });

  const pull = async () => {
    setPulling(true);
    setMsg("");
    try {
      const { order, phase } = await fetchStandingsOrder(year, teams.map((t) => t.abbr));
      if (phase === "none") { setMsg(`No ${Number(year) - 1} games played yet — order left as is.`); return; }
      setDraft((d) => ({ ...d, order }));
      setMsg(`Sorted from the ${Number(year) - 1} ${phase === "regular" ? "standings so far" : phase === "final" ? "final results" : "standings + playoffs"} — review, then save.`);
    } catch (e) {
      console.error("Standings pull error:", e);
      setMsg("Couldn't reach ESPN — check console.");
    } finally {
      setPulling(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await setDoc(doc(db, "draftOrders", year), followsOrder(year)
        ? { trades: draft.trades, source: "admin", updatedAt: serverTimestamp() }
        : { order: draft.order, trades: draft.trades, auto: draft.auto, source: "admin", updatedAt: serverTimestamp() },
      { merge: true });
      setSaved(draft);
      setMsg("Saved.");
    } catch (e) {
      console.error("Draft order save error:", e);
      setMsg("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const select = { padding: "5px 8px", fontSize: "12px", fontWeight: 800, border: "1px solid #c9d3e0", borderRadius: "6px", background: "#fff" };
  const td = { padding: "5px 10px", fontSize: "13px", fontWeight: 700, color: INK, borderBottom: "1px solid #f0f0f0" };
  const logo = (abbr) => byAbbr.get(abbr)?.Logo1;
  const name = (abbr) => { const t = byAbbr.get(abbr); return t ? `${t.City} ${t.Team}` : abbr; };
  const btn = (on) => ({ padding: "4px 12px", fontWeight: 900, fontSize: "12px", border: "2px solid #fff", borderRadius: "14px", cursor: "pointer", background: on ? "#fff" : "transparent", color: on ? BLUE : "#fff" });
  const heading = { padding: "8px 16px", fontSize: "11px", fontWeight: 900, color: BLUE, background: "#eef3fa", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" };

  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden", maxWidth: "980px" }}>
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Projected Draft Order</span>
        {UPCOMING.map((u) => (
          <button key={u.year} type="button" onClick={() => setYear(u.year)} disabled={saving} style={btn(year === u.year)}>{u.year}</button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
          {msg && <span style={{ fontSize: "12px", fontWeight: 800, color: /Failed|Couldn/.test(msg) ? "#ffd2cc" : "#d4f5d6" }}>{msg}</span>}
          <button type="button" disabled={!dirty || saving} onClick={() => { setDraft(saved); setMsg(""); }}
            style={{ background: "transparent", color: "#fff", border: "2px solid #fff", borderRadius: "6px", padding: "4px 10px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: dirty ? "pointer" : "default", opacity: dirty ? 1 : 0.4 }}>
            Reset
          </button>
          <button type="button" disabled={!dirty || saving} onClick={save}
            style={{ background: GOLD, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 14px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: dirty ? "pointer" : "default", opacity: dirty && !saving ? 1 : 0.5 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </div>

      {!draft ? (
        <div style={{ padding: "24px", textAlign: "center", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.25fr)", alignItems: "start" }}>
          {/* ── 1. Team order ── */}
          <div style={{ borderRight: "1px solid #e3e8ef" }}>
            <div style={heading}>
              Team Order
              {following ? (
                <span style={{ marginLeft: "auto", fontSize: "11px", color: INK, textTransform: "none", letterSpacing: 0 }}>Follows the {ORDER_YEAR} order</span>
              ) : (<>
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: INK, textTransform: "none", letterSpacing: 0, cursor: "pointer" }}>
                <input type="checkbox" checked={draft.auto} onChange={(e) => setDraft((d) => ({ ...d, auto: e.target.checked }))} />
                Auto-refresh Tuesdays
              </label>
              <button type="button" onClick={pull} disabled={pulling || !teams.length}
                style={{ border: `1px solid ${BLUE}`, background: "#fff", color: BLUE, borderRadius: "6px", padding: "3px 8px", fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: "pointer" }}>
                {pulling ? "Pulling…" : "Pull standings now"}
              </button>
              </>)}
            </div>
            <div style={{ padding: "6px 16px", fontSize: "11px", fontWeight: 700, color: "#7a8597", borderBottom: "1px solid #eee" }}>
              {following
                ? `The ${year} draft uses the ${ORDER_YEAR} order for now — re-sort it there. Trades below are ${year}'s own.`
                : "Drag (or ▲▼) to re-sort. Every round follows this order; trades stay with their picks."}
              {saved?.source && <> Last set by {saved.source === "standings" ? `the standings${saved.asOf ? ` (${saved.asOf})` : ""}` : "an admin"}.</>}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {draft.order.map((abbr, i) => (
                  <tr key={abbr}
                    draggable={!following}
                    onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { if (dragIdx !== null) e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
                    onDragEnd={() => setDragIdx(null)}
                    style={{ background: dragIdx === i ? "#eaf1ff" : saved?.order[i] !== abbr ? "#fffbea" : "#fff", cursor: following ? "default" : "grab" }}>
                    <td style={{ ...td, width: "52px", fontWeight: 900 }}><span style={{ color: "#c3cad4", marginRight: "6px" }}>⋮⋮</span>{i + 1}</td>
                    <td style={td}>
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {logo(abbr) ? <img src={logo(abbr)} alt="" style={{ width: "22px", height: "22px", objectFit: "contain" }} /> : <span style={{ width: "22px" }} />}
                        {name(abbr)}
                      </span>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", width: "64px" }}>
                      {[["▲", i - 1], ["▼", i + 1]].map(([icon, to]) => {
                        const ok = !following && to >= 0 && to < draft.order.length;
                        return (
                          <button key={icon} type="button" disabled={!ok} onClick={() => move(i, to)}
                            style={{ border: "1px solid #c9d3e0", background: "#fff", borderRadius: "4px", width: "24px", height: "22px", marginRight: "3px", fontSize: "10px", color: BLUE, cursor: ok ? "pointer" : "default", opacity: ok ? 1 : 0.3 }}>
                            {icon}
                          </button>
                        );
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 2. Picks by round ── */}
          <div>
            <div style={heading}>
              Picks
              {Array.from({ length: DRAFT_ROUNDS }, (_, i) => i + 1).map((r) => (
                <button key={r} type="button" onClick={() => setRound(r)}
                  style={{ padding: "3px 9px", fontWeight: 900, fontSize: "11px", borderRadius: "12px", cursor: "pointer", border: `1px solid ${BLUE}`, background: round === r ? BLUE : "#fff", color: round === r ? "#fff" : BLUE }}>
                  R{r}{tradesIn(r) ? ` · ${tradesIn(r)}` : ""}
                </button>
              ))}
            </div>
            <div style={{ padding: "6px 16px", fontSize: "11px", fontWeight: 700, color: "#7a8597", borderBottom: "1px solid #eee" }}>
              Round {round}: pick a new holder to trade a pick. The number on each round is how many picks have changed hands.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {draft.order.map((abbr, i) => {
                  const cond = conditional[tradeKey(round, abbr)];
                  const holder = cond ? cond.holder : draft.trades[tradeKey(round, abbr)] || abbr;
                  const traded = holder !== abbr;
                  return (
                    <tr key={abbr} style={{ background: traded ? "#f3f8ff" : "#fff" }}>
                      <td style={{ ...td, width: "70px", fontWeight: 900 }}>
                        {i + 1}<span style={{ color: "#9aa5b4", fontSize: "11px", marginLeft: "4px" }}>#{(round - 1) * draft.order.length + i + 1}</span>
                      </td>
                      <td style={td}>
                        <span style={{ display: "flex", alignItems: "center", gap: "8px", color: traded ? "#9aa5b4" : INK }}>
                          {logo(abbr) ? <img src={logo(abbr)} alt="" style={{ width: "20px", height: "20px", objectFit: "contain", opacity: traded ? 0.5 : 1 }} /> : null}
                          {abbr}
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {traded && logo(holder) && <img src={logo(holder)} alt="" style={{ width: "20px", height: "20px", objectFit: "contain" }} />}
                          {cond ? (
                            <span title={cond.condition.note || ""} style={{ fontSize: "12px", fontWeight: 800, color: INK }}>
                              {traded ? `${holder}` : "Own pick"}
                              <span style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#7a8597" }}>
                                Conditional: earlier of {cond.condition.teams.join("/")} → {cond.condition.earlier}
                              </span>
                            </span>
                          ) : (
                          <select value={traded ? holder : ""} onChange={(e) => setHolder(abbr, e.target.value)} style={{ ...select, color: traded ? INK : "#9aa5b4" }}>
                            <option value="">Own pick</option>
                            {teams.filter((t) => t.abbr !== abbr).map((t) => <option key={t.abbr} value={t.abbr}>Traded to {t.abbr}</option>)}
                          </select>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
