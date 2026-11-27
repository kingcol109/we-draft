// src/utils/film/remote.js
//
// The Viewer's remote (user, 2026-11-27): the film plays on the PC (its files
// live on that disk); an iPad at /film/remote picks what's playing and moves
// around in it. Live both ways through Firestore (admin-only, filmRemote/**):
//
//   filmRemote/main/cmds/{id}  the remote's commands, a queue — every tap is
//                              its own doc (fast taps are never merged away);
//                              the PC runs each once, in order, then deletes it.
//   filmRemote/state           what the PC has up: player / game, its plays,
//                              the current one, view settings (written when it changes).
//   filmRemote/play            the playback: playing, time, speed, length —
//                              written on a change (play / pause / seek / speed /
//                              a new play) and every 5 s; the remote runs the
//                              clock itself in between.
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebase";

const CMDS = collection(db, "filmRemote", "main", "cmds");
const STATE = doc(db, "filmRemote", "state");
const PLAY = doc(db, "filmRemote", "play");

// A command from the remote. seq keeps one device's taps in order.
let seqN = 0;
export const sendCmd = (type, args = {}) => addDoc(CMDS, { type, args, seq: Date.now() * 1000 + (seqN++ % 1000), at: serverTimestamp() });

/** The PC: run each new command once, in order. Commands already waiting when
 *  the Viewer opens are stale — they're cleared, not run.
 *  Two ways in, so a tap is never stranded (user, 2026-11-27: the remote's
 *  buttons did nothing — the queue filled up and the PC's listener never ran
 *  them): the live listener, re-opened if it errors, and a check of the queue
 *  every 2.5 s. Whichever sees a command first runs it; `done` keeps it to once.
 *  onStatus({ ok, error, last }) — for the Viewer's remote chip. → stop */
export function watchCmds(run, onStatus = () => {}) {
  let stopped = false;
  let seen = false; // the first look at the queue: what's there is stale
  const done = new Set();
  let unsub = null;
  let retry = null;
  const status = { ok: false, error: "", last: null };
  const report = (patch) => { Object.assign(status, patch); onStatus({ ...status }); };
  const take = (docs) => {
    if (stopped) return;
    if (!seen) {
      seen = true;
      docs.forEach((d) => { done.add(d.id); deleteDoc(d.ref).catch(() => {}); });
      report({ ok: true, error: "" });
      return;
    }
    docs.forEach((d) => {
      if (done.has(d.id)) return;
      done.add(d.id);
      const c = { id: d.id, ...d.data() };
      try { run(c); report({ ok: true, error: "", last: { type: c.type, at: Date.now() } }); } catch (e) { console.error("remote command", e); report({ error: `Command ${c.type} failed: ${e.message}` }); }
      deleteDoc(d.ref).catch(() => {});
    });
  };
  const listen = () => {
    if (stopped) return;
    unsub = onSnapshot(query(CMDS, orderBy("seq")), (snap) => take(snap.docs), (e) => {
      console.error("remote commands", e);
      report({ ok: false, error: `Listener: ${e.code || e.message}` });
      unsub = null;
      clearTimeout(retry);
      retry = setTimeout(listen, 2000);
    });
  };
  listen();
  const poll = setInterval(() => {
    getDocs(query(CMDS, orderBy("seq"))).then((s) => take(s.docs)).catch((e) => report({ ok: false, error: `Queue: ${e.code || e.message}` }));
  }, 2500);
  return () => { stopped = true; unsub?.(); clearTimeout(retry); clearInterval(poll); };
}

// setDoc throws (not rejects) on bad data — never let that take the Viewer down.
const safe = (fn, label) => { try { return fn().catch((e) => console.error(label, e)); } catch (e) { console.error(label, e); return Promise.resolve(); } };
export const putState = (s) => safe(() => setDoc(STATE, { ...s, at: serverTimestamp() }), "remote state");
export const putPlay = (p) => safe(() => setDoc(PLAY, p), "remote play");
export const watchState = (fn, onErr) => onSnapshot(STATE, (d) => fn(d.exists() ? d.data() : null), onErr);
export const watchPlay = (fn) => onSnapshot(PLAY, (d) => fn(d.exists() ? d.data() : null), () => {});

// ── ✏️ Draw (user, 2026-11-27): the iPad pops into the film — the PC's film
// canvas streamed to it live (WebRTC, straight between the two; Firestore only
// carries the handshake, filmRemote/rtc) — and draws on it. The strokes go back
// over the same link (a data channel) and the PC draws them over the film.
// Nothing is saved: it's for illustration while you talk.
//
// Strokes: { id, tool ("pen" | "arrow" | "circle"), color, p: [x, y, x, y, …] }
// with x / y normalized to the film's frame (what's on screen, wash and all).
// Flat arrays — Firestore takes no nested ones (the fallback below).
//
// Messages on the channel:  { t: "all", strokes }  the finished strokes (a new
//                           stroke, undo, clear)
//                           { t: "cur", s }         the stroke being drawn
//                           { t: "cmd", type, args } a control (play / speed …),
//                           faster than the command queue
// No channel yet (or it can't connect): the ink goes through filmRemote/ink.
const RTC = doc(db, "filmRemote", "rtc");
const INK = doc(db, "filmRemote", "ink");
const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
// The whole offer / answer at once (no trickle) — on the same Wi-Fi the
// candidates are in within a moment; never wait more than 2.5 s.
const gathered = (pc) => new Promise((res) => {
  if (pc.iceGatheringState === "complete") { res(); return; }
  const t = setTimeout(res, 2500);
  pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
});
export const newSid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The PC: a draw session for the iPad's sid. getCanvas() → the film's canvas
 *  (it can change — a new view remounts the player; the track follows).
 *  onMsg(m) for every message (channel or the Firestore fallback). → stop */
