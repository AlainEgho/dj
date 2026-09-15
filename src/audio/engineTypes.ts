import type { AudioSourceKind } from './types';

export interface EngineCapabilities {
  mic: boolean;
  system: boolean;
  file: boolean;
}

export interface LoadedFile {
  name: string;
  duration: number;
}

/**
 * Platform-specific audio graph. The engine owns an AudioContext-like object
 * and an AnalyserNode; the shared feature extractor only ever sees the raw
 * analyser buffers via `read()`.
 */
export interface AudioEngine {
  readonly capabilities: EngineCapabilities;
  readonly source: AudioSourceKind;
  readonly sampleRate: number;
  readonly fftSize: number;
  /** invoked when a file finishes playing or a live stream ends */
  onEvent?: (evt: 'ended' | 'stopped' | 'state') => void;

  startMic(): Promise<void>;
  startSystemAudio(): Promise<void>;
  loadFile(): Promise<LoadedFile | null>;

  play(): void;
  pause(): void;
  seek(seconds: number): void;
  isPlaying(): boolean;
  getPosition(): number;
  getDuration(): number;

  /** Fill the analyser buffers. Returns false when no source is active. */
  read(freq: Uint8Array, time: Float32Array): boolean;
  /**
   * A MediaStream carrying whatever the analyser hears (track, mic or system
   * audio), for screen recording. Null where the platform cannot provide one.
   */
  getRecordingAudioStream?(): MediaStream | null;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface EngineOptions {
  fftSize: number;
  smoothing: number;
}
