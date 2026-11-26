import { audioEngine } from '../engine/audioEngine.js';
import { AuroraEngine } from '../engine/visualizers/auroraShader.js';
import { HarmonicHaloRenderer } from '../engine/visualizers/harmonicHalo.js';
import { PrismBarsRenderer } from '../engine/visualizers/prismBars.js';
import { OscilloscopeRenderer } from '../engine/visualizers/oscilloscope.js';
import { NebulaWarpRenderer } from '../engine/visualizers/nebulaWarp.js';
import { hexToRgba } from '../lib/palettes.js';
import { getActiveSubtitle } from '../lib/subtitles.js';
import { icon } from '../icons.js';
import { positionGlider } from './glider.js';

const MODE_LABELS = {
  aurora: 'Aurora Fluid',
  halo: 'Harmonic Halo',
  prism: 'Prism Bars',
  oscilloscope: 'Oscilloscope',
  nebula: 'Nebula Warp',
};

export class StageController {
  constructor(getState, actions) {
    this.getState = getState;
    this.actions = actions;

    this.stageEl = document.getElementById('visual-stage');
    this.glCanvas = document.getElementById('gl-stage');
    this.canvas2d = document.getElementById('canvas-stage');
    this.ambilightCanvas = document.getElementById('ambilight-canvas');
    this.videoFrame = document.getElementById('video-frame');
    this.videoEl = document.getElementById('sona-media');
    this.modeSwitcher = document.getElementById('stage-mode-switcher');
    this.modeGlider = document.getElementById('stage-mode-glider');
    this.showcaseEl = document.getElementById('audio-showcase');
    this.showcaseArtBtn = document.getElementById('btn-showcase-art');
    this.showcaseArtImg = document.getElementById('showcase-art-img');
    this.showcasePlayIcon = document.getElementById('showcase-play-icon');
    this.showcaseTitle = document.getElementById('showcase-title');
    this.showcaseArtist = document.getElementById('showcase-artist');
    this.showcaseModeBadge = document.getElementById('showcase-mode-badge');
    this.showcaseCorsBadge = document.getElementById('showcase-cors-badge');
    this.subtitleOverlay = document.getElementById('subtitle-overlay');
    this.stageAlert = document.getElementById('stage-alert');
    this.hudToggleBtn = document.getElementById('btn-stage-hud-toggle');

    this.auroraEngine = new AuroraEngine();
    this.haloRenderer = new HarmonicHaloRenderer();
    this.prismRenderer = new PrismBarsRenderer();
    this.oscilloscopeRenderer = new OscilloscopeRenderer();
    this.nebulaRenderer = new NebulaWarpRenderer();

    this.ctx2d = this.canvas2d.getContext('2d');
    this.ambiCtx = this.ambilightCanvas.getContext('2d', { willReadFrequently: false });
    this.ambilightCanvas.width = 48;
    this.ambilightCanvas.height = 27;

    this.artworkImgCache = new Image();
    this.currentArtworkUrl = '';
    this.lastAmbilightTime = 0;
    this.lastFrameTime = performance.now();
    this.idleTimer = null;
    this.rafId = 0;
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    audioEngine.attachMediaElement(this.videoEl);
    this.bindEvents();
  }

