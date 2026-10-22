// src/components/AdminCoachHistory.js
//
// Admin → Coach History: career timelines for NFL head coaches,
// coordinators and GMs, stored one doc per person in `coaches/{slug}` (shape
// and role keys in utils/coachHistory.js). Three views:
//
//   People    list + editor for one person's details and stints
//   Coverage  32 teams × HC/OC/DC/GM — who's on file as current
//   Import    paste JSON (one person or an array) → preview → write
//
// Former coaches stay in the collection with Status "former" — nothing here
// deletes a person just because their stints all closed.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import {
  LEVELS, ROLES, ROLE_BY_KEY, ROLE_GROUPS, COVERAGE_ROLES, NFL_TEAMS, NFL_TEAM_ABBRS, NFL_ORG_NAMES,
  nflAbbrFromOrg, normalizeCoach, slugify, stintSpan, isOpenStint, uniqueSlug,
} from "../utils/coachHistory";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const RED = "#c0392b";
const GREEN = "#2e9e4f";
const AMBER = "#e0a100";

const COLLECTION = "coaches";

const VIEWS = [
  { key: "people", label: "People" },
  { key: "coverage", label: "Coverage" },
  { key: "import", label: "Import" },
];

const box = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px" };
const labelStyle = { fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", marginBottom: "4px" };
const hint = { fontSize: "11px", fontWeight: 700, color: "#999", marginTop: "4px" };
const input = { width: "100%", boxSizing: "border-box", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "13px" };

function smallBtn(bg, color, border) {
  return {
    padding: "6px 10px", fontSize: "11px", fontWeight: 900, borderRadius: "6px", cursor: "pointer",
    background: bg, color, border: `1px solid ${border}`, textTransform: "uppercase", letterSpacing: "0.04em",
    whiteSpace: "nowrap",
  };
}

function tabBtn(active, color = BLUE) {
  return {
    padding: "9px 22px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.06em",
    border: "2px solid " + color, borderRadius: "8px", cursor: "pointer",
    background: active ? color : "#fff", color: active ? "#fff" : color,
  };
}

// Editor state keeps every number as a string so half-typed years survive;
// normalizeCoach turns it back into the stored shape on save.
const numStr = (v) => (v === null || v === undefined ? "" : String(v));
const blankStint = () => ({ Level: "NFL", Org: "", Team: "", Title: "", Roles: [], StartYear: "", StartMonth: "", EndYear: "", EndMonth: "", EndUnknown: false, Notes: "" });

function draftFrom(c) {
  return {
    Name: c?.Name || "",
    Born: numStr(c?.Born),
    College: c?.College || "",
    PlayingCareer: c?.PlayingCareer || "",
    Notes: c?.Notes || "",
    Sources: c?.Sources || "",
    Stints: (c?.Stints || []).map((s) => ({
      ...blankStint(), ...s,
      StartYear: numStr(s.StartYear), StartMonth: numStr(s.StartMonth), EndYear: numStr(s.EndYear), EndMonth: numStr(s.EndMonth),
    })),
  };
}

const roleLabel = (k) => ROLE_BY_KEY[k]?.label || k;

function CurrentChips({ coach }) {
  if (!coach.Current?.length) return <span style={{ fontSize: "10px", fontWeight: 900, color: "#aaa", textTransform: "uppercase" }}>Former</span>;
  return (
    <span style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap" }}>
      {coach.Current.map((c) => (
        <span key={c.Team + c.Role} style={{ fontSize: "10px", fontWeight: 900, color: "#fff", background: BLUE, padding: "2px 6px", borderRadius: "4px" }}>
          {c.Team} {c.Role}
        </span>
      ))}
    </span>
  );
}

export default function AdminCoachHistory() {
  const [view, setView] = useState("people");
  const [coaches, setCoaches] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let alive = true;
    getDocs(collection(db, COLLECTION))
      .then((snap) => {
        if (!alive) return;
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCoaches(list);
        setSelectedId(list.length ? [...list].sort((a, b) => a.Name.localeCompare(b.Name))[0].id : "new");
      })
      .catch((e) => {
        console.error("Coach history load error:", e);
        if (alive) { setLoadError(e.message); setCoaches([]); setSelectedId("new"); }
      });
    return () => { alive = false; };
  }, []);

  // Saves land here so every view sees them without a refetch.
  const upsertLocal = (c) => setCoaches((prev) => [...prev.filter((p) => p.id !== c.id), c]);
  const removeLocal = (id) => setCoaches((prev) => prev.filter((p) => p.id !== id));

  const openPerson = (id) => { setSelectedId(id); setView("people"); };

  if (!coaches) return <div style={{ padding: "40px", textAlign: "center", fontWeight: 800, color: "#888" }}>Loading coach history…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        {VIEWS.map((v) => <button key={v.key} onClick={() => setView(v.key)} style={tabBtn(view === v.key)}>{v.label}</button>)}
        <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 800, color: "#888" }}>
          {coaches.length} people · {coaches.filter((c) => c.Status === "current").length} current
        </span>
      </div>
      {loadError && <div style={{ ...box, color: RED, fontWeight: 800 }}>Couldn't load coaches: {loadError}</div>}
      {view === "people" && (
        <PeoplePane coaches={coaches} selectedId={selectedId} setSelectedId={setSelectedId} upsertLocal={upsertLocal} removeLocal={removeLocal} />
      )}
      {view === "coverage" && <CoveragePane coaches={coaches} openPerson={openPerson} />}
      {view === "import" && <ImportPane coaches={coaches} upsertLocal={upsertLocal} openPerson={openPerson} />}
    </div>
  );
}

