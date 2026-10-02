// src/sim/lessons.js
// ── Learn mode's lessons (/sim → 📖 Learn): one article per CONCEPT (not
// per play), with the live sim beside it.
//
//   intro     — the line under the title.
//   setup     — the field the lesson opens on: { play, formation, front,
//               coverage, readEnd } (play = an OFFENSE_PLAYS key). Variance
//               is always off in a lesson, so a demo plays the same way
//               every rep.
//   side      — "offense" | "defense" (which group it's listed under).
//   tryIt     — the "Try it" card at the bottom: { plays: [{ label, play,
//               formation }], controls, front? } — the field becomes
//               playable, the play and the front picked (or rotating) rep to
//               rep; `front` locks a defense lesson to its own front.
//   sections  — the article: { heading, body, demos? }
//     body      — paragraphs: a string, or { term, text } for a bolded
//                 lead-in ("Covered: ...").
//     demos     — "▶" buttons: { label, demo, run, setup | rotate, watch }
//                 (`rotate`: a list of setups, one rep each, in a loop; an
//                 item's own `run` overrides the demo's). The field is set
//                 up (`setup`), the animated overlay `demo` (render.js
//                 drawLessonDemo; "name:variant") plays once before the
//                 snap, then the play snaps and runs ITSELF (engine
//                 autopilot, `run` = how the back takes it) and loops.
//                 Demos aren't playable — Learn is for watching.
//
// Demos run juiced toward the lesson's side of the ball (engine
// config.juice — SimPage adds it), and the seeds below assume that.
// Demo setups are chosen so the point actually shows: variance is off and
// `seed` pins the roll, so a demo plays the same way every loop. Where the
// point depends on how the defense flows (the back's bang / bend / bounce,
// the pull), `fits` scripts it — each defender's run fit, play-side
// relative (see engine.js) — so what the offense does makes sense for
// what the defense did. `watch` is the caption over the live play. They
// were picked by sweeping seeds: re-check them if the sim's blocking,
// defense or running changes.

// The demos run from Pistol (no offset back, so the strength — and the
// 3-technique in an Over — is to the right, the side the zone goes) and
// Pistol King for split zone (the H to the right). The bounce runs from
// Spread Strong, where the back has the angle to get outside.
const BASE = { front: "over", coverage: "cover3" };
const IZ = { ...BASE, play: "insideZone", formation: "pistol" };
const SPLIT = { ...BASE, play: "splitZone", formation: "pistolKing" };

// The blocking demo rotates through the fronts, one rep each, so the
// covered / uncovered calls visibly change with the front.
const FRONT_ROTATION = [
  { ...IZ, readEnd: "sit", front: "over", coverage: "cover3", seed: 7 },
  { ...IZ, readEnd: "sit", front: "under", coverage: "cover3", seed: 5 },
  { ...IZ, readEnd: "sit", front: "bear", coverage: "cover3", seed: 1 },
  { ...IZ, readEnd: "sit", front: "tite", coverage: "cover4", seed: 5 },
  { ...IZ, readEnd: "sit", front: "3-4", coverage: "cover4", seed: 6 },
];

// Outside zone: Pistol, the zone going right. In the sim a 4-3 Over
// stonewalls the reach when it plays it straight, so its rep (and the
// bang) script the defense pinching inside — which is exactly when the
// aiming point opens. Each rotation rep says how the back takes it.
const OZ = { ...BASE, play: "outsideZone", formation: "pistol" };
const OZ_PINCH = { SLB: "B-play", "DE-R": "A-play", "DT-R": "A-play", MLB: "A-back", WLB: "A-back", "S-R": "A-play" };
const OZ_ROTATION = [
  { ...OZ, front: "over", coverage: "cover3", seed: 6, fits: OZ_PINCH, run: "bang" },
  { ...OZ, front: "under", coverage: "cover3", seed: 4, run: "read" },
  { ...OZ, front: "tite", coverage: "cover4", seed: 6, run: "read" },
  { ...OZ, front: "3-4", coverage: "man", seed: 3, run: "read" },
];

