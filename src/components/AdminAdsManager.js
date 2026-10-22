// src/components/AdminAdsManager.js
//
// Admin → Ads: editor for the Homage margin ads, one tab per league.
//
//   NFL  `ads/{abbr}` — read by components/MarginAds.js and PlayerProfile.js
//   CFB  `cfbAds/{schools doc id}` — same shape, plus School / CFBDTeamId
//
// Every ad doc holds:
//
//   Link      affiliate URL both rail cards click through to
//   Image1    left rail card's image (also the right card's fallback)
//   Image2/3  right rail card's gallery
//   Images    [Image1, Image2, Image3] mirror, kept in sync on save
//   Active    false pauses the ad without deleting it (missing = live)
//   updatedAt ISO string
//
// The Links tab is separate: `adLinks/{auto id}` — generic links not tied
// to any team (Name, Link, DisplayText, Description, createdAt/updatedAt).
// Storage only for now; nothing on the site reads them yet.
//
// Readers go through a compSnapshots doc first (NFL: _ads, see
// utils/siteSnapshots.js fetchAds), which otherwise only refreshes with the
// weekly job — so every save here also rewrites the league's snapshot from
// the full list already loaded, and the change is live on the next page load.
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { COMP_SNAPSHOT_VERSION } from "../utils/historicalStats";
import { copyImageToClipboard } from "../utils/clipboardImage";
import { NFL_TEAM_ABBRS, teamNameFromAbbr, sanitizeUrl } from "./MarginAds";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const RED = "#c0392b";
const GREEN = "#2e9e4f";
const AMBER = "#e0a100";

// Native size of the Homage product shots every card crops to.
const AD_ASPECT = 1600 / 1920;

const IMAGE_FIELDS = [
  { key: "Image1", label: "Image 1", hint: "Left rail card — required. Also the right card's fallback when 2 and 3 are empty." },
  { key: "Image2", label: "Image 2", hint: "Right rail card, top." },
  { key: "Image3", label: "Image 3", hint: "Right rail card, bottom." },
];

