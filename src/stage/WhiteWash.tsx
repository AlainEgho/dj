import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from './fiber';
import { beamFragment, beamVertex, laserVertex, strobeFragment } from './shaders';
import { director, stage } from './stageState';

const COUNT = 8;
const CONE_LENGTH = 26;

/**
 * White wash: a row of open-white fixtures on the truss that flood the stage.
 * Unlike the moving heads these do not sweep; they sit wide and still, so the
 * whole stage reads as bright white light. Driven by director.wash, which the
 * "White out" cue raises and the keyboard bump slams to full.
 */
export function WhiteWash() {
  const heads = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        x: (i / (COUNT - 1) - 0.5) * 22,
        tilt: 0.55 + Math.abs(i / (COUNT - 1) - 0.5) * 0.25,
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
    if (lightRef.current) lightRef.current.intensity = w * 220 * s.settings.intensity;
    if (ambientRef.current) ambientRef.current.intensity = w * 1.6;
    if (!on) return;

    for (let i = 0; i < coneMats.length; i++) {
      coneMats[i].uniforms.uTime.value = s.time;
      // a touch of level in the cones so the wash still breathes with the track
      coneMats[i].uniforms.uIntensity.value = w * (0.85 + s.amp * 0.3) * s.settings.intensity;
      lensMats[i].color.setScalar(0.5 + w * 0.5);
    }
    // the veil lifts the whole frame; kept well under 1 so the rig stays visible
    veilMat.uniforms.uFlash.value = Math.pow(w, 1.4) * 0.5;
  });

  return (
    <group>
      <ambientLight ref={ambientRef} intensity={0} color={0xffffff} />
      <pointLight ref={lightRef} position={[0, 7, 4]} intensity={0} distance={60} decay={1.2} color={0xfffdf7} />
      <group ref={groupRef} position={[0, 9.1, -2.2]}>
        {heads.map((h, i) => (
          <group key={i} position={[h.x, 0, 0]} rotation={[h.tilt, 0, 0]}>
            <mesh geometry={lensGeo} material={lensMats[i]} />
            <mesh geometry={coneGeo} material={coneMats[i]} position={[0, -CONE_LENGTH / 2, 0]} frustumCulled={false} />
          </group>
        ))}
      </group>
    </group>
  );
}
