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
}

function buildFixtures(density: number, style: RigStyle): Fixture[] {
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
    });
  }
  // Truss-mounted lasers (the original festival rig) fire down and out over
  // the crowd. The arena style leaves them off for a cleaner picture. The row
  // matches the floor row in size so a "top only" cue reads as a full row and
  // "top centre" lights several fixtures rather than one.
  const trussCount: number = style === 'arena' ? 0 : Math.round(3 + density * 5);
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
    });
  }
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
    const weight = s.settings.lasersEnabled ? Math.min(1, director.lasers + build * 0.6) * (1 - director.blackout) : 0;
    const wMesh = director.mesh;
    const wSheet = director.sheet * (1 - wMesh);
    const wAim = director.laserAim * (1 - wMesh - wSheet);
    const wSweep = Math.max(0, 1 - wMesh - wSheet - wAim);
    // when every fixture fires, slow the sweep a little so the picture stays readable
    const sweepSpeed = s.pace * (0.15 + sm.mid * 0.25 * sens) * (1 + build * 0.6) * (1 - director.gAll * 0.35);
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
      const fixtureWeight = weight * groupFactor;
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
      const sweepPan = Math.sin(t * 0.6 + f.phase) * 0.3;
      // Mesh pose: every fan fires up and out at the same steady angle with
      // alternating pans, so neighbouring fans cross into a lattice overhead.
      const meshTilt = (f.fromTruss ? 0.85 : 0.7) + Math.sin(s.time * 0.12 * s.pace + f.phase) * 0.03;
      const meshPan = f.meshPan + Math.sin(s.time * 0.1 * s.pace + f.phase) * 0.04;
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
      u.uBeat.value = s.beatEnv * 0.4 * sens * (1 - wMesh * 0.7);
      u.uIntensity.value =
        fixtureWeight *
        s.settings.intensity *
        (1 - sens * 0.4 + sm.amp * 0.4 * sens) *
        (1 + wMesh * 0.3 + wAim * 0.2 - wSheet * 0.5 + director.white * 0.4);
      u.uLines.value = Math.round(sweepLines * wSweep + 16 * wMesh + 9 * wAim + 40 * wSheet);
      u.uSpread.value = 1.0 * wSweep + 0.9 * wMesh + 0.7 * wAim + 2.4 * wSheet;
      // sheets use very wide beams so the lines fuse into one solid plane
      u.uWidth.value = 0.045 + wSheet * 1.5 + director.white * 0.02;
      u.uSweep.value = Math.sin(t * 0.8) * 0.35 * wSweep + Math.sin(s.time * 0.08 + f.phase) * 0.08 * (wMesh + wAim);
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
function laserColorFor(out: THREE.Color, mode: string, i: number, colorA: THREE.Color, colorB: THREE.Color): THREE.Color {
  const fixed = FIXED_COLORS.get(mode);
  if (fixed) return out.copy(fixed);
  if (mode === 'rainbow') return out.copy(RAINBOW[i % RAINBOW.length]);
  if (mode === 'mixed' && i % 2 === 1) return out.copy(FIXED_COLORS.get('green') ?? WHITE);
  return out.copy(i % 2 === 0 ? colorA : colorB);
}
