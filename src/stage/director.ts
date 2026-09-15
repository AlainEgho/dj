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
import type { GenreId, StageSettings } from '../state/presets';
import { WALL_SHAPE_COUNT } from '../state/presets';

/**
 * Genre profiles. Dance music is built in bars: trance runs long 32-beat
 * phrases with 8-to-16-bar breakdowns and a drop that lands when the kick
 * returns; techno turns over in 16; house sits between them and never really
 * drops out. These numbers drive phrase length, how a build is recognised and
 * how big the payoff is.
 */
export interface GenreProfile {
  /** beats per phrase at normal pacing */
  phraseBeats: number;
  /** seconds of low energy that count as a breakdown before a drop can fire */
  breakdownSeconds: number;
  /** how far above the running average the level must jump to call a drop */
  dropJump: number;
  /** bass needed at the drop */
  dropBass: number;
  /** minimum seconds between drops */
  dropGap: number;
  /** how strongly a rising level reads as a build-up */
  buildGain: number;
  /** seconds the post-drop "everything" look holds */
  dropHold: number;
  /** extra weight for laser-led looks (trance) vs strobe-led (techno) */
  laserBias: number;
  strobeBias: number;
}

const PROFILES: Record<GenreId, GenreProfile> = {
  auto: { phraseBeats: 16, breakdownSeconds: 4, dropJump: 0.35, dropBass: 0.6, dropGap: 25, buildGain: 3, dropHold: 16, laserBias: 0, strobeBias: 0 },
  // Trance: 32-beat phrases, long breakdowns, a build that climbs for bars, a
  // drop that is the whole point of the track, and lasers doing the heavy work.
  trance: { phraseBeats: 32, breakdownSeconds: 8, dropJump: 0.25, dropBass: 0.5, dropGap: 45, buildGain: 4.5, dropHold: 32, laserBias: 2, strobeBias: 0 },
  // Techno: short phrases, rare real drops, strobes and blinders carry it.
  techno: { phraseBeats: 16, breakdownSeconds: 5, dropJump: 0.3, dropBass: 0.6, dropGap: 30, buildGain: 3.5, dropHold: 16, laserBias: 0, strobeBias: 2 },
  // House: steady, warm, drops are soft lifts rather than explosions.
  house: { phraseBeats: 16, breakdownSeconds: 4, dropJump: 0.4, dropBass: 0.65, dropGap: 40, buildGain: 2.5, dropHold: 16, laserBias: 0, strobeBias: 0 },
};

export const profileFor = (g: GenreId): GenreProfile => PROFILES[g] ?? PROFILES.auto;

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
  /** true while the track is in a breakdown (quiet, no kick) */
  breakdown: boolean;
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

/** Looks the genre leans on, repeated to weight the random pick. */
const LASER_LOOKS: Look[] = ['laserSweep', 'laserAudience', 'laserMesh', 'laserSheet'];
const STROBE_LOOKS: Look[] = ['wallBeams', 'beamsAudience', 'wall', 'festival'];

