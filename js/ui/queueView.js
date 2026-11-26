import { icon } from '../icons.js';
import { escapeHtml, formatTime } from './glider.js';

export class QueueView {
  constructor(containerEl, getState, actions) {
    this.container = containerEl;
    this.getState = getState;
    this.actions = actions;
    this.bindEvents();
  }

  bindEvents() {
    this.container.addEventListener('click', (e) => {
      if (e.target.closest('#btn-clear-queue')) {
        this.actions.clearQueue();
        return;
      }

      const upBtn = e.target.closest('[data-q-up]');
      if (upBtn) {
        this.actions.moveQueueItem(parseInt(upBtn.dataset.qUp, 10), -1);
        return;
      }

      const downBtn = e.target.closest('[data-q-down]');
      if (downBtn) {
        this.actions.moveQueueItem(parseInt(downBtn.dataset.qDown, 10), 1);
        return;
      }

      const remBtn = e.target.closest('[data-q-remove]');
      if (remBtn) {
        this.actions.removeQueueIndex(parseInt(remBtn.dataset.qRemove, 10));
        return;
      }

      const row = e.target.closest('[data-q-play]');
      if (row) {
        this.actions.playQueueIndex(parseInt(row.dataset.qPlay, 10));
      }
    });
  }

  update() {
    const { tracks, queue, currentTrack } = this.getState();
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const queuedTracks = queue
      .map((id, idx) => ({ track: byId.get(id), idx }))
      .filter((item) => Boolean(item.track));

    const nowHtml = currentTrack
      ? `
      <div class="studio-card">
        <div class="studio-card-head">
          <span>Now Playing</span>
          <span class="micro-badge">${currentTrack.kind === 'video' ? 'Video' : 'Audio'}</span>
        </div>
        <div class="track-row active" style="cursor:default;">
          <div class="track-thumb">${
            currentTrack.artworkUrl
              ? `<img src="${escapeHtml(currentTrack.artworkUrl)}" alt="" />`
              : icon(currentTrack.kind === 'video' ? 'film' : 'music')
          }</div>
          <div class="track-info">
            <div class="track-title">${escapeHtml(currentTrack.title)}</div>
            <div class="track-sub">${escapeHtml(currentTrack.artist)}</div>
          </div>
        </div>
      </div>`
      : '';

    const queueRows =
      queuedTracks.length === 0
        ? `<div style="padding:18px 10px;text-align:center;color:var(--ink-secondary);font-size:12.5px;border:1px dashed var(--hairline);border-radius:10px;">Queue is empty. Add tracks from the library to line up playback.</div>`
        : `<div class="queue-list">${queuedTracks
            .map(({ track, idx }) => {
              const thumb = track.artworkUrl
                ? `<img src="${escapeHtml(track.artworkUrl)}" alt="" />`
                : icon(track.kind === 'video' ? 'film' : 'music');
              return `
              <div class="track-row" data-q-play="${idx}">
                <div class="track-thumb">${thumb}</div>
                <div class="track-info">
                  <div class="track-title">${escapeHtml(track.title)}</div>
                  <div class="track-sub">${escapeHtml(track.artist)}</div>
                </div>
                <div class="track-right">
                  <span class="track-dur font-mono-tabular">${track.duration > 0 ? formatTime(track.duration) : '--:--'}</span>
                  <button class="row-act-btn" data-q-up="${idx}" type="button" title="Move up" aria-label="Move up">${icon('chevronUp')}</button>
                  <button class="row-act-btn" data-q-down="${idx}" type="button" title="Move down" aria-label="Move down">${icon('chevronDown')}</button>
                  <button class="row-act-btn" data-q-remove="${idx}" type="button" title="Remove" aria-label="Remove">${icon('x')}</button>
                </div>
              </div>`;
            })
            .join('')}</div>`;

    this.container.innerHTML = `
      ${nowHtml}
      <div class="studio-card">
        <div class="studio-card-head">
          <span>Up Next (${queuedTracks.length})</span>
          ${queuedTracks.length > 0 ? '<button id="btn-clear-queue" class="text-action-btn" type="button">Clear</button>' : ''}
        </div>
        ${queueRows}
      </div>
    `;
  }
}
