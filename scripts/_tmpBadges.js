const { db } = require("./firebaseAdmin");
db.collection("simBadges").get().then((s) => { s.docs.forEach((d) => { const x = d.data(); console.log(JSON.stringify({ id: d.id, title: x.title, description: x.description, rarity: x.rarity, active: x.active, icon: (x.icon || "").slice(0, 40) })); }); process.exit(0); });
