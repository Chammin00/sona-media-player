import { hexToRgba } from '../../lib/palettes.js';

export class PrismBarsRenderer {
  constructor() {
    this.bandCount = 64;
    this.levels = new Float32Array(this.bandCount);
    this.peaks = new Float32Array(this.bandCount);
    this.peakVel = new Float32Array(this.bandCount);
  }

  render(ctx, state) {
    const { width, height, dpr, palette, metrics, intensity, bloom, reducedMotion } = state;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#07080B';
    ctx.fillRect(0, 0, width, height);

    const padX = Math.max(24, width * 0.08);
    const usableW = Math.max(120, width - padX * 2);
    const baselineY = height * 0.68;
    const maxBarH = height * 0.44;

    // Subtle atmospheric spotlight behind analyzer
    const glow = ctx.createRadialGradient(width * 0.5, baselineY, 10, width * 0.5, baselineY * 0.7, width * 0.65);
    glow.addColorStop(0, hexToRgba(palette[0], 0.14 + metrics.bass * 0.18));
    glow.addColorStop(0.5, hexToRgba(palette[2], 0.07));
    glow.addColorStop(1, 'rgba(7,8,11,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Subtle horizon grid rules
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let g = 1; g <= 4; g++) {
      const gy = baselineY - (maxBarH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padX, gy);
      ctx.lineTo(width - padX, gy);
      ctx.stroke();
    }

    const fft = metrics.fft;
    const binMax = Math.floor(fft.length * 0.68);
    const slotW = usableW / this.bandCount;
    const barW = Math.max(3, slotW * 0.62);

    const barGrad = ctx.createLinearGradient(0, baselineY - maxBarH, 0, baselineY);
    barGrad.addColorStop(0, palette[0]);
    barGrad.addColorStop(0.55, palette[1]);
    barGrad.addColorStop(1, palette[2]);

    const reflGrad = ctx.createLinearGradient(0, baselineY, 0, baselineY + maxBarH * 0.36);
    reflGrad.addColorStop(0, hexToRgba(palette[2], 0.28));
    reflGrad.addColorStop(1, 'rgba(7,8,11,0)');

    for (let i = 0; i < this.bandCount; i++) {
      const t0 = i / this.bandCount;
      const t1 = (i + 1) / this.bandCount;
      const b0 = Math.floor(Math.pow(t0, 1.9) * binMax);
      const b1 = Math.max(b0 + 1, Math.floor(Math.pow(t1, 1.9) * binMax));

      let sum = 0;
      for (let b = b0; b < b1 && b < fft.length; b++) {
        sum += fft[b] / 255;
      }
      const raw = sum / Math.max(1, b1 - b0);
      const target = Math.min(1, raw * (0.68 + intensity * 0.55));
      const lerp = reducedMotion ? 0.14 : 0.32;
      this.levels[i] += (target - this.levels[i]) * lerp;

      if (this.levels[i] >= this.peaks[i]) {
        this.peaks[i] = this.levels[i];
        this.peakVel[i] = 0;
      } else {
        this.peakVel[i] += 0.0014;
        this.peaks[i] = Math.max(0, this.peaks[i] - this.peakVel[i]);
      }

      const x = padX + i * slotW + (slotW - barW) * 0.5;
      const h = Math.max(3, this.levels[i] * maxBarH);
      const y = baselineY - h;

      if (bloom) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = hexToRgba(palette[0], 0.35);
      }

      ctx.fillStyle = barGrad;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, h, [3, 3, 0, 0]);
      ctx.fill();

      ctx.shadowBlur = 0;

      // Peak hold indicator needle
      const peakY = baselineY - Math.max(6, this.peaks[i] * maxBarH) - 4;
      ctx.fillStyle = 'rgba(243, 244, 246, 0.85)';
      ctx.fillRect(x, peakY, barW, 2);

      // Glossy floor reflection
      ctx.fillStyle = reflGrad;
      ctx.fillRect(x, baselineY + 2, barW, h * 0.35);
    }

    // Horizon baseline + frequency markers
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(padX, baselineY, usableW, 1);

    const markers = [
      { pos: 0.08, label: '64 Hz' },
      { pos: 0.28, label: '250 Hz' },
      { pos: 0.52, label: '1 kHz' },
      { pos: 0.76, label: '4 kHz' },
      { pos: 0.94, label: '16 kHz' },
    ];
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(142, 149, 165, 0.7)';
    ctx.textAlign = 'center';
    for (const m of markers) {
      const mx = padX + usableW * m.pos;
      ctx.fillText(m.label, mx, baselineY + 18);
    }

    ctx.restore();
  }
}
