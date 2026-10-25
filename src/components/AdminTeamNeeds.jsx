// src/components/AdminTeamNeeds.jsx
//
// Admin → Mock Draft's two needs tabs:
//
//   Team Needs     every team's need labels per position — nflTeamNeeds/
//                  {abbr}.needs: { [key]: { labels, note } }, the admin's
//                  own, which the Draft Sim's CPU teams and analysts use
//                  (data.js loadNeeds). "Suggest changes" works them out
//                  fresh from the PFF depth charts (pffNflRosters) and the
//                  live ESPN injury lists (utils/teamNeedSuggestions.js) and
//                  lists every position where the suggestion differs, with
//                  why, to accept or dismiss — nothing changes until it's
//                  accepted. Injured starters count as healthy in the
//                  suggestion; they get their own list with what the
//                  position looks like without them. Expiring Contract
//                  (engine MANUAL_LABELS) only ever comes from here, and
//                  accepting a suggestion keeps it. Picking a team lists each position
//                  group's players with PFF grade, age, snap share and any
//                  injury (PlayerList — admin-only, PFF numbers included).
//                  Specific needs (3rd Down RB, Slot Corner… — engine
//                  SPECIFIC_NEEDS) are labeled the same way and listed under
//                  their position; the grid marks a position with a
//                  specific need (•).
//   Sub-positions  OL → OT / IOL and DB → CB / S for the sim's class
//                  (players/{id}.SubPositionOverride over the synced
//                  SubPosition — scripts/syncSubPositions.mjs). Mostly for
//                  the prospects PFF couldn't place. The sim picks these up
//                  from the class snapshots, so they apply after the next
//                  Rebuild Site Snapshots.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { NEED_LABELS, NEED_KEYS, NEED_KEY_NAMES, MANUAL_LABELS, SPECIFIC_NEEDS, resolveNeeds } from "../utils/draftSim/engine";
import { SIM_YEAR } from "../utils/draftSim/data";
import { fetchNflBranding } from "../utils/draftProfileData";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { fetchEspnRoster } from "../utils/nflRoster";
import { COMP_SNAPSHOT_VERSION } from "../utils/historicalStats";
import { suggestNeeds, suggestionReason, positionPlayers } from "../utils/teamNeedSuggestions";

const BLUE = "#0055a5";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden" };
const btn = (primary, enabled = true) => ({
  border: primary ? "none" : "1px solid #d5dce6", borderRadius: "999px", padding: "7px 16px", fontWeight: 900, fontSize: "12px",
  background: primary ? (enabled ? BLUE : "#c9d2de") : "#fff", color: primary ? "#fff" : "#33415a", cursor: enabled ? "pointer" : "default",
});
const LABEL_COLOR = {
  "Upgrade Needed": "#c8102e", "Expiring Contract": "#d9480f", "Aging Talent": "#7a3cff", "Upgrade Wanted": "#b7791f",
  "Depth Needed": "#0055a5", Set: "#8a97ab", "Crowded Room": "#0f766e",
};
// Short forms for the all-teams grid.
const LABEL_SHORT = {
  "Upgrade Needed": "NEED", "Expiring Contract": "EXP", "Aging Talent": "AGE", "Upgrade Wanted": "WANT",
  "Depth Needed": "DEPTH", Set: "·", "Crowded Room": "FULL",
};
const byUrgency = (a, b) => NEED_LABELS.indexOf(a) - NEED_LABELS.indexOf(b);
// Every position, each followed by its specific needs.
const specificsOf = (key) => SPECIFIC_NEEDS.filter((s) => s.parent === key).map((s) => s.key);
const ALL_KEYS = NEED_KEYS.flatMap((k) => [k, ...specificsOf(k)]);
const IS_SPECIFIC = new Set(SPECIFIC_NEEDS.map((s) => s.key));

