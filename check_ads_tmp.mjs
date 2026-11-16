import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, getDoc } from "firebase/firestore";

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

const snap = await getDocs(collection(db, "ads"));
console.log("Ads count:", snap.size);
snap.docs.slice(0, 2).forEach((d) => console.log(d.id, JSON.stringify(d.data()).slice(0, 200)));

const vsnap = await getDoc(doc(db, "videos", "row_12"));
console.log("Video row_12 exists:", vsnap.exists());
if (vsnap.exists()) console.log(JSON.stringify(vsnap.data(), null, 2));

process.exit(0);
