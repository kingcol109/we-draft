// src/components/FirstPickSetup.jsx
//
// Admin → Content → Photos: placing an action shot for the First Pick
// graphic (utils/instagram/firstPick.js — a team's first pick on its
// Weekly Mock page). The graphic on the Jets (FIRST_PICK_BASE_TEAM), his
// real name, school and measurements on it; drag the photo or use the size
// and position controls, then Save — the placement goes on the shot as
// firstPick: { x, y, scale }. The photo's box is the same on every team's
// graphic, so another team (the picker) only checks the colors.
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { fetchNflBranding } from "../utils/draftProfileData";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { firstPickInput, firstPickSvg, firstPickImageUrls, firstPickAdjust, FIRST_PICK_BASE_TEAM, FIRST_PICK_ROTATE } from "../utils/instagram/firstPick";
import { IG_W, IG_H } from "../utils/instagram/posts";
import { envFor, loadFeatureImage, useSvgUrls, useDragAdjust, PhotoAdjust, NO_ADJUST, btn, linkBtn, label, BLUE } from "./SocialMakerKit";
import WdLogo from "../assets/Logo2.png";

// The pick number on the template (two digits, as most first picks are).
const SAMPLE_PICK = 12;
const rotBtn = { border: "1px solid #d5dce6", background: "#fff", borderRadius: "5px", width: "24px", height: "24px", padding: 0, fontSize: "14px", fontWeight: 900, color: "#33415a", cursor: "pointer" };

