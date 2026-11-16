import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit } from "firebase/firestore";
const app = initializeApp({ apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4", authDomain: "we-draft.firebaseapp.com", projectId: "we-draft" });
const db = getFirestore(app);
const t = async (name, fn) => { try { const r = await fn(); console.log(name, "OK", r); } catch (e) { console.log(name, "DENIED/ERR", e.code || e.message); } };
await t("liveSlate/current", async () => (await getDoc(doc(db, "liveSlate", "current"))).exists());
await t("liveGames/401856707", async () => { const d = (await getDoc(doc(db, "liveGames", "401856707"))).data(); return d && `${d.away.points}-${d.home.points}`; });
await t("plays", async () => (await getDocs(query(collection(db, "liveGames", "401856707", "plays"), orderBy("seq", "desc"), limit(2)))).size);
process.exit(0);
