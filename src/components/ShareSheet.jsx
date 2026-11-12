// src/components/ShareSheet.jsx
//
// The site's one share dialog — every Share opens this: the player page
// (ShareTextButton.jsx), the Weekly Mock's link (ShareLinkButton.jsx), user
// mocks (ShareMockButton.jsx), the Draft Sim (draftSim/SimResults.jsx) and
// We-Pick (WePickHub.js). A centered card on a blurred backdrop; on a phone,
// a sheet up from the bottom. Top to bottom:
//   the title and a close button;
//   the preview (the share image, or a card) and anything under it (`below`
//     — a toggle, a note);
//   the link, with Copy (`link`);
//   the main buttons (`primary` — Save image, Share image);
//   a row of round icon buttons (`actions` — Copy, Messages, Email, X…).
// Icons are SVG (ShareIcon), not emoji. `dark` for the dark pages (the
// Draft Sim, We-Pick).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const CSS = `
.wdss-back{position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(6,10,18,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:wdss-fade .16s ease-out}
.wdss{--bg:#fff;--fg:#0f172a;--mut:#64748b;--line:#e2e8f0;--soft:#f1f5f9;--soft2:#e2e8f0;--pri:#0f172a;--pri-fg:#fff;
  position:relative;width:100%;max-width:440px;max-height:calc(92vh / var(--pz, 1));overflow-y:auto;background:var(--bg);color:var(--fg);border-radius:22px;padding:18px 20px 20px;box-sizing:border-box;
  box-shadow:0 30px 80px rgba(0,0,0,.35),0 0 0 1px rgba(15,23,42,.06);font-family:Inter,"Segoe UI",system-ui,-apple-system,Arial,sans-serif;text-align:left;animation:wdss-pop .2s cubic-bezier(.2,.9,.3,1.15)}
.wdss.dark{--bg:#0f1729;--fg:#f1f5f9;--mut:#94a3b8;--line:#1e293b;--soft:#1b2438;--soft2:#25314a;--pri:#f1f5f9;--pri-fg:#0f1729;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06)}
.wdss-grab{display:none;width:40px;height:5px;border-radius:999px;background:var(--soft2);margin:0 auto 12px}
.wdss-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.wdss-title{flex:1;min-width:0;font-size:16px;font-weight:800;letter-spacing:-.01em;line-height:1.25}
.wdss-sub{font-size:12.5px;font-weight:500;color:var(--mut);margin-top:2px}
.wdss-x{flex-shrink:0;width:34px;height:34px;border-radius:50%;border:none;background:var(--soft);color:var(--fg);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s}
.wdss-x:hover{background:var(--soft2)}
.wdss-prev{margin-bottom:14px}
.wdss-img{display:block;margin:0 auto;max-width:100%;max-height:calc(54vh / var(--pz, 1));border-radius:14px;box-shadow:0 10px 30px rgba(15,23,42,.18)}
.wdss-ph{position:relative;overflow:hidden;max-height:calc(54vh / var(--pz, 1));max-width:100%;margin:0 auto;border-radius:14px;background:var(--soft);display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;box-sizing:border-box}
.wdss-ph span{position:relative;font-size:13px;font-weight:600;color:var(--mut)}
.wdss-ph:not(.failed)::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);animation:wdss-shim 1.3s linear infinite}
.wdss.dark .wdss-ph:not(.failed)::before{background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.07) 50%,transparent 70%)}
.wdss-tog{display:flex;align-items:center;gap:12px;background:var(--soft);border-radius:12px;padding:11px 14px;margin-bottom:14px;cursor:pointer;user-select:none}
.wdss-tog span{flex:1;font-size:14px;font-weight:600}
.wdss-tog input{position:absolute;opacity:0;pointer-events:none}
.wdss-tog i{position:relative;width:42px;height:24px;border-radius:999px;background:var(--soft2);transition:background .18s;flex-shrink:0}
.wdss-tog i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s}
.wdss-tog input:checked+i{background:#22c55e}
.wdss-tog input:checked+i::after{transform:translateX(18px)}
.wdss-opt{margin-bottom:14px}
.wdss-label{font-size:11.5px;font-weight:700;color:var(--mut);margin-bottom:7px}
.wdss-chips{display:flex;flex-wrap:wrap;gap:6px}
.wdss-chip{border:none;background:var(--soft);color:var(--fg);border-radius:999px;padding:7px 13px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s}
.wdss-chip:hover:not(:disabled){background:var(--soft2)}
.wdss-chip.on{background:var(--pri);color:var(--pri-fg)}
.wdss-chip:disabled{opacity:.35;cursor:default}
.wdss-text{background:var(--soft);border-radius:12px;padding:11px 13px;max-height:18vh;overflow-y:auto;font-size:13px;line-height:1.5;white-space:pre-line;color:var(--mut);margin-bottom:14px}
@keyframes wdss-shim{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.wdss-link{display:flex;align-items:center;gap:8px;background:var(--soft);border-radius:12px;padding:6px 6px 6px 12px;margin-bottom:14px}
.wdss-link span{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wdss-link button{flex-shrink:0;border:none;border-radius:9px;background:var(--pri);color:var(--pri-fg);font:inherit;font-size:12.5px;font-weight:700;padding:7px 12px;cursor:pointer;display:flex;align-items:center;gap:6px}
.wdss-pri{display:grid;gap:8px;margin-bottom:16px}
.wdss-btn{display:flex;align-items:center;justify-content:center;gap:8px;height:46px;border-radius:13px;border:none;font:inherit;font-size:14.5px;font-weight:700;cursor:pointer;text-decoration:none;background:var(--pri);color:var(--pri-fg);transition:transform .12s,opacity .15s}
.wdss-btn.alt{background:var(--soft);color:var(--fg)}
.wdss-btn:hover{transform:translateY(-1px)}
.wdss-btn:disabled{opacity:.45;cursor:default;transform:none}
.wdss-acts{display:flex;justify-content:space-around;gap:6px;flex-wrap:wrap}
.wdss-act{flex:1 1 0;min-width:62px;max-width:92px;display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:none;padding:4px 0;font:inherit;color:var(--fg);text-decoration:none;cursor:pointer}
.wdss-act i{width:50px;height:50px;border-radius:50%;background:var(--soft);display:flex;align-items:center;justify-content:center;transition:background .15s,transform .12s}
.wdss-act:hover i{background:var(--soft2);transform:translateY(-1px)}
.wdss-act i.x{background:#000;color:#fff}.wdss.dark .wdss-act i.x{background:#fff;color:#000}
.wdss-act i.fb{background:#1877f2;color:#fff}
.wdss-act b{font-size:12px;font-weight:600;color:var(--mut)}
.wdss-note{font-size:12.5px;color:var(--mut);margin-top:12px;text-align:center}
@keyframes wdss-fade{from{opacity:0}}
@keyframes wdss-pop{from{opacity:0;transform:translateY(10px) scale(.98)}}
@keyframes wdss-up{from{transform:translateY(100%)}}
@media (max-width:640px){
  .wdss-back{align-items:flex-end;padding:0}
  .wdss{max-width:none;border-radius:22px 22px 0 0;padding:10px 16px calc(18px + env(safe-area-inset-bottom));max-height:94vh;animation:wdss-up .24s cubic-bezier(.2,.9,.3,1)}
  .wdss-grab{display:block}
}`;

// The share icons, drawn in currentColor.
const PATHS = {
  download: <><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
  share: <><path d="M12 15V3" /><path d="M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" /></>,
  message: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 9.3 9.3 0 0 1-3.6-.7L3 21l1.6-4.3A7.9 7.9 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 6.5l8.5 6 8.5-6" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
};
const FILLED = {
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  facebook: "M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z",
};
export function ShareIcon({ name, size = 20 }) {
  if (FILLED[name]) return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={FILLED[name]} fill="currentColor" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>;
}

// The usual round buttons, ready to drop into `actions`.
export const shareActions = {
  copy: (text, label = "Copy") => ({ key: "copy", label, icon: "copy", copy: text }),
  copyLink: (url) => ({ key: "copylink", label: "Copy link", icon: "link", copy: url }),
  text: (body) => ({ key: "text", label: "Messages", icon: "message", href: `sms:?&body=${encodeURIComponent(body)}` }),
  email: (subject, body) => ({ key: "email", label: "Email", icon: "mail", href: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` }),
  x: (href) => ({ key: "x", label: "X", icon: "x", href, external: true }),
  facebook: (url) => ({ key: "fb", label: "Facebook", icon: "facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, external: true }),
};

// The share image in the preview — or, while it builds, a placeholder its
// shape (aspect: width / height) with a shimmer; failed says why there's
// none.
export function ShareImagePreview({ src, alt = "Share image", aspect = 4 / 5, failed = false, failedText = "Couldn't build the image — the other options still work." }) {
  if (src) return <img src={src} alt={alt} className="wdss-img" />;
  return (
    <div className={`wdss-ph${failed ? " failed" : ""}`} style={{ aspectRatio: String(aspect) }}>
      <span>{failed ? failedText : "Building your graphic…"}</span>
    </div>
  );
}

// A row of choices under the preview (the Whiteboard's position and
// graphic): label, options [{ id, label, disabled, color }], value, onChange.
export function ShareChips({ label, options, value, onChange }) {
  return (
    <div className="wdss-opt">
      {label && <div className="wdss-label">{label}</div>}
      <div className="wdss-chips">
        {options.map((o) => (
          <button key={o.id} className={`wdss-chip${o.id === value ? " on" : ""}`} disabled={o.disabled}
            style={o.id === value && o.color ? { background: o.color, color: "#fff" } : undefined} onClick={() => onChange(o.id)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

// An on/off switch under the preview (the Draft Sim's "Include grades").
export function ShareToggle({ label, on, onChange }) {
  return (
    <label className="wdss-tog">
      <span>{label}</span>
      <input type="checkbox" checked={!!on} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

let cssAdded = false;
function useCss() {
  useEffect(() => {
    if (cssAdded || typeof document === "undefined") return;
    cssAdded = true;
    const el = document.createElement("style");
    el.setAttribute("data-wd", "share-sheet");
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
}

// A copy that shows "Copied" for a moment.
function useCopied() {
  const [copied, setCopied] = useState("");
  const copy = (key, text) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1800); }).catch(() => {});
  };
  return [copied, copy];
}

// open/onClose; title, subtitle; preview, below (nodes); link (a URL, shown
// with Copy); primary: [{ label, icon, onClick, disabled, alt }]; actions:
// [{ key, label, icon, href, external, onClick, copy (text to copy) }];
// note: a line of small print at the bottom; dark.
export default function ShareSheet({ open, onClose, title, subtitle, preview, below, link, primary = [], actions = [], note, dark = false }) {
  useCss();
  const [copied, copy] = useCopied();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="wdss-back" onClick={onClose}>
      <div className={`wdss${dark ? " dark" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="wdss-grab" aria-hidden="true" />
        <div className="wdss-head">
          <div className="wdss-title">{title}{subtitle && <div className="wdss-sub">{subtitle}</div>}</div>
          <button className="wdss-x" onClick={onClose} aria-label="Close"><ShareIcon name="close" size={18} /></button>
        </div>
        {preview && <div className="wdss-prev">{preview}</div>}
        {below}
        {link && (
          <div className="wdss-link">
            <span>{link.replace(/^https?:\/\//, "")}</span>
            <button onClick={() => copy("__link", link)}><ShareIcon name={copied === "__link" ? "check" : "link"} size={15} />{copied === "__link" ? "Copied" : "Copy"}</button>
          </div>
        )}
        {primary.length > 0 && (
          <div className="wdss-pri" style={{ gridTemplateColumns: `repeat(${primary.length}, 1fr)` }}>
            {primary.map((p) => (
              <button key={p.label} className={`wdss-btn${p.alt ? " alt" : ""}`} onClick={p.onClick} disabled={p.disabled}>
                {p.icon && <ShareIcon name={p.icon} size={19} />}{p.label}
              </button>
            ))}
          </div>
        )}
        {actions.length > 0 && (
          <div className="wdss-acts">
            {actions.map((a) => {
              const done = copied === a.key;
              const inner = <><i className={a.icon === "x" ? "x" : a.icon === "facebook" ? "fb" : ""}><ShareIcon name={done ? "check" : a.icon} /></i><b>{done ? "Copied" : a.label}</b></>;
              if (a.href) return <a key={a.key} className="wdss-act" href={a.href} {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : {})} onClick={a.onClick}>{inner}</a>;
              return <button key={a.key} className="wdss-act" onClick={a.copy != null ? () => copy(a.key, a.copy) : a.onClick}>{inner}</button>;
            })}
          </div>
        )}
        {note && <div className="wdss-note">{note}</div>}
      </div>
    </div>,
    document.body,
  );
}
