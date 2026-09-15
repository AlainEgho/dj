export type AudioSourceKind = 'mic' | 'system' | 'file' | 'none';

export interface AudioFrame {
  /** 0..1 smoothed RMS loudness */
  amplitude: number;
  /** 0..1 instantaneous peak */
  peak: number;
  /** 0..1 band energies */
  bass: number;
  mid: number;
  treble: number;
  /** true only on the frame an onset was detected */
  beat: boolean;
  /** 0..1 decaying envelope of the last beat, handy for strobes */
  beatEnvelope: number;
  /** estimated tempo in BPM (0 if unknown) */
  bpm: number;
  /** confidence 0..1 of the bpm estimate */
  bpmConfidence: number;
  /** phase 0..1 within the current beat, derived from bpm + last beat time */
  beatPhase: number;
  /** raw normalized spectrum (0..1 per bin), downsampled */
  spectrum: Float32Array;
  /** ms timestamp of the frame */
  time: number;
}

export interface AudioAnalyzerState {
  source: AudioSourceKind;
  running: boolean;
  error: string | null;
  fileName: string | null;
  /** playback state for file mode */
  playing: boolean;
  duration: number;
  position: number;
  capabilities: {
    mic: boolean;
    system: boolean;
    file: boolean;
  };
}

export interface AudioAnalyzerControls {
  startMic: () => Promise<void>;
  startSystemAudio: () => Promise<void>;
  loadFile: () => Promise<void>;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  stop: () => Promise<void>;
  /** Read the latest analysis frame without re-rendering React. */
  getFrame: () => AudioFrame;
}

export interface AnalyzerOptions {
  /** FFT size. Bins = fftSize / 2, so 1024 gives the requested 512 bins. */
  fftSize?: number;
  /** Number of downsampled spectrum bins exposed to the renderer. */
  spectrumBins?: number;
  /** AnalyserNode smoothing 0..1 */
  smoothing?: number;
}
