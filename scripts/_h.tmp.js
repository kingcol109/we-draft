const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const s = await getFirestore().collection("historical").get();
  const rows = s.docs.map((d) => d.data());
  const by = {};
  rows.forEach((r) => { const y = r.Year || r.Draft || r.Class || r.Eligible || "?"; by[y] ||= [0, 0]; by[y][0]++; if (r.HighSchool) by[y][1]++; });
  console.log("total", rows.length, "with HS", rows.filter((r) => r.HighSchool).length);
  console.log("keys sample:", Object.keys(rows[0]).join(","));
  console.log("by year [total, withHS]:", JSON.stringify(by));
  process.exit(0);
})();
