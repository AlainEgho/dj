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
  { id: 'full', label: 'Everything' },
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
] as const;
export const WALL_SHAPE_COUNT = 11;

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
  laserColor: 'green' | 'palette' | 'mixed';
  beamCount: number; // 4..24
  strobeEnabled: boolean;
  lasersEnabled: boolean;
  beamsEnabled: boolean;
  pyroEnabled: boolean;
  ledEnabled: boolean;
  hazeEnabled: boolean;
  /** 0..1 reactivity scale (how hard visuals hit on audio) */
  reactivity: number;
  /** 0..1 input sensitivity: gain floor and beat-detection threshold */
  sensitivity: number;
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
  lasersEnabled: true,
  beamsEnabled: true,
  pyroEnabled: true,
  ledEnabled: true,
  hazeEnabled: true,
  reactivity: 0.7,
  sensitivity: 0.5,
  pacing: 0.25,
  autoCues: true,
  cue: 'auto',
  rigStyle: 'mix',
  laserGroup: 'auto',
  blackout: false,
  recordQuality: '1080',
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
