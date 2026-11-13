// src/components/profileHub/SavedGraphics.jsx
//
// The profile's Boards tab: Whiteboard graphics the user saved to their
// account (utils/savedGraphics.js), newest first, as thumbnails redrawn from
// what was saved. A tap opens one in the site's share dialog to save,
// share or delete it.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSavedGraphics, renderGraphic, deleteSavedGraphic } from "../../utils/savedGraphics";
import ShareSheet, { ShareImagePreview } from "../ShareSheet";
import { THEMES } from "../../utils/whiteboardGraphic";
import LoadingSpinner from "../LoadingSpinner";

const BLUE = "#0055a5";
const MUTED = "#5b6b84";
const CARD = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)", overflow: "hidden" };

const toDate = (v) => (v?.toDate ? v.toDate() : null);
const canShareFiles = () => {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare
      && navigator.canShare({ files: [new File([new Blob()], "x.png", { type: "image/png" })] });
  } catch { return false; }
};

export default function SavedGraphics({ uid, year, isMobile }) {
  const [items, setItems] = useState(null);
  const [urls, setUrls] = useState({}); // id -> object URL
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    listSavedGraphics(uid).then((x) => { if (live) setItems(x); }).catch((e) => { console.error("Saved graphics:", e); if (live) setItems([]); });
    return () => { live = false; };
  }, [uid]);

  const mine = (items || []).filter((g) => String(g.classYear) === String(year));
  const key = mine.map((g) => g.id).join("|");

  // Draw them one at a time (each looks up its headshots).
  useEffect(() => {
    let live = true;
    (async () => {
      for (const g of mine) {
        if (!live) return;
        if (urls[g.id]) continue;
        try {
          const blob = await renderGraphic(g);
          if (!live) return;
          const u = URL.createObjectURL(blob);
          setUrls((x) => ({ ...x, [g.id]: u, [`${g.id}:blob`]: blob }));
        } catch (e) { console.error("Saved graphic:", e); }
      }
    })();
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = open && mine.find((x) => x.id === open);
  const fileName = g ? `we-draft-${g.classYear}-${String(g.pos).toLowerCase()}-${g.list || g.mode}.png` : "";
  const download = () => {
    const a = document.createElement("a");
    a.href = urls[g.id]; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  };
  const share = async () => {
    try { await navigator.share({ files: [new File([urls[`${g.id}:blob`]], fileName, { type: "image/png" })] }); }
    catch (e) { if (e?.name !== "AbortError") setNote("Couldn't open sharing. Use Save image instead."); }
  };
  const remove = async () => {
    if (!window.confirm("Delete this saved graphic?")) return;
    try {
      await deleteSavedGraphic(uid, g.id);
      setItems((x) => x.filter((i) => i.id !== g.id));
      setOpen(null);
    } catch { setNote("Couldn't delete it. Try again."); }
  };

  return (
    <div style={{ ...CARD, marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "12px 14px 8px" }}>
        <h3 style={{ margin: 0, font: "900 13px Arial, sans-serif", letterSpacing: ".14em", textTransform: "uppercase", color: BLUE }}>Saved Graphics</h3>
        <span style={{ font: "800 11px Arial, sans-serif", color: "#8a95a5" }}>{items ? `${year} · ${mine.length}` : ""}</span>
      </div>
      {!items ? <LoadingSpinner size={24} minHeight="120px" /> : mine.length ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 4}, 1fr)`, gap: 10, padding: "4px 14px 14px" }}>
          {mine.map((x) => {
            const accent = THEMES[x.list]?.accent || BLUE;
            const d = toDate(x.createdAt);
            return (
              <button key={x.id} onClick={() => { setNote(""); setOpen(x.id); }} style={{ padding: 0, border: "1px solid #e6ebf2", borderRadius: 10, overflow: "hidden", background: "#0b1220", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <div style={{ aspectRatio: "4 / 5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {urls[x.id] ? <img src={urls[x.id]} alt={x.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <LoadingSpinner size={18} minHeight="60px" />}
                </div>
                <div style={{ background: "#fff", padding: "7px 9px", borderTop: `3px solid ${accent}` }}>
                  <b style={{ display: "block", font: "900 12px Arial, sans-serif", color: "#0f1b2d", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.title}</b>
                  <span style={{ font: "700 11px Arial, sans-serif", color: "#7a8597" }}>{d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: "6px 14px 14px", font: "700 13px Arial, sans-serif", color: MUTED }}>
          No saved graphics for {year} yet. On the <Link to="/whiteboard" style={{ color: BLUE, fontWeight: 900 }}>Whiteboard</Link>, tap Share, pick a list, then Save to account.
        </div>
      )}

      {g && (
        <ShareSheet open onClose={() => setOpen(null)} title={g.title}
          subtitle={toDate(g.createdAt) ? `Saved ${toDate(g.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : undefined}
          preview={<ShareImagePreview src={urls[g.id]} alt={g.title} />}
          primary={[
            { label: "Save image", icon: "download", onClick: download, disabled: !urls[g.id] },
            ...(canShareFiles() ? [{ label: "Share image", icon: "share", onClick: share, disabled: !urls[g.id], alt: true }] : []),
          ]}
          actions={[{ key: "delete", label: "Delete", icon: "close", onClick: remove }]}
          note={note} />
      )}
    </div>
  );
}
