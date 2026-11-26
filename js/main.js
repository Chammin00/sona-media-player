import { icon } from './icons.js';
import { audioEngine, EQ_PRESETS } from './engine/audioEngine.js';
import { CURATED_PALETTES, DEFAULT_PALETTE, extractPaletteFromImage } from './lib/palettes.js';
import { createDemoTracks } from './lib/demoTracks.js';
import { extractTrackFromFile, inferMediaKindFromName, isSubtitleFile, parseTitleArtistFromFilename } from './lib/metadata.js';
import { generateFallbackPeaks } from './lib/waveform.js';
import { parseSubtitles } from './lib/subtitles.js';
import {
  deletePlaylistFromDb,
  deleteTrackFromDb,
  loadPersistedSettings,
  loadPlaylistsFromDb,
  loadSavedTracksFromDb,
  saveLocalTrackToDb,
  savePersistedSettings,
  savePlaylistToDb,
  updateTrackInDb,
} from './lib/storage.js';
import { formatTime, positionGlider } from './ui/glider.js';
import { StageController } from './ui/stageController.js';
import { WaveformScrubber } from './ui/waveformScrubber.js';
import { EqualizerView } from './ui/equalizerView.js';
import { VisualStudioView } from './ui/visualStudioView.js';
import { LibraryView } from './ui/libraryView.js';
import { QueueView } from './ui/queueView.js';
import { AddMediaModal } from './ui/addMediaModal.js';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const VISUALIZER_ORDER = ['aurora', 'halo', 'prism', 'oscilloscope', 'nebula'];

const persisted = loadPersistedSettings();

const state = {
  tracks: [],
  playlists: [],
  queue: [],
  currentTrackId: null,
  isPlaying: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  volume: persisted.volume,
  muted: persisted.muted,
  playbackRate: persisted.playbackRate,
  shuffle: persisted.shuffle,
  repeat: persisted.repeat,
  eq: persisted.eq,
  visualizer: persisted.visualizer,
  activePalette: DEFAULT_PALETTE,
  loop: { a: null, b: null, active: false },
  cues: [],
  subtitleName: '',
  libraryFilter: 'all',
  searchQuery: '',
  inspectorTab: 'visuals',
  mobileTab: 'stage',
  libraryCollapsed: false,
  inspectorCollapsed: false,
  sleepMinutesLeft: 0,
  sleepActivePreset: 0,
  error: '',
  favoriteDemoIds: new Set(persisted.favoriteDemoIds),
};

let sleepIntervalId = 0;
let toastTimerId = 0;
let deferredInstallPrompt = null;
let lastPositionSync = 0;
let currentLoadedSrc = '';
let retriedWithoutCors = false;

function getCurrentTrack() {
  return state.tracks.find((t) => t.id === state.currentTrackId) || null;
}

function getStateSnapshot() {
  return {
    ...state,
    currentTrack: getCurrentTrack(),
  };
}

function resolveActivePalette() {
  const preset = state.visualizer.palettePreset;
  if (preset !== 'artwork' && CURATED_PALETTES[preset]) {
    state.activePalette = CURATED_PALETTES[preset];
  } else {
    const track = getCurrentTrack();
    state.activePalette = track?.palette || DEFAULT_PALETTE;
  }

  const root = document.documentElement.style;
  root.setProperty('--accent-primary', state.activePalette[0]);
  root.setProperty('--accent-secondary', state.activePalette[1]);
  root.setProperty('--accent-tertiary', state.activePalette[2]);
}

function persistSettings() {
  savePersistedSettings({
    eq: state.eq,
    visualizer: state.visualizer,
    volume: state.volume,
    muted: state.muted,
    playbackRate: state.playbackRate,
    shuffle: state.shuffle,
    repeat: state.repeat,
    favoriteDemoIds: Array.from(state.favoriteDemoIds),
  });
}

function showToast(message) {
  const toastEl = document.getElementById('sona-toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  if (toastTimerId) window.clearTimeout(toastTimerId);
  toastTimerId = window.setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2600);
}

function hydrateStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });

  document.getElementById('btn-toggle-library').innerHTML = icon('panelLeft');
  document.getElementById('btn-toggle-inspector').innerHTML = icon('panelRight');
  document.getElementById('btn-fullscreen').innerHTML = icon('maximize');
  document.getElementById('btn-close-modal').innerHTML = icon('x');
  document.getElementById('btn-stage-fx-mobile').innerHTML = icon('sliders');

  document.getElementById('btn-prev').innerHTML = icon('prev');
  document.getElementById('btn-next').innerHTML = icon('next');
  document.getElementById('btn-shuffle').innerHTML = icon('shuffle');
  document.getElementById('btn-subtitles').innerHTML = icon('captions');
  document.getElementById('btn-pip').innerHTML = icon('pip');
  document.getElementById('btn-quick-eq').innerHTML = icon('sliders');
  document.getElementById('btn-quick-queue').innerHTML = icon('listMusic');

  document.getElementById('btn-mobile-prev').innerHTML = icon('prev');
  document.getElementById('btn-mobile-next').innerHTML = icon('next');
  document.getElementById('btn-mobile-shuffle').innerHTML = icon('shuffle');
  document.getElementById('btn-mini-next').innerHTML = icon('next');
}

