import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from './fiber';
import { beamFragment, beamVertex, laserFragment, laserVertex } from './shaders';
import { director, stage } from './stageState';
import { useSettings } from '../state/settingsStore';
import { laserColorFor } from './LaserRig';
import { pointerAim } from './pointerAim';

const CONE_RADIUS = 1.7;
/** Unit side cone; world radius is applied with scale from `sideBeamAperture`. */
const SIDE_CONE_RADIUS = 1;
const BEAM_LENGTH = 22;
const BORDER_FAN = 26;
/** Two edge rays sit just outside the cone so they read as its silhouette. */
const CONE_SPREAD = 2 * Math.atan(CONE_RADIUS / BEAM_LENGTH) * 1.12;
const SIDE_RADIUS_MIN = 0.32;
const SIDE_RADIUS_MAX = 1.28;

function sideBeamRadius(aperture: number) {
  return SIDE_RADIUS_MIN + Math.max(0, Math.min(1, aperture ?? 0.5)) * (SIDE_RADIUS_MAX - SIDE_RADIUS_MIN);
}

function coneSpread(radius: number) {
  return 2 * Math.atan(radius / BEAM_LENGTH) * 1.12;
}

const TRUSS_Y = 9.4;
const TRUSS_Z = -2.5;
/** Inside the FOH frame, on the stage wings — x=12 sat off-screen. */
const SIDE_X = 8.7;
const SIDE_Z = 3.2;
const DOWN = new THREE.Vector3(0, -1, 0);

type Bank = 'truss' | 'side';

interface Head {
  x: number;
  y: number;
  z: number;
  bank: Bank;
  /** -1 left tower, 1 right tower, 0 truss */
  side: -1 | 0 | 1;
  phase: number;
  dir: number;
  seed: number;
}

function chaseOrder(a: Head, b: Head): number {
  if (a.bank !== b.bank) return a.bank === 'truss' ? -1 : 1;
  if (a.bank === 'truss') return a.x - b.x;
  if (a.side !== b.side) return a.side - b.side;
  return a.y - b.y;
}

function buildHeads(count: number): Head[] {
  const heads: Head[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    heads.push({
      x: (t - 0.5) * 20,
      y: TRUSS_Y,
      z: TRUSS_Z,
      bank: 'truss',
      side: 0,
      phase: i * 0.9,
      dir: i % 2 === 0 ? 1 : -1,
      seed: Math.random(),
    });
  }
  const perSide = 3;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < perSide; i++) {
      const t = i / (perSide - 1);
      heads.push({
        x: SIDE_X * side,
        y: 1.35 + t * 5.4,
        z: SIDE_Z,
        bank: 'side',
        side,
        phase: i * 1.15 + (side < 0 ? 0.3 : 1.8),
        dir: 1,
        seed: Math.random(),
      });
    }
  }
  return heads;
}

/**
 * Moving heads on the overhead truss and on the left/right towers. The
 * director crossfades the two banks so the side shafts swap with the vertical
 * ones instead of sitting on together. Each head has a sweep pose and an
 * audience pose; border lasers ride on the cone when that look is up.
 */
