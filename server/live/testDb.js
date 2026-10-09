// server/live/testDb.js — tests only.
//
// A path-keyed in-memory Firestore: just what pickSummaries.js uses.
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const reads = { n: 0 };
  const ms = (v) => (v?.toMillis ? v.toMillis() : v);
  const snap = (path) => ({ id: path.split("/").pop(), exists: store.has(path), data: () => store.get(path) });
  const docRef = (path) => ({
    path,
    collection: (c) => colRef(`${path}/${c}`),
    get: async () => { reads.n++; return snap(path); },
    set: async (d, opts) => {
      const plain = (v) => (v?.toMillis ? v : JSON.parse(JSON.stringify(v)));
      const next = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, plain(v)]));
      store.set(path, opts?.merge && store.has(path) ? { ...store.get(path), ...next } : next);
    },
  });
  const colRef = (col, filters = [], order = null, max = Infinity) => ({
    doc: (id) => docRef(`${col}/${id}`),
    where: (f, op, v) => colRef(col, [...filters, [f, op, v]], order, max),
    orderBy: (f) => colRef(col, filters, f, max),
    limit: (n) => colRef(col, filters, order, n),
    select: () => colRef(col, filters, order, max),
    get: async () => {
      let docs = [...store.keys()].filter((p) => p.startsWith(`${col}/`) && p.split("/").length === col.split("/").length + 1)
        .filter((p) => filters.every(([f, op, v]) => {
          const x = ms(store.get(p)[f]);
          return x != null && (op === ">" ? x > ms(v) : op === ">=" ? x >= ms(v) : op === "<=" ? x <= ms(v) : x === v);
        }));
      if (order) docs.sort((a, b) => ms(store.get(a)[order]) - ms(store.get(b)[order]));
      docs = docs.slice(0, max).map(snap);
      reads.n += Math.max(1, docs.length);
      return { docs, empty: !docs.length, size: docs.length };
    },
  });
  return {
    store, reads,
    collection: (c) => colRef(c),
    getAll: async (...refs) => { reads.n += refs.length; return refs.map((r) => snap(r.path)); },
    batch: () => { const ops = []; return { set: (ref, d, o) => ops.push(() => ref.set(d, o)), commit: async () => { for (const o of ops) await o(); } }; },
  };
}

module.exports = { fakeDb };