function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator)) return;
  const track = getCurrentTrack();
  if (!track) return;

  const artwork = track.artworkUrl
    ? [{ src: track.artworkUrl, sizes: '512x512', type: 'image/png' }]
    : [{ src: './icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }];

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || 'SONA Studio',
      artwork,
    });
  } catch {
    // Ignore unsupported MediaMetadata shapes
  }
}

function syncMediaSessionPlaybackState() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
    if (
      typeof navigator.mediaSession.setPositionState === 'function' &&
      Number.isFinite(state.duration) &&
      state.duration > 0
    ) {
      navigator.mediaSession.setPositionState({
        duration: state.duration,
        playbackRate: state.playbackRate,
        position: Math.min(state.duration, Math.max(0, state.currentTime)),
      });
    }
  } catch {
    // Ignore invalid position errors during track load
  }
}

async function loadTrackIntoMediaElement(track, autoPlay = false) {
  const mediaEl = audioEngine.getMediaElement();
  if (!mediaEl || !track) return;

  state.error = '';
  state.isBuffering = true;
  state.currentTime = 0;
  state.duration = track.duration || 0;
  state.loop = { a: null, b: null, active: false };
  retriedWithoutCors = false;
  audioEngine.setCorsFallback(false);

  const isExternalHttp = track.src.startsWith('http://') || track.src.startsWith('https://');
  if (isExternalHttp) {
    mediaEl.crossOrigin = 'anonymous';
  } else {
    mediaEl.removeAttribute('crossorigin');
  }

  if (currentLoadedSrc !== track.src) {
    currentLoadedSrc = track.src;
    mediaEl.src = track.src;
    mediaEl.load();
  }

  mediaEl.playbackRate = state.playbackRate;
  audioEngine.applyVolume(state.volume, state.muted);
  audioEngine.applyEqState(state.eq);

  updateMediaSessionMetadata();
  renderAll();

  if (autoPlay) {
    await playCurrent();
  }
}

async function playCurrent() {
  const mediaEl = audioEngine.getMediaElement();
  const track = getCurrentTrack();
  if (!mediaEl || !track) return;

  await audioEngine.ensureContext();
  audioEngine.applyVolume(state.volume, state.muted);
  audioEngine.applyEqState(state.eq);

  try {
    await mediaEl.play();
    state.isPlaying = true;
    state.error = '';
  } catch (err) {
    if (err?.name !== 'AbortError') {
      state.isPlaying = false;
      state.error = 'Playback blocked or stream format unsupported';
    }
  }
  renderAll();
}

function pauseCurrent() {
  const mediaEl = audioEngine.getMediaElement();
  if (!mediaEl) return;
  mediaEl.pause();
  state.isPlaying = false;
  renderAll();
}

