import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from './fiber';
import { beamFragment, beamVertex } from './shaders';
import { director, stage } from './stageState';
import { useSettings } from '../state/settingsStore';

const BEAM_LENGTH = 22;
const TRUSS_POS = new THREE.Vector3(0, 9.4, -2.5);
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Moving-head fixtures on the truss. Two poses, crossfaded by the director:
 *  - sweep: slow pan/tilt sinusoids (mids add a little urgency)
 *  - audience: heads point into the viewer's eyes and drift across them, the
 *    classic blinder moment
 */
export function BeamArray() {
  const count = useSettings().beamCount;
  const camera = useThree((s) => s.camera);
  const heads = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const t = count === 1 ? 0.5 : i / (count - 1);
        return {
          x: (t - 0.5) * 20,
          phase: i * 0.9,
          dir: i % 2 === 0 ? 1 : -1,
          seed: Math.random(),
        };
      }),
    [count],
  );

  const coneGeo = useMemo(() => new THREE.ConeGeometry(1.7, BEAM_LENGTH, 20, 1, true), []);
  const lensGeo = useMemo(() => new THREE.SphereGeometry(0.06, 8, 8), []);
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

  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose());
      lensMaterials.forEach((m) => m.dispose());
    },
    [materials, lensMaterials],
  );
  useEffect(
    () => () => {
      coneGeo.dispose();
      lensGeo.dispose();
    },
    [coneGeo, lensGeo],
  );

  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const scratch = useMemo(
    () => ({
      euler: new THREE.Euler(),
      qSweep: new THREE.Quaternion(),
      qAim: new THREE.Quaternion(),
      headPos: new THREE.Vector3(),
      target: new THREE.Vector3(),
      dir: new THREE.Vector3(),
    }),
    [],
  );

  useFrame(() => {
    const s = stage;
    const weight = s.settings.beamsEnabled ? director.beams * (1 - director.blackout) : 0;
    const enabled = weight > 0.01;
    const aim = director.beamAim;
    // Beam sensitivity: the user's setting scaled by the director's reactivity,
    // which collapses during speech so the heads keep a steady sweep.
    const sens = s.settings.beamSensitivity * director.react;
    const speed = s.pace * (0.2 + s.mid * 0.4 * sens);
    const { euler, qSweep, qAim, headPos, target, dir } = scratch;

    for (let i = 0; i < heads.length; i++) {
      const g = groupRefs.current[i];
      const h = heads[i];
      const m = materials[i];
      if (!g) continue;
      g.visible = enabled;
      if (!enabled) continue;
      const t = s.time * speed + h.phase;

      // Sweep pose
      euler.set(0.35 + Math.sin(t * 0.8) * 0.4, 0, Math.sin(t * 0.55 + h.phase) * 0.6 * h.dir);
      qSweep.setFromEuler(euler);

      // Audience pose: shafts aimed just beside and above the viewer, drifting
      // slowly so they occasionally sweep across the eye line without parking
      // the camera inside a cone.
      headPos.set(TRUSS_POS.x + h.x, TRUSS_POS.y, TRUSS_POS.z);
      target
        .copy(camera.position)
        .add(
          dir.set(
            h.dir * 4.5 + Math.sin(s.time * 0.2 * s.pace + h.phase) * 3.5,
            2.2 + Math.sin(s.time * 0.17 * s.pace + h.phase * 0.7) * 1.5,
            0,
          ),
        );
      dir.subVectors(target, headPos).normalize();
      qAim.setFromUnitVectors(DOWN, dir);

      g.quaternion.copy(qSweep).slerp(qAim, aim);

      const u = m.uniforms;
      u.uTime.value = s.time;
      u.uIntensity.value =
        weight * s.intensity * (1 - sens * 0.55 + s.amp * 0.7 * sens) * (1 + s.beatEnv * 0.25 * sens - 0.1) * (1 - aim * 0.5);
      (u.uColor.value as THREE.Color).copy(i % 3 === 0 ? s.colorB : i % 3 === 1 ? s.colorA : s.colorC);
      const lens = lensMaterials[i];
      lens.color.copy(u.uColor.value as THREE.Color).lerp(WHITE, 0.1 + s.beatEnv * 0.3 + aim * 0.5).multiplyScalar(0.5 + weight * 0.5);
    }
  });

  return (
    <group position={TRUSS_POS}>
      {heads.map((h, i) => (
        <group
          key={i}
          position={[h.x, 0, 0]}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
        >
          <mesh geometry={lensGeo} material={lensMaterials[i]} />
          {/* cone apex sits at the fixture, opening along local -y */}
          <mesh geometry={coneGeo} material={materials[i]} position={[0, -BEAM_LENGTH / 2, 0]} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}

const WHITE = new THREE.Color(1, 1, 1);
