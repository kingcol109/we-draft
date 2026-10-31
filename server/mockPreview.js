// server/mockPreview.js
//
// The Weekly Mock's link-preview images (og:image / twitter:image, 1200×630)
// — what shows up when someone texts or posts a link to /mocks/2027 or
// /mocks/nyj. Drawn per request by api/mock-og.js from the class's current
// week, so the picture always matches the picks:
//
//   classSvg — the whole mock (/mocks/{year}): the first five picks, each a
//              card with the pick number on the team's color, its logo, the
//              player and his position and school.
//   teamSvg  — a team's page (/mocks/{team}): the team's color, its logo on
//              a white disc, then every pick it makes (round, number,
//              player), the last row "+ N more" past what fits.
//
// Same look as the Draft Sim's (scripts/buildDraftSimPreviewImages.mjs):
// Bebas Neue, the navy bar with the We-Draft logo and the page's address.
// SVG rendered with resvg through server/stream-manager/thumbnail.js's
// helpers (font, text widths, logo fetching). No Firestore here — the
// inputs come in as plain objects, so the same inputs give the same image.

const fs = require("fs");
const path = require("path");
const { measure, pngSize } = require("./stream-manager/thumbnail");

const W = 1200;
const H = 630;
const BAR = 96;
const GOLD = "#f6a21d";
const NAVY = "#070d18";
const INK = "#0b1426";
const FONT = "Bebas Neue";
const WD_LOGO = fs.readFileSync(path.join(__dirname, "..", "src", "assets", "Logo2.png"));

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "").toLowerCase()}` : null);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
const shade = (h, f) => toHex(rgb(h).map((x) => x * f));
const lum = (h) => { const [r, g, b] = rgb(h).map((x) => x / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// The largest size ≤ max at which text fits maxW.
const fit = (text, max, maxW) => Math.min(max, Math.floor((max * maxW) / Math.max(1, measure(text, max))));
// Text cut with an ellipsis until it fits maxW at size.
function clip(text, size, maxW) {
  let t = String(text);
  if (measure(t, size) <= maxW) return t;
  while (t.length > 1 && measure(`${t}…`, size) > maxW) t = t.slice(0, -1).trimEnd();
  return `${t}…`;
}

const imageEl = (logo, x, y, w, h) => (logo
  ? `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:${logo.mime};base64,${logo.b64}"/>`
  : "");

function bottomBar(address) {
  const { w: lw, h: lh } = pngSize(WD_LOGO);
  const h = BAR - 40;
  const w = Math.round((lw / lh) * h);
  return `<rect x="0" y="${H - BAR}" width="${W}" height="${BAR}" fill="${NAVY}"/>
<rect x="0" y="${H - BAR}" width="${W}" height="5" fill="${GOLD}"/>
<image x="40" y="${H - BAR + 20}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${WD_LOGO.toString("base64")}"/>
<text x="${W - 40}" y="${H - BAR / 2 + 15}" text-anchor="end" font-family="${FONT}" font-size="40" fill="#ffffff" letter-spacing="1">${esc(address.toUpperCase())}</text>`;
}

const svgOpen = (defs) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>`;
const playerName = (p) => `${p.First || ""} ${p.Last || ""}`.trim().toUpperCase();
const posSchool = (p) => [p.Position, p.School].filter(Boolean).join(" · ").toUpperCase();

// The whole mock. picks: the first few, in order — { overall, owner, player,
// team: { City, Team, Color1, logo } }; dated: "Updated Oct 27".
function classSvg({ year, rounds, dated, address, picks }) {
  const x0 = 48;
  const rowW = W - x0 * 2;
  const rowH = 64;
  const gap = 8;
  const top = 152;
  const strip = 84;
  const title = `${year} NFL MOCK DRAFT`;
  const sub = [`WEEKLY ${rounds}-ROUND MOCK`, dated && dated.toUpperCase()].filter(Boolean).join("  ·  ");
  const rows = picks.map((p, i) => {
    const y = top + i * (rowH + gap);
    const c1 = hex(p.team?.Color1) || "#0055a5";
    const numInk = lum(c1) > 0.6 ? INK : "#ffffff";
    const logoX = x0 + strip + 14;
    const nameX = logoX + 52 + 16;
    const team = String(p.team?.Team || p.owner || "").toUpperCase();
    const teamW = measure(team, 26);
    const ps = posSchool(p.player || {});
    const name = p.player ? playerName(p.player) : "NO SELECTION";
    const nameMax = x0 + rowW - 24 - teamW - 24 - nameX;
    const psW = Math.min(measure(ps, 28), Math.max(0, nameMax - measure(name, 42) - 16));
    const nameShown = clip(name, 42, nameMax - (psW > 60 ? psW + 16 : 0));
    const nameW = measure(nameShown, 42);
    return `<g>
