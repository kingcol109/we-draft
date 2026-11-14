// src/utils/pitchMessages.js
//
// The Instagram outreach DMs, in the order they're sent (Admin → Social →
// Pitch shows each one filled in for the player you pick, with Copy).
// {first} becomes the player's first name ("Hey Israel!"). They're sent by
// hand from the Instagram app — the API can't start a conversation — so a
// message with no text yet just shows as a slot to come.
//
// A message can have two versions:
//   text      a player who already has a page on We-Draft.com
//   noPage    a recruit whose page isn't live yet (the 2030 class until
//             it's promoted on signing day)
// pitchText() picks the right one.
const OPENING = "I’m reaching out from We-Draft.com, an NFL Draft and college football website. We cover draft prospects and try to introduce them to a wider audience.";
const ASK = "We’d send you a few questions, you pick one that interests you, and answer in just 1–3 sentences. Won’t take more than a minute. We would add your answer to your profile.";
const CLOSE = "Would you be interested in participating? Appreciate your time!";

export const PITCH_MESSAGES = [
  {
    title: "Message 1: intro",
    text: `Hey {first}!\n\n${OPENING}\n\nYou already have a profile on We-Draft.com, and we want to add some of your own words to it. ${ASK}\n\n${CLOSE}`,
    noPage: `Hey {first}!\n\n${OPENING}\n\nWe are activating your player profile on signing day in December and we wanted to add some of your own words to it. ${ASK}\n\n${CLOSE}`,
  },
  { title: "Message 2", text: "" },
];

// A message for one player: {first} filled in. Plain \n line breaks.
export const fillPitch = (text, person) => String(text || "").replace(/\r\n/g, "\n").replace(/\{first\}/g, String(person?.First || "").trim() || "there");

// The version of a message for this player (person.recruit: no page yet).
export const pitchText = (m, person) => fillPitch(person?.recruit && m.noPage ? m.noPage : m.text, person);
