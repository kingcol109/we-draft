// scripts/lib/googleAuth.js
//
// One service account key, used two ways: Firestore Admin SDK writes, and
// GA4 Data API reads. Simpler than juggling two separate credentials —
// the same GCP service account can be granted a Firestore/Datastore IAM
// role in Cloud Console AND added as a "Viewer" inside GA4's own Property
// Access Management (a separate, non-IAM permission system specific to
// Analytics). See the setup steps below for exactly how to grant both.
//
// The key is stored as a single-line JSON string in the
// GOOGLE_SERVICE_ACCOUNT_KEY env var. Most env var UIs (Vercel, GitHub
// Actions secrets, local .env files) don't preserve real newlines inside a
// value, so the private_key field commonly arrives with literal "\n"
// two-character sequences instead of actual line breaks — this loader
// converts those back before anything tries to use the key.

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY env var is not set. It should contain the full service account JSON key as a single-line string."
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. Make sure the entire key file's contents were pasted in as one line (see setup steps)."
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key — this doesn't look like a full service account key file."
    );
  }

  // Undo the literal "\n" escaping most env var storage introduces.
  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");

  return parsed;
}

module.exports = { loadServiceAccount };