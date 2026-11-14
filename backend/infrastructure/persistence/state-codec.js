// backend/infrastructure/persistence/state-codec.js
// Converts the storage engine's in-memory state (one object of collections) to and from the row model used by the
// D1 state store, and computes the minimal set of row changes between two versions of that state.
//
// Shared by the runtime driver (d1-state-store.js) and the JSON → D1 import tool (scripts/d1/json-to-d1.js), so an
// imported database is byte-for-byte what the Worker itself would have written.
//
// Row model
//   collection  top-level key of the state whose value is an array (e.g. "orders", or "cmsContents" created at runtime)
//   doc_key     the record's string id; records without a usable id, or a repeated id, get a positional key
//   pos         REAL ordering key — array order is behaviour (services unshift newest-first), so it must round-trip
//   doc         JSON.stringify(record) — stored verbatim
// Every other top-level value (only `meta` today) is stored as one JSON value in state_meta.

const MAX_DOC_BYTES = 1900000; // D1 maximum row size is 2,000,000 bytes; keep headroom for the other columns
const MIN_GAP = 1e-6;

function isCollectionValue(value) {
  return Array.isArray(value);
}

function baseKeyOf(record) {
  if (record && typeof record === 'object' && !Array.isArray(record)) {
    if (typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 512) return record.id;
    if (typeof record.id === 'number' && Number.isFinite(record.id)) return `#n:${record.id}`;
  }
  return null;
}

// Deterministic keys for one collection array. Duplicate or missing ids get a key that cannot collide with a real id
// ("\u001f", the ASCII unit separator, never appears in ids. NUL cannot be used: SQLite length() stops at NUL.)
const KEY_SEP = '\u001f';
function keysForArray(arr) {
  const keys = new Array(arr.length);
  const seen = new Map();
  for (let i = 0; i < arr.length; i++) {
    const base = baseKeyOf(arr[i]);
    if (base === null) {
      keys[i] = `${KEY_SEP}idx:${i}`;
      continue;
    }
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    keys[i] = n === 0 ? base : `${base}${KEY_SEP}dup:${n}`;
  }
  return keys;
}

function stringifyDoc(collection, key, record) {
  const json = JSON.stringify(record === undefined ? null : record);
  if (json.length > MAX_DOC_BYTES) {
    const err = new Error(`Bản ghi ${collection}/${key} vượt quá giới hạn kích thước một dòng D1 (${json.length} bytes).`);
    err.statusCode = 413;
    err.code = 'RECORD_TOO_LARGE';
    throw err;
  }
  return json;
}

// Snapshot of what is persisted: { collections: Map<name, {keys:[], json:Map, pos:Map}>, meta: Map<key, json> }
function emptySnapshot() {
  return { collections: new Map(), meta: new Map() };
}

function encodeCollection(name, arr) {
  const keys = keysForArray(arr);
  const json = new Map();
  const pos = new Map();
  for (let i = 0; i < arr.length; i++) {
    json.set(keys[i], stringifyDoc(name, keys[i], arr[i]));
    pos.set(keys[i], i);
  }
  return { keys, json, pos };
}

// Full encoding of a state object (used by the import tool and for the first commit into an empty database).
function encodeState(state) {
  const snap = emptySnapshot();
  for (const [name, value] of Object.entries(state || {})) {
    if (isCollectionValue(value)) snap.collections.set(name, encodeCollection(name, value));
    else if (value !== undefined) snap.meta.set(name, JSON.stringify(value));
  }
  return snap;
}

