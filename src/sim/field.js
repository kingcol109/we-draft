// src/sim/field.js
// ── Field geometry, in yards. This is the coordinate system every system
// measures in — the rendered markings are drawn *from* these numbers, not
// the other way around.
//
//   x: 0 (left sideline) → 53.33 (right sideline)
//   y: 0 (back of the offense's own end zone) → 120 (back of the one it attacks)
//      Offense always attacks +y. y = 10 and y = 110 are the goal lines,
//      y = 60 is midfield — where a lab play starts, centered on x. In a
//      drive the line of scrimmage moves with the ball (setLOS). ──

export const FIELD = {
  width: 160 / 3, // 53⅓ yd
  length: 120,
  endZone: 10,
  hashFromSideline: 70.75 / 3, // NFL hashes (70'9")
  numbersFromSideline: 12, // center of the yard numbers
};

export const CX = FIELD.width / 2;
// A live binding: every system reads it when it runs, so moving the ball
// (a drive) is just setting it before the play is built.
export let LOS = 60;
export function setLOS(y) {
  LOS = y;
}

// Depth beyond the line of scrimmage (positive = downfield for the offense).
export const depthOf = (y) => y - LOS;

export const inBounds = (x, y) => x >= 0 && x <= FIELD.width && y >= 0 && y <= FIELD.length;
export const goalLineY = FIELD.length - FIELD.endZone; // offense scores past this

// Run-fit gaps, as x offsets from the ball.
// Offensive line splits (center-to-center) — the gaps sit between them.
export const OL_SPLIT = 1.45;
export const GAPS = {
  "A-L": -0.72, "A-R": 0.72,
  "B-L": -2.17, "B-R": 2.17,
  "C-L": -3.6, "C-R": 3.6,
  "D-L": -5.0, "D-R": 5.0,
};
