// scripts/importDraftTradeChart.mjs
//
// Writes the draft pick trade value chart to `config/draftTradeChart`:
//   { name, values: { "<pick>": points, ... }, picks: 256, updatedAt }
// Values are transcribed as printed on the source chart (picks 1–256),
// cross-checked against a second printing. #152 (31.6) is above #151 (31)
// in both — fix here and re-run if a source corrects it. Overwrites the doc
// each run.
//
// Usage:
//   node --env-file=.env scripts/importDraftTradeChart.mjs [--write]
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const write = process.argv[2] === "--write";

// One array per column of the chart; picks run consecutively from 1.
const COLUMNS = [
  // Round 1 (1–32)
  [3000, 2600, 2200, 1800, 1700, 1600, 1500, 1400, 1350, 1300, 1250, 1200, 1150, 1100, 1050, 1000,
    950, 900, 875, 850, 800, 780, 760, 740, 720, 700, 680, 660, 640, 620, 600, 590],
  // Round 2 (33–64)
  [580, 560, 550, 540, 530, 520, 510, 500, 490, 480, 470, 460, 450, 440, 430, 420,
    410, 400, 390, 380, 370, 360, 350, 340, 330, 320, 310, 300, 292, 284, 276, 270],
  // Round 3 (65–96)
  [265, 260, 255, 250, 245, 240, 235, 230, 225, 220, 215, 210, 205, 200, 195, 190,
    185, 180, 175, 170, 165, 160, 155, 150, 145, 140, 136, 132, 128, 124, 120, 116],
  // Round 4 (97–128)
  [112, 108, 104, 100, 96, 92, 88, 86, 84, 82, 80, 78, 76, 74, 72, 70,
    68, 66, 64, 62, 60, 58, 56, 54, 52, 50, 49, 48, 47, 46, 45, 44],
  // Round 5 (129–160)
  [43, 42, 41, 40, 39.5, 39, 38.5, 38, 37.5, 37, 36.5, 36, 35.5, 35, 34.5, 34,
    33.5, 33, 32.6, 32.2, 31.8, 31.4, 31, 31.6, 31.2, 30.8, 30.4, 30, 29.6, 29.2, 28.8, 28.4],
  // Round 6 (161–192)
  [28, 27.6, 27.2, 26.8, 26.4, 26, 25.6, 25.2, 24.8, 24.4, 24, 23.6, 23.2, 22.8, 22.4, 22,
    21.6, 21.2, 20.8, 20.4, 20, 19.6, 19.2, 18.8, 18.4, 18, 17.6, 17.2, 16.8, 16.4, 16, 15.6],
  // Round 7 (193–224)
  [15.2, 14.8, 14.4, 14, 13.6, 13.2, 12.8, 12.4, 12, 11.6, 11.2, 10.8, 10.4, 10, 9.6, 9.2,
    8.8, 8.4, 8, 7.6, 7.2, 6.8, 6.4, 6, 5.6, 5.2, 4.8, 4.4, 4, 3.6, 3.3, 3],
  // Additional rounds (225–256)
  [2.9, 2.8, 2.7, 2.6, 2.5, 2.4, 2.3, 2.2, 2.1, 2, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4,
    1.3, 1.2, 1.1, 1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4],
];

const flat = COLUMNS.flat();
if (COLUMNS.some((c) => c.length !== 32) || flat.length !== 256) {
  console.error("Each column must have 32 values (256 total).");
  process.exit(1);
}
const values = Object.fromEntries(flat.map((v, i) => [String(i + 1), v]));

const bumps = flat.flatMap((v, i) => (i && v > flat[i - 1] ? [`#${i + 1} (${v} > ${flat[i - 1]})`] : []));
if (bumps.length) console.warn("Non-monotonic picks (as printed):", bumps.join(", "));
console.log(`#1 ${values[1]}, #32 ${values[32]}, #100 ${values[100]}, #256 ${values[256]}`);

if (!write) {
  console.log("Dry run — pass --write to save to config/draftTradeChart.");
  process.exit(0);
}

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
await getFirestore().doc("config/draftTradeChart").set({
  name: "Draft Pick Trade Value Chart",
  picks: flat.length,
  values,
  updatedAt: FieldValue.serverTimestamp(),
});
console.log("Wrote config/draftTradeChart.");
