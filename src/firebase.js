import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
  storageBucket: "we-draft.appspot.com",
  messagingSenderId: "411158644687",
  appId: "1:411158644687:web:01f6198e50779170ad34ba",
};

export const app = initializeApp(firebaseConfig);   // ✅ export app
export const db = getFirestore(app);
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
