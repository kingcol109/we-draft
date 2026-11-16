import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";
const db = getFirestore(initializeApp({ apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4", authDomain: "we-draft.firebaseapp.com", projectId: "we-draft" }));
const snap = await getDocs(query(collection(db, "players"), where("Eligible", "==", "2027")));
console.log("2027 players:", snap.size);
const keys = {};
snap.docs.forEach(d => Object.keys(d.data()).forEach(k => keys[k] = (keys[k] || 0) + 1));
console.log(JSON.stringify(keys));
for (const p of snap.docs.slice(0, 40)) {
  const ev = await getDocs(collection(db, "players", p.id, "evaluations"));
  if (ev.size) { ev.docs.slice(0, 2).forEach(e => { const x = e.data(); console.log(p.data().Slug, e.id, Object.keys(x).join(","), JSON.stringify(x.strengths), JSON.stringify(x.weaknesses), x.grade); }); break; }
}
const tr = await getDocs(collection(db, "traits"));
tr.docs.forEach(t => console.log("traits", t.id, JSON.stringify(t.data().traits)));
process.exit(0);
