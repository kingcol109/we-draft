// src/components/NavMenu.jsx
//
// The desktop navbar's dropdowns (user, 2026-11-20 — "they function fine but
// feel outdated"). One component for every menu instead of a hand-rolled
// open/timeout pair per menu: hover (with a short grace period so the mouse
// can cross the gap), keyboard focus, Esc, and closing on navigation.
//
// The panel drops from its own trigger — a caret points at it — and is
// clamped inside the viewport, so a wide panel (CFB/NFL teams) under a link
// near the edge slides over rather than spilling off screen.
//
//   <NavMenu label="Draft" to="/events" active={…} linkStyle={…} width={300}
//            eyebrow="NFL Draft" actions={[{ to, label }]}>
//     {(close) => <NavMenuItem to="/events" title="…" note="…" icon="calendar" onClick={close} />}
//   </NavMenu>
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const NAVY = "#0b2545";
const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const GAP = 10; // trigger bottom → card top
const EDGE = 16; // closest the card gets to the viewport edge

const CSS = `
  @keyframes wdMenuIn { from { opacity: 0; transform: translateY(-6px) scale(.985); } to { opacity: 1; transform: none; } }
  .wd-menu-card { animation: wdMenuIn .16s cubic-bezier(.2,.8,.2,1); transform-origin: top center; }
  @media (prefers-reduced-motion: reduce) { .wd-menu-card { animation: none; } }
  .wd-menu-scroll { scrollbar-width: thin; scrollbar-color: #cfd8e3 transparent; }
  .wd-menu-scroll::-webkit-scrollbar { width: 8px; }
  .wd-menu-scroll::-webkit-scrollbar-thumb { background: #d6dee8; border-radius: 8px; border: 2px solid #fff; }
  .wd-menu-chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px; border-radius: 999px; background: #eef3fa;
    color: ${BLUE}; font-size: 11.5px; font-weight: 800; letter-spacing: .02em; text-decoration: none; white-space: nowrap;
    transition: background .12s, color .12s; }
  .wd-menu-chip:hover, .wd-menu-chip:focus-visible { background: ${BLUE}; color: #fff; outline: none; }
  .wd-menu-item { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 11px; text-decoration: none;
    transition: background .12s; outline: none; }
  .wd-menu-item:hover, .wd-menu-item:focus-visible { background: #f2f6fc; }
  .wd-menu-tile { width: 36px; height: 36px; flex-shrink: 0; border-radius: 10px; display: flex; align-items: center; justify-content: center;
    background: #eaf1fb; color: ${BLUE}; font-weight: 900; font-size: 13px; letter-spacing: -.02em; transition: background .12s, color .12s; }
  .wd-menu-item:hover .wd-menu-tile, .wd-menu-item:focus-visible .wd-menu-tile { background: ${BLUE}; color: #fff; }
  .wd-menu-item.is-featured .wd-menu-tile { background: #fff3dc; color: #b46d00; }
  .wd-menu-item.is-featured:hover .wd-menu-tile, .wd-menu-item.is-featured:focus-visible .wd-menu-tile { background: ${GOLD}; color: ${NAVY}; }
  .wd-menu-title { display: block; color: ${NAVY}; font-weight: 800; font-size: 14px; line-height: 1.2; transition: color .12s; }
  .wd-menu-item:hover .wd-menu-title, .wd-menu-item:focus-visible .wd-menu-title { color: ${BLUE}; }
  .wd-menu-note { display: block; margin-top: 2px; color: #6b7a90; font-size: 12px; font-weight: 600; line-height: 1.3; }
  .wd-menu-chev { margin-left: auto; color: ${BLUE}; opacity: 0; transform: translateX(-4px); transition: opacity .12s, transform .12s; flex-shrink: 0; }
  .wd-menu-item:hover .wd-menu-chev, .wd-menu-item:focus-visible .wd-menu-chev { opacity: 1; transform: none; }
  .wd-menu-group { font-size: 10.5px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: #8a96a8;
    padding: 0 10px 6px; margin-bottom: 4px; border-bottom: 1px solid #edf1f6; }
  .wd-menu-team { display: flex; align-items: center; gap: 9px; padding: 6px 10px; border-radius: 8px; text-decoration: none;
    color: #1c2b40; font-weight: 700; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    transition: background .1s, color .1s; outline: none; }
  .wd-menu-team:hover, .wd-menu-team:focus-visible { background: #f1f6fd; color: ${BLUE}; }
  .wd-menu-team img { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
`;

const ICONS = {
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  stopwatch: <><circle cx="12" cy="13.5" r="7" /><path d="M12 13.5V10M10 3h4M18.5 7l1.5-1.5" /></>,
  board: <><rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M8 8.5h8M8 12.5h8M8 16.5h5" /></>,
  pen: <><path d="M15.5 4.5l4 4L9 19H5v-4z" /><path d="M13 7l4 4" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  bolt: <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" />,
  doc: <><path d="M6.5 3h8l4 4v14h-12z" /><path d="M14 3v4.5h4.5M9.5 12.5h5M9.5 16h5" /></>,
  trend: <><path d="M3.5 17l6-6 4 4 7-7.5" /><path d="M15 7.5h5.5V13" /></>,
  swap: <><path d="M4 8h14l-4-4" /><path d="M20 16H6l4 4" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  shield: <><path d="M12 3l8 3v5.5c0 4.6-3.3 8.4-8 9.5-4.7-1.1-8-4.9-8-9.5V6z" /><path d="M8.5 12h7" /></>,
  archive: <><rect x="3.5" y="4" width="17" height="4.5" rx="1.2" /><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4" /></>,
};

