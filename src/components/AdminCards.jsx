// src/components/AdminCards.jsx
//
// Admin → Print → Trading Cards: the card designer. 2.5 × 3.5 in cards
// with a 0.125 in bleed (components/print/TradingCard.jsx), front and back,
// one design for now — "Draft Night", the generic draft card from the NFL
// draft targets pages. Pick any prospect (the compSnapshots/_search list),
// pick his action shot (the ones placed in Content → Photos), and download
// each side as its own PNG at 300 dpi with the bleed (825 × 1125 px) —
// "{Player} - {Design} Card - Front.png" / "- Back.png". The PNGs come from
// off-screen copies of the two sides (no guides) through the site's share
// image renderer (utils/exportImages.js: outside images inlined first).
import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Seg } from "./print/LayoutControls";
import { CardFront, CardBackPrint, CARD_H, CARD_W } from "./print/TradingCard";
import { renderShareImage } from "../utils/exportImages";
import { drawDraftCard, playerShots } from "./DraftCardGraphic";
import { schoolDoc } from "./ProspectIntroGraphic";
import { loadScoutBacks } from "./ScoutCard";
import { getSiteSnapshot } from "../utils/siteSnapshots";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: 12 };
const input = { border: "1px solid #d5dbe4", borderRadius: 6, padding: "7px 9px", fontSize: 13, fontFamily: "Arial, sans-serif", boxSizing: "border-box", width: "100%" };
const label = { fontSize: 10, fontWeight: 900, color: "#6b7686", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, display: "block" };
const btn = (color, filled = false) => ({
  padding: "6px 12px", fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em",
  border: `2px solid ${color}`, borderRadius: 7, cursor: "pointer", background: filled ? color : "#fff", color: filled ? "#fff" : color, fontFamily: "Arial, sans-serif",
});
const STARTER = ["jeremiah", "smith"];
// The design's name — in the picker and the saved files' names
// ("Jeremiah Smith - Draft Night Card - Front.png").
const DESIGN_NAME = "Draft Night";
const ZOOM = 1.6;
// 300 dpi: the cards are drawn at 96 px an inch.
const PNG_RATIO = 300 / 96;

