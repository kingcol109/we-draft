// src/components/AdminWeeklyMock.jsx
//
// Admin → Mock Draft → Weekly Mock: the site's official mock draft, made by
// the Draft Sim (utils/draftSim/weeklyMock.js — every team on the CPU, Less
// board variance, normal trades, up to 7 rounds).
//   1. Run it and look it over beside last week's (by pick slot — the same
//      team's same pick, whatever its number); run it again if you like.
//   2. Publish it right here — or, optionally, Edit in mock editor first:
//      that saves it as an official mockDrafts post (private, with its
//      trades) and a weeklyMocks doc, and opens the post in the mock editor
//      (pages/CreateMock.jsx) to move picks around (each pick's analysis can
//      be regenerated there), then Publish it from the list below.
//   3. Publish: the post goes public, and the mock's picks are copied onto
//      the weeklyMocks doc, which every team's /mocks/{team} page reads, and
//      config/weeklyMock, the summary that puts it in drafted players' news
//      and on NFL team pages (weeklyMockNews.js). "Update team pages" copies
//      them again after a later edit.
// Every weekly mock, draft or published, is listed underneath.
// The 2028 switch makes the next class's (three rounds), on top of the
// latest published 2027 week: each team's needs a year on from the picks it
// made (weeklyMock.js nextYearNeeds — listed under the run). The 2028 order
// is shuffled in tiers (tieredOrder — the mock's description says so) and
// carries the 2027 mock's trades of 2028 picks (carryTrades — saved as
// carriedTrades, for the pages to say so), there are no trades of its own,
// and each team is held to the positions nextYearRules allows. Its team
// pages are /mocks/{team}/2028 and its summary config/weeklyMock2028.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { loadSimData, maxRounds, teamNamer } from "../utils/draftSim/data";
import {
  runWeeklyMock, weeklyFromSim, weeklyNotes, mockPicksFrom, weeklyPicksFromMock, WEEKLY_ROUNDS_BY_YEAR, WEEKLY_TRADES_BY_YEAR, nextYearNeeds, nextYearRules, qbTeamsOf, carryTrades, tieredOrder, TIERED_ORDER_NOTE,
} from "../utils/draftSim/weeklyMock";
import { rngNext } from "../utils/draftSim/engine";
import { loadPffRanks } from "../utils/draftSim/pffRanks";
import { NoteText } from "../pages/ViewMock";
import { weeklyMockSummary, summaryDocId, weeklyMockHref, WEEKLY_YEARS, MAIN_WEEKLY_YEAR } from "../utils/weeklyMockNews";
import { NFL_TEAMS } from "../utils/coachHistory";

