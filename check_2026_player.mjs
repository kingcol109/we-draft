import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, limit } from "firebase/firestore";
const firebaseConfig = { apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4", authDomain: "we-draft.firebaseapp.com", projectId: "we-draft" };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const snap = await getDocs(query(collection(db, "players"), where("Eligible", "==", "2026"), limit(5)));
snap.docs.forEach(d => console.log(d.id, d.data().Slug, d.data().Link ? "hasLink" : "noLink"));
process.exit(0);
