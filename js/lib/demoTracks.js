import { computePeaksFromBuffer } from './waveform.js';

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeAudioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function createProceduralArtwork(palette, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const [c1, c2, c3] = palette;
  ctx.fillStyle = '#07080B';
  ctx.fillRect(0, 0, 512, 512);

  const g1 = ctx.createRadialGradient(170, 170, 20, 256, 256, 320);
  g1.addColorStop(0, c1);
  g1.addColorStop(0.48, c2 + '66');
  g1.addColorStop(1, 'rgba(7,8,11,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, 512, 512);

  const g2 = ctx.createRadialGradient(360, 350, 10, 340, 330, 260);
  g2.addColorStop(0, c3 + 'AA');
  g2.addColorStop(1, 'rgba(7,8,11,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, 512, 512);

  ctx.save();
  ctx.translate(256, 256);
  for (let i = 0; i < 6; i++) {
    const radius = 64 + i * 28;
    ctx.beginPath();
    ctx.arc(0, 0, radius, seed * 0.4 + i * 0.45, seed * 0.4 + i * 0.45 + Math.PI * 1.45);
    ctx.strokeStyle = i % 2 === 0 ? c1 + 'AA' : 'rgba(243,244,246,0.22)';
    ctx.lineWidth = i === 2 ? 3 : 1.5;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, 42, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(7,8,11,0.75)';
  ctx.fill();
  ctx.strokeStyle = c1;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#F3F4F6';
  ctx.fill();
  ctx.restore();

  return canvas.toDataURL('image/png');
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function createNoiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    ch[i] = Math.random() * 2 - 1;
  }
  return buf;
}

function triggerKick(ctx, dest, time, level = 0.72) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(132, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);

  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(level, time + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);

  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.36);
}

function triggerHat(ctx, dest, noiseBuf, time, level = 0.12, decay = 0.055) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(6800, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);

  src.connect(hp);
  hp.connect(gain);
  gain.connect(dest);
  src.start(time);
  src.stop(time + decay + 0.02);
}

function triggerSnare(ctx, dest, noiseBuf, time, level = 0.28) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1950, time);
  bp.Q.setValueAtTime(0.8, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.17);

  src.connect(bp);
  bp.connect(gain);
  gain.connect(dest);
  src.start(time);
  src.stop(time + 0.19);
}

async function renderNocturneInGlass() {
  const sampleRate = 44100;
  const bpm = 108;
  const beat = 60 / bpm;
  const duration = beat * 32;
  const ctx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.78;
  master.connect(ctx.destination);

  const noise = createNoiseBuffer(ctx, 0.25);

  const chords = [
    [62, 65, 69, 72, 76],
    [55, 62, 65, 67, 71],
    [60, 64, 67, 71, 74],
    [57, 61, 64, 67, 72],
  ];
  const bassNotes = [38, 43, 36, 45];

  for (let bar = 0; bar < 8; bar++) {
    const chord = chords[bar % 4];
    const bassMidi = bassNotes[bar % 4];
    const barStart = bar * 4 * beat;

    for (const hitOffset of [0, 1.5 * beat, 2.75 * beat]) {
      const t = barStart + hitOffset;
      chord.forEach((midi, idx) => {
        const osc = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner();

        const freq = midiToFreq(midi);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        mod.type = 'sine';
        mod.frequency.setValueAtTime(freq * 2, t);
        modGain.gain.setValueAtTime(freq * 0.65, t);
        modGain.gain.exponentialRampToValueAtTime(freq * 0.08, t + 0.6);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.075, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);

        pan.pan.value = ((idx - 2) / 2) * 0.45;
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        osc.connect(gain);
        gain.connect(pan);
        pan.connect(master);

        mod.start(t);
        osc.start(t);
        mod.stop(t + 1.4);
        osc.stop(t + 1.4);
      });
    }

    for (let b = 0; b < 4; b++) {
      const t = barStart + b * beat;
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(bassMidi), t);
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(340, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.32, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.92);
      osc.connect(lp);
      lp.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + beat);
    }

    for (let step = 0; step < 8; step++) {
      const t = barStart + step * (beat / 2);
      if (step === 0 || step === 3 || step === 4) {
        triggerKick(ctx, master, t, 0.56);
      }
      if (step === 2 || step === 6) {
        triggerSnare(ctx, master, noise, t, 0.14);
      }
      triggerHat(ctx, master, noise, t, step % 2 === 0 ? 0.09 : 0.05, 0.05);
    }
  }

  const buffer = await ctx.startRendering();
  return {
    blob: encodeAudioBufferToWav(buffer),
    duration: buffer.duration,
    peaks: computePeaksFromBuffer(buffer, 96),
  };
}

