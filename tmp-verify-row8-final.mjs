import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
const firebaseConfig = { apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4", authDomain: "we-draft.firebaseapp.com", projectId: "we-draft", storageBucket: "we-draft.appspot.com", messagingSenderId: "411158644687", appId: "1:411158644687:web:01f6198e50779170ad34ba" };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const snap = await getDocs(collection(db, "schedule26", "row_8", "picks"));
console.log("row_8 picks count:", snap.size);
