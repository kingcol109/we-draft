// src/sim/recap.js
// ── The post-play recap for drive mode: what was called on both sides, what
// happened, and the story of the snap — a dime, a tough catch, broken
// tackles, yards after the catch, who got home on a sack. Built from what
// the engine recorded during the play (engine.stats, throwInfo, result);
// nothing here changes the play. ──

import { LOS, goalLineY } from "./field.js";

// "WR H", "RB", "QB", "FS", "CB-L".
export function playerName(p) {
  if (!p) return "";
  // Dynasty: the rostered player's name.
  if (p.info) return `${p.info.pos} ${p.info.first[0]}. ${p.info.last}`;
  if (p.team === "O") return p.role === "WR" || p.position === "FB" ? `${p.position} ${p.id}` : p.id;
  return p.role === "S" ? p.position : p.id;
}

const yds = (n) => {
  const r = Math.round(n);
  return `${r} yard${Math.abs(r) === 1 ? "" : "s"}`;
};

// tone: good (offense did something well) · bad (for the offense) · info
export function buildRecap(engine, result, chainsText) {
  const S = engine.stats || { missed: [], beatBlocks: [], cuts: 0, bursts: 0 };
  const by = (id) => engine.byId[id];
  const name = (id) => playerName(by(id));
  const type = result ? result.type : "INCOMPLETE";
  const yards = result && result.yards ? result.yards : 0;
  const lines = [];
  const add = (text, tone = "info") => lines.push({ text, tone });
  const ti = engine.throwInfo;
  const qb = by("QB");
  const lastPop = engine.popups[engine.popups.length - 1];

  // ── How the ball got where it went. ──
  let kind = "run";
  if (ti && !ti.pitch) kind = "pass";
  else if (type === "SACK") kind = "sack";

  if (engine.play.option) {
    const key = engine.zone && engine.zone.optionKeyId;
    if (S.pitch) add(`Pitched it${key ? ` off ${name(key)}` : ""} — the back took it`, "info");
    else add(`QB kept it${key ? ` — read ${name(key)}` : ""}`, "info");
  } else if (engine.play.qbRun === "draw") {
    add("QB draw — showed pass, then took off", "info");
  } else if (engine.play.counter) {
    const z = engine.zone;
    add(`Counter — ${z && z.pullKickId ? `guard kicked out ${name(z.pullKickId)}` : "guard pulled"}, tackle wrapped`, "info");
  }
  if ((engine.playType === "run" || engine.rpoPass) && !engine.play.qbRun) {
    const readId = engine.zone && engine.zone.readId;
    if (engine.rpoPass && ti) add(`RPO — QB pulled it${readId ? ` on ${name(readId)}` : ""} and threw it`, "info");
    else if (engine.qbKeep) add(`QB pulled it and kept it${readId ? `, reading ${name(readId)}` : ""}`, "info");
    else if (engine.handedOff && readId) add(`Gave it to the RB, reading ${name(readId)}`, "info");
  }

  if (kind === "pass") {
    const target = ti.intended;
    const air = S.catch ? S.catch.y - LOS : ti.target.y - LOS;
    const pressured = S.pressure && S.pressure.d < 2.2;
    const onRun = S.qbSpeed > 3.5;

    if (S.catch) {
      const c = S.catch;
      const rn = name(c.id);
      if (c.onMoney && air >= 18) add(`Dime — ${Math.round(air)} yards in the air, right in ${rn}'s stride`, "good");
      else if (c.onMoney) add(`Perfect throw — hit ${rn} in stride`, "good");
      else if (c.tough) add(`${rn} went and got it — a tough catch`, "good");
      if (c.contested) add(`Contested catch${c.defender ? ` over ${name(c.defender)}` : ""}`, "good");
      if (pressured) add(`Delivered with ${name(S.pressure.id)} in his face`, "good");
      else if (onRun) add("Thrown on the run", "info");
      // After the catch.
      const carrier = engine.carrier();
      const endY = carrier ? Math.min(carrier.y, goalLineY) : c.y;
      const yac = endY - c.y;
      if (yac >= 8) add(`${rn} added ${yds(yac)} after the catch`, "good");
    } else if (type === "INTERCEPTION") {
      const pick = engine.carrier();
      const undercut = lastPop && /undercut/.test(lastPop.sub || "");
      add(`Picked off by ${playerName(pick)}${undercut ? " — he undercut the route" : " — thrown into coverage"}`, "bad");
      if (pressured) add(`${name(S.pressure.id)} was on the QB at the release`, "info");
      const ret = pick ? LOS - pick.y : 0;
      if (ret >= 8) add(`Returned ${yds(ret)}`, "bad");
    } else if (lastPop) {
      // Incomplete: the callout already says why.
      const head = lastPop.text;
      const sub = lastPop.sub || "";
      if (head === "DROPPED" && /good throw/.test(sub)) add(`Good throw — ${target ? name(target) : "the receiver"} dropped it`, "bad");
      else if (head === "DROPPED") add(`Dropped — ${sub}`, "bad");
      else if (head === "BROKEN UP") add(`Broken up — ${sub}`, "bad");
      else if (head === "OVERTHROWN") add(`Overthrown — sailed over ${target ? name(target) : "the receiver"}`, "bad");
      else if (head.startsWith("BEHIND")) add(`Thrown behind ${target ? name(target) : "the receiver"}`, "bad");
      else if (head === "THROWN AWAY") add("Thrown away — nobody there", "info");
      else add(sub ? `${head[0]}${head.slice(1).toLowerCase()} — ${sub}` : "Incomplete", "bad");
      if (pressured) add(`Under pressure from ${name(S.pressure.id)}`, "info");
    }
    if (ti.short) add("Beyond his arm — it fell short", "bad");
  }

  if (type === "SACK") {
    const t = S.tackler;
    const beat = t && S.beatBlocks.filter((b) => b.d === t).pop();
    add(`Sacked by ${name(t)}${beat ? ` — beat ${name(beat.b)}'s block` : ""}`, "bad");
    const held = engine.endAt != null && engine.snapAt != null ? engine.endAt - engine.snapAt : null;
    if (held != null) add(`${held.toFixed(1)}s from snap to sack`, "info");
  }

  // ── The ball carrier: broken tackles, moves, and how it ended. ──
  const carrier = engine.carrier();
  if (carrier && carrier.team === "O" && type !== "SACK") {
    const missed = S.missed.filter((m) => m.carrier === carrier.id);
    const cn = playerName(carrier);
    if (missed.length >= 2) {
      const count = {};
      for (const m of missed) count[m.by] = (count[m.by] || 0) + 1;
      const who = Object.entries(count).map(([id, n]) => (n > 1 ? `${name(id)} ×${n}` : name(id)));
      add(`${cn} broke ${missed.length} tackles (${who.join(", ")})`, "good");
    }
    else if (missed.length === 1) add(`${cn} made ${name(missed[0].by)} miss`, "good");
    if (kind === "run") {
      if (S.cuts) add(`${S.cuts > 1 ? `${S.cuts} jump cuts` : "Jump cut"} to find the lane`, "info");
      if (yards >= 15) add(`${cn} broke free for ${yds(yards)}`, "good");
      else if (yards <= 0 && S.tackler) add(`Stuffed by ${name(S.tackler)}${yards < 0 ? " in the backfield" : " at the line"}`, "bad");
    }
    if (type === "TACKLE" && S.tackler && !(kind === "run" && yards <= 0)) add(`Brought down by ${name(S.tackler)}`, "info");
    if (type === "OUT_OF_BOUNDS") add(`${cn} got out of bounds`, "info");
  }

  // ── The badge: the one-word headline. ──
  const drive = chainsText || "";
  let badge;
  if (type === "TOUCHDOWN") badge = ["TOUCHDOWN", "#4ade80"];
  else if (type === "INTERCEPTION") badge = ["INTERCEPTED", "#f87171"];
  else if (/safety/i.test(drive)) badge = ["SAFETY", "#f87171"];
  else if (/turnover on downs/i.test(drive)) badge = ["TURNOVER ON DOWNS", "#f87171"];
  else if (type === "SACK") badge = ["SACK", "#f87171"];
  else if (yards >= 20) badge = ["BIG PLAY", "#F6A21D"];
  else if (/FIRST DOWN/.test(drive)) badge = ["FIRST DOWN", "#60a5fa"];
  else if (type === "INCOMPLETE") badge = ["INCOMPLETE", "#94a3b8"];
  else if (yards <= 0) badge = ["STUFFED", "#f87171"];
  else badge = [`+${Math.round(yards)}`, "#cbd5e1"];

  // Yardage split for the bar: air yards vs. after the catch (or a run).
  let bar = null;
  if (S.catch && type !== "INCOMPLETE" && type !== "INTERCEPTION") {
    const air = S.catch.y - LOS;
    bar = { air, after: yards - air, total: yards };
  } else if (kind === "run" && type !== "INCOMPLETE") bar = { air: 0, after: yards, total: yards };

  return {
    badge: { text: badge[0], color: badge[1] },
    result: drive,
    yards,
    kind,
    lines,
    bar,
    qbName: playerName(qb),
  };
}