function Chip({ label, on, onClick, small }) {
  const c = LABEL_COLOR[label] || BLUE;
  return (
    <button type="button" onClick={onClick} style={{
      border: `1px solid ${on ? c : "#d5dce6"}`, background: on ? c : "#fff", color: on ? "#fff" : "#33415a",
      borderRadius: "999px", padding: small ? "2px 8px" : "4px 10px", fontSize: small ? "10px" : "11px", fontWeight: 800,
      cursor: onClick ? "pointer" : "default", whiteSpace: "nowrap",
    }}>{label}</button>
  );
}
const Labels = ({ labels }) => <span style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap" }}>{labels.map((l) => <Chip key={l} label={l} on small />)}</span>;

// A team's labels for a position, never empty ("Set").
const labelsOf = (needs, key) => needs[key]?.labels?.length ? needs[key].labels : ["Set"];
// A suggestion applied to a position: the suggested label, keeping any
// hand-set ones (MANUAL_LABELS); the note kept, or the injury note when empty.
function applied(current, s, label = s.label) {
  const keep = (current?.labels || []).filter((l) => MANUAL_LABELS.includes(l));
  const labels = [...new Set([...(label === "Set" && keep.length ? [] : [label]), ...keep])].sort(byUrgency);
  const injuryNote = s.injured.length ? `Counting ${s.injured.map((i) => `${i.name} (${i.status})`).join(", ")} as healthy` : "";
  return { labels, note: current?.note || (label === s.label ? injuryNote : "") };
}
// Only what's worth storing.
const compact = (needs) => Object.fromEntries(Object.entries(needs)
  .filter(([, v]) => v && ((v.labels || []).some((l) => l !== "Set") || (v.note || "").trim()))
  .map(([k, v]) => [k, { labels: (v.labels || []).filter((l) => l !== "Set"), note: (v.note || "").trim() }]));

// PFF grade colors, like the Research tab's tiers.
const gradeColor = (g) => (g == null ? "#8a97ab" : g >= 80 ? "#15803d" : g >= 70 ? "#0055a5" : g >= 60 ? "#5b6b84" : "#c8102e");