function poolFor(style: StageSettings['rigStyle'], energy: number, profile: GenreProfile): Look[] {
  const arena = energy < 0.3 ? ARENA_LOW : energy < 0.62 ? ARENA_MID : ARENA_HIGH;
  const fest = energy < 0.3 ? FEST_LOW : energy < 0.62 ? FEST_MID : FEST_HIGH;
  const base = style === 'arena' ? arena : style === 'festival' ? fest : [...arena, ...fest];
  if (energy < 0.3) return base; // quiet passages stay calm whatever the genre
  // Bias by re-weighting: the favoured family is repeated, the other family is
  // thinned, so trance reads laser-led and techno beam/strobe-led.
  const favour = profile.laserBias > profile.strobeBias ? LASER_LOOKS : profile.strobeBias > 0 ? STROBE_LOOKS : null;
  if (!favour) return base;
  const other = favour === LASER_LOOKS ? STROBE_LOOKS : LASER_LOOKS;
  const weight = Math.max(profile.laserBias, profile.strobeBias);
  const thinned = base.filter((l) => !other.includes(l) || Math.random() < 0.25);
  const extra: Look[] = [];
  for (let i = 0; i < weight; i++) extra.push(...base.filter((l) => favour.includes(l)));
  return [...thinned, ...extra];
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
  breakdown: false,
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
/** energy level during the last breakdown, the reference a drop is measured against */
let breakdownEnergy = 0;
/** a breakdown arms the drop detector until this time */
let armedUntil = 0;
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

/** Operator-triggered drop: blackout beat, then everything with white lasers and pyro. */
export function triggerDrop() {
  if (pendingDrop) return;
  pendingDrop = true;
  blackoutUntil = time + BLACKOUT_SECONDS;
  director.blackout = 1;
  director.sinceDrop = 0;
  quietTime = 0;
}

export function updateDirector(
  audio: { amp: number; bass: number; beat: boolean; bpm: number; bpmConfidence?: number },
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
  const profile = profileFor(settings.genre);
  const buildTarget = Math.min(1, rising * profile.buildGain) * (director.energy < 0.75 ? 1 : 0.3);
  director.build += (buildTarget - director.build) * Math.min(1, dt / (buildTarget > director.build ? 0.6 : 2.5));

  // Manual blackout held from the keyboard: everything dark until released.
  if (settings.blackout) {
    director.blackout = 1;
    return;
  }
  if (!pendingDrop && blackoutUntil < 0) director.blackout = 0;

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
    if (audio.amp < 0.35) {
      quietTime += dt;
      // remember the quiet level: the drop is measured against the breakdown,
      // not against the build-up that has been lifting the average
      breakdownEnergy = director.energy;
    } else if (audio.amp > 0.6) {
      quietTime = 0;
    }
    // A breakdown is a sustained quiet stretch with little bass: in trance this
    // is where the wall takes over and the lasers rest before the build.
    director.breakdown = quietTime > profile.breakdownSeconds * 0.5 && audio.bass < 0.4;

    // A breakdown "arms" the drop for a while, so a long build-up between the
    // breakdown and the drop does not disqualify it.
    if (quietTime > profile.breakdownSeconds) armedUntil = time + 90;
    const armed = time < armedUntil;
    // Compare against the pre-build level, and require the kick to be back.
    const reference = Math.min(director.energy, breakdownEnergy + 0.15);
    const isDrop = audio.amp > reference + profile.dropJump && audio.bass > profile.dropBass;
    if (isDrop && armed && director.sinceDrop > profile.dropGap && director.cueTime > 1) {
      armedUntil = 0;
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
    // Phrase length from the genre profile; the post-drop payoff holds longer.
    const phraseBeats =
      director.look === 'full'
        ? profile.dropHold
        : settings.pacing < 0.5
          ? profile.phraseBeats
          : Math.max(8, profile.phraseBeats / 2);
    const beatMs = audio.bpm > 0 ? 60000 / audio.bpm : 500;
    const haveTempo = audio.bpm > 0 && (audio.bpmConfidence ?? 1) > 0.15;
    // With a tempo, the bar count decides the phrase and the clock is only a
    // safety net; without one, fall back to a pacing-based duration.
    const maxSeconds = (beatMs * phraseBeats * 1.6) / 1000;
    const minSeconds = haveTempo ? 4 : 8 + (1 - settings.pacing) * 12;
    const phraseDone = beatsInPhrase >= phraseBeats || time - phraseStart > maxSeconds;
    if (phraseDone && time - phraseStart > minSeconds) {
      // A laser phrase is followed by the mesh half of the time, so the fans
      // visibly fold into the lattice (the lasers -> mesh transition).
      const prev = director.look;
      const laserPhrase = prev === 'laserSweep' || prev === 'laserAudience' || prev === 'lasersBeams';
      if (laserPhrase && settings.rigStyle !== 'festival' && Math.random() < 0.5) startCue('laserMesh', settings);
      else if (prev === 'laserMesh' && Math.random() < 0.4) startCue('laserSweep', settings);
      else startCue(pick(poolFor(settings.rigStyle, director.energy, profile), prev), settings);
    }
  }

  // White lasers fade back to colour over ~6s after a drop
  director.white *= Math.pow(0.5, dt / 2.5);
  if (director.white < 0.01) director.white = 0;

  // Laser groups change every 8 beats (or ~6-10s without a tempo), independent
  // of the look, so the source of the beams keeps moving with the music. A big
  // surge at high energy opens every fixture at once.
  if (settings.laserGroup !== 'auto') {
    director.laserGroup = settings.laserGroup; // operator override from the keyboard
  } else if (settings.cue === 'auto' && settings.autoCues) {
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

  // In a breakdown the wall carries the moment and the lasers rest, so the
  // build and the drop land that much harder (classic trance staging).
  const bd = director.breakdown && settings.genre === 'trance' && settings.cue === 'auto' ? 1 : 0;
  const wallTarget = Math.max(target.wall, bd * 0.9);
  const laserTarget = target.lasers * (1 - bd * 0.75);

  // Crossfade weights (2.6s at slow pacing, 1.2s at fast pacing)
  const rate = Math.min(1, dt / (2.6 - settings.pacing * 1.4));
  director.wall += (wallTarget - director.wall) * rate;
  director.lasers += (laserTarget - director.lasers) * rate;
  // the fold from fans into the mesh lattice (and back) is slower and deliberate
  director.mesh += (target.mesh - director.mesh) * Math.min(1, dt / 4.0);
  director.sheet += (target.sheet - director.sheet) * rate;
  director.beams += (target.beams - director.beams) * rate;
  director.strobe += (target.strobe - director.strobe) * rate;
  director.pyro += (target.pyro - director.pyro) * rate;
  director.beamAim += (target.beamAim - director.beamAim) * rate;
  director.laserAim += (target.laserAim - director.laserAim) * rate;
}
