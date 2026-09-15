# Stage Visualizer

Audio-reactive, Tomorrowland-style stage visualizer built with Expo + React Native.
One codebase ships to iOS, Android and the web.

## Run it

```bash
npm install
npm run web        # browser (Web Audio API + WebGL)
npm run ios        # iOS simulator / device via Expo dev build
npm run android    # Android emulator / device via Expo dev build
```

The native audio layer (`react-native-audio-api`) and `expo-gl` contain native
code, so on iOS/Android you need a development build rather than Expo Go:

```bash
npx expo prebuild
npx expo run:ios      # or run:android
```

## Deploy

- **Web**: `npm run web:build` writes a static SPA to `dist/`. `vercel.json` and
  `netlify.toml` are included, so pushing the repo to either host builds and serves it.
- **Mobile**: `npm run build:android` / `npm run build:ios` (EAS Build, see `eas.json`).

## How it works

| Layer | Files |
| --- | --- |
| Audio input (mic / system / file) | `src/audio/createEngine.ts` (web), `src/audio/createEngine.native.ts` |
| Feature extraction (bands, onset, BPM) | `src/audio/analysis.ts` |
| Unified hook | `src/audio/useAudioAnalyzer.ts` |
| Audio -> visual mapping and colour engine | `src/stage/stageState.ts` |
| Scene modules | `src/stage/LaserRig.tsx`, `BeamArray.tsx`, `StrobeWall.tsx`, `PyroBurst.tsx`, `LEDBackdrop.tsx` |
| GLSL | `src/stage/shaders/index.ts` |
| Settings, presets, palettes | `src/state/` |
| Screens | `app/index.tsx`, `app/settings.tsx`, `app/projection.tsx` |

Mapping: bass hits fire pyro and strobes, mids drive beam and laser sweep speed,
treble drives laser flicker and colour shift, overall level drives brightness,
and detected beats/BPM cycle the hue.

## Notes

- System-audio capture is web only (browser screen-share with "share audio").
  Native platforms use the microphone or an imported track.
- The FFT runs at 1024 points (512 bins) and is downsampled to 64 bins for the LED wall.
