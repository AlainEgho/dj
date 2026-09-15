/**
 * Custom GLSL for the stage. All heavy per-fragment work lives here so the JS
 * side only pushes a handful of uniforms per frame.
 *
 * Every shader is written for GLSL ES 1.00 (WebGL1 / expo-gl) and also
 * compiles under WebGL2, which three.js handles via its prefix injection.
 */

export const laserVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * A single laser fan: N thin bright lines radiating from the bottom centre of
 * a quad. The quad itself is posed in 3D by the fixture (tilt/pan), so the
 * fan reads as real beams over the audience.
 */
export const laserFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uTreble;
  uniform float uBeat;
  uniform float uIntensity;
  uniform float uLines;
  uniform float uSpread;   // total fan angle in radians
  uniform float uSweep;    // in-plane rotation of the whole fan
  uniform float uFanSize;  // world size of the quad, for constant-width beams
  uniform float uWidth;    // beam half-width in world units (large = solid sheet)
  uniform vec3 uColorA;
  uniform vec3 uColorB;

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vec2 p = vec2(vUv.x - 0.5, vUv.y);
    float r = length(p);
    float ang = atan(p.x, p.y) - uSweep * 0.5;
    float halfSpread = uSpread * 0.5;
    if (abs(ang) > halfSpread || r > 1.0) { gl_FragColor = vec4(0.0); return; }

    float t = (ang + halfSpread) / uSpread;
    float k = t * uLines;
    float idx = floor(k);
    float f = fract(k) - 0.5;
    // Beams have a constant world width (a few cm) rather than a constant
    // angle, so they stay solid near the emitter and thin out with distance.
    float spacingRad = uSpread / uLines;
    float halfWidthWorld = uWidth + uBeat * 0.015;
    float thickness = min(0.5, halfWidthWorld / max(0.02, r * uFanSize) / spacingRad);
    float line = smoothstep(thickness, thickness * 0.4, abs(f));
    // gentle per-line shimmer, stronger with treble
    float flick = 0.88 + 0.12 * sin(uTime * (3.0 + hash(idx) * 6.0) + idx * 3.1);
    flick = mix(1.0, flick, clamp(uTreble, 0.0, 1.0));
    float fade = 1.0 - smoothstep(0.75, 1.0, r);
    float haze = exp(-abs(f) * 16.0) * 0.12;
    vec3 col = mix(uColorA, uColorB, fract(idx / uLines + uTime * 0.02));
    float energy = (line + haze) * flick * fade * uIntensity * (1.0 + uBeat * 0.6);
    gl_FragColor = vec4(col * energy * 2.0, energy);
  }
`;

/** Volumetric cone / moving-head beam with additive blending. */
export const beamVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const beamFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uSeed;

  void main() {
    float along = 1.0 - vUv.y; // 0 at the fixture, 1 at the far end
    float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 1.5);
    float falloff = 1.0 - smoothstep(0.1, 1.0, along) * 0.85;
    float body = mix(0.35, 1.0, rim) * falloff;
    float n = 0.9 + 0.1 * sin(along * 30.0 - uTime * 3.0 + uSeed * 10.0);
    float a = min(1.0, body * n * uIntensity * 3.0);
    gl_FragColor = vec4(uColor * a * 1.8, a);
  }
`;

export const ledVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * LED wall. Three kinds of content, crossfaded between uModeA and uModeB:
 *   0 spectrum analyser + bass ripple
 *   1 slow geometric shapes (uShape selects which)
 *   2 pixel-font text from uText
 * uWall dims the whole wall (director blackouts).
 */
