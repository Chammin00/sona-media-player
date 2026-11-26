import { icon } from '../icons.js';
import { escapeHtml, formatTime } from './glider.js';

export class LibraryView {
  constructor(getState, actions) {
    this.getState = getState;
    this.actions = actions;

    this.railEl = document.getElementById('library-rail');
    this.searchEl = document.getElementById('library-search');
    this.filtersEl = document.getElementById('library-filters');
    this.playlistListEl = document.getElementById('playlist-list');
    this.trackListEl = document.getElementById('track-list');
    this.countLabelEl = document.getElementById('library-count-label');
    this.newPlaylistBtn = document.getElementById('btn-new-playlist');
    this.newPlaylistForm = document.getElementById('new-playlist-form');
    this.newPlaylistInput = document.getElementById('new-playlist-input');
    this.savePlaylistBtn = document.getElementById('btn-save-playlist');
    this.railImportBtn = document.getElementById('btn-rail-import');

    this.newPlaylistBtn.innerHTML = icon('plus');
    this.bindEvents();
  }

  bindEvents() {
    this.searchEl.addEventListener('input', (e) => {
      this.actions.setSearchQuery(e.target.value);
    });

    this.newPlaylistBtn.addEventListener('click', () => {
      const hidden = this.newPlaylistForm.classList.toggle('hidden');
      if (!hidden) {
        this.newPlaylistInput.focus();
      }
    });

    const submitPlaylist = () => {
      const name = this.newPlaylistInput.value.trim();
      if (!name) return;
      this.actions.createPlaylist(name);
      this.newPlaylistInput.value = '';
      this.newPlaylistForm.classList.add('hidden');
    };

    this.savePlaylistBtn.addEventListener('click', submitPlaylist);
    this.newPlaylistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitPlaylist();
      }
    });

    this.railImportBtn.addEventListener('click', () => {
      this.actions.openAddMedia('files');
    });

    this.filtersEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      this.actions.setLibraryFilter(btn.dataset.filter);
    });

    this.playlistListEl.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-delete-playlist]');
      if (delBtn) {
        e.stopPropagation();
        this.actions.deletePlaylist(delBtn.dataset.deletePlaylist);
        return;
      }
      const row = e.target.closest('[data-playlist-filter]');
      if (row) {
        this.actions.setLibraryFilter(row.dataset.playlistFilter);
      }
    });

    this.trackListEl.addEventListener('click', (e) => {
      const favBtn = e.target.closest('[data-fav-id]');
      if (favBtn) {
        e.stopPropagation();
        this.actions.toggleFavorite(favBtn.dataset.favId);
        return;
      }

      const queueBtn = e.target.closest('[data-queue-id]');
      if (queueBtn) {
        e.stopPropagation();
        this.actions.addToQueue(queueBtn.dataset.queueId);
        return;
      }

      const plBtn = e.target.closest('[data-add-pl-track]');
      if (plBtn) {
        e.stopPropagation();
        this.actions.cycleAddTrackToPlaylist(plBtn.dataset.addPlTrack);
        return;
      }

      const delBtn = e.target.closest('[data-delete-track]');
      if (delBtn) {
        e.stopPropagation();
        this.actions.removeTrack(delBtn.dataset.deleteTrack);
        return;
      }

      const row = e.target.closest('[data-track-id]');
      if (row) {
        this.actions.playTrackById(row.dataset.trackId);
      }
    });
  }

  getFilteredTracks() {
    const { tracks, playlists, libraryFilter, searchQuery } = this.getState();
    let list = tracks;

    if (libraryFilter === 'audio') {
      list = list.filter((t) => t.kind === 'audio');
    } else if (libraryFilter === 'video') {
      list = list.filter((t) => t.kind === 'video');
    } else if (libraryFilter === 'favorites') {
      list = list.filter((t) => Boolean(t.favorite));
    } else if (libraryFilter.startsWith('playlist:')) {
      const plId = libraryFilter.slice('playlist:'.length);
      const pl = playlists.find((p) => p.id === plId);
      if (pl) {
        const idSet = new Set(pl.trackIds);
        list = list.filter((t) => idSet.has(t.id));
      } else {
        list = [];
      }
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
      );
    }

    return list;
  }

  update() {
    const state = this.getState();
    const { tracks, playlists, libraryFilter, currentTrack, isPlaying } = state;

    const audioCount = tracks.filter((t) => t.kind === 'audio').length;
    const videoCount = tracks.filter((t) => t.kind === 'video').length;
    const favCount = tracks.filter((t) => t.favorite).length;

    const filterDefs = [
      { id: 'all', label: 'All Media', count: tracks.length },
      { id: 'audio', label: 'Audio', count: audioCount },
      { id: 'video', label: 'Video', count: videoCount },
      { id: 'favorites', label: 'Favorites', count: favCount },
    ];

    this.filtersEl.innerHTML = filterDefs
      .map(
        (f) => `
      <button class="filter-btn ${libraryFilter === f.id ? 'active' : ''}" data-filter="${f.id}" type="button">
        <span>${f.label}</span>
        <span class="count font-mono-tabular">${f.count}</span>
      </button>`
      )
      .join('');

    if (playlists.length === 0) {
      this.playlistListEl.innerHTML = `<div style="font-size:12px;color:var(--ink-secondary);padding:4px 4px 8px;">No playlists yet</div>`;
    } else {
      this.playlistListEl.innerHTML = playlists
        .map((pl) => {
          const filterKey = `playlist:${pl.id}`;
          return `
          <div class="playlist-row ${libraryFilter === filterKey ? 'active' : ''}" data-playlist-filter="${escapeHtml(filterKey)}">
            <div class="playlist-row-main">
              ${icon('listMusic')}
              <span class="playlist-row-name">${escapeHtml(pl.name)}</span>
            </div>
            <span class="font-mono-tabular" style="font-size:11px;color:var(--ink-secondary)">${pl.trackIds.length}</span>
            <button class="row-act-btn" data-delete-playlist="${escapeHtml(pl.id)}" type="button" title="Delete playlist" aria-label="Delete playlist">${icon('trash')}</button>
          </div>`;
        })
        .join('');
    }

    const filtered = this.getFilteredTracks();
    this.countLabelEl.textContent = `Tracks (${filtered.length})`;

    if (filtered.length === 0) {
      this.trackListEl.innerHTML = `
        <div style="padding:18px 10px;text-align:center;color:var(--ink-secondary);font-size:12.5px;border:1px dashed var(--hairline);border-radius:10px;">
          No matching media. Drop files or click Import.
        </div>`;
      return;
    }

    this.trackListEl.innerHTML = filtered
      .map((t) => {
        const isCurrent = currentTrack?.id === t.id;
        const thumbHtml = t.artworkUrl
          ? `<img src="${escapeHtml(t.artworkUrl)}" alt="" loading="lazy" />`
          : icon(t.kind === 'video' ? 'film' : 'music');
        const eqOverlay = isCurrent
          ? `<div class="eq-bars-badge"><span class="eq-mini-bar"></span><span class="eq-mini-bar"></span><span class="eq-mini-bar"></span></div>`
          : '';
        const plBtn =
          playlists.length > 0
            ? `<button class="row-act-btn" data-add-pl-track="${escapeHtml(t.id)}" type="button" title="Add to playlist" aria-label="Add to playlist">${icon('plus')}</button>`
            : '';
        const delBtn =
          t.sourceType !== 'demo'
            ? `<button class="row-act-btn" data-delete-track="${escapeHtml(t.id)}" type="button" title="Remove from library" aria-label="Remove track">${icon('trash')}</button>`
            : '';

        return `
        <div class="track-row ${isCurrent ? 'active' : ''} ${isCurrent && !isPlaying ? 'paused' : ''}" data-track-id="${escapeHtml(t.id)}">
          <div class="track-thumb">${thumbHtml}${eqOverlay}</div>
          <div class="track-info">
            <div class="track-title">${escapeHtml(t.title)}</div>
            <div class="track-sub">${escapeHtml(t.artist)} &middot; ${t.kind === 'video' ? 'Video' : 'Audio'}</div>
          </div>
          <div class="track-right">
            <span class="track-dur font-mono-tabular">${t.duration > 0 ? formatTime(t.duration) : '--:--'}</span>
            <div class="track-actions">
              <button class="row-act-btn ${t.favorite ? 'fav-on' : ''}" data-fav-id="${escapeHtml(t.id)}" type="button" title="Favorite" aria-label="Favorite">${icon(t.favorite ? 'heartFilled' : 'heart')}</button>
              <button class="row-act-btn" data-queue-id="${escapeHtml(t.id)}" type="button" title="Add to queue" aria-label="Add to queue">${icon('listMusic')}</button>
              ${plBtn}
              ${delBtn}
            </div>
          </div>
        </div>`;
      })
      .join('');
  }
}
