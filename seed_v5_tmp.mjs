import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";

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

const g = {
  Away: "Florida State", Home: "Indiana", Week: "Week 99 (TEST)", Date: new Date("2026-08-06"),
  Time: "15:30", Neutral: false, HomeScore: 34, AwayScore: 27, Final: true, Featured: true,
  Notes: "Fernando Mendoza carved up the Florida State secondary all afternoon, leading Indiana to a statement home win.",
  Slug: "florida-state-vs-indiana-8-6-test",
};
const ref = await addDoc(collection(db, "schedule26"), g);
console.log("Created test game:", ref.id);
process.exit(0);
