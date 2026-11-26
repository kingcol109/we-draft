// src/utils/film/voice.js
//
// Voice tagging for the Film Manager's hot play (user, 2026-11-25): right
// after a play goes hot, the mic listens and the names said are tagged on it.
//
// The speech engine (Chrome's built-in recognition) only hears words; this
// turns them into players — never "any name", only the game's people (the
// focus players and the two teams' rosters), so a mishearing still lands:
//   a name: last, first, or both ("Kromah", "Ousmane Kromah", "Tommy")
//   a sound-alike: "Chroma" → Kromah (a phonetic key + spelling distance)
//   a number: "number one", "32", "number 11 Clemson" (the team breaks a tie)
//   a correction the user taught it: a heard word → that player (aliases)
//   "remove …" / "not …" / "take off …": untag instead
//   a LABEL after a name: "Kromah great", "Robinson very bad" (user, 2026-11-25)
//   TRAITS after a name: "Kromah good vision patience" — only that player's
//     position + generic traits, so they match like names do
//   The order is name → label → trait (user), and the label and traits are
//   optional. A label / trait with no name before it goes to the last player
//   named (a pause can split "Kromah… great" into two phrases — opts.current
//   carries him over), else to the play's only player.
// Pure.

const WORD_NUM = { zero: 0, oh: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;
export const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// A rough sound-alike key: first letter kept, similar sounds folded, vowels dropped.
export function soundKey(word) {
  let w = norm(word).replace(/ /g, "");
  if (!w) return "";
  w = w.replace(/^kn|^gn|^pn|^wr/, (m) => m[1]).replace(/ph/g, "f").replace(/ck|q|ch(?=r)/g, "k").replace(/c(?![eiy])/g, "k").replace(/c/g, "s").replace(/x/g, "ks").replace(/z/g, "s").replace(/dg/g, "j").replace(/gh/g, "g").replace(/th/g, "t").replace(/v/g, "f").replace(/y/g, "i");
  const first = w[0];
  const rest = w.slice(1).replace(/[aeiouhw]/g, "");
  return (first + rest).replace(/(.)\1+/g, "$1");
}
export function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const sim = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);

// "number one one" / "twenty three" / "32" → digits.
function wordsToNumbers(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) { out.push(t); continue; }
    if (TENS[t] != null) {
      const next = WORD_NUM[tokens[i + 1]];
      if (next != null && next > 0 && next < 10) { out.push(String(TENS[t] + next)); i += 1; } else out.push(String(TENS[t]));
      continue;
    }
    out.push(WORD_NUM[t] != null && (tokens[i - 1] === "number" || tokens[i - 1] === "no" || tokens[i - 1] === "num") ? String(WORD_NUM[t]) : t);
  }
  return out;
}

// A person's name keys: last (without Jr. etc.), first, full.
const keysOf = (p) => {
  const parts = norm(p.name).split(" ").filter((w) => !SUFFIX.test(w));
  const first = parts[0] || "";
  const last = parts.slice(1).join(" ") || first;
  return { first, last, full: `${first} ${last}`.trim(), lastJoined: last.replace(/ /g, "") };
};

// How well a heard phrase names this person: 0–1.
function scorePerson(phrase, p) {
  const k = keysOf(p);
  const joined = phrase.replace(/ /g, "");
  let best = 0;
  [[k.full, 1], [k.last, 0.97], [k.lastJoined, 0.97], [k.first, 0.8]].forEach(([key, weight]) => {
    if (!key) return;
    const kj = key.replace(/ /g, "");
    if (joined === kj) best = Math.max(best, weight);
    else {
      const s = Math.max(sim(joined, kj), soundKey(joined) === soundKey(kj) && kj.length >= 4 ? 0.88 : 0);
      best = Math.max(best, s * weight);
    }
  });
  return best;
}

