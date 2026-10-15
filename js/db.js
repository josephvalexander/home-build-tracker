// Small IndexedDB wrapper. Every synced record has: id, updatedAt (ms), deleted (bool).
const DB_NAME = 'home-build-tracker';
const DB_VERSION = 1;
export const SYNC_TABLES = ['settings', 'stages', 'categories', 'vendors', 'milestones', 'expenses', 'attachments'];
const STORES = [...SYNC_TABLES, 'blobs'];

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    let result;
    const r = fn(os);
    if (r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const all = store => run(store, 'readonly', os => os.getAll());
export const get = (store, id) => run(store, 'readonly', os => os.get(id));
export const list = async store => (await all(store)).filter(r => !r.deleted);

export function markDirty() {
  localStorage.setItem('hbt.dirtyAt', String(Date.now()));
  window.dispatchEvent(new CustomEvent('hbt:changed'));
}

// put(): user edit — stamps updatedAt and marks data as needing sync.
// opts.silent: stamp but don't trigger a sync (used by the sync engine itself).
export async function put(store, rec, opts = {}) {
  rec.updatedAt = Date.now();
  if (rec.deleted === undefined) rec.deleted = false;
  await run(store, 'readwrite', os => os.put(rec));
  if (!opts.silent && SYNC_TABLES.includes(store)) markDirty();
  return rec;
}

// putRaw(): write exactly as given (merges from Drive, blobs).
export async function putRaw(store, recs) {
  const arr = Array.isArray(recs) ? recs : [recs];
  if (!arr.length) return;
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const r of arr) os.put(r);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function softDelete(store, id) {
  const rec = await get(store, id);
  if (!rec) return;
  rec.deleted = true;
  await put(store, rec);
}

export const hardDelete = (store, id) => run(store, 'readwrite', os => os.delete(id));

// Default data uses fixed ids and updatedAt 0, so a second device never duplicates them
// and anything already on Drive always wins.
const DEFAULT_STAGES = [
  ['site', 'Site prep & permits'], ['foundation', 'Foundation'], ['plinth', 'Plinth & basement'],
  ['structure', 'Superstructure'], ['roofing', 'Roofing'], ['mep', 'Electrical & plumbing'],
  ['plaster', 'Plastering'], ['flooring', 'Flooring & tiling'], ['carpentry', 'Doors, windows & carpentry'],
  ['finishing', 'Painting & finishing'],
];
const DEFAULT_CATEGORIES = [
  ['material', 'Material'], ['labour', 'Labour'], ['contractor', 'Contractor'], ['equipment', 'Equipment'],
  ['fees', 'Permits & fees'], ['transport', 'Transport'], ['other', 'Other'],
];

export async function seed() {
  if (await get('settings', 'settings')) return false;
  await putRaw('settings', { id: 'settings', projectName: 'Our New Home', totalBudget: 0, updatedAt: 0, deleted: false });
  await putRaw('stages', DEFAULT_STAGES.map(([k, name], i) => ({ id: 'stage-' + k, name, budget: 0, order: i, updatedAt: 0, deleted: false })));
  await putRaw('categories', DEFAULT_CATEGORIES.map(([k, name], i) => ({ id: 'cat-' + k, name, order: i, updatedAt: 0, deleted: false })));
  return true;
}

// Bill files are stored as ArrayBuffer + type (more reliable than Blob in older iOS WebKit).
export async function saveBlob(id, blob) {
  const buf = await blob.arrayBuffer();
  await putRaw('blobs', { id, buf, type: blob.type || 'application/octet-stream' });
}
export async function loadBlob(id) {
  const r = await get('blobs', id);
  return r ? new Blob([r.buf], { type: r.type }) : null;
}
