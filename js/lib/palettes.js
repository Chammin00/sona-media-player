export const DEFAULT_PALETTE = ['#E8A838', '#E05A47', '#5B7CFA'];

export const CURATED_PALETTES = {
  solar: ['#E8A838', '#E05A47', '#F4C978'],
  abyssal: ['#38BDF8', '#5B7CFA', '#A855F7'],
  crimson: ['#F43F5E', '#FB7185', '#F59E0B'],
  emerald: ['#10B981', '#2DD4BF', '#FACC15'],
  silver: ['#E2E8F0', '#94A3B8', '#64748B'],
};

export const PALETTE_PRESETS = [
  { id: 'artwork', label: 'Artwork Sync', colors: null },
  { id: 'solar', label: 'Solar Amber', colors: CURATED_PALETTES.solar },
  { id: 'abyssal', label: 'Abyssal Cobalt', colors: CURATED_PALETTES.abyssal },
  { id: 'crimson', label: 'Crimson Pulse', colors: CURATED_PALETTES.crimson },
  { id: 'emerald', label: 'Emerald Prism', colors: CURATED_PALETTES.emerald },
  { id: 'silver', label: 'Studio Silver', colors: CURATED_PALETTES.silver },
];

export function hexToRgb(hex) {
  const clean = String(hex || '#E8A838').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [232, 168, 56];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function hexToRgb01(hex) {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

export function hexToRgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const val = Math.round(l * 255);
    return [val, val, val];
  }
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function ensureVibrantContrast(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const safeL = Math.max(0.46, Math.min(0.72, l));
  const safeS = s < 0.14 ? s : Math.max(0.45, Math.min(0.92, s));
  const [nr, ng, nb] = hslToRgb(h, safeS, safeL);
  return rgbToHex(nr, ng, nb);
}

function colorDistanceSq(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export async function extractPaletteFromImage(imageUrl) {
  if (!imageUrl || typeof document === 'undefined') {
    return DEFAULT_PALETTE;
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }

    const timeoutId = window.setTimeout(() => resolve(DEFAULT_PALETTE), 3500);

    img.onload = () => {
      window.clearTimeout(timeoutId);
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(DEFAULT_PALETTE);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 120) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const [, s, l] = rgbToHsl(r, g, b);
          if (l < 0.08 || l > 0.94) continue;

          const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
          const weight = 0.25 + s * 2.4 + (1 - Math.abs(l - 0.55));
          const existing = buckets.get(key);
          if (existing) {
            existing.rSum += r * weight;
            existing.gSum += g * weight;
            existing.bSum += b * weight;
            existing.weight += weight;
          } else {
            buckets.set(key, { rSum: r * weight, gSum: g * weight, bSum: b * weight, weight });
          }
        }

        const candidates = Array.from(buckets.values())
          .sort((a, b) => b.weight - a.weight)
          .map((bucket) => [
            bucket.rSum / bucket.weight,
            bucket.gSum / bucket.weight,
            bucket.bSum / bucket.weight,
          ]);

        if (candidates.length === 0) {
          resolve(DEFAULT_PALETTE);
          return;
        }

        const picked = [candidates[0]];
        for (const c of candidates.slice(1)) {
          if (picked.every((p) => colorDistanceSq(p, c) > 2600)) {
            picked.push(c);
            if (picked.length === 3) break;
          }
        }

        while (picked.length < 3) {
          const base = picked[0];
          const [h, s, l] = rgbToHsl(base[0], base[1], base[2]);
          const shift = picked.length === 1 ? 0.11 : 0.42;
          picked.push(hslToRgb((h + shift) % 1, Math.max(0.55, s), Math.min(0.68, Math.max(0.48, l))));
        }

        resolve([
          ensureVibrantContrast(picked[0][0], picked[0][1], picked[0][2]),
          ensureVibrantContrast(picked[1][0], picked[1][1], picked[1][2]),
          ensureVibrantContrast(picked[2][0], picked[2][1], picked[2][2]),
        ]);
      } catch {
        resolve(DEFAULT_PALETTE);
      }
    };

    img.onerror = () => {
      window.clearTimeout(timeoutId);
      resolve(DEFAULT_PALETTE);
    };

    img.src = imageUrl;
  });
}
