import { hexToRgba } from '../../lib/palettes.js';

export class OscilloscopeRenderer {
  constructor() {
    this.trailCanvas = null;
    this.trailCtx = null;
  }

  ensureTrailBuffer(width, height, dpr) {
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    if (!this.trailCanvas) {
      this.trailCanvas = document.createElement('canvas');
      this.trailCtx = this.trailCanvas.getContext('2d');
    }
    if (this.trailCanvas.width !== pw || this.trailCanvas.height !== ph) {
      this.trailCanvas.width = pw;
      this.trailCanvas.height = ph;
      if (this.trailCtx) {
        this.trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.trailCtx.fillStyle = '#07080B';
        this.trailCtx.fillRect(0, 0, width, height);
      }
    }
  }

  render(ctx, state) {
    const { width, height, dpr, time, palette, metrics, intensity, bloom, reducedMotion } = state;
    this.ensureTrailBuffer(width, height, dpr);
    const tCtx = this.trailCtx;
    if (!tCtx || !this.trailCanvas) return;

    tCtx.save();
    tCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tCtx.fillStyle = reducedMotion ? 'rgba(7, 8, 11, 0.4)' : 'rgba(7, 8, 11, 0.18)';
    tCtx.fillRect(0, 0, width, height);

    // Subtle studio calibration reticle
    const midY = height * 0.5;
    tCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    tCtx.lineWidth = 1;
    tCtx.beginPath();
    tCtx.moveTo(0, midY);
    tCtx.lineTo(width, midY);
    tCtx.stroke();

    const wave = metrics.waveform;
    const sampleStep = Math.max(1, Math.floor(wave.length / 240));
    const ampScale = height * 0.28 * Math.min(1.8, 0.7 + intensity * 0.55);

    const ribbons = [
      { color: palette[2], offset: -12, phase: 0.0, width: 1.8, alpha: 0.55 },
      { color: palette[1], offset: 12, phase: 0.7, width: 2.0, alpha: 0.65 },
      { color: palette[0], offset: 0, phase: 0.0, width: 2.8, alpha: 0.96 },
    ];

    for (const r of ribbons) {
      tCtx.beginPath();
      if (bloom) {
        tCtx.shadowBlur = r.offset === 0 ? 18 : 10;
        tCtx.shadowColor = hexToRgba(r.color, 0.72);
      } else {
        tCtx.shadowBlur = 0;
      }

      let started = false;
      const pointCount = Math.floor(wave.length / sampleStep);
      for (let idx = 0; idx < pointCount; idx++) {
        const sIdx = idx * sampleStep;
        const normX = idx / Math.max(1, pointCount - 1);
        const x = normX * width;
        const sample = (wave[sIdx] - 128) / 128;
        const harmonic =
          r.offset === 0
            ? 0
            : Math.sin(normX * Math.PI * 4 + time * 3.0 + r.phase) * metrics.mid * 18;
        const edgeFade = Math.sin(normX * Math.PI);
        const y = midY + sample * ampScale * (0.4 + 0.6 * edgeFade) + harmonic;

        if (!started) {
          tCtx.moveTo(x, y);
          started = true;
        } else {
          tCtx.lineTo(x, y);
        }
      }

      tCtx.strokeStyle = hexToRgba(r.color, r.alpha);
      tCtx.lineWidth = r.width;
      tCtx.stroke();
    }

    tCtx.shadowBlur = 0;
    tCtx.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.trailCanvas, 0, 0);
    ctx.restore();
  }
}
