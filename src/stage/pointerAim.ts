import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from './fiber';
import { emitStageTap } from '../ui/chromeBus';

/** Crowd plane the pointer is projected onto (in front of the FOH camera). */
const CROWD_Z = 8;

export const pointerAim = {
  held: false,
  point: new THREE.Vector3(0, 3.2, CROWD_Z),
};

/**
 * Click-and-drag on the canvas: project the pointer onto a plane in the crowd
 * so the moving heads can follow it. A tap with almost no travel still toggles
 * the overlay chrome.
 */
export function PointerAim() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const tools = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -CROWD_Z),
      hit: new THREE.Vector3(),
      origin: { x: 0, y: 0 },
    }),
    [],
  );

  useEffect(() => {
    const el = (gl as { domElement?: HTMLElement }).domElement;
    if (!el || typeof el.addEventListener !== 'function') return;

    const project = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      tools.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      tools.raycaster.setFromCamera(tools.ndc, camera);
      if (tools.raycaster.ray.intersectPlane(tools.plane, tools.hit)) {
        pointerAim.point.set(tools.hit.x, Math.min(8.5, Math.max(0.6, tools.hit.y)), CROWD_Z);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerAim.held = true;
      tools.origin.x = e.clientX;
      tools.origin.y = e.clientY;
      project(e);
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!pointerAim.held) return;
      project(e);
    };
    const onUp = (e: PointerEvent) => {
      if (!pointerAim.held) return;
      pointerAim.held = false;
      const dx = e.clientX - tools.origin.x;
      const dy = e.clientY - tools.origin.y;
      if (dx * dx + dy * dy < 64) emitStageTap();
    };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [camera, gl, tools]);

  return null;
}
