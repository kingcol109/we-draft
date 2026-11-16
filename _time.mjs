import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs, getDoc, doc, orderBy, limit } from "firebase/firestore";
const app = initializeApp({ apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4", authDomain: "we-draft.firebaseapp.com", projectId: "we-draft" });
const db = getFirestore(app);
const slug = process.argv[2] || "kanye-udoh-2027-rb";
const t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);
const size = (x) => Math.round(JSON.stringify(x).length / 1024) + "KB";
const timed = async (label, p) => { const s = performance.now(); try { const r = await p; console.log(`${label.padEnd(34)} ${String(Math.round(performance.now()-s)).padStart(5)}ms  done@${ms()}  ${r.docs ? r.docs.length+' docs '+size(r.docs.map(d=>d.data())) : (r.exists?.() ? size(r.data()) : 'missing')}`); return r; } catch (e) { console.log(label, 'ERR', e.code); } };

await timed("warmup config/features", getDoc(doc(db, "config", "features")));
const ps = await timed("player by Slug", getDocs(query(collection(db, "players"), where("Slug", "==", slug))));
const p = { id: ps.docs[0].id, ...ps.docs[0].data() };
console.log("player:", p.First, p.Last, p.School, p.Position, p.Eligible);
const t1 = performance.now();
await Promise.all([
  timed("schools where School==", getDocs(query(collection(db, "schools"), where("School", "==", p.School)))),
  timed(`pct_${p.Position}`, getDoc(doc(db, "compSnapshots", `pct_${p.Position}`))),
  timed(`class_${p.Eligible}_${p.Position}`, getDoc(doc(db, "compSnapshots", `class_${p.Eligible}_${p.Position}`))).then((s) => { const d = s?.data(); console.log("   self in class snapshot:", !!d?.rows?.find(r=>r.i===p.id), "hidden:", !!d?.hidden?.[p.id]); }),
  timed("_ads", getDoc(doc(db, "compSnapshots", "_ads"))),
  timed("evaluations subcollection", getDocs(collection(db, "players", p.id, "evaluations"))),
  timed("reactions subcollection", getDocs(collection(db, "players", p.id, "reactions"))),
  timed("videos playerIds", getDocs(query(collection(db, "videos"), where("playerIds", "array-contains", p.id)))),
  timed("videos latest 30", getDocs(query(collection(db, "videos"), orderBy("Date", "desc"), limit(30)))),
  timed("teammates (players by School)", getDocs(query(collection(db, "players"), where("School", "==", p.School)))),
  timed("trends Shown", getDocs(query(collection(db, "trends"), where("Shown", "==", true)))),
  timed("traits pos", getDoc(doc(db, "traits", p.Position))),
  timed("playerStats", getDoc(doc(db, "playerStats", p.Slug))),
  timed("news by slug", getDocs(query(collection(db, "news"), where("active", "==", true), where("slugs", "array-contains", slug), orderBy("publishedAt", "desc")))),
]);
console.log("all post-player reads finished in", Math.round(performance.now() - t1), "ms");
process.exit(0);
