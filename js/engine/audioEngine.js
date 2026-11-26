export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

export const EQ_PRESETS = {
  'Studio Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Deep Bass': [6.5, 5.5, 4.0, 2.0, 0.5, 0, 0.5, 1.5, 2.5, 3.0],
  'Vocal Clarity': [-2.0, -1.5, -0.5, 1.5, 3.5, 4.5, 4.0, 2.5, 1.0, 0.5],
  'Acoustic Warmth': [2.5, 2.0, 1.5, 1.0, 0, -0.5, 1.0, 2.0, 2.5, 1.5],
  'Electronic Club': [5.5, 4.5, 2.5, 0, -1.5, 0.5, 2.0, 3.5, 4.5, 5.0],
  'Cinema Impact': [5.0, 4.0, 2.5, 0.5, 0, 1.5, 2.5, 3.0, 2.0, 1.5],
  'Late Night': [-3.0, -2.0, 0.5, 2.0, 2.5, 2.0, 1.5, 0.5, -1.0, -2.0],
};

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function computeBiquadMagSq(type, fc, gainDb, q, sampleRate, f) {
  if (Math.abs(gainDb) < 0.01) return 1;
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);

  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowshelf') {
    const alpha = sinW0 / Math.SQRT2;
    const c = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * cosW0 + c);
    b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
    b2 = A * (A + 1 - (A - 1) * cosW0 - c);
    a0 = A + 1 + (A - 1) * cosW0 + c;
    a1 = -2 * (A - 1 + (A + 1) * cosW0);
    a2 = A + 1 + (A - 1) * cosW0 - c;
  } else if (type === 'highshelf') {
    const alpha = sinW0 / Math.SQRT2;
    const c = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cosW0 + c);
    b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
    b2 = A * (A + 1 + (A - 1) * cosW0 - c);
    a0 = A + 1 - (A - 1) * cosW0 + c;
    a1 = 2 * (A - 1 - (A + 1) * cosW0);
    a2 = A + 1 - (A - 1) * cosW0 - c;
  } else {
    const alpha = sinW0 / (2 * q);
    b0 = 1 + alpha * A;
    b1 = -2 * cosW0;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosW0;
    a2 = 1 - alpha / A;
  }

  const w = (2 * Math.PI * Math.min(sampleRate * 0.49, f)) / sampleRate;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cos2W = Math.cos(2 * w);
  const sin2W = Math.sin(2 * w);

  const numRe = b0 + b1 * cosW + b2 * cos2W;
  const numIm = b1 * sinW + b2 * sin2W;
  const denRe = a0 + a1 * cosW + a2 * cos2W;
  const denIm = a1 * sinW + a2 * sin2W;

  const denSq = denRe * denRe + denIm * denIm;
  return denSq > 1e-12 ? (numRe * numRe + numIm * numIm) / denSq : 1;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.mediaEl = null;
    this.sourceNode = null;
    this.preampNode = null;
    this.filterNodes = [];
    this.pannerNode = null;
    this.masterGainNode = null;
    this.analyserNode = null;
    this.compressorNode = null;

    this.fftBuffer = new Uint8Array(1024);
    this.waveBuffer = new Uint8Array(1024);
    this.synthFftBuffer = new Uint8Array(1024);
    this.synthWaveBuffer = new Uint8Array(1024);

    this.smoothBass = 0;
    this.smoothMid = 0;
    this.smoothTreble = 0;
    this.smoothEnergy = 0;
    this.beatPulse = 0;
    this.prevBass = 0;

    this.corsFallback = false;
    this.pendingEq = null;
    this.pendingVolume = 0.85;
    this.pendingMuted = false;
  }

  attachMediaElement(videoEl) {
    if (this.mediaEl === videoEl) return;
    this.mediaEl = videoEl;
  }

  getMediaElement() {
    return this.mediaEl;
  }

  setCorsFallback(active) {
    this.corsFallback = Boolean(active);
  }

  isCorsFallback() {
    return this.corsFallback;
  }

  async ensureContext() {
    if (!this.mediaEl) return;

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      try {
        this.sourceNode = ctx.createMediaElementSource(this.mediaEl);
      } catch {
        return;
      }

      this.preampNode = ctx.createGain();
      this.pannerNode = ctx.createStereoPanner();
      this.masterGainNode = ctx.createGain();
      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.8;

      this.compressorNode = ctx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -3;
      this.compressorNode.knee.value = 12;
      this.compressorNode.ratio.value = 6;
      this.compressorNode.attack.value = 0.005;
      this.compressorNode.release.value = 0.15;

      this.filterNodes = EQ_FREQUENCIES.map((freq, index) => {
        const filter = ctx.createBiquadFilter();
        filter.frequency.value = freq;
        if (index === 0) {
          filter.type = 'lowshelf';
        } else if (index === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.gain.value = 0;
        return filter;
      });

      this.sourceNode.connect(this.preampNode);
      let head = this.preampNode;
      for (const filter of this.filterNodes) {
        head.connect(filter);
        head = filter;
      }
      head.connect(this.pannerNode);
      this.pannerNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.compressorNode);
      this.compressorNode.connect(ctx.destination);

      const binCount = this.analyserNode.frequencyBinCount;
      this.fftBuffer = new Uint8Array(binCount);
      this.waveBuffer = new Uint8Array(binCount);
      this.synthFftBuffer = new Uint8Array(binCount);
      this.synthWaveBuffer = new Uint8Array(binCount);

      if (this.pendingEq) {
        this.applyEqState(this.pendingEq);
      }
      this.applyVolume(this.pendingVolume, this.pendingMuted);
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Ignore resume failure outside gesture
      }
    }
  }

  applyEqState(eq) {
    this.pendingEq = eq;
    if (!this.ctx || !this.preampNode || !this.pannerNode || this.filterNodes.length === 0) {
      return;
    }

    const now = this.ctx.currentTime;
    const targetPreamp = eq.enabled ? dbToLinear(eq.preamp) : 1;
    this.preampNode.gain.setTargetAtTime(targetPreamp, now, 0.02);
    this.pannerNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, eq.pan)), now, 0.02);

    this.filterNodes.forEach((node, idx) => {
      const targetGain = eq.enabled ? (eq.bands[idx] ?? 0) : 0;
      node.gain.setTargetAtTime(targetGain, now, 0.02);
    });
  }

  applyVolume(volume, muted) {
    this.pendingVolume = volume;
    this.pendingMuted = muted;

    if (!this.mediaEl) return;
    if (this.ctx && this.masterGainNode) {
      this.mediaEl.muted = false;
      this.mediaEl.volume = 1;
      const target = muted ? 0 : Math.max(0, Math.min(1, volume));
      this.masterGainNode.gain.setTargetAtTime(target, this.ctx.currentTime, 0.018);
    } else {
      this.mediaEl.muted = Boolean(muted);
      this.mediaEl.volume = Math.max(0, Math.min(1, volume));
    }
  }

  getFrequencyResponseCurve(freqs, eq) {
    const out = new Float32Array(freqs.length);
    if (!eq.enabled) return out;

    const sampleRate = this.ctx?.sampleRate ?? 48000;
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i];
      let magSq = 1;
      for (let b = 0; b < EQ_FREQUENCIES.length; b++) {
        const type = b === 0 ? 'lowshelf' : b === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
        magSq *= computeBiquadMagSq(type, EQ_FREQUENCIES[b], eq.bands[b] ?? 0, 1.4, sampleRate, f);
      }
      out[i] = eq.preamp + 10 * Math.log10(Math.max(1e-8, magSq));
    }
    return out;
  }

  getAudioMetrics(timeSec, isPlaying) {
    const analyser = this.analyserNode;
    const sampleRate = this.ctx?.sampleRate ?? 48000;

    let rawBass = 0;
    let rawMid = 0;
    let rawTreble = 0;
    let fftToUse = this.fftBuffer;
    let waveToUse = this.waveBuffer;

    const canReadAnalyser = Boolean(analyser && isPlaying && !this.corsFallback);

    if (canReadAnalyser && analyser) {
      analyser.getByteFrequencyData(this.fftBuffer);
      analyser.getByteTimeDomainData(this.waveBuffer);

      const nyquist = sampleRate / 2;
      const binCount = this.fftBuffer.length;
      const binHz = nyquist / binCount;

      let bassSum = 0;
      let bassCount = 0;
      let midSum = 0;
      let midCount = 0;
      let trebleSum = 0;
      let trebleCount = 0;

      for (let i = 1; i < binCount; i++) {
        const freq = i * binHz;
        const val = this.fftBuffer[i] / 255;
        if (freq <= 160) {
          bassSum += val;
          bassCount++;
        } else if (freq <= 2500) {
          midSum += val;
          midCount++;
        } else if (freq <= 16000) {
          trebleSum += val;
          trebleCount++;
        }
      }

      rawBass = bassCount > 0 ? bassSum / bassCount : 0;
      rawMid = midCount > 0 ? midSum / midCount : 0;
      rawTreble = trebleCount > 0 ? trebleSum / trebleCount : 0;
    }

    const useProcedural =
      !canReadAnalyser ||
      (isPlaying && rawBass + rawMid + rawTreble < 0.002 && this.corsFallback);

    if (useProcedural) {
      const len = this.synthFftBuffer.length;
      const amp = isPlaying ? 0.62 : 0.16;
      const speed = isPlaying ? 2.4 : 0.72;

      for (let i = 0; i < len; i++) {
        const norm = i / len;
        const bassCurve = Math.exp(-norm * 10);
        const midCurve = Math.exp(-Math.pow((norm - 0.18) * 6, 2));
        const mod =
          0.52 +
          0.28 * Math.sin(timeSec * speed + norm * 14) +
          0.2 * Math.cos(timeSec * speed * 1.7 - norm * 22);
        const value = Math.max(
          0,
          Math.min(255, Math.round((bassCurve * 0.8 + midCurve * 0.55 + 0.12) * mod * amp * 255))
        );
        this.synthFftBuffer[i] = value;

        const waveVal =
          128 +
          Math.round(
            (Math.sin(timeSec * speed * 4 + norm * 24) * 0.6 +
              Math.sin(timeSec * speed * 9 - norm * 48) * 0.4) *
              amp *
              (isPlaying ? 52 : 16)
          );
        this.synthWaveBuffer[i] = Math.max(0, Math.min(255, waveVal));
      }

      rawBass = isPlaying ? 0.34 + 0.18 * Math.sin(timeSec * 3.8) : 0.1 + 0.04 * Math.sin(timeSec * 0.9);
      rawMid = isPlaying ? 0.28 + 0.14 * Math.cos(timeSec * 2.9) : 0.08 + 0.03 * Math.cos(timeSec * 0.7);
      rawTreble = isPlaying ? 0.2 + 0.12 * Math.sin(timeSec * 5.2) : 0.05 + 0.02 * Math.sin(timeSec * 1.1);
      fftToUse = this.synthFftBuffer;
      waveToUse = this.synthWaveBuffer;
    }

    const attack = 0.36;
    const release = 0.14;
    this.smoothBass += (rawBass - this.smoothBass) * (rawBass > this.smoothBass ? attack : release);
    this.smoothMid += (rawMid - this.smoothMid) * (rawMid > this.smoothMid ? attack : release);
    this.smoothTreble +=
      (rawTreble - this.smoothTreble) * (rawTreble > this.smoothTreble ? attack : release);
    const rawEnergy = rawBass * 0.48 + rawMid * 0.34 + rawTreble * 0.18;
    this.smoothEnergy += (rawEnergy - this.smoothEnergy) * 0.22;

    const deltaBass = rawBass - this.prevBass;
    this.prevBass = rawBass;
    if (isPlaying && deltaBass > 0.055 && rawBass > 0.25) {
      this.beatPulse = Math.min(1, this.beatPulse + deltaBass * 3.8);
    } else {
      this.beatPulse *= 0.91;
    }

    return {
      fft: fftToUse,
      waveform: waveToUse,
      bass: this.smoothBass,
      mid: this.smoothMid,
      treble: this.smoothTreble,
      energy: this.smoothEnergy,
      beatPulse: this.beatPulse,
    };
  }
}

export const audioEngine = new AudioEngine();
