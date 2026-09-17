import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from './fiber';
import { beamFragment, beamVertex, laserVertex, strobeFragment } from './shaders';
import { director, stage } from './stageState';

const COUNT = 8;
const CONE_LENGTH = 26;
const WASH_POS = new THREE.Vector3(0, 9.1, -2.2);
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * White wash: a row of open-white fixtures on the truss. A white-out flash
 * (director.whiteFlash) lasts half a second: the cones slam on, spin across
 * the eye line, then dump. A keyboard bump is the same flood without the whip.
 * Driven by director.wash.
 */
export function WhiteWash() {
  const heads = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        x: (i / (COUNT - 1) - 0.5) * 22,
        tilt: 0.55 + Math.abs(i / (COUNT - 1) - 0.5) * 0.25,
        phase: i * 0.85,
        dir: i % 2 === 0 ? 1 : -1,
      })),
    [],
  );

  const coneGeo = useMemo(() => new THREE.ConeGeometry(4.2, CONE_LENGTH, 18, 1, true), []);
  const lensGeo = useMemo(() => new THREE.SphereGeometry(0.16, 8, 8), []);
  const coneMats = useMemo(
    () =>
      heads.map(
        (_, i) =>
          new THREE.ShaderMaterial({
            vertexShader: beamVertex,
            fragmentShader: beamFragment,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: {
              uColor: { value: new THREE.Color(1, 0.985, 0.95) },
              uIntensity: { value: 0 },
              uTime: { value: 0 },
              uSeed: { value: i * 0.37 },
            },
          }),
      ),
    [heads],
  );
  const lensMats = useMemo(() => heads.map(() => new THREE.MeshBasicMaterial({ color: 0xffffff })), [heads]);

  // Full-screen white veil so a full wash actually blows the picture out.
  const veilGeo = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  const veilMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: laserVertex,
        fragmentShader: strobeFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uFlash: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) } },
      }),
    [],
  );

  useEffect(
    () => () => {
      coneMats.forEach((m) => m.dispose());
      lensMats.forEach((m) => m.dispose());
      veilMat.dispose();
      coneGeo.dispose();
      lensGeo.dispose();
      veilGeo.dispose();
    },
    [coneMats, lensMats, veilMat, coneGeo, lensGeo, veilGeo],
  );

  const camera = useThree((st) => st.camera);
  const scene = useThree((st) => st.scene);
  const groupRef = useRef<THREE.Group>(null);
  const veilRef = useRef<THREE.Mesh>(null);
  const headRefs = useRef<(THREE.Group | null)[]>([]);
  const scratch = useMemo(
    () => ({
      euler: new THREE.Euler(),
      qFlood: new THREE.Quaternion(),
      qSweep: new THREE.Quaternion(),
      qAim: new THREE.Quaternion(),
      qLive: new THREE.Quaternion(),
      headPos: new THREE.Vector3(),
      target: new THREE.Vector3(),
      dir: new THREE.Vector3(),
    }),
    [],
  );

  // Park the veil just in front of the camera so it covers the frame at any
  // window size, and keep it there as the camera dollies.
  useEffect(() => {
    const mesh = new THREE.Mesh(veilGeo, veilMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 999;
    mesh.position.set(0, 0, -0.2);
    const cam = camera as THREE.PerspectiveCamera;
    const h = 2 * Math.tan((cam.fov * Math.PI) / 360) * 0.2; // visible height at z = -0.2
    // the plane is 2 units wide, so halve; extra margin covers resizes
    mesh.scale.set((h * Math.max(cam.aspect, 3)) / 2, h / 2, 1);
    camera.add(mesh);
    if (!scene.children.includes(camera)) scene.add(camera);
    veilRef.current = mesh;
    return () => {
      camera.remove(mesh);
    };
  }, [camera, scene, veilGeo, veilMat]);
  const lightRef = useRef<THREE.PointLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);

  useFrame(() => {
    const s = stage;
    const w = director.wash * (1 - director.blackout);
    const on = w > 0.005;
    if (groupRef.current) groupRef.current.visible = on;
    if (veilRef.current) veilRef.current.visible = on;
    if (lightRef.current) lightRef.current.intensity = w * 90 * s.settings.intensity;
    if (ambientRef.current) ambientRef.current.intensity = w * 0.65;
    if (!on) return;

    // Flash: a visible whip in 0.5s. Bump: a slower drift so it still floods.
    const flash = director.whiteFlash;
    const spin = 0.25 + flash * 0.75;
    const { euler, qFlood, qSweep, qAim, qLive, headPos, target, dir } = scratch;

    for (let i = 0; i < coneMats.length; i++) {
      coneMats[i].uniforms.uTime.value = s.time;
      // a touch of level in the cones so the wash still breathes with the track
      coneMats[i].uniforms.uIntensity.value = w * (0.45 + s.amp * 0.2) * s.settings.intensity;
      lensMats[i].color.setScalar(0.5 + w * 0.5);

      const g = headRefs.current[i];
      const h = heads[i];
      if (!g) continue;
      euler.set(h.tilt, 0, 0);
      qFlood.setFromEuler(euler);

      const t = s.time * (0.4 + flash * 5.5) + h.phase;
      euler.set(
        0.7 + Math.sin(t * 1.6) * (0.22 + flash * 0.25),
        t * 1.35 * h.dir,
        Math.sin(t * 1.1) * 0.28 * h.dir,
      );
      qSweep.setFromEuler(euler);

      headPos.set(WASH_POS.x + h.x, WASH_POS.y, WASH_POS.z);
      target.copy(camera.position).add(
        dir.set(
          h.dir * 2.4 + Math.sin(t * 0.9 + h.phase) * (3.2 + flash * 2.0),
          0.1 + Math.sin(t * 0.7 + h.phase * 0.6) * 0.55,
          0,
        ),
      );
      dir.subVectors(target, headPos).normalize();
      qAim.setFromUnitVectors(DOWN, dir);
      qLive.copy(qSweep).slerp(qAim, 0.45 + flash * 0.35);
      g.quaternion.copy(qFlood).slerp(qLive, spin);
    }
    // thin white veil so the rig stays readable through the flash
    veilMat.uniforms.uFlash.value = Math.pow(w, 1.4) * 0.16;
  });

  return (
    <group>
      <ambientLight ref={ambientRef} intensity={0} color={0xffffff} />
      <pointLight ref={lightRef} position={[0, 7, 4]} intensity={0} distance={60} decay={1.2} color={0xfffdf7} />
      <group ref={groupRef} position={WASH_POS}>
        {heads.map((h, i) => (
          <group
            key={i}
            position={[h.x, 0, 0]}
            ref={(el) => {
              headRefs.current[i] = el;
            }}
          >
            <mesh geometry={lensGeo} material={lensMats[i]} />
            <mesh geometry={coneGeo} material={coneMats[i]} position={[0, -CONE_LENGTH / 2, 0]} frustumCulled={false} />
          </group>
        ))}
      </group>
    </group>
  );
}
