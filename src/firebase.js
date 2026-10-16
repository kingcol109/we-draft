import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, GoogleAuthProvider } from "firebase/auth";

// Local testing only: a build made with REACT_APP_FIRESTORE_EMULATOR_HOST
// (e.g. "127.0.0.1:8085") reads/writes the Firestore emulator under a
// demo- project id, so it can never touch production data. Unset in every
// real build, where this is all dead code.
const EMULATOR_HOST = process.env.REACT_APP_FIRESTORE_EMULATOR_HOST;

const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: EMULATOR_HOST ? "demo-wedraft" : "we-draft",
  storageBucket: "we-draft.appspot.com",
  messagingSenderId: "411158644687",
  appId: "1:411158644687:web:01f6198e50779170ad34ba",
};

export const app = initializeApp(firebaseConfig);   // ✅ export app
export const db = getFirestore(app);
if (EMULATOR_HOST) {
  const [host, port] = EMULATOR_HOST.split(":");
  connectFirestoreEmulator(db, host, Number(port));
}
// initializeAuth rather than getAuth: getAuth also wires in the popup/redirect
// resolver, which loads Google's auth iframe (~95KB) and a getProjectConfig
// call on every page view — and Firestore holds its first request until
// Auth finishes starting up, so that sat on the critical path of every
// page's first data. The resolver is passed only at the one place a popup
// is actually opened (AuthContext.js loginWithGoogle).
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});
export const provider = new GoogleAuthProvider();
