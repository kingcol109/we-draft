import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, doc, setDoc } from "firebase/firestore";

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

const gamePayload = {
  Away: "Florida State", Home: "Indiana", Week: "Week 99 (TEST)", Date: new Date("2026-08-06"),
  Time: "15:30", Neutral: false, HomeScore: 34, AwayScore: 27, Final: true, Featured: true,
  Slug: "florida-state-vs-indiana-8-6-test",
};
const gameRef = await addDoc(collection(db, "schedule26"), gamePayload);
console.log("Created game:", gameRef.id);

const perf1 = {
  playerId: "row_8", playerIds: ["row_8"], playerSlug: "fernando-mendoza-2026-qb",
  playerName: "Fernando Mendoza",
  gameId: gameRef.id, school: "Indiana", opponent: "Florida State", week: "Week 99 (TEST)",
  gameDate: new Date("2026-08-06"), grade: "Great",
  titleLong: "TEST — Fernando Mendoza Torches Florida State", titleShort: "Mendoza Torches FSU",
  statLine: "24/31, 342 YDS, 4 TD, 0 INT",
  slug: "gamepage-test-mendoza-v4", body: "Test.", videoId: "", author: "",
  status: "published", authorId: "test-verification-temp", createdAt: new Date(),
};
const perf1Ref = await addDoc(collection(db, "performances"), perf1);
console.log("Created performance:", perf1Ref.id);

await setDoc(doc(db, "trends", "fernando-mendoza-2026-qb"), {
  Shown: true, Order: 1, Trend: "on fire",
  First: "Fernando", Last: "Mendoza", School: "Indiana",
  Notes: "TEST — Torched FSU for 342 yards and 4 TDs in a statement road win.",
});
await setDoc(doc(db, "trends", "row_196"), {
  Shown: true, Order: 2, Trend: "breakout",
  First: "Ousmane", Last: "Kromah", School: "Florida State",
  Notes: "TEST — 200-yard breakout game against New Mexico State.",
});
await setDoc(doc(db, "trends", "row_115"), {
  Shown: true, Order: 3, Trend: "up",
  First: "Darrell", Last: "Jackson Jr", School: "Florida State",
  Notes: "TEST — Steadily climbing draft boards after a strong August.",
});
console.log("Created 3 trend docs (on fire / breakout / up)");

console.log("TEMP_IDS:", JSON.stringify({ game: gameRef.id, perf1: perf1Ref.id }));
process.exit(0);
