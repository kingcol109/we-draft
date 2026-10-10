// src/broadcast/FitText.js
//
// Text that has to fit its box on the broadcast (a stat chip, a card line).
// It never just gets cut off: when the full wording overflows, it tries
// shorter wordings of the same thing (statWays: "receiving" → "rec",
// "yards" → "yds", the separators dropped …), and only then a smaller size
// (class "fit-sm", then "fit-xs"). Measured after layout and again once the
// broadcast fonts are in, so a capture never keeps a too-long first guess.
import { useLayoutEffect, useRef, useState } from "react";

const WORDS = [
  [/\breceiving\b/gi, "rec"], [/\breceptions?\b/gi, "rec"], [/\brushing\b/gi, "rush"], [/\bpassing\b/gi, "pass"],
  [/\byards\b/gi, "yds"], [/\byard\b/gi, "yd"], [/\btouchdowns\b/gi, "TDs"], [/\btouchdown\b/gi, "TD"],
  [/\binterceptions\b/gi, "INTs"], [/\binterception\b/gi, "INT"], [/\bcarries\b/gi, "car"], [/\btonight\b/gi, ""],
  [/\bof the season\b/gi, "this season"], [/\bon the season\b/gi, "this season"],
];
const shorten = (t) => WORDS.reduce((s, [re, to]) => s.replace(re, (m) => (m === m.toUpperCase() && to ? to.toUpperCase() : to)), t).replace(/\s{2,}/g, " ").trim();

// The ways to say a line, longest first, duplicates dropped.
export function statWays(text) {
  if (!text) return [""];
  const t = String(text);
  const a = shorten(t);
  const b = a.replace(/ · LONG -?\d+/gi, "");
  const c = b.replace(/\s*·\s*/g, " ");
  const d = c.replace(/\b(\d+) YDS\b/g, "$1Y").replace(/\b(\d+) (TDs?|INTs?|REC|CAR)\b/g, "$1 $2");
  return [...new Set([t, a, b, c, d])];
}

// lines: how many lines the box allows (1 = one line, no wrap).
// One measuring pass per text (and once more when the fonts are in): every
// wording, then the smaller sizes, tried on the element itself in a single
// layout effect, and the first that fits is kept — one state update, no
// back-and-forth.
const SIZES = ["", " fit-sm", " fit-xs"];
export default function FitText({ text, ways, className = "", lines = 1, as: Tag = "div" }) {
  const options = ways || statWays(text);
  const key = options.join("|");
  const ref = useRef(null);
  const [pick, setPick] = useState({ key, i: 0, size: 0 });
  const [fontsIn, setFontsIn] = useState(false);
  useLayoutEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => { if (alive) setFontsIn(true); });
    return () => { alive = false; };
  }, []);
  const cur = pick.key === key ? pick : { key, i: 0, size: 0 };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const over = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    // edit React's own text node in place (never replace it)
    const tn = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : null;
    if (!tn) return;
    const shownText = tn.nodeValue;
    const shownClass = el.className;
    let found = { key, i: options.length - 1, size: SIZES.length - 1 };
    search: for (let size = 0; size < SIZES.length; size++) {
      el.className = className + SIZES[size];
      for (let i = 0; i < options.length; i++) {
        tn.nodeValue = options[i];
        if (!over()) { found = { key, i, size }; break search; }
      }
    }
    tn.nodeValue = shownText;
    el.className = shownClass;
    setPick((p) => (p.key === found.key && p.i === found.i && p.size === found.size ? p : found));
  }, [key, fontsIn, className, lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = lines > 1
    ? { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }
    : { whiteSpace: "nowrap", overflow: "hidden" };
  return (
    <Tag ref={ref} className={className + SIZES[cur.size]} style={style}>
      {options[cur.i]}
    </Tag>
  );
}