const actions = {
  togglePlay() {
    if (state.isPlaying) {
      pauseCurrent();
    } else {
      playCurrent();
    }
  },

  async playTrackById(trackId, autoPlay = true) {
    const found = state.tracks.find((t) => t.id === trackId);
    if (!found) return;
    state.currentTrackId = found.id;
    resolveActivePalette();
    await loadTrackIntoMediaElement(found, autoPlay);
  },

  seekTo(seconds) {
    const mediaEl = audioEngine.getMediaElement();
    if (!mediaEl || !Number.isFinite(seconds)) return;
    const clamped = Math.max(0, Math.min(state.duration || mediaEl.duration || seconds, seconds));
    mediaEl.currentTime = clamped;
    state.currentTime = clamped;
    syncMediaSessionPlaybackState();
    updateTimeReadouts();
  },

  async nextTrack(fromEnded = false) {
    if (state.queue.length > 0) {
      const nextId = state.queue.shift();
      if (nextId) {
        await actions.playTrackById(nextId, true);
        return;
      }
    }

    const activePool = libraryView.getFilteredTracks();
    const list = activePool.length > 0 ? activePool : state.tracks;
    if (list.length === 0) return;

    const currentIdx = list.findIndex((t) => t.id === state.currentTrackId);
    if (state.shuffle && list.length > 1) {
      let randIdx = currentIdx;
      while (randIdx === currentIdx) {
        randIdx = Math.floor(Math.random() * list.length);
      }
      await actions.playTrackById(list[randIdx].id, true);
      return;
    }

    const nextIdx = currentIdx + 1;
    if (nextIdx < list.length) {
      await actions.playTrackById(list[nextIdx].id, true);
    } else if (state.repeat === 'all' || !fromEnded) {
      await actions.playTrackById(list[0].id, true);
    } else {
      state.isPlaying = false;
      renderAll();
    }
  },

  async prevTrack() {
    const mediaEl = audioEngine.getMediaElement();
    if (mediaEl && mediaEl.currentTime > 3) {
      actions.seekTo(0);
      return;
    }

    const activePool = libraryView.getFilteredTracks();
    const list = activePool.length > 0 ? activePool : state.tracks;
    if (list.length === 0) return;

    const currentIdx = list.findIndex((t) => t.id === state.currentTrackId);
    const prevIdx = currentIdx <= 0 ? list.length - 1 : currentIdx - 1;
    await actions.playTrackById(list[prevIdx].id, true);
  },

  setVolume(vol) {
    state.volume = Math.max(0, Math.min(1, vol));
    if (state.volume > 0 && state.muted) {
      state.muted = false;
    }
    audioEngine.applyVolume(state.volume, state.muted);
    persistSettings();
    renderTransportState();
  },

  toggleMute() {
    state.muted = !state.muted;
    audioEngine.applyVolume(state.volume, state.muted);
    persistSettings();
    renderTransportState();
  },

  toggleShuffle() {
    state.shuffle = !state.shuffle;
    persistSettings();
    renderTransportState();
    showToast(state.shuffle ? 'Shuffle on' : 'Shuffle off');
  },

  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    const next = order[(order.indexOf(state.repeat) + 1) % order.length];
    state.repeat = next;
    persistSettings();
    renderTransportState();
    const labels = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
    showToast(labels[next]);
  },

  cyclePlaybackRate() {
    const idx = SPEED_OPTIONS.indexOf(state.playbackRate);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    state.playbackRate = next;
    const mediaEl = audioEngine.getMediaElement();
    if (mediaEl) mediaEl.playbackRate = next;
    persistSettings();
    renderTransportState();
  },

  cycleAbLoop() {
    const t = state.currentTime;
    if (state.loop.a === null) {
      state.loop = { a: t, b: null, active: false };
      showToast(`Loop point A set at ${formatTime(t)}`);
    } else if (state.loop.b === null) {
      const a = Math.min(state.loop.a, t);
      const b = Math.max(state.loop.a, t);
      if (b - a < 0.25) {
        state.loop = { a: null, b: null, active: false };
        showToast('A-B loop cleared');
      } else {
        state.loop = { a, b, active: true };
        showToast(`A-B loop active (${formatTime(a)} – ${formatTime(b)})`);
      }
    } else {
      state.loop = { a: null, b: null, active: false };
      showToast('A-B loop cleared');
    }
    renderTransportState();
  },

  setVisualizerSetting(key, value) {
    state.visualizer = { ...state.visualizer, [key]: value };
    resolveActivePalette();
    persistSettings();
    renderAll();
  },

  setEq(patch) {
    state.eq = { ...state.eq, ...patch };
    audioEngine.applyEqState(state.eq);
    persistSettings();
    equalizerView.update();
  },

  setEqBand(index, db) {
    const bands = [...state.eq.bands];
    bands[index] = db;
    state.eq = { ...state.eq, preset: 'Custom', bands };
    audioEngine.applyEqState(state.eq);
    persistSettings();
    equalizerView.update();
  },

  applyEqPreset(presetName) {
    const template = EQ_PRESETS[presetName];
    if (!template) return;
    state.eq = {
      ...state.eq,
      enabled: true,
      preset: presetName,
      bands: [...template],
    };
    audioEngine.applyEqState(state.eq);
    persistSettings();
    equalizerView.update();
  },

  setSleepTimer(minutes) {
    if (sleepIntervalId) {
      window.clearInterval(sleepIntervalId);
      sleepIntervalId = 0;
    }
    state.sleepActivePreset = minutes;
    state.sleepMinutesLeft = minutes;
    if (minutes > 0) {
      let secondsLeft = minutes * 60;
      sleepIntervalId = window.setInterval(() => {
        secondsLeft--;
        state.sleepMinutesLeft = Math.ceil(secondsLeft / 60);
        if (secondsLeft <= 0) {
          window.clearInterval(sleepIntervalId);
          sleepIntervalId = 0;
          state.sleepMinutesLeft = 0;
          state.sleepActivePreset = 0;
          pauseCurrent();
          showToast('Sleep timer paused playback');
        }
        renderHeaderAndStudio();
      }, 1000);
      showToast(`Sleep timer set for ${minutes} min`);
    } else {
      showToast('Sleep timer off');
    }
    renderHeaderAndStudio();
  },

  async toggleFavorite(trackId) {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.favorite = !track.favorite;
    if (track.sourceType === 'demo') {
      if (track.favorite) state.favoriteDemoIds.add(track.id);
      else state.favoriteDemoIds.delete(track.id);
      persistSettings();
    } else {
      await updateTrackInDb(track);
    }
    renderAll();
  },

  addToQueue(trackId) {
    state.queue.push(trackId);
    queueView.update();
    showToast('Added to Up Next');
  },

  moveQueueItem(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.queue.length) return;
    const copy = [...state.queue];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    state.queue = copy;
    queueView.update();
  },

  removeQueueIndex(index) {
    state.queue.splice(index, 1);
    queueView.update();
  },

  async playQueueIndex(index) {
    const [trackId] = state.queue.splice(index, 1);
    if (trackId) {
      await actions.playTrackById(trackId, true);
    }
  },

  clearQueue() {
    state.queue = [];
    queueView.update();
  },

  setLibraryFilter(filter) {
    state.libraryFilter = filter;
    libraryView.update();
  },

  setSearchQuery(query) {
    state.searchQuery = query;
    libraryView.update();
  },

  async createPlaylist(name) {
    const pl = {
      id: `pl-${crypto.randomUUID()}`,
      name,
      trackIds: [],
      createdAt: Date.now(),
    };
    state.playlists.push(pl);
    await savePlaylistToDb(pl);
    libraryView.update();
    showToast(`Created playlist "${name}"`);
  },

  async deletePlaylist(id) {
    state.playlists = state.playlists.filter((p) => p.id !== id);
    if (state.libraryFilter === `playlist:${id}`) {
      state.libraryFilter = 'all';
    }
    await deletePlaylistFromDb(id);
    libraryView.update();
  },

  async cycleAddTrackToPlaylist(trackId) {
    if (state.playlists.length === 0) return;
    let targetPl = null;
    if (state.libraryFilter.startsWith('playlist:')) {
      const plId = state.libraryFilter.slice('playlist:'.length);
      targetPl = state.playlists.find((p) => p.id === plId) || null;
    }
    if (!targetPl) {
      targetPl = state.playlists.find((p) => !p.trackIds.includes(trackId)) || state.playlists[0];
    }
    if (!targetPl.trackIds.includes(trackId)) {
      targetPl.trackIds.push(trackId);
      await savePlaylistToDb(targetPl);
      libraryView.update();
      showToast(`Added to "${targetPl.name}"`);
    } else {
      showToast(`Already in "${targetPl.name}"`);
    }
  },

  async removeTrack(trackId) {
    const idx = state.tracks.findIndex((t) => t.id === trackId);
    if (idx === -1) return;
    const [removed] = state.tracks.splice(idx, 1);
    if (removed.sourceType === 'local' && removed.src.startsWith('blob:')) {
      URL.revokeObjectURL(removed.src);
    }
    await deleteTrackFromDb(removed);

    state.queue = state.queue.filter((id) => id !== trackId);
    for (const pl of state.playlists) {
      if (pl.trackIds.includes(trackId)) {
        pl.trackIds = pl.trackIds.filter((id) => id !== trackId);
        await savePlaylistToDb(pl);
      }
    }

    if (state.currentTrackId === trackId) {
      const next = state.tracks[0] || null;
      state.currentTrackId = next ? next.id : null;
      resolveActivePalette();
      if (next) {
        await loadTrackIntoMediaElement(next, false);
      }
    }
    renderAll();
  },

  async importDroppedFiles(fileList) {
    const files = Array.from(fileList || []);
    let mediaCount = 0;
    let firstAdded = null;

    for (const file of files) {
      if (isSubtitleFile(file)) {
        await actions.loadSubtitleFile(file);
        continue;
      }
      const track = await extractTrackFromFile(file);
      if (track) {
        state.tracks.unshift(track);
        await saveLocalTrackToDb(track, file);
        if (!firstAdded) firstAdded = track;
        mediaCount++;
      }
    }

    if (firstAdded) {
      state.currentTrackId = firstAdded.id;
      resolveActivePalette();
      await loadTrackIntoMediaElement(firstAdded, true);
      showToast(`Imported ${mediaCount} media file${mediaCount > 1 ? 's' : ''}`);
    } else if (mediaCount === 0) {
      renderAll();
    }
    return mediaCount;
  },

  async addStreamUrl({ url, title, kind }) {
    const resolvedKind =
      kind === 'audio' || kind === 'video'
        ? kind
        : inferMediaKindFromName(url) || 'audio';

    const parsedName = parseTitleArtistFromFilename(
      url.split('/').pop() || 'Remote Stream'
    );
    const id = `url-${crypto.randomUUID()}`;
    const track = {
      id,
      title: title || parsedName.title || 'Remote Stream',
      artist: 'Stream URL',
      album: resolvedKind === 'video' ? 'Video Stream' : 'Audio Stream',
      duration: 0,
      kind: resolvedKind,
      sourceType: 'url',
      src: url,
      palette: await extractPaletteFromImage(''),
      addedAt: Date.now(),
      favorite: false,
      peaks: generateFallbackPeaks(url, 96),
    };

    state.tracks.unshift(track);
    await saveLocalTrackToDb(track);
    state.currentTrackId = track.id;
    resolveActivePalette();
    await loadTrackIntoMediaElement(track, true);
    showToast('Stream added');
  },

  async loadSubtitleFile(file) {
    try {
      const text = await file.text();
      const cues = parseSubtitles(text);
      state.cues = cues;
      state.subtitleName = file.name;
      addMediaModal.updateSubtitleStatus(cues.length, file.name);
      stageController.updateUi();
      showToast(cues.length > 0 ? `Loaded ${cues.length} subtitle cues` : 'No cues found in file');
    } catch {
      showToast('Failed to read subtitle file');
    }
  },

  clearSubtitles() {
    state.cues = [];
    state.subtitleName = '';
    stageController.updateUi();
    showToast('Subtitles cleared');
  },

  openAddMedia(tab = 'files') {
    addMediaModal.open(tab);
  },

  setInspectorTab(tab) {
    state.inspectorTab = tab;
    if (window.innerWidth >= 1024 && state.inspectorCollapsed) {
      state.inspectorCollapsed = false;
    }
    renderLayoutAndTabs();
  },

  setMobileTab(tab) {
    state.mobileTab = tab;
    if (tab === 'queue') {
      state.inspectorTab = 'queue';
    } else if (tab === 'fx' && state.inspectorTab === 'queue') {
      state.inspectorTab = 'visuals';
    }
    renderLayoutAndTabs();
    stageController.updateUi();
  },

  toggleFullscreen() {
    const stage = document.getElementById('visual-stage');
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (stage?.requestFullscreen) {
      stage.requestFullscreen().catch(() => {});
    }
  },

  async togglePip() {
    const videoEl = audioEngine.getMediaElement();
    if (!videoEl || getCurrentTrack()?.kind !== 'video') return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoEl.requestPictureInPicture();
      }
    } catch {
      showToast('Picture-in-Picture unavailable');
    }
  },
};

