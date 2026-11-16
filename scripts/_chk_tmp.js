const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const s = await db.collection("liveGames").doc("401858476").collection("plays").get();
  const plays = s.docs.map((d) => d.data()).filter((p) => !p.removed);
  const { computeGameStats } = await import("../src/utils/liveStats.mjs");
  const st = JSON.parse(JSON.stringify(computeGameStats(plays)));
  console.log("plays read:", plays.length, "| stats doc bytes:", JSON.stringify(st).length, "| players:", st.players.home.length + st.players.away.length);
  console.log("home pass yds", st.teams.home.passYds, "away pass yds", st.teams.away.passYds);
  process.exit(0);
})();
