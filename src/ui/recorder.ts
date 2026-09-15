/**
 * Screen recorder (web): captures the stage canvas at 60fps together with the
 * audio driving the show, via MediaRecorder, and hands the viewer a .webm file.
 * Module singleton so the control bar and the keyboard share one recorder.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { getRecordingAudioStream } from '../audio/useAudioAnalyzer';

export interface RecorderState {
  supported: boolean;
  recording: boolean;
  /** seconds recorded so far */
  seconds: number;
  error: string | null;
  lastFileName: string | null;
}

type Listener = () => void;

const hasWeb = Platform.OS === 'web' && typeof window !== 'undefined';
const supported =
  hasWeb &&
  typeof MediaRecorder !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  'captureStream' in HTMLCanvasElement.prototype;

let state: RecorderState = { supported, recording: false, seconds: 0, error: null, lastFileName: null };
const listeners = new Set<Listener>();
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;
let canvasStream: MediaStream | null = null;

function set(partial: Partial<RecorderState>) {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

/**
 * Prefer MP4 with H.264 + AAC (plays everywhere, phones included); fall back
 * to WebM where the browser cannot mux MP4 (Firefox).
 */
function pickMime(): { mime: string; ext: string } {
  const candidates: [string, string][] = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'], // H.264 High 4.0 + AAC
    ['video/mp4;codecs=avc1.4D4028,mp4a.40.2', 'mp4'], // H.264 Main 4.0 + AAC
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], // H.264 Baseline + AAC
    ['video/mp4;codecs=avc1,opus', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];
  const found = candidates.find(([m]) => MediaRecorder.isTypeSupported(m));
  return found ? { mime: found[0], ext: found[1] } : { mime: '', ext: 'webm' };
}

function stamp() {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function startRecording(): string {
  if (!supported) {
    set({ error: 'Recording needs a desktop browser (Chrome, Edge or Firefox).' });
    return 'Recording not supported here';
  }
  if (state.recording) return 'Already recording';
  const canvas = document.querySelector('canvas');
  if (!canvas) {
    set({ error: 'No stage canvas on this screen.' });
    return 'No stage to record';
  }
  try {
    canvasStream = canvas.captureStream(60);
    const audio = getRecordingAudioStream();
    const tracks = [...canvasStream.getVideoTracks(), ...(audio ? audio.getAudioTracks() : [])];
    const mixed = new MediaStream(tracks);
    const { mime, ext } = pickMime();
    recorder = new MediaRecorder(mixed, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || (ext === 'mp4' ? 'video/mp4' : 'video/webm') });
      const name = `stage-${stamp()}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      canvasStream?.getTracks().forEach((t) => t.stop());
      canvasStream = null;
      recorder = null;
      set({ recording: false, lastFileName: name });
    };
    // if the canvas unmounts (screen change) the video track ends: finalize
    canvasStream.getVideoTracks()[0]?.addEventListener('ended', () => stopRecording());
    recorder.start(1000);
    startedAt = Date.now();
    if (timer) clearInterval(timer);
    timer = setInterval(() => set({ seconds: Math.floor((Date.now() - startedAt) / 1000) }), 500);
    set({ recording: true, seconds: 0, error: null });
    return audio ? `Recording ${ext.toUpperCase()} with sound` : `Recording ${ext.toUpperCase()} (no audio source yet)`;
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
    return 'Recording failed';
  }
}

export function stopRecording(): string {
  if (!recorder || recorder.state === 'inactive') return 'Not recording';
  if (timer) clearInterval(timer);
  timer = null;
  recorder.stop();
  return 'Saved recording';
}

export function toggleRecording(): string {
  return state.recording ? stopRecording() : startRecording();
}

export function useRecorder(): RecorderState {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  // stop cleanly if the page is closed mid-recording
  useEffect(() => {
    if (!hasWeb) return;
    const onUnload = () => stopRecording();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);
  return s;
}