<clipPath id="r${i}"><rect x="${x0}" y="${y}" width="${rowW}" height="${rowH}" rx="12"/></clipPath>
<g clip-path="url(#r${i})">
<rect x="${x0}" y="${y}" width="${rowW}" height="${rowH}" fill="#ffffff"/>
<rect x="${x0}" y="${y}" width="${strip}" height="${rowH}" fill="${c1}"/>
</g>
<text x="${x0 + strip / 2}" y="${y + rowH / 2 + 16}" text-anchor="middle" font-family="${FONT}" font-size="46" fill="${numInk}">${p.overall}</text>
${imageEl(p.team?.logo, logoX, y + 6, 52, 52)}
<text x="${nameX}" y="${y + rowH / 2 + 15}" font-family="${FONT}" font-size="42" fill="${INK}">${esc(nameShown)}</text>
${psW > 60 ? `<text x="${nameX + nameW + 16}" y="${y + rowH / 2 + 11}" font-family="${FONT}" font-size="28" fill="#7a8597">${esc(clip(ps, 28, psW))}</text>` : ""}
<text x="${x0 + rowW - 24}" y="${y + rowH / 2 + 10}" text-anchor="end" font-family="${FONT}" font-size="26" fill="#9aa4b4" letter-spacing="1">${esc(team)}</text>
</g>`;
  }).join("\n");
  return `${svgOpen(`<radialGradient id="bg" cx="0.5" cy="-0.1" r="1.1"><stop offset="0" stop-color="#12305c"/><stop offset="0.6" stop-color="${NAVY}"/></radialGradient>`)}
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<text x="${x0}" y="92" font-family="${FONT}" font-size="${fit(title, 84, 700)}" fill="#ffffff">${esc(title)}</text>
<text x="${W - x0}" y="92" text-anchor="end" font-family="${FONT}" font-size="${fit(sub, 34, 420)}" fill="${GOLD}" letter-spacing="1.5">${esc(sub)}</text>
<rect x="${x0}" y="114" width="${rowW}" height="3" fill="#ffffff" fill-opacity="0.12"/>
${rows || `<text x="${W / 2}" y="340" text-anchor="middle" font-family="${FONT}" font-size="56" fill="#ffffff">THE FIRST MOCK IS COMING SOON</text>`}
${bottomBar(address)}
</svg>`;
}

// A team's page. team: { City, Team, Color1, logo }; picks: the team's, in
// order — { overall, round, player }.
function teamSvg({ year, dated, address, team, picks }) {
  const c1 = hex(team.Color1) || "#0055a5";
  const bg = lum(c1) > 0.6 ? shade(c1, 0.45) : c1;
  const deep = shade(bg, 0.55);
  const cx = 225;
  const cy = (H - BAR) / 2;
  const r = 165;
  const box = 236;
  const x0 = 440;
  const maxW = W - x0 - 44;
  const full = `${team.City || ""} ${team.Team || ""}`.trim().toUpperCase();
  const kicker = [`${year} NFL MOCK DRAFT`, dated && dated.toUpperCase()].filter(Boolean).join("  ·  ");
  const nameSize = fit(full, 80, maxW);
  const rowH = 46;
  const gap = 6;
  const top = 166;
  const fits = 6;
  const shown = picks.length > fits ? picks.slice(0, fits - 1) : picks;
  const more = picks.length - shown.length;
  const label = (p) => `RD ${p.round}  ·  #${p.overall}`;
  const labelW = 170;
  const rows = shown.map((p, i) => {
    const y = top + i * (rowH + gap);
    const ps = p.player ? String(p.player.Position || "").toUpperCase() : "";
    const psW = ps ? measure(ps, 30) : 0;
    const name = clip(p.player ? playerName(p.player) : "NO SELECTION", 36, maxW - labelW - 28 - psW - 20);
    return `<rect x="${x0}" y="${y}" width="${maxW}" height="${rowH}" rx="10" fill="#000000" fill-opacity="0.24"/>
<text x="${x0 + 16}" y="${y + 33}" font-family="${FONT}" font-size="30" fill="${GOLD}" letter-spacing="1">${esc(label(p))}</text>
<text x="${x0 + labelW}" y="${y + 35}" font-family="${FONT}" font-size="36" fill="#ffffff">${esc(name)}</text>
${ps ? `<text x="${x0 + maxW - 16}" y="${y + 33}" text-anchor="end" font-family="${FONT}" font-size="30" fill="#ffffff" fill-opacity="0.7">${esc(ps)}</text>` : ""}`;
  });
  if (more > 0) {
    const y = top + shown.length * (rowH + gap);
    rows.push(`<text x="${x0 + 16}" y="${y + 33}" font-family="${FONT}" font-size="30" fill="#ffffff" fill-opacity="0.8" letter-spacing="1">+ ${more} MORE PICK${more === 1 ? "" : "S"}</text>`);
  }
  if (!picks.length) rows.push(`<text x="${x0}" y="${top + 40}" font-family="${FONT}" font-size="40" fill="#ffffff" fill-opacity="0.85">NO PICKS IN THIS YEAR'S MOCK</text>`);
  return `${svgOpen(`<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
<filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.35"/></filter>`)}
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" filter="url(#lift)"/>
${imageEl(team.logo, cx - box / 2, cy - box / 2, box, box)}
<text x="${x0}" y="62" font-family="${FONT}" font-size="${fit(kicker, 38, maxW)}" fill="${GOLD}" letter-spacing="2">${esc(kicker)}</text>
<text x="${x0}" y="${62 + nameSize - 4}" font-family="${FONT}" font-size="${nameSize}" fill="#ffffff">${esc(full)}</text>
${rows.join("\n")}
${bottomBar(address)}
</svg>`;
}

module.exports = { W, H, classSvg, teamSvg };
