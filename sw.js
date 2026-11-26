const CACHE_NAME = 'sona-shell-v2';
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './js/main.js',
  './js/icons.js',
  './js/lib/palettes.js',
  './js/lib/waveform.js',
  './js/lib/subtitles.js',
  './js/lib/metadata.js',
  './js/lib/demoTracks.js',
  './js/lib/storage.js',
  './js/engine/audioEngine.js',
  './js/engine/visualizers/auroraShader.js',
  './js/engine/visualizers/harmonicHalo.js',
  './js/engine/visualizers/prismBars.js',
  './js/engine/visualizers/oscilloscope.js',
  './js/engine/visualizers/nebulaWarp.js',
  './js/ui/stageController.js',
  './js/ui/waveformScrubber.js',
  './js/ui/equalizerView.js',
  './js/ui/visualStudioView.js',
  './js/ui/libraryView.js',
  './js/ui/queueView.js',
  './js/ui/addMediaModal.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  if (request.headers.has('range') || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});
