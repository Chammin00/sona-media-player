import { PALETTE_PRESETS } from '../lib/palettes.js';
import { escapeHtml } from './glider.js';

const VISUAL_ENGINES = [
  { id: 'aurora', name: 'Aurora Fluid', desc: 'WebGL2 domain-warped liquid light field' },
  { id: 'halo', name: 'Harmonic Halo', desc: 'Polar radial spectrum & beat shockwaves' },
  { id: 'prism', name: 'Prism Bars', desc: '64-band studio analyzer with floor reflection' },
  { id: 'oscilloscope', name: 'Oscilloscope', desc: 'Chromatic phosphor time-domain ribbons' },
  { id: 'nebula', name: 'Nebula Warp', desc: '3D starfield warp & treble constellations' },
];

const SLEEP_OPTIONS = [0, 15, 30, 60];

export class VisualStudioView {
  constructor(containerEl, getState, actions) {
    this.container = containerEl;
    this.getState = getState;
    this.actions = actions;
    this.renderShell();
  }

  renderShell() {
    const engineCards = VISUAL_ENGINES.map(
      (eng) => `
      <button class="engine-card-btn" data-engine-id="${eng.id}" type="button">
        <div>
          <div class="engine-name">${escapeHtml(eng.name)}</div>
          <div class="engine-desc">${escapeHtml(eng.desc)}</div>
        </div>
        <span class="engine-dot"></span>
      </button>`
    ).join('');

    const swatches = PALETTE_PRESETS.map((preset) => {
      const cols = preset.colors || ['#E8A838', '#E05A47', '#5B7CFA'];
      return `
      <button class="swatch-btn" data-palette-id="${preset.id}" type="button">
        <span class="swatch-dots">
          <span style="background:${cols[0]}"></span>
          <span style="background:${cols[1]}"></span>
          <span style="background:${cols[2]}"></span>
        </span>
        <span>${escapeHtml(preset.label)}</span>
      </button>`;
    }).join('');

    const sleepChips = SLEEP_OPTIONS.map(
      (mins) =>
        `<button class="utility-chip" data-sleep-mins="${mins}" type="button">${mins === 0 ? 'Off' : `${mins}m`}</button>`
    ).join('');

    this.container.innerHTML = `
      <div class="studio-card">
        <div class="studio-card-head">
          <span>Visual Engine</span>
        </div>
        <div class="engine-grid">${engineCards}</div>
      </div>

      <div class="studio-card">
        <div class="studio-card-head">
          <span>Color Palette</span>
        </div>
        <div class="swatch-grid">${swatches}</div>
      </div>

      <div class="studio-card">
        <div class="control-row">
          <span>Reactivity Gain</span>
          <span id="viz-intensity-val" class="font-mono-tabular" style="font-size:12px;color:var(--ink-secondary)">1.15x</span>
        </div>
        <input id="viz-intensity-slider" class="sona-slider" style="width:100%;margin-bottom:8px;" type="range" min="0.4" max="2.0" step="0.05" value="1.15" aria-label="Reactivity intensity" />

        <div class="control-row">
          <span>Optical Bloom</span>
          <button id="toggle-bloom" class="toggle-switch on" type="button" aria-label="Toggle optical bloom"></button>
        </div>
        <div class="control-row">
          <span>Stage Track Showcase</span>
          <button id="toggle-hud" class="toggle-switch on" type="button" aria-label="Toggle stage track showcase"></button>
        </div>
        <div class="control-row">
          <span>Video Ambilight Glow</span>
          <button id="toggle-ambilight" class="toggle-switch on" type="button" aria-label="Toggle video ambilight"></button>
        </div>
        <div class="control-row">
          <span>Video Spectrum Strip</span>
          <button id="toggle-video-overlay" class="toggle-switch" type="button" aria-label="Toggle video spectrum strip"></button>
        </div>
      </div>

      <div class="studio-card">
        <div class="studio-card-head">
          <span>Sleep Timer</span>
          <span id="sleep-status-label" class="font-mono-tabular" style="font-size:11.5px;color:var(--ink-secondary)">Off</span>
        </div>
        <div class="chip-row">${sleepChips}</div>
      </div>
    `;

    this.bindEvents();
    this.update();
  }

  bindEvents() {
    this.container.addEventListener('click', (e) => {
      const engBtn = e.target.closest('[data-engine-id]');
      if (engBtn) {
        this.actions.setVisualizerSetting('mode', engBtn.dataset.engineId);
        return;
      }

      const palBtn = e.target.closest('[data-palette-id]');
      if (palBtn) {
        this.actions.setVisualizerSetting('palettePreset', palBtn.dataset.paletteId);
        return;
      }

      const sleepBtn = e.target.closest('[data-sleep-mins]');
      if (sleepBtn) {
        this.actions.setSleepTimer(parseInt(sleepBtn.dataset.sleepMins, 10));
        return;
      }

      const targetId = e.target.closest('button')?.id;
      const { visualizer } = this.getState();
      if (targetId === 'toggle-bloom') {
        this.actions.setVisualizerSetting('bloom', !visualizer.bloom);
      } else if (targetId === 'toggle-hud') {
        this.actions.setVisualizerSetting('showTrackHud', !visualizer.showTrackHud);
      } else if (targetId === 'toggle-ambilight') {
        this.actions.setVisualizerSetting('videoAmbilight', !visualizer.videoAmbilight);
      } else if (targetId === 'toggle-video-overlay') {
        this.actions.setVisualizerSetting('videoOverlay', !visualizer.videoOverlay);
      }
    });

    this.container.querySelector('#viz-intensity-slider').addEventListener('input', (e) => {
      this.actions.setVisualizerSetting('intensity', parseFloat(e.target.value));
    });
  }

  update() {
    const { visualizer, sleepMinutesLeft, sleepActivePreset } = this.getState();

    this.container.querySelectorAll('[data-engine-id]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.engineId === visualizer.mode);
    });

    this.container.querySelectorAll('[data-palette-id]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.paletteId === visualizer.palettePreset);
    });

    const slider = this.container.querySelector('#viz-intensity-slider');
    if (document.activeElement !== slider) {
      slider.value = String(visualizer.intensity);
    }
    this.container.querySelector('#viz-intensity-val').textContent = `${visualizer.intensity.toFixed(2)}x`;

    this.container.querySelector('#toggle-bloom').classList.toggle('on', visualizer.bloom);
    this.container.querySelector('#toggle-hud').classList.toggle('on', visualizer.showTrackHud);
    this.container.querySelector('#toggle-ambilight').classList.toggle('on', visualizer.videoAmbilight);
    this.container.querySelector('#toggle-video-overlay').classList.toggle('on', visualizer.videoOverlay);

    this.container.querySelector('#sleep-status-label').textContent =
      sleepMinutesLeft > 0 ? `${sleepMinutesLeft}m left` : 'Off';

    this.container.querySelectorAll('[data-sleep-mins]').forEach((btn) => {
      const mins = parseInt(btn.dataset.sleepMins, 10);
      const isSelected = sleepMinutesLeft === 0 ? mins === 0 : mins === sleepActivePreset;
      btn.classList.toggle('is-active', isSelected);
    });
  }
}
