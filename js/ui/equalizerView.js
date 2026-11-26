import { audioEngine, EQ_FREQUENCIES, EQ_LABELS, EQ_PRESETS } from '../engine/audioEngine.js';
import { hexToRgba } from '../lib/palettes.js';
import { escapeHtml } from './glider.js';

export class EqualizerView {
  constructor(containerEl, getState, actions) {
    this.container = containerEl;
    this.getState = getState;
    this.actions = actions;
    this.renderShell();
  }

  renderShell() {
    const presetButtons = Object.keys(EQ_PRESETS)
      .map(
        (name) =>
          `<button class="utility-chip" data-eq-preset="${escapeHtml(name)}" type="button">${escapeHtml(name)}</button>`
      )
      .join('');

    const bandCols = EQ_LABELS.map(
      (label, idx) => `
      <div class="eq-band-col">
        <span class="eq-db-val font-mono-tabular" data-eq-val="${idx}">0</span>
        <div class="eq-v-wrap">
          <input
            class="sona-slider eq-v-slider"
            type="range"
            min="-12"
            max="12"
            step="0.5"
            value="0"
            data-eq-band="${idx}"
            aria-label="${label} Hz gain"
          />
        </div>
        <span class="eq-freq-label font-mono-tabular">${label}</span>
      </div>`
    ).join('');

    this.container.innerHTML = `
      <div class="studio-card">
        <div class="studio-card-head">
          <span>10-Band Studio Equalizer</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <button id="btn-eq-reset" class="utility-chip" type="button">Reset</button>
            <button id="btn-eq-toggle" class="toggle-switch on" type="button" aria-label="Toggle equalizer"></button>
          </div>
        </div>
        <div class="eq-svg-box">
          <svg id="eq-curve-svg" viewBox="0 0 320 112" width="100%" height="100%" preserveAspectRatio="none">
            <defs>
              <linearGradient id="eqFillGrad" x1="0" y1="0" x2="0" y2="1">
                <stop id="eq-grad-top" offset="0%" stop-color="#E8A838" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="#07080B" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <line x1="0" y1="28" x2="320" y2="28" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
            <line x1="0" y1="56" x2="320" y2="56" stroke="rgba(255,255,255,0.12)" stroke-dasharray="3 3" stroke-width="1"/>
            <line x1="0" y1="84" x2="320" y2="84" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
            <path id="eq-curve-fill" fill="url(#eqFillGrad)" d=""/>
            <path id="eq-curve-line" fill="none" stroke="#E8A838" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="chip-row" id="eq-preset-row">${presetButtons}</div>
      </div>

      <div class="studio-card">
        <div class="eq-sliders-grid">${bandCols}</div>
      </div>

      <div class="studio-card">
        <div class="control-row">
          <span>Preamp Gain</span>
          <span id="eq-preamp-val" class="font-mono-tabular" style="font-size:12px;color:var(--ink-secondary)">0.0 dB</span>
        </div>
        <input id="eq-preamp-slider" class="sona-slider" style="width:100%" type="range" min="-12" max="12" step="0.5" value="0" aria-label="Preamp gain" />

        <div class="control-row" style="margin-top:8px;">
          <span>Stereo Balance</span>
          <span id="eq-pan-val" class="font-mono-tabular" style="font-size:12px;color:var(--ink-secondary)">Center</span>
        </div>
        <input id="eq-pan-slider" class="sona-slider" style="width:100%" type="range" min="-1" max="1" step="0.05" value="0" aria-label="Stereo balance" />
      </div>
    `;

    this.bindEvents();
    this.update();
  }

  bindEvents() {
    this.container.querySelector('#btn-eq-toggle').addEventListener('click', () => {
      const { eq } = this.getState();
      this.actions.setEq({ enabled: !eq.enabled });
    });

    this.container.querySelector('#btn-eq-reset').addEventListener('click', () => {
      this.actions.applyEqPreset('Studio Flat');
    });

    this.container.querySelector('#eq-preset-row').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-eq-preset]');
      if (!btn) return;
      this.actions.applyEqPreset(btn.dataset.eqPreset);
    });

    this.container.addEventListener('input', (e) => {
      const target = e.target;
      if (target.matches('[data-eq-band]')) {
        const idx = parseInt(target.dataset.eqBand, 10);
        this.actions.setEqBand(idx, parseFloat(target.value));
      } else if (target.id === 'eq-preamp-slider') {
        this.actions.setEq({ preamp: parseFloat(target.value) });
      } else if (target.id === 'eq-pan-slider') {
        this.actions.setEq({ pan: parseFloat(target.value) });
      }
    });
  }

  updateCurveSvg(eq, primaryColor) {
    const points = 72;
    const freqs = new Float32Array(points);
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      freqs[i] = Math.pow(10, minLog + t * (maxLog - minLog));
    }

    const dbVals = audioEngine.getFrequencyResponseCurve(freqs, eq);
    const w = 320;
    const h = 112;
    const coords = [];
    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * w;
      const clampedDb = Math.max(-15, Math.min(15, dbVals[i]));
      const y = h * 0.5 - (clampedDb / 15) * (h * 0.42);
      coords.push([x, y]);
    }

    const lineD = coords
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    const fillD = `${lineD} L${w},${h} L0,${h} Z`;

    const lineEl = this.container.querySelector('#eq-curve-line');
    const fillEl = this.container.querySelector('#eq-curve-fill');
    const stopEl = this.container.querySelector('#eq-grad-top');
    lineEl.setAttribute('d', lineD);
    lineEl.setAttribute('stroke', eq.enabled ? primaryColor : '#64748B');
    fillEl.setAttribute('d', fillD);
    stopEl.setAttribute('stop-color', eq.enabled ? hexToRgba(primaryColor, 0.45) : 'rgba(100,116,139,0.2)');
  }

  update() {
    const { eq, activePalette } = this.getState();
    const toggleBtn = this.container.querySelector('#btn-eq-toggle');
    toggleBtn.classList.toggle('on', eq.enabled);

    this.container.querySelectorAll('[data-eq-preset]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.eqPreset === eq.preset);
    });

    for (let i = 0; i < EQ_FREQUENCIES.length; i++) {
      const val = eq.bands[i] ?? 0;
      const slider = this.container.querySelector(`[data-eq-band="${i}"]`);
      const label = this.container.querySelector(`[data-eq-val="${i}"]`);
      if (slider && document.activeElement !== slider) {
        slider.value = String(val);
      }
      if (label) {
        label.textContent = val > 0 ? `+${val}` : String(val);
      }
    }

    const preampSlider = this.container.querySelector('#eq-preamp-slider');
    const preampLabel = this.container.querySelector('#eq-preamp-val');
    if (preampSlider && document.activeElement !== preampSlider) {
      preampSlider.value = String(eq.preamp);
    }
    preampLabel.textContent = `${eq.preamp > 0 ? '+' : ''}${eq.preamp.toFixed(1)} dB`;

    const panSlider = this.container.querySelector('#eq-pan-slider');
    const panLabel = this.container.querySelector('#eq-pan-val');
    if (panSlider && document.activeElement !== panSlider) {
      panSlider.value = String(eq.pan);
    }
    if (Math.abs(eq.pan) < 0.04) {
      panLabel.textContent = 'Center';
    } else if (eq.pan < 0) {
      panLabel.textContent = `L ${Math.round(Math.abs(eq.pan) * 100)}%`;
    } else {
      panLabel.textContent = `R ${Math.round(eq.pan * 100)}%`;
    }

    this.updateCurveSvg(eq, activePalette[0]);
  }
}
