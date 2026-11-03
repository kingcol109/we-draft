import { mockSlidePlan, mockSlides, mockInput, mockCaption, playerPost, playerInput, imageUrls, IG_MAX_SLIDES } from "./posts";

// A fixed-width font stands in for Bebas Neue.
const env = { measure: (t, size) => String(t).length * size * 0.45, images: {} };
const player = (n) => ({ id: `p${n}`, First: "First", Last: `Last${n}`, Position: "QB", School: "Texas" });
const draft = (rounds, perRound = 32) => {
  const picks = [];
  for (let r = 1; r <= rounds; r++) for (let i = 1; i <= perRound; i++) {
    const overall = (r - 1) * perRound + i;
    picks.push({ overall, round: r, owner: "NYJ", original: i === 4 ? "IND" : "NYJ", player: player(overall) });
  }
  return { year: "2027", rounds, picks };
};

test("round 1 is 16 and 16 picks, then a slide a round", () => {
  const plan = mockSlidePlan(draft(7).picks);
  expect(plan.map((s) => s.picks.length)).toEqual([16, 16, 32, 32, 32, 32, 32, 32]);
  expect(plan.slice(0, 2).map((s) => s.part)).toEqual([1, 2]);
  expect(plan[0].picks[0].overall).toBe(1);
  expect(plan[1].picks[0].overall).toBe(17);
  expect(plan[1].picks[15].overall).toBe(32);
  expect(plan[2].round).toBe(2);
});

test("a one-round class is its two round-1 slides", () => {
  expect(mockSlidePlan(draft(1).picks).map((s) => s.picks.length)).toEqual([16, 16]);
});

test("a pick a Draft Sim trade moved says SIM TRADE; a real trade only VIA", () => {
  const week = draft(1);
  // Pick 4 came from IND in a real trade; pick 8 to NYJ in the sim's trade, as did a 2028 pick.
  week.picks[7].original = "NO";
  week.trades = [{ up: "NYJ", down: "NO", at: 8, upGot: [{ year: "2027", round: 1, original: "NO", overall: 8 }], downGot: [{ year: "2028", round: 1, original: "NYJ", overall: null }] }];
  const input = mockInput({ week });
  expect(input.picks[3]).toMatchObject({ via: "IND", simTrade: false });
  expect(input.picks[7]).toMatchObject({ via: "NO", simTrade: true });
  expect(mockCaption(input)).toContain("8. NYJ (via NO, sim trade)");
  expect(mockCaption(input)).toContain("not a real one");
  const svg = mockSlides(input, env)[0].svg;
  expect(svg).toContain("VIA NO");
  expect(svg).toContain(">SIM TRADE</tspan>");
  expect(svg.match(/SIM TRADE/g)).toHaveLength(1);
  // The next class: the main class's trades carried over, while the team still holds the pick.
  const next = { ...draft(1), year: "2028", trades: [], carriedTrades: [{ round: 1, original: "NYJ", from: "NYJ", to: "NYJ" }] };
  expect(mockInput({ week: next }).picks.filter((p) => p.simTrade)).toHaveLength(31);
});

test("the Draft Sim ad comes after round 1, unless it's turned off", () => {
  const withAd = mockSlides(mockInput({ week: draft(2) }), env);
  expect(withAd.map((s) => s.name)).toEqual(["round-1-1", "round-1-2", "draft-sim-ad", "round-2"]);
  expect(withAd[2].svg).toContain("MAKE YOUR OWN!");
  expect(withAd[2].svg).toContain("WE-DRAFT.COM/DRAFTSIM");
  expect(withAd[2].svg).toContain("SWIPE FOR ROUND 2");
  // A one-round mock: the ad is the last slide.
  expect(mockSlides(mockInput({ week: draft(1) }), env).map((s) => s.name)).toEqual(["round-1-1", "round-1-2", "draft-sim-ad"]);
  expect(mockCaption(mockInput({ week: draft(2) }))).toContain("we-draft.com/draftsim");
  const without = mockSlides(mockInput({ week: draft(2), simAd: false }), env);
  expect(without.map((s) => s.name)).toEqual(["round-1-1", "round-1-2", "round-2"]);
  expect(mockCaption(mockInput({ week: draft(2), simAd: false }))).not.toContain("draftsim");
});

