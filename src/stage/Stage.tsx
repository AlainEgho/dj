import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from './fiber';
import { stage, updateStage } from './stageState';
import { useRegisterRenderLoop } from '../audio/useAudioAnalyzer';
import { LaserRig } from './LaserRig';
import { BeamArray } from './BeamArray';
import { StrobeWall } from './StrobeWall';
import { PyroBurst } from './PyroBurst';
import { LEDBackdrop } from './LEDBackdrop';
import { Haze } from './Haze';
import { Rig } from './Rig';
import { useRecorder } from '../ui/recorder';

/**
 * Runs first every frame (priority -1): pulls the audio frame, updates the
 * shared stage state and drifts the camera. Scene components then read
 * `stage` in their own useFrame callbacks.
 */
function StageDriver() {
  useRegisterRenderLoop();
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const lastBackdrop = useRef('');
  const targetBg = useRef(new THREE.Color(stage.palette.backdrop));

  useFrame(() => {
    updateStage();
    const s = stage;
    // Front-of-house view: parallel to the stage, framed so the top of the
    // LED wall meets the top of the screen. Only a very slow dolly.
    camera.position.x = 0;
    camera.position.y = 5.4;
    camera.position.z = 17.5 + Math.sin(s.time * 0.05) * 0.4 - s.amp * 0.4;
    camera.lookAt(0, 5.6, -3);

    // Backdrop glides toward the palette colour (palette changes crossfade)
    if (s.palette.backdrop !== lastBackdrop.current) {
      lastBackdrop.current = s.palette.backdrop;
      targetBg.current.set(s.palette.backdrop);
    }
    if (scene.background instanceof THREE.Color) scene.background.lerp(targetBg.current, Math.min(1, s.dt / 2.5));
    else scene.background = targetBg.current.clone();
  }, -1);
  return null;
}

/**
 * Render resolution: normally the device pixel ratio (capped at 1.5). While a
 * recording is being prepared or running, render at the requested vertical
 * resolution (1080p / 1440p / 4K) regardless of the window size.
 */
function RenderScale() {
  const setDpr = useThree((s) => s.setDpr);
  const height = useThree((s) => s.size.height);
  const rec = useRecorder();
  const active = rec.recording || rec.preparing;
  const target = rec.targetHeight;
  useEffect(() => {
    const base = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);
    if (active && target > 0 && height > 0) setDpr(Math.max(1, Math.min(4, target / height)));
    else setDpr(base);
  }, [active, target, height, setDpr]);
  return null;
}

export function Stage() {
  return (
    <View style={styles.container}>
      <Canvas
        style={styles.canvas}
        flat
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ position: [0, 5.4, 17.5], fov: 36, near: 0.1, far: 200 }}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color(stage.palette.backdrop);
        }}
      >
        <StageDriver />
        <RenderScale />
        <Rig />
        <LEDBackdrop />
        <Haze />
        <BeamArray />
        <LaserRig />
        <StrobeWall />
        <PyroBurst />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  canvas: { flex: 1 },
});