const stageController = new StageController(getStateSnapshot, actions);
const desktopScrubber = new WaveformScrubber(
  document.getElementById('desktop-waveform'),
  document.getElementById('scrubber-tooltip'),
  getStateSnapshot,
  (sec) => actions.seekTo(sec)
);
const mobileScrubber = new WaveformScrubber(
  document.getElementById('mobile-waveform'),
  null,
  getStateSnapshot,
  (sec) => actions.seekTo(sec)
);
const equalizerView = new EqualizerView(
  document.getElementById('panel-equalizer'),
  getStateSnapshot,
  actions
);
const visualStudioView = new VisualStudioView(
  document.getElementById('panel-visuals'),
  getStateSnapshot,
  actions
);
const libraryView = new LibraryView(getStateSnapshot, actions);
const queueView = new QueueView(document.getElementById('panel-queue'), getStateSnapshot, actions);
const addMediaModal = new AddMediaModal(actions);

function updateTimeReadouts() {
  const curStr = formatTime(state.currentTime);
  const totStr = state.duration > 0 ? formatTime(state.duration) : '0:00';
  document.getElementById('time-current').textContent = curStr;
  document.getElementById('time-total').textContent = totStr;
  document.getElementById('mobile-time-current').textContent = curStr;
  document.getElementById('mobile-time-total').textContent = totStr;

  const pct = state.duration > 0 ? Math.min(100, (state.currentTime / state.duration) * 100) : 0;
  document.getElementById('mini-progress-fill').style.width = `${pct}%`;

  desktopScrubber.draw();
  mobileScrubber.draw();
}