export default function AdminCards() {
  const [all, setAll] = useState(null); // the _search rows
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState(null); // { id, first, last, pos, school, year }
  const [data, setData] = useState(null); // { shots, shot, headshot, logo, back }
  const [art, setArt] = useState("");
  const [guides, setGuides] = useState(true);
  // Each side as its own PNG, from its off-screen copy.
  const sideRefs = { front: useRef(null), back: useRef(null) };
  const [saving, setSaving] = useState("");
  async function savePng(s) {
    const node = sideRefs[s].current?.firstElementChild;
    if (!node) return;
    setSaving(s);
    try {
      await document.fonts?.ready;
      const url = await renderShareImage(node, { pixelRatio: PNG_RATIO, skipFonts: false, width: CARD_W, height: CARD_H });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${player.first} ${player.last} - ${DESIGN_NAME} Card - ${s === "front" ? "Front" : "Back"}.png`.replace(/[\\/:*?"<>|]+/g, "");
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("Card PNG error:", e);
      alert("Couldn't make that PNG — try again.");
    } finally {
      setSaving("");
    }
  }

  useEffect(() => {
    getSiteSnapshot("_search").then((d) => {
      const rows = (d?.rows || []).map((r) => ({ id: r.i, first: r.F, last: r.L, pos: r.P, school: r.S, year: String(r.E || "").slice(0, 4) }));
      setAll(rows);
      const s = rows.filter((r) => r.first.toLowerCase() === STARTER[0] && r.last.toLowerCase() === STARTER[1]).sort((a, b) => b.year - a.year)[0];
      if (s) setPlayer(s);
    });
  }, []);

  // His shots, headshot, school and back.
  useEffect(() => {
    if (!player) return undefined;
    let live = true;
    setData(null); setArt("");
    (async () => {
      const [photos, shots, school] = await Promise.all([
        getDoc(doc(db, "playerPhotos", player.id)).then((x) => (x.exists() ? x.data() : {})).catch(() => ({})),
        playerShots(player.id),
        schoolDoc(player.school),
      ]);
      const espnId = photos.headshot?.espnId ? String(photos.headshot.espnId) : "";
      const backs = await loadScoutBacks([{ id: player.id, pos: player.pos, espnId }]).catch(() => ({}));
      if (live) setData({ shots, shot: shots[0]?.url || "", headshot: photos.headshot?.url || "", logo: school?.LogoDark || school?.Logo1 || "", back: backs[player.id] || null });
    })();
    return () => { live = false; };
  }, [player]);

  // The front's art, redrawn when the shot changes.
  useEffect(() => {
    if (!player || !data) return undefined;
    let live = true;
    let url = "";
    drawDraftCard({ player, year: player.year, shotUrl: data.shot }).then((u) => { url = u; if (live) setArt(u); }).catch(() => {});
    return () => { live = false; if (url) setTimeout(() => URL.revokeObjectURL(url), 5000); };
  }, [player, data?.shot]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase();
  const matches = useMemo(() => (!all || q.length < 2 ? [] : all.filter((r) => `${r.first} ${r.last} ${r.school}`.toLowerCase().includes(q)).slice(0, 12)), [all, q]);

  const side = (title, el) => (
    <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
      <span style={label}>{title}</span>
      <div style={{ width: CARD_W * ZOOM, height: CARD_H * ZOOM, boxShadow: "0 8px 26px rgba(10,20,40,.3)" }}>
        <div style={{ width: CARD_W, height: CARD_H, transform: `scale(${ZOOM})`, transformOrigin: "top left" }}>{el}</div>
      </div>
    </div>
  );
  const ready = player && data;
  const front = (g) => <CardFront art={art} year={player?.year} guides={g} />;
  const back = (g) => <CardBackPrint player={player} back={data?.back} photo={data?.headshot} logo={data?.logo} year={player?.year} guides={g} />;

  return (
    <div style={{ display: "grid", gap: 14, fontFamily: "Arial, sans-serif" }}>
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, color: INK, fontSize: 15 }}>Trading Cards</div>
        <span style={{ fontSize: 12, color: "#6b7686", fontWeight: 700 }}>2.5 × 3.5 trim · 2.75 × 3.75 with bleed · front and back</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, fontWeight: 800, color: INK, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Guides
          </label>
          {["front", "back"].map((s) => {
            const off = !ready || !art || !!saving;
            return (
              <button key={s} type="button" onClick={() => savePng(s)} disabled={off} style={{ ...btn(GOLD, true), opacity: off ? 0.5 : 1 }}>
                {saving === s ? "Saving…" : `⬇ ${s === "front" ? "Front" : "Back"} PNG`}
              </button>
            );
          })}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "290px minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ ...card, padding: 12, display: "grid", gap: 10 }}>
            <div><span style={label}>Design</span><Seg value="night" onChange={() => {}} options={[["night", DESIGN_NAME]]} /></div>
            <div>
              <span style={label}>Player</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={all ? "Search name or school" : "Loading players…"} style={input} />
              <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 4 }}>
                {matches.map((r) => (
                  <button key={r.id} type="button" onClick={() => { setPlayer(r); setSearch(""); }} style={{ display: "block", width: "100%", textAlign: "left", background: r.id === player?.id ? "#eef4fb" : "#fff", border: "none", borderBottom: "1px solid #eef1f5", padding: "7px 6px", cursor: "pointer", fontFamily: "inherit" }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: INK }}>{r.first} {r.last}</div>
                    <div style={{ fontSize: 11, color: "#6b7686", fontWeight: 700 }}>{[r.pos, r.school, r.year].filter(Boolean).join(" · ")}</div>
                  </button>
                ))}
              </div>
            </div>
            {player && <div style={{ fontSize: 12, fontWeight: 800, color: INK }}>On the card: {player.first} {player.last} · {player.pos} · {player.school} · {player.year}</div>}
          </div>

          <div style={{ ...card, padding: 12 }}>
            <span style={label}>Action shot (front)</span>
            {!data ? <div style={{ fontSize: 12, color: "#9aa3af" }}>Loading…</div>
              : !data.shots.length ? <div style={{ fontSize: 12, color: "#9aa3af", lineHeight: 1.45 }}>No placed shots — his school's logo is the art. Place one in Content → Photos.</div>
              : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {data.shots.map((s) => (
                    <button key={s.url} type="button" onClick={() => setData((d) => ({ ...d, shot: s.url }))} style={{ padding: 0, border: `3px solid ${s.url === data.shot ? BLUE : "transparent"}`, borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#eef1f5", aspectRatio: "4 / 5" }}>
                      <img src={s.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </button>
                  ))}
                </div>
              )}
          </div>
          {guides && (
            <div style={{ ...card, padding: 12, fontSize: 11, fontWeight: 800, color: "#6b7686", display: "grid", gap: 4 }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(255,0,90,.4)", marginRight: 6 }} />Bleed (cut off)</span>
              <span><span style={{ display: "inline-block", width: 10, height: 2, background: "#00d0ff", marginRight: 6, verticalAlign: "middle" }} />Trim 2.5 × 3.5</span>
              <span><span style={{ display: "inline-block", width: 10, borderTop: "2px dashed #ff78ff", marginRight: 6, verticalAlign: "middle" }} />Safe area (⅛ in inside the trim)</span>
            </div>
          )}
        </div>

        <div style={{ ...card, padding: "24px 12px", background: "#e9ecf1", display: "flex", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
          {ready ? (
            <>
              {side("Front", front(guides))}
              {side("Back", back(guides))}
            </>
          ) : <div style={{ padding: 40, color: "#6b7686", fontWeight: 800 }}>{player ? "Loading his card…" : "Pick a player"}</div>}
        </div>
      </div>

      {/* The PNGs' sources: both sides at true size, off screen, no guides. */}
      {ready && art && (
        <div aria-hidden="true" style={{ position: "fixed", left: -30000, top: 0, pointerEvents: "none" }}>
          <div ref={sideRefs.front}>{front(false)}</div>
          <div ref={sideRefs.back}>{back(false)}</div>
        </div>
      )}
    </div>
  );
}
