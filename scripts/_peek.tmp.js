const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const snap = await getFirestore().collection("historical").get();
  const rows = snap.docs.map((d) => d.data());
  console.log("count", rows.length);
  console.log(JSON.stringify(Object.keys(rows[0]).sort()));
  const s = rows.find((r) => r.Team && r.School) || rows[0];
  const pick = (r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => typeof v !== "object" || v === null).slice(0, 40));
  console.log(JSON.stringify(pick(s)));
  const years = {}; rows.forEach((r) => { years[r.Year] = (years[r.Year] || 0) + 1; });
  console.log(JSON.stringify(years));
  console.log(JSON.stringify(rows.filter((r) => /Herbert/.test(r.Last || r.Name || "")).map(pick)));
})();
