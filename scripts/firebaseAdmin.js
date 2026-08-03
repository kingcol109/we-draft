// scripts/lib/firebaseAdmin.js
//
// Initializes the Firebase Admin SDK once (cached across warm serverless
// invocations and across multiple requires within a single script run) and
// exposes both Firestore (for the actual sync writes) and Auth (for
// verifying the admin panel's ID token in api/sync-analytics.js — Firestore
// security rules don't apply to plain HTTP endpoints, so that check has to
// happen here instead).
//
// Written against the modular firebase-admin API (v12+): initializeApp,
// getApps, and cert live under "firebase-admin/app"; Firestore and Auth are
// separate subpath imports rather than methods hanging off a single
// default-exported `admin` object the way older firebase-admin versions
// worked. `require("firebase-admin")` alone does NOT expose `.credential`,
// `.firestore()`, `.auth()`, or `.apps` in this version — attempting to use
// those produces exactly the "Cannot read properties of undefined" error
// this file used to throw.

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore: getFirestoreService } = require("firebase-admin/firestore");
const { getAuth: getAuthService } = require("firebase-admin/auth");
const { loadServiceAccount } = require("./googleAuth");

let app = null;

function getApp() {
  if (!app) {
    // Reuse an already-initialized app if one exists (e.g. hot-reload in
    // dev, or another script in the same process already called this).
    const existing = getApps();
    if (existing.length > 0) {
      app = existing[0];
    } else {
      const serviceAccount = loadServiceAccount();
      app = initializeApp({
        credential: cert(serviceAccount),
      });
    }
  }
  return app;
}

function getFirestore() {
  return getFirestoreService(getApp());
}

function getAuth() {
  return getAuthService(getApp());
}

module.exports = { getFirestore, getAuth };