export function BeamArray() {
  const { beamCount: count, sideBeamAperture } = useSettings();
  const camera = useThree((s) => s.camera);
  const heads = useMemo(() => buildHeads(count), [count]);
  const sideRadius = sideBeamRadius(sideBeamAperture);
  const sideScale = sideRadius / SIDE_CONE_RADIUS;

  const coneGeo = useMemo(() => new THREE.ConeGeometry(CONE_RADIUS, BEAM_LENGTH, 20, 1, true), []);
  const sideConeGeo = useMemo(() => new THREE.ConeGeometry(SIDE_CONE_RADIUS, BEAM_LENGTH, 20, 1, true), []);
  const lensGeo = useMemo(() => new THREE.SphereGeometry(0.06, 8, 8), []);
  const sideLensGeo = useMemo(() => new THREE.SphereGeometry(0.13, 10, 10), []);
  const headGeo = useMemo(() => new THREE.BoxGeometry(0.42, 0.28, 0.5), []);
  const headMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x1a1a20, metalness: 0.75, roughness: 0.4 }),
    [],
  );
  const borderGeo = useMemo(() => new THREE.PlaneGeometry(BORDER_FAN, BORDER_FAN), []);
  const materials = useMemo(
    () =>
      heads.map(
        (h) =>
          new THREE.ShaderMaterial({
            vertexShader: beamVertex,
            fragmentShader: beamFragment,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: {
              uColor: { value: new THREE.Color() },
              uIntensity: { value: 0.5 },
              uTime: { value: 0 },
              uSeed: { value: h.seed },
            },
          }),
      ),
    [heads],
  );
  const lensMaterials = useMemo(() => heads.map(() => new THREE.MeshBasicMaterial({ color: 0xffffff })), [heads]);
  const borderMats = useMemo(
    () =>
      heads.map(
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
              uIntensity: { value: 0 },
              uLines: { value: 2 },
              uSpread: { value: CONE_SPREAD },
              uSweep: { value: 0 },
              uFanSize: { value: BORDER_FAN },
              uWidth: { value: 0.05 },
              uBorder: { value: 1 },
              uColorA: { value: new THREE.Color() },
              uColorB: { value: new THREE.Color() },
            },
          }),
      ),
    [heads],
  );

  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose());
      lensMaterials.forEach((m) => m.dispose());
      borderMats.forEach((m) => m.dispose());
    },
    [materials, lensMaterials, borderMats],
  );
  useEffect(
    () => () => {
      coneGeo.dispose();
      sideConeGeo.dispose();
      lensGeo.dispose();
      sideLensGeo.dispose();
      borderGeo.dispose();
      headGeo.dispose();
      headMat.dispose();
    },
    [coneGeo, sideConeGeo, lensGeo, sideLensGeo, borderGeo, headGeo, headMat],
  );

  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const coneRefs = useRef<(THREE.Mesh | null)[]>([]);
  const borderRefs = useRef<(THREE.Group | null)[]>([]);
  const punch = useRef(0);
  const followAmt = useRef(0);
  const chaseStep = useRef(0);
  const chaseLive = useRef<number[]>([]);
  const scratch = useMemo(
    () => ({
      euler: new THREE.Euler(),
      qSweep: new THREE.Quaternion(),
      qAim: new THREE.Quaternion(),
      qFocus: new THREE.Quaternion(),
      qMouse: new THREE.Quaternion(),
      qMix: new THREE.Quaternion(),
      qCloud: new THREE.Quaternion(),
      headPos: new THREE.Vector3(),
      target: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      inward: new THREE.Vector3(),
      cloud: new THREE.Vector3(),
    }),
    [],
  );

  useFrame(() => {
    const s = stage;
    followAmt.current += ((pointerAim.held ? 1 : 0) - followAmt.current) * Math.min(1, s.dt / 1.15);
    const follow = followAmt.current;
    const weight = s.settings.beamsEnabled
      ? Math.max(director.beams * (1 - director.blackout), follow * 0.75)
      : 0;
    const borderW = s.settings.lasersEnabled ? director.border * (1 - director.blackout) : 0;
    const enabled = weight > 0.01 || borderW > 0.01;
    const aim = director.beamAim;
    // Beam sensitivity: the user's setting scaled by the director's reactivity,
    // which collapses during speech so the heads keep a steady sweep.
    const sens = s.settings.beamSensitivity * director.react;
    const laserSens = s.settings.laserSensitivity * director.react;
    const speed = s.pace * (0.2 + s.mid * 0.4 * sens);
    const { euler, qSweep, qAim, qFocus, qMouse, qMix, qCloud, headPos, target, dir, inward, cloud } = scratch;
    const eyes = director.beamAim || 0;
    const canopy = director.beamCloud || 0;

    if (s.beat && laserSens > 0.05) punch.current = 1;
    if (s.beat && s.settings.beamChase > 0.02) chaseStep.current++;
    punch.current *= Math.pow(0.5, s.dt / 0.09);
    const beatHi = Math.max(s.beatEnv, punch.current);
    const strobeAmt = Math.min(1, s.settings.laserStrobe * laserSens + borderW * beatHi * 0.9);
    const bpmNow = s.audio.bpm > 0 ? s.audio.bpm : 128;
    const beamStrobeAmt = s.settings.beamStrobe * sens;
    let beamStrobeGate = 1;
    if (beamStrobeAmt >= 0.02) {
      if (beamStrobeAmt < 0.33) {
        beamStrobeGate = 1 - beamStrobeAmt + beamStrobeAmt * Math.min(1, beatHi * 2.4);
      } else {
        const beamHz = (bpmNow / 60) * (beamStrobeAmt > 0.66 ? 4 : 2);
        const beamDuty = 0.82 - beamStrobeAmt * 0.55;
        beamStrobeGate = (s.time * beamHz) % 1 < beamDuty ? 1 : 1 - beamStrobeAmt;
      }
    }
    const chaseAmt = s.settings.beamChase;
    const live = chaseLive.current;
    live.length = 0;
    if (chaseAmt > 0.02 && enabled) {
      for (let i = 0; i < heads.length; i++) {
        const h = heads[i];
        const bankW = h.bank === 'truss' ? director.bTruss : director.bSide;
        if (weight * bankW > 0.15) live.push(i);
      }
      live.sort((a, b) => chaseOrder(heads[a], heads[b]));
    }
    const litIdx = live.length > 0 ? chaseStep.current % live.length : 0;
    const hz = (bpmNow / 60) * (strobeAmt > 0.66 ? 4 : strobeAmt > 0.33 ? 2 : 1);
    const duty = 0.85 - strobeAmt * 0.6;
    const strobeGate = strobeAmt < 0.02 || (s.time * hz) % 1 < duty ? 1 : 1 - strobeAmt;
    const cueFade = director.cueTime < 3 ? 1 - director.cueTime / 3 : 0;
    const noBeat = 1 - Math.min(1, beatHi * 1.8 + director.react * 0.25);
    const borderThick = Math.max(noBeat, cueFade);
    const tempoScale = s.audio.bpm > 0 ? Math.min(1.9, Math.max(0.55, s.audio.bpm / 128)) : 1;

    for (let i = 0; i < heads.length; i++) {
      const g = groupRefs.current[i];
      const h = heads[i];
      const m = materials[i];
      if (!g) continue;
      const bankW = h.bank === 'truss' ? director.bTruss : director.bSide;
      const fixtureW = weight * bankW;
      const on = enabled && (fixtureW > 0.01 || borderW * bankW > 0.01);
      g.visible = on;
      if (!on) continue;
      const t = s.time * speed + h.phase;

      headPos.set(h.x, h.y, h.z);
      const towardMiddle = -h.side;
      if (h.bank === 'truss') {
        euler.set(0.35 + Math.sin(t * 0.8) * 0.4, 0, Math.sin(t * 0.55 + h.phase) * 0.6 * h.dir);
        qSweep.setFromEuler(euler);
        // Crowd eyes: into the house, short of the FOH lens so the cone never swallows the camera.
        target.set(camera.position.x + h.x * 0.08 + h.dir * 0.9, 4.8, camera.position.z - 8);
      } else {
        // Left bank yaws toward the right, right toward the left. Slow cosine
        // throw so the shafts glide across the crowd; when not in a focal cue
        // they occasionally open into a wider, faster sweep.
        const free = Math.max(0, 1 - director.focus);
        const period = 8.2 + h.seed * 5.4;
        const cycle = ((s.time * s.pace + h.phase * 1.7) / period) % 1;
        const occ = cycle < 0.24 ? Math.sin((cycle / 0.24) * Math.PI) : 0;
        const spin = occ * occ * free;
        const slow = s.time * s.pace * (0.16 + spin * 0.46) + h.phase;
        const ease = 0.5 - 0.5 * Math.cos(slow);
        const throwAmt = 0.38 + ease * (0.55 + spin * 0.72);
        const yaw = towardMiddle * throwAmt + spin * Math.sin(s.time * s.pace * 1.7 + h.phase) * 0.32;
        const pitch = 0.34 + Math.sin(slow * 0.55) * (0.14 + spin * 0.36);
        inward.set(Math.sin(yaw), pitch, Math.cos(yaw));
        qSweep.setFromUnitVectors(DOWN, dir.copy(inward).normalize());
        target.set(camera.position.x + towardMiddle * 1.4, 4.6, camera.position.z - 8);
      }
      dir.subVectors(target, headPos).normalize();
      qAim.setFromUnitVectors(DOWN, dir);
      // Wide canopy above the crowd — each head fans out so the shafts read as a cloud.
      if (h.bank === 'truss') {
        const nx = h.x / 10;
        cloud.set(nx * 18, 17 + h.seed * 3.5, 8 + (1 - Math.abs(nx)) * 5);
      } else {
        cloud.set(h.side * 16, 15 + h.seed * 3, 7 + h.y * 0.35);
      }
      dir.copy(cloud).sub(headPos).normalize();
      qCloud.setFromUnitVectors(DOWN, dir);
      // Crowd cue: keep the live sweep, peel into the eyes, then lift into the cloud.
      const crowdCue = director.look === 'beamsAudience';
      const localAim = h.bank === 'side' && !crowdCue ? aim * director.focus : eyes;
      qMix.copy(qSweep).slerp(qAim, localAim);
      if (crowdCue && canopy > 0.001) qMix.slerp(qCloud, canopy);
      if (director.focus > 0.01) {
        dir.set(director.focusX - headPos.x, director.focusY - headPos.y, director.focusZ - headPos.z).normalize();
        qFocus.setFromUnitVectors(DOWN, dir);
        qMix.slerp(qFocus, director.focus);
      }
      if (follow > 0.01) {
        dir.subVectors(pointerAim.point, headPos).normalize();
        qMouse.setFromUnitVectors(DOWN, dir);
        qMix.slerp(qMouse, follow);
      }
      const slew = crowdCue ? 0.42 : h.bank === 'side' && director.focus < 0.2 ? 0.72 : 0.9;
      g.quaternion.slerp(qMix, Math.min(1, s.dt / slew));
      const cone = coneRefs.current[i];
      if (cone) {
        const base = h.bank === 'side' ? sideScale : 1;
        const bloom = 1 + canopy * 0.55;
        cone.scale.set(base * bloom, 1, base * bloom);
      }

      let chaseGate = 1;
      if (chaseAmt > 0.02 && live.length > 1) {
        const pos = live.indexOf(i);
        chaseGate = pos === litIdx ? 1 : 1 - chaseAmt;
      }
      const chop = beamStrobeGate * chaseGate;
      const u = m.uniforms;
      u.uTime.value = s.time;
      const sideBoost = h.bank === 'side' ? 1.45 : 1;
      u.uIntensity.value =
        fixtureW *
        sideBoost *
        chop *
        s.intensity *
        (1 - sens * 0.55 + s.amp * 0.7 * sens) *
        (1 + s.beatEnv * 0.25 * sens - 0.1) *
        (1 - eyes * 0.7);
      (u.uColor.value as THREE.Color).copy(i % 3 === 0 ? s.colorB : i % 3 === 1 ? s.colorA : s.colorC);
      const lens = lensMaterials[i];
      lens.color
        .copy(u.uColor.value as THREE.Color)
        .lerp(WHITE, 0.1 + s.beatEnv * 0.3 + eyes * 0.5)
        .multiplyScalar((0.5 + fixtureW * 0.5) * (0.25 + 0.75 * chop));

      const bg = borderRefs.current[i];
      const bm = borderMats[i];
      if (!bg) continue;
      const borderOn = borderW * bankW * strobeGate;
      bg.visible = borderOn > 0.01;
      if (!bg.visible) continue;
      const rollDir = i % 2 === 0 ? 1 : -1;
      bg.rotation.set(0, s.time * 0.35 * tempoScale * s.pace * rollDir, Math.PI);
      const bu = bm.uniforms;
      bu.uTime.value = s.time;
      bu.uTreble.value = s.treble * 0.3 * laserSens;
      bu.uBeat.value = beatHi * laserSens;
      bu.uIntensity.value = borderOn * s.settings.intensity * (0.85 + beatHi * 0.45);
      bu.uSpread.value = h.bank === 'side' ? coneSpread(sideBeamRadius(s.settings.sideBeamAperture)) : CONE_SPREAD;
      bu.uWidth.value = 0.05 + borderThick * 0.22;
      bu.uSweep.value = 0;
      const col = laserColorFor(bu.uColorA.value as THREE.Color, s.settings.laserColor, i, s.colorA, s.colorB);
      if (director.white > 0) col.lerp(WHITE, director.white);
      (bu.uColorB.value as THREE.Color).copy(col);
    }
  });

  return (
    <group>
      {heads.map((h, i) => (
        <group
          key={`${h.bank}-${i}`}
          position={[h.x, h.y, h.z]}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
        >
          {h.bank === 'side' && <mesh geometry={headGeo} material={headMat} position={[0, 0.16, 0]} />}
          <mesh geometry={h.bank === 'side' ? sideLensGeo : lensGeo} material={lensMaterials[i]} />
          {/* cone apex sits at the fixture, opening along local -y */}
          <mesh
            geometry={h.bank === 'side' ? sideConeGeo : coneGeo}
            material={materials[i]}
            position={[0, -BEAM_LENGTH / 2, 0]}
            scale={h.bank === 'side' ? [sideScale, 1, sideScale] : 1}
            frustumCulled={false}
            ref={(el) => {
              coneRefs.current[i] = el;
            }}
          />
          {/* two crossed fans: the four generators of the cone, locked to this head */}
          <group
            ref={(el) => {
              borderRefs.current[i] = el;
            }}
            rotation={[0, 0, Math.PI]}
          >
            <mesh geometry={borderGeo} material={borderMats[i]} position={[0, BORDER_FAN / 2, 0]} frustumCulled={false} />
            <mesh
              geometry={borderGeo}
              material={borderMats[i]}
              position={[0, BORDER_FAN / 2, 0]}
              rotation={[0, Math.PI / 2, 0]}
              frustumCulled={false}
            />
          </group>
        </group>
      ))}
    </group>
  );
}

const WHITE = new THREE.Color(1, 1, 1);