// Who a phrase might have meant, best first — the players being watched up
// front — for "Who did you mean?" when nothing matched or it's a tie.
// min: leave out anyone the phrase barely names (a stray word isn't a question).
export function suggest(phrase, people, max = 6, min = 0) {
  const seen = new Set();
  return people.map((p) => ({ p, s: scorePerson(phrase, p) + (p.focus ? 0.2 : 0) }))
    .filter((x) => x.s >= min)
    .sort((a, b) => b.s - a.s)
    // One of each person (a We-Draft player and his roster entry are the same man).
    .filter(({ p }) => { const id = `${norm(p.name)}|${norm(p.team)}`; if (seen.has(id)) return false; seen.add(id); return true; })
    .slice(0, max).map((x) => x.p.key);
}

const FILLER = new Set(["add", "and", "plus", "also", "the", "a", "uh", "um", "on", "off", "with", "tag", "number", "no", "num", "his", "him", "play", "was", "is", "label", "trait", "traits"]);
// The labels, as said.
// Chrome often hears "bad" as "badge" (user, 2026-11-25).
const LABEL_WORDS = [["very bad", "Very bad"], ["very badge", "Very bad"], ["great", "Great"], ["good", "Good"], ["okay", "Okay"], ["ok", "Okay"], ["neutral", "Neutral"], ["bad", "Bad"], ["badge", "Bad"], ["bads", "Bad"]];
const LABEL_TOKENS = new Set(LABEL_WORDS.flatMap(([w]) => w.split(" ")).filter((w) => w !== "very"));

// The best trait (of his list) the words at i name: { n, value, s } or null.
// A trait also answers to its last word(s) when no other trait on the list
// ends that way (user, 2026-11-25: "agility" = Lateral Agility).
// Tails only count when the word before isn't a stray one ("arm strength" for
// a back is NOT Play Strength) — tails: false leaves them out.
function traitKeys(list, tails = true) {
  const out = list.map((tr) => ({ tr, k: norm(tr).replace(/ /g, ""), tail: false }));
  if (!tails) return out;
  const ends = new Map();
  list.forEach((tr) => {
    const w = norm(tr).split(" ");
    for (let j = 1; j < w.length; j += 1) {
      const k = w.slice(j).join("");
      if (k.length < 4) continue;
      ends.set(k, ends.has(k) && ends.get(k) !== tr ? null : tr);
    }
  });
  ends.forEach((tr, k) => { if (tr && !out.some((o) => o.k === k)) out.push({ tr, k, tail: true }); });
  return out;
}
function traitAt(tokens, i, list, tails = true) {
  let best = null;
  const keys = traitKeys(list, tails);
  for (let n = 3; n >= 1; n -= 1) {
    if (i + n > tokens.length) continue;
    const phrase = tokens.slice(i, i + n).join("");
    for (const { tr, k, tail } of keys) {
      if (tail && phrase !== k) continue; // a tail has to be said exactly
      const sc = phrase === k ? 1 : Math.max(sim(phrase, k), soundKey(phrase) === soundKey(k) && k.length >= 5 ? 0.88 : 0);
      if (sc >= 0.86 && (!best || sc > best.s || (sc === best.s && n > best.n))) best = { n, value: tr, s: sc };
    }
    if (best && best.s >= 0.99) break;
  }
  return best;
}

/**
 * Heard text → what to do on the hot play.
 * people: [{ key, name, team, jersey, focus? }]; aliases: { heardPhrase: key };
 * opts: { traitsOf(key) → [trait names], sole: the play's only player's key,
 *   current: the last player named before this phrase }.
 * → { add: [key], remove: [key], labels: { key: label }, traits: { key: [trait] }, last (the last player named),
 *     heard: [{ phrase, key | null, how, value? }] }
 */
