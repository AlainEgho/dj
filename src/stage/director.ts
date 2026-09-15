/**
 * Show director: picks a "look" for each musical phrase the way a lighting
 * operator would, based on the track's energy, and crossfades between looks so
 * the stage never snaps. Scene modules multiply their output by the weights
 * exposed here.
 *
 * Looks are exclusive on purpose: a phrase is either a moving-head phrase or a
 * laser phrase (or wall only). Everything at once happens only right after a
 * drop that followed a real breakdown.
 *
 * Borrowed from arena trance shows (Transmission): a build-up ramps the lasers
 * and strobe chatter, the last beat before the drop is a hard blackout, and
 * the drop itself opens with white lasers before settling back to colour.
 */
import type { StageSettings } from '../state/presets';
import { WALL_SHAPE_COUNT } from '../state/presets';

export type Look =
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
export type WallContent = 'spectrum' | 'heatmap' | 'shapes' | 'text';

interface Targets {
  wall: number;
  lasers: number;
  mesh: number;
  /** 1 = fans are dense flat sheets scanning across the crowd */
  sheet: number;
  beams: number;
  strobe: number;
  pyro: number;
  /** 1 = moving heads point into the audience's eyes */
  beamAim: number;
  /** 1 = laser fans lie flat and shoot over the crowd toward the viewer */
  laserAim: number;
}

/**
 * Which laser fixtures are active: the truss centre only, the whole truss row,
 * the floor centre only, the whole floor row, or everything.
 */
export type LaserGroup = 'topMiddle' | 'top' | 'bottomMiddle' | 'bottom' | 'all';

/** palettes the Auto palette rotates through */
const AUTO_PALETTES = ['tomorrow', 'ultra', 'oracle', 'sunset', 'acid', 'ice'];

export interface DirectorState extends Targets {
  look: Look;
  laserGroup: LaserGroup;
  /** palette id chosen by the director when the palette setting is 'auto' */
  autoPalette: string;
  /** crossfaded 0..1 weights for each laser group */
  gTopMid: number;
  gTop: number;
  gBotMid: number;
  gBottom: number;
  gAll: number;
  shape: number;
  wallContent: WallContent;
  /** index into splitWords(settings.wallText) for the current text phrase */
  textIndex: number;
  /** slow-moving 0..1 estimate of how loud the track has been lately */
  energy: number;
  /** 0..1 how strongly the track is building right now (rising energy) */
  build: number;
  /** 0..1 white-laser override, high right after a drop */
  white: number;
  /** 1 during the pre-drop blackout beat */
  blackout: number;
  /** seconds since the current cue started */
  cueTime: number;
  /** true only on the frame a drop (sudden energy jump) was detected */
  drop: boolean;
  /** seconds since the last drop */
  sinceDrop: number;
}

/** Split the wall text setting into individual words (comma separated, 13 chars max each). */
export function splitWords(text: string): string[] {
  return text
    .split(',')
    .map((w) => w.trim().slice(0, 13))
    .filter((w) => w.length > 0);
}

const T = (
  wall: number,
  lasers: number,
  mesh: number,
  sheet: number,
  beams: number,
  strobe: number,
  pyro: number,
  beamAim: number,
  laserAim: number,
): Targets => ({ wall, lasers, mesh, sheet, beams, strobe, pyro, beamAim, laserAim });

const TARGETS: Record<Look, Targets> = {
  wall: T(1, 0, 0, 0, 0.3, 0, 0, 0, 0),
  wallBeams: T(0.85, 0, 0, 0, 1, 0.4, 0, 0, 0),
  beamsAudience: T(0.35, 0, 0, 0, 1, 0.3, 0, 1, 0),
  laserSweep: T(0.4, 1, 0, 0, 0, 0, 0, 0, 0),
  laserAudience: T(0.2, 1, 0, 0, 0, 0, 0, 0, 1),
  laserSheet: T(0.25, 1, 0, 1, 0, 0, 0, 0, 0),
  laserMesh: T(0.3, 1, 1, 0, 0, 0, 0, 0, 0),
  meshBlackout: T(0, 1, 1, 0, 0, 0, 0, 0, 0),
  // the original festival rig: wall, beams and lasers running together at moderate levels
  festival: T(0.85, 0.65, 0, 0, 0.8, 0.4, 0.3, 0, 0),
  lasersBeams: T(0.4, 1, 0, 0, 0.6, 0.3, 0, 0, 0),
  full: T(1, 1, 0, 0, 1, 1, 1, 0.4, 0.6),
};

