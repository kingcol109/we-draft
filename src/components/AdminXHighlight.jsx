// src/components/AdminXHighlight.jsx
//
// Admin → Content → X Posts, post type "Player highlight": a player's cut-up
// for X. Pick a player and his outline fills in (utils/youtube/wedraftOutline.js:
// the We-Draft frame round the video, 1920×1080, his career table, his number,
// the window transparent for Premiere), and the post's text is written for it
// (videoText.js xCutupText). The Composer (AdminX.jsx) saves, schedules and
// marks it posted like any X post. The video itself is attached on X by hand.
//
// HighlightSection keeps its own controls and reports up through onUpdate:
// { state (what's saved on the post as highlight), svg (the outline), previewHref
// (the outline with its window filled, for the preview and the thumbnail),
// text (the suggested post), playerId, name }.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { BLUE, field, label, btn, linkBtn, fileName, envFor, downloadSvg, useSvgUrls } from "./SocialMakerKit";
import { outlineTable, loadCutupPlayer } from "../utils/youtube/cutupPlayer";
import { xCutupText, statLineOf } from "../utils/youtube/videoText";
import { WD_W, WD_H, wdOutline, wdOutlineImageUrls } from "../utils/youtube/wedraftOutline";
import WdLogo from "../assets/Logo2.png";

const CTA = "Evaluate on We-Draft.com";
const HANDLE = "@wedraftsite";
export const BLANK_HIGHLIGHT = { playerId: "", first: "", last: "", sub: "", cat: "", avg: false, live: "", games: 0, number: "", cta: CTA, series: "", handle: HANDLE };