export function parseVoice(text, people, aliases = {}, opts = {}) {
  const traitsOf = opts.traitsOf || (() => []);
  const labels = {};
  const traits = {};
  let current = opts.current || null; // the last player named (labels / traits go to him)
  const tokens = wordsToNumbers(norm(text).split(" ").filter(Boolean));
  const add = [];
  const remove = [];
  const heard = [];
  const teamOf = (w) => people.find((p) => p.team && norm(p.team).split(" ").includes(w))?.team || null;
  let removing = false;
  const used = new Set();
  const take = (key, phrase, how) => {
    heard.push({ phrase, key, how });
    if (!key) return;
    (removing ? remove : add).push(key);
    current = removing ? null : key;
  };
  const whose = () => current || opts.sole || null;
  for (let i = 0; i < tokens.length; i += 1) {
    if (used.has(i)) continue;
    const t = tokens[i];
    if (["remove", "not", "untag", "delete", "minus"].includes(t) || (t === "take" && tokens[i + 1] === "off")) { removing = true; if (t === "take") used.add(i + 1); continue; }
    if (FILLER.has(t)) { if (t === "add" || t === "plus") removing = false; continue; }
    // A label.
    const two = tokens.slice(i, i + 2).join(" ");
    const lab = LABEL_WORDS.find(([w]) => w.includes(" ") && w === two) || LABEL_WORDS.find(([w]) => w === t);
    if (lab && !removing) {
      const n = lab[0].split(" ").length;
      for (let j = i; j < i + n; j += 1) used.add(j);
      const who = whose();
      heard.push(who ? { phrase: lab[0], key: who, how: "label", value: lab[1] } : { phrase: lab[0], key: null, how: "label — say a name first" });
      if (who) labels[who] = lab[1];
      continue;
    }
    // A jersey number (a team word after it breaks a tie).
    if (/^\d{1,2}$/.test(t)) {
      const team = teamOf(tokens[i + 1]);
      let cands = people.filter((p) => String(p.jersey) === t);
      if (cands.length > 1 && team) cands = cands.filter((p) => p.team === team);
      if (cands.length > 1) cands = cands.filter((p) => p.focus).length === 1 ? cands.filter((p) => p.focus) : cands;
      if (team) used.add(i + 1);
      if (cands.length === 1) take(cands[0].key, `#${t}${team ? ` ${team}` : ""}`, "number");
      else heard.push({ phrase: `#${t}${team ? ` ${team}` : ""}`, key: null, how: cands.length ? "several wear it" : "no one wears it", options: cands.map((p) => p.key).slice(0, 8) });
      continue;
    }
    // A trait of the player being talked about — unless the words name a player better.
    const who = removing ? null : whose();
    const free = i === 0 || used.has(i - 1) || FILLER.has(tokens[i - 1]) || LABEL_WORDS.some(([w]) => w.split(" ").pop() === tokens[i - 1]);
    const tr = who ? traitAt(tokens, i, traitsOf(who), free) : null;
    // A name: the longest run of words (up to 3) that names someone well —
    // the players being watched (focus) first; the rosters only if none of
    // them fits (user, 2026-11-25: "Singleton" is the focus Singleton).
    // A name never takes in a label or filler word after it (user, 2026-11-25:
    // "patrick overmyer bad" was read as one name — close enough — and "bad"
    // was lost). The best-scoring run wins; a longer one only on a tie.
    const nameIn = (group) => {
      let best = null;
      for (let n = 3; n >= 1; n -= 1) {
        if (i + n > tokens.length) continue;
        const words = tokens.slice(i, i + n);
        if (words.some((w, j) => j > 0 && (LABEL_TOKENS.has(w) || FILLER.has(w) || used.has(i + j)))) continue;
        const phrase = words.join(" ");
        if (aliases[phrase]) return { key: aliases[phrase], n, phrase, how: "taught" };
        const scored = group.map((p) => ({ p, s: scorePerson(phrase, p) })).sort((a, b) => b.s - a.s);
        const [a, b] = scored;
        if (a && a.s >= 0.8 && (!b || a.s - b.s >= 0.06 || a.s >= 0.99)) { if (!best || a.s > best.s + 0.001) best = { key: a.p.key, n, phrase, how: a.s >= 0.99 ? "name" : "sounds like", s: a.s }; }
        // Two (or more) fit as well: a tie to ask about — unless a longer phrase did better.
        else if (a && a.s >= 0.8 && !tie) tie = { n, phrase, options: scored.filter((x) => a.s - x.s < 0.06).map((x) => x.p.key).slice(0, 6) };
      }
      if (best) { delete best.s; tie = null; }
      return best;
    };
    let tie = null;
    const focusPeople = people.filter((p) => p.focus);
    let found = (focusPeople.length && nameIn(focusPeople)) || nameIn(people);
    if (found && found.how !== "taught" && focusPeople.some((p) => p.key === found.key)) found = { ...found, how: `${found.how} · watching` };
    const nameScore = found ? (found.how === "taught" || found.how.startsWith("name") ? 1 : 0.9) : 0;
    if (tr && tr.s >= nameScore) {
      for (let j = i; j < i + tr.n; j += 1) used.add(j);
      traits[who] = [...new Set([...(traits[who] || []), tr.value])];
      heard.push({ phrase: tokens.slice(i, i + tr.n).join(" "), key: who, how: "trait", value: tr.value });
    } else if (found) {
      for (let j = i; j < i + found.n; j += 1) used.add(j);
      take(found.key, found.phrase, found.how);
    } else if (tie) {
      for (let j = i; j < i + tie.n; j += 1) used.add(j);
      heard.push({ phrase: tie.phrase, key: null, how: "which one?", options: tie.options });
    } else if (t.length >= 3) heard.push({ phrase: t, key: null, how: "no match", options: suggest(t, people, 3, 0.62) });
  }
  return { add: [...new Set(add)], remove: [...new Set(remove)], labels, traits, heard, last: current };
}

