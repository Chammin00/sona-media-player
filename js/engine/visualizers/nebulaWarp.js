import { hexToRgba } from '../../lib/palettes.js';

export class NebulaWarpRenderer {
  constructor() {
    this.starCount = 160;
    this.stars = Array.from({ length: this.starCount }, (_, i) => ({
      x: (Math.random() - 0.5) * 2.2,
      y: (Math.random() - 0.5) * 2.2,
      z: 0.1 + Math.random() * 1.9,
      size: 0.8 + Math.random() * 2.1,
      colorIdx: i % 3,
    }));
  }

  render(ctx, state) {
    const { width, height, dpr, dt, time, palette, metrics, intensity, bloom, reducedMotion } = state;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#07080B';
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.5;
    const minDim = Math.min(width, height);

    // Nebula cloud backdrop
    const nebGrad = ctx.createRadialGradient(cx, cy, 8, cx, cy, minDim * 0.65);
    nebGrad.addColorStop(0, hexToRgba(palette[0], 0.16 + metrics.bass * 0.24));
    nebGrad.addColorStop(0.5, hexToRgba(palette[2], 0.1 + metrics.mid * 0.14));
    nebGrad.addColorStop(1, 'rgba(7,8,11,0)');
    ctx.fillStyle = nebGrad;
    ctx.fillRect(0, 0, width, height);

    const speed = reducedMotion
      ? 0.08
      : (0.28 + metrics.bass * 1.45 + metrics.beatPulse * 1.8) * Math.min(1.8, intensity);

    const projected = [];

    if (bloom) {
      ctx.shadowBlur = 10;
    }

    for (const star of this.stars) {
      const prevZ = star.z;
      star.z -= speed * dt;
      if (star.z <= 0.04) {
        star.x = (Math.random() - 0.5) * 2.2;
        star.y = (Math.random() - 0.5) * 2.2;
        star.z = 1.9 + Math.random() * 0.2;
        continue;
      }

      const scale = 1 / star.z;
      const prevScale = 1 / prevZ;
      const sx = cx + star.x * scale * minDim * 0.48;
      const sy = cy + star.y * scale * minDim * 0.48;
      const px = cx + star.x * prevScale * minDim * 0.48;
      const py = cy + star.y * prevScale * minDim * 0.48;

      if (sx < -40 || sx > width + 40 || sy < -40 || sy > height + 40) {
        star.z = 1.95;
        continue;
      }

      const depthAlpha = Math.max(0.08, Math.min(0.95, 1.15 - star.z * 0.52));
      const color = palette[star.colorIdx];
      if (bloom) ctx.shadowColor = hexToRgba(color, 0.7);

      ctx.strokeStyle = hexToRgba(color, depthAlpha * 0.75);
      ctx.lineWidth = Math.max(1, star.size * scale * 0.55);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      ctx.fillStyle = hexToRgba('#F3F4F6', depthAlpha);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.min(4.2, star.size * scale * 0.45), 0, Math.PI * 2);
      ctx.fill();

      if (star.z < 1.1) {
        projected.push({ x: sx, y: sy, color });
      }
    }

    ctx.shadowBlur = 0;

    // Treble constellation filaments
    if (metrics.treble > 0.1 || metrics.energy > 0.15) {
      const linkAlpha = Math.min(0.32, 0.06 + metrics.treble * 0.42 * intensity);
      const maxDistSq = Math.pow(minDim * 0.16, 2);
      ctx.lineWidth = 1;
      for (let i = 0; i < Math.min(42, projected.length); i++) {
        for (let j = i + 1; j < Math.min(42, projected.length); j++) {
          const dx = projected[i].x - projected[j].x;
          const dy = projected[i].y - projected[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < maxDistSq) {
            const fade = 1 - d2 / maxDistSq;
            ctx.strokeStyle = hexToRgba(projected[i].color, linkAlpha * fade);
            ctx.beginPath();
            ctx.moveTo(projected[i].x, projected[i].y);
            ctx.lineTo(projected[j].x, projected[j].y);
            ctx.stroke();
          }
        }
      }
    }

    // Central harmonic polygon rings
    const ringCount = 3;
    for (let r = 0; r < ringCount; r++) {
      const sides = 6 + r * 2;
      const rad = minDim * (0.09 + r * 0.065) * (1 + metrics.bass * 0.35 + metrics.beatPulse * 0.25);
      const rot = (reducedMotion ? 0 : time * (0.25 + r * 0.12)) * (r % 2 === 0 ? 1 : -1);
      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const a = rot + (s / sides) * Math.PI * 2;
        const vx = cx + Math.cos(a) * rad;
        const vy = cy + Math.sin(a) * rad;
        if (s === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.strokeStyle = hexToRgba(palette[r % 3], 0.28 + metrics.beatPulse * 0.35);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }
}
