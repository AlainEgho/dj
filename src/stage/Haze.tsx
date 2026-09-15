import { useMemo } from 'react';
import { Sparkles } from './drei';
import { hslToHex } from '../state/palettes';
import { useSettings } from '../state/settingsStore';
import { getPalette } from '../state/palettes';

/**
 * Atmospheric dust / haze so the beams have something to catch. Uses drei's
 * Sparkles (pure shader particles). Colour follows the selected palette.
 */
export function Haze() {
  const settings = useSettings();
  const color = useMemo(() => {
    const p = getPalette(settings.paletteId);
    const hue = settings.paletteId === 'custom' ? settings.customHue : p.hue;
    return hslToHex(hue / 360, Math.max(0.2, p.saturation), 0.7);
  }, [settings.paletteId, settings.customHue]);

  if (!settings.hazeEnabled) return null;
  return (
    <Sparkles
      count={260}
      speed={0.25}
      opacity={0.35}
      size={2.5}
      noise={0.6}
      color={color}
      scale={[28, 12, 16]}
      position={[0, 6, -1]}
    />
  );
}