// ── People ──────────────────────────────────────────────────────────────

function PeoplePane({ coaches, selectedId, setSelectedId, upsertLocal, removeLocal }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState("");
  const [draft, setDraft] = useState(draftFrom(null));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const saved = (selectedId && selectedId !== "new" && coaches.find((c) => c.id === selectedId)) || null;
  useEffect(() => { setDraft(draftFrom(saved)); }, [selectedId, saved]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(saved));
  const { doc: clean, warnings } = useMemo(() => normalizeCoach({ ...draft, Slug: saved?.id }), [draft, saved]);

  const select = (id) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setSelectedId(id);
    setMessage("");
  };

  const save = async () => {
    if (!clean.Name) { setMessage("Failed: a name is required."); return; }
    // Existing people keep their doc id even if the name is edited; a new
    // person who shares a name with someone on file becomes name-1, name-2…
    // (also their /staff/ URL).
    const id = saved?.id || uniqueSlug(clean.Name, coaches.map((c) => c.id));
    setSaving(true);
    setMessage("");
    try {
      const now = new Date().toISOString();
      const data = { ...clean, Slug: id, createdAt: saved?.createdAt || now, updatedAt: now };
      await setDoc(doc(db, COLLECTION, id), data);
      upsertLocal({ id, ...data });
      setSelectedId(id);
      setMessage(`Saved ${clean.Name}${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}.`);
    } catch (e) {
      console.error("Coach save error:", e);
      setMessage(`Failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!saved || !window.confirm(`Delete ${saved.Name} and their whole history? This can't be undone. (Coaches who leave a job should be kept — just close their stint.)`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, COLLECTION, saved.id));
      removeLocal(saved.id);
      setSelectedId("new");
      setMessage(`Deleted ${saved.Name}.`);
    } catch (e) {
      console.error("Coach delete error:", e);
      setMessage(`Failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setStint = (i, patch) => setDraft((d) => ({ ...d, Stints: d.Stints.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const moveStint = (i, dir) => setDraft((d) => {
    const next = [...d.Stints];
    const j = i + dir;
    if (j < 0 || j >= next.length) return d;
    [next[i], next[j]] = [next[j], next[i]];
    return { ...d, Stints: next };
  });

  const q = search.trim().toLowerCase();
  const shown = [...coaches]
    .sort((a, b) => a.Name.localeCompare(b.Name))
    .filter((c) => status === "all" || c.Status === status)
    .filter((c) => !team || (c.Stints || []).some((s) => s.Team === team))
    .filter((c) => !role || (c.Stints || []).some((s) => s.Roles?.includes(role)))
    .filter((c) => !q || c.Name.toLowerCase().includes(q) || (c.Stints || []).some((s) => s.Org.toLowerCase().includes(q)));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) 1fr", gap: "14px", alignItems: "start" }}>
      {/* Person list */}
      <div style={{ ...box, padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <button
          onClick={() => select("new")}
          style={{
            padding: "9px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em",
            border: "2px dashed " + GOLD, borderRadius: "8px", cursor: "pointer",
            background: selectedId === "new" ? "#fff8e6" : "#fff", color: BLUE,
          }}
        >
          + New Person
        </button>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or org…" style={input} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={input}>
            <option value="all">All</option>
            <option value="current">Current</option>
            <option value="former">Former</option>
          </select>
          <select value={team} onChange={(e) => setTeam(e.target.value)} style={input} title="Ever worked for this NFL team">
            <option value="">Any team</option>
            {NFL_TEAM_ABBRS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={input} title="Ever held this role">
            <option value="">Any role</option>
            {ROLE_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {ROLES.filter((r) => r.group === g).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "72vh", overflowY: "auto" }}>
          {shown.map((c) => {
            const isSel = c.id === selectedId;
            return (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                style={{
                  textAlign: "left", padding: "8px 10px", borderRadius: "8px", cursor: "pointer",
                  border: `2px solid ${isSel ? BLUE : "#e5e7eb"}`, background: isSel ? "#eaf1ff" : "#fff",
                  display: "flex", flexDirection: "column", gap: "4px",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 900, color: "#111" }}>{c.Name}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                  <CurrentChips coach={c} />
                  <span style={{ fontSize: "10px", fontWeight: 800, color: "#999" }}>{(c.Stints || []).length} stints</span>
                </div>
              </button>
            );
          })}
          {!shown.length && <div style={{ padding: "20px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: "#aaa" }}>{coaches.length ? "No matches." : "No one yet — add a person or use Import."}</div>}
        </div>
      </div>

      {/* Editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
        <div style={{ ...box, display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "18px", fontWeight: 900, color: "#111" }}>{saved ? saved.Name : draft.Name || "New person"}</div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
              {saved ? `coaches/${saved.id}` : clean.Name ? `Will save as coaches/${uniqueSlug(clean.Name, coaches.map((c) => c.id))}` : "Not saved yet"}
              {saved?.updatedAt && ` · last saved ${new Date(saved.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`}
            </div>
          </div>
          <CurrentChips coach={clean} />
        </div>

        <div style={{ ...box, display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: "12px" }}>
          <div>
            <div style={labelStyle}>Name</div>
            <input value={draft.Name} onChange={(e) => setField("Name", e.target.value)} placeholder="e.g. Kevin O'Connell" style={input} />
          </div>
          <div>
            <div style={labelStyle}>Born (year)</div>
            <input value={draft.Born} onChange={(e) => setField("Born", e.target.value)} placeholder="1985" style={input} />
          </div>
          <div>
            <div style={labelStyle}>College</div>
            <input value={draft.College} onChange={(e) => setField("College", e.target.value)} placeholder="Alma mater" style={input} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={labelStyle}>Playing career</div>
            <input value={draft.PlayingCareer} onChange={(e) => setField("PlayingCareer", e.target.value)} placeholder="e.g. QB — San Diego State; NFL 2008–12 (NE, DET, NYJ, MIA, SD)" style={input} />
            <div style={hint}>Short note only — coaching and front-office jobs go in stints below.</div>
          </div>
        </div>

        <div style={{ ...box, display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ ...labelStyle, marginBottom: 0 }}>Career stints ({draft.Stints.length})</div>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#999" }}>Years are seasons. Saving sorts them by start.</span>
            <button onClick={() => setDraft((d) => ({ ...d, Stints: [...d.Stints, blankStint()] }))} style={{ ...smallBtn(BLUE, "#fff", BLUE), marginLeft: "auto" }}>+ Stint</button>
          </div>
          {draft.Stints.map((s, i) => (
            <StintRow
              key={i}
              stint={s}
              index={i}
              count={draft.Stints.length}
              onChange={(patch) => setStint(i, patch)}
              onMove={(dir) => moveStint(i, dir)}
              onRemove={() => setDraft((d) => ({ ...d, Stints: d.Stints.filter((_, j) => j !== i) }))}
            />
          ))}
          {!draft.Stints.length && <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: "#aaa" }}>No stints yet.</div>}
          <datalist id="coach-nfl-orgs">
            {NFL_ORG_NAMES.map((n) => <option key={n} value={n} />)}
          </datalist>
        </div>

        {clean.Stints.length > 0 && <Timeline stints={clean.Stints} />}

        <div style={{ ...box, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <div style={labelStyle}>Notes</div>
            <textarea value={draft.Notes} onChange={(e) => setField("Notes", e.target.value)} rows={3} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
          </div>
          <div>
            <div style={labelStyle}>Sources</div>
            <textarea value={draft.Sources} onChange={(e) => setField("Sources", e.target.value)} rows={3} placeholder="Team bio URL, Wikipedia, Pro Football Reference…" style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
          </div>
        </div>

        {warnings.length > 0 && (
          <div style={{ ...box, borderColor: AMBER, background: "#fffbea" }}>
            <div style={{ ...labelStyle, color: AMBER }}>Check before saving ({warnings.length})</div>
            <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", fontWeight: 700, color: "#7a5b00" }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={save}
            disabled={saving || !dirty}
            style={{
              padding: "10px 24px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.06em",
              border: "2px solid " + BLUE, borderRadius: "8px", cursor: saving ? "wait" : dirty ? "pointer" : "default",
              background: dirty && !saving ? BLUE : "#eee", color: dirty && !saving ? "#fff" : "#999",
            }}
          >
            {saving ? "Saving…" : saved ? "Save" : "Add Person"}
          </button>
          {dirty && !saving && <button onClick={() => setDraft(draftFrom(saved))} style={smallBtn("#fff", "#666", "#d1d5db")}>Revert</button>}
          {saved && <button onClick={remove} disabled={saving} style={{ ...smallBtn("#fff", RED, RED), marginLeft: "auto" }}>Delete</button>}
          {message && <span style={{ fontSize: "12px", fontWeight: 800, color: message.startsWith("Failed") ? RED : GREEN }}>{message}</span>}
        </div>
      </div>
    </div>
  );
}

function StintRow({ stint: s, index, count, onChange, onMove, onRemove }) {
  const open = s.EndYear === "" && !s.EndUnknown;
  const autoTeam = s.Level === "NFL" ? nflAbbrFromOrg(s.Org) : "";
  return (
    <div style={{ border: "1px solid #e5e7eb", borderLeft: `4px solid ${s.Level === "NFL" ? BLUE : s.Level === "College" ? GOLD : "#bbb"}`, borderRadius: "8px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px", background: "#fcfcfd" }}>
      <div style={{ display: "grid", gridTemplateColumns: "100px 2fr 80px 2fr", gap: "8px", alignItems: "end" }}>
        <div>
          <div style={labelStyle}>Level</div>
          <select value={s.Level} onChange={(e) => onChange({ Level: e.target.value, Team: e.target.value === "NFL" ? nflAbbrFromOrg(s.Org) : "" })} style={input}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <div style={labelStyle}>Organization (name at the time)</div>
          <input
            value={s.Org}
            list={s.Level === "NFL" ? "coach-nfl-orgs" : undefined}
            onChange={(e) => onChange({ Org: e.target.value, ...(s.Level === "NFL" ? { Team: nflAbbrFromOrg(e.target.value) } : {}) })}
            placeholder={s.Level === "NFL" ? "e.g. Oakland Raiders" : s.Level === "College" ? "e.g. Ohio State" : "e.g. Florida Tuskers (UFL)"}
            style={input}
          />
        </div>
        <div>
          <div style={labelStyle}>Team</div>
          {s.Level === "NFL" ? (
            <select value={s.Team} onChange={(e) => onChange({ Team: e.target.value })} style={{ ...input, borderColor: s.Team ? "#d1d5db" : AMBER }} title={autoTeam ? `Matched from org: ${autoTeam}` : "Pick the franchise"}>
              <option value="">—</option>
              {NFL_TEAM_ABBRS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          ) : (
            <input value="—" disabled style={{ ...input, color: "#bbb", background: "#f6f6f6" }} />
          )}
        </div>
        <div>
          <div style={labelStyle}>Title (as written)</div>
          <input value={s.Title} onChange={(e) => onChange({ Title: e.target.value })} placeholder="e.g. Passing Game Coordinator / QBs" style={input} />
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ ...labelStyle, marginBottom: 0 }}>Roles</div>
        {s.Roles.map((r) => (
          <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 900, color: ROLE_BY_KEY[r] ? BLUE : RED, background: ROLE_BY_KEY[r] ? "#eaf1ff" : "#fdecea", padding: "3px 6px", borderRadius: "5px" }}>
            {roleLabel(r)}
            <button onClick={() => onChange({ Roles: s.Roles.filter((x) => x !== r) })} style={{ border: "none", background: "none", cursor: "pointer", color: "#888", fontWeight: 900, padding: 0 }}>✕</button>
          </span>
        ))}
        <select value="" onChange={(e) => e.target.value && onChange({ Roles: [...s.Roles, e.target.value] })} style={{ ...input, width: "auto" }}>
          <option value="">+ add role…</option>
          {ROLE_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {ROLES.filter((r) => r.group === g && !s.Roles.includes(r.key)).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "80px 70px 80px 70px auto 1fr auto", gap: "8px", alignItems: "end" }}>
        <div>
          <div style={labelStyle}>Start</div>
          <input value={s.StartYear} onChange={(e) => onChange({ StartYear: e.target.value })} placeholder="Season" style={input} />
        </div>
        <div>
          <div style={labelStyle}>Mo.</div>
          <MonthSelect value={s.StartMonth} onChange={(v) => onChange({ StartMonth: v })} />
        </div>
        <div>
          <div style={labelStyle}>End</div>
          <input value={s.EndYear} disabled={s.EndUnknown} onChange={(e) => onChange({ EndYear: e.target.value })} placeholder={s.EndUnknown ? "?" : "present"} style={input} />
        </div>
        <div>
          <div style={labelStyle}>Mo.</div>
          <MonthSelect value={s.EndMonth} disabled={open} onChange={(v) => onChange({ EndMonth: v })} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", paddingBottom: "4px", whiteSpace: "nowrap" }}>
          <label style={{ fontSize: "10px", fontWeight: 800, color: "#888", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }} title="The job ended but the source doesn't say when">
            <input type="checkbox" checked={!!s.EndUnknown} onChange={(e) => onChange({ EndUnknown: e.target.checked, ...(e.target.checked ? { EndYear: "", EndMonth: "" } : {}) })} />
            End unknown
          </label>
          <span style={{ fontSize: "11px", fontWeight: 800, color: open ? GREEN : "#bbb" }}>{open ? "● Current" : ""}</span>
        </div>
        <div>
          <div style={labelStyle}>Notes</div>
          <input value={s.Notes} onChange={(e) => onChange({ Notes: e.target.value })} placeholder="e.g. interim, final 5 games" style={input} />
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button onClick={() => onMove(-1)} disabled={index === 0} style={smallBtn("#fff", "#666", "#d1d5db")} title="Move up">↑</button>
          <button onClick={() => onMove(1)} disabled={index === count - 1} style={smallBtn("#fff", "#666", "#d1d5db")} title="Move down">↓</button>
          <button onClick={onRemove} style={smallBtn("#fff", RED, RED)} title="Remove stint">✕</button>
        </div>
      </div>
    </div>
  );
}

function MonthSelect({ value, onChange, disabled }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={input}>
      <option value="">—</option>
      {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
    </select>
  );
}

// Read-only career summary, the way the saved doc will order it.
function Timeline({ stints }) {
  return (
    <div style={box}>
      <div style={labelStyle}>Career as saved</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {stints.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "130px 220px 1fr", gap: "10px", fontSize: "12px", fontWeight: 700, color: "#333", padding: "4px 0", borderBottom: "1px solid #f1f1f1" }}>
            <span style={{ color: isOpenStint(s) ? GREEN : "#666", fontWeight: 900 }}>{stintSpan(s)}</span>
            <span>{s.Org}{s.Team && s.Org !== NFL_TEAMS[s.Team] ? ` (${s.Team})` : ""}</span>
            <span>{s.Roles.map(roleLabel).join(" · ") || <em style={{ color: "#aaa" }}>no roles</em>}{s.Notes && <span style={{ color: "#999" }}> — {s.Notes}</span>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Coverage ────────────────────────────────────────────────────────────

function CoveragePane({ coaches, openPerson }) {
  // team → role → [coach]; interim HCs fill the HC column.
  const grid = useMemo(() => {
    const g = {};
    coaches.forEach((c) => (c.Current || []).forEach(({ Team, Role }) => {
      const col = Role === "IHC" ? "HC" : Role;
      ((g[Team] ||= {})[col] ||= []).push(c);
    }));
    return g;
  }, [coaches]);
  const filled = NFL_TEAM_ABBRS.reduce((n, t) => n + COVERAGE_ROLES.filter((r) => grid[t]?.[r]?.length).length, 0);
  const total = NFL_TEAM_ABBRS.length * COVERAGE_ROLES.length;

  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "10px" }}>
        <div style={{ ...labelStyle, marginBottom: 0 }}>Current staff on file</div>
        <span style={{ fontSize: "12px", fontWeight: 800, color: filled === total ? GREEN : "#888" }}>{filled} / {total} filled</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px", ...labelStyle }}>Team</th>
              {COVERAGE_ROLES.map((r) => <th key={r} style={{ textAlign: "left", padding: "6px", ...labelStyle }}>{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {NFL_TEAM_ABBRS.map((t) => (
              <tr key={t} style={{ borderTop: "1px solid #f1f1f1" }}>
                <td style={{ padding: "6px", fontWeight: 900, color: "#111", whiteSpace: "nowrap" }} title={NFL_TEAMS[t]}>{t}</td>
                {COVERAGE_ROLES.map((r) => {
                  const people = grid[t]?.[r] || [];
                  return (
                    <td key={r} style={{ padding: "4px 6px", background: people.length ? (people.length > 1 ? "#fffbea" : "transparent") : "#fafafa" }}>
                      {people.length ? people.map((c) => (
                        <button key={c.id} onClick={() => openPerson(c.id)} style={{ border: "none", background: "none", padding: "0 4px 0 0", cursor: "pointer", color: BLUE, fontWeight: 800, fontSize: "12px", textAlign: "left" }}>
                          {c.Name}
                        </button>
                      )) : <span style={{ color: "#ccc", fontWeight: 800 }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={hint}>Yellow cells have two people listed as current in the same job — usually one of them needs their stint closed.</div>
    </div>
  );
}

// ── Import ──────────────────────────────────────────────────────────────

const IMPORT_EXAMPLE = `[
  {
    "Name": "Jane Example",
    "Born": 1980,
    "College": "Example State",
    "PlayingCareer": "WR, Example State 1998–2001",
    "Stints": [
      { "Level": "College", "Org": "Example State", "Title": "Graduate Assistant", "Roles": ["GA"], "StartYear": 2003, "EndYear": 2004 },
      { "Level": "NFL", "Org": "San Diego Chargers", "Title": "Offensive Quality Control", "Roles": ["QC"], "StartYear": 2005, "EndYear": 2007 },
      { "Level": "NFL", "Org": "Oakland Raiders", "Title": "Wide Receivers Coach", "Roles": ["WR"], "StartYear": 2008, "EndYear": 2012 },
      { "Level": "NFL", "Org": "Minnesota Vikings", "Title": "Offensive Coordinator", "Roles": ["OC"], "StartYear": 2013, "StartMonth": 1 }
    ],
    "Sources": "https://…"
  }
]`;

function ImportPane({ coaches, upsertLocal, openPerson }) {
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState("");

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const raw = JSON.parse(text);
      const list = Array.isArray(raw) ? raw : [raw];
      return { rows: list.map((r) => ({ ...normalizeCoach(r), exists: coaches.find((c) => c.id === slugify(r?.Slug || r?.Name)) })) };
    } catch (e) {
      return { error: e.message };
    }
  }, [text, coaches]);

  const rows = parsed?.rows || [];
  const valid = rows.filter((r) => r.doc.Name);
  const overwrites = valid.filter((r) => r.exists).length;

  const write = async () => {
    if (!valid.length) return;
    if (overwrites && !window.confirm(`${overwrites} of these already exist and will be replaced with the imported version. Continue?`)) return;
    setWriting(true);
    setMessage("");
    let done = 0;
    try {
      const now = new Date().toISOString();
      for (const r of valid) {
        const data = { ...r.doc, createdAt: r.exists?.createdAt || now, updatedAt: now };
        await setDoc(doc(db, COLLECTION, r.doc.Slug), data);
        upsertLocal({ id: r.doc.Slug, ...data });
        done += 1;
      }
      setMessage(`Imported ${done} ${done === 1 ? "person" : "people"}.`);
      setText("");
    } catch (e) {
      console.error("Coach import error:", e);
      setMessage(`Failed after ${done}: ${e.message}`);
    } finally {
      setWriting(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", alignItems: "start" }}>
      <div style={{ ...box, display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={labelStyle}>Paste JSON — one person or an array</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={24}
          placeholder={IMPORT_EXAMPLE}
          spellCheck={false}
          style={{ ...input, fontFamily: "Consolas, Menlo, monospace", fontSize: "12px", resize: "vertical" }}
        />
        <div style={hint}>
          Role keys: {ROLES.map((r) => r.key).join(", ")}. NFL orgs can use their name at the time ("Oakland Raiders") — the team abbr is filled in.
          Leave EndYear out for a current job. A person whose slug already exists is replaced, not merged.
        </div>
      </div>

      <div style={{ ...box, display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={labelStyle}>Preview</div>
        {!parsed && <div style={{ fontSize: "12px", fontWeight: 800, color: "#aaa" }}>Nothing pasted yet.</div>}
        {parsed?.error && <div style={{ fontSize: "12px", fontWeight: 800, color: RED }}>Invalid JSON: {parsed.error}</div>}
        {rows.map((r, i) => (
          <div key={i} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", fontWeight: 900, color: r.doc.Name ? "#111" : RED }}>{r.doc.Name || "(no name — skipped)"}</span>
              <CurrentChips coach={r.doc} />
              <span style={{ fontSize: "10px", fontWeight: 800, color: "#999" }}>{r.doc.Stints.length} stints</span>
              {r.exists && (
                <button onClick={() => openPerson(r.exists.id)} style={{ ...smallBtn("#fffbea", AMBER, AMBER), marginLeft: "auto" }}>Replaces existing</button>
              )}
            </div>
            {r.warnings.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontSize: "11px", fontWeight: 700, color: "#7a5b00" }}>
                {r.warnings.map((w, j) => <li key={j}>{w}</li>)}
              </ul>
            )}
          </div>
        ))}
        {valid.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button onClick={write} disabled={writing} style={{ ...tabBtn(true), cursor: writing ? "wait" : "pointer" }}>
              {writing ? "Importing…" : `Import ${valid.length}`}
            </button>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#999" }}>
              {rows.reduce((n, r) => n + r.warnings.length, 0)} warnings — they don't block the import.
            </span>
          </div>
        )}
        {message && <span style={{ fontSize: "12px", fontWeight: 800, color: message.startsWith("Failed") ? RED : GREEN }}>{message}</span>}
      </div>
    </div>
  );
}
