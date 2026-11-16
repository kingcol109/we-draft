const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const names = [
    ["Andrei","Iosivas"],["Erick","Hallett"],["Tre","Hawkins III"],["Demario","Douglas"],["Titus","Leo"],
    ["Deuce","Vaughn"],["Dante","Stills"],["Ameer","Speed"],["Zach","Evans"],["Dee","Winters"],
    ["Travis","Bell"],["Antoine","Green"],["Zack","Kuntz"],["Jaylon","Jones"],["DeWayne","McBride"],
    ["DeMarcco","Hellams"],["Jovaughn","Gwyn"],["Cooper","Hodges"],["Raymond","Vohasek"],["Colton","Dowell"],
    ["Andrew","Vorhees"],["Nick","Broeker"],["Nesta Jade","Silvera"],["Carrington","Valentine"],["Andre","Jones Jr."],
    ["Jason","Taylor II"],["Lew","Nichols III"],["Jake","Witt"],["Kenny","McIntosh"],["Ryan","Hayes"],
    ["Max","Duggan"],["Derek","Parish"],["Cory","Trice Jr."],["Anthony","Johnson Jr."],["Jordon","Riley"],
    ["Jalen","Brooks"],["Isaiah","Bolden"],["D.J.","Ivey"],["Brayden","Willis"],["Moro","Ojomo"],
    ["Nic","Jones"],["Spencer","Anderson"],["Alex","Austin"],["Ronnie","Bell"],["Gervarrius","Owens"],
    ["Jalen","Graham"],["Grant","DuBose"],["Alex","Forsyth"],["Kendall","Williamson"],["Desjuan","Johnson"]
  ];
  const combineFields = ["Height","Weight","Arm Length","Hand Size","40 Yard ","Vertical","Broad","Bench","3-Cone","Shuttle"];
  for (const [first, last] of names) {
    const snap = await db.collection("historical").where("First", "==", first).where("Last", "==", last).where("Year","==","2023").get();
    if (snap.size !== 1) {
      console.log(`${first} ${last}: ${snap.size} MATCH(ES)`);
      continue;
    }
    const v = snap.docs[0].data();
    const missing = combineFields.filter(f => v[f] == null || v[f] === "");
    console.log(`${first} ${last} | Pos:${v.Position} | Pick:${v.Pick} | missingCombine:[${missing.join(",")}]`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