export function hostDraw(sid, { getCanvas, onMsg, onStatus = () => {} }) {
  let stopped = false;
  const hid = newSid(); // this offer — an answer to an older one is ignored
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const ch = pc.createDataChannel("ink", { ordered: true });
  ch.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch { /* bad message */ } };
  ch.onopen = () => onStatus("live");
  pc.onconnectionstatechange = () => { if (["failed", "disconnected"].includes(pc.connectionState)) onStatus("failed"); };
  let canvas = null;
  let sender = null;
  const trackOf = (c) => c.captureStream(30).getVideoTracks()[0];
  const follow = () => {
    const c = getCanvas();
    if (!c || c === canvas || stopped) return;
    canvas = c;
    const tr = trackOf(c);
    if (sender) sender.replaceTrack(tr).catch(() => {});
    else {
      sender = pc.addTrack(tr);
      const p = sender.getParameters();
      if (p.encodings?.[0]) { p.encodings[0].maxBitrate = 8_000_000; sender.setParameters(p).catch(() => {}); }
    }
  };
  follow();
  if (!sender) pc.addTransceiver("video", { direction: "sendonly" }); // no film yet — the track comes in later
  const swap = setInterval(() => {
    const c = getCanvas();
    if (!c || c === canvas) return;
    if (!sender) { const t = pc.getTransceivers()[0]; sender = t?.sender || null; }
    canvas = c;
    sender?.replaceTrack(trackOf(c)).catch(() => {});
  }, 1000);
  let unsub = null;
  (async () => {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (stopped) return;
    await setDoc(RTC, { sid, hid, offer: pc.localDescription.sdp, answer: null, ahid: null, at: serverTimestamp() });
    unsub = onSnapshot(RTC, (d) => {
      const x = d.data();
      if (stopped || x?.sid !== sid || x.ahid !== hid || !x.answer || pc.remoteDescription) return;
      pc.setRemoteDescription({ type: "answer", sdp: x.answer }).catch((e) => { console.error("draw answer", e); onStatus("failed"); });
    }, () => {});
  })().catch((e) => { console.error("draw offer", e); onStatus("failed"); });
  // The fallback: ink written to Firestore.
  const unInk = onSnapshot(INK, (d) => {
    const x = d.data();
    if (stopped || x?.sid !== sid || ch.readyState === "open") return;
    onMsg({ t: "all", strokes: x.strokes || [] });
    onMsg({ t: "cur", s: x.cur || null });
  }, () => {});
  return () => { stopped = true; clearInterval(swap); unsub?.(); unInk(); try { ch.close(); } catch { /* closed */ } pc.close(); };
}

/** The iPad: join the PC's session sid. onStream(MediaStream), onStatus("connecting"
 *  | "live" | "failed"). → { send(msg), stop() } */
export function joinDraw(sid, { onStream, onStatus = () => {} }) {
  let stopped = false;
  let pc = null;
  let ch = null;
  let strokes = [];
  let cur = null;
  let inkWait = null;
  // The fallback (no channel): the ink in Firestore, at most ~6× a second.
  const writeInk = () => {
    if (inkWait) return;
    inkWait = setTimeout(() => { inkWait = null; if (!stopped) safe(() => setDoc(INK, { sid, strokes, cur }), "draw ink"); }, 160);
  };
  let hid = null;
  onStatus("connecting");
  const unsub = onSnapshot(RTC, async (d) => {
    const x = d.data();
    if (stopped || x?.sid !== sid || !x.offer || x.hid === hid) return;
    // A new offer for this session (the PC re-hosted): start over on it.
    hid = x.hid;
    try { ch?.close(); } catch { /* closed */ }
    pc?.close();
    ch = null;
    pc = new RTCPeerConnection({ iceServers: ICE });
    const mine = pc;
    pc.ontrack = (e) => onStream(e.streams[0] || new MediaStream([e.track]));
    pc.ondatachannel = (e) => { if (pc !== mine) return; ch = e.channel; ch.onopen = () => { onStatus("live"); ch.send(JSON.stringify({ t: "all", strokes })); }; };
    pc.onconnectionstatechange = () => { if (pc === mine && ["failed", "disconnected"].includes(mine.connectionState)) onStatus("failed"); };
    try {
      await mine.setRemoteDescription({ type: "offer", sdp: x.offer });
      await mine.setLocalDescription(await mine.createAnswer());
      await gathered(mine);
      if (!stopped && pc === mine) await setDoc(RTC, { answer: mine.localDescription.sdp, ahid: x.hid }, { merge: true });
    } catch (e) { console.error("draw join", e); onStatus("failed"); }
  }, () => onStatus("failed"));
  const send = (m) => {
    if (m.t === "all") { strokes = m.strokes; cur = null; }
    if (m.t === "cur") cur = m.s;
    if (ch?.readyState === "open") { ch.send(JSON.stringify(m)); return; }
    if (m.t === "cmd") sendCmd(m.type, m.args).catch(() => {});
    else writeInk();
  };
  return { send, stop: () => { stopped = true; clearTimeout(inkWait); unsub(); try { ch?.close(); } catch { /* closed */ } pc?.close(); } };
}

