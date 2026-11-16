import { initializeApp } from "firebase/app";
import { getFirestore, doc, deleteDoc, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
  storageBucket: "we-draft.appspot.com",
  messagingSenderId: "411158644687",
  appId: "1:411158644687:web:01f6198e50779170ad34ba",
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

await deleteDoc(doc(db, "schedule26", "4IXO1AxUVgRALeIStSQj"));
console.log("Deleted FINAL test game");
await deleteDoc(doc(db, "schedule26", "KqxYAp39XqQIqyrKVV1E"));
console.log("Deleted PREGAME test game");

const snap = await getDocs(collection(db, "schedule26"));
const leftover = snap.docs.filter(d => (d.data().Week || "").includes("TEST"));
console.log("Leftover TEST games:", leftover.length, "| Total schedule26 docs:", snap.size);
process.exit(0);
