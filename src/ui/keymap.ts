/**
 * Keyboard map: one table shared by the key handler and the settings screen.
 * Every binding runs against the settings store or the show director and
 * returns a short label for the on-screen toast.
 */
import { CUES, GENRES, LASER_COLORS, RIG_STYLES, WALL_SHAPES, WALL_SHAPE_COUNT, type StageSettings } from '../state/presets';
import { PALETTES } from '../state/palettes';
import { settingsStore } from '../state/settingsStore';
import { triggerDrop } from '../stage/director';
import { toggleRecording } from './recorder';

const PALETTES_ORDER = PALETTES.map((p) => p.id);

export interface KeyBinding {
  key: string;
  shift?: boolean;
  /** what the key does, for the cheat sheet */
  label: string;
  group: 'Cues' | 'Elements' | 'Laser groups' | 'Wall' | 'Colour' | 'Levels' | 'Live';
  /** true = keyup matters too (hold behaviour) */
  hold?: boolean;
  run: (down: boolean) => string;
}

const get = () => settingsStore.getSettings();
const set = (p: Partial<StageSettings>) => settingsStore.update(p);
const toggle = (k: keyof StageSettings, name: string) => () => {
  const v = !get()[k];
  set({ [k]: v } as Partial<StageSettings>);
  return `${name} ${v ? 'ON' : 'OFF'}`;
};
const nudge = (k: 'intensity' | 'pacing' | 'reactivity' | 'sensitivity' | 'hueCycleSpeed', delta: number, name: string) => () => {
  const v = Math.round(Math.min(1, Math.max(0, (get()[k] as number) + delta)) * 100) / 100;
  set({ [k]: v } as Partial<StageSettings>);
  return `${name} ${Math.round(v * 100)}%`;
};
const cycle =
  <T extends string>(k: keyof StageSettings, values: readonly T[], name: string, dir = 1, labels?: Record<string, string>) =>
  () => {
    const cur = get()[k] as T;
    const i = values.indexOf(cur);
    const next = values[(i + dir + values.length) % values.length];
    set({ [k]: next } as Partial<StageSettings>);
    return `${name}: ${labels?.[next] ?? next}`;
  };

const cueKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '='];
const cueBindings: KeyBinding[] = CUES.map((c, i) => ({
  key: cueKeys[i],
  label: c.label,
  group: 'Cues',
  run: () => {
    set({ cue: c.id });
    return `Cue: ${c.label}`;
  },
}));

const LASER_COLOR_IDS = LASER_COLORS.map((c) => c.id);
const LASER_COLOR_LABELS = Object.fromEntries(LASER_COLORS.map((c) => [c.id, c.label]));
const SHOW_MODES = ['chill', 'festival', 'rave'] as const;

/**
 * Shift + a number jumps straight to a palette. The plain number keys are cues,
 * so the shifted symbols (!, @, #, ...) are what the browser actually reports.
 */
const SHIFT_DIGITS = ['!', '@', '#', '$', '%', '^', '&', '*'];
const PALETTE_KEYS: KeyBinding[] = PALETTES.slice(0, SHIFT_DIGITS.length).map((p, i) => ({
  key: SHIFT_DIGITS[i],
  shift: true,
  label: `Palette: ${p.name}`,
  group: 'Colour',
  run: () => {
    set({ paletteId: p.id });
    return `Palette: ${p.name}`;
  },
}));