// Each league's team list comes back as { id, name, short, color1, logo,
// fcs?, ...identity } — `id` is the ad doc id, `identity` the fields that
// tie a saved ad back to its team.
const LEAGUES = {
  nfl: {
    label: "NFL",
    collection: "ads",
    snapshotId: "_ads",
    // Same extra the weekly builder puts on _ads (snapshotBuilders.js).
    snapshotExtras: (teams) => ({ teamLogos: Object.fromEntries(teams.filter((t) => t.logo).map((t) => [t.id, t.logo])) }),
    loadTeams: async () => {
      const snap = await getDocs(collection(db, "nfl"));
      const byAbbr = {};
      snap.docs.forEach((d) => { byAbbr[d.id] = d.data(); });
      return NFL_TEAM_ABBRS.map((abbr) => ({
        id: abbr,
        name: teamNameFromAbbr(abbr),
        short: abbr,
        color1: byAbbr[abbr]?.Color1 || BLUE,
        logo: byAbbr[abbr]?.Logo1 || byAbbr[abbr]?.LogoDark || "",
        identity: { Team: abbr },
      }));
    },
  },
  cfb: {
    label: "CFB",
    collection: "cfbAds",
    snapshotId: "_cfbAds",
    loadTeams: async () => {
      const snap = await getDocs(collection(db, "schools"));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.School)
        .map((s) => ({
          id: s.id,
          name: s.School,
          short: s.Short || s.School,
          color1: s.Color1 || BLUE,
          logo: s.Logo1 || s.Logo2 || "",
          fcs: s.FCS === true,
          identity: { School: s.School, CFBDTeamId: s.CFBDTeamId ?? null },
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  },
};

const LEAGUE_TABS = [...Object.entries(LEAGUES).map(([key, cfg]) => ({ key, label: cfg.label })), { key: "links", label: "Links" }];

function adStatus(ad) {
  if (!ad) return { key: "none", label: "No ad", color: "#ccc" };
  if (!ad.Link || !ad.Image1) return { key: "incomplete", label: "Incomplete", color: AMBER };
  if (ad.Active === false) return { key: "paused", label: "Paused", color: "#999" };
  return { key: "live", label: "Live", color: GREEN };
}

// Same filter every reader applies (utils/snapshotBuilders.js, fetchAds).
const isLiveAd = (a) => a.Active !== false && a.Link && a.Image1;

function draftFrom(ad) {
  return {
    Link: ad?.Link || "",
    Image1: ad?.Image1 || "",
    Image2: ad?.Image2 || "",
    Image3: ad?.Image3 || "",
    Active: ad?.Active !== false,
  };
}

function smallBtn(bg, color, border) {
  return {
    padding: "6px 10px", fontSize: "11px", fontWeight: 900, borderRadius: "6px", cursor: "pointer",
    background: bg, color, border: `1px solid ${border}`, textTransform: "uppercase", letterSpacing: "0.04em",
    whiteSpace: "nowrap",
  };
}

// Copy the image's pixels; if the host blocks that (no CORS), fall back to
// copying its URL so the click still does something useful.
function CopyImageButton({ url }) {
  const [status, setStatus] = useState("idle");
  const copy = () => {
    if (!url) return;
    setStatus("copying");
    copyImageToClipboard(url)
      .then(() => setStatus("copied"))
      .catch((e) => {
        console.error("Copy image to clipboard failed:", e);
        return navigator.clipboard.writeText(url).then(() => setStatus("link"), () => setStatus("failed"));
      })
      .finally(() => setTimeout(() => setStatus("idle"), 2400));
  };
  const label = { idle: "Copy", copying: "Copying…", copied: "Copied ✓", link: "Link copied", failed: "Failed" }[status];
  const accent = status === "copied" ? GREEN : status === "failed" ? RED : status === "link" ? AMBER : null;
  return (
    <button
      onClick={copy}
      disabled={!url || status === "copying"}
      title={status === "link" ? "The image host blocked copying the image itself — its URL was copied instead. Right-click the preview → Copy image." : "Copy image to clipboard"}
      style={{ ...smallBtn(accent || "#fff", accent ? "#fff" : url ? BLUE : "#bbb", accent || (url ? BLUE : "#e5e7eb")), minWidth: "84px", cursor: url ? "pointer" : "default" }}
    >
      {label}
    </button>
  );
}

// URL field + live preview. Reports whether the image actually loads and
// flags anything sanitizeUrl can't turn into a direct image (Imgur albums)
// or that won't crop cleanly into the 1600×1920 card.
function ImageField({ field, value, onChange }) {
  const resolved = value.trim() ? sanitizeUrl(value) : "";
  const [state, setState] = useState({ url: "", status: "idle", w: 0, h: 0 });
  const current = state.url === resolved ? state : { url: resolved, status: resolved ? "loading" : "idle", w: 0, h: 0 };
  const isAlbum = /imgur\.com\/(a|gallery)\//i.test(value);

  let note = null;
  if (isAlbum) note = { color: RED, text: "Imgur album/gallery links can't be shown — open the album and copy a single image's link." };
  else if (current.status === "error") note = { color: RED, text: "Image didn't load — check the URL." };
  else if (current.status === "ok") {
    const ratio = current.w / current.h;
    const off = Math.abs(ratio - AD_ASPECT) / AD_ASPECT > 0.04;
    note = off
      ? { color: AMBER, text: `${current.w}×${current.h} — not 1600×1920 proportions, edges will be cropped.` }
      : { color: GREEN, text: `${current.w}×${current.h}` };
  }

  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
      <div style={{
        width: "90px", flexShrink: 0, aspectRatio: "1600 / 1920", borderRadius: "8px", overflow: "hidden",
        border: "1px solid #e5e7eb", background: "#f6f6f6", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {resolved && !isAlbum ? (
          <img
            key={resolved}
            src={resolved}
            alt=""
            referrerPolicy="no-referrer"
            onLoad={(e) => setState({ url: resolved, status: "ok", w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setState({ url: resolved, status: "error", w: 0, h: 0 })}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: current.status === "error" ? "none" : "block" }}
          />
        ) : (
          <span style={{ fontSize: "10px", fontWeight: 800, color: "#bbb", textTransform: "uppercase" }}>Empty</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", marginBottom: "4px" }}>
          {field.label}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://i.imgur.com/xxxx.png"
            style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "13px" }}
          />
          <CopyImageButton url={current.status === "error" || isAlbum ? "" : resolved} />
          {value && (
            <button onClick={() => onChange("")} title="Clear" style={smallBtn("#fff", "#888", "#d1d5db")}>✕</button>
          )}
        </div>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#999", marginTop: "4px" }}>{field.hint}</div>
        {note && <div style={{ fontSize: "11px", fontWeight: 800, color: note.color, marginTop: "4px" }}>{note.text}</div>}
      </div>
    </div>
  );
}

// Miniature of the two rail cards as MarginAds.js lays them out — just the
// image arrangement and team colors, not the full card chrome.
function RailPreview({ team, draft }) {
  const c1 = team.color1;
  const gallery = [draft.Image2, draft.Image3].filter((u) => u.trim());
  const right = gallery.length ? gallery : draft.Image1.trim() ? [draft.Image1] : [];
  const img = (u, i) => (
    <img key={i} src={sanitizeUrl(u)} alt="" referrerPolicy="no-referrer"
      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
      style={{ width: "100%", display: "block", aspectRatio: "1600 / 1920", objectFit: "cover", background: "#fafafa" }} />
  );
  const card = (title, children, border, headBg, headColor) => (
    <div style={{ width: "120px" }}>
      <div style={{ fontSize: "9px", fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "center", marginBottom: "4px" }}>{title}</div>
      <div style={{ borderRadius: "10px", overflow: "hidden", border, background: "#fff", boxShadow: "0 3px 12px rgba(0,0,0,0.08)" }}>
        <div style={{ padding: "6px", background: headBg, color: headColor, fontSize: "9px", fontWeight: 900, textAlign: "center", textTransform: "uppercase" }}>
          {team.name}
        </div>
        {children}
        <div style={{ padding: "6px", textAlign: "center" }}>
          <span style={{ display: "inline-block", fontSize: "8px", fontWeight: 900, color: "#fff", background: headBg === "#fff" ? "#c8102e" : c1, padding: "4px 10px", borderRadius: "12px" }}>SHOP NOW →</span>
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
      {card("Left rail", draft.Image1.trim() ? img(draft.Image1, 0) : <Placeholder />, "1px solid #eee", "#fff", "#c8102e")}
      {card("Right rail", right.length ? <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>{right.map(img)}</div> : <Placeholder />, `2px solid ${c1}`, c1, "#fff")}
    </div>
  );
}

function Placeholder() {
  return <div style={{ aspectRatio: "1600 / 1920", background: "#f3f3f3" }} />;
}

export default function AdminAdsManager() {
  const [league, setLeague] = useState("nfl");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        {LEAGUE_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setLeague(key)}
            style={{
              padding: "9px 22px", fontWeight: 900, fontSize: "13px",
              textTransform: "uppercase", letterSpacing: "0.06em",
              border: "2px solid " + BLUE, borderRadius: "8px", cursor: "pointer",
              background: league === key ? BLUE : "#fff",
              color: league === key ? "#fff" : BLUE,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {/* key={league} remounts so nothing carries across collections. */}
      {league === "links" ? <GenericLinksPane /> : <LeagueAdsPane key={league} league={league} />}
    </div>
  );
}

const LINKS_COLLECTION = "adLinks";

function linkDraftFrom(link) {
  return {
    Name: link?.Name || "",
    Link: link?.Link || "",
    DisplayText: link?.DisplayText || "",
    Description: link?.Description || "",
  };
}

// Generic links — a flat, admin-named list not tied to any team. "new" is
// the selection id for an unsaved link.
function GenericLinksPane() {
  const [links, setLinks] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(linkDraftFrom(null));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    getDocs(collection(db, LINKS_COLLECTION))
      .then((snap) => {
        if (!alive) return;
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLinks(list);
        setSelectedId(list.length ? [...list].sort((a, b) => (a.Name || "").localeCompare(b.Name || ""))[0].id : "new");
      })
      .catch((e) => {
        console.error("Links load error:", e);
        if (alive) { setLoadError(e.message); setLinks([]); setSelectedId("new"); }
      });
    return () => { alive = false; };
  }, []);

  const saved = (selectedId && selectedId !== "new" && links?.find((l) => l.id === selectedId)) || null;
  useEffect(() => { setDraft(linkDraftFrom(saved)); }, [selectedId, saved]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(linkDraftFrom(saved));

  const select = (id) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("Discard unsaved changes to this link?")) return;
    setSelectedId(id);
    setMessage("");
  };

  const save = async () => {
    const clean = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()]));
    if (!clean.Name || !clean.Link) { setMessage("Failed: a name and URL are required."); return; }
    setSaving(true);
    setMessage("");
    try {
      const now = new Date().toISOString();
      if (saved) {
        const data = { ...clean, createdAt: saved.createdAt || now, updatedAt: now };
        await setDoc(doc(db, LINKS_COLLECTION, saved.id), data);
        setLinks((prev) => prev.map((l) => (l.id === saved.id ? { id: saved.id, ...data } : l)));
      } else {
        const data = { ...clean, createdAt: now, updatedAt: now };
        const ref = await addDoc(collection(db, LINKS_COLLECTION), data);
        setLinks((prev) => [...prev, { id: ref.id, ...data }]);
        setSelectedId(ref.id);
      }
      setMessage(`Saved ${clean.Name}.`);
    } catch (e) {
      console.error("Link save error:", e);
      setMessage(`Failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!saved || !window.confirm(`Delete "${saved.Name}"? This can't be undone.`)) return;
    setSaving(true);
    setMessage("");
    try {
      await deleteDoc(doc(db, LINKS_COLLECTION, saved.id));
      setLinks((prev) => prev.filter((l) => l.id !== saved.id));
      setSelectedId("new");
      setMessage(`Deleted ${saved.Name}.`);
    } catch (e) {
      console.error("Link delete error:", e);
      setMessage(`Failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!links) return <div style={{ padding: "40px", textAlign: "center", fontWeight: 800, color: "#888" }}>Loading links…</div>;

  const box = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px" };
  const label = { fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", marginBottom: "4px" };
  const hint = { fontSize: "11px", fontWeight: 700, color: "#999", marginTop: "4px" };
  const input = { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "13px" };
  const q = search.trim().toLowerCase();
  const shown = [...links]
    .sort((a, b) => (a.Name || "").localeCompare(b.Name || ""))
    .filter((l) => !q || [l.Name, l.Link, l.DisplayText, l.Description].some((v) => (v || "").toLowerCase().includes(q)));
  const linkUrl = draft.Link.trim() ? sanitizeUrl(draft.Link) : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {loadError && <div style={{ ...box, color: RED, fontWeight: 800 }}>Couldn't load links: {loadError}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: "14px", alignItems: "start" }}>
        {/* Link list */}
        <div style={{ ...box, padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={() => select("new")}
            style={{
              padding: "9px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em",
              border: "2px dashed " + GOLD, borderRadius: "8px", cursor: "pointer",
              background: selectedId === "new" ? "#fff8e6" : "#fff", color: BLUE,
            }}
          >
            + New Link
          </button>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${links.length} links…`} style={input} />
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "72vh", overflowY: "auto" }}>
            {shown.map((l) => {
              const isSel = l.id === selectedId;
              return (
                <button
                  key={l.id}
                  onClick={() => select(l.id)}
                  style={{
                    textAlign: "left", padding: "8px 10px", borderRadius: "8px", cursor: "pointer",
                    border: `2px solid ${isSel ? BLUE : "#e5e7eb"}`, background: isSel ? "#eaf1ff" : "#fff",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 900, color: "#111" }}>{l.Name || "Untitled"}</div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.Link}</div>
                </button>
              );
            })}
            {!shown.length && <div style={{ padding: "20px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: "#aaa" }}>{links.length ? "No matches." : "No links yet."}</div>}
          </div>
        </div>

        {/* Editor */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
          <div style={box}>
            <div style={{ fontSize: "18px", fontWeight: 900, color: "#111" }}>{saved ? saved.Name || "Untitled" : "New link"}</div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
              {saved?.updatedAt ? `Last saved ${new Date(saved.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not saved yet"}
            </div>
          </div>

          <div style={{ ...box, display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <div style={label}>Name</div>
              <input value={draft.Name} onChange={(e) => setDraft((d) => ({ ...d, Name: e.target.value }))} placeholder="e.g. Fanatics — Jerseys" style={input} />
              <div style={hint}>Admin-side label for finding this link. Required.</div>
            </div>
            <div>
              <div style={label}>URL</div>
              <div style={{ display: "flex", gap: "6px" }}>
                <input value={draft.Link} onChange={(e) => setDraft((d) => ({ ...d, Link: e.target.value }))} placeholder="https://…" style={{ ...input, flex: 1, minWidth: 0 }} />
                <a href={linkUrl || undefined} target="_blank" rel="noopener noreferrer"
                  style={{ ...smallBtn("#fff", linkUrl ? BLUE : "#bbb", linkUrl ? BLUE : "#e5e7eb"), textDecoration: "none", display: "flex", alignItems: "center", pointerEvents: linkUrl ? "auto" : "none" }}>
                  Test ↗
                </a>
              </div>
              <div style={hint}>Required.</div>
            </div>
            <div>
              <div style={label}>Display text</div>
              <input value={draft.DisplayText} onChange={(e) => setDraft((d) => ({ ...d, DisplayText: e.target.value }))} placeholder="e.g. Shop NFL jerseys →" style={input} />
              <div style={hint}>What the link would say if it's shown on the site.</div>
            </div>
            <div>
              <div style={label}>Description</div>
              <textarea value={draft.Description} onChange={(e) => setDraft((d) => ({ ...d, Description: e.target.value }))} rows={4} placeholder="What it is, commission terms, where it could go…" style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
            </div>
          </div>

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
              {saving ? "Saving…" : saved ? "Save" : "Add Link"}
            </button>
            {dirty && !saving && (
              <button onClick={() => setDraft(linkDraftFrom(saved))} style={smallBtn("#fff", "#666", "#d1d5db")}>Revert</button>
            )}
            {saved && (
              <button onClick={remove} disabled={saving} style={{ ...smallBtn("#fff", RED, RED), marginLeft: "auto" }}>Delete</button>
            )}
            {message && (
              <span style={{ fontSize: "12px", fontWeight: 800, color: message.startsWith("Failed") ? RED : GREEN }}>{message}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LeagueAdsPane({ league }) {
  const cfg = LEAGUES[league];
  const [teams, setTeams] = useState(null);
  const [ads, setAds] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(draftFrom(null));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [hideFcs, setHideFcs] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getDocs(collection(db, cfg.collection)), cfg.loadTeams()])
      .then(([adSnap, teamList]) => {
        if (!alive) return;
        const byId = {};
        adSnap.docs.forEach((d) => { byId[d.id] = { ...d.data() }; });
        setAds(byId);
        setTeams(teamList);
        // Start on the first team that has an ad, if any.
        setSelectedId((teamList.find((t) => byId[t.id]) || teamList[0])?.id || null);
      })
      .catch((e) => {
        console.error("Ads load error:", e);
        if (alive) { setLoadError(e.message); setAds({}); setTeams([]); }
      });
    return () => { alive = false; };
  }, [cfg]);

  const team = teams?.find((t) => t.id === selectedId) || null;
  const saved = (selectedId && ads?.[selectedId]) || null;
  useEffect(() => { setDraft(draftFrom(saved)); setMessage(""); }, [selectedId, saved]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(saved));

  const pool = useMemo(() => (teams || []).filter((t) => !(hideFcs && t.fcs) || ads?.[t.id]), [teams, ads, hideFcs]);
  const counts = useMemo(() => {
    const c = { live: 0, paused: 0, incomplete: 0, none: 0 };
    pool.forEach((t) => { c[adStatus(ads?.[t.id]).key] += 1; });
    return c;
  }, [pool, ads]);

  const selectTeam = (id) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm(`Discard unsaved changes to ${team?.name}?`)) return;
    setSelectedId(id);
  };

  const save = async () => {
    if (!team) return;
    const clean = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
    if (clean.Active && (!clean.Link || !clean.Image1)) {
      if (!window.confirm("A link and Image 1 are required for this ad to show. Save it anyway (it'll stay hidden)?")) return;
    }
    setSaving(true);
    setMessage("");
    try {
      const data = {
        ...clean,
        ...team.identity,
        Images: [clean.Image1, clean.Image2, clean.Image3].filter(Boolean),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, cfg.collection, team.id), data);
      const next = { ...ads, [team.id]: data };
      setAds(next);

      // Same doc shape the weekly builder writes (snapshotBuilders.js _ads).
      const rows = teams.map((t) => next[t.id]).filter((a) => a && isLiveAd(a));
      await setDoc(doc(db, "compSnapshots", cfg.snapshotId), {
        version: COMP_SNAPSHOT_VERSION, rows, ...(cfg.snapshotExtras?.(teams) || {}), builtAt: serverTimestamp(), builtBy: "admin",
      });
      setMessage(`Saved ${team.name} — published (${rows.length} active ${cfg.label} ads).`);
    } catch (e) {
      console.error("Ad save error:", e);
      setMessage(`Failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!teams || !ads) return <div style={{ padding: "40px", textAlign: "center", fontWeight: 800, color: "#888" }}>Loading ads…</div>;

  const box = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "16px" };
  const q = search.trim().toLowerCase();
  const shown = pool.filter((t) =>
    (filter === "all" || adStatus(ads[t.id]).key === filter) &&
    (!q || t.name.toLowerCase().includes(q) || t.short.toLowerCase().includes(q)));
  const linkUrl = draft.Link.trim() ? sanitizeUrl(draft.Link) : "";
  const filters = [
    { key: "all", label: `All ${pool.length}` },
    { key: "live", label: `Live ${counts.live}` },
    { key: "paused", label: `Paused ${counts.paused}` },
    { key: "incomplete", label: `Incomplete ${counts.incomplete}` },
    ...(counts.none ? [{ key: "none", label: `No ad ${counts.none}` }] : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {loadError && <div style={{ ...box, color: RED, fontWeight: 800 }}>Couldn't load ads: {loadError}</div>}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: "7px 16px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em",
              border: "2px solid " + GOLD, borderRadius: "8px", cursor: "pointer",
              background: filter === f.key ? GOLD : "#fff", color: filter === f.key ? "#fff" : GOLD,
            }}
          >
            {f.label}
          </button>
        ))}
        {league === "cfb" && (
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#666", cursor: "pointer" }}>
            <input type="checkbox" checked={hideFcs} onChange={(e) => setHideFcs(e.target.checked)} />
            Hide FCS
          </label>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: "14px", alignItems: "start" }}>
        {/* Team grid */}
        <div style={{ ...box, padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${cfg.label} teams…`}
            style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "13px" }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", maxHeight: "72vh", overflowY: "auto", paddingRight: "2px" }}>
            {shown.map((t) => {
              const ad = ads[t.id];
              const st = adStatus(ad);
              const isSel = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  onClick={() => selectTeam(t.id)}
                  title={`${t.name} — ${st.label}`}
                  style={{
                    position: "relative", padding: 0, borderRadius: "8px", overflow: "hidden", cursor: "pointer",
                    border: `2px solid ${isSel ? BLUE : "#e5e7eb"}`, background: "#fff",
                    boxShadow: isSel ? "0 0 0 2px #cfe0ff" : "none",
                  }}
                >
                  <div style={{ aspectRatio: "1600 / 1920", background: "#f3f3f3", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {ad?.Image1 ? (
                      <img src={sanitizeUrl(ad.Image1)} alt="" loading="lazy" referrerPolicy="no-referrer"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: st.key === "live" ? 1 : 0.45 }} />
                    ) : t.logo ? (
                      <img src={sanitizeUrl(t.logo)} alt="" loading="lazy" referrerPolicy="no-referrer"
                        style={{ width: "60%", height: "60%", objectFit: "contain", opacity: 0.35 }} />
                    ) : null}
                  </div>
                  <div style={{ background: t.color1, color: "#fff", fontSize: "9px", fontWeight: 900, padding: "3px 2px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.short}
                  </div>
                  <span style={{ position: "absolute", top: "4px", right: "4px", width: "9px", height: "9px", borderRadius: "50%", background: st.color, border: "1.5px solid #fff" }} />
                </button>
              );
            })}
            {!shown.length && <div style={{ gridColumn: "1 / -1", padding: "20px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: "#aaa" }}>No teams here.</div>}
          </div>
        </div>

        {/* Editor */}
        {team ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
            <div style={{ ...box, display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              {team.logo && (
                <img src={sanitizeUrl(team.logo)} alt="" referrerPolicy="no-referrer" style={{ width: "40px", height: "40px", objectFit: "contain" }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "18px", fontWeight: 900, color: "#111" }}>{team.name}</div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>
                  {saved?.updatedAt ? `Last saved ${new Date(saved.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : "No ad saved yet"}
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: draft.Active ? GREEN : "#999", cursor: "pointer" }}>
                <input type="checkbox" checked={draft.Active} onChange={(e) => setDraft((d) => ({ ...d, Active: e.target.checked }))} />
                {draft.Active ? "Active" : "Paused"}
              </label>
            </div>

            <div style={box}>
              <div style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", marginBottom: "4px" }}>
                Affiliate link
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  value={draft.Link}
                  onChange={(e) => setDraft((d) => ({ ...d, Link: e.target.value }))}
                  placeholder="https://homage.sjv.io/xxxxxx"
                  style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "13px" }}
                />
                <a href={linkUrl || undefined} target="_blank" rel="noopener noreferrer"
                  style={{ ...smallBtn("#fff", linkUrl ? BLUE : "#bbb", linkUrl ? BLUE : "#e5e7eb"), textDecoration: "none", display: "flex", alignItems: "center", pointerEvents: linkUrl ? "auto" : "none" }}>
                  Test ↗
                </a>
              </div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#999", marginTop: "4px" }}>Both rail cards and the Shop Now buttons click through here.</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "14px", alignItems: "start" }}>
              <div style={{ ...box, display: "flex", flexDirection: "column", gap: "16px" }}>
                {IMAGE_FIELDS.map((f) => (
                  <ImageField key={f.key} field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                ))}
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#999" }}>
                  Imgur page links (imgur.com/xxxx) and Google Drive file links are converted to direct images automatically.
                </div>
              </div>
              <div style={box}>
                <div style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", marginBottom: "10px" }}>Preview</div>
                <RailPreview team={team} draft={draft} />
              </div>
            </div>

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
                {saving ? "Saving…" : "Save & Publish"}
              </button>
              {dirty && !saving && (
                <button onClick={() => setDraft(draftFrom(saved))} style={smallBtn("#fff", "#666", "#d1d5db")}>Revert</button>
              )}
              {message && (
                <span style={{ fontSize: "12px", fontWeight: 800, color: message.startsWith("Failed") ? RED : GREEN }}>{message}</span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ ...box, textAlign: "center", fontWeight: 800, color: "#aaa" }}>Pick a team.</div>
        )}
      </div>
    </div>
  );
}
