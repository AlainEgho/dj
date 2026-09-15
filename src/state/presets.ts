export type ShowMode = 'chill' | 'festival' | 'rave' | 'custom';
export type WallMode = 'auto' | 'spectrum' | 'heatmap' | 'shapes' | 'text' | 'off';

/** Lighting cues the director can call; 'auto' lets it pick per phrase. */
export type CueId =
  | 'auto'
  | 'wall'
  | 'wallBeams'
  | 'beamsAudience'
  | 'laserSweep'
  | 'laserAudience'
  | 'laserSheet'
  | 'laserMesh'
  | 'meshBlackout'
  | 'festival'
  | 'lasersBeams'
  | 'whiteOut'
  | 'full';

export const CUES: { id: CueId; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'wall', label: 'Wall' },
  { id: 'wallBeams', label: 'Beams' },
  { id: 'beamsAudience', label: 'Beams to crowd' },
  { id: 'laserSweep', label: 'Lasers' },
  { id: 'laserAudience', label: 'Lasers to crowd' },
  { id: 'laserSheet', label: 'Laser sheets' },
  { id: 'laserMesh', label: 'Laser mesh' },
  { id: 'meshBlackout', label: 'Mesh blackout' },
  { id: 'festival', label: 'Festival mix' },
  { id: 'lasersBeams', label: 'Lasers + beams' },
  { id: 'whiteOut', label: 'White out' },
  { id: 'full', label: 'Everything' },
];

/**
 * Laser colours. The fixed colours use the tints real diode lasers throw
 * (532nm green, 638nm red, 445nm blue and so on) rather than flat RGB, so a
 * green fan reads as a laser and not as a green light.
 * 'palette'  follows the colour engine, 'mixed' alternates green with it,
 * 'rainbow'  gives every fixture its own colour across the rig.
 */
export type LaserColorId =
  | 'palette'
  | 'mixed'
  | 'rainbow'
  | 'green'
  | 'red'
  | 'blue'
  | 'cyan'
  | 'magenta'
  | 'yellow'
  | 'orange'
  | 'violet'
  | 'white';

export const LASER_COLORS: { id: LaserColorId; label: string; rgb: [number, number, number] | null }[] = [
  { id: 'mixed', label: 'Green + palette', rgb: null },
  { id: 'palette', label: 'Palette', rgb: null },
  { id: 'rainbow', label: 'Rainbow', rgb: null },
  { id: 'green', label: 'Green', rgb: [0.2, 1.0, 0.3] },
  { id: 'red', label: 'Red', rgb: [1.0, 0.12, 0.1] },
  { id: 'blue', label: 'Blue', rgb: [0.22, 0.35, 1.0] },
  { id: 'cyan', label: 'Cyan', rgb: [0.2, 0.95, 1.0] },
  { id: 'magenta', label: 'Magenta', rgb: [1.0, 0.15, 0.8] },
  { id: 'yellow', label: 'Yellow', rgb: [1.0, 0.92, 0.25] },
  { id: 'orange', label: 'Orange', rgb: [1.0, 0.5, 0.1] },
  { id: 'violet', label: 'Violet', rgb: [0.62, 0.3, 1.0] },
  { id: 'white', label: 'White', rgb: [1.0, 1.0, 1.0] },
];

/** The colours the rainbow mode cycles across fixtures. */
export const RAINBOW_ORDER: LaserColorId[] = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta'];

/** Music profiles. 'auto' is genre-neutral. */
export type GenreId = 'auto' | 'trance' | 'techno' | 'house';
export const GENRES: { id: GenreId; label: string; blurb: string }[] = [
  { id: 'auto', label: 'Auto', blurb: 'Genre neutral' },
  { id: 'trance', label: 'Trance', blurb: '128-145 BPM, long breakdowns, big drops, laser heavy' },
  { id: 'techno', label: 'Techno', blurb: '125-140 BPM, 16-beat phrases, strobes, minimal wall' },
  { id: 'house', label: 'House', blurb: '118-130 BPM, warm beams, softer drops' },
];

/**
 * arena    = lasers only at the stage front, exclusive looks (Transmission style)
 * festival = lasers on the truss and the floor, beams and lasers together (the original rig)
 * mix      = both fixture sets, director alternates between the two styles
 */
export type RigStyle = 'arena' | 'festival' | 'mix';
export const RIG_STYLES: { id: RigStyle; label: string }[] = [
  { id: 'mix', label: 'Mix' },
  { id: 'festival', label: 'Festival' },
  { id: 'arena', label: 'Arena' },
];

export const WALL_SHAPES = [
  { id: 0, name: 'Eclipse' },
  { id: 1, name: 'Rings' },
  { id: 2, name: 'Pixel rain' },
  { id: 3, name: 'Rays' },
  { id: 4, name: 'Tunnel' },
  { id: 5, name: 'Waves' },
  { id: 6, name: 'Oracle Eye' },
  { id: 7, name: 'Temple' },
  { id: 8, name: 'Clouds' },
  { id: 9, name: 'Streaks' },
  { id: 10, name: 'Robot' },
  { id: 11, name: 'Smoke' },
] as const;
export const WALL_SHAPE_COUNT = 12;