async function renderKineticPulse() {
  const sampleRate = 44100;
  const bpm = 122;
  const beat = 60 / bpm;
  const sixteenth = beat / 4;
  const duration = beat * 32;
  const ctx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.74;
  master.connect(ctx.destination);

  const noise = createNoiseBuffer(ctx, 0.25);
  const bassRoot = [45, 41, 48, 43];
  const arpPatterns = [
    [69, 72, 76, 81],
    [65, 69, 72, 77],
    [72, 76, 79, 84],
    [67, 71, 74, 79],
  ];

  for (let bar = 0; bar < 8; bar++) {
    const barStart = bar * 4 * beat;
    const root = bassRoot[Math.floor(bar / 2) % 4];
    const arp = arpPatterns[Math.floor(bar / 2) % 4];

    for (let b = 0; b < 4; b++) {
      const t = barStart + b * beat;
      triggerKick(ctx, master, t, 0.72);
      if (b === 1 || b === 3) {
        triggerSnare(ctx, master, noise, t, 0.3);
      }
      triggerHat(ctx, master, noise, t + beat / 2, 0.14, 0.07);
    }

    for (let s = 0; s < 16; s++) {
      const t = barStart + s * sixteenth;

      const bassOsc = ctx.createOscillator();
      const bassLp = ctx.createBiquadFilter();
      const bassGain = ctx.createGain();
      bassOsc.type = 'sawtooth';
      const octaveBoost = s % 2 === 1 ? 12 : 0;
      bassOsc.frequency.setValueAtTime(midiToFreq(root + octaveBoost), t);
      bassLp.type = 'lowpass';
      bassLp.frequency.setValueAtTime(920, t);
      bassLp.frequency.exponentialRampToValueAtTime(180, t + sixteenth * 0.9);
      bassGain.gain.setValueAtTime(0.001, t);
      bassGain.gain.linearRampToValueAtTime(0.2, t + 0.008);
      bassGain.gain.exponentialRampToValueAtTime(0.001, t + sixteenth * 0.95);
      bassOsc.connect(bassLp);
      bassLp.connect(bassGain);
      bassGain.connect(master);
      bassOsc.start(t);
      bassOsc.stop(t + sixteenth);

      const note = arp[(s + bar) % arp.length];
      const arpOsc = ctx.createOscillator();
      const arpGain = ctx.createGain();
      const arpPan = ctx.createStereoPanner();
      arpOsc.type = 'triangle';
      arpOsc.frequency.setValueAtTime(midiToFreq(note), t);
      arpGain.gain.setValueAtTime(0.001, t);
      arpGain.gain.linearRampToValueAtTime(0.11, t + 0.008);
      arpGain.gain.exponentialRampToValueAtTime(0.001, t + sixteenth * 1.4);
      arpPan.pan.value = Math.sin(s * 0.8) * 0.65;
      arpOsc.connect(arpGain);
      arpGain.connect(arpPan);
      arpPan.connect(master);
      arpOsc.start(t);
      arpOsc.stop(t + sixteenth * 1.5);
    }
  }

  const buffer = await ctx.startRendering();
  return {
    blob: encodeAudioBufferToWav(buffer),
    duration: buffer.duration,
    peaks: computePeaksFromBuffer(buffer, 96),
  };
}

