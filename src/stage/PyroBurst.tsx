import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from './fiber';
import { pyroFragment, pyroVertex } from './shaders';
import { director, stage } from './stageState';

const MAX_PARTICLES = 1800;
const PER_BURST = 110;
const JETS = [-9, -5.5, -2, 2, 5.5, 9];

/**
 * GPU-integrated spark fountains. A bass beat fires one or two jets; the
 * vertex shader integrates position from birth/velocity so a burst costs a
 * single attribute upload and no per-frame JS math.
 */
export function PyroBurst() {
  const dpr = useThree((s) => s.viewport.dpr);
  const { geometry, birth, velocity, life, size } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const vel = new Float32Array(MAX_PARTICLES * 3);
    const b = new Float32Array(MAX_PARTICLES).fill(-1e6);
    const l = new Float32Array(MAX_PARTICLES).fill(1);
    const sz = new Float32Array(MAX_PARTICLES).fill(1);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVelocity', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(b, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(l, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    // huge bounding sphere so the points are never frustum culled
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 100);
    return {
      geometry: geo,
      birth: geo.getAttribute('aBirth') as THREE.BufferAttribute,
      velocity: geo.getAttribute('aVelocity') as THREE.BufferAttribute,
      life: geo.getAttribute('aLife') as THREE.BufferAttribute,
      size: geo.getAttribute('aSize') as THREE.BufferAttribute,
    };
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pyroVertex,
        fragmentShader: pyroFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: dpr },
          uColor: { value: new THREE.Color(1, 0.6, 0.2) },
        },
      }),
    [dpr],
  );
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );

  const cursor = useRef(0);
  const lastBurst = useRef(-10);
  const pointsRef = useRef<THREE.Points>(null);

  const emit = (jetX: number, now: number, strength: number) => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let n = 0; n < PER_BURST; n++) {
      const i = cursor.current;
      cursor.current = (cursor.current + 1) % MAX_PARTICLES;
      pos.setXYZ(i, jetX + (Math.random() - 0.5) * 0.3, 0.1, -1.5 + (Math.random() - 0.5) * 0.3);
      const spread = 0.9 + strength * 0.8;
      velocity.setXYZ(
        i,
        (Math.random() - 0.5) * spread * 2.2,
        7 + Math.random() * 6 * (0.6 + strength),
        (Math.random() - 0.5) * spread * 1.6,
      );
      birth.setX(i, now);
      life.setX(i, 0.9 + Math.random() * 1.1);
      size.setX(i, 0.45 + Math.random() * 0.9);
    }
    pos.needsUpdate = true;
    velocity.needsUpdate = true;
    birth.needsUpdate = true;
    life.needsUpdate = true;
    size.needsUpdate = true;
  };

  useFrame(() => {
    const s = stage;
    const enabled = s.settings.pyroEnabled;
    if (pointsRef.current) pointsRef.current.visible = enabled;
    material.uniforms.uTime.value = s.time;
    (material.uniforms.uColor.value as THREE.Color).copy(s.colorA).lerp(EMBER, 0.55);
    if (!enabled) return;

    // Pyro is a special-moment effect: only when the director allows it, on a
    // drop or a very strong bass hit, and never more than every couple of seconds.
    const allow = director.pyro;
    const cooldown = 2.2 - s.pace * 1.2;
    const threshold = 0.9 - s.settings.reactivity * 0.15;
    const bigHit = s.beat && s.bass > threshold && allow > 0.5;
    if ((director.drop || bigHit) && s.time - lastBurst.current > cooldown) {
      lastBurst.current = s.time;
      const strength = director.drop ? 1 : Math.min(1, (s.bass - threshold) / (1 - threshold) + s.amp * 0.4);
      if (director.drop) {
        // drops fire every jet at once
        for (const x of JETS) emit(x, s.time, strength);
      } else {
        const a = Math.floor(Math.random() * JETS.length);
        emit(JETS[a], s.time, strength);
        emit(JETS[JETS.length - 1 - a], s.time, strength);
      }
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

const EMBER = new THREE.Color(1, 0.55, 0.15);