// Corrections the user taught it (this browser): heard phrase → player key.
const ALIAS_KEY = "wd.film.voiceAliases";
export const loadAliases = () => { try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || "{}"); } catch { return {}; } };
export const teach = (phrase, key) => { const a = { ...loadAliases(), [norm(phrase)]: key }; try { localStorage.setItem(ALIAS_KEY, JSON.stringify(a)); } catch { /* private window */ } return a; };

// Answering "Did you mean …?" out loud (user, 2026-11-25: never "pick below").
// options: [key] (asked in this order). → a key, "skip", or null (not an answer).
const ORDINAL = { first: 0, one: 0, "1": 0, "1st": 0, second: 1, two: 1, to: 1, too: 1, "2": 1, "2nd": 1, third: 2, three: 2, "3": 2, "3rd": 2 };
export function answerAsk(text, options, people) {
  const tokens = norm(text).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  if (tokens.some((w) => ["skip", "nobody", "none", "neither", "cancel"].includes(w)) || /\b(never mind|no one|nevermind)\b/.test(norm(text))) return "skip";
  if (options.length === 1 && tokens.some((w) => ["yes", "yeah", "yep", "yup", "correct", "right", "sure"].includes(w))) return options[0];
  if (tokens.length === 1 && ["no", "nope"].includes(tokens[0])) return "skip";
  const ord = tokens.map((w) => ORDINAL[w]).find((x) => x != null);
  // A name (or part of one) of one of the choices.
  const choices = options.map((k) => people.find((p) => p.key === k)).filter(Boolean);
  const phrases = [];
  for (let i = 0; i < tokens.length; i += 1) for (let n = 1; n <= 3 && i + n <= tokens.length; n += 1) phrases.push(tokens.slice(i, i + n).join(" "));
  const best = phrases.flatMap((ph) => choices.map((p) => ({ key: p.key, s: scorePerson(ph, p) })))
    .filter((x) => x.s >= 0.75).sort((a, b) => b.s - a.s)[0] || null;
  if (best) return best.key;
  // A jersey number.
  const num = wordsToNumbers(["number", ...tokens]).find((w) => /^\d{1,2}$/.test(w));
  if (num) { const p = choices.find((x) => String(x.jersey) === num); if (p) return p.key; }
  if (ord != null && options[ord]) return options[ord];
  return null;
}