async function renderSolarDrift() {
  const sampleRate = 44100;
  const bpm = 86;
  const beat = 60 / bpm;
  const duration = beat * 32;
  const ctx = new OfflineAudioContext(2, Math.floor(sampleRate * duration), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.72;
  master.connect(ctx.destination);

  const padChords = [
    [48, 55, 62, 64, 67],
    [45, 52, 59, 60, 64],
    [41, 48, 55, 57, 60],
    [43, 50, 57, 59, 62],
  ];

  for (let bar = 0; bar < 8; bar += 2) {
    const start = bar * 4 * beat;
    const len = 8 * beat;
    const chord = padChords[(bar / 2) % padChords.length];

    chord.forEach((midi, idx) => {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        const lp = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner();

        osc.type = idx === 0 ? 'triangle' : 'sawtooth';
        osc.frequency.setValueAtTime(midiToFreq(midi), start);
        osc.detune.setValueAtTime(detune, start);

        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(420, start);
        lp.frequency.linearRampToValueAtTime(1450, start + len * 0.45);
        lp.frequency.linearRampToValueAtTime(360, start + len);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.068, start + 0.85);
        gain.gain.setValueAtTime(0.068, start + len - 0.9);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + len);

        pan.pan.value = detune < 0 ? -0.45 : 0.45;
        osc.connect(lp);
        lp.connect(gain);
        gain.connect(pan);
        pan.connect(master);

        osc.start(start);
        osc.stop(start + len + 0.05);
      }
    });

    for (let step = 0; step < 4; step++) {
      const bellTime = start + step * 2 * beat;
      const bellOsc = ctx.createOscillator();
      const bellGain = ctx.createGain();
      const bellPan = ctx.createStereoPanner();
      const note = chord[(step + 2) % chord.length] + 12;

      bellOsc.type = 'sine';
      bellOsc.frequency.setValueAtTime(midiToFreq(note), bellTime);
      bellGain.gain.setValueAtTime(0.0001, bellTime);
      bellGain.gain.linearRampToValueAtTime(0.11, bellTime + 0.02);
      bellGain.gain.exponentialRampToValueAtTime(0.0001, bellTime + 2.4);
      bellPan.pan.value = step % 2 === 0 ? -0.55 : 0.55;

      bellOsc.connect(bellGain);
      bellGain.connect(bellPan);
      bellPan.connect(master);
      bellOsc.start(bellTime);
      bellOsc.stop(bellTime + 2.5);
    }
  }

  const buffer = await ctx.startRendering();
  return {
    blob: encodeAudioBufferToWav(buffer),
    duration: buffer.duration,
    peaks: computePeaksFromBuffer(buffer, 96),
  };
}

let cachedDemoTracks = null;
let pendingDemoTracks = null;

export async function createDemoTracks() {
  if (cachedDemoTracks) return cachedDemoTracks;
  if (pendingDemoTracks) return pendingDemoTracks;

  pendingDemoTracks = (async () => {
    const [nocturne, kinetic, solar] = await Promise.all([
      renderNocturneInGlass(),
      renderKineticPulse(),
      renderSolarDrift(),
    ]);

    const p1 = ['#E8A838', '#E05A47', '#5B7CFA'];
    const p2 = ['#22D3EE', '#6366F1', '#EC4899'];
    const p3 = ['#10B981', '#14B8A6', '#F59E0B'];

    const now = Date.now();
    cachedDemoTracks = [
      {
        id: 'demo-nocturne-in-glass',
        title: 'Nocturne in Glass',
        artist: 'SONA Studio',
        album: 'Acoustic Optics',
        duration: nocturne.duration,
        kind: 'audio',
        sourceType: 'demo',
        src: URL.createObjectURL(nocturne.blob),
        artworkUrl: createProceduralArtwork(p1, 1),
        palette: p1,
        mimeType: 'audio/wav',
        addedAt: now - 3000,
        favorite: true,
        peaks: nocturne.peaks,
      },
      {
        id: 'demo-kinetic-pulse',
        title: 'Kinetic Pulse',
        artist: 'SONA Studio',
        album: 'Neon Telemetry',
        duration: kinetic.duration,
        kind: 'audio',
        sourceType: 'demo',
        src: URL.createObjectURL(kinetic.blob),
        artworkUrl: createProceduralArtwork(p2, 2),
        palette: p2,
        mimeType: 'audio/wav',
        addedAt: now - 2000,
        favorite: false,
        peaks: kinetic.peaks,
      },
      {
        id: 'demo-solar-drift',
        title: 'Solar Drift',
        artist: 'SONA Studio',
        album: 'Horizon Field',
        duration: solar.duration,
        kind: 'audio',
        sourceType: 'demo',
        src: URL.createObjectURL(solar.blob),
        artworkUrl: createProceduralArtwork(p3, 3),
        palette: p3,
        mimeType: 'audio/wav',
        addedAt: now - 1000,
        favorite: false,
        peaks: solar.peaks,
      },
    ];
    return cachedDemoTracks;
  })();

  return pendingDemoTracks;
}