// One position group's players (utils/teamNeedSuggestions.js
// positionPlayers), starters first by snaps.
function PlayerList({ players }) {
  if (!players) return <div style={{ fontSize: "11px", color: "#8a97ab" }}>Loading players…</div>;
  if (!players.length) return <div style={{ fontSize: "11px", color: "#8a97ab" }}>No players on the PFF depth chart.</div>;
  const cell = { padding: "3px 8px", whiteSpace: "nowrap" };
  return (
    <table style={{ borderCollapse: "collapse", fontSize: "12px", fontFamily: "Arial, sans-serif", width: "100%", maxWidth: "620px" }}>
      <thead>
        <tr style={{ color: "#8a97ab", fontSize: "10px", letterSpacing: "0.08em", textAlign: "left" }}>
          <th style={cell}>PLAYER</th><th style={cell}>PFF</th><th style={cell}>AGE</th><th style={cell}>SNAPS</th><th style={cell}>INJURY</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={p.name} style={{ borderTop: "1px solid #f1f4f8" }}>
            <td style={{ ...cell, fontWeight: p.starter ? 800 : 600, color: "#0f1b2d" }}>
              {p.name}{p.starter && <span style={{ marginLeft: "6px", fontSize: "9px", fontWeight: 900, color: "#0055a5", letterSpacing: "0.08em" }}>STARTER</span>}
            </td>
            <td style={{ ...cell, fontWeight: 900, color: gradeColor(p.grade), fontVariantNumeric: "tabular-nums" }}>{p.grade != null ? p.grade.toFixed(1) : "—"}</td>
            <td style={{ ...cell, fontVariantNumeric: "tabular-nums" }}>{p.age == null ? "—" : Number.isInteger(p.age) ? p.age : p.age.toFixed(1)}</td>
            <td style={{ ...cell, color: "#5b6b84", fontVariantNumeric: "tabular-nums" }}>{p.snapPct != null ? `${p.snapPct}%` : "—"}</td>
            <td style={cell}>
              {p.injury && <span style={{ background: /reserve|out|pup|physically/i.test(p.injury) ? "#c8102e" : "#d9480f", color: "#fff", borderRadius: "999px", padding: "1px 8px", fontSize: "10px", fontWeight: 900 }}>{p.injury}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TeamNeeds() {
  const [docs, setDocs] = useState(null);
  const [branding, setBranding] = useState({});
  const [team, setTeam] = useState("");
  const [draft, setDraft] = useState({});
  const [message, setMessage] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [suggesting, setSuggesting] = useState("");
  const [dismissed, setDismissed] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  // The picked team's PFF depth chart + ESPN roster, for its player lists.
  const [roster, setRoster] = useState(null);

  useEffect(() => {
    getDocs(collection(db, "nflTeamNeeds")).then((snap) => setDocs(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))));
    fetchNflBranding().then(setBranding).catch(() => {});
  }, []);
  const name = (abbr) => (branding[abbr]?.Team ? `${branding[abbr].City || ""} ${branding[abbr].Team}`.trim() : NFL_TEAMS[abbr] || abbr);
  const teams = useMemo(() => [...NFL_TEAM_ABBRS].sort((a, b) => name(a).localeCompare(name(b))), [branding]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsOf = (abbr) => resolveNeeds(docs?.[abbr]?.needs);

  useEffect(() => {
    if (team && docs) setDraft(JSON.parse(JSON.stringify(resolveNeeds(docs[team]?.needs))));
    setMessage("");
  }, [team, docs]);

  useEffect(() => {
    if (!team) return undefined;
    let alive = true;
    setRoster(null);
    Promise.all([
      getDoc(doc(db, "pffNflRosters", team)).then((snap) => (snap.exists() ? snap.data() : null)),
      fetchEspnRoster(team).catch(() => []),
    ]).then(([pff, espn]) => { if (alive) setRoster({ pff, espn }); }).catch(() => { if (alive) setRoster({ pff: null, espn: [] }); });
    return () => { alive = false; };
  }, [team]);

  // Every team's needs at once → Firestore + local state. Each team's
  // entry in compSnapshots/_teamNeeds (all 32 in one doc — what the Draft
  // Sim reads, utils/draftSim/data.js loadNeeds) is replaced in the same
  // batch, so the two never drift.
  const saveTeams = async (changes) => {
    const batch = writeBatch(db);
    const combined = { version: COMP_SNAPSHOT_VERSION, updatedAt: serverTimestamp(), needs: {} };
    Object.entries(changes).forEach(([abbr, needs]) => {
      batch.set(doc(db, "nflTeamNeeds", abbr), { abbr, needs: compact(needs), updatedAt: serverTimestamp() }, { mergeFields: ["abbr", "needs", "updatedAt"] });
      combined.needs[abbr] = compact(needs);
    });
    batch.set(doc(db, "compSnapshots", "_teamNeeds"), combined, { mergeFields: ["version", "updatedAt", ...Object.keys(changes).map((abbr) => `needs.${abbr}`)] });
    await batch.commit();
    setDocs((all) => ({ ...all, ...Object.fromEntries(Object.entries(changes).map(([abbr, needs]) => [abbr, { ...(all[abbr] || {}), needs: compact(needs) }])) }));
  };

  const suggest = async () => {
    setSuggesting("Reading PFF depth charts…");
    try {
      const rosters = (await getDocs(collection(db, "pffNflRosters"))).docs.map((d) => d.data()).filter((t) => t.abbr);
      setSuggesting("Checking ESPN injury lists…");
      const injuries = {};
      const failed = [];
      await Promise.all(rosters.map((t) => fetchEspnRoster(t.abbr).then((r) => { injuries[t.abbr] = r; }).catch(() => failed.push(t.abbr))));
      setSuggestions({ byTeam: suggestNeeds(rosters, injuries), at: new Date(), failed, season: rosters[0]?.season });
      setDismissed(new Set());
      setSuggesting("");
    } catch (e) {
      setSuggesting(`Couldn't suggest: ${e.message}`);
    }
  };

  if (!docs) return <div style={{ padding: 20, color: "#777" }}>Loading team needs…</div>;

  // Positions where the suggestion differs from what's saved (hand-set
  // labels alone don't count as different).
  const changes = [];
  const injuredList = [];
  if (suggestions) {
    teams.forEach((abbr) => {
      const needs = needsOf(abbr);
      ALL_KEYS.forEach((key) => {
        const s = suggestions.byTeam[abbr]?.[key];
        if (!s) return;
        const mine = labelsOf(needs, key).filter((l) => !MANUAL_LABELS.includes(l));
        const same = (mine.length ? mine : ["Set"]).join() === s.label;
        if (!same && !dismissed.has(`${abbr}:${key}`)) changes.push({ abbr, key, s, current: labelsOf(needs, key) });
        if (s.injured.length) injuredList.push({ abbr, key, s });
      });
    });
  }

  const accept = async (items) => {
    setBusy(true);
    try {
      const byTeam = {};
      items.forEach(({ abbr, key, s, label }) => {
        byTeam[abbr] = byTeam[abbr] || needsOf(abbr);
        byTeam[abbr][key] = applied(byTeam[abbr][key], s, label);
      });
      await saveTeams(byTeam);
    } catch (e) {
      setMessage(`Couldn't save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const dirty = team && JSON.stringify(compact(draft)) !== JSON.stringify(compact(needsOf(team)));
  const setKey = (key, next) => setDraft((d) => ({ ...d, [key]: { labels: [], note: "", ...(d[key] || {}), ...next } }));
  const toggle = (key, label) => {
    const cur = (draft[key]?.labels || []).filter((l) => l !== "Set");
    setKey(key, { labels: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label].sort(byUrgency) });
  };
  const saveTeam = async () => {
    setBusy(true);
    try {
      await saveTeams({ [team]: draft });
      setMessage("Saved — the sim uses it on its next load.");
    } catch (e) {
      setMessage(`Couldn't save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const tag = (abbr, key) => <span style={{ fontWeight: 900, color: "#0f1b2d", whiteSpace: "nowrap" }}>{abbr} · {NEED_KEY_NAMES[key]}</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ ...card, padding: "14px 16px", fontSize: "13px", color: "#33415a", lineHeight: 1.5, display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "260px" }}>
          These labels are what the Draft Sim's teams and analysts go by — nothing changes them but you. <b>Suggest changes</b> works
          them out from the latest PFF depth charts and ESPN injury lists and shows where it disagrees; accept what's right.
          Injured starters count as healthy (the draft's months away) — check the injury list for anyone who won't be.
        </div>
        <button onClick={suggest} disabled={!!suggesting && !suggesting.startsWith("Couldn't")} style={btn(true)}>
          {suggesting && !suggesting.startsWith("Couldn't") ? suggesting : "Suggest changes"}
        </button>
      </div>
      {suggesting.startsWith("Couldn't") && <div style={{ color: "#c8102e", fontSize: "13px" }}>{suggesting}</div>}

      {suggestions && (
        <div style={card}>
          <div style={{ background: BLUE, color: "#fff", padding: "10px 16px", fontWeight: 900, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            SUGGESTED CHANGES ({changes.length})
            <span style={{ fontWeight: 700, fontSize: "11px", opacity: 0.8, letterSpacing: 0 }}>
              {suggestions.season} PFF · {suggestions.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {suggestions.failed.length ? ` · no injury list for ${suggestions.failed.join(", ")}` : ""}
            </span>
            {changes.length > 0 && (
              <span style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
                <button onClick={() => accept(changes)} disabled={busy} style={{ ...btn(false), padding: "4px 12px" }}>Accept all</button>
                <button onClick={() => setDismissed(new Set([...dismissed, ...changes.map((c) => `${c.abbr}:${c.key}`)]))} style={{ ...btn(false), padding: "4px 12px" }}>Dismiss all</button>
              </span>
            )}
          </div>
          {!changes.length && <div style={{ padding: "14px 16px", color: "#5b6b84", fontSize: "13px" }}>Everything matches the suggestions.</div>}
          {changes.map(({ abbr, key, s, current }) => (
            <div key={`${abbr}:${key}`} style={{ display: "grid", gridTemplateColumns: "190px 1fr auto", gap: "10px", alignItems: "center", padding: "9px 16px", borderTop: "1px solid #eef1f5", fontSize: "12px" }}>
              {tag(abbr, key)}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}><Labels labels={current} /> → <Chip label={s.label} on small /></span>
                <span style={{ color: "#5b6b84" }}>{suggestionReason(s)}</span>
                {s.injured.length > 0 && (
                  <span style={{ color: "#d9480f", fontWeight: 700 }}>
                    Counting {s.injured.map((i) => `${i.name} (${i.status}, ${i.snapPct}% of snaps)`).join(", ")} as healthy — without: {s.without.label}
                  </span>
                )}
              </div>
              <span style={{ display: "flex", gap: "6px" }}>
                <button onClick={() => accept([{ abbr, key, s }])} disabled={busy} style={{ ...btn(true, !busy), padding: "4px 12px" }}>Accept</button>
                <button onClick={() => setDismissed(new Set([...dismissed, `${abbr}:${key}`]))} style={{ ...btn(false), padding: "4px 12px" }}>Dismiss</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {suggestions && injuredList.length > 0 && (
        <div style={card}>
          <div style={{ background: "#d9480f", color: "#fff", padding: "10px 16px", fontWeight: 900, letterSpacing: "0.06em" }}>
            INJURED STARTERS COUNTED AS HEALTHY ({injuredList.length})
          </div>
          {injuredList.map(({ abbr, key, s }) => {
            const now = labelsOf(needsOf(abbr), key);
            return (
              <div key={`${abbr}:${key}`} style={{ display: "grid", gridTemplateColumns: "190px 1fr auto", gap: "10px", alignItems: "center", padding: "9px 16px", borderTop: "1px solid #eef1f5", fontSize: "12px" }}>
                {tag(abbr, key)}
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  <span style={{ fontWeight: 700 }}>{s.injured.map((i) => `${i.name} — ${i.status}, ${i.snapPct}% of snaps`).join("; ")}</span>
                  <span style={{ color: "#5b6b84", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                    Saved: <Labels labels={now} /> · healthy: <Chip label={s.label} on small /> · without: <Chip label={s.without.label} on small />
                  </span>
                </div>
                {!now.includes(s.without.label) && (
                  <button onClick={() => accept([{ abbr, key, s, label: s.without.label }])} disabled={busy} style={{ ...btn(false), padding: "4px 12px" }}>
                    Use “{s.without.label}”
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {message && !team && <div style={{ color: "#5b6b84", fontSize: "13px" }}>{message}</div>}

      {/* Every team at a glance — click a row to edit it. */}
      <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "11px" }}>
          <thead>
            <tr style={{ background: "#f7f9fc" }}>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Team</th>
              {NEED_KEYS.map((k) => <th key={k} style={{ padding: "8px 6px" }}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const needs = needsOf(t);
              return (
                <tr key={t} onClick={() => setTeam(t)} style={{ cursor: "pointer", borderTop: "1px solid #eef1f5", background: team === t ? "#eef3fa" : "#fff" }}>
                  <td style={{ padding: "6px 10px", fontWeight: 800, whiteSpace: "nowrap" }}>{t}</td>
                  {NEED_KEYS.map((k) => {
                    const labels = labelsOf(needs, k);
                    const top = labels[0];
                    const specific = specificsOf(k).filter((sk) => labelsOf(needs, sk)[0] !== "Set");
                    const tip = [`${labels.join(" + ")}${needs[k]?.note ? ` — ${needs[k].note}` : ""}`, ...specific.map((sk) => `${NEED_KEY_NAMES[sk]}: ${labelsOf(needs, sk).join(" + ")}`)].join("\n");
                    return (
                      <td key={k} title={tip} style={{ textAlign: "center", padding: "6px 4px", whiteSpace: "nowrap" }}>
                        <span style={{ color: top === "Set" ? "#b8c2d1" : LABEL_COLOR[top], fontWeight: 900, borderBottom: needs[k]?.note ? `2px dotted ${LABEL_COLOR[top]}` : "none" }}>
                          {LABEL_SHORT[top]}{labels.length > 1 ? "+" : ""}
                        </span>
                        {specific.length > 0 && <span style={{ color: LABEL_COLOR[labelsOf(needs, specific[0])[0]], fontWeight: 900 }}> •</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "8px 10px", fontSize: "11px", color: "#5b6b84", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {NEED_LABELS.map((l) => <span key={l}><b style={{ color: LABEL_COLOR[l] }}>{LABEL_SHORT[l]}</b> {l}</span>)}
          <span>· + more than one label · dotted = has a note · • a specific need (hover for which)</span>
        </div>
      </div>

      {team && (
        <div style={card}>
          <div style={{ background: BLUE, color: "#fff", padding: "10px 16px", fontWeight: 900, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: "10px" }}>
            {name(team).toUpperCase()} NEEDS
            <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: "12px", opacity: 0.85 }}>{message}</span>
          </div>
          {ALL_KEYS.map((key) => {
            const o = draft[key];
            const s = suggestions?.byTeam[team]?.[key];
            const specific = IS_SPECIFIC.has(key);
            return (
              <div key={key} style={{
                display: "grid", gridTemplateColumns: "150px 150px 1fr", gap: "10px", alignItems: "start",
                padding: specific ? "8px 16px 8px 34px" : "10px 16px", borderTop: specific ? "1px dashed #eef1f5" : "1px solid #e3e8ef",
                background: specific ? "#fafbfd" : "#fff",
              }}>
                <div style={{ fontWeight: specific ? 800 : 900, color: specific ? "#33415a" : "#0f1b2d", fontSize: specific ? "12px" : "13px" }}>{specific ? `↳ ${NEED_KEY_NAMES[key]}` : NEED_KEY_NAMES[key]}</div>
                <div style={{ fontSize: "11px", color: "#5b6b84" }}>
                  <div style={{ fontSize: "10px", fontWeight: 900, color: "#8a97ab", letterSpacing: "0.1em" }}>SUGGESTED</div>
                  {s ? <><Chip label={s.label} on small /><div style={{ marginTop: "3px" }}>{suggestionReason(s)}</div></> : "Run Suggest changes"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                    {NEED_LABELS.filter((l) => l !== "Set").map((l) => <Chip key={l} label={l} on={o?.labels?.includes(l)} onClick={() => toggle(key, l)} />)}
                  </div>
                  <input value={o?.note || ""} onChange={(e) => setKey(key, { note: e.target.value })} placeholder="Note (optional) — e.g. Rodgers turns 42"
                    style={{ border: "1px solid #d5dce6", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", fontFamily: "Arial, sans-serif" }} />
                </div>
                {!specific && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <PlayerList players={roster ? positionPlayers(roster.pff, roster.espn, key) : null} />
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: "8px", padding: "12px 16px", borderTop: "1px solid #eef1f5", background: "#f7f9fc" }}>
            <button onClick={saveTeam} disabled={!dirty || busy} style={btn(true, dirty && !busy)}>{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => setDraft(JSON.parse(JSON.stringify(needsOf(team))))} disabled={!dirty} style={btn(false, dirty)}>Undo changes</button>
            <span style={{ marginLeft: "auto", fontSize: "11px", color: "#5b6b84", alignSelf: "center" }}>No label = Set</span>
          </div>
        </div>
      )}
    </div>
  );
}

const SUBS = { OL: ["OT", "IOL"], DB: ["CB", "S"] };

export function SubPositions() {
  const [players, setPlayers] = useState(null);
  const [missingOnly, setMissingOnly] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getDocs(query(collection(db, "players"), where("Eligible", "==", SIM_YEAR), where("Position", "in", Object.keys(SUBS))))
      .then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => !(p.Live === false || p.Live === "false" || p.Live === "no"))
        .sort((a, b) => (a.Position + a.Last).localeCompare(b.Position + b.Last))))
      .catch((e) => setError(e.message));
  }, []);

  const set = async (p, sub) => {
    try {
      await updateDoc(doc(db, "players", p.id), { SubPositionOverride: sub || deleteField() });
      setPlayers((all) => all.map((x) => (x.id === p.id ? { ...x, SubPositionOverride: sub || undefined } : x)));
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <div style={{ padding: 20, color: "#c8102e" }}>{error}</div>;
  if (!players) return <div style={{ padding: 20, color: "#777" }}>Loading {SIM_YEAR} OL and DBs…</div>;
  const missing = players.filter((p) => !p.SubPositionOverride && !p.SubPosition);
  const shown = missingOnly ? missing : players;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ ...card, padding: "14px 16px", fontSize: "13px", color: "#33415a", lineHeight: 1.5 }}>
        Team needs split OL into tackles and interior, and DBs into corners and safeties. Most {SIM_YEAR} prospects get theirs from PFF
        (scripts/syncSubPositions.mjs); set the rest here, or correct one. An OL or DB with none counts half toward each in the sim.
        Changes reach the sim after the next <b>Rebuild Site Snapshots</b>.
      </div>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", background: "#f7f9fc", borderBottom: "1px solid #eef1f5", fontSize: "12px", fontWeight: 800 }}>
          <span>{missing.length} of {players.length} without a sub-position</span>
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only
          </label>
        </div>
        {shown.map((p) => {
          const current = p.SubPositionOverride || p.SubPosition || null;
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 16px", borderTop: "1px solid #eef1f5", fontSize: "13px" }}>
              <span style={{ fontWeight: 900, color: BLUE, width: "34px" }}>{p.Position}</span>
              <span style={{ fontWeight: 800, color: "#0f1b2d", minWidth: 0, flex: 1 }}>{p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 600 }}>· {p.School}</span></span>
              {p.SubPosition && <span style={{ fontSize: "11px", color: "#8a97ab" }}>PFF: {p.SubPosition}</span>}
              {SUBS[p.Position].map((s) => (
                <button key={s} onClick={() => set(p, s)} style={{
                  border: `1px solid ${current === s ? BLUE : "#d5dce6"}`, background: current === s ? BLUE : "#fff", color: current === s ? "#fff" : "#33415a",
                  borderRadius: "999px", padding: "4px 12px", fontWeight: 800, fontSize: "11px", cursor: "pointer",
                }}>{s}</button>
              ))}
              <button onClick={() => set(p, null)} disabled={!p.SubPositionOverride} title="Back to PFF's" style={{ border: "none", background: "none", color: p.SubPositionOverride ? BLUE : "#c9d2de", fontSize: "11px", fontWeight: 800, cursor: p.SubPositionOverride ? "pointer" : "default", textDecoration: "underline" }}>
                Reset
              </button>
            </div>
          );
        })}
        {!shown.length && <div style={{ padding: "16px", color: "#5b6b84", fontSize: "13px" }}>Every {SIM_YEAR} OL and DB has a sub-position.</div>}
      </div>
    </div>
  );
}