const BLUE = "#0055a5";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden" };
const btn = (primary, enabled = true) => ({
  border: primary ? "none" : "1px solid #d5dce6", borderRadius: "999px", padding: "7px 16px", fontWeight: 900, fontSize: "12px",
  background: primary ? (enabled ? BLUE : "#c9d2de") : "#fff", color: primary ? "#fff" : "#33415a", cursor: enabled ? "pointer" : "default",
});
const playerText = (p) => (p ? `${p.First} ${p.Last}, ${p.Position}${p.School ? `, ${p.School}` : ""}` : "—");
const dateText = (ts) => ts?.toDate?.()?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) || "";
const defaultName = (year) => `We-Draft.com ${year} Weekly Mock Draft — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
// A class's published weeks, newest first.
const publishedOf = (weeks, year) => (weeks || []).filter((w) => w.publishedAt && String(w.year) === String(year))
  .sort((a, b) => b.publishedAt.toMillis() - a.publishedAt.toMillis());
// "2027 R1 (No. 9, NYJ)" / "2028 R2 (DAL)".
const pickText = (p) => `${p.year} R${p.round} (${p.overall ? `No. ${p.overall}, ` : ""}${p.original})`;

export default function AdminWeeklyMock() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [weeks, setWeeks] = useState(null);
  const [year, setYear] = useState(MAIN_WEEKLY_YEAR);
  const [draft, setDraft] = useState(null);
  const [round, setRound] = useState(1);
  const [name, setName] = useState(() => defaultName(MAIN_WEEKLY_YEAR));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const loadWeeks = () => getDocs(query(collection(db, "weeklyMocks"), orderBy("createdAt", "desc"), limit(24)))
    .then((snap) => setWeeks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    .catch((e) => setError(e.message));
  useEffect(() => { loadWeeks(); }, []);
  const last = publishedOf(weeks, year)[0] || null;
  const pickYear = (y) => { setYear(y); setDraft(null); setName(defaultName(y)); };
  const lastBySlot = Object.fromEntries((last?.picks || []).map((p) => [p.slot, p]));

  const act = async (what, fn) => {
    setBusy(what);
    setError("");
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy("");
  };

  const run = () => act("run", async () => {
    let data = await loadSimData(year);
    let carried = null;
    const seed = Date.now() | 0;
    // The next class: on top of the latest published main-class week.
    if (year !== MAIN_WEEKLY_YEAR) {
      const base = publishedOf(weeks, MAIN_WEEKLY_YEAR)[0];
      if (!base?.picks?.length) throw new Error(`Publish a ${MAIN_WEEKLY_YEAR} weekly mock first — the ${year} mock is drafted on top of it.`);
      const main = await loadSimData(MAIN_WEEKLY_YEAR);
      const next = nextYearNeeds(data.needs, base.picks, main.board);
      const posRules = nextYearRules(data.needs, base.picks, main.board);
      // The order a year out, shuffled in tiers (seeded like the draft), then the trades carried onto it.
      const shuffle = { seed: seed ^ 0x2c1b3c6d };
      const tiered = tieredOrder(data.order, () => { const r = rngNext(shuffle.seed); shuffle.seed = r.seed; return r.value; });
      const moved = carryTrades(tiered, base.trades, year);
      carried = { baseWeekId: base.id, baseName: base.name, changes: next.changes, posRules, qbTeams: qbTeamsOf(posRules), trades: moved.carried, intro: TIERED_ORDER_NOTE.replace("{year}", year) };
      data = { ...data, needs: next.needs, order: moved.order };
    }
    const rounds = Math.min(WEEKLY_ROUNDS_BY_YEAR[year] || 7, maxRounds(data.board));
    // The next class: no trades, and each team held to its positions.
    const sim = runWeeklyMock(data, { seed, rounds, trades: WEEKLY_TRADES_BY_YEAR[year] || "normal", qbTeams: carried?.qbTeams || null, posRules: carried?.posRules || null });
    // Each pick's note (pickNotes.js), seeded like the draft. PFF ranks are
    // loaded here, admin-side, for the drafted players only.
    // The next class's notes are light (pickNotes.js): no needs, value or pick spot.
    const light = year !== MAIN_WEEKLY_YEAR;
    const pff = await loadPffRanks(sim.picks.map((p) => p.selection).filter(Boolean)).catch(() => ({}));
    const work = { seed: seed ^ 0x5bd1e995 };
    const rand = () => { const r = rngNext(work.seed); work.seed = r.seed; return r.value; };
    const notes = weeklyNotes(sim, { ...teamNamer(data.branding), staff: data.staff, season: data.season, year, history: data.history, pff, rand, light });
    setDraft({ ...weeklyFromSim(sim, year, notes), seed, carried });
    setRound(1);
  });

  // Save the run (private): its mockDrafts post and weeklyMocks doc → the week.
  const saveDraft = async () => {
    const now = Timestamp.now();
    const mockName = name.trim() || defaultName(year);
    const mock = await addDoc(collection(db, "mockDrafts"), {
      name: mockName, description: draft.carried?.intro || "", rounds: draft.rounds, visibility: "private", draftClass: year, picks: mockPicksFrom(draft.picks),
      trades: draft.trades, ...(draft.carried ? { carriedTrades: draft.carried.trades } : {}),
      ownerId: user.uid, source: "weeklyMock", official: true, createdAt: now, updatedAt: now,
    });
    const week = await addDoc(collection(db, "weeklyMocks"), {
      name: mockName, year, rounds: draft.rounds, seed: draft.seed, trades: draft.trades, mockId: mock.id,
      ...(draft.carried ? { baseWeekId: draft.carried.baseWeekId, carriedTrades: draft.carried.trades } : {}),
      createdAt: serverTimestamp(), createdBy: user.uid,
    });
    await updateDoc(mock, { weeklyId: week.id });
    return { id: week.id, mockId: mock.id, year, name: mockName, rounds: draft.rounds };
  };
  // Optional: save it and open it in the mock editor to move picks around.
  const openInEditor = () => act("open", async () => {
    const w = await saveDraft();
    navigate(`/mocks/${w.mockId}`);
  });
  // Publish the run as it is, from here.
  const publishDraft = () => act("publishDraft", async () => {
    if (!window.confirm("Publish this weekly mock? It goes public on /mocks and every team's page.")) return;
    const w = await saveDraft();
    await copyPicks(w, true);
    setDraft(null);
  });

  // The mock's picks (as edited) onto the weekly doc; publish: the post goes public too.
  const syncPicks = (w, publish) => act(`${publish ? "publish" : "sync"}:${w.id}`, async () => {
    if (publish && !window.confirm("Publish this weekly mock? It goes public on /mocks and every team's page.")) return;
    await copyPicks(w, publish);
  });
  const copyPicks = async (w, publish) => {
    const snap = await getDoc(doc(db, "mockDrafts", w.mockId));
    if (!snap.exists()) throw new Error("Its mock draft was deleted — discard this one and run a new one.");
    const mock = snap.data();
    const rounds = mock.rounds || w.rounds;
    const picks = weeklyPicksFromMock(mock.picks, rounds);
    await updateDoc(doc(db, "weeklyMocks", w.id), {
      name: mock.name || w.name, rounds, picks,
      ...(publish ? { publishedAt: serverTimestamp() } : { syncedAt: serverTimestamp() }),
    });
    if (publish) await updateDoc(doc(db, "mockDrafts", w.mockId), { visibility: "public", updatedAt: Timestamp.now() });
    // The news item on players' and teams' pages (utils/weeklyMockNews.js) —
    // for the week just published, or its class's latest after an edit —
    // with the week before it, for the team pages' comparison.
    const published = publishedOf(weeks, w.year);
    if (publish || w.id === published[0]?.id) {
      const prev = publish ? published[0] : published[1];
      await setDoc(doc(db, "config", summaryDocId(w.year)), weeklyMockSummary({
        mockId: w.mockId, weekId: w.id, prevWeekId: prev?.id || null, year: String(w.year), rounds,
        publishedAt: publish ? Timestamp.now() : w.publishedAt, picks, names: NFL_TEAMS,
      }));
    }
    await loadWeeks();
  };

  const discard = (w) => act(`discard:${w.id}`, async () => {
    if (!window.confirm("Discard this draft weekly mock and its mock draft?")) return;
    await deleteDoc(doc(db, "mockDrafts", w.mockId)).catch(() => {});
    await deleteDoc(doc(db, "weeklyMocks", w.id));
    await loadWeeks();
  });

  const rounds = draft ? [...new Set(draft.picks.map((p) => p.round))] : [];
  const shown = draft ? draft.picks.filter((p) => p.round === round) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "6px" }}>
        {WEEKLY_YEARS.map((y) => (
          <button key={y} onClick={() => pickYear(y)} disabled={!!busy} style={btn(year === y, !busy)}>{y} · {WEEKLY_ROUNDS_BY_YEAR[y]} rounds</button>
        ))}
      </div>
      <div style={{ ...card, padding: "14px 16px", fontSize: "13px", color: "#33415a", lineHeight: 1.5 }}>
        {year !== MAIN_WEEKLY_YEAR && (
          <p style={{ margin: "0 0 8px" }}>
            <b>The {year} mock is drafted on top of the latest published {MAIN_WEEKLY_YEAR} mock</b> — publish that one first. It uses the {year} draft order <b>shuffled in tiers</b> — picks 1–10, 11–20 and 21–32 each drawn at random, that first-round order used in every round, and said so at the top of the mock — with
            the {MAIN_WEEKLY_YEAR} mock&apos;s trades of {year} picks carried over (the pages say which picks moved in the {MAIN_WEEKLY_YEAR} mock), and every need moves up a tier unless that team drafted for it in {MAIN_WEEKLY_YEAR}:
            a round 1–2 pick fills it, round 3–4 holds it where it is, and round 5–7 only answers a depth need. A QB only counts toward an upgrade in round 1; a backup-QB need (Depth Needed) stays one, and any QB answers it.
            Set and Crowded Room stay as they are. In the {year} mock there are no trades, and <b>position rules</b>: in rounds 1–2 a team only takes a position it lists
            as a need, want or Set and didn&apos;t take in round 1 of the {MAIN_WEEKLY_YEAR} mock; round 3 is any position, a QB only for a team still needing a starter or backup
            a year on; and no team takes one position twice.
          </p>
        )}
        The site&apos;s official {year} mock: the Draft Sim with every team on the CPU, <b>Less</b> board variance and {WEEKLY_TRADES_BY_YEAR[year] === "off" ? <b>no trades</b> : "normal trades"},
        up to {WEEKLY_ROUNDS_BY_YEAR[year]} rounds. Run it and compare it with last week&apos;s (each pick by its original team and round, so the number
        can move); run it again if you like. <b>Publish</b> it as it is, or <b>Edit in mock editor</b> first — that saves it privately and opens it to move picks
        around (with a button on each pick to regenerate its analysis); then come back and <b>Publish</b> it from the list below. Publishing puts it on /mocks and updates every team&apos;s page ({weeklyMockHref("nyj", year)}). Uses the current draft order, team
        needs and community board — rebuild site snapshots first if grades have moved.
      </div>
      {error && <div style={{ color: "#c8102e", fontSize: "13px", fontWeight: 700 }}>{error}</div>}

      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={run} disabled={!!busy} style={btn(true, !busy)}>{busy === "run" ? "Running…" : draft ? "Run it again" : "Run this week's mock"}</button>
        {last && <span style={{ fontSize: "12px", color: "#5b6b84" }}>Last published {dateText(last.publishedAt)}</span>}
      </div>

      {draft?.carried && (
        <details style={{ ...card, padding: "10px 16px", fontSize: "12px", color: "#33415a" }}>
          <summary style={{ cursor: "pointer", fontWeight: 900 }}>
            Needs a year on from {draft.carried.baseName}: {draft.carried.changes.length} changed
          </summary>
          <div style={{ marginTop: 6 }}><b>Can take a QB:</b> {draft.carried.qbTeams.join(", ") || "none"}</div>
          <div style={{ marginTop: 6 }}>
            <b>{year} picks moved in the {MAIN_WEEKLY_YEAR} mock:</b>{" "}
            {draft.carried.trades.map((c) => `R${c.round} ${c.original} → ${c.to} (from ${c.from})`).join("; ") || "none"}
          </div>
          <div style={{ marginTop: 6, lineHeight: 1.6, columns: "2 280px" }}>
            {Object.entries(draft.carried.posRules).sort(([a], [b]) => a.localeCompare(b)).map(([team, r]) => (
              <div key={team}><b>{team} R1–2</b>: {r.early.join(", ") || "none (best available)"}{r.qbLate ? " · R3 QB ok" : ""}</div>
            ))}
          </div>
          <div style={{ marginTop: 6, lineHeight: 1.6, columns: "2 280px" }}>
            {draft.carried.changes.map((c) => (
              <div key={`${c.team}-${c.key}`}>
                <b>{c.team} {c.key}</b>: {c.from.join(", ")} → {c.to.join(", ")}{c.cover ? <span style={{ color: "#8a97ab" }}> ({c.cover} pick)</span> : null}
              </div>
            ))}
          </div>
        </details>
      )}

      {draft && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", background: "#f7f9fc", borderBottom: "1px solid #eef1f5", flexWrap: "wrap" }}>
            {rounds.map((r) => (
              <button key={r} onClick={() => setRound(r)} style={{ ...btn(round === r), padding: "5px 12px" }}>R{r}</button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 800, color: "#5b6b84" }}>
              {draft.picks.length} picks · {draft.trades.length} trade{draft.trades.length === 1 ? "" : "s"}
            </span>
          </div>
          {shown.map((p) => {
            const was = lastBySlot[p.slot];
            return (
              <div key={p.overall} style={{ padding: "7px 16px", borderTop: "1px solid #eef1f5", fontSize: "13px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                  <span style={{ width: "34px", fontWeight: 900, color: BLUE, fontVariantNumeric: "tabular-nums" }}>{p.overall}</span>
                  <span style={{ width: "130px", fontWeight: 800, color: "#0f1b2d" }}>
                    {p.owner}{p.owner !== p.original && <span style={{ color: "#b7791f", fontWeight: 700 }}> via {p.original}</span>}
                  </span>
                  <span style={{ flex: 1, fontWeight: 800, color: "#0f1b2d" }}>{playerText(p.player)}</span>
                  <span style={{ flex: 1, fontSize: "12px", color: "#8a97ab" }}>
                    {was ? `Last week: No. ${was.overall}${was.owner !== p.owner ? ` (${was.owner})` : ""} — ${playerText(was.player)}` : last ? "New pick this week" : ""}
                  </span>
                </div>
                {p.note && <div style={{ margin: "3px 0 0 44px", fontSize: "12px", color: "#5b6b84", lineHeight: 1.5 }}><NoteText text={p.note} /></div>}
              </div>
            );
          })}
          {draft.trades.length > 0 && (
            <div style={{ padding: "10px 16px", borderTop: "1px solid #eef1f5", fontSize: "12px", color: "#33415a", lineHeight: 1.6 }}>
              <div style={{ fontWeight: 900, marginBottom: 2 }}>Trades</div>
              {draft.trades.map((t, i) => (
                <div key={i}>
                  <b>{t.up}</b> {t.at ? `move up to No. ${t.at}` : "trade"} — get {t.upGot.map(pickText).join(" + ")}; <b>{t.down}</b> get {t.downGot.map(pickText).join(" + ")}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "12px 16px", borderTop: "1px solid #eef1f5", background: "#f7f9fc", flexWrap: "wrap" }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Mock draft name"
              style={{ flex: "1 1 320px", minWidth: 0, border: "1px solid #d5dce6", borderRadius: "999px", padding: "8px 14px", fontSize: "13px" }} />
            <button onClick={openInEditor} disabled={!!busy || !user} style={btn(false, !busy && !!user)}>{busy === "open" ? "Saving…" : "Edit in mock editor →"}</button>
            <button onClick={publishDraft} disabled={!!busy || !user} style={btn(true, !busy && !!user)}>{busy === "publishDraft" ? "Publishing…" : "Publish"}</button>
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ padding: "10px 16px", background: "#f7f9fc", borderBottom: "1px solid #eef1f5", fontSize: "12px", fontWeight: 900, color: "#33415a" }}>Weekly mocks</div>
        {weeks === null && <div style={{ padding: "14px 16px", color: "#777", fontSize: "13px" }}>Loading…</div>}
        {weeks?.length === 0 && <div style={{ padding: "14px 16px", color: "#5b6b84", fontSize: "13px" }}>None yet.</div>}
        {(weeks || []).map((w) => (
          <div key={w.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 16px", borderTop: "1px solid #eef1f5", fontSize: "13px", flexWrap: "wrap" }}>
            <span style={{ width: "44px", fontWeight: 900, color: "#33415a" }}>{w.year}</span>
            <span style={{ width: "150px", fontWeight: 800, color: w.publishedAt ? "#2e7d32" : "#b7791f" }}>
              {w.publishedAt ? `Published ${dateText(w.publishedAt)}` : `Draft · ${dateText(w.createdAt)}`}
            </span>
            <span style={{ flex: 1, minWidth: "200px", fontWeight: 800, color: "#0f1b2d" }}>{w.name}</span>
            <span style={{ color: "#5b6b84", fontSize: "12px" }}>{(w.trades || []).length} trade{(w.trades || []).length === 1 ? "" : "s"}</span>
            <button onClick={() => navigate(`/mocks/${w.mockId}`)} style={btn(false)}>Edit</button>
            <a href={`/mocks/${w.mockId}/view`} target="_blank" rel="noopener noreferrer" style={{ ...btn(false), textDecoration: "none" }}>View</a>
            {w.publishedAt
              ? <button onClick={() => syncPicks(w, false)} disabled={!!busy} title="Copy the mock's picks (after an edit) to the team pages" style={btn(false, !busy)}>{busy === `sync:${w.id}` ? "Updating…" : "Update team pages"}</button>
              : (
                <>
                  <button onClick={() => syncPicks(w, true)} disabled={!!busy} style={btn(true, !busy)}>{busy === `publish:${w.id}` ? "Publishing…" : "Publish"}</button>
                  <button onClick={() => discard(w)} disabled={!!busy} style={{ ...btn(false, !busy), color: "#c8102e" }}>Discard</button>
                </>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}
