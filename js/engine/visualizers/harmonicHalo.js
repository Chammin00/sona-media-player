import { hexToRgba } from '../../lib/palettes.js';

export class HarmonicHaloRenderer {
  constructor() {
    this.peakHold = new Float32Array(96);
    this.ripples = [];
    this.lastPulse = 0;
  }

  render(ctx, state) {
    const {
      width,
      height,
      dpr,
      time,
      palette,
      metrics,
      intensity,
      bloom,
      reducedMotion,
      artworkImage,
    } = state;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#07080B';
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.5;
    const minDim = Math.min(width, height);
    const pulseScale = reducedMotion ? 0.25 : 1;
    const bassBoost = metrics.bass * intensity * pulseScale;
    const beatBoost = metrics.beatPulse * intensity * pulseScale;

    const baseRadius = minDim * (0.16 + bassBoost * 0.032 + beatBoost * 0.018);
    const maxBarLen = minDim * 0.25 * Math.min(1.5, 0.75 + intensity * 0.4);

    // Ambient backing glow
    const bgGlow = ctx.createRadialGradient(cx, cy, baseRadius * 0.2, cx, cy, minDim * 0.52);
    bgGlow.addColorStop(0, hexToRgba(palette[0], 0.18 + bassBoost * 0.22));
    bgGlow.addColorStop(0.45, hexToRgba(palette[1], 0.1 + metrics.mid * 0.14));
    bgGlow.addColorStop(1, 'rgba(7,8,11,0)');
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, width, height);

    // Spawn shockwave ripples on beat transients
    if (!reducedMotion && metrics.beatPulse > 0.36 && metrics.beatPulse - this.lastPulse > 0.08) {
      this.ripples.push({
        radius: baseRadius * 1.05,
        alpha: 0.65,
        color: palette[this.ripples.length % 3],
      });
      if (this.ripples.length > 8) this.ripples.shift();
    }
    this.lastPulse = metrics.beatPulse;

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.radius += (1.8 + metrics.energy * 3.5) * (state.dt * 60);
      rp.alpha *= 0.962;
      if (rp.alpha < 0.02 || rp.radius > minDim * 0.65) {
        this.ripples.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, rp.radius, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(rp.color, rp.alpha);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Polar harmonic spectrum beams
    const bars = 96;
    const fft = metrics.fft;
    const binLimit = Math.floor(fft.length * 0.55);
    const spin = reducedMotion ? 0 : time * 0.14;

    if (bloom) {
      ctx.shadowBlur = 14;
      ctx.shadowColor = hexToRgba(palette[0], 0.55);
    }

    ctx.lineCap = 'round';
    for (let i = 0; i < bars; i++) {
      // Mirrored symmetry for balanced optical geometry
      const symIdx = i < bars / 2 ? i : bars - 1 - i;
      const frac = symIdx / (bars / 2);
      const binIndex = Math.min(binLimit - 1, Math.floor(Math.pow(frac, 1.55) * binLimit));
      const raw = (fft[binIndex] || 0) / 255;
      const val = Math.min(1.25, raw * (0.7 + intensity * 0.55));

      if (val > this.peakHold[i]) {
        this.peakHold[i] = val;
      } else {
        this.peakHold[i] = Math.max(0.04, this.peakHold[i] - 0.015);
      }

      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2 + spin;
      const innerR = baseRadius + 8;
      const outerR = innerR + Math.max(4, val * maxBarLen);

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x1 = cx + cos * innerR;
      const y1 = cy + sin * innerR;
      const x2 = cx + cos * outerR;
      const y2 = cy + sin * outerR;

      const color = i % 3 === 0 ? palette[0] : i % 3 === 1 ? palette[1] : palette[2];
      ctx.strokeStyle = hexToRgba(color, 0.38 + Math.min(0.62, val * 0.72));
      ctx.lineWidth = Math.max(2, (minDim / 340) * 2.4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Peak dot
      const peakR = innerR + this.peakHold[i] * maxBarLen + 5;
      ctx.fillStyle = hexToRgba('#F3F4F6', 0.55);
      ctx.beginPath();
      ctx.arc(cx + cos * peakR, cy + sin * peakR, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 0;

    // Inner aperture ring
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(palette[0], 0.85);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Circular album artwork inside optical lens core
    if (artworkImage && artworkImage.complete && artworkImage.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(10, baseRadius - 5), 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        artworkImage,
        cx - baseRadius + 5,
        cy - baseRadius + 5,
        (baseRadius - 5) * 2,
        (baseRadius - 5) * 2
      );
      ctx.fillStyle = 'rgba(7, 8, 11, 0.22)';
      ctx.fill();
      ctx.restore();
    } else {
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
      coreGrad.addColorStop(0, hexToRgba(palette[0], 0.35));
      coreGrad.addColorStop(1, 'rgba(16,18,24,0.85)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius - 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
