// src/utils/draftSim/warRoomLines.js
//
// What a team's front office says about the players its war room likes
// (engine warRoomFor): the GM talks value, the coaches talk needs and the
// team's stars. Shared by the Draft Sim's War Room tab
// (components/draftSim/SimBroadcast.jsx) and On the Clock's Potential
// Targets (onTheClock.js). Pure — no React, no Firestore.
import { starLinks } from "./stars";
import { positionValue, needGroup, needWord, PREMIUM_ROUNDS } from "./engine";

export const SLOT_TITLE = { GM: "GM", HC: "Head Coach", OC: "Off. Coordinator", DC: "Def. Coordinator" };
export const POS_WORD = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", OL: "lineman", DL: "defensive lineman", EDGE: "edge rusher", LB: "linebacker", DB: "defensive back", K: "kicker", P: "punter" };

// What a need sounds like from the coaches — a position or a role.
export const NEED_PHRASES = {
  QB: "We need a quarterback we can build around.", RB: "We need a back who can carry the load.", WR: "We need another receiver who can win.",
  TE: "We need a tight end who can do it all.", OT: "We have to protect the quarterback.", IOL: "We have to get better on the interior of the line.", IDL: "We need more push up the middle.", EDGE: "We need more pressure off the edge.",
  LB: "We need a linebacker who can run the defense.", CB: "We need help on the outside at corner.", S: "We need a safety we can trust on the back end.",
  RB3: "We need a back we trust on third down.", SLOTWR: "We need someone who can win in the slot.", BIGWR: "We need a big body on the outside.",
  DEEPWR: "We need someone who can take the top off a defense.", BLOCKTE: "We need a tight end who can move people in the run game.",
  RUSHEDGE: "We have to get after the quarterback off the edge.", RUSHDL: "Our interior pass rush needs some juice.", RUNDL: "We have to stop the run up front.",
  NOSE: "We need an anchor in the middle of the defense.", SUBLB: "We need a linebacker who can cover.", SS: "We need a physical presence at safety.",
  FS: "We need a center fielder.", SLOTCB: "We need someone who can cover the slot.",
};
// A need in the coaches' words, for the player who'd fill it: setting the
// edge is only for an edge with the run-stopper role.
export const needPhrase = (key, p) => (key === "EDGE" && p.Position === "EDGE" && (p.roles || []).includes("RUNDL")
  ? "We have to set the edge better."
  : NEED_PHRASES[key]);
const CLOSERS = ["{name} fixes that.", "{name} is our guy.", "{name} is the answer."];

// A coach's word on a pick that links to one of the team's stars
// (stars.js starLinks — the first link): {star} is the star's full name,
// {name} the prospect's. null when there's none.
const STAR_PHRASES = {
  weapon: ["We need to get {star} somebody to throw to. {name} is our guy.", "{star} needs more weapons. {name} gives him one."],
  protect: ["We have to keep {star} upright. {name} helps us do that.", "Protecting {star} is job one. {name} can do it."],
  lanes: ["Let's open up some running lanes for {star}. {name} can move people.", "Put {name} in front of {star} and watch what happens."],
  rush: ["Put {name} with {star} and good luck to the quarterbacks in this league.", "We already have {star}, but you can never have too many guys who get after the quarterback. {name} is one of them."],
  pair: ["We already have {star}, but we need another difference maker. {name} is that guy.", "{star} can't do it alone. {name} gives him some help."],
};
export function starLine(c, { team, stars, overall, round }) {
  const link = starLinks(stars, team, c.p, round)[0];
  const lines = link && STAR_PHRASES[link.kind];
  if (!lines) return null;
  return lines[(c.p.rank + overall) % lines.length].replace("{star}", link.star.n).replace("{name}", `${c.p.First} ${c.p.Last}`);
}

// A staffer who landed on the same player as one before him (c.agrees):
// he backs him, in his own terms.
export function agreeLine(c, staffNames, ctx) {
  const first = c.agrees[0];
  const who = staffNames[first]?.n ? staffNames[first].n.split(" ").slice(-1)[0] : `our ${SLOT_TITLE[first].toLowerCase()}`;
  const last = c.p.Last;
  const why = c.need ? (needPhrase(needGroup(c.need.key), c.p) ||`We need a ${needWord(c.need.key)}.`) : `${last}'s the best player on the board for us.`;
  const backs = [`I'm with ${who} on this one.`, `${who} and I see it the same way.`, `Same guy as ${who}.`][(c.p.rank + ctx.overall + c.slot.length) % 3];
  const star = starLine(c, ctx);
  return star ? `${backs} ${star}` : `${backs} ${why} ${last} is the pick.`;
}

// What a staffer says about his pick (c: warRoomFor's { slot, p, need,
// tradeDown }). ctx: { overall, round, topNeed }. The GM talks value; the
// coaches talk needs — a role's in its own words. Depth isn't a reason to
// spend an early pick (rounds 1–PREMIUM_ROUNDS), so there it's the value.
export function frontOfficeLine(c, ctx) {
  const { overall, round, topNeed } = ctx;
  const { p, need } = c;
  const name = `${p.First} ${p.Last}`;
  const pos = POS_WORD[p.Position] || p.Position;
  const word = need ? needWord(need.key) : pos;
  if (need?.label === "Depth Needed" && round <= PREMIUM_ROUNDS && !c.tradeDown && !c.tradeUp) {
    return c.slot === "GM"
      ? `We might have bigger needs than ${word}, but the value is too good to pass up here.`
      : `We might have bigger needs than ${word}, but ${name} is too good to pass up here.`;
  }
  if (c.slot === "GM") {
    if (c.tradeDown) return `There's no value for us at No. ${overall}. I'd move back — if we stay, ${name} is the best player we'd get.`;
    if (c.tradeUp) return `I love ${name}${need ? ` at ${word}` : ""}, and he's not making it to No. ${overall}. Let's go up and get him.`;
    const premium = positionValue(p.Position, p.rank) < 1;
    if (p.rank <= overall) {
      return need ? `${name} is the best value on our board, and he fills a need. Easy call.` : `${name} is the best value on our board${premium ? " at a premium position" : ""}. You don't pass on that.`;
    }
    return need ? `${name} is fair value here, and he helps at ${word}.` : `${name} is the best player left for us. Fair value at ${overall}.`;
  }
  // The coaches go to the team's stars first, where the pick links to one.
  const star = starLine(c, ctx);
  if (star) return star;
  if (need?.label === "Aging Talent") return `${name} is the guy to take over at ${word} when it's time.`;
  if (need?.label === "Depth Needed") return `We need depth at ${word}, and ${name} gives us that.`;
  if (need) return `${needPhrase(need.key, p) ||`We need a ${word}.`} ${CLOSERS[(p.rank + overall) % CLOSERS.length].replace("{name}", name)}`;
  if (topNeed && p.rank <= overall + 5) return `Even though we have bigger needs than ${pos}, ${name} is too good to pass up.`;
  return `${name} is the kind of ${pos} I like. He'd fit what we do.`;
}
