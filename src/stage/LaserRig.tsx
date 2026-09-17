import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from './fiber';
import { laserFragment, laserVertex } from './shaders';
import { director, stage } from './stageState';
import { useSettings } from '../state/settingsStore';
import { LASER_COLORS, RAINBOW_ORDER, type RigStyle } from '../state/presets';

const FAN_SIZE = 34;

interface Fixture {
  x: number;
  y: number;
  z: number;
  /** true = truss fixture firing downwards, false = floor fixture firing up */
  fromTruss: boolean;
  phase: number;
  speed: number;
  /** fixed pan used in mesh mode so fans cross each other */
  meshPan: number;
  /** distance rank from the centre of its row (0 = innermost), for the mirror chase */
  mirrorRank: number;
  /** how many ranks its row has */
  mirrorCount: number;
}

/**
 * Rank each fixture by how far it sits from the centre of its own row, so a
 * mirrored chase can open outward in symmetric pairs (0 = innermost).
 */
function assignMirrorRanks(fixtures: Fixture[]) {
  for (const row of [true, false]) {
    const inRow = fixtures.filter((f) => f.fromTruss === row);
    const order = [...inRow].sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
    // pairs at the same distance share a rank, which is what makes it a mirror
    let rank = -1;
    let lastDist = -1;
    for (const f of order) {
      const d = Math.abs(f.x);
      if (Math.abs(d - lastDist) > 0.01) {
        rank++;
        lastDist = d;
      }
      f.mirrorRank = rank;
    }
    for (const f of inRow) f.mirrorCount = rank + 1;
  }
}

function buildFixtures(density: number, _style: RigStyle): Fixture[] {
  const fixtures: Fixture[] = [];
  // Most lasers sit along the stage front at floor level and fire up and over
  // the crowd (see any Armin / Afterlife rig). A few hang on the truss.
  const floorCount = Math.round(3 + density * 5);
  for (let i = 0; i < floorCount; i++) {
    const t = floorCount === 1 ? 0.5 : i / (floorCount - 1);
    fixtures.push({
      x: (t - 0.5) * 18,
      y: 0.4,
      z: -0.8,
      fromTruss: false,
      phase: i * 2.1 + 0.7,
      speed: 0.7 + (i % 2) * 0.2,
      meshPan: (i % 2 === 0 ? -1 : 1) * (0.22 + (i % 3) * 0.06),
      mirrorRank: 0,
      mirrorCount: 1,
    });
  }
  // Truss-mounted lasers fire down and out over the crowd. Arena auto-cues
  // still prefer the floor, but the row stays in the rig so a "top" group works.
  const trussCount = Math.round(3 + density * 5);
  for (let i = 0; i < trussCount; i++) {
    const t = trussCount === 1 ? 0.5 : i / (trussCount - 1);
    fixtures.push({
      x: (t - 0.5) * 18,
      y: 8.8,
      z: -2.0,
      fromTruss: true,
      phase: i * 1.3,
      speed: 0.8 + (i % 3) * 0.15,
      meshPan: (i % 2 === 0 ? 1 : -1) * 0.3,
      mirrorRank: 0,
      mirrorCount: 1,
    });
  }
  assignMirrorRanks(fixtures);
  return fixtures;
}

/**
 * Laser fixtures on the truss and the stage floor. Every fan starts at a
 * visible laser head (box + glowing emitter) and is posed in 3D:
 *  - sweep: fans tilt up and down over the audience and pan slowly
 *  - mesh: fans lock to crossing angles with many lines (laser net)
 *  - audience: fans lie almost flat and shoot over the crowd toward the viewer
 * The director crossfades between the three poses.
 */