function renderHeaderAndStudio() {
  const track = getCurrentTrack();
  document.getElementById('top-track-crumb').textContent = track
    ? `${track.title} — ${track.artist}`
    : 'SONA Studio';

  const statusPill = document.getElementById('stage-status-pill');
  if (track?.kind === 'video') {
    statusPill.textContent = 'Cinema Video';
  } else {
    statusPill.textContent = state.isPlaying ? 'Live Signal' : 'Audio Ready';
  }

  const sleepBadge = document.getElementById('sleep-timer-badge');
  if (state.sleepMinutesLeft > 0) {
    sleepBadge.textContent = `Sleep ${state.sleepMinutesLeft}m`;
    sleepBadge.classList.remove('hidden');
  } else {
    sleepBadge.classList.add('hidden');
  }

  visualStudioView.update();
  equalizerView.update();
}

function renderTransportState() {
  const track = getCurrentTrack();
  const isVideo = track?.kind === 'video';
  const isFav = Boolean(track?.favorite);

  const playIconHtml = icon(state.isPlaying ? 'pause' : 'play');
  document.getElementById('btn-play').innerHTML = playIconHtml;
  document.getElementById('btn-mobile-play').innerHTML = playIconHtml;
  document.getElementById('btn-mini-play').innerHTML = playIconHtml;

  const deckArt = document.getElementById('deck-art-img');
  const miniArt = document.getElementById('mini-art-img');
  if (track?.artworkUrl) {
    deckArt.src = track.artworkUrl;
    miniArt.src = track.artworkUrl;
  } else {
    deckArt.src = './icons/icon.svg';
    miniArt.src = './icons/icon.svg';
  }

  document.getElementById('deck-title').textContent = track?.title || 'No Track Loaded';
  document.getElementById('deck-artist').textContent = track?.artist || 'Import audio or video';
  document.getElementById('mobile-track-title').textContent = track?.title || 'No Track Loaded';
  document.getElementById('mobile-track-artist').textContent = track?.artist || 'Import audio or video';
  document.getElementById('mini-title').textContent = track?.title || 'No Track Loaded';
  document.getElementById('mini-artist').textContent = track?.artist || 'SONA Studio';

  const favIcon = icon(isFav ? 'heartFilled' : 'heart');
  const deckFavBtn = document.getElementById('btn-deck-fav');
  const mobileFavBtn = document.getElementById('btn-mobile-fav');
  deckFavBtn.innerHTML = favIcon;
  mobileFavBtn.innerHTML = favIcon;
  deckFavBtn.classList.toggle('is-active', isFav);
  mobileFavBtn.classList.toggle('is-active', isFav);

  document.getElementById('btn-shuffle').classList.toggle('is-active', state.shuffle);
  document.getElementById('btn-mobile-shuffle').classList.toggle('is-active', state.shuffle);

  const repIcon = icon(state.repeat === 'one' ? 'repeat1' : 'repeat');
  const repBtn = document.getElementById('btn-repeat');
  const mobileRepBtn = document.getElementById('btn-mobile-repeat');
  repBtn.innerHTML = repIcon;
  mobileRepBtn.innerHTML = repIcon;
  repBtn.classList.toggle('is-active', state.repeat !== 'off');
  mobileRepBtn.classList.toggle('is-active', state.repeat !== 'off');

  const abBtn = document.getElementById('btn-ab-loop');
  const mobileAbBtn = document.getElementById('btn-mobile-ab');
  const abLabel =
    state.loop.active ? 'A-B On' : state.loop.a !== null ? 'Set B' : 'A-B';
  abBtn.textContent = abLabel;
  mobileAbBtn.textContent = state.loop.active ? 'A-B On' : state.loop.a !== null ? 'Set B' : 'A-B Off';
  abBtn.classList.toggle('is-active', state.loop.a !== null);
  mobileAbBtn.classList.toggle('is-active', state.loop.a !== null);

  const speedText = `${state.playbackRate}x`;
  document.getElementById('btn-speed').textContent = speedText;
  document.getElementById('btn-mobile-speed').textContent = speedText;

  document.getElementById('btn-pip').classList.toggle('hidden', !isVideo || !document.pictureInPictureEnabled);
  document.getElementById('btn-mobile-pip').classList.toggle('hidden', !isVideo || !document.pictureInPictureEnabled);

  const muteBtn = document.getElementById('btn-mute');
  muteBtn.innerHTML = icon(state.muted || state.volume === 0 ? 'volumeMute' : 'volume');
  const volSlider = document.getElementById('volume-slider');
  if (document.activeElement !== volSlider) {
    volSlider.value = String(state.muted ? 0 : state.volume);
  }

  updateTimeReadouts();
}

