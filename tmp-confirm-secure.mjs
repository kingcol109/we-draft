import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
const firebaseConfig = { apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4", authDomain: "we-draft.firebaseapp.com", projectId: "we-draft", storageBucket: "we-draft.appspot.com", messagingSenderId: "411158644687", appId: "1:411158644687:web:01f6198e50779170ad34ba" };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
try {
  await setDoc(doc(db, "schedule26", "row_8", "picks", "unauthorized-uid"), { uid: "unauthorized-uid" });
  console.log("UNEXPECTED: canonical picks write succeeded — rule NOT secure!");
} catch (e) { console.log("canonical picks write correctly rejected:", e.code); }
try {
  await setDoc(doc(db, "users", "unauthorized-uid", "picks", "row_8"), { uid: "unauthorized-uid" });
  console.log("UNEXPECTED: mirror picks write succeeded — rule NOT secure!");
} catch (e) { console.log("mirror picks write correctly rejected:", e.code); }
