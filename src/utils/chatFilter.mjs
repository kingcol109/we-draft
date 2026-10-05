// src/utils/chatFilter.mjs
//
// Live chat moderation (components/LiveChat.js, api/live-chat.js). The
// page runs it for instant feedback; the API runs it again before writing,
// so it can't be skipped — chat messages are only ever written by the API.
//
// Blocks racial / ethnic and anti-gay slurs, sexual content, and links.
// General profanity is allowed (it's a football chat).
//
// Matching is per word, after normalizing: lowercase, accents dropped,
// look-alike characters mapped (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s …),
// punctuation inside a word removed ("n.i.g" → "nig"), and runs of single
// letters joined ("s l u r" → "slur"). Each term matches with any letter
// repeated ("niiigga") and an optional plural / -ing / -ed style ending
// (plural only for short terms),
// but only as a whole word, so ordinary words that contain one ("Niger",
// "Gamecocks", "Scunthorpe", "analysis") pass.

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", 9: "g", "@": "a", $: "s", "!": "i", "|": "i", "+": "t" };

// Racial / ethnic and anti-gay slurs.
const SLURS = [
  "nigger", "nigga", "niga", "niglet", "nigguh", "sandnigger", "jigaboo", "jiggaboo", "porchmonkey", "junglebunny",
  "pickaninny", "coon", "spic", "spick", "wetback", "beaner", "kike", "kyke", "chink", "chinky", "gook", "zipperhead",
  "slanteye", "towelhead", "raghead", "camelfucker", "paki", "dothead", "injun", "redskin", "halfbreed", "wop", "dago",
  "honky", "honkey", "chinaman", "coolie", "gypo", "gyppo",
  "faggot", "fagot", "fag", "dyke", "tranny", "shemale",
];
// Sexual content.
const SEXUAL = [
  "sex", "sexy", "porn", "porno", "pornhub", "nude", "nudes", "naked", "cock", "cocksucker", "penis",
  "vagina", "pussy", "cunt", "cum", "cumshot", "jizz", "blowjob", "handjob", "rimjob", "boob", "boobies", "tit", "tits",
  "titty", "titties", "horny", "slut", "whore", "anal", "dildo", "orgasm", "masturbate", "jerkoff", "jackoff", "fingering",
  "milf", "onlyfans", "hentai", "rape", "rapist", "molest", "pedo", "pedophile", "erection", "boner", "creampie", "deepthroat",
];
const ENDINGS = "(?:s|es|z|ed|d|ing|in|er|ers)?";
// Short terms that ordinary words extend ("spicy", "spiced", "cumin",
// "cocky", "titans") take only a plural.
const SHORT = new Set(["spic", "coon", "cum", "tit", "cock", "wop", "fag", "paki", "sex", "anal", "gook", "chink", "dago", "injun", "boob", "nude"]);

// "nigga" → /^n+i+g{2,}a+…$/ — each letter may repeat, a doubled letter
// must stay doubled (so "boobs" ≠ "bobs").
const termRegex = (t) => {
  const endings = SHORT.has(t) ? "(?:s|z)?" : ENDINGS;
  let out = "";
  for (let i = 0; i < t.length;) {
    let j = i;
    while (j < t.length && t[j] === t[i]) j++;
    out += j - i > 1 ? `${t[i]}{${j - i},}` : `${t[i]}+`;
    i = j;
  }
  return new RegExp(`^${out}${endings}$`);
};
const RULES = [
  ...SLURS.map((t) => ({ re: termRegex(t), reason: "slur", long: t.length >= 6 })),
  ...SEXUAL.map((t) => ({ re: termRegex(t), reason: "sexual", long: t.length >= 6 })),
];

const normWord = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[013457895@$!|+]/g, (c) => LEET[c] || c)
  .replace(/[^a-z]/g, "");

// The words to check: each word, and each run of single letters joined.
function words(text) {
  const raw = text.split(/\s+/).map(normWord).filter(Boolean);
  const out = [...raw];
  let run = "";
  for (const w of [...raw, ""]) {
    if (w.length === 1) run += w;
    else { if (run.length > 1) out.push(run); run = ""; }
  }
  return out;
}
// Two words run together ("sand nigger", "porch monkey") — checked only
// against long terms, so two short words can't spell a short one ("go ok").
function pairs(text) {
  const raw = text.split(/\s+/).map(normWord).filter(Boolean);
  return raw.slice(1).map((w, i) => raw[i] + w);
}

export const CHAT_MAX = 280;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|tv|ly|co|me|xyz|app)\b)/i;

// null when the message is OK, otherwise a short reason to show the user.
export function chatProblem(text) {
  const t = (text || "").trim();
  if (!t) return "Type a message.";
  if (t.length > CHAT_MAX) return `Keep it under ${CHAT_MAX} characters.`;
  if (LINK.test(t)) return "Links aren't allowed in chat.";
  const candidates = [...words(t).map((w) => [w, false]), ...pairs(t).map((w) => [w, true])];
  for (const [w, pair] of candidates) {
    for (const r of RULES) {
      if ((!pair || r.long) && r.re.test(w)) return r.reason === "slur"
        ? "That message has a slur in it — it can't be posted."
        : "Keep it clean — inappropriate content isn't allowed in chat.";
    }
  }
  return null;
}
