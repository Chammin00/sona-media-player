export function generateFallbackPeaks(seedString, bars = 96) {
  let seed = 2166136261;
  for (let i = 0; i < seedString.length; i++) {
    seed ^= seedString.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  const nextRand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1000) / 1000;
  };

  const peaks = [];
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const envelope = Math.sin(t * Math.PI) * 0.35 + 0.45;
    const wave = Math.sin(t * Math.PI * 7) * 0.14 + Math.cos(t * Math.PI * 15) * 0.08;
    const jitter = (nextRand() - 0.5) * 0.32;
    peaks.push(Math.max(0.14, Math.min(0.98, envelope + wave + jitter)));
  }
  return peaks;
}

export function computePeaksFromBuffer(buffer, bars = 96) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (length === 0 || channels === 0) return generateFallbackPeaks('empty', bars);

  const blockSize = Math.max(1, Math.floor(length / bars));
  const raw = [];
  let maxPeak = 0.001;

  for (let i = 0; i < bars; i++) {
    const start = i * blockSize;
    const end = Math.min(length, start + blockSize);
    const step = Math.max(1, Math.floor((end - start) / 64));
    let sumSq = 0;
    let count = 0;

    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let j = start; j < end; j += step) {
        const v = data[j];
        sumSq += v * v;
        count++;
      }
    }

    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    raw.push(rms);
    if (rms > maxPeak) maxPeak = rms;
  }

  return raw.map((v) => Math.max(0.12, Math.min(1, v / maxPeak)));
}

export async function extractWaveformPeaks(src, bars = 96) {
  if (!src) return generateFallbackPeaks('no-src', bars);
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return generateFallbackPeaks(src, bars);
  }

  try {
    const response = await fetch(src);
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 40 * 1024 * 1024) {
      return generateFallbackPeaks(src, bars);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 40 * 1024 * 1024) {
      return generateFallbackPeaks(src, bars);
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return generateFallbackPeaks(src, bars);

    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      return computePeaksFromBuffer(decoded, bars);
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch {
    return generateFallbackPeaks(src, bars);
  }
}
