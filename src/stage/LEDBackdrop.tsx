import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from './fiber';
import { ledFragment, ledVertex } from './shaders';
import { director, stage } from './stageState';
import { splitWords } from './director';
import { rasterizeText } from './pixelFont';
import { useSettings } from '../state/settingsStore';
import { WALL_SHAPE_COUNT, type WallMode } from '../state/presets';

const BINS = 64;
const MODE_INDEX = { spectrum: 0, shapes: 1, text: 2, heatmap: 3 } as const;
/** rows of spectrum history kept for the heat map (about 8s at ~8 rows/s) */
const HISTORY_ROWS = 64;
const HISTORY_INTERVAL = 0.12;
/** in forced Text mode, swap to another random word this often (seconds) */
const FORCED_TEXT_ROTATE = 8;
/** a word is on the wall for at most this long (type-in included) before it fades */
const WORD_LIFETIME = 5;
const WORD_FADE = 0.8;

function resolveMode(wallMode: WallMode, hasText: boolean): number {
  if (wallMode === 'spectrum') return 0;
  if (wallMode === 'heatmap') return 3;
  if (wallMode === 'shapes') return 1;
  if (wallMode === 'text') return hasText ? 2 : 1;
  const auto = director.wallContent;
  if (auto === 'text' && !hasText) return 1;
  return MODE_INDEX[auto];
}

type TextTexture = THREE.DataTexture & { px: number; glyphs: number; word: string };

