import { hexToRgba } from '../lib/palettes.js';
import { formatTime } from './glider.js';

export class WaveformScrubber {
  constructor(canvasEl, tooltipEl, getState, onSeek) {
    this.canvas = canvasEl;
    this.tooltip = tooltipEl;
    this.getState = getState;
    this.onSeek = onSeek;
    this.ctx = canvasEl ? canvasEl.getContext('2d') : null;
    this.hoverRatio = null;
    this.dragging = false;

    if (this.canvas) {
      this.bindEvents();
    }
  }

  ratioFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  bindEvents() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;

    wrap.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      wrap.setPointerCapture?.(e.pointerId);
      const ratio = this.ratioFromEvent(e);
      this.hoverRatio = ratio;
      this.seekToRatio(ratio);
      this.draw();
    });

    wrap.addEventListener('pointermove', (e) => {
      const ratio = this.ratioFromEvent(e);
      this.hoverRatio = ratio;
      if (this.dragging) {
        this.seekToRatio(ratio);
      }
      if (this.tooltip) {
        const dur = this.getState().duration || 0;
        this.tooltip.textContent = formatTime(ratio * dur);
        this.tooltip.style.left = `${ratio * 100}%`;
        this.tooltip.classList.remove('hidden');
      }
      this.draw();
    });

    const endDrag = () => {
      this.dragging = false;
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    wrap.addEventListener('pointerleave', () => {
      this.dragging = false;
      this.hoverRatio = null;
      if (this.tooltip) this.tooltip.classList.add('hidden');
      this.draw();
    });
  }

  seekToRatio(ratio) {
    const dur = this.getState().duration;
    if (Number.isFinite(dur) && dur > 0) {
      this.onSeek(ratio * dur);
    }
  }

  draw() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(rect.width * dpr);
    const ph = Math.round(rect.height * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }

    const ctx = this.ctx;
    const w = rect.width;
    const h = rect.height;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const state = this.getState();
    const dur = state.duration > 0 ? state.duration : 1;
    const progress = Math.max(0, Math.min(1, state.currentTime / dur));
    const peaks = state.currentTrack?.peaks;
    const barCount = peaks && peaks.length > 0 ? peaks.length : 64;
    const palette = state.activePalette;

    // A-B loop region backdrop
    if (state.loop.a !== null && dur > 0) {
      const aNorm = Math.max(0, Math.min(1, state.loop.a / dur));
      const bNorm =
        state.loop.b !== null ? Math.max(aNorm, Math.min(1, state.loop.b / dur)) : aNorm;
      const x1 = aNorm * w;
      const x2 = Math.max(x1 + 2, bNorm * w);
      ctx.fillStyle = hexToRgba(palette[2], 0.18);
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.fillStyle = palette[0];
      ctx.fillRect(x1, 0, 1.5, h);
      if (state.loop.b !== null) {
        ctx.fillRect(x2 - 1.5, 0, 1.5, h);
      }
    }

    const slot = w / barCount;
    const barW = Math.max(1.5, slot * 0.58);
    const midY = h * 0.5;

    for (let i = 0; i < barCount; i++) {
      const barFrac = (i + 0.5) / barCount;
      const amp = peaks ? peaks[i] : 0.35 + 0.35 * Math.sin(i * 0.45);
      const barH = Math.max(3, amp * (h - 4));
      const x = i * slot + (slot - barW) * 0.5;
      const y = midY - barH * 0.5;

      const isPlayed = barFrac <= progress;
      const isHovered = this.hoverRatio !== null && barFrac <= this.hoverRatio;

      if (isPlayed) {
        ctx.fillStyle = palette[0];
      } else if (isHovered) {
        ctx.fillStyle = hexToRgba(palette[0], 0.45);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 1.5);
      ctx.fill();
    }

    // Playhead indicator hairline
    const px = progress * w;
    ctx.fillStyle = '#F3F4F6';
    ctx.fillRect(Math.max(0, Math.min(w - 2, px - 1)), 1, 2, h - 2);

    ctx.restore();
  }
}
