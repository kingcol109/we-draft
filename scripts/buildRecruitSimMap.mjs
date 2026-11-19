// scripts/buildRecruitSimMap.mjs — builds src/components/recruitSim/usRegions.json
// (US states merged into the 7 Recruit Sim regions, Albers USA, simplified).
// One-off: run in a folder with us-atlas@3 topojson-client@3 topojson-simplify@3
// d3-geo@3 installed (not app deps): node buildRecruitSimMap.mjs <out.json>
// Keep REGIONS in sync with src/utils/recruitSim/regions.js. DS/SE labels were
// nudged by hand afterwards (DS [612,398], SE [772,452]).
import fs from "fs";
import { merge, mesh, feature } from "topojson-client";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { geoPath } from "d3-geo";
const out = process.argv[2];
let us = JSON.parse(fs.readFileSync("node_modules/us-atlas/states-albers-10m.json", "utf8"));
us = presimplify(us); us = simplify(us, quantile(us, 0.12));
const NAME = {Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",Colorado:"CO",Connecticut:"CT",Delaware:"DE","District of Columbia":"DC",Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",Virginia:"VA",Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY"};
const REGIONS = {NE:["ME","NH","VT","MA","RI","CT","NY","NJ","PA"],MA:["DE","MD","DC","VA","WV","NC"],SE:["SC","GA","FL"],DS:["AL","MS","LA","AR","TN","KY"],TX:["TX","OK","KS","MO","NE","IA"],MW:["OH","MI","IN","IL","WI","MN","ND","SD"],W:["MT","WY","CO","NM","AZ","UT","ID","NV","CA","OR","WA","AK","HI"]};
const geoms = us.objects.states.geometries;
const st = (g) => NAME[g.properties.name];
const path = geoPath(null).digits(0);
const regionOf = Object.fromEntries(Object.entries(REGIONS).flatMap(([k, v]) => v.map((s) => [s, k])));
const res = { w: 975, h: 610, regions: {}, label: {}, inner: "" };
for (const [k, list] of Object.entries(REGIONS)) {
  const gs = geoms.filter((g) => list.includes(st(g)));
  res.regions[k] = path(merge(us, gs));
  // Label on one anchor state so it always sits inside the region.
  const ANCHOR = { NE: "NY", MA: "VA", SE: "GA", DS: "MS", TX: "KS", MW: "WI", W: "UT" };
  res.label[k] = path.centroid(feature(us, geoms.find((g) => st(g) === ANCHOR[k]))).map(Math.round);
}
// State lines inside a region (thin); region borders are the region outlines.
res.inner = path(mesh(us, us.objects.states, (a, b) => a !== b && regionOf[st(a)] === regionOf[st(b)]));
const missing = geoms.filter((g) => !st(g)).map((g) => g.properties.name);
console.log("unmapped:", missing.join(", ") || "none");
fs.writeFileSync(out, JSON.stringify(res));
console.log("bytes", fs.statSync(out).size, res.label);
