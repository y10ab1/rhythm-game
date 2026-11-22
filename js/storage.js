// Tiny IndexedDB wrapper: uploaded songs + analysis cache.
const DB_NAME = 'rhythm-game';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      // some iOS in-app browsers never answer indexedDB.open; give up after 2s instead of hanging the song list
      const timer = setTimeout(() => rej(new Error('IndexedDB timeout')), 2000);
      const req = indexedDB.open(DB_NAME, 1);
      req.onblocked = () => rej(new Error('IndexedDB blocked'));
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache');
      };
      req.onsuccess = () => { clearTimeout(timer); res(req.result); };
      req.onerror = () => { clearTimeout(timer); rej(req.error); };
    });
  }
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export const storage = {
  // metadata only (no audio data) for the song list
  async listSongs() {
    try {
      const all = await run('songs', 'readonly', s => s.getAll());
      return (all || []).map(({ data, ...meta }) => meta).sort((a, b) => b.addedAt - a.addedAt);
    } catch { return []; }
  },
  getSong: id => run('songs', 'readonly', s => s.get(id)),
  putSong: rec => run('songs', 'readwrite', s => s.put(rec)),
  deleteSong: id => run('songs', 'readwrite', s => s.delete(id)),
  async cacheGet(key) { try { return await run('cache', 'readonly', s => s.get(key)); } catch { return undefined; } },
  async cachePut(key, val) { try { await run('cache', 'readwrite', s => s.put(val, key)); } catch {} },
  cacheDelete: key => run('cache', 'readwrite', s => s.delete(key)),
};
