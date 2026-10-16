// src/utils/playerMetaDescription.js
//
// The <meta name="description"> (and og:/twitter:description) for a player
// page. Built only from facts the page already has — the player record and
// the community aggregates — never from a user's written evaluation, so the
// snippet reads as a complete sentence and can't leak eval text. Anything
// missing is simply left out rather than guessed. Aims for ~160 characters:
// the richest variant that fits wins, least important details drop first.
const TARGET_LENGTH = 160;

function weightLabel(weight) {
  const w = String(weight ?? "").trim();
  if (!w) return "";
  return /^\d+(\.\d+)?$/.test(w) ? `${w} lbs` : w;
}

function possessive(name) {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/**
 * @param {object} p
 * @param {string} [p.name]           "First Last"
 * @param {string} [p.school]
 * @param {string} [p.position]
 * @param {string} [p.classYear]      draft class, e.g. "2027" (ignored unless 4 digits)
 * @param {string} [p.height]         already display-formatted, e.g. 6'3"
 * @param {string|number} [p.weight]
 * @param {string} [p.communityGrade] e.g. "Second Round" (omit for none / Watchlist)
 * @param {boolean} [p.hasTraits]     community strengths/weaknesses exist
 * @param {number} [p.publicEvalCount]
 */
export function buildPlayerMetaDescription(p = {}) {
  const name = (p.name || "").trim();
  const school = (p.school || "").trim();
  const position = (p.position || "").trim();
  const year = /^\d{4}$/.test(String(p.classYear || "").trim()) ? String(p.classYear).trim() : "";
  const grade = p.communityGrade && p.communityGrade !== "Watchlist" ? p.communityGrade : "";
  const measurements = [String(p.height || "").trim(), weightLabel(p.weight)].filter(Boolean).join(", ");
  const evalCount = Number(p.publicEvalCount) || 0;

  const report = `${year ? year + " " : ""}NFL Draft scouting report`;
  const subject = name ? `${possessive(name)} ${report}` : `this prospect's ${report}`;
  const identity = [school, position].filter(Boolean).join(" ");

  const lead = (withMeasurements) => {
    const details = [identity, withMeasurements ? measurements : ""].filter(Boolean).join(", ");
    return `Explore ${subject}${details ? `: ${details}` : ""}${grade ? `, with a community grade of ${grade}` : ""}.`;
  };

  const evals = `${evalCount} public scouting ${evalCount === 1 ? "evaluation" : "evaluations"}`;
  const follow = p.hasTraits && evalCount > 0 ? `See community strengths, weaknesses and ${evals}.`
    : p.hasTraits ? "See community strengths and weaknesses."
    : evalCount > 0 ? `Read ${evals}.`
    : "Add your own grade and see the community consensus.";
  const shortFollow = "See community strengths and weaknesses.";

  // Priority: identity + grade > measurements > the follow-up sentence.
  const candidates = [
    `${lead(true)} ${follow}`,
    p.hasTraits ? `${lead(true)} ${shortFollow}` : "",
    lead(true),
    `${lead(false)} ${follow}`,
    p.hasTraits ? `${lead(false)} ${shortFollow}` : "",
    lead(false),
  ].filter(Boolean).map((s) => s.replace(/\s+/g, " ").trim());

  return candidates.find((s) => s.length <= TARGET_LENGTH)
    || candidates.reduce((a, b) => (b.length < a.length ? b : a));
}