// Arena vocabulary: exclusive looks (Transmission style)
// 'laserAudience' (fans opening toward the viewer's eyes) is listed more than
// once so it comes up often.
const ARENA_LOW: Look[] = ['wall', 'wallBeams', 'laserSweep', 'laserSheet', 'laserAudience'];
const ARENA_MID: Look[] = ['wallBeams', 'laserSweep', 'laserAudience', 'laserAudience', 'laserSheet', 'laserMesh', 'beamsAudience', 'wall'];
const ARENA_HIGH: Look[] = ['wallBeams', 'beamsAudience', 'laserSweep', 'laserAudience', 'laserAudience', 'laserSheet', 'laserMesh', 'meshBlackout'];
// Festival vocabulary: the original combined looks
const FEST_LOW: Look[] = ['wall', 'wallBeams', 'festival', 'laserAudience'];
const FEST_MID: Look[] = ['festival', 'wallBeams', 'lasersBeams', 'laserSweep', 'laserAudience'];
const FEST_HIGH: Look[] = ['festival', 'lasersBeams', 'laserMesh', 'wallBeams', 'laserSweep', 'laserAudience'];

function poolFor(style: StageSettings['rigStyle'], energy: number): Look[] {
  const arena = energy < 0.3 ? ARENA_LOW : energy < 0.62 ? ARENA_MID : ARENA_HIGH;
  const fest = energy < 0.3 ? FEST_LOW : energy < 0.62 ? FEST_MID : FEST_HIGH;
  if (style === 'arena') return arena;
  if (style === 'festival') return fest;
  return [...arena, ...fest];
}

export const director: DirectorState = {
  look: 'wallBeams',
  ...TARGETS.wallBeams,
  laserGroup: 'all',
  autoPalette: 'tomorrow',
  gTopMid: 0,
  gTop: 0,
  gBotMid: 0,
  gBottom: 0,
  gAll: 1,
  shape: 0,
  wallContent: 'spectrum',
  textIndex: 0,
  energy: 0,
  build: 0,
  white: 0,
  blackout: 0,
  cueTime: 0,
  drop: false,
  sinceDrop: 100,
};

const BLACKOUT_SECONDS = 0.32;

let beatsInPhrase = 0;
let phraseStart = 0;
let quietTime = 0;
let cuesSincePalette = 0;
let groupBeats = 0;
let groupStart = 0;
let wallLooksSeen = 0;
let target: Targets = TARGETS.wallBeams;
let time = 0;
let energyFast = 0;
let blackoutUntil = -1;
let pendingDrop = false;

function pick(list: Look[], avoid: Look): Look {
  const options = list.filter((l) => l !== avoid);
  return options[Math.floor(Math.random() * options.length)];
}

function startCue(look: Look, settings: StageSettings) {
  director.look = look;
  director.cueTime = 0;
  target = TARGETS[look];
  phraseStart = time;
  beatsInPhrase = 0;
  director.laserGroup = pickLaserGroup(settings, director.energy, director.laserGroup);
  // Auto palette: a new colour world every second cue, always on a drop
  cuesSincePalette++;
  if (cuesSincePalette >= 2 || look === 'full') {
    cuesSincePalette = 0;
    const options = AUTO_PALETTES.filter((p) => p !== director.autoPalette);
    director.autoPalette = options[Math.floor(Math.random() * options.length)];
  }
  // Wall content: mostly shapes, spectrum on high energy, and every so often
  // one of the configured words (never two text phrases in a row).
  if (target.wall > 0.3) {
    wallLooksSeen++;
    const words = splitWords(settings.wallText);
    const roll = Math.random();
    if (words.length > 0 && director.wallContent !== 'text' && roll < 0.3) {
      director.wallContent = 'text';
      director.textIndex = Math.floor(Math.random() * words.length);
    } else if (director.energy > 0.7 && roll < 0.55) {
      director.wallContent = director.wallContent === 'spectrum' ? 'heatmap' : 'spectrum';
    } else {
      director.wallContent = 'shapes';
      director.shape = (director.shape + 1 + Math.floor(Math.random() * 3)) % WALL_SHAPE_COUNT;
    }
  }
}