test("the caption opens with the class, the week and how its pick order was set", () => {
  const cap = (week) => mockCaption(mockInput({ week, dated: "Nov 3, 2026" }));
  const sim = "We used our We-Draft sim to drive team logic and Community Grades to set player values. Check out the results here:";
  expect(cap(draft(7)).split("\n").slice(0, 4)).toEqual(["We-Draft.com's Weekly 2027 Mock Draft (Nov 3, 2026)", sim, "", "Round 1:"]);
  expect(cap(draft(7))).toContain("1. NYJ: First Last1");
  expect(cap({ ...draft(3), year: "2028" }).split("\n")[1]).toBe(`The 2028 draft order is a year away, so we shuffled the projected order in tiers: picks 1–10, 11–20 and 21–32 are each drawn at random within their group. ${sim}`);
  const y29 = cap({ ...draft(1), year: "2029" }).split("\n");
  expect(y29[1]).toBe(`It's too early to project the 2029 order, so this one-round mock uses a random pick order. ${sim}`);
  // One round: the picks follow straight on.
  expect(y29[3]).toMatch(/^1\. /);
});

test("never more slides than Instagram takes", () => {
  expect(mockSlides(mockInput({ week: draft(25, 32) }), env).length).toBe(IG_MAX_SLIDES);
});

test("mockInput marks traded picks and picks dark logos on the dark look", () => {
  const branding = { NYJ: { City: "New York", Team: "Jets", Color1: "#125740", Logo1: "light.png", LogoDark: "dark.png" } };
  const dark = mockInput({ week: draft(1), branding, collegeLogos: { p1: { lg: "tx.png", ld: "tx-dark.png" } } });
  expect(dark.picks[3].via).toBe("IND");
  expect(dark.picks[0].via).toBe("");
  expect(dark.picks[0].team.logo).toBe("dark.png");
  expect(dark.picks[0].collegeLogo).toBe("tx-dark.png");
  const light = mockInput({ week: draft(1), branding, theme: "light" });
  expect(light.picks[0].team.logo).toBe("light.png");
  expect(imageUrls(dark)).toEqual(expect.arrayContaining(["dark.png", "tx-dark.png"]));
  expect(mockCaption(dark)).toContain("4. Jets (via IND): First Last4, QB, Texas");
});

test("slides are 1080×1350 SVG with every pick on them, text escaped", () => {
  const week = draft(2);
  week.picks[0].player.Last = "O'Neil & Sons";
  const slides = mockSlides(mockInput({ week }), env);
  slides.forEach((s) => expect(s.svg).toMatch(/^<svg [^>]*width="1080" height="1350"/));
  expect(slides[0].svg).toContain("O'NEIL &amp; SONS");
  expect(slides[2].name).toBe("draft-sim-ad");
  expect(slides[3].svg).toContain("LAST64");
});

test("each round-1 slide features its own pick over his photo, his row highlighted; the plain list without one", () => {
  const images = { "a.png": { href: "data:image/png;base64,AA", w: 9, h: 16 }, "b.png": { href: "data:image/png;base64,BB", w: 9, h: 16 } };
  const features = { 1: { overall: 3, photo: "a.png" }, 2: { overall: 20, photo: "b.png" } };
  const slides = mockSlides(mockInput({ week: draft(1), features }), { ...env, images });
  expect(slides[0].svg).toContain("base64,AA");
  expect(slides[0].svg).toContain("NO. 3");
  expect(slides[0].svg).toContain('stroke="#f6a21d"');
  expect(slides[1].svg).toContain("base64,BB");
  expect(slides[1].svg).toContain("NO. 20");
  // A photo that didn't load: the plain list.
  expect(mockSlides(mockInput({ week: draft(1), features }), env)[0].svg).not.toContain("NO. 3");
});

test("a player post draws without a photo", () => {
  const svg = playerPost(playerInput({ player: player(1), school: { Color1: "#bf5700" }, kicker: "2027 NFL Draft" }), env);
  expect(svg).toContain("LAST1");
  expect(svg).toContain("2027 NFL DRAFT");
});