// ── Defense: one lesson per front. Every demo runs a zone play at the front
// (Pistol, so the strength is to the right) and the overlay draws each
// front player's run fit from his actual assignment. Seeds are picked so
// the front makes the stop — a linebacker or the force player. ──
const vs = (front, play, seed, coverage = "cover3") => ({ play, formation: "pistol", front, coverage, readEnd: "sit", seed });
const DEF_TRY_PLAYS = [
  { label: "Inside Zone Read · Pistol", play: "insideZone", formation: "pistol" },
  { label: "Inside Zone Read · Spread Weak", play: "insideZone", formation: "spreadWeak" },
  { label: "Outside Zone · Pistol", play: "outsideZone", formation: "pistol" },
  { label: "Outside Zone · Spread Strong", play: "outsideZone", formation: "spreadStrong" },
  { label: "Split Zone · Spread Weak King", play: "splitZone", formation: "spreadWeakKing" },
  { label: "Power · Spread Weak King", play: "power", formation: "spreadWeakKing" },
  { label: "GT Counter Read · Spread Weak", play: "counter", formation: "spreadWeak" },
  { label: "Smash (pass) · Spread Weak", play: "smash", formation: "spreadWeak" },
];
const DEF_CONTROLS = "You're the offense: run it at this front and watch the fits. Space snaps; on a read, Space pulls it; once he has it, the mouse steers the back. On Smash, click (hold + release) to throw, and watch the linebackers drop only once the line sets.";
const STRENGTH = "The defense sets the front to the offense's strength: the tight end's side; with no tight end, the H-back's; with only the running back in the backfield, away from him.";
const PASS = { term: "Against the pass", text: "The linebackers don't drop into coverage on a guess. They come downhill until the offensive line sets to pass or the quarterback looks to throw, then get to their drops." };
const LB_RUN = "On a run read they don't sit and read: they come downhill from the snap, keying the offensive linemen and redirecting with them, and run through their gaps to meet the back in the backfield. They fit from the inside out, so the ball has to bubble outside to the force player.";
const frontLesson = ({ key, title, intro, alignment, responsibilities, seeds }) => ({
  title,
  side: "defense",
  intro,
  setup: vs(key, "insideZone", seeds.iz),
  tryIt: { front: key, plays: DEF_TRY_PLAYS, controls: DEF_CONTROLS },
  sections: [
    {
      heading: "The Alignment",
      demos: [{ label: "Show the front", demo: "frontFits", run: "read", setup: vs(key, "insideZone", seeds.iz), watch: "Watch each man attack his gap; the linebackers come downhill to the ball." }],
      body: [STRENGTH, ...alignment],
    },
    {
      heading: "Run Responsibilities",
      demos: [
        { label: "vs. Inside Zone", demo: "frontFits:quick", run: "read", setup: vs(key, "insideZone", seeds.iz), watch: "Inside zone: the line holds its gaps and the linebackers fill downhill." },
        { label: "vs. Outside Zone", demo: "frontFits:quick", run: "read", setup: vs(key, "outsideZone", seeds.oz), watch: "Outside zone: everyone flows, the backers fit inside-out, and the force man keeps the edge." },
      ],
      body: [...responsibilities, PASS],
    },
  ],
});

