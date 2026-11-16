const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
(async () => {
  const col = getFirestore().collection("historical");
  const dupe = await col.where("Year", "==", "2007").where("Pick", "==", "1").get();
  if (!dupe.empty) { console.log("Already there:", dupe.docs.map((d) => d.id)); return; }
  const ref = await col.add({
    First: "JaMarcus", Last: "Russell", Player: "JaMarcus Russell", HighSchool: "", State: "",
    School: "LSU", Position: "QB", Year: "2007", Round: "1", Pick: "1", "NFL Team": "Las Vegas Raiders",
    RoundGrade: "", Strengths: [], Weaknesses: [], updatedAt: FieldValue.serverTimestamp(),
  });
  const { updatedAt, ...saved } = (await ref.get()).data();
  console.log("Added", ref.id, JSON.stringify(saved));
})().catch((e) => { console.error(e); process.exit(1); });