export const ledFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSpectrum;
  uniform sampler2D uText;
  uniform float uTextPx;      // text texture width in font pixels
  uniform float uTextLen;     // glyph count
  uniform float uReveal;      // 0..1 letters revealed
  uniform float uTextFade;    // 1 = fully visible, 0 = faded out
  uniform float uTime;
  uniform float uBass;
  uniform float uAmp;
  uniform float uBeat;
  uniform float uIntensity;
  uniform float uWall;
  uniform float uHue;
  uniform float uSat;
  uniform float uPace;
  uniform float uModeA;
  uniform float uModeB;
  uniform float uBlend;
  uniform float uShapeA;
  uniform float uShapeB;
  uniform vec2 uGrid;

  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  // Value noise + fbm for the cloud shapes and the pixel twinkle
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }
  // Soft drifting clouds, denser and brighter with the level
  float clouds(vec2 p, float t, float level) {
    vec2 q = p * vec2(1.6, 3.2) + vec2(t * 0.06, t * 0.02);
    float n = fbm(q + fbm(q * 0.7 - t * 0.03) * 0.6);
    return smoothstep(0.45 - level * 0.2, 0.85, n);
  }

  float spectrumContent(vec2 cc) {
    vec2 cell = floor(cc * uGrid);
    float sx = abs(cc.x - 0.5) * 2.0;
    float spec = texture2D(uSpectrum, vec2(pow(sx, 1.6), 0.5)).r;
    float bar = step(cc.y + 0.02, spec * (0.7 + uAmp * 0.6));
    // Bars are not solid blocks: each LED inside flashes on and off at random,
    // denser near the bottom of the bar, so the meter reads as living pixels.
    float tick = floor(uTime * 9.0);
    float r1 = hash2(cell + tick * 0.37);
    float keep = 0.45 + (1.0 - cc.y) * 0.4;
    bar *= step(1.0 - keep, r1);
    // sparse twinkles across the whole wall, more with the level
    float r2 = hash2(cell * 1.7 + floor(uTime * 12.0) * 0.61);
    float sparkle = step(0.992 - uAmp * 0.012, r2) * 0.8;
    // soft cloud bed behind the bars
    vec2 p = (cc - 0.5) * vec2(2.0, 1.0);
    float cloud = clouds(p, uTime * uPace, uAmp) * 0.35;
    float d = distance(cc, vec2(0.5, 0.35));
    float ripple = sin(d * 14.0 - uTime * 2.5 * uPace) * 0.5 + 0.5;
    ripple = pow(ripple, 5.0) * uBass * 0.7;
    return max(max(bar, ripple), max(sparkle, cloud));
  }

  // Stepped-pyramid silhouette: 5 tiers from y=-0.44 up to y=0.30
  float templeInside(vec2 p) {
    float base = -0.44;
    float tierH = 0.148;
    float level = floor((p.y - base) / tierH);
    float halfW = 0.92 - level * 0.17;
    return step(base, p.y) * step(p.y, base + tierH * 5.0) * step(abs(p.x), halfW);
  }

  float shapeContent(float shape, vec2 cc) {
    vec2 p = (cc - 0.5) * vec2(2.0, 1.0); // aspect-correct, x in [-1,1]
    float r = length(p);
    float t = uTime * uPace;
    float v = 0.0;
    if (shape < 0.5) {
      // Eclipse: soft disc with a thin bright ring and a slow crescent
      float R = 0.26 + uBass * 0.04;
      float disc = smoothstep(0.015, 0.0, r - R);
      float ring = smoothstep(0.02, 0.0, abs(r - (R + 0.07 + sin(t * 0.4) * 0.015)) - 0.004);
      vec2 off = vec2(sin(t * 0.25) * 0.09, cos(t * 0.19) * 0.03);
      float shadow = smoothstep(0.015, 0.0, length(p - off) - R * 0.94);
      v = max(disc * (1.0 - shadow * 0.9), ring * 0.9);
    } else if (shape < 1.5) {
      // Rings: concentric rings breathing outwards, thicker on bass
      float k = fract(r * 3.5 - t * 0.12);
      v = smoothstep(0.08 + uBass * 0.06, 0.0, abs(k - 0.5) - 0.02) * (1.0 - smoothstep(0.6, 1.1, r));
    } else if (shape < 2.5) {
      // Bars: six wide horizontal bars whose width breathes with the spectrum
      float row = floor((p.y + 0.5) * 6.0);
      float fy = fract((p.y + 0.5) * 6.0);
      float spec = texture2D(uSpectrum, vec2(row / 6.0 * 0.6 + 0.05, 0.5)).r;
      float w = 0.18 + spec * 0.55;
      float slide = sin(t * 0.3 + row * 1.7) * 0.15;
      v = smoothstep(w, w - 0.03, abs(p.x - slide)) * smoothstep(0.5, 0.42, abs(fy - 0.5));
    } else if (shape < 3.5) {
      // Rays: slowly rotating radial beams plus a small centre disc
      float a = atan(p.y, p.x);
      float rays = smoothstep(0.75, 1.0, sin(a * 8.0 + t * 0.25)) * smoothstep(0.05, 0.35, r);
      float disc = smoothstep(0.012, 0.0, r - (0.06 + uBeat * 0.02));
      v = max(rays * 0.8, disc);
    } else if (shape < 4.5) {
      // Tunnel: perspective grid converging on the centre
      float depth = 1.0 / max(0.04, r);
      float lines = smoothstep(0.85, 1.0, sin(depth * 2.5 - t * 1.2)) ;
      float a = atan(p.y, p.x);
      float spokes = smoothstep(0.9, 1.0, abs(sin(a * 6.0)));
      v = max(lines, spokes * 0.6) * (1.0 - smoothstep(0.7, 1.1, r)) * smoothstep(0.0, 0.08, r);
    } else if (shape < 5.5) {
      // Waves: three slow sine lines
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float y = sin(p.x * 3.0 + t * 0.6 + fi * 2.1) * (0.08 + uAmp * 0.1) + (fi - 1.0) * 0.22;
        v = max(v, smoothstep(0.02, 0.0, abs(p.y - y) - 0.006));
      }
    } else if (shape < 6.5) {
      // Oracle eye: almond outline, iris ring and a pupil that narrows on bass,
      // with a slow blink every few seconds.
      float blink = smoothstep(0.85, 1.0, sin(t * 0.35)) ;
      float h = 0.34 * (1.0 - blink * 0.95);
      float lid = abs(p.y) - (h - (p.x * p.x) * (h / 0.64));
      float almond = smoothstep(0.015, 0.0, lid) * step(abs(p.x), 0.8);
      float outline = almond * (1.0 - smoothstep(0.0, 0.05, -lid));
      float ir = length(p * vec2(1.0, 1.0));
      float iris = smoothstep(0.015, 0.0, abs(ir - 0.2) - 0.02);
      float spokes = smoothstep(0.6, 1.0, sin(atan(p.y, p.x) * 12.0 + t * 0.4)) * step(ir, 0.19) * step(0.08, ir) * 0.5;
      float pupil = smoothstep(0.012, 0.0, ir - (0.075 - uBass * 0.03));
      v = max(max(outline, (iris + spokes + pupil) * almond), 0.0);
    } else if (shape > 7.5) {
      // Clouds: soft drifting fog with random pixel twinkles riding on the peaks
      float c = clouds(p, t, uAmp);
      vec2 cell = floor(cc * uGrid);
      float tw = step(0.93, hash2(cell + floor(uTime * 6.0) * 0.53)) * step(0.3, c);
      v = max(c * (0.6 + uBass * 0.4), tw);
    } else {
      // Temple: outline of a stepped pyramid (silhouette minus its eroded self),
      // a glowing doorway and the rotating "cube of time" above the apex.
      float d = 0.028; // about one LED tile
      float inside = templeInside(p);
      float eroded = min(min(templeInside(p + vec2(d, 0.0)), templeInside(p - vec2(d, 0.0))),
                         min(templeInside(p + vec2(0.0, d)), templeInside(p - vec2(0.0, d))));
      float outline = inside * (1.0 - eroded);
      float door = smoothstep(0.01, 0.0, abs(p.x) - 0.07) * step(-0.44, p.y) * step(p.y, -0.2);
      float glow = door * (0.55 + 0.45 * sin(t * 1.2)) * (0.7 + uBass * 0.5);
      // cube: rotating square above the apex
      float ca = t * 0.6;
      vec2 q = p - vec2(0.0, 0.38);
      q = vec2(q.x * cos(ca) - q.y * sin(ca), q.x * sin(ca) + q.y * cos(ca));
      float cube = smoothstep(0.012, 0.0, max(abs(q.x), abs(q.y)) - 0.05) * (0.7 + uBeat * 0.3);
      v = max(max(outline * 0.95, glow), cube);
    }
    return v;
  }

  float textContent(vec2 cc) {
    // Pixel-perfect: every font pixel maps to an integer k x k block of LED
    // tiles, so strokes never drop out from resampling.
    vec2 cell = floor(cc * uGrid);
    float k = max(1.0, floor(min(uGrid.x * 0.92 / uTextPx, uGrid.y * 0.55 / 7.0)));
    vec2 sizeCells = vec2(uTextPx, 7.0) * k;
    vec2 origin = floor((uGrid - sizeCells) * 0.5);
    vec2 local = cell - origin;
    if (local.x < 0.0 || local.y < 0.0 || local.x >= sizeCells.x || local.y >= sizeCells.y) return 0.0;
    vec2 tuv = (floor(local / k) + 0.5) / vec2(uTextPx, 7.0);
    float on = texture2D(uText, tuv).r;
    float letter = floor(tuv.x * uTextLen);
    float shown = step((letter + 0.5) / max(1.0, uTextLen), uReveal);
    return on * shown * uTextFade * (0.85 + uBeat * 0.15);
  }

  float content(float mode, float shape, vec2 cc) {
    if (mode < 0.5) return spectrumContent(cc);
    if (mode < 1.5) return shapeContent(shape, cc);
    return textContent(cc);
  }

  void main() {
    vec2 cell = floor(vUv * uGrid);
    vec2 cuv = fract(vUv * uGrid);
    vec2 cc = (cell + 0.5) / uGrid;
    float edge = smoothstep(0.0, 0.12, cuv.x) * smoothstep(0.0, 0.12, cuv.y)
               * smoothstep(1.0, 0.88, cuv.x) * smoothstep(1.0, 0.88, cuv.y);

    float lumA = content(uModeA, uShapeA, cc);
    float lumB = content(uModeB, uShapeB, cc);
    float lum = mix(lumA, lumB, uBlend);
    float mode = mix(uModeA, uModeB, uBlend);
    // spectrum is fully saturated; shapes and text lean cinematic / desaturated
    float sat = uSat * (mode < 0.5 ? 1.0 : 0.55);
    float light = mode < 0.5 ? 0.55 : 0.72;

    float d = distance(cc, vec2(0.5));
    float hue = uHue + cc.y * 0.06 + d * 0.04;
    vec3 col = hsl2rgb(vec3(fract(hue), sat, light));
    vec3 bg = hsl2rgb(vec3(fract(uHue + 0.08), uSat * 0.6, 0.05));
    float flash = uBeat * 0.25 * step(mode, 0.5);
    lum = clamp(lum + flash, 0.0, 1.0);
    vec3 outCol = mix(bg, col, lum) * edge * uIntensity * (0.7 + lum * 1.1);
    gl_FragColor = vec4(outCol * uWall, 1.0);
  }