export interface StageSettings {
  paletteId: string;
  /** used when paletteId === 'custom' */
  customHue: number;
  /** how quickly the hue cycles per beat (0 = static) */
  hueCycleSpeed: number;
  /** 0..1 global intensity multiplier */
  intensity: number;
  laserDensity: number; // 0..1 -> number of laser fixtures
  /** green = classic 532nm, palette = follow the colour engine, mixed = alternate */
  laserColor: LaserColorId;
  beamCount: number; // 4..24
  strobeEnabled: boolean;
  /** white wash: floods the stage in bright white light */
  washEnabled: boolean;
  /** momentary wash bump, held from the keyboard */
  washBump: boolean;
  lasersEnabled: boolean;
  beamsEnabled: boolean;
  pyroEnabled: boolean;
  ledEnabled: boolean;
  hazeEnabled: boolean;
  /** 0..1 reactivity scale (how hard visuals hit on audio) */
  reactivity: number;
  /** 0..1 input sensitivity: gain floor and beat-detection threshold */
  sensitivity: number;
  /** 0..1 how much the lasers react to the audio (0 = steady, ignores the track) */
  laserSensitivity: number;
  /** 0..1 how much the moving heads react to the audio */
  beamSensitivity: number;
  /** 0..1 how readily the strobes and blinders fire (0 = never on their own) */
  strobeSensitivity: number;
  /** 0..1 how hard the lasers strobe on the beat (0 = steady beams) */
  laserStrobe: number;
  /**
   * Mirrored chase: fixtures switch on and off in symmetric pairs, opening from
   * the centre outward and closing back in, in time with the beat. 0 = off.
   */
  mirrorChase: number;
  /** 0 = slow cinematic, 1 = fast club pacing */
  pacing: number;
  /** let the show director change looks on musical phrases */
  autoCues: boolean;
  /** operator override: force one cue, or 'auto' */
  cue: CueId;
  /** which fixture set and look vocabulary the show uses */
  rigStyle: RigStyle;
  /** operator override for which laser fixtures fire, or 'auto' */
  laserGroup: 'auto' | 'topMiddle' | 'top' | 'bottomMiddle' | 'bottom' | 'all';
  /** manual blackout (held from the keyboard) */
  blackout: boolean;
  /** vertical resolution the stage renders at while recording */
  recordQuality: 'screen' | '1080' | '1440' | '2160';
  /** music profile: tunes BPM range, phrase length, breakdown/drop and build detection */
  genre: GenreId;
  /** LED wall content */
  wallMode: WallMode;
  wallShape: number;
  wallText: string;
  showMode: ShowMode;
}

export const DEFAULT_SETTINGS: StageSettings = {
  paletteId: 'tomorrow',
  customHue: 330,
  hueCycleSpeed: 0.4,
  intensity: 0.8,
  laserDensity: 0.6,
  laserColor: 'mixed',
  beamCount: 12,
  strobeEnabled: true,
  washEnabled: true,
  washBump: false,
  lasersEnabled: true,
  beamsEnabled: true,
  pyroEnabled: true,
  ledEnabled: true,
  hazeEnabled: true,
  reactivity: 0.7,
  sensitivity: 0.5,
  laserSensitivity: 0.75,
  beamSensitivity: 0.6,
  strobeSensitivity: 0.5,
  laserStrobe: 0.45,
  mirrorChase: 0.6,
  pacing: 0.25,
  autoCues: true,
  cue: 'auto',
  rigStyle: 'mix',
  laserGroup: 'auto',
  blackout: false,
  recordQuality: '1080',
  genre: 'auto',
  wallMode: 'auto',
  wallShape: 0,
  wallText: '',
  showMode: 'festival',
};

/** Built-in show-mode presets. Palette and wall text are kept from the current settings. */
export const SHOW_MODES: Record<Exclude<ShowMode, 'custom'>, Partial<StageSettings>> = {
  chill: {
    hueCycleSpeed: 0.15,
    intensity: 0.5,
    laserDensity: 0.3,
    beamCount: 8,
    strobeEnabled: false,
    lasersEnabled: true,
    beamsEnabled: true,
    pyroEnabled: false,
    ledEnabled: true,
    hazeEnabled: true,
    reactivity: 0.5,
    pacing: 0.1,
    autoCues: true,
  },
  festival: {
    hueCycleSpeed: 0.4,
    intensity: 0.8,
    laserDensity: 0.6,
    beamCount: 12,
    strobeEnabled: true,
    lasersEnabled: true,
    beamsEnabled: true,
    pyroEnabled: true,
    ledEnabled: true,
    hazeEnabled: true,
    reactivity: 0.7,
    pacing: 0.25,
    autoCues: true,
  },
  rave: {
    hueCycleSpeed: 0.8,
    intensity: 1,
    laserDensity: 1,
    beamCount: 20,
    strobeEnabled: true,
    lasersEnabled: true,
    beamsEnabled: true,
    pyroEnabled: true,
    ledEnabled: true,
    hazeEnabled: true,
    reactivity: 0.9,
    pacing: 0.5,
    autoCues: true,
  },
};

export interface SavedPreset {
  id: string;
  name: string;
  createdAt: number;
  settings: StageSettings;
}
