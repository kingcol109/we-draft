// src/utils/pitchMessages.js
//
// The Instagram outreach DMs, in the order they're sent (Admin → Social →
// Pitch shows each one filled in for the player you pick, with Copy).
// {first} becomes the player's first name ("Hey Israel!"). They're sent by
// hand from the Instagram app — the API can't start a conversation — so a
// message with no text yet just shows as a slot to come.
//
import { isUnreleasedYear } from "./prospectYears";

// A message can have two versions:
//   text      a player who already has a page on We-Draft.com
//   noPage    a player whose page isn't public yet: an unpromoted recruit,
//             or a promoted player in an unreleased class (2030 until it
//             launches — utils/prospectYears.js)
// pitchText() picks the right one.
const CLOSE = "Would you be interested in participating? Appreciate your time!";

// The questions Message 2 offers (numbered in that order); a player answers
// one, and it goes on their profile (players.Answers, Info tab).
export const PITCH_QUESTIONS = [
  "What is something that separates you from other players at your position?",
  "What is one aspect of your game you're currently trying to take to another level?",
  "What college football or NFL player does your game most resemble and why?",
  "Which personal goal in football would mean the most to you to achieve?",
  "What's one thing you look for when studying an opposing player?",
];

export const PITCH_MESSAGES = [
  {
    title: "Message 1: intro",
    text: `Hey {first}!\n\nI’m reaching out from We-Draft.com, an NFL Draft and college football website. We cover NFL draft prospects and introduce them to a wider audience.\n\nYou already have a profile on We-Draft.com (I included a sample of your profile page), and we want to add some of your own words to it to help introduce you to football fans. We’d send you a few questions, you pick one that interests you, and answer in just 1–2 sentences. Won’t take more than a minute. We would add your answer to your profile.\n\n${CLOSE}`,
    noPage: `Hey {first}!\nI’m reaching out from We-Draft.com, an NFL Draft and college football website. We cover NFL draft prospects and introduce them to a wider audience. We are excited about adding you to our website and I included a sample of what your profile will look like.\n\nWe are activating your player profile on signing day in December and we wanted to add some of your own words to it to help introduce you to football fans. We’d send you a few questions, you pick one that interests you, and answer in just 1–2 sentences. Won’t take more than a minute. We would then add your answer to your profile.\n\n${CLOSE}`,
  },
  {
    title: "Message 2: the questions",
    text: `Awesome, thanks for getting back to me! Here are the questions:\n\n${PITCH_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nJust send the number of the question you are answering, then answer it in 1-2 sentences. Thanks again!`,
  },
];

// A message for one player: {first} filled in. Plain \n line breaks.
export const fillPitch = (text, person) => String(text || "").replace(/\r\n/g, "\n").replace(/\{first\}/g, String(person?.First || "").trim() || "there");

// No public page yet: a recruit, or a player in an unreleased class.
export const hasNoPublicPage = (person) => !!person?.recruit || isUnreleasedYear(person?.Eligible);

// The version of a message for this player.
export const pitchText = (m, person) => fillPitch(hasNoPublicPage(person) && m.noPage ? m.noPage : m.text, person);
