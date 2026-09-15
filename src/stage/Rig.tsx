import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from './fiber';
import { director, stage } from './stageState';

/** Static stage dressing: floor, truss, plus an audio-driven fill light. */
export function Rig() {
  const trussMat = useMemo(() => new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.9, roughness: 0.35 }), []);
  const floorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: 0x0b0b10, metalness: 0.7, roughness: 0.45 }), []);
  const lightRef = useRef<THREE.PointLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);

  useFrame(() => {
    const s = stage;
    const lit = 1 - director.blackout;
    if (lightRef.current) {
      lightRef.current.color.copy(s.colorA);
      lightRef.current.intensity = (6 + s.bass * 40 * s.settings.intensity) * lit;
    }
    if (ambientRef.current) ambientRef.current.intensity = (0.15 + s.amp * 0.25) * lit;
  });

  const bars = useMemo(() => {
    const items: { pos: [number, number, number]; size: [number, number, number] }[] = [];
    // horizontal truss
    items.push({ pos: [0, 9.6, -2.5], size: [27.5, 0.25, 0.25] });
    items.push({ pos: [0, 10.1, -2.5], size: [27.5, 0.25, 0.25] });
    items.push({ pos: [0, 9.85, -2.85], size: [27.5, 0.2, 0.2] });
    // vertical supports at the wall edges so nothing crosses the LED content
    for (const x of [-13.6, 13.6]) items.push({ pos: [x, 5, -2.5], size: [0.35, 10, 0.35] });
    // cross braces
    for (let i = 0; i < 12; i++) items.push({ pos: [-11 + i * 2, 9.85, -2.5], size: [0.08, 0.5, 0.5] });
    return items;
  }, []);

  return (
    <group>
      <ambientLight ref={ambientRef} intensity={0.2} />
      <pointLight ref={lightRef} position={[0, 6, 1]} intensity={10} distance={40} decay={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={floorMat}>
        <planeGeometry args={[60, 40]} />
      </mesh>
      {bars.map((b, i) => (
        <mesh key={i} position={b.pos} material={trussMat}>
          <boxGeometry args={b.size} />
        </mesh>
      ))}
    </group>
  );
}