/**
 * Which lasers fire this phrase, from the music: quiet passages use the centre
 * fixtures or the truss alone, mid energy alternates truss / floor / centre,
 * peaks open everything. Never repeats the previous group.
 */
function pickLaserGroup(settings: StageSettings, energy: number, prev: LaserGroup): LaserGroup {
  const hasTop = settings.rigStyle !== 'arena';
  let pool: LaserGroup[];
  if (energy < 0.3) pool = ['bottomMiddle', 'topMiddle', 'bottomMiddle'];
  else if (energy < 0.62) pool = ['bottom', 'top', 'bottomMiddle', 'topMiddle'];
  else pool = ['all', 'bottom', 'top', 'all', 'bottomMiddle'];
  if (!hasTop) pool = pool.map((g) => (g === 'top' ? 'bottom' : g === 'topMiddle' ? 'bottomMiddle' : g));
  const options = pool.filter((g) => g !== prev);
  return options.length ? options[Math.floor(Math.random() * options.length)] : pool[0];
}

function snapTo(t: Targets) {
  director.wall = t.wall;
  director.lasers = t.lasers;
  director.mesh = t.mesh;
  director.sheet = t.sheet;
  director.beams = t.beams;
  director.strobe = t.strobe;
  director.pyro = t.pyro;
  director.beamAim = t.beamAim;
  director.laserAim = t.laserAim;
}

