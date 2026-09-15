export interface Palette {
  id: string;
  name: string;
  /** base hue in degrees 0..360 */
  hue: number;
  /** how far the secondary colours spread from the base hue */
  spread: number;
  saturation: number;
  /** background/backdrop tint */
  backdrop: string;
}

export const PALETTES: Palette[] = [
  /** 'auto' is resolved by the show director, which rotates through the real palettes below */
  { id: 'auto', name: 'Auto', hue: 295, spread: 70, saturation: 1, backdrop: '#0a0014' },
  { id: 'tomorrow', name: 'Tomorrowland', hue: 295, spread: 70, saturation: 1, backdrop: '#0a0014' },
  { id: 'oracle', name: 'Oracle Gold', hue: 38, spread: 18, saturation: 0.95, backdrop: '#0b0703' },
  { id: 'ultra', name: 'Ultra Blue', hue: 205, spread: 40, saturation: 1, backdrop: '#00050f' },
  { id: 'sunset', name: 'Sunset', hue: 20, spread: 50, saturation: 0.95, backdrop: '#0f0402' },
  { id: 'acid', name: 'Acid', hue: 110, spread: 60, saturation: 1, backdrop: '#020a02' },
  { id: 'ice', name: 'Ice', hue: 180, spread: 25, saturation: 0.7, backdrop: '#02090a' },
  { id: 'mono', name: 'Monochrome', hue: 0, spread: 0, saturation: 0, backdrop: '#050505' },
  { id: 'custom', name: 'Custom', hue: 330, spread: 60, saturation: 1, backdrop: '#0a0008' },
];

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** HSL -> RGB, all inputs 0..1, output 0..1 components. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
}

export function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