export function HighlightSection({ initial, onUpdate, setMsg }) {
  const [h, setH] = useState(() => ({ ...BLANK_HIGHLIGHT, ...(initial || {}) }));
  const set = (patch) => setH((x) => ({ ...x, ...patch }));
  const [c, setC] = useState(null); // loadCutupPlayer's
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [setMsg]);

  // restore: a saved highlight's player — his data again, its own settings kept.
  const pick = async (pl, restore = false) => {
    setSearch("");
    setBusy(true);
    try {
      const got = await loadCutupPlayer(pl);
      setC(got);
      if (!restore) {
        setH((x) => ({ ...BLANK_HIGHLIGHT, cta: x.cta, handle: x.handle, playerId: pl.id, first: pl.First, last: pl.Last, sub: got.sub, cat: got.groups[0] || "", live: got.season, games: got.games, number: got.jersey }));
      }
      if (got.problem) setMsg(got.problem);
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!initial?.playerId) return;
    getDoc(doc(db, "players", initial.playerId)).then((d) => { if (d.exists()) pick({ id: d.id, ...d.data() }, true); })
      .catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useMemo(() => (c?.espn && h.cat ? outlineTable(c.espn, h.cat, c.player.Position, { avg: h.avg, live: h.live }) : null), [c, h.cat, h.avg, h.live]);
  const season = h.live || table?.rows?.[table.rows.length - 1]?.year || "";
  const series = h.series || (season ? `${season} Season Cut-Up` : "Season Cut-Up");
  const games = Number(h.games) || 0;
  const input = useMemo(() => (c ? {
    first: h.first, last: h.last, sub: h.sub, table, games, number: h.number, logo: c.logo, cta: h.cta, series, handle: h.handle, brandLogo: WdLogo,
  } : null), [c, h.first, h.last, h.sub, table, games, h.number, h.cta, series, h.handle]);

  const [svgs, setSvgs] = useState([]);
  useEffect(() => {
    if (!input) { setSvgs([]); return undefined; }
    let live = true;
    envFor(input, {}, wdOutlineImageUrls(input)).then((env) => {
      if (live) setSvgs([wdOutline(input, env), wdOutline({ ...input, fillWindow: true }, env)]);
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input, setMsg]);
  const [outlineHref, previewHref] = useSvgUrls(svgs);

  const text = useMemo(() => (c ? xCutupText({
    first: h.first, last: h.last, position: c.player.Position, school: c.player.School, slug: c.player.Slug,
    season, statLine: statLineOf(table, season), games: h.live && h.live === season ? games : 0,
  }) : ""), [c, h.first, h.last, h.live, season, table, games]);

  useEffect(() => {
    onUpdate(c ? { state: h, svg: svgs[0] || "", previewHref: previewHref || "", text, playerId: h.playerId, name: `${h.first} ${h.last} · Highlight`.trim() } : null);
  }, [c, h, svgs, previewHref, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase();
  const hits = q && players ? players.filter((x) => `${x.First} ${x.Last}`.toLowerCase().includes(q)).slice(0, 10) : [];
  const download = () => downloadSvg(svgs[0], fileName(`wedraft-x-highlight-${h.first}-${h.last}`) || "wedraft-x-highlight", WD_W, WD_H).catch((e) => setMsg(`Couldn't export: ${e.message}`));

  return (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ ...label, marginBottom: 0 }}>Player highlight · the video&apos;s outline ({WD_W}×{WD_H})</div>
      <div style={{ position: "relative" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} data-x-hl-player style={field}
          placeholder={players ? (c ? `${c.player.First} ${c.player.Last} — search another…` : "Search a prospect…") : "Loading players…"} />
        {hits.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "220px", overflowY: "auto" }}>
            {hits.map((p) => (
              <button key={p.id} onClick={() => pick(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {busy && <div style={{ fontSize: "11px", fontWeight: 800, color: BLUE }}>Loading his stats…</div>}
      {c && (
        <>
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1 }}><div style={label}>First</div><input style={field} value={h.first} onChange={(e) => set({ first: e.target.value })} /></div>
            <div style={{ flex: 1 }}><div style={label}>Last</div><input style={field} value={h.last} onChange={(e) => set({ last: e.target.value })} /></div>
          </div>
          <div><div style={label}>Under his name</div><input style={field} value={h.sub} onChange={(e) => set({ sub: e.target.value })} /></div>
          {c.groups.length > 1 && (
            <div>
              <div style={label}>Stats table</div>
              <select style={field} value={h.cat} onChange={(e) => set({ cat: e.target.value })}>
                {c.groups.map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
              </select>
            </div>
          )}
          {table && (
            <>
              <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
                <input type="checkbox" checked={h.avg} onChange={(e) => set({ avg: e.target.checked })} /> Show the AVG column
              </label>
              <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <div style={label}>Season in progress (starred)</div>
                  <select style={field} value={h.live} onChange={(e) => set({ live: e.target.value })}>
                    <option value="">None</option>
                    {table.rows.map((r) => <option key={r.year} value={r.year}>{r.year}</option>)}
                  </select>
                </div>
                {h.live && <div style={{ width: "80px" }}><div style={label}>Games</div><input type="number" min={0} style={field} value={h.games} onChange={(e) => set({ games: e.target.value })} /></div>}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ width: "90px" }}><div style={label}>Jersey #</div><input style={field} value={h.number} onChange={(e) => set({ number: e.target.value })} placeholder="18" /></div>
            <div style={{ flex: 1 }}><div style={label}>Gold pill</div><input style={field} value={h.series} onChange={(e) => set({ series: e.target.value })} placeholder={series} /></div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1 }}><div style={label}>Bottom line</div><input style={field} value={h.cta} onChange={(e) => set({ cta: e.target.value })} /></div>
            <div style={{ width: "130px" }}><div style={label}>Handle</div><input style={field} value={h.handle} onChange={(e) => set({ handle: e.target.value })} /></div>
          </div>
          {outlineHref && (
            <div style={{ background: "repeating-conic-gradient(#d9dee6 0% 25%, #fff 0% 50%) 50% / 16px 16px", borderRadius: "6px", border: "1px solid #d5dce6", overflow: "hidden" }}>
              <img src={outlineHref} alt="The outline" style={{ width: "100%", display: "block" }} />
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={download} disabled={!svgs[0]} style={{ ...btn(true), padding: "5px 14px" }}>Download outline PNG</button>
            <button onClick={() => pick(c.player)} style={linkBtn} title="His stats, games and number again from ESPN">Refresh his stats</button>
          </div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>
            The window exports transparent and is exactly 16:9: in Premiere, lay the PNG over the cut-up and scale the 1080p clip to 76.7%. Export at 1920×1080 and attach the video on X.
          </div>
        </>
      )}
    </div>
  );
}
