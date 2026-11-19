/* eslint-disable no-restricted-globals */
// src/utils/recruitSim/worker.js
//
// Runs the heavy engine steps off the main thread (spec §29): building a new
// save (3,000 recruits × every school) and closing a window (~0.5s of work
// across 138 schools). Messages:
//   { id, type: "init", args }      → { id, state }
//   { id, type: "advance", state }  → { id, state }
// State crosses as a structured clone (plain data + typed arrays).
import { initSave, advance } from "./engine";
import { defaultTier } from "../portalSim/config";

self.onmessage = (e) => {
  const { id, type } = e.data || {};
  try {
    if (type === "init") {
      const state = initSave({ ...e.data.args, defaultTier });
      delete state.ctxs;
      self.postMessage({ id, state });
    } else if (type === "advance") {
      const state = advance(e.data.state);
      delete state.ctxs;
      self.postMessage({ id, state });
    }
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