function makeTextTexture(word: string): TextTexture {
  const raster = rasterizeText(word || ' ');
  const t = new THREE.DataTexture(raster.data, raster.width, raster.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return Object.assign(t, { px: raster.width, glyphs: raster.length, word });
}

/**
 * Giant LED wall behind the stage. Content is one of: mirrored spectrum,
 * slow cinematic shapes, or pixel-font text picked at random from the
 * comma-separated word list. Modes crossfade over ~1.2s and the director can
 * dim the wall to black for laser-only moments.
 */
export function LEDBackdrop() {
  const settings = useSettings();
  const words = useMemo(() => splitWords(settings.wallText), [settings.wallText]);

  const { spectrumTex, spectrumData, historyTex, historyData } = useMemo(() => {
    const d = new Uint8Array(BINS * 4);
    const t = new THREE.DataTexture(d, BINS, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    // ring buffer of past spectra for the heat map: one row per HISTORY_INTERVAL
    const hd = new Uint8Array(BINS * HISTORY_ROWS * 4);
    const ht = new THREE.DataTexture(hd, BINS, HISTORY_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    ht.magFilter = THREE.LinearFilter;
    ht.minFilter = THREE.LinearFilter;
    ht.wrapT = THREE.RepeatWrapping;
    ht.generateMipmaps = false;
    ht.needsUpdate = true;
    return { spectrumTex: t, spectrumData: d, historyTex: ht, historyData: hd };
  }, []);

  const textTex = useRef<TextTexture>(makeTextTexture(' '));

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ledVertex,
        fragmentShader: ledFragment,
        uniforms: {
          uSpectrum: { value: spectrumTex },
          uHistory: { value: historyTex },
          uHistRow: { value: 0 },
          uText: { value: textTex.current },
          uTextPx: { value: textTex.current.px },
          uTextLen: { value: textTex.current.glyphs },
          uReveal: { value: 1 },
          uTextFade: { value: 1 },
          uTime: { value: 0 },
          uBass: { value: 0 },
          uAmp: { value: 0 },
          uBeat: { value: 0 },
          uIntensity: { value: 1 },
          uWall: { value: 1 },
          uHue: { value: 0 },
          uSat: { value: 1 },
          uPace: { value: 0.5 },
          uModeA: { value: 0 },
          uModeB: { value: 0 },
          uBlend: { value: 0 },
          uShapeA: { value: 0 },
          uShapeB: { value: 0 },
          uGrid: { value: new THREE.Vector2(80, 40) },
        },
      }),
    [spectrumTex],
  );

  const geometry = useMemo(() => new THREE.PlaneGeometry(28, 14), []);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
      spectrumTex.dispose();
      historyTex.dispose();
      textTex.current.dispose();
    },
    [material, geometry, spectrumTex, historyTex],
  );

  /** Swap the displayed word; rebuilds the texture only when it changes. */
  const showWord = (word: string, now: number) => {
    if (textTex.current.word === word) return;
    textTex.current.dispose();
    textTex.current = makeTextTexture(word);
    material.uniforms.uText.value = textTex.current;
    material.uniforms.uTextPx.value = textTex.current.px;
    material.uniforms.uTextLen.value = textTex.current.glyphs;
    fade.current.shownSince = now;
  };

  // crossfade bookkeeping
  const fade = useRef({
    modeA: 0,
    shapeA: 0,
    modeB: 0,
    shapeB: 0,
    blend: 1,
    shownSince: 0,
    lastRotate: 0,
    forcedIndex: 0,
    histRow: 0,
    histLast: 0,
  });

  useFrame(() => {
    const s = stage;
    const wallOn = s.settings.ledEnabled && s.settings.wallMode !== 'off';
    material.visible = wallOn;
    if (!wallOn) return;

    const spec = s.audio.spectrum;
    const n = Math.min(BINS, spec.length);
    for (let i = 0; i < n; i++) {
      const v = Math.min(255, Math.round(Math.pow(spec[i], 0.8) * 255 * s.react));
      const o = i * 4;
      spectrumData[o] = spectrumData[o + 1] = spectrumData[o + 2] = v;
      spectrumData[o + 3] = 255;
    }
    spectrumTex.needsUpdate = true;

    const f = fade.current;
    // Heat map history: copy the current spectrum row into the ring buffer at a fixed rate
    if (s.time - f.histLast >= HISTORY_INTERVAL) {
      f.histLast = s.time;
      f.histRow = (f.histRow + 1) % HISTORY_ROWS;
      historyData.set(spectrumData, f.histRow * BINS * 4);
      historyTex.needsUpdate = true;
      material.uniforms.uHistRow.value = (f.histRow + 0.5) / HISTORY_ROWS;
    }
    const hasText = words.length > 0;
    const wantMode = resolveMode(s.settings.wallMode, hasText);
    const wantShape = s.settings.wallMode === 'shapes' ? s.settings.wallShape : director.shape;

    // Which word to show: the director's pick in Auto, a rotating random pick in forced Text mode.
    if (hasText) {
      if (s.settings.wallMode === 'text') {
        if (s.time - f.lastRotate > FORCED_TEXT_ROTATE || f.lastRotate === 0) {
          f.lastRotate = s.time;
          if (words.length > 1) {
            let next = Math.floor(Math.random() * words.length);
            if (next === f.forcedIndex) next = (next + 1) % words.length;
            f.forcedIndex = next;
          } else f.forcedIndex = 0;
          f.shownSince = s.time; // re-type even if the same word comes back
        }
        showWord(words[f.forcedIndex], s.time);
      } else {
        showWord(words[Math.min(director.textIndex, words.length - 1)], s.time);
      }
    }

    const targetChanged = f.blend >= 1 && (wantMode !== f.modeB || (wantMode === 1 && wantShape !== f.shapeB));
    if (targetChanged) {
      f.modeA = f.modeB;
      f.shapeA = f.shapeB;
      f.modeB = wantMode;
      f.shapeB = wantShape;
      f.blend = 0;
      f.shownSince = s.time;
    }
    if (f.blend < 1) f.blend = Math.min(1, f.blend + s.dt / 1.2);

    const u = material.uniforms;
    u.uModeA.value = f.modeA;
    u.uModeB.value = f.modeB;
    u.uShapeA.value = f.shapeA;
    u.uShapeB.value = f.shapeB;
    u.uBlend.value = f.blend;
    // Type the word in one letter at a time, but never slower than "whole word
    // in ~2s", hold, then fade it out so no word stays longer than WORD_LIFETIME.
    const glyphs = Math.max(1, textTex.current.glyphs);
    const perLetter = Math.min(0.45 - s.pace * 0.2, 2.0 / glyphs);
    const age = s.time - f.shownSince;
    u.uReveal.value = Math.min(1, age / (perLetter * glyphs) + 0.5 / glyphs);
    const textShowing = f.modeB === 2 && f.blend > 0;
    if (textShowing) {
      u.uTextFade.value = 1 - Math.min(1, Math.max(0, (age - (WORD_LIFETIME - WORD_FADE)) / WORD_FADE));
      // once faded, hand the wall back to shapes in Auto mode
      if (age > WORD_LIFETIME && s.settings.wallMode === 'auto' && director.wallContent === 'text') {
        director.wallContent = 'shapes';
        director.shape = (director.shape + 1) % WALL_SHAPE_COUNT;
      }
    } else {
      u.uTextFade.value = 1;
    }

    u.uTime.value = s.time;
    u.uPace.value = s.pace;
    u.uBass.value = s.bass;
    u.uAmp.value = s.amp;
    const beat = Number.isFinite(s.beatEnv) ? s.beatEnv : 0;
    u.uBeat.value = beat;
    // keep a readable floor whenever the director has the wall in at all;
    // laser looks used to sit at 0.2 and the panel read as off
    const wallOnStage = director.wall > 0.02 ? Math.max(director.wall, 0.62) : 0;
    u.uIntensity.value = (0.5 + s.settings.intensity * 0.7) * (1 + beat * 0.2);
    u.uWall.value = wallOnStage * (1 - director.blackout);
    u.uHue.value = s.hue;
    u.uSat.value = s.saturation;
  });

  return <mesh geometry={geometry} material={material} position={[0, 6.6, -9]} />;
}
