// scripts/sendWePickMovedNotice.js
//
// One-off (user, 2026-11-20): We-Pick left the navbar. Everyone who made a
// pick in the given week gets a profile-hub message (userMessages, kind
// "announcement" — MessagesTab.jsx) pointing them to Profile → We-Pick.
// Skips anyone who already has this notice (noticeId), so a re-run is safe.
//
// Usage: node -r dotenv/config scripts/sendWePickMovedNotice.js "Week 11"            (dry run)
//        node -r dotenv/config scripts/sendWePickMovedNotice.js "Week 11" --write
//        add --skip=<uid>,<uid> to leave accounts out (e.g. your own)
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const WEEK = process.argv[2];
const WRITE = process.argv.includes("--write");
const SKIP = new Set((process.argv.find((a) => a.startsWith("--skip=")) || "").slice(7).split(",").filter(Boolean));
const NOTICE_ID = "wepick-moved-2026-11";

const SUBJECT = "We-Pick has a new home";
const MESSAGE = "Thanks for making your picks last week! We've tidied up the menu at the top of We-Draft.com, and We-Pick now lives in your Profile. Open Profile and pick the We-Pick tab to see your week, then make your picks, check the standings and compare with friends.\n\nNothing else has changed: your picks, points and standings are all still there.";

async function run() {
  if (!WEEK || WEEK.startsWith("--")) { console.error('Pass the week, e.g. "Week 11"'); process.exit(1); }
  const db = getFirestore();
  const games = await db.collection("schedule26").where("Week", "==", WEEK).get();
  const uids = new Set();
  for (const g of games.docs) (await g.ref.collection("picks").get()).forEach((p) => uids.add(p.id));
  console.log(`${WEEK}: ${games.size} games, ${uids.size} users with picks${WRITE ? "" : " (dry run)"}`);

  let sent = 0;
  for (const uid of uids) {
    const user = (await db.collection("users").doc(uid).get()).data() || {};
    const name = user.username || "(no username)";
    if (SKIP.has(uid)) { console.log(`  skip     ${name} (${uid})`); continue; }
    const dupe = await db.collection("userMessages").where("toUid", "==", uid).where("noticeId", "==", NOTICE_ID).limit(1).get();
    if (!dupe.empty) { console.log(`  already  ${name} (${uid})`); continue; }
    console.log(`  ${WRITE ? "send" : "would"}     ${name} (${uid})`);
    if (!WRITE) continue;
    await db.collection("userMessages").add({
      toUid: uid, kind: "announcement", noticeId: NOTICE_ID,
      subject: SUBJECT, message: MESSAGE, link: "/profile?tab=wepick", linkLabel: "Open We-Pick",
      createdAt: FieldValue.serverTimestamp(), read: false,
    });
    sent += 1;
  }
  console.log(WRITE ? `Sent ${sent}.` : "Dry run. Add --write to send.");
}
run().catch((e) => { console.error(e); process.exit(1); });
