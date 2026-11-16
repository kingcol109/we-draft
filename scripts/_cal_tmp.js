const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const m = (await db.collection("liveMeta").doc("ingest").get()).data();
  for (const w of (m.calendar || []).slice(0, 9)) console.log(w.seasonType, w.week, w.startDate, w.endDate);
  console.log("...", (m.calendar || []).slice(-4).map((w) => `${w.seasonType} ${w.week} ${w.startDate} ${w.endDate}`).join("\n"));
  const s = (await db.collection("liveSlate").doc("current").get()).data();
  const starts = s.games.map((g) => g.startDate).sort();
  console.log("slate week", s.week, "first", starts[0], "last", starts[starts.length - 1], "statuses", JSON.stringify(s.games.reduce((a, g) => ({ ...a, [g.status]: (a[g.status] || 0) + 1 }), {})));
  process.exit(0);
})();
