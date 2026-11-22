// src/components/print/PrintRoot.jsx
//
// What window.print() prints: the given pages at true size, one per sheet,
// and nothing else on the site. On screen they're laid out off to the side
// (not display:none, so the pages can still measure themselves — the
// scouting reports fit their room that way). pageSize: the @page size,
// e.g. "8.75in 11.25in" (the magazine, with bleed) or "8.5in 11in".
import ReactDOM from "react-dom";

const css = (pageSize) => `
@media screen { .wd-print-root { position: fixed; left: -20000px; top: 0; pointer-events: none; } }
@media print {
  @page { size: ${pageSize}; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(.wd-print-root) { display: none !important; }
  .wd-print-root { position: static !important; left: auto !important; }
  .wd-print-root .wd-print-page { break-after: page; page-break-after: always; }
  .wd-print-root .wd-print-page:last-child { break-after: auto; page-break-after: auto; }
  .wd-print-screen-only { display: none !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;

// window.print() with the saved file named `name` — "Save as PDF" names the
// file after the page's title, so the title is swapped in for the print
// and put back after.
export function printAs(name) {
  const clean = String(name || "").replace(/[\\/:*?"<>|]+/g, "").trim();
  const prev = document.title;
  if (clean) document.title = clean;
  const restore = () => { document.title = prev; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  window.print();
  setTimeout(restore, 1000); // browsers that don't fire afterprint (print() blocks until the dialog closes)
}

export default function PrintRoot({ pageSize, children }) {
  if (typeof document === "undefined") return null;
  return ReactDOM.createPortal(
    <div className="wd-print-root">
      <style>{css(pageSize)}</style>
      {children}
    </div>,
    document.body,
  );
}
