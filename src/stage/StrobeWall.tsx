import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from './fiber';
import { laserVertex, strobeFragment } from './shaders';
import { director, stage } from './stageState';

const PANELS = 10;

/**
 * Row of blinders on the truss. Fires on bass-heavy beats and chatters during
 * loud passages. Each panel keeps its own decaying flash value.
 */
export function StrobeWall() {
  const geometry = useMemo(() => new THREE.PlaneGeometry(1.5, 0.45), []);
  const materials = useMemo(
    () =>
      Array.from(
        { length: PANELS },
        () =>
          new THREE.ShaderMaterial({
            vertexShader: laserVertex,
            fragmentShader: strobeFragment,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
              uFlash: { value: 0 },
              uColor: { value: new THREE.Color() },
            },
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose());
      geometry.dispose();
    },
    [materials, geometry],
  );

  const flash = useRef(new Float32Array(PANELS));
  const lastChatter = useRef(0);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    const s = stage;
    const f = flash.current;
    // Only fire when the director's look allows strobes; strength follows the cue weight.
    // Strobe sensitivity scaled by the director's reactivity, so a voice over
    // the PA never sets the blinders off.
    const sens = s.settings.strobeSensitivity * director.react;
    const allow = s.settings.strobeEnabled ? director.strobe * (1 - director.blackout) * sens : 0;
    const build = s.settings.strobeEnabled ? director.build * (1 - director.blackout) * sens : 0;
    const decay = Math.pow(0.5, s.dt / 0.07); // 70ms half-life

    // The drop: every blinder to full, white
    if (director.drop && s.settings.strobeEnabled) {
      for (let i = 0; i < PANELS; i++) f[i] = 1;
    }

    if (allow > 0.05) {
      // full-wall hit on strong bass beats (needs a strong hit at calm pacing)
      // a low sensitivity needs a much harder hit before the wall fires
      const threshold = 1.05 - s.pace * 0.2 - sens * 0.35;
      if (s.beat && s.bass > threshold) {
        for (let i = 0; i < PANELS; i++) f[i] = allow;
      }
      // chatter only at fast pacing during loud, bright passages
      const chatterRate = s.pace > 0.6 && s.amp > 0.8 && s.treble > 0.55 ? 0.06 : 0;
      if (chatterRate > 0 && s.time - lastChatter.current > chatterRate) {
        lastChatter.current = s.time;
        f[Math.floor(Math.random() * PANELS)] = 0.6 * allow;
      }
    }

    // Build-up: rolling chatter that speeds up as the build intensifies
    if (build > 0.35) {
      const rate = 0.5 - build * 0.42; // 0.35s .. 0.08s between hits
      if (s.time - lastChatter.current > rate) {
        lastChatter.current = s.time;
        const idx = Math.floor(((s.time * 6) % PANELS + PANELS) % PANELS);
        f[idx] = Math.max(f[idx], 0.3 + build * 0.5);
      }
    }

    let total = 0;
    for (let i = 0; i < PANELS; i++) {
      f[i] *= decay;
      if (f[i] < 0.002) f[i] = 0;
      total += f[i];
      const m = materials[i];
      m.uniforms.uFlash.value = f[i] * s.settings.intensity;
      (m.uniforms.uColor.value as THREE.Color).copy(s.colorC);
    }
    if (lightRef.current) {
      lightRef.current.intensity = (total / PANELS) * 60 * s.settings.intensity;
      lightRef.current.color.copy(s.colorC).lerp(WHITE, 0.7);
    }
  });

  return (
    <group position={[0, 8.3, -2.6]}>
      {materials.map((m, i) => (
        <mesh key={i} geometry={geometry} material={m} position={[(i / (PANELS - 1) - 0.5) * 20, 0, 0]} />
      ))}
      <pointLight ref={lightRef} position={[0, -1, 3]} intensity={0} distance={30} decay={1.5} />
    </group>
  );
}

const WHITE = new THREE.Color(1, 1, 1);
