const DB_NAME = 'sona-media-db';
const DB_VERSION = 1;
const STORE_TRACKS = 'tracks';
const STORE_BLOBS = 'mediaBlobs';
const STORE_PLAYLISTS = 'playlists';
const SETTINGS_KEY = 'sona-settings-v1';

export const DEFAULT_EQ_STATE = {
  enabled: true,
  preset: 'Studio Flat',
  preamp: 0,
  pan: 0,
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_VISUALIZER_SETTINGS = {
  mode: 'aurora',
  palettePreset: 'artwork',
  intensity: 1.15,
  bloom: true,
  showTrackHud: true,
  videoAmbilight: true,
  videoOverlay: false,
};

export const DEFAULT_PERSISTED_SETTINGS = {
  eq: DEFAULT_EQ_STATE,
  visualizer: DEFAULT_VISUALIZER_SETTINGS,
  volume: 0.85,
  muted: false,
  playbackRate: 1,
  shuffle: false,
  repeat: 'all',
  favoriteDemoIds: ['demo-nocturne-in-glass'],
};

export function loadPersistedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_PERSISTED_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PERSISTED_SETTINGS,
      ...parsed,
      eq: { ...DEFAULT_EQ_STATE, ...(parsed.eq || {}) },
      visualizer: { ...DEFAULT_VISUALIZER_SETTINGS, ...(parsed.visualizer || {}) },
      favoriteDemoIds: Array.isArray(parsed.favoriteDemoIds)
        ? parsed.favoriteDemoIds
        : DEFAULT_PERSISTED_SETTINGS.favoriteDemoIds,
    };
  } catch {
    return structuredClone(DEFAULT_PERSISTED_SETTINGS);
  }
}

export function savePersistedSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

function openMediaDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
        db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

function runTx(storeName, mode, executor) {
  return openMediaDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = executor(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
      })
  );
}

export async function saveLocalTrackToDb(track, fileBlob) {
  try {
    if (fileBlob && track.blobKey) {
      await runTx(STORE_BLOBS, 'readwrite', (store) => store.put(fileBlob, track.blobKey));
    }
    const record = {
      ...track,
      src: track.sourceType === 'local' ? '' : track.src,
    };
    await runTx(STORE_TRACKS, 'readwrite', (store) => store.put(record));
  } catch {
    // Ignore DB errors
  }
}

export async function updateTrackInDb(track) {
  if (track.sourceType === 'demo') return;
  try {
    const record = {
      ...track,
      src: track.sourceType === 'local' ? '' : track.src,
    };
    await runTx(STORE_TRACKS, 'readwrite', (store) => store.put(record));
  } catch {
    // Ignore DB errors
  }
}

export async function loadSavedTracksFromDb() {
  try {
    const tracks = await runTx(STORE_TRACKS, 'readonly', (store) => store.getAll());
    const rehydrated = [];
    for (const track of tracks) {
      if (track.sourceType === 'local' && track.blobKey) {
        try {
          const blob = await runTx(STORE_BLOBS, 'readonly', (store) => store.get(track.blobKey));
          if (blob) {
            rehydrated.push({
              ...track,
              src: URL.createObjectURL(blob),
            });
          }
        } catch {
          // Skip missing blob
        }
      } else if (track.sourceType === 'url' && track.src) {
        rehydrated.push(track);
      }
    }
    return rehydrated.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function deleteTrackFromDb(track) {
  if (track.sourceType === 'demo') return;
  try {
    await runTx(STORE_TRACKS, 'readwrite', (store) => store.delete(track.id));
    if (track.blobKey) {
      await runTx(STORE_BLOBS, 'readwrite', (store) => store.delete(track.blobKey));
    }
  } catch {
    // Ignore DB errors
  }
}

export async function loadPlaylistsFromDb() {
  try {
    const list = await runTx(STORE_PLAYLISTS, 'readonly', (store) => store.getAll());
    return list.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function savePlaylistToDb(playlist) {
  try {
    await runTx(STORE_PLAYLISTS, 'readwrite', (store) => store.put(playlist));
  } catch {
    // Ignore DB errors
  }
}

export async function deletePlaylistFromDb(id) {
  try {
    await runTx(STORE_PLAYLISTS, 'readwrite', (store) => store.delete(id));
  } catch {
    // Ignore DB errors
  }
}
