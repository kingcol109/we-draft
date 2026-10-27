// src/utils/draftSim/bestGame.js
//
// A drafted player's standout game for Walter Donaldson ("4 sacks against
// Tennessee"). Pure, so both the sim (data.js loadBestGame) and the weekly
// snapshot build (scripts/buildSimGamesSnapshot.mjs) score games the same way.

// The best single-game line across a game log (box-score format:
// { defensive: { SACKS: "4" } }), only if it's genuinely big.
export function bestGame(games) {
  const num = (v) => parseFloat(v) || 0;
  const plural = (n, one, many) => `${n % 1 ? n.toFixed(1) : n} ${n === 1 ? one : many}`;
  let best = null;
  games.forEach((g) => {
    const s = g.stats || {};
    const d = s.defensive || {}, ints = s.interceptions || {}, pa = s.passing || {}, ru = s.rushing || {}, re = s.receiving || {};
    const options = [
      [num(d.SACKS) >= 2, num(d.SACKS) * 3, plural(num(d.SACKS), "sack", "sacks")],
      [num(ints.INT) >= 2, num(ints.INT) * 3.5, plural(num(ints.INT), "interception", "interceptions")],
      [num(d.TFL) >= 3, num(d.TFL) * 2, plural(num(d.TFL), "tackle for loss", "tackles for loss")],
      [num(d.TOT) >= 12, num(d.TOT) * 0.5, plural(num(d.TOT), "tackle", "tackles")],
      [num(pa.YDS) >= 350, num(pa.YDS) / 60, `${num(pa.YDS)} passing yards`],
      [num(pa.TD) >= 4, num(pa.TD) * 1.8, plural(num(pa.TD), "touchdown pass", "touchdown passes")],
      [num(ru.YDS) >= 150, num(ru.YDS) / 30, `${num(ru.YDS)} rushing yards`],
      [num(ru.TD) >= 3, num(ru.TD) * 2, plural(num(ru.TD), "rushing touchdown", "rushing touchdowns")],
      [num(re.YDS) >= 150, num(re.YDS) / 30, `${num(re.YDS)} receiving yards`],
      [num(re.REC) >= 10, num(re.REC) * 0.6, plural(num(re.REC), "catch", "catches")],
      [num(re.TD) >= 3, num(re.TD) * 2, plural(num(re.TD), "touchdown catch", "touchdown catches")],
    ];
    options.forEach(([ok, score, line]) => {
      if (ok && g.opponent && (!best || score > best.score)) best = { score, line, opp: g.opponent };
    });
  });
  return best && { line: best.line, opp: best.opp };
}
