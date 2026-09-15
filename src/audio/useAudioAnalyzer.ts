/**
 * `useAudioAnalyzer()` — one hook for every platform.
 *
 * A module-level singleton owns the platform engine and the feature extractor
 * so audio keeps running while the user navigates between screens (stage,
 * settings, projection). React components subscribe to the coarse state
 * (source, playing, error...) while the render loop pulls per-frame features
 * through `getFrame()` without causing re-renders.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { FeatureExtractor, emptyFrame } from './analysis';
import { createEngine } from './createEngine';
import type { AudioEngine } from './engineTypes';
import type { AnalyzerOptions, AudioAnalyzerControls, AudioAnalyzerState, AudioFrame } from './types';

const DEFAULTS: Required<AnalyzerOptions> = {
  fftSize: 1024, // 512 bins
  spectrumBins: 64,
  smoothing: 0.75,
};

type Listener = () => void;

class AudioAnalyzer {
  private engine: AudioEngine;
  private extractor: FeatureExtractor;
  private freq: Uint8Array;
  private time: Float32Array;
  private frame: AudioFrame;
  private lastProcess = 0;
  private listeners = new Set<Listener>();
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private state: AudioAnalyzerState;

  constructor(private opts: Required<AnalyzerOptions>) {
    this.engine = createEngine({ fftSize: opts.fftSize, smoothing: opts.smoothing });
    const bins = opts.fftSize / 2;
    this.freq = new Uint8Array(bins);
    this.time = new Float32Array(opts.fftSize);
    this.extractor = new FeatureExtractor(bins, this.engine.sampleRate, opts.fftSize, opts.spectrumBins);
    this.frame = emptyFrame(opts.spectrumBins);
    this.state = {
      source: 'none',
      running: false,
      error: null,
      fileName: null,
      playing: false,
      duration: 0,
      position: 0,
      capabilities: this.engine.capabilities,
    };
    this.engine.onEvent = (evt) => {
      if (evt === 'ended') this.extractor.reset();
      this.syncFromEngine();
    };
  }

  // ---- store plumbing ----------------------------------------------------
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getState = () => this.state;

  private set(partial: Partial<AudioAnalyzerState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  private syncFromEngine(extra: Partial<AudioAnalyzerState> = {}) {
    const source = this.engine.source;
    const playing = this.engine.isPlaying();
    this.set({
      source,
      running: source !== 'none' && (source !== 'file' || playing),
      playing,
      duration: this.engine.getDuration(),
      position: this.engine.getPosition(),
      fileName: source === 'file' ? this.state.fileName : null,
      ...extra,
    });
    this.managePositionTimer();
  }

  private managePositionTimer() {
    const want = this.state.source === 'file' && this.state.playing;
    if (want && !this.positionTimer) {
      this.positionTimer = setInterval(() => this.set({ position: this.engine.getPosition() }), 500);
    } else if (!want && this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
  }

  private async guard(fn: () => Promise<void>) {
    try {
      this.set({ error: null });
      await fn();
      this.extractor.setSampleRate(this.engine.sampleRate, this.opts.fftSize);
      this.extractor.reset();
      this.syncFromEngine();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.syncFromEngine({ error: message });
    }
  }

  // ---- controls ----------------------------------------------------------
  private sensitivity = -1;
  setSensitivity = (v: number) => {
    if (v === this.sensitivity) return;
    this.sensitivity = v;
    this.extractor.setSensitivity(v);
  };
  startMic = () => this.guard(() => this.engine.startMic());
  startSystemAudio = () => this.guard(() => this.engine.startSystemAudio());
  loadFile = () =>
    this.guard(async () => {
      const file = await this.engine.loadFile();
      if (file) this.set({ fileName: file.name, duration: file.duration });
    });
  play = () => {
    this.engine.play();
    this.syncFromEngine();
  };
  pause = () => {
    this.engine.pause();
    this.syncFromEngine();
  };
  seek = (s: number) => {
    this.engine.seek(s);
    this.syncFromEngine();
  };
  stop = () =>
    this.guard(async () => {
      await this.engine.stop();
      this.frame = emptyFrame(this.opts.spectrumBins);
    });

  /**
   * Called by the render loop. Processes at most once per ~4ms so multiple
   * readers within the same frame share one result.
   */
  getFrame = (): AudioFrame => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastProcess < 4) return this.frame;
    this.lastProcess = now;
    if (this.engine.read(this.freq, this.time)) {
      this.frame = this.extractor.process(this.freq, this.time, now);
    } else if (this.frame.amplitude > 0.001 || this.frame.beatEnvelope > 0.001) {
      // decay gracefully to silence when the source stops
      const f = this.frame;
      this.frame = {
        ...f,
        amplitude: f.amplitude * 0.9,
        bass: f.bass * 0.9,
        mid: f.mid * 0.9,
        treble: f.treble * 0.9,
        beat: false,
        beatEnvelope: f.beatEnvelope * 0.85,
        time: now,
      };
    }
    return this.frame;
  };
}

let singleton: AudioAnalyzer | null = null;
function getAnalyzer() {
  if (!singleton) singleton = new AudioAnalyzer(DEFAULTS);
  return singleton;
}

/** Non-hook accessor for render loops / three.js components. */
export const getAudioFrame = (): AudioFrame => getAnalyzer().getFrame();

/** 0..1 input sensitivity (beat threshold + gain floor). Cheap to call every frame. */
export const setAudioSensitivity = (v: number) => getAnalyzer().setSensitivity(v);

export function useAudioAnalyzer(): { state: AudioAnalyzerState; controls: AudioAnalyzerControls } {
  const analyzer = getAnalyzer();
  const state = useSyncExternalStore(analyzer.subscribe, analyzer.getState, analyzer.getState);
  const controls = useMemo<AudioAnalyzerControls>(
    () => ({
      startMic: analyzer.startMic,
      startSystemAudio: analyzer.startSystemAudio,
      loadFile: analyzer.loadFile,
      play: analyzer.play,
      pause: analyzer.pause,
      seek: analyzer.seek,
      stop: analyzer.stop,
      getFrame: analyzer.getFrame,
    }),
    [analyzer],
  );
  // Keep the extractor warm while any consumer is mounted even if the stage
  // is not rendering (e.g. the settings screen), so BPM tracking continues.
  useEffect(() => {
    const id = setInterval(() => {
      if (renderLoops === 0) analyzer.getFrame();
    }, 1000 / 30);
    return () => clearInterval(id);
  }, [analyzer]);
  return { state, controls };
}

let renderLoops = 0;
/** The 3D stage registers itself so the fallback timer stays idle while it drives analysis. */
export function useRegisterRenderLoop() {
  useEffect(() => {
    renderLoops++;
    return () => {
      renderLoops--;
    };
  }, []);
}