function renderLayoutAndTabs() {
  const shell = document.getElementById('app');
  shell.classList.toggle('library-collapsed', state.libraryCollapsed);
  shell.classList.toggle('inspector-collapsed', state.inspectorCollapsed);

  document.getElementById('btn-toggle-library').classList.toggle('is-active', !state.libraryCollapsed);
  document.getElementById('btn-toggle-inspector').classList.toggle('is-active', !state.inspectorCollapsed);

  const inspectorTabs = document.getElementById('inspector-tabs');
  const inspectorGlider = document.getElementById('inspector-glider');
  inspectorTabs.querySelectorAll('[data-inspector-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.inspectorTab === state.inspectorTab);
  });

  document.getElementById('panel-visuals').classList.toggle('hidden', state.inspectorTab !== 'visuals');
  document.getElementById('panel-equalizer').classList.toggle('hidden', state.inspectorTab !== 'equalizer');
  document.getElementById('panel-queue').classList.toggle('hidden', state.inspectorTab !== 'queue');

  document.getElementById('btn-quick-eq').classList.toggle('is-active', !state.inspectorCollapsed && state.inspectorTab === 'equalizer');
  document.getElementById('btn-quick-queue').classList.toggle('is-active', !state.inspectorCollapsed && state.inspectorTab === 'queue');

  const isDesktop = window.innerWidth >= 1024;
  const libraryRail = document.getElementById('library-rail');
  const inspectorRail = document.getElementById('inspector-rail');

  libraryRail.classList.toggle('is-mobile-active', !isDesktop && state.mobileTab === 'library');
  inspectorRail.classList.toggle(
    'is-mobile-active',
    !isDesktop && (state.mobileTab === 'fx' || state.mobileTab === 'queue')
  );

  const miniPlayer = document.getElementById('mobile-mini-player');
  miniPlayer.classList.toggle('hidden', isDesktop || state.mobileTab === 'stage' || !getCurrentTrack());

  document.querySelectorAll('[data-mobile-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mobileTab === state.mobileTab);
  });

  requestAnimationFrame(() => positionGlider(inspectorTabs, inspectorGlider));
}

function renderAll() {
  renderHeaderAndStudio();
  renderTransportState();
  renderLayoutAndTabs();
  libraryView.update();
  queueView.update();
  stageController.updateUi();
}