export function NavIcon({ name, size = 18 }) {
  const body = ICONS[name];
  if (!body) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {body}
    </svg>
  );
}

// One row: a tile (an icon, or short text like '27), a title, a note line.
export function NavMenuItem({ to, title, note, icon, tile, featured = false, onClick }) {
  return (
    <Link to={to} onClick={onClick} className={`wd-menu-item${featured ? " is-featured" : ""}`} role="menuitem">
      <span className="wd-menu-tile">{icon ? <NavIcon name={icon} /> : tile}</span>
      <span style={{ minWidth: 0 }}>
        <span className="wd-menu-title">{title}</span>
        {note && <span className="wd-menu-note">{note}</span>}
      </span>
      <svg className="wd-menu-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </Link>
  );
}

export default function NavMenu({ label, to, linkStyle, linkClassName = "wd-nav-link", width = 280, maxHeight = null, eyebrow, actions = [], lead = null, onOpen, children }) {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // { top, left, w, caret }
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const timer = useRef(null);

  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const show = () => { cancel(); setOpen(true); };
  const hideSoon = () => { cancel(); timer.current = setTimeout(() => setOpen(false), 180); };
  const close = useCallback(() => { cancel(); setOpen(false); }, []);

  useEffect(() => () => cancel(), []);
  useEffect(() => { close(); }, [pathname, search, close]);
  useEffect(() => { if (open && onOpen) onOpen(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Place the card under the trigger, clamped to the viewport. Positioned
  // absolutely within the menu's wrapper (not fixed: the desktop nav is
  // centered with a transform, which would re-anchor a fixed panel).
  const place = useCallback(() => {
    const el = triggerRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    const r = el.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = Math.min(width, vw - EDGE * 2);
    const center = r.left + r.width / 2;
    const left = Math.max(EDGE, Math.min(center - w / 2, vw - w - EDGE));
    setPos({ top: r.bottom - wr.top, left: left - wr.left, w, caret: Math.max(18, Math.min(center - left, w - 18)) });
  }, [width]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { close(); triggerRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}
      onMouseEnter={show} onMouseLeave={hideSoon}
      onFocus={show}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) hideSoon(); }}>
      <Link ref={triggerRef} to={to} className={linkClassName} style={linkStyle} aria-haspopup="menu" aria-expanded={open}>
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ marginLeft: 6, opacity: 0.75, transition: "transform .18s", transform: open ? "rotate(180deg)" : "none" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </Link>

      {open && pos && (
        // The outer layer starts at the trigger's bottom edge (a transparent
        // bridge over the gap) so crossing to the card never closes it.
        <div style={{ position: "absolute", top: pos.top, left: pos.left, width: pos.w, paddingTop: GAP, zIndex: 10002 }}>
          <style>{CSS}</style>
          <div className="wd-menu-card" role="menu" aria-label={eyebrow || label}
            style={{
              position: "relative", background: "#fff", borderRadius: 16,
              border: "1px solid rgba(11,37,69,0.08)",
              boxShadow: "0 1px 2px rgba(11,37,69,0.06), 0 22px 54px -12px rgba(0,30,70,0.42)",
              fontFamily: "inherit", textTransform: "none", letterSpacing: "normal",
            }}>
            {/* caret */}
            <span aria-hidden="true" style={{
              position: "absolute", top: -6, left: pos.caret - 6, width: 12, height: 12, background: "#fff",
              borderLeft: "1px solid rgba(11,37,69,0.08)", borderTop: "1px solid rgba(11,37,69,0.08)",
              transform: "rotate(45deg)", borderTopLeftRadius: 3,
            }} />
            {(eyebrow || actions.length > 0) && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px 10px", position: "relative" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: NAVY }}>
                  <span style={{ width: 14, height: 3, borderRadius: 2, background: GOLD }} />
                  {eyebrow}
                </span>
                {actions.length > 0 && (
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {actions.map((a) => (
                      <Link key={a.to} to={a.to} className="wd-menu-chip" onClick={close}>
                        {a.label}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </Link>
                    ))}
                  </span>
                )}
              </div>
            )}
            {/* lead: pinned above the scrolling list (CFB's Transfer Portal row). */}
            {lead && <div style={{ padding: "0 8px", position: "relative" }}>{lead(close)}</div>}
            <div className="wd-menu-scroll" style={{
              padding: eyebrow || actions.length ? "2px 8px 8px" : 8,
              maxHeight: maxHeight || undefined, overflowY: maxHeight ? "auto" : undefined,
              position: "relative",
            }}>
              {children(close)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
