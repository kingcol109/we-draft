// src/components/recruitSim/useRecruitSim.js
//
// One Recruit Sim save for pages/RecruitSim.jsx: the engine state
// (utils/recruitSim/engine.js), user actions (utils/recruitSim/actions.js —
// the same rule-checked calls the CPU uses), window advances on a Web Worker
// (utils/recruitSim/worker.js, main-thread fallback) and autosave to
// IndexedDB (utils/recruitSim/storage.js).
//
// The engine mutates state in place for speed; React re-renders off `ver`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as A from "../../utils/recruitSim/actions";
import { rehydrate, toStorable, classRankings } from "../../utils/recruitSim/engine";
import { classReport } from "../../utils/recruitSim/grading";
import { STAGES } from "../../utils/recruitSim/config";
import { writeSave, saveClass } from "../../utils/recruitSim/storage";
import { buildDerived } from "../../utils/recruitSim/model";

// ── Worker plumbing ──
let worker = null;
let seq = 0;
const pending = new Map();
function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL("../../utils/recruitSim/worker.js", import.meta.url));
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.state);
    };
    worker.onerror = () => { pending.forEach((p) => p.reject(new Error("worker failed"))); pending.clear(); worker = false; };
  } catch { worker = false; }
  return worker;
}
function callWorker(msg) {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("no worker"));
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ ...msg, id }); });
}
const stripCtx = (s) => { const { ctxs, ...rest } = s; return rest; };

// Build a new save (worker, else here).
export async function createSave(args) {
  try {
    const st = await callWorker({ type: "init", args });
    return st;
  } catch {
    const { initSave } = await import("../../utils/recruitSim/engine");
    const { defaultTier } = await import("../../utils/portalSim/config");
    return stripCtx(initSave({ ...args, defaultTier }));
  }
}
async function runAdvance(state) {
  try {
    return await callWorker({ type: "advance", state: stripCtx(state) });
  } catch {
    const { advance } = await import("../../utils/recruitSim/engine");
    return stripCtx(advance(state));
  }
}

export const saveMeta = (st, id) => ({ id, school: st.schools[st.user].name, slug: st.schools[st.user].slug, stage: st.stage, label: STAGES[st.stage]?.label || "Complete", updated: st.updated || Date.now(), commits: st.schools[st.user].commits.length });

export default function useRecruitSim(initial, saveId) {
  const ref = useRef(initial.derived ? initial : rehydrate(initial));
  const [ver, setVer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const state = ref.current;
  const bump = useCallback(() => setVer((v) => v + 1), []);

  // Autosave (debounced) after any change.
  const timer = useRef(null);
  const persist = useCallback((now = false) => {
    clearTimeout(timer.current);
    const go = () => { const st = ref.current; st.updated = Date.now(); writeSave(saveId, toStorable(st), saveMeta(st, saveId)).catch(() => {}); };
    if (now) go(); else timer.current = setTimeout(go, 900);
  }, [saveId]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const act = useCallback((fn) => {
    const r = fn(ref.current);
    if (r?.error) { setError(r.error); return false; }
    setError("");
    bump();
    persist();
    return true;
  }, [bump, persist]);

  const s = state.user;
  const actions = useMemo(() => ({
    add: (r) => act((st) => A.addToBoard(st, s, r)),
    remove: (r) => act((st) => A.removeFromBoard(st, s, r)),
    place: (r, k) => act((st) => A.placeOnLine(st, s, r, k)),
    setLine: (ids) => act((st) => A.setLine(st, s, ids)),
    offer: (r, amt) => act((st) => A.setOffer(st, s, r, amt)),
    assign: (role, a) => act((st) => A.assignStaff(st, s, role, a)),
    repeatStaff: () => act((st) => A.repeatStaff(st, s)),
    reorderBoard: (ids) => act((st) => A.reorderBoard(st, s, ids)),
    // Fill the line with the top of the board (helper for the line's first window).
    autoLine: (order) => act((st) => A.setLine(st, s, order)),
  }), [act, s]);

  const advance = useCallback(async () => {
    const check = A.advanceCheck(ref.current, s);
    if (check.blocks.length) { setError(check.blocks[0]); return false; }
    setBusy(true);
    setError("");
    try {
      const next = await runAdvance(ref.current);
      if (!next.derived) buildDerived(next);
      ref.current = next;
      if (next.stage >= STAGES.length && !next.classSaved) {
        // Graded on TRUE overall (the website rank rides along).
        const ranks = classRankings(next, "dev");
        const web = classRankings(next);
        const k = ranks.findIndex((c) => c.s === next.user) + 1;
        const sc = next.schools[next.user];
        next.classSaved = true;
        saveClass({
          slug: sc.slug, school: sc.name, finished: Date.now(), rank: k, webRank: web.findIndex((c) => c.s === next.user) + 1, field: ranks.length, grade: classReport(next, next.user).grade, score: ranks[k - 1]?.score || 0,
          signees: sc.commits.map((r) => { const x = next.recruits[r]; return [`${x.first} ${x.last}`, x.pos, x.stars, x.rating, x.rank, x.ovrDev != null ? x.ovrDev : Math.round(x.ovr * 10) / 10]; }),
        });
      }
      persist(true);
      bump();
      return true;
    } catch (e) {
      setError(e.message || "Couldn't advance.");
      return false;
    } finally { setBusy(false); }
  }, [s, bump, persist]);

  return { state, ver, busy, error, clearError: () => setError(""), actions, advance, check: A.advanceCheck(state, s) };
}
