// src/utils/recruitSim/regions.js
//
// Seven geographic recruiting regions (spec §9). Edit REGIONS to regroup
// states — every recruit's region comes from his high school's state at
// generation. No home-region bonus is applied anywhere.

export const REGIONS = [
  { key: "NE", label: "Northeast", states: ["ME", "NH", "VT", "MA", "RI", "CT", "NY", "NJ", "PA"] },
  { key: "MA", label: "Mid-Atlantic", states: ["DE", "MD", "DC", "VA", "WV", "NC"] },
  { key: "SE", label: "Southeast", states: ["SC", "GA", "FL"] },
  { key: "DS", label: "Deep South", states: ["AL", "MS", "LA", "AR", "TN", "KY"] },
  { key: "TX", label: "Texas / Plains", states: ["TX", "OK", "KS", "MO", "NE", "IA"] },
  { key: "MW", label: "Midwest", states: ["OH", "MI", "IN", "IL", "WI", "MN", "ND", "SD"] },
  { key: "W", label: "West", states: ["MT", "WY", "CO", "NM", "AZ", "UT", "ID", "NV", "CA", "OR", "WA", "AK", "HI"] },
];
export const REGION_KEYS = REGIONS.map((r) => r.key);
export const REGION_LABEL = Object.fromEntries(REGIONS.map((r) => [r.key, r.label]));
const BY_STATE = Object.fromEntries(REGIONS.flatMap((r) => r.states.map((s) => [s, r.key])));
export const regionOfState = (st) => BY_STATE[st] || null;

// Rough state centers (a HS without coordinates).
export const STATE_CENTER = {
  AL: [32.8, -86.8], AK: [61.4, -152.3], AZ: [34.2, -111.6], AR: [34.9, -92.4], CA: [37.2, -119.5], CO: [39.0, -105.5], CT: [41.6, -72.7],
  DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6], IL: [40.0, -89.2],
  IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8],
  MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8],
  NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5],
  OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9], SD: [44.4, -100.2],
  TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VT: [44.0, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6],
  WI: [44.6, -89.9], WY: [43.0, -107.5],
};

// Great-circle miles.
export function miles(a, b) {
  if (!a || !b) return 800;
  const R = 3959;
  const toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR;
  const dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
