// src/components/AdminPortalPages.jsx
//
// Admin → Players → Transfer Portal → Team Pages: what feeds the public
// team pages' Roster and Targets tabs (/portal/{team}).
//
//   Rebuild team pages  server/portal/public.js (api/portal-sync action
//                       "pages") — runs the Portal Sim's opening windows
//                       several times for needs, projected entrants and
//                       targets; folds in the real portal (We-Draft flags +
//                       the CFBD sync) and the 2027 signees. Locks from the
//                       Grades tab and recommendations from Targets show
//                       live without it.
//   Import signees      server/portal/signees.js (action "signees") — CFBD's
//                       committed high school recruits → recruits (2027),
//                       dry run first. Rebuild afterwards to show them.
// Both run on the live site (the endpoint isn't in plain CRA dev); the CLI
// versions are scripts/buildPortalPages.js and scripts/importSignees.js.
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { activePortalSeason } from "../utils/eligibility";

const BLUE = "#0055a5";
const GREEN = "#2e7d32";
const btn = (color = BLUE, solid = false) => ({
  padding: "8px 14px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${color}`, borderRadius: "8px", cursor: "pointer", background: solid ? color : "#fff", color: solid ? "#fff" : color, fontFamily: "inherit",
});
const card = { border: "1px solid #e3e8ef", borderRadius: "12px", background: "#fff", padding: "16px 18px", marginBottom: "16px" };
const fmt = (ts) => (ts?.toDate ? ts.toDate().toLocaleString() : "never");

async function call(body, cli) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/portal-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (r.status === 404) throw new Error(`the endpoint runs on the live site. Locally: ${cli}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
  return j;
}

export default function AdminPortalPages() {
  const season = activePortalSeason();
  const [built, setBuilt] = useState(undefined);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // { text, bad }
  const [plan, setPlan] = useState(null); // signee dry run

  const loadMeta = () => getDoc(doc(db, "compSnapshots", "_portal_board")).then((s) => setBuilt(s.data() || null)).catch(() => setBuilt(null));
  useEffect(() => { loadMeta(); }, []);

  const run = async (key, body, cli, done) => {
    setBusy(key); setMsg(null);
    try {
      done(await call(body, cli));
    } catch (e) {
      setMsg({ text: `Failed: ${e.message}`, bad: true });
    } finally {
      setBusy("");
    }
  };
  const rebuild = () => run("pages", { action: "pages" }, "node --env-file=.env scripts/buildPortalPages.js", (j) => {
    setMsg({ text: `Rebuilt ${j.teams} team pages for the ${j.season} portal in ${Math.round(j.durationMs / 100) / 10}s — ${j.moves} real moves, ${j.signees} signees, ${j.projectedEntrants} projected entrants.` });
    loadMeta();
  });
  const dryImport = () => run("dry", { action: "signees", year: season, dry: true }, "node --env-file=.env scripts/importSignees.js --dry", setPlan);
  const doImport = () => {
    if (!window.confirm(`Add ${plan.create} new ${season} recruits and update ${plan.update} existing ones from CFBD?`)) return;
    run("import", { action: "signees", year: season }, "node --env-file=.env scripts/importSignees.js", (j) => {
      setPlan(null);
      setMsg({ text: `Imported: ${j.create} new recruits, ${j.update} updated, ${j.linked} linked to existing ${season + 3} players. Rebuild the team pages to show them.` });
    });
  };

  return (
    <div style={{ maxWidth: "860px" }}>
      {msg && <div style={{ ...card, borderColor: msg.bad ? "#f5c6c0" : "#c8e6c9", background: msg.bad ? "#fdecea" : "#f1f8f1", color: msg.bad ? "#a12a1d" : GREEN, fontWeight: 800, fontSize: "13px" }}>{msg.text}</div>}
      <div style={card}>
        <div style={{ fontWeight: 900, color: BLUE, fontSize: "15px", marginBottom: "6px" }}>Team pages · {season} portal</div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#5b6b84", lineHeight: 1.6, marginBottom: "12px" }}>
          Every FBS team&apos;s projected {season} roster, Portal Sim needs and suggested targets, plus the stars on every portal row.
          Last built: <b>{built === undefined ? "…" : fmt(built?.builtAt)}</b>{built?.entries ? ` · ${built.entries.length} CFBD-only portal entries` : ""}.
          Rebuild after a portal sync, a Sim pool rebuild or a signee import. Grade locks and recommended targets show without one.
        </div>
        <button type="button" disabled={!!busy} onClick={rebuild} style={btn(BLUE, true)}>{busy === "pages" ? "Rebuilding…" : "Rebuild team pages"}</button>
      </div>
      <div style={card}>
        <div style={{ fontWeight: 900, color: BLUE, fontSize: "15px", marginBottom: "6px" }}>{season} signees</div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#5b6b84", lineHeight: 1.6, marginBottom: "12px" }}>
          CFBD&apos;s committed {season} high school recruits become {season} recruits (Admin → Players → Recruits), marked as CFBD imports.
          Recruits already on the list only get CFBD&apos;s stars, rank and commitment. Anyone matching a class of {season + 3} player by name is linked to him, never duplicated.
          Imports aren&apos;t included in &quot;Promote {season} class…&quot; unless you tick them in; promote one from his recruit page.
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" disabled={!!busy} onClick={dryImport} style={btn()}>{busy === "dry" ? "Checking CFBD…" : "Check CFBD (dry run)"}</button>
          {plan && <button type="button" disabled={!!busy || !(plan.create || plan.update)} onClick={doImport} style={btn(GREEN, true)}>{busy === "import" ? "Importing…" : `Import ${plan.create} new · update ${plan.update}`}</button>}
        </div>
        {plan && (
          <div style={{ marginTop: "12px", fontSize: "13px", fontWeight: 700, color: "#33415c", lineHeight: 1.7 }}>
            CFBD lists {plan.cfbd} {season} high school recruits ({plan.uncommitted} uncommitted). <b>{plan.create}</b> new, <b>{plan.update}</b> existing to update, <b>{plan.linked}</b> to link to existing players.
            {plan.unmapped?.length > 0 && <div style={{ color: "#8a97ab" }}>Skipped (school not in We-Draft): {plan.unmapped.map(([n, c]) => `${n} (${c})`).join(", ")}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
