/**
 * Web implementation of the AudioEngine using the browser Web Audio API.
 * Metro resolves this file for web; `createEngine.native.ts` for iOS/Android.
 */
import * as DocumentPicker from 'expo-document-picker';
import type { AudioEngine, EngineCapabilities, EngineOptions, LoadedFile } from './engineTypes';
import type { AudioSourceKind } from './types';

const hasWindow = typeof window !== 'undefined' && typeof navigator !== 'undefined';

function isMacWeb() {
  if (!hasWindow) return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || '';
  return /Mac|iPhone|iPad/.test(platform) || /Mac OS X/.test(nav.userAgent);
}

class WebAudioEngine implements AudioEngine {
  readonly capabilities: EngineCapabilities;
  source: AudioSourceKind = 'none';
  onEvent?: (evt: 'ended' | 'stopped' | 'state') => void;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private streamNode: MediaStreamAudioSourceNode | null = null;
  /** Full getDisplayMedia stream. Video must stay alive on macOS or audio dies. */
  private displayStream: MediaStream | null = null;
  private keepAliveVideo: HTMLVideoElement | null = null;

  // file playback
  private buffer: AudioBuffer | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private startedAt = 0; // ctx.currentTime when playback started
  private offset = 0; // seconds into the buffer when playback started
  private playing = false;

  constructor(private opts: EngineOptions) {
    const md = hasWindow ? navigator.mediaDevices : undefined;
    this.capabilities = {
      mic: !!md?.getUserMedia,
      system: !!(md as MediaDevices | undefined)?.getDisplayMedia,
      file: hasWindow && typeof AudioContext !== 'undefined',
    };
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  get fftSize() {
    return this.opts.fftSize;
  }

  private ensureContext() {
    if (!this.ctx) {
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.opts.fftSize;
      this.analyser.smoothingTimeConstant = this.opts.smoothing;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return { ctx: this.ctx, analyser: this.analyser! };
  }

  private async teardownSource() {
    this.stopBufferSource();
    this.streamNode?.disconnect();
    this.streamNode = null;
    const display = this.displayStream;
    const stream = this.stream;
    this.displayStream = null;
    this.stream = null;
    display?.getTracks().forEach((t) => t.stop());
    stream?.getTracks().forEach((t) => t.stop());
    this.releaseKeepAliveVideo();
    this.buffer = null;
    this.playing = false;
    this.source = 'none';
  }

  private releaseKeepAliveVideo() {
    if (!this.keepAliveVideo) return;
    this.keepAliveVideo.pause();
    this.keepAliveVideo.srcObject = null;
    this.keepAliveVideo.remove();
    this.keepAliveVideo = null;
  }

  /**
   * Chrome on macOS ties tab/system audio to the video capture session.
   * Stopping the video track (the old approach) works on Windows and kills
   * audio on Mac. Keep a hidden <video> playing so the session stays open.
   */
  private retainDisplayVideo(stream: MediaStream) {
    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length || typeof document === 'undefined') return;
    this.releaseKeepAliveVideo();
    const el = document.createElement('video');
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0;z-index:-1';
    el.srcObject = new MediaStream(videoTracks);
    document.body.appendChild(el);
    void el.play().catch(() => {});
    this.keepAliveVideo = el;
  }

  private watchCaptureEnded(stream: MediaStream) {
    stream.getTracks().forEach((t) => {
      t.addEventListener('ended', () => {
        if (this.displayStream === stream || this.stream === stream) {
          void this.teardownSource();
          this.onEvent?.('stopped');
        }
      });
    });
  }

  private attachStream(stream: MediaStream, kind: AudioSourceKind) {
    const { ctx, analyser } = this.ensureContext();
    this.stream = stream;
    this.streamNode = ctx.createMediaStreamSource(stream);
    this.streamNode.connect(analyser);
    this.source = kind;
    this.watchCaptureEnded(stream);
    this.onEvent?.('state');
  }

  async startMic() {
    await this.teardownSource();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    this.attachStream(stream, 'mic');
  }

  async startSystemAudio() {
    await this.teardownSource();
    // getDisplayMedia requires a video track. On Windows, system audio is a
    // separate loopback and survives stopping video. On macOS it does not.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1, width: 16, height: 16 },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false,
      },
      // Chrome 141+ / macOS 14.2+: offer "Share system audio" for screen/window.
      systemAudio: 'include',
      windowAudio: 'system',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    } as DisplayMediaStreamOptions);

    this.displayStream = stream;
    this.retainDisplayVideo(stream);
    this.watchCaptureEnded(stream);

    if (stream.getAudioTracks().length === 0) {
      await this.teardownSource();
      throw new Error(
        isMacWeb()
          ? 'No audio track. On Mac use Chrome: pick Entire Screen or a window and enable “Share system audio” (Chrome 141+). Older Chrome only captures audio from a Chrome tab (“Share tab audio”). Safari cannot capture system audio.'
          : 'No audio track shared. Tick “Share audio” / “Share system audio” in the browser dialog.',
      );
    }
    const audioOnly = new MediaStream(stream.getAudioTracks());
    this.attachStream(audioOnly, 'system');
  }

  async loadFile(): Promise<LoadedFile | null> {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: false, multiple: false });
    if (res.canceled || !res.assets?.[0]) return null;
    const asset = res.assets[0];
    const file = asset.file as File | undefined;
    const arrayBuffer = file ? await file.arrayBuffer() : await (await fetch(asset.uri)).arrayBuffer();

    await this.teardownSource();
    const { ctx, analyser } = this.ensureContext();
    this.buffer = await ctx.decodeAudioData(arrayBuffer);
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.connect(analyser);
      analyser.connect(ctx.destination);
    }
    this.source = 'file';
    this.offset = 0;
    this.onEvent?.('state');
    this.play();
    return { name: asset.name, duration: this.buffer.duration };
  }

  private stopBufferSource() {
    if (this.bufferSource) {
      this.bufferSource.onended = null;
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
    const { ctx } = this.ensureContext();
    this.stopBufferSource();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain!);
    if (this.offset >= this.buffer.duration) this.offset = 0;
    src.start(0, this.offset);
    this.startedAt = ctx.currentTime;
    this.playing = true;
    src.onended = () => {
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
    this.analyser.getByteFrequencyData(freq as Uint8Array<ArrayBuffer>);
    this.analyser.getFloatTimeDomainData(time as Float32Array<ArrayBuffer>);
    return true;
  }

  private recordDest: MediaStreamAudioDestinationNode | null = null;

  /** Everything the analyser hears, as a MediaStream for MediaRecorder. */
  getRecordingAudioStream(): MediaStream | null {
    const { ctx, analyser } = this.ensureContext();
    if (!this.recordDest) {
      this.recordDest = ctx.createMediaStreamDestination();
      // the analyser sits after every source (mic, system, file), so tapping it
      // records whatever is driving the show without changing what the
      // speakers play
      analyser.connect(this.recordDest);
    }
    return this.recordDest.stream;
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
  }
}

export function createEngine(opts: EngineOptions): AudioEngine {
  return new WebAudioEngine(opts);
}