function bindGlobalEvents() {
  const mediaEl = audioEngine.getMediaElement();
  if (mediaEl) {
    mediaEl.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(mediaEl.duration) && mediaEl.duration > 0) {
        state.duration = mediaEl.duration;
        const track = getCurrentTrack();
        if (track && track.duration === 0) {
          track.duration = mediaEl.duration;
          libraryView.update();
        }
      }
      state.isBuffering = false;
      updateTimeReadouts();
      syncMediaSessionPlaybackState();
      stageController.updateUi();
    });

    mediaEl.addEventListener('timeupdate', () => {
      state.currentTime = mediaEl.currentTime || 0;
      if (Number.isFinite(mediaEl.duration) && mediaEl.duration > 0) {
        state.duration = mediaEl.duration;
      }

      if (state.loop.active && state.loop.a !== null && state.loop.b !== null) {
        if (state.currentTime >= state.loop.b) {
          mediaEl.currentTime = state.loop.a;
          state.currentTime = state.loop.a;
        }
      }

      updateTimeReadouts();
      stageController.updateUi();

      const now = performance.now();
      if (now - lastPositionSync > 1000) {
        lastPositionSync = now;
        syncMediaSessionPlaybackState();
      }
    });

    mediaEl.addEventListener('play', () => {
      state.isPlaying = true;
      state.isBuffering = false;
      syncMediaSessionPlaybackState();
      renderTransportState();
      libraryView.update();
      stageController.updateUi();
    });

    mediaEl.addEventListener('pause', () => {
      state.isPlaying = false;
      syncMediaSessionPlaybackState();
      renderTransportState();
      libraryView.update();
      stageController.updateUi();
    });

    mediaEl.addEventListener('waiting', () => {
      state.isBuffering = true;
      stageController.updateUi();
    });

    mediaEl.addEventListener('playing', () => {
      state.isBuffering = false;
      state.error = '';
      stageController.updateUi();
    });

    mediaEl.addEventListener('ended', async () => {
      if (state.repeat === 'one') {
        mediaEl.currentTime = 0;
        await playCurrent();
      } else {
        await actions.nextTrack(true);
      }
    });

    mediaEl.addEventListener('error', () => {
      const track = getCurrentTrack();
      if (
        track &&
        (track.src.startsWith('http://') || track.src.startsWith('https://')) &&
        !retriedWithoutCors
      ) {
        retriedWithoutCors = true;
        mediaEl.removeAttribute('crossorigin');
        audioEngine.setCorsFallback(true);
        mediaEl.src = track.src;
        mediaEl.load();
        if (state.isPlaying) {
          mediaEl.play().catch(() => {});
        }
        stageController.updateUi();
        return;
      }

      state.isPlaying = false;
      state.isBuffering = false;
      state.error = 'Unable to decode or reach this media source';
      renderAll();
    });
  }

  // Top Bar & Rails
  document.getElementById('btn-toggle-library').addEventListener('click', () => {
    state.libraryCollapsed = !state.libraryCollapsed;
    renderLayoutAndTabs();
    setTimeout(() => stageController.updateUi(), 300);
  });

  document.getElementById('btn-toggle-inspector').addEventListener('click', () => {
    state.inspectorCollapsed = !state.inspectorCollapsed;
    renderLayoutAndTabs();
    setTimeout(() => stageController.updateUi(), 300);
  });

  document.getElementById('btn-open-add').addEventListener('click', () => actions.openAddMedia('files'));
  document.getElementById('btn-fullscreen').addEventListener('click', () => actions.toggleFullscreen());
  document.getElementById('btn-stage-fx-mobile').addEventListener('click', () => actions.setMobileTab('fx'));

  // Inspector Tabs
  document.getElementById('inspector-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inspector-tab]');
    if (!btn) return;
    actions.setInspectorTab(btn.dataset.inspectorTab);
  });

  // Desktop Transport Deck
  document.getElementById('btn-play').addEventListener('click', () => actions.togglePlay());
  document.getElementById('btn-prev').addEventListener('click', () => actions.prevTrack());
  document.getElementById('btn-next').addEventListener('click', () => actions.nextTrack());
  document.getElementById('btn-shuffle').addEventListener('click', () => actions.toggleShuffle());
  document.getElementById('btn-repeat').addEventListener('click', () => actions.cycleRepeat());
  document.getElementById('btn-deck-fav').addEventListener('click', () => {
    if (state.currentTrackId) actions.toggleFavorite(state.currentTrackId);
  });
  document.getElementById('btn-ab-loop').addEventListener('click', () => actions.cycleAbLoop());
  document.getElementById('btn-speed').addEventListener('click', () => actions.cyclePlaybackRate());
  document.getElementById('btn-subtitles').addEventListener('click', () => actions.openAddMedia('subtitles'));
  document.getElementById('btn-pip').addEventListener('click', () => actions.togglePip());
  document.getElementById('btn-mute').addEventListener('click', () => actions.toggleMute());
  document.getElementById('volume-slider').addEventListener('input', (e) => {
    actions.setVolume(parseFloat(e.target.value));
  });
  document.getElementById('btn-quick-eq').addEventListener('click', () => {
    if (!state.inspectorCollapsed && state.inspectorTab === 'equalizer') {
      state.inspectorCollapsed = true;
      renderLayoutAndTabs();
    } else {
      actions.setInspectorTab('equalizer');
    }
  });
  document.getElementById('btn-quick-queue').addEventListener('click', () => {
    if (!state.inspectorCollapsed && state.inspectorTab === 'queue') {
      state.inspectorCollapsed = true;
      renderLayoutAndTabs();
    } else {
      actions.setInspectorTab('queue');
    }
  });

  // Mobile Stage & Mini Player & Nav
  document.getElementById('btn-mobile-play').addEventListener('click', () => actions.togglePlay());
  document.getElementById('btn-mobile-prev').addEventListener('click', () => actions.prevTrack());
  document.getElementById('btn-mobile-next').addEventListener('click', () => actions.nextTrack());
  document.getElementById('btn-mobile-shuffle').addEventListener('click', () => actions.toggleShuffle());
  document.getElementById('btn-mobile-repeat').addEventListener('click', () => actions.cycleRepeat());
  document.getElementById('btn-mobile-fav').addEventListener('click', () => {
    if (state.currentTrackId) actions.toggleFavorite(state.currentTrackId);
  });
  document.getElementById('btn-mobile-ab').addEventListener('click', () => actions.cycleAbLoop());
  document.getElementById('btn-mobile-speed').addEventListener('click', () => actions.cyclePlaybackRate());
  document.getElementById('btn-mobile-subs').addEventListener('click', () => actions.openAddMedia('subtitles'));
  document.getElementById('btn-mobile-pip').addEventListener('click', () => actions.togglePip());

  document.getElementById('mini-player-tap').addEventListener('click', () => actions.setMobileTab('stage'));
  document.getElementById('btn-mini-play').addEventListener('click', () => actions.togglePlay());
  document.getElementById('btn-mini-next').addEventListener('click', () => actions.nextTrack());

  document.getElementById('mobile-bottom-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mobile-tab]');
    if (!btn) return;
    actions.setMobileTab(btn.dataset.mobileTab);
  });

  // Fullscreen icon update
  document.addEventListener('fullscreenchange', () => {
    const isFs = Boolean(document.fullscreenElement);
    document.getElementById('btn-fullscreen').innerHTML = icon(isFs ? 'minimize' : 'maximize');
    stageController.wakeHud();
  });

  // Resize responsiveness
  window.addEventListener('resize', () => {
    renderLayoutAndTabs();
    updateTimeReadouts();
    stageController.updateUi();
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable)
    ) {
      if (e.key === 'Escape' && addMediaModal.isOpen()) {
        addMediaModal.close();
      }
      return;
    }

    if (e.key === 'Escape' && addMediaModal.isOpen()) {
      addMediaModal.close();
      return;
    }

    const key = e.key.toLowerCase();
    if (e.code === 'Space' || key === 'k') {
      e.preventDefault();
      actions.togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      actions.seekTo(state.currentTime - 5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      actions.seekTo(state.currentTime + 5);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      actions.setVolume(state.volume + 0.05);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      actions.setVolume(state.volume - 0.05);
    } else if (key === 'm') {
      actions.toggleMute();
    } else if (key === 'v') {
      const idx = VISUALIZER_ORDER.indexOf(state.visualizer.mode);
      const next = VISUALIZER_ORDER[(idx + 1) % VISUALIZER_ORDER.length];
      actions.setVisualizerSetting('mode', next);
      showToast(`Visualizer: ${next}`);
    } else if (key === 'f') {
      actions.toggleFullscreen();
    } else if (key === 'e') {
      actions.setInspectorTab('equalizer');
    } else if (key === 'q') {
      actions.setInspectorTab('queue');
    } else if (key === 'n') {
      actions.nextTrack();
    } else if (key === 'p') {
      actions.prevTrack();
    } else if (e.key === '[') {
      state.loop = { ...state.loop, a: state.currentTime, active: state.loop.b !== null && state.loop.b > state.currentTime };
      renderTransportState();
      showToast(`Loop A set at ${formatTime(state.currentTime)}`);
    } else if (e.key === ']') {
      const a = state.loop.a ?? 0;
      const b = state.currentTime;
      if (b > a + 0.2) {
        state.loop = { a, b, active: true };
        renderTransportState();
        showToast(`Loop B set at ${formatTime(b)}`);
      }
    }
  });

  // MediaSession hardware/lockscreen handlers
  if ('mediaSession' in navigator) {
    const handlers = [
      ['play', () => playCurrent()],
      ['pause', () => pauseCurrent()],
      ['previoustrack', () => actions.prevTrack()],
      ['nexttrack', () => actions.nextTrack()],
      ['seekbackward', (details) => actions.seekTo(state.currentTime - (details.seekOffset || 10))],
      ['seekforward', (details) => actions.seekTo(state.currentTime + (details.seekOffset || 10))],
      ['seekto', (details) => details.seekTime !== undefined && actions.seekTo(details.seekTime)],
    ];
    for (const [actionName, fn] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(actionName, fn);
      } catch {
        // Ignore unsupported action
      }
    }
  }

  // PWA install banner
  const installBtn = document.getElementById('btn-install-pwa');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.classList.remove('hidden');
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch {
      // Ignore prompt dismissal
    }
    deferredInstallPrompt = null;
    installBtn.classList.add('hidden');
  });
}

async function boot() {
  hydrateStaticIcons();
  bindGlobalEvents();

  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const [demoTracks, savedTracks, playlists] = await Promise.all([
    createDemoTracks(),
    loadSavedTracksFromDb(),
    loadPlaylistsFromDb(),
  ]);

  for (const dt of demoTracks) {
    dt.favorite = state.favoriteDemoIds.has(dt.id);
  }

  state.tracks = [...savedTracks, ...demoTracks];
  state.playlists = playlists;

  const initialTrack = state.tracks[0] || null;
  if (initialTrack) {
    state.currentTrackId = initialTrack.id;
    resolveActivePalette();
    await loadTrackIntoMediaElement(initialTrack, false);
  } else {
    resolveActivePalette();
    renderAll();
  }

  stageController.start();
}

boot();
