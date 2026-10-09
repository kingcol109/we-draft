// server/stream-manager/__fakes__/firestore.js
//
// In-memory stand-in for the slice of the Admin SDK Firestore API that
// Stream Manager uses (tests only): doc / collection / where (== and ranges) / limit /
// get / set (merge) / update (dotted paths) / runTransaction.

const isPlain = (v) => v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const clone = (v) => (Array.isArray(v) ? v.map(clone) : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
function setPath(o, p, v) {
  const ks = p.split(".");
  let x = o;
  for (const k of ks.slice(0, -1)) { if (!isPlain(x[k])) x[k] = {}; x = x[k]; }
  x[ks[ks.length - 1]] = clone(v);
}
function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (isPlain(v) && isPlain(a[k])) deepMerge(a[k], v);
    else a[k] = clone(v);
  }
  return a;
}

// Range filters compare Timestamps ({ toMillis }) and Dates by time.
const cmp = (x) => (x?.toMillis ? x.toMillis() : x instanceof Date ? x.getTime() : x);
const OPS = {
  "==": (a, b) => a === b,
  "<": (a, b) => a != null && cmp(a) < cmp(b),
  "<=": (a, b) => a != null && cmp(a) <= cmp(b),
  ">": (a, b) => a != null && cmp(a) > cmp(b),
  ">=": (a, b) => a != null && cmp(a) >= cmp(b),
};

function fakeFirestore(seed = {}) {
  const store = new Map(); // "col/id" → data
  for (const [path, data] of Object.entries(seed)) store.set(path, clone(data));
  let autoId = 0;
  let txChain = Promise.resolve(); // transactions run one at a time, like Firestore's retries would make them

  const snap = (path) => {
    const d = store.get(path);
    return { id: path.split("/").pop(), exists: d !== undefined, ref: docRef(path), data: () => (d === undefined ? undefined : clone(d)) };
  };

  function docRef(path) {
    return {
      id: path.split("/").pop(),
      path,
      get: async () => snap(path),
      set: async (data, opts) => { store.set(path, opts?.merge && store.has(path) ? deepMerge(store.get(path), data) : clone(data)); },
      update: async (upd) => {
        if (!store.has(path)) throw Object.assign(new Error(`no document ${path}`), { code: 5 });
        const d = store.get(path);
        for (const [k, v] of Object.entries(upd)) setPath(d, k, v);
      },
      delete: async () => { store.delete(path); },
    };
  }

  function query(col, filters = [], max = Infinity) {
    return {
      where: (f, op, v) => {
        if (!OPS[op]) throw new Error(`fake firestore: only ==, <, <=, >, >= (got ${op})`);
        return query(col, [...filters, [f, v, op]], max);
      },
      limit: (n) => query(col, filters, n),
      get: async () => {
        const docs = [...store.keys()]
          .filter((p) => p.startsWith(`${col}/`) && p.split("/").length === 2)
          .filter((p) => filters.every(([f, v, op = "=="]) => OPS[op](getPath(store.get(p), f), v)))
          .slice(0, max)
          .map(snap);
        return { docs, empty: !docs.length, size: docs.length };
      },
    };
  }

  const db = {
    store,
    doc: (path) => docRef(path),
    collection: (col) => ({
      ...query(col),
      doc: (id) => docRef(`${col}/${id ?? `auto${++autoId}`}`),
      add: async (data) => { const r = docRef(`${col}/auto${++autoId}`); await r.set(data); return r; },
    }),
    runTransaction(fn) {
      const run = txChain.then(() => fn(tx));
      txChain = run.catch(() => {});
      return run;
    },
    data: (path) => clone(store.get(path)),
  };
  const tx = {
    get: (x) => x.get(),
    set: (ref, data, opts) => ref.set(data, opts),
    update: (ref, upd) => ref.update(upd),
    delete: (ref) => ref.delete(),
  };
  return db;
}

module.exports = { fakeFirestore };