export function updateDirector(
  audio: { amp: number; bass: number; beat: boolean; bpm: number },
  settings: StageSettings,
  dt: number,
) {
  time += dt;
  director.cueTime += dt;
  director.sinceDrop += dt;
  director.drop = false;

  // Long-term energy (~4s) and a faster follower (~0.8s); their difference is
  // the build-up signal that ramps lasers and strobe chatter before a drop.
  director.energy += (audio.amp - director.energy) * Math.min(1, dt / 4);
  energyFast += (audio.amp - energyFast) * Math.min(1, dt / 0.8);
  const rising = Math.max(0, energyFast - director.energy);
  const buildTarget = Math.min(1, rising * 3) * (director.energy < 0.75 ? 1 : 0.3);
  director.build += (buildTarget - director.build) * Math.min(1, dt / (buildTarget > director.build ? 0.6 : 2.5));

  // Pre-drop blackout: hold everything dark for a beat, then explode.
  if (blackoutUntil > 0) {
    if (time < blackoutUntil) {
      director.blackout = 1;
      return;
    }
    blackoutUntil = -1;
    director.blackout = 0;
    if (pendingDrop) {
      pendingDrop = false;
      director.drop = true;
      director.white = 1;
      startCue('full', settings);
      snapTo(TARGETS.full); // no crossfade on the drop itself
      director.laserGroup = 'all';
      director.gAll = 1;
    }
  }

  if (settings.cue !== 'auto') {
    // Operator called a cue: hold it.
    if (director.look !== settings.cue) startCue(settings.cue, settings);
    target = TARGETS[settings.cue];
  } else if (!settings.autoCues) {
    target = TARGETS.full;
    director.look = 'full';
    director.wallContent = 'spectrum';
  } else {
    // Drop: a sudden jump well above the recent average, but only after a real
    // breakdown (a few quiet seconds) and not more than every ~25s. This is the
    // one moment where wall, beams and lasers all run together.
    if (audio.amp < 0.35) quietTime += dt;
    else if (audio.amp > 0.6) quietTime = 0;
    const isDrop = audio.amp > director.energy + 0.35 && audio.bass > 0.6;
    if (isDrop && quietTime > 4 && director.sinceDrop > 25 && director.cueTime > 3) {
      director.sinceDrop = 0;
      quietTime = 0;
      pendingDrop = true;
      blackoutUntil = time + BLACKOUT_SECONDS;
      director.blackout = 1;
      return;
    }

    if (audio.beat) beatsInPhrase++;
    // Slow pacing = longer phrases (32 beats), fast = 16. Fall back to a timer
    // when no tempo is available. The post-drop "full" look lasts one phrase.
    const phraseBeats = settings.pacing < 0.5 && director.look !== 'full' ? 32 : 16;
    const beatMs = audio.bpm > 0 ? 60000 / audio.bpm : 500;
    const maxSeconds = (beatMs * phraseBeats * 1.4) / 1000;
    const minSeconds = 8 + (1 - settings.pacing) * 12;
    const phraseDone = beatsInPhrase >= phraseBeats || time - phraseStart > maxSeconds;
    if (phraseDone && time - phraseStart > minSeconds) {
      // A laser phrase is followed by the mesh half of the time, so the fans
      // visibly fold into the lattice (the lasers -> mesh transition).
      const prev = director.look;
      const laserPhrase = prev === 'laserSweep' || prev === 'laserAudience' || prev === 'lasersBeams';
      if (laserPhrase && settings.rigStyle !== 'festival' && Math.random() < 0.5) startCue('laserMesh', settings);
      else if (prev === 'laserMesh' && Math.random() < 0.4) startCue('laserSweep', settings);
      else startCue(pick(poolFor(settings.rigStyle, director.energy), prev), settings);
    }
  }

  // White lasers fade back to colour over ~6s after a drop
  director.white *= Math.pow(0.5, dt / 2.5);
  if (director.white < 0.01) director.white = 0;

  // Laser groups change every 8 beats (or ~6-10s without a tempo), independent
  // of the look, so the source of the beams keeps moving with the music. A big
  // surge at high energy opens every fixture at once.
  if (settings.cue === 'auto' && settings.autoCues) {
    if (audio.beat) groupBeats++;
    const groupSeconds = 6 + (1 - settings.pacing) * 4;
    if (groupBeats >= 8 || time - groupStart > groupSeconds) {
      groupBeats = 0;
      groupStart = time;
      director.laserGroup = pickLaserGroup(settings, director.energy, director.laserGroup);
    }
    if (director.laserGroup !== 'all' && energyFast > 0.85 && director.energy > 0.6) director.laserGroup = 'all';
  }
  const gRate = Math.min(1, dt / 1.2);
  const g = director.laserGroup;
  director.gTopMid += ((g === 'topMiddle' ? 1 : 0) - director.gTopMid) * gRate;
  director.gTop += ((g === 'top' ? 1 : 0) - director.gTop) * gRate;
  director.gBotMid += ((g === 'bottomMiddle' ? 1 : 0) - director.gBotMid) * gRate;
  director.gBottom += ((g === 'bottom' ? 1 : 0) - director.gBottom) * gRate;
  director.gAll += ((g === 'all' ? 1 : 0) - director.gAll) * gRate;

  // Crossfade weights (2.6s at slow pacing, 1.2s at fast pacing)
  const rate = Math.min(1, dt / (2.6 - settings.pacing * 1.4));
  director.wall += (target.wall - director.wall) * rate;
  director.lasers += (target.lasers - director.lasers) * rate;
  // the fold from fans into the mesh lattice (and back) is slower and deliberate
  director.mesh += (target.mesh - director.mesh) * Math.min(1, dt / 4.0);
  director.sheet += (target.sheet - director.sheet) * rate;
  director.beams += (target.beams - director.beams) * rate;
  director.strobe += (target.strobe - director.strobe) * rate;
  director.pyro += (target.pyro - director.pyro) * rate;
  director.beamAim += (target.beamAim - director.beamAim) * rate;
  director.laserAim += (target.laserAim - director.laserAim) * rate;
}
