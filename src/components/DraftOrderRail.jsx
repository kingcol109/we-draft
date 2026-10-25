// src/components/DraftOrderRail.jsx
//
// Right-margin draft order on the NFL team and staff pages (NFLTeamPage.jsx,
// StaffPage.jsx) — the empty gutter opposite their left rail. The upcoming
// draft's picks in order (UpcomingPicks.jsx fetchDraft, the /draftorder
// page's data, cached), as many as fit the window's height, then a button
// to the full order. The page's team (currentTeam) is highlighted in its
// color. Sticky, like the left rail.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDraft, UPCOMING_DRAFTS } from "./UpcomingPicks";
import { fetchNflBranding } from "../utils/draftProfileData";
import { NFL_TEAMS } from "../utils/coachHistory";
import { cssRect, viewportCssHeight } from "../utils/pageZoom";

const BLUE = "#0055a5";
const PICK_H = 30;
const ROUND_H = 24;
const STICKY_TOP = 16;
const MIN_H = 220;
const MAX_H = 900;

const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${alpha}` : "transparent");

export default function DraftOrderRail({ currentTeam, color1 = BLUE }) {
  const draft = UPCOMING_DRAFTS[0];
  const [picks, setPicks] = useState([]);
  const [teams, setTeams] = useState({});
  useEffect(() => {
    let live = true;
    fetchDraft(draft).then((d) => { if (live) setPicks([...(d.picks || [])].sort((a, b) => a.Pick - b.Pick)); }).catch((e) => console.error("Draft order rail error:", e));
    fetchNflBranding().then((t) => { if (live) setTeams(t); }).catch(() => {});
    return () => { live = false; };
  }, [draft]);

  // The rail runs from where it sits on screen (its sticky spot once the
  // page scrolls, lower before that) to the bottom of the window, so the
  // button's always in view; page-zoom aware (utils/pageZoom.js).
  const asideRef = useRef(null);
  const [height, setHeight] = useState(null);
  useLayoutEffect(() => {
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = asideRef.current;
        if (!el) return;
        const top = Math.max(STICKY_TOP, cssRect(el).top);
        setHeight(Math.max(MIN_H, Math.min(MAX_H, Math.floor(viewportCssHeight() - top - STICKY_TOP))));
      });
    };
    fit();
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    window.addEventListener("pagezoomchange", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      window.removeEventListener("pagezoomchange", fit);
    };
  }, []);

  // How tall the list can be: the rail less its header and button —
  // re-measured as the rail's height changes.
  const listRef = useRef(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => setRoom(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Picks in order with a label at each new round, cut where the room runs out.
  const rows = [];
  let used = 0;
  let round = null;
  for (const p of picks) {
    const need = (p.Round !== round ? ROUND_H : 0) + PICK_H;
    if (used + need > room) break;
    if (p.Round !== round) { rows.push({ round: p.Round }); round = p.Round; }
    rows.push({ pick: p });
    used += need;
  }

  return (
    <aside ref={asideRef} style={{
      position: "sticky", top: STICKY_TOP, height: height ?? "calc(100vh / var(--pz, 1) - 32px)", maxHeight: MAX_H, display: "flex", flexDirection: "column",
      background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2", overflow: "hidden",
    }}>
      <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid #edf0f5" }}>
        <div style={{ fontSize: 9, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.12em", textTransform: "uppercase" }}>{draft.year} NFL Draft</div>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em" }}>Draft Order</div>
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {rows.map((row) => {
          if (row.round != null) {
            return <div key={`r${row.round}`} style={{ height: ROUND_H, boxSizing: "border-box", padding: "8px 12px 0", fontSize: 9, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.12em" }}>ROUND {row.round}</div>;
          }
          const p = row.pick;
          const owner = p.Traded || p.Team;
          const mine = owner === currentTeam;
          const t = teams[owner];
          const name = t?.Team || (NFL_TEAMS[owner] || owner).split(" ").pop();
          return (
            <Link key={p.Pick} to={`/nfl/${owner.toLowerCase()}`} title={`No. ${p.Pick} — ${NFL_TEAMS[owner] || owner}${p.Traded ? ` (via ${p.Team})` : ""}`}
              style={{
                display: "flex", alignItems: "center", gap: 8, height: PICK_H, boxSizing: "border-box", padding: "0 12px", textDecoration: "none",
                background: mine ? tint(color1, "14") : "transparent", borderLeft: `3px solid ${mine ? color1 : "transparent"}`,
              }}>
              <span style={{ width: 20, flexShrink: 0, textAlign: "right", fontSize: 11, fontWeight: 900, color: mine ? color1 : "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{p.Pick}</span>
              {t?.Logo1
                ? <img src={t.Logo1} alt="" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} />
                : <span style={{ width: 20, flexShrink: 0 }} />}
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 900, color: mine ? color1 : "#1a1f2b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
              {p.Traded && <span style={{ flexShrink: 0, fontSize: 8, fontWeight: 900, color: "#8a5a00", letterSpacing: "0.04em" }}>VIA {p.Team}</span>}
            </Link>
          );
        })}
      </div>

      <Link to="/draftorder" style={{
        display: "block", margin: 10, padding: "8px 10px", borderRadius: 999, background: BLUE, color: "#fff", textAlign: "center",
        fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none",
      }}>
        Full draft order →
      </Link>
    </aside>
  );
}