export default function FirstPickSetup({ player, shot, onSave, onClose }) {
  const [branding, setBranding] = useState(null);
  const [school, setSchool] = useState({});
  const [team, setTeam] = useState(FIRST_PICK_BASE_TEAM);
  const [adjust, setAdjust] = useState(() => (shot.firstPick ? firstPickAdjust(shot.firstPick) : { ...NO_ADJUST, rotate: 0 }));
  const rotate = Number(adjust.rotate) || 0;
  const rotateTo = (n) => setAdjust((a) => ({ ...a, rotate: Math.round(Math.max(-FIRST_PICK_ROTATE, Math.min(FIRST_PICK_ROTATE, n)) * 2) / 2 }));
  const [svg, setSvg] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const drag = useDragAdjust(setAdjust);

  useEffect(() => {
    // Live (not the cached snapshot), so a logo just added in Teams shows here.
    getDocs(collection(db, "nfl")).then((s) => setBranding(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))))
      .catch(() => fetchNflBranding().then(setBranding).catch(() => setBranding({})));
    if (player.School) {
      getDocs(query(collection(db, "schools"), where("School", "==", player.School), limit(1)))
        .then((s) => setSchool(s.docs[0]?.data() || {})).catch(() => {});
    }
  }, [player.School]);
  // Esc closes it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const input = useMemo(() => (branding ? firstPickInput({
    player, school, team: branding[team] || {}, abbr: team, pick: { overall: SAMPLE_PICK, round: 1 }, year: player.Eligible,
    photo: { url: shot.url, firstPick: adjust }, brandLogo: WdLogo,
  }) : null), [branding, school, team, player, shot.url, adjust]);

  useEffect(() => {
    if (!input) return undefined;
    let live = true;
    // As the graphic draws them: the shot with its backdrop out, trimmed to
    // him; the wordmark trimmed to its ink, so it runs edge to edge.
    const overrides = { [input.photo]: loadFeatureImage(input.photo, true) };
    // The wordmark and the big logo trimmed to their ink: edge to edge, and meeting.
    [input.wordmark, input.bgLogo].filter(Boolean).forEach((u) => { if (u !== input.photo) overrides[u] = loadFeatureImage(u, true); });
    envFor(input, overrides, firstPickImageUrls(input)).then((env) => {
      if (!live) return;
      setSvg(firstPickSvg(input, env));
      setMsg(env.images[input.photo] ? "" : "Couldn't load this photo — it may not allow downloads (an imgur link works).");
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input]);
  const url = useSvgUrls(useMemo(() => (svg ? [svg] : []), [svg]))[0];

  const saved = shot.firstPick ? firstPickAdjust(shot.firstPick) : null;
  const changed = !saved || saved.x !== adjust.x || saved.y !== adjust.y || saved.scale !== adjust.scale || saved.rotate !== rotate;
  const save = async (value) => {
    setSaving(true);
    const ok = await onSave(value);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,16,28,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: "14px", padding: "18px", display: "grid", gridTemplateColumns: "minmax(260px, 300px) minmax(280px, 440px)", gap: "18px", maxHeight: "calc(100vh - 40px)", overflowY: "auto", fontFamily: "Arial, sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: "16px", color: BLUE }}>First Pick graphic</div>
            <div style={{ fontSize: "12px", color: "#5b6b84", marginTop: "4px", lineHeight: 1.45 }}>
              Place {player.First} {player.Last} on the template. The photo&apos;s box is the same on every team&apos;s graphic, so this placement fits all 32.
            </div>
          </div>
          <div>
            <div style={label}>Template team</div>
            <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ border: "1px solid #d5dce6", borderRadius: "6px", padding: "5px 8px", fontSize: "13px", fontWeight: 700, width: "100%" }}>
              {NFL_TEAM_ABBRS.map((a) => <option key={a} value={a}>{NFL_TEAMS[a] || a}{a === FIRST_PICK_BASE_TEAM ? " (base)" : ""}</option>)}
            </select>
          </div>
          <PhotoAdjust value={adjust} onChange={(v) => setAdjust({ rotate: 0, ...v })} />
          <div>
            <div style={{ ...label, display: "flex", alignItems: "center" }}>
              Rotate
              {rotate ? <button onClick={() => rotateTo(0)} style={{ ...linkBtn, marginLeft: "auto", fontSize: "10px" }}>RESET</button> : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 24px 52px", alignItems: "center", gap: "6px" }}>
              <button onClick={() => rotateTo(rotate - 1)} style={rotBtn} aria-label="Rotate left">↺</button>
              <input type="range" min={-FIRST_PICK_ROTATE} max={FIRST_PICK_ROTATE} step={0.5} value={rotate} onChange={(e) => rotateTo(Number(e.target.value))} />
              <button onClick={() => rotateTo(rotate + 1)} style={rotBtn} aria-label="Rotate right">↻</button>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84", textAlign: "right" }}>{rotate}°</span>
            </div>
          </div>
          {msg && <div style={{ fontSize: "12px", fontWeight: 700, color: "#c0392b" }}>{msg}</div>}
          <div style={{ fontSize: "12px", fontWeight: 700, color: saved ? "#15803d" : "#8a97ab" }}>
            {saved ? `Saved: x ${saved.x}, y ${saved.y}, ${Math.round(saved.scale * 100)}%${saved.rotate ? `, ${saved.rotate}°` : ""}` : "Not placed yet — it would show as laid out."}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "auto" }}>
            <button disabled={saving || !changed} onClick={() => save({ x: adjust.x, y: adjust.y, scale: adjust.scale, rotate })} style={{ ...btn(true), opacity: saving || !changed ? 0.5 : 1 }}>{saving ? "Saving…" : "Save placement"}</button>
            <button onClick={onClose} style={btn(false)}>{changed && saved ? "Cancel" : "Close"}</button>
            {saved && <button disabled={saving} onClick={() => { if (window.confirm("Clear this shot's First Pick placement?")) save(null); }} style={{ ...linkBtn, color: "#a52a1e" }}>CLEAR</button>}
          </div>
        </div>
        <div>
          <div style={label}>Preview · {IG_W}×{IG_H} · drag to move him · pick #{SAMPLE_PICK} is a sample</div>
          {url
            ? <img src={url} alt="First Pick graphic preview" {...drag.handlers} style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}`, borderRadius: "8px", border: "1px solid #d5dce6", ...drag.handlers.style }} />
            : <div style={{ aspectRatio: `${IG_W} / ${IG_H}`, borderRadius: "8px", background: "#eef1f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 800, color: "#8a97ab" }}>Drawing…</div>}
        </div>
      </div>
    </div>
  );
}
