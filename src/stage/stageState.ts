/**
 * Single mutable object updated once per rendered frame by <StageDriver>.
 * Scene components read from it inside their own useFrame callbacks, so the
 * audio -> visual mapping happens exactly once per frame with zero React
 * re-renders.
 *
 * Mapping summary:
 *   bass      -> pyro + strobe triggers, LED ripple, light pulse
 *   mid       -> moving-head sweep speed, laser sweep speed
 *   treble    -> laser flicker & colour shift
 *   amplitude -> global brightness / beam intensity
 *   beat/bpm  -> hue cycling, phrase timing for the show director
 */
import * as THREE from 'three';
import type { AudioFrame } from '../audio/types';
import { getAudioFrame, setAudioGenre, setAudioSensitivity } from '../audio/useAudioAnalyzer';
import { getPalette, hslToRgb, type Palette } from '../state/palettes';
import type { StageSettings } from '../state/presets';
import { settingsStore } from '../state/settingsStore';
import { emptyFrame } from '../audio/analysis';
import { director, updateDirector } from './director';

export interface StageState {
  audio: AudioFrame;
  settings: StageSettings;
  palette: Palette;
  /** current base hue 0..1 after beat-driven cycling */
  hue: number;
  saturation: number;
  colorA: THREE.Color;
  colorB: THREE.Color;
  colorC: THREE.Color;
  /** effective global intensity */
  intensity: number;
  /** reactivity multiplier applied to the convenience fields below */
  react: number;
  /** 0.2..1 movement speed multiplier derived from the pacing setting */
  pace: number;
  amp: number;
  bass: number;
  mid: number;
  treble: number;
  beat: boolean;
  beatEnv: number;
  /** seconds since the stage mounted */
  time: number;
  dt: number;
}

export const stage: StageState = {
  audio: emptyFrame(64),
  settings: settingsStore.getSettings(),
  palette: getPalette('tomorrow'),
  hue: 0,
  saturation: 1,
  colorA: new THREE.Color(1, 0, 1),
  colorB: new THREE.Color(0, 1, 1),
  colorC: new THREE.Color(1, 1, 0),
  intensity: 0.8,
  react: 1,
  pace: 0.5,
  amp: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: false,
  beatEnv: 0,
  time: 0,
  dt: 1 / 60,
};

export { director };

let hueOffset = 0;
/** smoothed palette parameters so palette switches glide instead of snapping */
const smooth = { hue: 295, spread: 70, saturation: 1 };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const startMs = nowMs();
let lastUpdateMs = 0;

function setColor(c: THREE.Color, h: number, s: number, l: number) {
  const [r, g, b] = hslToRgb(h, s, l);
  c.setRGB(r, g, b);
}

/**
 * Advance the shared stage state. Uses its own wall clock so that two mounted
 * canvases (e.g. during a screen transition) share one timeline, and it is a
 * no-op when called twice within the same frame.
 */
export function updateStage() {
  const t = nowMs();
  if (t - lastUpdateMs < 4) return;
  const dt = lastUpdateMs === 0 ? 1 / 60 : Math.min(0.1, (t - lastUpdateMs) / 1000);
  lastUpdateMs = t;
  const elapsed = (t - startMs) / 1000;
  const settings = settingsStore.getSettings();
  setAudioSensitivity(settings.sensitivity);
  setAudioGenre(settings.genre);
  const audio = getAudioFrame();
  // Resolve the palette: 'auto' follows the director's rotating pick; the hue,
  // spread and saturation glide toward the target so palette changes crossfade.
  const targetId = settings.paletteId === 'auto' ? director.autoPalette : settings.paletteId;
  let palette = getPalette(targetId);
  if (settings.paletteId === 'custom') palette = { ...palette, hue: settings.customHue };
  const glide = Math.min(1, dt / 2.5);
  let dh = palette.hue - smooth.hue;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  smooth.hue = (((smooth.hue + dh * glide) % 360) + 360) % 360;
  smooth.spread += (palette.spread - smooth.spread) * glide;
  smooth.saturation += (palette.saturation - smooth.saturation) * glide;
  palette = { ...palette, hue: smooth.hue, spread: smooth.spread, saturation: smooth.saturation };

  const react = 0.4 + settings.reactivity * 0.9;
  stage.audio = audio;
  stage.settings = settings;
  stage.palette = palette;
  stage.react = react;
  stage.pace = 0.2 + settings.pacing * 0.8;
  stage.time = elapsed;
  stage.dt = dt;
  stage.amp = clamp01(audio.amplitude * react);
  stage.bass = clamp01(audio.bass * react);
  stage.mid = clamp01(audio.mid * react);
  stage.treble = clamp01(audio.treble * react);
  stage.beat = audio.beat;
  stage.beatEnv = clamp01(audio.beatEnvelope * react);
  stage.intensity = settings.intensity * (0.55 + stage.amp * 0.75);

  updateDirector(
    { amp: stage.amp, bass: stage.bass, beat: audio.beat, bpm: audio.bpm, bpmConfidence: audio.bpmConfidence },
    settings,
    dt,
  );

  // Colour engine: a phase advances with tempo and jumps on each beat; the hue
  // swings around the palette's base hue within its spread so the chosen
  // palette stays recognisable while still cycling to the music.
  const tempo = audio.bpm > 0 ? audio.bpm / 120 : 1;
  hueOffset += dt * settings.hueCycleSpeed * 0.04 * tempo * stage.pace;
  if (audio.beat) hueOffset += settings.hueCycleSpeed * 0.03;
  hueOffset %= 1;

  const spread = palette.spread / 360;
  const swing = Math.sin(hueOffset * Math.PI * 2) * spread * 0.75;
  const baseHue = palette.hue / 360 + swing;
  stage.hue = ((baseHue % 1) + 1) % 1;
  stage.saturation = palette.saturation;
  const l = 0.55 + stage.treble * 0.08;
  setColor(stage.colorA, baseHue, palette.saturation, l);
  setColor(stage.colorB, baseHue + spread, palette.saturation, l);
  setColor(stage.colorC, baseHue - spread * 0.6, palette.saturation, l);
}