export function LaserRig() {
  const { laserDensity: density, rigStyle } = useSettings();
  const fixtures = useMemo(() => buildFixtures(density, rigStyle), [density, rigStyle]);
  const geometry = useMemo(() => new THREE.PlaneGeometry(FAN_SIZE, FAN_SIZE), []);
  const headGeo = useMemo(() => new THREE.BoxGeometry(0.55, 0.32, 0.5), []);
  const emitterGeo = useMemo(() => new THREE.SphereGeometry(0.04, 8, 8), []);
  const headMat = useMemo(() => new THREE.MeshStandardMaterial({ color: 0x15151a, metalness: 0.8, roughness: 0.4 }), []);
  const materials = useMemo(
    () =>
      fixtures.map(
        () =>
          new THREE.ShaderMaterial({
            vertexShader: laserVertex,
            fragmentShader: laserFragment,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: {
              uTime: { value: 0 },
              uTreble: { value: 0 },
              uBeat: { value: 0 },
              uIntensity: { value: 1 },
              uLines: { value: 8 },
              uSpread: { value: 1 },
              uSweep: { value: 0 },
              uFanSize: { value: FAN_SIZE },
              uWidth: { value: 0.045 },
              uBorder: { value: 0 },
              uColorA: { value: new THREE.Color() },
              uColorB: { value: new THREE.Color() },
            },
          }),
      ),
    [fixtures],
  );
  const emitterMats = useMemo(() => fixtures.map(() => new THREE.MeshBasicMaterial({ color: 0xffffff })), [fixtures]);

  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose());
      emitterMats.forEach((m) => m.dispose());
    },
    [materials, emitterMats],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      headGeo.dispose();
      emitterGeo.dispose();
      headMat.dispose();
    },
    [geometry, headGeo, emitterGeo, headMat],
  );

  const fanRefs = useRef<(THREE.Group | null)[]>([]);
  const smooth = useRef({ mid: 0, amp: 0, build: 0 });
  /**
   * Beat state. Real laser rigs step to a new position on each beat rather than
   * sweeping continuously, and the step is what reads as "on the beat".
   * `step` counts beats, `punch` is a fast decay used for the flash.
   */
  const beat = useRef({ step: 0, punch: 0, lastPan: 0, panTarget: 0 });

  useFrame(() => {
    const s = stage;
    // Lasers follow slow followers of the audio (about a second), not the raw
    // per-frame values, so they move with the music instead of twitching.
    const sm = smooth.current;
    const k = Math.min(1, s.dt / 1.0);
    sm.mid += (s.mid - sm.mid) * k;
    sm.amp += (s.amp - sm.amp) * k;
    sm.build += (director.build - sm.build) * Math.min(1, s.dt / 1.5);
    // How much the lasers follow the audio at all: the user's laser sensitivity
    // scaled by the director's reactivity, which collapses during speech.
    const sens = s.settings.laserSensitivity * director.react;
    const build = sm.build * sens;

    // Build-ups bring the lasers up gradually even in beam looks; the pre-drop
    // blackout kills everything for a beat.
    // Border look draws its rays on the moving heads, so the floor/truss fans sit out.
    const weight = s.settings.lasersEnabled
      ? Math.min(1, director.lasers + build * 0.6) * (1 - director.blackout) * (1 - director.border)
      : 0;
    const wMesh = director.mesh;
    const wSheet = director.sheet * (1 - wMesh);
    const wAim = director.laserAim * (1 - wMesh - wSheet);
    const wSweep = Math.max(0, 1 - wMesh - wSheet - wAim);
    // ---- beat step -------------------------------------------------------
    // On each beat the fans jump to a new angle and flash, then hold until the
    // next one. The step is scaled by laser sensitivity, so at 0 the rig keeps
    // the old continuous sweep and never snaps.
    const bt = beat.current;
    if (s.beat && sens > 0.05) {
      bt.step++;
      bt.punch = 1;
      // walk the fan position in a musical pattern rather than at random:
      // right, left, centre, wide, so a bar reads as a phrase
      const pattern = [0.55, -0.55, 0.12, -0.9, 0.9, -0.2];
      bt.panTarget = pattern[bt.step % pattern.length];
    }
    bt.punch *= Math.pow(0.5, s.dt / 0.09); // ~90ms half-life

    // ---- laser stroboscope ------------------------------------------------
    // Beams chop on and off in time with the tempo. The duty cycle narrows as
    // the strobe amount rises, so at full it is a hard flash rather than a beam.
    const strobeAmt = s.settings.laserStrobe * sens;
    const bpmNow = s.audio.bpm > 0 ? s.audio.bpm : 128;
    const hz = (bpmNow / 60) * (strobeAmt > 0.66 ? 4 : strobeAmt > 0.33 ? 2 : 1); // 1/4 or 1/8 notes
    const cyclePos = (s.time * hz) % 1;
    const duty = 0.85 - strobeAmt * 0.6; // 0.85 (barely chopped) .. 0.25 (hard strobe)
    const strobeGate = strobeAmt < 0.02 ? 1 : cyclePos < duty ? 1 : 1 - strobeAmt;

    // ---- mirrored chase ----------------------------------------------------
    // Fixtures open from the centre outward in symmetric pairs, one rank per
    // beat, then close back in. Purely positional, so it reads as a mirror.
    const chaseAmt = s.settings.mirrorChase;
    const chaseStep = bt.step;
    // snap toward the stepped position quickly, so it lands with the kick
    bt.lastPan += (bt.panTarget - bt.lastPan) * Math.min(1, s.dt / 0.055);
    const beatStep = sens;

    // when every fixture fires, slow the sweep a little so the picture stays readable
    // Tempo drives rotation: a 128 BPM track sits at 1.0, faster tracks spin the
    // fans harder, slower ones settle. Clamped so a bad tempo read cannot run away.
    const bpm = s.audio.bpm;
    const tempoScale = bpm > 0 ? Math.min(1.9, Math.max(0.55, bpm / 128)) : 1;
    // With the beat step driving the pan, the continuous drift slows down so the
    // two do not fight each other.
    const sweepSpeed =
      s.pace * (0.15 + sm.mid * 0.25 * sens) * (1 + build * 0.6) * (1 - director.gAll * 0.35) * (1 - sens * 0.45) * tempoScale;
    // whole-number line counts: a fractional count would shift every line each frame
    const sweepLines = Math.round(6 + s.settings.laserDensity * 4 + build * 5);

    for (let i = 0; i < fixtures.length; i++) {
      const g = fanRefs.current[i];
      const m = materials[i];
      const f = fixtures[i];
      if (!g) continue;
      // Which fixtures fire right now: top centre, whole top row, bottom centre,
      // whole bottom row, or everything; weights crossfade between groups.
      // "centre" is the inner third of a row: a tight cluster, not most of it
      const isMiddle = Math.abs(f.x) < 4.6;
      const rowWeight = f.fromTruss
        ? Math.max(director.gTop, isMiddle ? director.gTopMid : 0)
        : Math.max(director.gBottom, isMiddle ? director.gBotMid : 0);
      const groupFactor = Math.max(director.gAll, rowWeight);
      // Mirror chase: a triangular wave over rank opens outward then closes in,
      // advancing one rank per beat. Pairs either side of centre move together.
      let chaseGate = 1;
      if (chaseAmt > 0.02 && f.mirrorCount > 1) {
        const span = f.mirrorCount;
        const pos = chaseStep % (span * 2);
        const front = pos < span ? pos : span * 2 - 1 - pos; // out then back
        const lit = f.mirrorRank <= front ? 1 : 0;
        chaseGate = 1 - chaseAmt * (1 - lit);
      }
      const fixtureWeight = weight * groupFactor * chaseGate * strobeGate;
      const visible = fixtureWeight > 0.01;
      g.visible = visible;
      laserColorFor(emitterMats[i].color, s.settings.laserColor, i, s.colorA, s.colorB)
        .lerp(WHITE, 0.5)
        .multiplyScalar(0.4 + weight * 0.8);
      if (!visible) continue;

      const t = s.time * sweepSpeed * f.speed + f.phase;
      // All poses keep the lowest line of every fan above the viewer's eye
      // line, so beams pass overhead like a real rig instead of through the
      // camera. Tilt is measured from vertical toward the audience.
      // Sweep pose: fans rise and fall over the crowd, pan drifts slowly.
      const sweepTilt = (f.fromTruss ? 0.6 : 0.45) + Math.sin(t) * 0.2;
      // Continuous drift, crossfaded with the beat-stepped position. Mirroring
      // alternate fixtures makes the step read as the rig opening and closing.
      const driftPan = Math.sin(t * 0.6 + f.phase) * 0.3;
      const steppedPan = bt.lastPan * (i % 2 === 0 ? 1 : -1) * 0.55;
      const sweepPan = driftPan * (1 - beatStep) + steppedPan * beatStep;
      // Mesh pose: every fan fires up and out at the same steady angle with
      // alternating pans, so neighbouring fans cross into a lattice overhead.
      const meshTilt = (f.fromTruss ? 0.85 : 0.7) + Math.sin(s.time * 0.12 * s.pace * tempoScale + f.phase) * 0.03;
      // the lattice itself drifts with the tempo so a fast track never looks frozen
      const meshPan = f.meshPan + Math.sin(s.time * 0.1 * s.pace * tempoScale + f.phase) * 0.04 * (1 + sens);
      // Audience pose: narrow bundles skimming just over the heads toward the viewer.
      // floor fans open toward the viewer and slowly sweep across eye level
      const aimTilt = (f.fromTruss ? 1.45 : 0.92) + Math.sin(s.time * 0.18 * s.pace + f.phase) * 0.08;
      const aimPan = (i % 2 === 0 ? 0.25 : -0.25) + Math.sin(s.time * 0.1 * s.pace + f.phase) * 0.12;

      // Sheet pose: a nearly flat plane seen almost edge-on, scanning slowly
      // between overhead and just above the crowd; fixtures are staggered so the
      // planes stack at different heights.
      const sheetTilt = (f.fromTruss ? 1.47 : 1.35) + Math.sin(s.time * 0.2 * s.pace + i * 0.55) * (f.fromTruss ? 0.05 : 0.12);
      const sheetPan = (i % 2 === 0 ? 0.06 : -0.06);

      const tilt = sweepTilt * wSweep + meshTilt * wMesh + aimTilt * wAim + sheetTilt * wSheet;
      const pan = sweepPan * wSweep + meshPan * wMesh + aimPan * wAim + sheetPan * wSheet;
      // Truss fans point down (flipped around z); negative tilt leans them toward the camera.
      g.rotation.set(f.fromTruss ? -tilt : tilt, pan, f.fromTruss ? Math.PI : 0);

      const u = m.uniforms;
      u.uTime.value = s.time;
      u.uTreble.value = s.treble * 0.3 * sens;
      // the fast punch (not the slow envelope) is what makes the hit visible
      u.uBeat.value = Math.max(s.beatEnv * 0.3, bt.punch * 0.9) * sens * (1 - wMesh * 0.5);
      u.uIntensity.value =
        fixtureWeight *
        s.settings.intensity *
        (1 - sens * 0.4 + sm.amp * 0.4 * sens) *
        (1 + bt.punch * 0.55 * sens) *
        (1 + wMesh * 0.3 + wAim * 0.2 - wSheet * 0.5 + director.white * 0.4);
      u.uLines.value = Math.round(sweepLines * wSweep + 16 * wMesh + 9 * wAim + 40 * wSheet);
      // the fan opens a little wider on the beat and closes between hits
      const beatSpread = 1 + bt.punch * 0.22 * sens;
      u.uSpread.value = (1.0 * wSweep + 0.7 * wAim) * beatSpread + 0.9 * wMesh + 2.4 * wSheet;
      // sheets use very wide beams so the lines fuse into one solid plane
      u.uWidth.value = 0.045 + wSheet * 1.5 + director.white * 0.02;
      u.uBorder.value = 0;
      // uSweep rolls the fan about its own axis. With a tempo it rolls steadily,
      // faster on quicker tracks and reversing per fixture so the rig counter-rotates.
      const rollDir = i % 2 === 0 ? 1 : -1;
      const roll = s.time * 0.22 * tempoScale * s.pace * sens * rollDir;
      u.uSweep.value =
        (Math.sin(t * 0.8) * 0.35 * (1 - sens) + Math.sin(roll) * 0.5 * sens) * wSweep +
        Math.sin(s.time * 0.08 + f.phase) * 0.08 * (wMesh + wAim);
      // Real laser fans are one colour each: a fixed tint, the palette colour,
      // green alternating with it, or a different colour per fixture (rainbow).
      const col = laserColorFor(u.uColorA.value as THREE.Color, s.settings.laserColor, i, s.colorA, s.colorB);
      // white lasers right after a drop, fading back to colour
      if (director.white > 0) col.lerp(WHITE, director.white);
      (u.uColorB.value as THREE.Color).copy(col);
    }
  });

  return (
    <group>
      {fixtures.map((f, i) => (
        <group key={i} position={[f.x, f.y, f.z]}>
          {/* laser head: housing sits just behind the emitter, the fan apex is the emitter */}
          <mesh geometry={headGeo} material={headMat} position={[0, f.fromTruss ? 0.18 : -0.18, -0.2]} />
          <mesh geometry={emitterGeo} material={emitterMats[i]} />
          <group
            ref={(el) => {
              fanRefs.current[i] = el;
            }}
          >
            <mesh geometry={geometry} material={materials[i]} position={[0, FAN_SIZE / 2, 0]} frustumCulled={false} />
          </group>
        </group>
      ))}
    </group>
  );
}

const WHITE = new THREE.Color(1, 1, 1);

/** Fixed laser colours, looked up once, keyed by id. */
const FIXED_COLORS = new Map<string, THREE.Color>(
  LASER_COLORS.filter((c) => c.rgb).map((c) => [c.id, new THREE.Color(...(c.rgb as [number, number, number]))]),
);
const RAINBOW = RAINBOW_ORDER.map((id) => FIXED_COLORS.get(id) ?? WHITE);

/**
 * Colour for fixture `i`: a fixed laser tint, the palette colour, green
 * alternating with the palette, or a different colour per fixture (rainbow).
 */
export function laserColorFor(out: THREE.Color, mode: string, i: number, colorA: THREE.Color, colorB: THREE.Color): THREE.Color {
  const fixed = FIXED_COLORS.get(mode);
  if (fixed) return out.copy(fixed);
  if (mode === 'rainbow') return out.copy(RAINBOW[i % RAINBOW.length]);
  if (mode === 'mixed' && i % 2 === 1) return out.copy(FIXED_COLORS.get('green') ?? WHITE);
  return out.copy(i % 2 === 0 ? colorA : colorB);
}
