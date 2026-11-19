// scripts/buildRecruitSimSource.js
//
// The Recruit Sim's source material (src/utils/recruitSim/source.json), from
// the We-Draft data already in Firestore — no new collection, nothing read
// at play time. Every FBS roster (cfbRosters) gives:
//   first / last   name pools, with how often each appears (generation draws
//                  by frequency and recombines them — no real full names
//                  are reproduced, utils/recruitSim/generate.js)
//   hs             high schools as listed on rosters: [name, city, state,
//                  lat, lng, players produced] — hometown coordinates from
//                  the players who came from there (hl), else the state's
//                  center. Producing more players = drawn more often, so
//                  the recruit map looks like the real one.
//   body           height / weight pairs per Recruit Sim position, from the
//                  youngest players on rosters (closest to a HS senior)
//
//   node --env-file=.env scripts/buildRecruitSimSource.js
// Re-run after a roster sync if you want fresher pools; the output is bundled.

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("./firebaseAdmin");

const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
// Roster positions → the Recruit Sim's nine (no K / P — the trait map has none).
const POS = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", OL: "OL", OT: "OL", OG: "OL", G: "OL", C: "OL", T: "OL", IOL: "OL", DE: "EDGE", EDGE: "EDGE", DT: "DL", NT: "DL", DL: "DL", LB: "LB", OLB: "LB", ILB: "LB", MLB: "LB", DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB" };
const BODY_PER_POS = 500;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const okName = (s) => /^[A-Za-z][A-Za-z.'\- ]{0,20}$/.test(s) && !/^(Jr|Sr|II|III|IV)\.?$/i.test(s);

(async () => {
  const db = getFirestore();
  const snap = await db.collection("cfbRosters").get();
  const first = new Map();
  const last = new Map();
  const hs = new Map();
  const body = {};
  let players = 0;
  let season = 0;
  snap.forEach((d) => { season = Math.max(season, Number(d.data().season) || 0); });
  snap.forEach((d) => {
    (d.data().players || []).forEach((p) => {
      players += 1;
      const f = clean(p.first);
      const l = clean(p.last).replace(/,?\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "");
      if (okName(f)) first.set(f, (first.get(f) || 0) + 1);
      if (okName(l)) last.set(l, (last.get(l) || 0) + 1);
      const st = clean(p.hss).toUpperCase();
      const name = clean(p.hs);
      if (name && STATES.has(st)) {
        const key = `${name.toLowerCase()}|${st}`;
        const row = hs.get(key) || { name, city: clean(p.hsc) || "", st, lat: 0, lng: 0, ll: 0, n: 0 };
        row.n += 1;
        if (Array.isArray(p.hl) && p.hl.length === 2 && Number.isFinite(p.hl[0])) { row.lat += p.hl[0]; row.lng += p.hl[1]; row.ll += 1; }
        if (!row.city && p.hsc) row.city = clean(p.hsc);
        hs.set(key, row);
      }
      const pos = POS[String(p.pos || "").toUpperCase()];
      // Youngest on the roster — the closest thing to a HS senior's frame.
      const young = Number(p.yr) <= 1 || (Number(p.rc) && Number(p.rc) >= season);
      if (pos && young && p.ht >= 64 && p.ht <= 82 && p.wt >= 150 && p.wt <= 380) (body[pos] = body[pos] || []).push([p.ht, p.wt]);
    });
  });

  const top = (m, min) => [...m.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]);
  // Deterministic thinning of the body samples (every k-th).
  const thin = (rows) => { const k = Math.max(1, Math.floor(rows.length / BODY_PER_POS)); return rows.filter((_, i) => i % k === 0).slice(0, BODY_PER_POS); };
  const out = {
    builtAt: new Date().toISOString(),
    season,
    players,
    first: top(first, 1),
    last: top(last, 1),
    hs: [...hs.values()].filter((r) => r.city).sort((a, b) => b.n - a.n)
      .map((r) => [r.name, r.city, r.st, r.ll ? +(r.lat / r.ll).toFixed(2) : null, r.ll ? +(r.lng / r.ll).toFixed(2) : null, r.n]),
    body: Object.fromEntries(Object.entries(body).map(([k, v]) => [k, thin(v)])),
  };
  const file = path.join(__dirname, "..", "src", "utils", "recruitSim", "source.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(JSON.stringify({ players, first: out.first.length, last: out.last.length, hs: out.hs.length, body: Object.fromEntries(Object.entries(out.body).map(([k, v]) => [k, v.length])), bytes: fs.statSync(file).size }));
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
