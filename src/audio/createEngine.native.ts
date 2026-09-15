/**
 * iOS / Android implementation of the AudioEngine using react-native-audio-api,
 * which mirrors the Web Audio API (AudioContext, AnalyserNode, ...) natively.
 * Microphone input flows: AudioRecorder -> RecorderAdapterNode -> AnalyserNode.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import {
  AnalyserNode,
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioManager,
  AudioRecorder,
  GainNode,
  RecorderAdapterNode,
} from 'react-native-audio-api';
import type { AudioEngine, EngineCapabilities, EngineOptions, LoadedFile } from './engineTypes';
import type { AudioSourceKind } from './types';

class NativeAudioEngine implements AudioEngine {
  readonly capabilities: EngineCapabilities = { mic: true, system: false, file: true };
  source: AudioSourceKind = 'none';
  onEvent?: (evt: 'ended' | 'stopped' | 'state') => void;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;

  private recorder: AudioRecorder | null = null;
  private adapter: RecorderAdapterNode | null = null;

  private buffer: AudioBuffer | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private playing = false;
  private sessionConfigured = false;

  constructor(private opts: EngineOptions) {}

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  get fftSize() {
    return this.opts.fftSize;
  }

  private async configureSession(recording: boolean) {
    // On iOS the session category decides whether the mic is available and
    // whether we play through the speaker. Reconfigure when switching modes.
    if (Platform.OS === 'ios') {
      AudioManager.setAudioSessionOptions({
        iosCategory: recording ? 'playAndRecord' : 'playback',
        iosMode: recording ? 'measurement' : 'default',
        iosOptions: recording ? ['defaultToSpeaker', 'allowBluetoothA2DP', 'mixWithOthers'] : ['mixWithOthers'],
      });
    }
    if (!this.sessionConfigured) {
      await AudioManager.setAudioSessionActivity(true).catch(() => {});
      this.sessionConfigured = true;
    }
  }

  private ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.opts.fftSize;
      this.analyser.smoothingTimeConstant = this.opts.smoothing;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
      this.gain = this.ctx.createGain();
      this.gain.connect(this.analyser);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return { ctx: this.ctx, analyser: this.analyser!, gain: this.gain! };
  }

  private async teardownSource() {
    this.stopBufferSource();
    if (this.recorder) {
      try {
        await this.recorder.stop();
      } catch {
        /* not recording */
      }
      this.recorder.disconnect();
      this.recorder = null;
    }
    if (this.adapter) {
      this.adapter.disconnect();
      this.adapter = null;
    }
    // Analyser only feeds the speakers in file mode
    if (this.analyser && this.ctx && this.source === 'file') {
      try {
        this.analyser.disconnect(this.ctx.destination);
      } catch {
        /* not connected */
      }
    }
    this.buffer = null;
    this.playing = false;
    this.source = 'none';
  }

  async startMic() {
    await this.teardownSource();
    const status = await AudioManager.requestRecordingPermissions();
    if (status !== 'Granted') throw new Error('Microphone permission was denied.');
    await this.configureSession(true);
    const { ctx, gain } = this.ensureContext();

    // Each RecorderAdapterNode can be connected to a recorder only once, so
    // create fresh instances every time we start.
    this.adapter = ctx.createRecorderAdapter();
    this.adapter.connect(gain);
    this.recorder = new AudioRecorder();
    this.recorder.onError((err) => {
      console.warn('[audio] recorder error', err);
    });
    this.recorder.connect(this.adapter);
    const result = await this.recorder.start();
    if (result && 'status' in (result as object) && (result as { status?: string }).status === 'error') {
      throw new Error('Could not start the microphone.');
    }
    this.source = 'mic';
    this.onEvent?.('state');
  }

  async startSystemAudio() {
    throw new Error('System audio capture is not available on this platform. Use the microphone or load a track.');
  }

  async loadFile(): Promise<LoadedFile | null> {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.[0]) return null;
    const asset = res.assets[0];

    await this.teardownSource();
    await this.configureSession(false);
    const { ctx, analyser } = this.ensureContext();
    this.buffer = await ctx.decodeAudioData(asset.uri);
    analyser.connect(ctx.destination);
    this.source = 'file';
    this.offset = 0;
    this.onEvent?.('state');
    this.play();
    return { name: asset.name, duration: this.buffer.duration };
  }

  private stopBufferSource() {
    if (this.bufferSource) {
      this.bufferSource.onEnded = null;
      try {
        this.bufferSource.stop();
      } catch {
        /* already stopped */
      }
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }
  }

  play() {
    if (!this.buffer || this.playing) return;
    const { ctx, gain } = this.ensureContext();
    this.stopBufferSource();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(gain);
    if (this.offset >= this.buffer.duration) this.offset = 0;
    src.start(ctx.currentTime, this.offset);
    this.startedAt = ctx.currentTime;
    this.playing = true;
    src.onEnded = () => {
      if (this.bufferSource !== src) return;
      this.playing = false;
      this.offset = 0;
      this.bufferSource = null;
      this.onEvent?.('ended');
    };
    this.bufferSource = src;
    this.onEvent?.('state');
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.getPosition();
    this.stopBufferSource();
    this.playing = false;
    this.onEvent?.('state');
  }

  seek(seconds: number) {
    if (!this.buffer) return;
    const wasPlaying = this.playing;
    this.stopBufferSource();
    this.playing = false;
    this.offset = Math.max(0, Math.min(this.buffer.duration, seconds));
    if (wasPlaying) this.play();
    else this.onEvent?.('state');
  }

  isPlaying() {
    return this.playing;
  }

  getPosition() {
    if (!this.buffer) return 0;
    if (!this.playing || !this.ctx) return this.offset;
    return Math.min(this.buffer.duration, this.offset + (this.ctx.currentTime - this.startedAt));
  }

  getDuration() {
    return this.buffer?.duration ?? 0;
  }

  read(freq: Uint8Array, time: Float32Array): boolean {
    if (!this.analyser || this.source === 'none') return false;
    if (this.source === 'file' && !this.playing) return false;
    this.analyser.getByteFrequencyData(freq);
    this.analyser.getFloatTimeDomainData(time);
    return true;
  }

  async stop() {
    await this.teardownSource();
    this.onEvent?.('stopped');
  }

  async dispose() {
    await this.teardownSource();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.gain = null;
    if (this.sessionConfigured) {
      await AudioManager.setAudioSessionActivity(false).catch(() => {});
      this.sessionConfigured = false;
    }
  }
}

export function createEngine(opts: EngineOptions): AudioEngine {
  return new NativeAudioEngine(opts);
}
