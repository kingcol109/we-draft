// src/utils/evaluationCopies.js
//
// Every evaluation is saved twice: the canonical players/{playerId}/
// evaluations/{uid} copy (public-read — Community Grade, strengths/
// weaknesses bars and NFL fit are aggregated client-side from it, private
// evals included) and the owner-only mirror users/{uid}/evaluations/
// {playerId}. Firestore rules can't hide single fields of a readable doc,
// so what the public copy holds is what the public can read:
//   - never the author's email (nothing public reads it), and
//   - for a private eval, never its written take or game notes — only the
//     structured fields the aggregates use. Those live on the mirror alone.
// firestore.rules rejects a canonical write that breaks either rule.
const PRIVATE_EVAL_FIELDS = ["evaluation", "gameNotes"];

export function canonicalEvalData(evalData) {
  const copy = { ...evalData };
  delete copy.email;
  if (copy.visibility !== "public") PRIVATE_EVAL_FIELDS.forEach((f) => delete copy[f]);
  return copy;
}
