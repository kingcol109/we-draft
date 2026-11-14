// scripts/buildAccoladeIconIndex.js
//
// Rebuilds accoladeIcons/_index (utils/accoladeIcons.js) — every icon row in
// one doc, which the player page's Info tab reads instead of the whole
// collection. Admin → Branding → Misc keeps it current on save / delete;
// run this after editing accoladeIcons any other way.
//
//   node --env-file=.env scripts/buildAccoladeIconIndex.js

const { FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("./firebaseAdmin");

const INDEX_ID = "_index";

async function buildAccoladeIconIndex(db) {
  const snap = await db.collection("accoladeIcons").get();
  const rows = {};
  snap.docs.forEach((d) => {
    if (d.id === INDEX_ID) return;
    const x = d.data();
    if (!x.Kind || !x.Name) return;
    rows[d.id] = { Kind: x.Kind, Name: x.Name, Aliases: x.Aliases || [], Logo: x.Logo || "", LogoDark: x.LogoDark || "" };
  });
  // set() without merge, so deleted icons drop out.
  await db.collection("accoladeIcons").doc(INDEX_ID).set({ rows, builtAt: FieldValue.serverTimestamp() });
  return { icons: Object.keys(rows).length };
}

if (require.main === module) {
  buildAccoladeIconIndex(getFirestore())
    .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { buildAccoladeIconIndex };