  bindEvents() {
    this.modeSwitcher.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-viz-mode]');
      if (!btn) return;
      this.actions.setVisualizerSetting('mode', btn.dataset.vizMode);
    });

    this.showcaseArtBtn.addEventListener('click', () => {
      this.actions.togglePlay();
    });

    this.hudToggleBtn.addEventListener('click', () => {
      const { visualizer } = this.getState();
      this.actions.setVisualizerSetting('showTrackHud', !visualizer.showTrackHud);
    });

    this.stageEl.addEventListener('mousemove', () => this.wakeHud());
    this.stageEl.addEventListener('touchstart', () => this.wakeHud(), { passive: true });

    window.addEventListener('resize', () => {
      positionGlider(this.modeSwitcher, this.modeGlider);
    });
  }

  wakeHud() {
    this.stageEl.classList.remove('hud-idle');
    if (this.idleTimer) window.clearTimeout(this.idleTimer);
    if (document.fullscreenElement === this.stageEl || document.fullscreenElement === document.documentElement) {
      this.idleTimer = window.setTimeout(() => {
        if (this.getState().isPlaying) {
          this.stageEl.classList.add('hud-idle');
        }
      }, 2800);
    }
  }

  syncTrackArtwork(artworkUrl) {
    if (!artworkUrl) {
      this.currentArtworkUrl = '';
      this.showcaseArtImg.removeAttribute('src');
      return;
    }
    if (this.currentArtworkUrl === artworkUrl) return;
    this.currentArtworkUrl = artworkUrl;
    this.showcaseArtImg.src = artworkUrl;
    if (artworkUrl.startsWith('http://') || artworkUrl.startsWith('https://')) {
      this.artworkImgCache.crossOrigin = 'anonymous';
    } else {
      this.artworkImgCache.removeAttribute('crossorigin');
    }
    this.artworkImgCache.src = artworkUrl;
  }

  updateUi() {
    const state = this.getState();
    const { currentTrack, isPlaying, visualizer, cues, currentTime, error, isBuffering } = state;
    const isVideo = currentTrack?.kind === 'video';

    // Mode switcher active tab + glider
    const modeButtons = this.modeSwitcher.querySelectorAll('[data-viz-mode]');
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.vizMode === visualizer.mode);
    });
    positionGlider(this.modeSwitcher, this.modeGlider);

    this.hudToggleBtn.innerHTML = icon('eye');
    this.hudToggleBtn.classList.toggle('is-active', visualizer.showTrackHud);

    // Video vs Audio canvas visibility
    this.videoFrame.classList.remove('hidden');
    this.videoFrame.classList.toggle('audio-hidden', !isVideo);
    this.ambilightCanvas.classList.toggle('hidden', !(isVideo && visualizer.videoAmbilight));

    const showGl = !isVideo && visualizer.mode === 'aurora' && !this.auroraEngine.failedWebGl;
    const show2d =
      (!isVideo && (!showGl || visualizer.mode !== 'aurora')) ||
      (isVideo && visualizer.videoOverlay);

    this.glCanvas.classList.toggle('hidden', !showGl);
    this.canvas2d.classList.toggle('hidden', !show2d);

    // Audio Showcase HUD
    const showShowcase = !isVideo && visualizer.showTrackHud && Boolean(currentTrack);
    this.showcaseEl.classList.toggle('hidden', !showShowcase);
    if (currentTrack) {
      this.syncTrackArtwork(currentTrack.artworkUrl || '');
      this.showcaseTitle.textContent = currentTrack.title;
      this.showcaseArtist.textContent = currentTrack.album
        ? `${currentTrack.artist} — ${currentTrack.album}`
        : currentTrack.artist;
      this.showcaseModeBadge.textContent = MODE_LABELS[visualizer.mode] || 'Visualizer';
      this.showcaseCorsBadge.classList.toggle('hidden', !audioEngine.isCorsFallback());
      this.showcaseArtBtn.classList.toggle('is-paused', !isPlaying);
      this.showcasePlayIcon.innerHTML = icon(isPlaying ? 'pause' : 'play');
    }

    // Subtitles overlay
    const activeCue = getActiveSubtitle(cues, currentTime);
    if (activeCue) {
      this.subtitleOverlay.textContent = activeCue.text;
      this.subtitleOverlay.classList.remove('hidden');
    } else {
      this.subtitleOverlay.classList.add('hidden');
    }

    // Error / buffering pill
    if (error) {
      this.stageAlert.textContent = error;
      this.stageAlert.classList.remove('hidden');
    } else if (isBuffering && isPlaying) {
      this.stageAlert.textContent = 'Buffering stream...';
      this.stageAlert.classList.remove('hidden');
    } else {
      this.stageAlert.classList.add('hidden');
    }

    // Mobile tab visibility (keep mounted, pause draw when hidden)
    const isDesktop = window.innerWidth >= 1024;
    const hideStageMobile = !isDesktop && state.mobileTab !== 'stage';
    this.stageEl.classList.toggle('is-mobile-hidden', hideStageMobile);
  }

  isStageDrawable() {
    if (document.hidden) return false;
    if (window.innerWidth < 1024 && this.getState().mobileTab !== 'stage') {
      return false;
    }
    return true;
  }

  drawVideoOverlayStrip(ctx, state) {
    const { width, height, dpr, palette, metrics, intensity } = state;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bars = 48;
    const padX = Math.max(20, width * 0.12);
    const spanW = width - padX * 2;
    const slotW = spanW / bars;
    const barW = Math.max(2, slotW * 0.56);
    const baseY = height - 18;
    const maxH = 54;

    for (let i = 0; i < bars; i++) {
      const idx = Math.floor((i / bars) * (metrics.fft.length * 0.5));
      const val = Math.min(1, ((metrics.fft[idx] || 0) / 255) * (0.7 + intensity * 0.4));
      const h = Math.max(2, val * maxH);
      const x = padX + i * slotW;
      ctx.fillStyle = hexToRgba(palette[i % 3], 0.55);
      ctx.fillRect(x, baseY - h, barW, h);
    }
    ctx.restore();
  }

  start() {
    const tick = (now) => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
      this.lastFrameTime = now;

      if (!this.isStageDrawable()) return;

      const state = this.getState();
      const timeSec = now / 1000;
      const metrics = audioEngine.getAudioMetrics(timeSec, state.isPlaying);
      const rect = this.stageEl.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const isVideo = state.currentTrack?.kind === 'video';
      const renderState = {
        width: rect.width,
        height: rect.height,
        dpr,
        time: timeSec,
        dt,
        palette: state.activePalette,
        metrics,
        intensity: state.visualizer.intensity,
        bloom: state.visualizer.bloom,
        reducedMotion: this.reducedMotionQuery.matches,
        artworkImage: this.artworkImgCache,
      };

      if (isVideo) {
        if (
          state.visualizer.videoAmbilight &&
          this.ambiCtx &&
          this.videoEl.readyState >= 2 &&
          now - this.lastAmbilightTime > 64
        ) {
          this.lastAmbilightTime = now;
          try {
            this.ambiCtx.drawImage(
              this.videoEl,
              0,
              0,
              this.ambilightCanvas.width,
              this.ambilightCanvas.height
            );
          } catch {
            // Ignore cross-origin canvas taint
          }
        }

        if (state.visualizer.videoOverlay && this.ctx2d) {
          const pw = Math.round(rect.width * dpr);
          const ph = Math.round(rect.height * dpr);
          if (this.canvas2d.width !== pw || this.canvas2d.height !== ph) {
            this.canvas2d.width = pw;
            this.canvas2d.height = ph;
          }
          this.drawVideoOverlayStrip(this.ctx2d, renderState);
        }
        return;
      }

      if (state.visualizer.mode === 'aurora') {
        const rendered = this.auroraEngine.renderWebGl(this.glCanvas, renderState);
        if (rendered) return;
      }

      if (!this.ctx2d) return;
      const pw = Math.round(rect.width * dpr);
      const ph = Math.round(rect.height * dpr);
      if (this.canvas2d.width !== pw || this.canvas2d.height !== ph) {
        this.canvas2d.width = pw;
        this.canvas2d.height = ph;
      }

      switch (state.visualizer.mode) {
        case 'aurora':
          this.glCanvas.classList.add('hidden');
          this.canvas2d.classList.remove('hidden');
          this.auroraEngine.renderFallback2d(this.ctx2d, renderState);
          break;
        case 'halo':
          this.haloRenderer.render(this.ctx2d, renderState);
          break;
        case 'prism':
          this.prismRenderer.render(this.ctx2d, renderState);
          break;
        case 'oscilloscope':
          this.oscilloscopeRenderer.render(this.ctx2d, renderState);
          break;
        case 'nebula':
          this.nebulaRenderer.render(this.ctx2d, renderState);
          break;
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }
}