`;

/** Pyro / spark particles integrated on the GPU. */
export const pyroVertex = /* glsl */ `
  attribute vec3 aVelocity;
  attribute float aBirth;
  attribute float aLife;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAge;
  void main() {
    float age = (uTime - aBirth) / aLife;
    vAge = age;
    vec3 p = position;
    if (age >= 0.0 && age <= 1.0) {
      float t = age * aLife;
      p += aVelocity * t + vec3(0.0, -4.5, 0.0) * t * t;
    } else {
      p = vec3(0.0, -9999.0, 0.0);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float s = aSize * (1.0 - age * 0.6);
    gl_PointSize = s * uPixelRatio * (220.0 / max(1.0, -mv.z));
  }
`;

export const pyroFragment = /* glsl */ `
  precision highp float;
  varying float vAge;
  uniform vec3 uColor;
  void main() {
    if (vAge < 0.0 || vAge > 1.0) discard;
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    vec3 col = mix(vec3(1.0, 0.95, 0.8), uColor, smoothstep(0.0, 0.35, vAge));
    col = mix(col, uColor * 0.4, smoothstep(0.6, 1.0, vAge));
    float a = glow * (1.0 - vAge);
    gl_FragColor = vec4(col * a * 1.5, a);
  }
`;

/** Strobe / blinder panel. */
export const strobeFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uFlash;
  uniform vec3 uColor;
  void main() {
    float v = 1.0 - smoothstep(0.35, 0.5, distance(vUv, vec2(0.5)));
    float a = uFlash * (0.4 + v);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.6) * a, a);
  }
`;