// Ordering keys for the new array, reusing previous positions whenever the relative order of surviving rows did
// not change, so an unshift/push/splice writes only the rows that actually changed.
function assignPositions(newKeys, prevPos) {
  const out = new Map();
  if (!prevPos || prevPos.size === 0) {
    newKeys.forEach((k, i) => out.set(k, i));
    return out;
  }
  // Surviving keys must keep strictly increasing positions; otherwise renumber everything.
  let last = -Infinity;
  for (const k of newKeys) {
    if (!prevPos.has(k)) continue;
    const p = prevPos.get(k);
    if (!(p > last)) return renumber(newKeys);
    last = p;
  }
  let i = 0;
  while (i < newKeys.length) {
    const k = newKeys[i];
    if (prevPos.has(k)) {
      out.set(k, prevPos.get(k));
      i++;
      continue;
    }
    // run of new keys [i, j)
    let j = i;
    while (j < newKeys.length && !prevPos.has(newKeys[j])) j++;
    const lo = i > 0 ? out.get(newKeys[i - 1]) : -Infinity;
    const hi = j < newKeys.length ? prevPos.get(newKeys[j]) : Infinity;
    const m = j - i;
    for (let t = 0; t < m; t++) {
      let p;
      if (lo === -Infinity && hi === Infinity) p = t;
      else if (lo === -Infinity) p = hi - (m - t);
      else if (hi === Infinity) p = lo + t + 1;
      else {
        if (!((hi - lo) / (m + 1) > MIN_GAP)) return renumber(newKeys);
        p = lo + ((hi - lo) * (t + 1)) / (m + 1);
      }
      out.set(newKeys[i + t], p);
    }
    i = j;
  }
  return out;
}

function renumber(keys) {
  const out = new Map();
  keys.forEach((k, i) => out.set(k, i));
  return out;
}

// Computes the row changes needed to turn `prev` (snapshot of what D1 holds) into `state`.
// Returns { upserts:[{collection,key,pos,doc}], deletes:[{collection,key}], meta:[{key,value}], metaDeletes:[key],
//           changedCollections:Set, next: snapshot-after-commit }
function diffState(prev, state) {
  const upserts = [];
  const deletes = [];
  const meta = [];
  const metaDeletes = [];
  const changedCollections = new Set();
  const next = emptySnapshot();

  const names = new Set();
  for (const [name, value] of Object.entries(state || {})) {
    if (isCollectionValue(value)) names.add(name);
  }
  for (const name of prev.collections.keys()) names.add(name);

  for (const name of names) {
    const arr = isCollectionValue(state[name]) ? state[name] : [];
    const before = prev.collections.get(name) || { keys: [], json: new Map(), pos: new Map() };
    const keys = keysForArray(arr);
    const positions = assignPositions(keys, before.pos);
    const json = new Map();
    for (let i = 0; i < arr.length; i++) {
      const k = keys[i];
      const doc = stringifyDoc(name, k, arr[i]);
      json.set(k, doc);
      const p = positions.get(k);
      if (before.json.get(k) !== doc || before.pos.get(k) !== p) {
        upserts.push({ collection: name, key: k, pos: p, doc });
        changedCollections.add(name);
      }
    }
    for (const k of before.keys) {
      if (!json.has(k)) {
        deletes.push({ collection: name, key: k });
        changedCollections.add(name);
      }
    }
    if (arr.length > 0 || prev.collections.has(name)) {
      next.collections.set(name, { keys, json, pos: positions });
    }
  }

  for (const [key, value] of Object.entries(state || {})) {
    if (isCollectionValue(value) || value === undefined) continue;
    const j = JSON.stringify(value);
    next.meta.set(key, j);
    if (prev.meta.get(key) !== j) meta.push({ key, value: j });
  }
  for (const key of prev.meta.keys()) {
    if (!next.meta.has(key)) metaDeletes.push(key);
  }

  return { upserts, deletes, meta, metaDeletes, changedCollections, next };
}

// Rebuilds collections from D1 rows: rows = [{collection, doc_key, pos, doc}] (any order).
function decodeRows(rows) {
  const grouped = new Map();
  for (const r of rows || []) {
    if (!grouped.has(r.collection)) grouped.set(r.collection, []);
    grouped.get(r.collection).push(r);
  }
  const collections = {};
  const snapshot = new Map();
  for (const [name, list] of grouped) {
    list.sort((a, b) => (Number(a.pos) - Number(b.pos)) || (a.doc_key < b.doc_key ? -1 : a.doc_key > b.doc_key ? 1 : 0));
    collections[name] = list.map(r => JSON.parse(r.doc));
    const keys = list.map(r => r.doc_key);
    snapshot.set(name, {
      keys,
      json: new Map(list.map(r => [r.doc_key, r.doc])),
      pos: new Map(list.map(r => [r.doc_key, Number(r.pos)]))
    });
  }
  return { collections, snapshot };
}

module.exports = {
  MAX_DOC_BYTES,
  keysForArray,
  emptySnapshot,
  encodeState,
  encodeCollection,
  assignPositions,
  diffState,
  decodeRows
};