const DEFENSE_LESSONS = {
  over: frontLesson({
    key: "over", title: "4-3 Over", seeds: { iz: 3, oz: 4 },
    intro: "The 4-3 Over shifts the defensive line toward the offense's strength: the 3-technique and a 5-technique to the strength, the nose shaded to the weak side. It's built to stop runs to the strength and leans on the linebackers away from it.",
    alignment: [
      { term: "Defensive line", text: "To the strength, a 5-technique end on the tackle's outside shoulder and a 3-technique on the guard's outside shoulder. Away from it, a 1-technique nose shaded on the center and a 5-technique end." },
      { term: "Linebackers", text: "The Mike stacks at 10, over the strong A gap. The Will is at 30, outside the weak guard. The Sam is apexed outside the strong end." },
    ],
    responsibilities: [
      { term: "Defensive line", text: "One gap each. The strong end has the C gap, the 3-technique the strong B, the nose the weak A, and the weak end the weak C." },
      { term: "Linebackers", text: "The Mike fills the strong A gap and the Will the weak B. " + LB_RUN },
      { term: "Force", text: "The Sam sets the strong-side edge and turns everything back inside. To the weak side, the free safety rolls down to force in Cover 3." },
      { term: "Alley", text: "The strong safety fills the alley from the inside out, a step behind the force." },
    ],
  }),
  under: frontLesson({
    key: "under", title: "4-3 Under", seeds: { iz: 14, oz: 3 },
    intro: "The 4-3 Under slides the line away from the strength and walks the Sam up on the line outside the strong end, putting five on the line of scrimmage. It's built to take away runs to the strength and asks the 3-technique to hold up the weak side.",
    alignment: [
      { term: "Defensive line", text: "To the strength, a 5-technique end and a 1-technique nose shaded strong. Away from it, a 3-technique tackle and a 5-technique end. The Sam walks up on the line outside the strong end." },
      { term: "Linebackers", text: "The Mike is at 30, outside the strong guard. The Will is at 10, over the weak A gap." },
    ],
    responsibilities: [
      { term: "Defensive line", text: "The strong end has the C gap, the nose the strong A, the 3-technique the weak B, and the weak end the weak C." },
      { term: "Linebackers", text: "The Mike fills the strong B gap and the Will the weak A. " + LB_RUN },
      { term: "Force", text: "The Sam, on the line, sets the strong edge. To the weak side, the free safety rolls down to force in Cover 3." },
      { term: "Alley", text: "The strong safety fills the alley from the inside out." },
    ],
  }),
  bear: frontLesson({
    key: "bear", title: "Bear", seeds: { iz: 2, oz: 4 },
    intro: "The Bear (46) puts five on the line and covers both guards and the center, so the offense can't double-team anyone on the interior. It's built to kill the inside run, at the cost of the perimeter.",
    alignment: [
      { term: "Defensive line", text: "5 – 3 – 1 – 3 – 5: a 3-technique on each guard, the nose shaded to the strength, a 5-technique end to the strength, and the Sam walked up as the weak-side 5." },
      { term: "Linebackers", text: "Both inside linebackers at 20, head-up on the guards, with the strong safety down in the box to the strength." },
    ],
    responsibilities: [
      { term: "Defensive line", text: "The Sam has the weak C gap, the tackles the B gaps, the nose the strong A, and the end the strong C." },
      { term: "Linebackers", text: "The Will fills the weak A gap; the Mike scrapes to the strong D gap, outside the end. " + LB_RUN },
      { term: "Force", text: "The box safety sets the strong edge. To the weak side, the Sam on the line is the edge." },
      { term: "Alley", text: "The free safety, alone in the middle of the field, fills the alley." },
    ],
  }),
  tite: frontLesson({
    key: "tite", title: "Tite", seeds: { iz: 34, oz: 3 },
    intro: "The Tite (or Mint) is a three-down front built to stop inside zone: two 4i's and a 0 squeeze the A and B gaps so there's no cutback lane inside.",
    alignment: [
      { term: "Defensive line", text: "4i – 0 – 4i: the ends on the inside shoulders of the tackles, the nose head-up on the center. An outside linebacker on each edge." },
      { term: "Linebackers", text: "Two inside linebackers at 20, head-up on the guards." },
    ],
    responsibilities: [
      { term: "Defensive line", text: "The 4i's have the B gaps and the nose the weak A. The outside linebackers have the C gaps." },
      { term: "Linebackers", text: "The weak inside linebacker fills the strong A gap over the nose; the strong inside linebacker plays the alley. " + LB_RUN },
      { term: "Force", text: "The strong safety sets the strong edge; the outside linebacker holds the weak one." },
    ],
  }),
  stack: frontLesson({
    key: "3-4", title: "Stack (3-4)", seeds: { iz: 2, oz: 2 },
    intro: "The Stack is a 3-4 with the ends head-up on the tackles and the nose head-up on the center: 4 – 0 – 4. The linebackers are stacked behind the line, hidden from the blockers and free to fill.",
    alignment: [
      { term: "Defensive line", text: "4 – 0 – 4: the ends head-up on the tackles, the nose head-up on the center. An outside linebacker on each edge." },
      { term: "Linebackers", text: "Two inside linebackers at 20, head-up on the guards." },
    ],
    responsibilities: [
      { term: "Defensive line", text: "The ends have the B gaps and the nose the weak A. The outside linebackers have the C gaps." },
      { term: "Linebackers", text: "The weak inside linebacker fills the strong A gap; the strong inside linebacker plays the alley. " + LB_RUN },
      { term: "Force", text: "The strong safety sets the strong edge; the outside linebacker holds the weak one." },
    ],
  }),
};