export const KEYMAP: KeyBinding[] = [
  ...cueBindings,

  { key: 'l', label: 'Lasers on/off', group: 'Elements', run: toggle('lasersEnabled', 'Lasers') },
  { key: 'b', label: 'Moving heads on/off', group: 'Elements', run: toggle('beamsEnabled', 'Beams') },
  { key: 's', label: 'Strobes on/off', group: 'Elements', run: toggle('strobeEnabled', 'Strobes') },
  { key: 'p', label: 'Pyro on/off', group: 'Elements', run: toggle('pyroEnabled', 'Pyro') },
  { key: 'w', label: 'LED wall on/off', group: 'Elements', run: toggle('ledEnabled', 'Wall') },
  { key: 'h', label: 'Haze on/off', group: 'Elements', run: toggle('hazeEnabled', 'Haze') },
  { key: 'd', label: 'Auto cues on/off', group: 'Elements', run: toggle('autoCues', 'Auto cues') },
  {
    key: 'r',
    label: 'Cycle rig style',
    group: 'Elements',
    run: cycle('rigStyle', RIG_STYLES.map((r) => r.id), 'Rig'),
  },
  {
    key: 'm',
    label: 'Cycle music profile (trance / techno / house)',
    group: 'Elements',
    run: cycle('genre', GENRES.map((g) => g.id), 'Music'),
  },
  { key: 'j', label: 'Cycle show mode', group: 'Elements', run: () => {
    const cur = get().showMode;
    const i = SHOW_MODES.indexOf(cur as (typeof SHOW_MODES)[number]);
    const next = SHOW_MODES[(i + 1) % SHOW_MODES.length];
    settingsStore.applyShowMode(next);
    return `Show mode: ${next}`;
  } },

  { key: 'z', label: 'Top centre lasers', group: 'Laser groups', run: () => (set({ laserGroup: 'topMiddle' }), 'Lasers: top centre') },
  { key: 'x', label: 'Top row lasers', group: 'Laser groups', run: () => (set({ laserGroup: 'top' }), 'Lasers: top row') },
  { key: 'c', label: 'Bottom centre lasers', group: 'Laser groups', run: () => (set({ laserGroup: 'bottomMiddle' }), 'Lasers: bottom centre') },
  { key: 'v', label: 'Bottom row lasers', group: 'Laser groups', run: () => (set({ laserGroup: 'bottom' }), 'Lasers: bottom row') },
  { key: 'n', label: 'All lasers', group: 'Laser groups', run: () => (set({ laserGroup: 'all' }), 'Lasers: all') },
  { key: 'g', label: 'Laser group back to auto', group: 'Laser groups', run: () => (set({ laserGroup: 'auto' }), 'Lasers: auto groups') },

  { key: 'u', label: 'Wall: auto', group: 'Wall', run: () => (set({ wallMode: 'auto' }), 'Wall: auto') },
  { key: 'i', label: 'Wall: spectrum', group: 'Wall', run: () => (set({ wallMode: 'spectrum' }), 'Wall: spectrum') },
  { key: 'o', label: 'Wall: heat map', group: 'Wall', run: () => (set({ wallMode: 'heatmap' }), 'Wall: heat map') },
  { key: 'k', label: 'Wall: shapes', group: 'Wall', run: () => (set({ wallMode: 'shapes' }), 'Wall: shapes') },
  { key: 't', label: 'Wall: text', group: 'Wall', run: () => (set({ wallMode: 'text' }), 'Wall: text') },
  { key: 'e', label: 'Wall off', group: 'Wall', run: () => (set({ wallMode: 'off' }), 'Wall: off') },
  {
    key: '[',
    label: 'Previous shape',
    group: 'Wall',
    run: () => {
      const n = (get().wallShape - 1 + WALL_SHAPE_COUNT) % WALL_SHAPE_COUNT;
      set({ wallShape: n, wallMode: 'shapes' });
      return `Shape: ${WALL_SHAPES[n].name}`;
    },
  },
  {
    key: ']',
    label: 'Next shape',
    group: 'Wall',
    run: () => {
      const n = (get().wallShape + 1) % WALL_SHAPE_COUNT;
      set({ wallShape: n, wallMode: 'shapes' });
      return `Shape: ${WALL_SHAPES[n].name}`;
    },
  },

  { key: ',', label: 'Previous palette', group: 'Colour', run: cycle('paletteId', PALETTES_ORDER, 'Palette', -1) },
  { key: '.', label: 'Next palette', group: 'Colour', run: cycle('paletteId', PALETTES_ORDER, 'Palette', 1) },
  { key: 'a', label: 'Auto palette', group: 'Colour', run: () => (set({ paletteId: 'auto' }), 'Palette: auto') },
  { key: 'y', label: 'Next laser colour', group: 'Colour', run: cycle('laserColor', LASER_COLOR_IDS, 'Lasers', 1, LASER_COLOR_LABELS) },
  {
    key: 'Y',
    shift: true,
    label: 'Previous laser colour',
    group: 'Colour',
    run: cycle('laserColor', LASER_COLOR_IDS, 'Lasers', -1, LASER_COLOR_LABELS),
  },
  // Shift + a number jumps straight to a palette
  ...PALETTE_KEYS,
  {
    key: ';',
    label: 'Custom hue -15°',
    group: 'Colour',
    run: () => {
      const h = (get().customHue - 15 + 360) % 360;
      set({ customHue: h, paletteId: 'custom' });
      return `Hue ${Math.round(h)}°`;
    },
  },
  {
    key: "'",
    label: 'Custom hue +15°',
    group: 'Colour',
    run: () => {
      const h = (get().customHue + 15) % 360;
      set({ customHue: h, paletteId: 'custom' });
      return `Hue ${Math.round(h)}°`;
    },
  },
  { key: '/', label: 'Hue cycling slower', group: 'Colour', run: nudge('hueCycleSpeed', -0.15, 'Hue cycling') },
  { key: '\\', label: 'Hue cycling faster', group: 'Colour', run: nudge('hueCycleSpeed', 0.15, 'Hue cycling') },

  { key: 'ArrowUp', label: 'Intensity +', group: 'Levels', run: nudge('intensity', 0.1, 'Intensity') },
  { key: 'ArrowDown', label: 'Intensity -', group: 'Levels', run: nudge('intensity', -0.1, 'Intensity') },
  { key: 'ArrowRight', label: 'Pacing faster', group: 'Levels', run: nudge('pacing', 0.1, 'Pacing') },
  { key: 'ArrowLeft', label: 'Pacing slower', group: 'Levels', run: nudge('pacing', -0.1, 'Pacing') },
  { key: 'ArrowUp', shift: true, label: 'Reactivity +', group: 'Levels', run: nudge('reactivity', 0.1, 'Reactivity') },
  { key: 'ArrowDown', shift: true, label: 'Reactivity -', group: 'Levels', run: nudge('reactivity', -0.1, 'Reactivity') },
  { key: 'ArrowRight', shift: true, label: 'Sensitivity +', group: 'Levels', run: nudge('sensitivity', 0.1, 'Sensitivity') },
  { key: 'ArrowLeft', shift: true, label: 'Sensitivity -', group: 'Levels', run: nudge('sensitivity', -0.1, 'Sensitivity') },

  {
    key: 'Enter',
    label: 'DROP: blackout beat, then everything in white',
    group: 'Live',
    run: () => {
      triggerDrop();
      return 'DROP';
    },
  },
  {
    key: ' ',
    label: 'Hold for blackout',
    group: 'Live',
    hold: true,
    run: (down) => {
      set({ blackout: down });
      return down ? 'BLACKOUT' : 'Lights up';
    },
  },
  { key: 'q', label: 'Record / stop recording (video + sound)', group: 'Live', run: () => toggleRecording() },
  { key: 'f', label: 'Fullscreen (browser)', group: 'Live', run: () => '' },
  { key: '?', label: 'Show / hide this key map', group: 'Live', run: () => '' },
];

export function describeKey(b: KeyBinding): string {
  const name =
    b.key === ' ' ? 'Space' : b.key.startsWith('Arrow') ? b.key.replace('Arrow', '') + ' arrow' : b.key.length === 1 ? b.key.toUpperCase() : b.key;
  return b.shift ? `Shift + ${name}` : name;
}

export function findBinding(e: { key: string; shiftKey: boolean }): KeyBinding | undefined {
  // Shifted symbols (!, @, #...) arrive as themselves, so try the raw key first,
  // then the lowercased form for plain letters.
  const raw = e.key;
  const lower = raw.length === 1 ? raw.toLowerCase() : raw;
  return (
    KEYMAP.find((b) => b.key === raw && !!b.shift === e.shiftKey) ??
    KEYMAP.find((b) => b.key === lower && !!b.shift === e.shiftKey) ??
    KEYMAP.find((b) => b.key === lower && !b.shift && !e.shiftKey)
  );
}