export const LESSONS = {
  insideZone: {
    title: "Inside Zone",
    side: "offense",
    intro: "Zone is one of the most common running schemes across all levels of football, and inside zone has a ton of variants.",
    setup: FRONT_ROTATION[0],
    tryIt: {
      plays: [
        { label: "Inside Zone Read · Pistol", play: "insideZone", formation: "pistol" },
        { label: "Inside Zone Read · Spread Weak", play: "insideZone", formation: "spreadWeak" },
        { label: "Inside Zone Read · Spread Strong", play: "insideZone", formation: "spreadStrong" },
        { label: "Inside Zone Read · Trips Right", play: "insideZone", formation: "tripsRight" },
        { label: "Split Zone · Spread Weak King", play: "splitZone", formation: "spreadWeakKing" },
        { label: "Split Zone · Pistol King", play: "splitZone", formation: "pistolKing" },
        { label: "Inside Zone RPO (bubble) · Spread Weak", play: "izBubble", formation: "spreadWeak" },
      ],
      controls: "Space snaps. During the ride it's a give unless you hit Space to pull it (on the RPO, click to pull and throw). Once he has it, the mouse steers the back, A / D cut, W bursts.",
    },
    sections: [
      {
        heading: "The Blocking",
        demos: [{ label: "Watch the blocking", demo: "zoneBlocking", run: "read", rotate: FRONT_ROTATION, watch: "Covered linemen block their man; uncovered linemen help, then climb to a linebacker." }],
        body: [
          "Zone blocking asks offensive linemen to block an area, not a man. Before the snap, offensive linemen identify their responsibilities.",
          {
            term: "Covered",
            text: "An offensive lineman is covered if there is a defender between his playside shoulder and the nose of the offensive lineman to his play side. If an offensive lineman is covered, he blocks the man in his area. If a defender vacates his area post-snap, which linemen are covered changes, as do their responsibilities.",
          },
          {
            term: "Uncovered",
            text: "Uncovered responsibilities vary from team to team, but they generally include helping a covered teammate before climbing and blocking a second-level defender.",
          },
        ],
      },
      {
        heading: "Backside End",
        demos: [
          { label: "End crashes: pull it", demo: "zoneRead:crash", run: "read", watch: "The end crashes on the back, so the QB pulls it and runs where he left.",
            setup: { ...IZ, readEnd: "crash", seed: 1, fits: { WLB: "A-play", MLB: "B-play", SLB: "force-play", "S-L": "alley-play" } } },
          { label: "End stays home: give it", demo: "zoneRead:sit", run: "read", watch: "The end stays home for the QB, so it's handed off.",
            setup: { ...IZ, readEnd: "sit", seed: 7 } },
          { label: "Kick him out", demo: "zoneKick", run: "read", watch: "Split zone: no read. The H crosses the formation and kicks the end out.",
            setup: { ...SPLIT, seed: 3 } },
        ],
        body: [
          "The backside end is often left unblocked in inside zone in order to get a numbers advantage to the play side. Teams deal with him in multiple ways.",
          {
            term: "Zone Read",
            text: "Leave him unblocked and have the quarterback read him. If he stays home, the quarterback hands the football off. If he crashes on the running back, the quarterback pulls it and runs with the football.",
          },
          {
            term: "Kick Him Out",
            text: "Use a blocker (typically an H-back) to kick him out. This is a staple in split zone.",
          },
        ],
      },
      {
        heading: "The Running Back",
        demos: [
          { label: "Bang", demo: "zoneTrack:bang", run: "bang", watch: "The linebackers fit wide and the line slants away. The A gap is open, so he hits it.",
            setup: { ...IZ, readEnd: "sit", seed: 1, fits: { MLB: "C-play", WLB: "C-back", SLB: "force-play", "DT-R": "C-play", "DT-L": "B-back", "S-R": "force-play", "S-L": "force-back" } } },
          { label: "Bend", demo: "zoneTrack:bend", run: "bend", watch: "Everyone flows to the play side, so he plants and cuts it back behind them.",
            setup: { ...SPLIT, coverage: "tampa2", seed: 37, fits: { "DE-L": "D-back", WLB: "B-play", MLB: "C-play", SLB: "force-play", "DT-L": "A-play", "DT-R": "B-play", "S-L": "alley-play", "S-R": "force-play" } } },
          { label: "Bounce", demo: "zoneTrack:bounce", run: "bounce", watch: "Everyone fills the inside gaps, so he bounces it outside the tackle.",
            setup: { ...IZ, formation: "spreadStrong", readEnd: "sit", seed: 10, fits: { MLB: "A-play", WLB: "A-back", SLB: "B-play", "DE-L": "B-play", "DT-L": "A-play", "S-L": "B-play" } } },
        ],
        body: [
          "Because offensive linemen are blocking areas and not predetermined men, inside zone is slower developing, and the running back has to read gaps post-snap to help him make a decision. He begins with the playside A gap as his aiming point and can make three decisions from there.",
          { term: "Bang", text: "The A gap is open, so the running back hits it." },
          { term: "Bend", text: "The defense reacts and flows toward the play's action, opening a cutback lane away from the original play side." },
          { term: "Bounce", text: "All inside lanes are congested, so the running back bounces to the outside." },
        ],
      },
    ],
  },
  outsideZone: {
    title: "Outside Zone",
    side: "offense",
    intro: "Outside zone is similar to inside zone, except it attacks the defense more horizontally. It tries to turn the defense's over-aggressiveness against the wide flow against it by gashing the defense vertically.",
    setup: OZ_ROTATION[0],
    tryIt: {
      plays: [
        { label: "Outside Zone · Pistol", play: "outsideZone", formation: "pistol" },
        { label: "Outside Zone · Spread Weak", play: "outsideZone", formation: "spreadWeak" },
        { label: "Outside Zone · Spread Strong", play: "outsideZone", formation: "spreadStrong" },
        { label: "Outside Zone · Trips Right", play: "outsideZone", formation: "tripsRight" },
        { label: "Outside Zone · Trips Left", play: "outsideZone", formation: "tripsLeft" },
      ],
      controls: "Space snaps. Once he has it, the mouse steers the back: press the outside leg of the tight end, then bang it or bend it back. A / D cut, W bursts.",
    },
    sections: [
      {
        heading: "The Blocking",
        demos: [{ label: "Watch the blocking", demo: "zoneBlocking", run: "read", rotate: OZ_ROTATION, watch: "Wide steps and reach blocks; uncovered linemen overtake so the covered man can climb." }],
        body: [
          "Outside zone asks offensive linemen to take wider zone steps.",
          {
            term: "Covered",
            text: "An offensive lineman is covered if there is a defender between his playside shoulder and the nose of the offensive lineman to his play side. If an offensive lineman is covered, he blocks the play-side shoulder of the man in his area. If a defender vacates his area post-snap, which linemen are covered changes, as do their responsibilities.",
          },
          {
            term: "Uncovered",
            text: "Uncovered responsibilities vary from team to team, but they generally include helping a covered teammate before climbing and blocking a second-level defender. In outside zone, there is a bigger emphasis on uncovered linemen overtaking covered linemen's blocks at the line of scrimmage.",
          },
        ],
      },
      {
        heading: "The Running Back",
        demos: [
          { label: "Bang", demo: "zoneTrack:bang", run: "bang", watch: "The defense pinches inside. The aiming point is open, so he hits it.",
            setup: { ...OZ, seed: 6, fits: OZ_PINCH } },
          { label: "Bend", demo: "zoneTrack:bend", run: "bend", watch: "The defense overflows to the wide flow, so he cuts it back inside the aiming point.",
            setup: { ...OZ, front: "nickel", coverage: "cover4", seed: 7, fits: { "DE-R": "D-play", "DT-R": "C-play", "DT-L": "B-play", MLB: "D-play", WLB: "C-play", SLB: "force-play", "S-R": "force-play", "S-L": "D-play", "DE-L": "C-play" } } },
        ],
        body: [
          "The running back's aiming point is the outside leg of the tight end (or where the tight end would be if there is none). Contrary to the name, the running back typically isn't trying to take the ball outside on outside zone.",
          { term: "Bang", text: "The aiming point is open, so the running back hits it." },
          { term: "Bend", text: "The wide zone steps and the running back's path cause the defense to overflow horizontally, opening up a cutback lane inside of the aiming point." },
          { term: "Bounce", text: "Because outside zone is trying to use the defense's over-aggressiveness against them, the running back is not looking to bounce outside zone (see wide zone)." },
        ],
      },
    ],
  },
  ...DEFENSE_LESSONS,
};

// Concepts on the way — shown in the list, not clickable yet.
export const COMING_SOON = ["Power", "Counter", "Speed Option", "Smash", "Four Verticals", "Mesh", "Screens"];
