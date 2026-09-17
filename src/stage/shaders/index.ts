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
  uniform float uBorder;   // 0 = full fan, 1 = only the two outer rays
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
    float spacingRad = uSpread / max(uLines, 1.0);
    float halfWidthWorld = uWidth + uBeat * 0.015;
    float thickness = min(0.5, halfWidthWorld / max(0.02, r * uFanSize) / spacingRad);
    float line = smoothstep(thickness, thickness * 0.4, abs(f));
    float haze = exp(-abs(f) * 16.0) * 0.12;
    // Border look: only the two outer rays of the fan, same world width so
    // they stay solid near the emitter and read as the silhouette of a beam.
    float edgeAng = min(abs(ang + halfSpread), abs(ang - halfSpread));
    float edgeThick = halfWidthWorld / max(0.02, r * uFanSize);
    float edgeLine = smoothstep(edgeThick, edgeThick * 0.4, edgeAng);
    float edgeHaze = exp(-edgeAng / max(0.002, edgeThick) * 0.5) * 0.14;
    line = mix(line, edgeLine, uBorder);
    haze = mix(haze, edgeHaze, uBorder);
    // gentle per-line shimmer, stronger with treble
    float flick = 0.88 + 0.12 * sin(uTime * (3.0 + hash(idx) * 6.0) + idx * 3.1);
    flick = mix(1.0, flick, clamp(uTreble, 0.0, 1.0));
    float fade = 1.0 - smoothstep(0.75, 1.0, r);
    vec3 col = mix(uColorA, uColorB, fract(idx / max(uLines, 1.0) + uTime * 0.02));
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
  uniform sampler2D uHistory;   // bins x time ring buffer of past spectra
  uniform float uHistRow;       // 0..1 row of the newest spectrum in uHistory
  uniform sampler2D uText;
  uniform float uTextPx;      // text texture width in font pixels
  uniform float uTextLen;     // glyph count
  uniform float uReveal;      // 0..1 letters revealed
  uniform float uTextFade;    // 1 = fully visible, 0 = faded out
  uniform float uTime;
  uniform float uBass;
  uniform float uAmp;
  uniform float uBeat;
  uniform float uFall;      // 0 = bars up, 1 = all collapsed
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
  uniform float uBackShape;  // gray/white shape layer under the spectrum
  uniform float uBurst;      // 0..1 white star explosion on a big drop
  uniform float uEarth;      // 0..1 pixel Earth after the explosion
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
    // Even column spacing: 2 LEDs on, 2 off — continuous bars with a regular gap.
    float colPeriod = 4.0;
    float colW = 2.0;
    float colPhase = mod(cell.x, colPeriod);
    float inCol = step(colPhase, colW - 0.5);

    float bandX = (floor(cell.x / colPeriod) + 0.5) * colPeriod / uGrid.x;
    float sx = abs(bandX - 0.5) * 2.0;
    float spec = pow(texture2D(uSpectrum, vec2(pow(sx, 1.35), 0.5)).r, 0.72);
    float height = spec * (0.84 + uBeat * 0.10);
    height = max(height, uBass * 0.06 * (1.0 - sx));
    height *= 1.0 - uFall;

    // Sometimes (random ~2.5s windows) only the peak caps stay on.
    float tHead = uTime * 0.38;
    float chunk = floor(tHead);
    float frac = fract(tHead);
    float wantHead = step(0.58, hash2(vec2(chunk, 8.3)));
    float headsOnly = wantHead * smoothstep(0.0, 0.1, frac) * smoothstep(1.0, 0.78, frac);

    float dropPeriod = 3.0;
    float inDrop = step(mod(cell.y, dropPeriod), 1.5);
    float below = step(cc.y, height + 0.02);
    float body = inCol * inDrop * below * (0.55 + spec * 0.7) * (1.0 - headsOnly);

    float nearPeak = smoothstep(height - 0.12, height, cc.y) * below * step(0.04, height);
    float head = inCol * nearPeak * (0.8 + uBeat * 0.4);

    // Spill onto neighbouring black tiles: beside the bar, and a halo around the cap.
    float gap = min(max(0.0, colPhase - (colW - 1.0)), colPeriod - colPhase);
    float nearX = exp(-gap * 1.05);
    float beside = step(cc.y, height) * (0.16 + spec * 0.28);
    float capHalo = (1.0 - smoothstep(0.0, 0.14, abs(cc.y - height))) * (0.35 + uBeat * 0.25);
    float yGlow = mix(max(beside, capHalo), capHalo, headsOnly);
    float bleed = (1.0 - inCol) * nearX * yGlow;
    float vertGap = (1.0 - inDrop) * inCol * below * (1.0 - headsOnly) * (0.14 + spec * 0.12);

    float r2 = hash2(cell * 1.7 + floor(uTime * 12.0) * 0.61);
    float sparkle = inCol * below * (1.0 - headsOnly) * step(0.996 - uAmp * 0.008, r2) * 0.35;
    return max(max(max(body, head), max(bleed, vertGap)), sparkle);
  }

  // Signed distance to a rounded box centred at c
  float sdRBox(vec2 p, vec2 c, vec2 hs, float r) {
    vec2 q = abs(p - c) - hs + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  // Giant humanoid silhouette (head, neck, torso, shoulders, arms, legs)
  float robotInside(vec2 p) {
    float d = sdRBox(p, vec2(0.0, 0.30), vec2(0.11, 0.12), 0.04);           // head
    d = min(d, sdRBox(p, vec2(0.0, 0.16), vec2(0.045, 0.035), 0.01));         // neck
    d = min(d, sdRBox(p, vec2(0.0, -0.03), vec2(0.25, 0.17), 0.05));          // torso
    d = min(d, sdRBox(p, vec2(-0.31, 0.09), vec2(0.075, 0.05), 0.03));        // shoulders
    d = min(d, sdRBox(p, vec2(0.31, 0.09), vec2(0.075, 0.05), 0.03));
    d = min(d, sdRBox(p, vec2(-0.355, -0.10), vec2(0.05, 0.17), 0.03));       // arms
    d = min(d, sdRBox(p, vec2(0.355, -0.10), vec2(0.05, 0.17), 0.03));
    d = min(d, sdRBox(p, vec2(-0.11, -0.36), vec2(0.085, 0.16), 0.03));       // legs
    d = min(d, sdRBox(p, vec2(0.11, -0.36), vec2(0.085, 0.16), 0.03));
    return step(d, 0.0);
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
      // Pixel rain: single LEDs fall down each column at their own speed with a
      // fading trail; columns light up more where the spectrum has energy.
      vec2 cell = floor(cc * uGrid);
      float seed = hash2(vec2(cell.x, 3.7));
      float speed = (5.0 + seed * 9.0) * (0.6 + uPace * 0.8);
      float span = uGrid.y + 10.0;
      float head = uGrid.y + 4.0 - mod(seed * 97.0 + uTime * speed, span);
      float trail = 5.0 + uAmp * 5.0;
      float dy = cell.y - head;                    // 0 at the head, positive up the trail
      float drop = step(0.0, dy) * step(dy, trail) * (1.0 - dy / trail);
      // second, slower drop per column so the wall never looks empty
      float head2 = uGrid.y + 4.0 - mod(seed * 41.0 + 17.0 + uTime * speed * 0.55, span);
      float dy2 = cell.y - head2;
      float drop2 = step(0.0, dy2) * step(dy2, trail * 0.6) * (1.0 - dy2 / (trail * 0.6)) * 0.7;
      float sx = abs(cc.x - 0.5) * 2.0;
      float spec = texture2D(uSpectrum, vec2(pow(sx, 1.6), 0.5)).r;
      float flash = step(0.985, hash2(cell + floor(uTime * 10.0) * 0.71)) * 0.9;
      v = max(max(drop, drop2) * (0.35 + spec * 0.9), flash);
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
    } else if (shape > 10.5) {
      // Smoke: thick fog rolling upward, curling on itself. Domain warping with
      // an upward drift gives billows rather than flat noise, and the bass
      // pushes fresh plumes up from the floor of the wall.
      vec2 q = p * vec2(1.3, 1.1);
      float rise = t * 0.10;
      vec2 warp = vec2(fbm(q * 1.4 + vec2(0.0, -rise * 1.3)), fbm(q * 1.4 + vec2(5.2, 1.3 - rise)));
      float dens = fbm(q * 1.7 + warp * 1.6 + vec2(0.0, -rise));
      // plumes are thicker low on the wall and thin out towards the top
      float column = 1.0 - smoothstep(-0.45, 0.45, p.y);
      float puff = smoothstep(0.42, 0.78, dens) * (0.35 + column * 0.85);
      // bass shoves a brighter front up through the smoke
      float front = smoothstep(0.12, 0.0, abs(p.y + 0.45 - uBass * 0.9)) * uBass * 0.7;
      v = clamp(puff + front * puff * 2.0, 0.0, 1.0);
    } else if (shape > 9.5) {
      // Robot: giant humanoid outline that breathes and sways, with eyes and a
      // chest core pulsing on the bass and a scanline sweeping down the body.
      vec2 q = p;
      q.x -= sin(t * 0.3) * 0.03;
      q.y = (q.y + 0.02) / (1.0 + sin(t * 0.8) * 0.012);
      float d = 0.028;
      float inside = robotInside(q);
      float eroded = min(min(robotInside(q + vec2(d, 0.0)), robotInside(q - vec2(d, 0.0))),
                         min(robotInside(q + vec2(0.0, d)), robotInside(q - vec2(0.0, d))));
      float outline = inside * (1.0 - eroded);
      float eyes = max(step(sdRBox(q, vec2(-0.045, 0.31), vec2(0.032, 0.012), 0.005), 0.0),
                       step(sdRBox(q, vec2(0.045, 0.31), vec2(0.032, 0.012), 0.005), 0.0));
      float core = smoothstep(0.012, 0.0, abs(length(q - vec2(0.0, -0.03)) - (0.045 + uBass * 0.02)) - 0.008);
      float scanY = 0.5 - mod(t * 0.12, 1.1);
      float scan = smoothstep(0.02, 0.0, abs(q.y - scanY)) * inside * 0.55;
      float fill = inside * 0.06;
      v = max(max(outline * 0.9, fill), max(max(eyes * (0.8 + uBass * 0.4), core), scan));
    } else if (shape > 8.5) {
      // Streaks: the rain turned sideways, pixels racing across each row,
      // alternating direction per row, brighter with the level
      vec2 cell = floor(cc * uGrid);
      float seed = hash2(vec2(cell.y, 5.1));
      float dir = step(0.5, hash2(vec2(cell.y, 9.3))) * 2.0 - 1.0;
      float speed = (10.0 + seed * 16.0) * (0.6 + uPace * 0.8);
      float span = uGrid.x + 12.0;
      float head = mod(seed * 131.0 + uTime * speed, span) - 6.0;
      if (dir < 0.0) head = uGrid.x - head;
      float dx = (cell.x - head) * -dir;          // 0 at the head, positive along the trail
      float trail = 7.0 + uAmp * 8.0;
      float streak = step(0.0, dx) * step(dx, trail) * (1.0 - dx / trail);
      float flash = step(0.988, hash2(cell + floor(uTime * 10.0) * 0.43)) * 0.9;
      v = max(streak * (0.5 + uAmp * 0.6), flash);
    } else if (shape > 7.5) {
      // Clouds: soft drifting fog with random pixel twinkles riding on the peaks
      float c = clouds(p, t, uAmp);
      vec2 cell = floor(cc * uGrid);
      float tw = step(0.93, hash2(cell + floor(uTime * 6.0) * 0.53)) * step(0.3, c);
      v = max(c * (0.95 + uBass * 0.4), tw);
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

  // Spectrogram: newest spectrum at the right edge scrolling left, bass at the
  // bottom with a log-like frequency axis. Returns energy 0..1 for the ramp.
  float heatContent(vec2 cc) {
    float age = 1.0 - cc.x;                       // 0 = now, 1 = oldest
    float row = fract(uHistRow - age + 1.0 / 128.0);
    float freq = pow(cc.y, 1.7);
    float e = texture2D(uHistory, vec2(freq, row)).r;
    return pow(e, 0.85);
  }

  float content(float mode, float shape, vec2 cc) {
    if (mode < 0.5) return spectrumContent(cc);
    if (mode < 1.5) return shapeContent(shape, cc);
    if (mode < 2.5) return textContent(cc);
    return heatContent(cc);
  }

  // Inferno-style heat ramp: black, deep violet, magenta, orange, yellow, white
  vec3 heatRamp(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c = vec3(0.0);
    c.r = smoothstep(0.08, 0.6, t);
    c.g = smoothstep(0.35, 0.9, t) * 0.95;
    c.b = 0.55 * smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.35, 0.7, t)) + smoothstep(0.85, 1.0, t);
    return c;
  }

  // Colour a content luminance for its mode: palette hues for spectrum, shapes
  // and text; the inferno ramp for the heat map.
  vec3 colorFor(float mode, float lum, vec2 cc) {
    if (mode > 2.5) {
      vec3 heat = heatRamp(lum);
      vec3 bg = vec3(0.02, 0.0, 0.03);
      return mix(bg, heat, smoothstep(0.02, 0.15, lum)) * (0.8 + lum * 0.9);
    }
    // Spectrum: a frequency ribbon on the palette's analog side (warm bass,
    // cooler treble, hot peaks). Unused tiles stay dark so the complementary
    // shape layer can show through without sharing this hue.
    if (mode < 0.5) {
      float sx = abs(cc.x - 0.5) * 2.0;
      float specHue = fract(uHue - 0.03 + sx * 0.20 + cc.y * 0.08);
      float sat = mix(0.72, 1.0, lum) * max(0.62, uSat);
      float light = mix(0.36, 0.58, lum) + cc.y * 0.14;
      vec3 col = hsl2rgb(vec3(specHue, sat, clamp(light, 0.0, 0.78)));
      vec3 peak = vec3(1.0, 0.90, 0.72);
      col = mix(col, peak, smoothstep(0.5, 1.0, lum) * smoothstep(0.45, 1.0, cc.y) * 0.55);
      return col * (0.5 + lum * 1.05);
    }
    float sat = uSat * 0.55;
    float light = 0.72;
    float d = distance(cc, vec2(0.5));
    float hue = uHue + cc.y * 0.06 + d * 0.04;
    vec3 col = hsl2rgb(vec3(fract(hue), sat, light));
    vec3 bg = hsl2rgb(vec3(fract(uHue + 0.08), uSat * 0.6, 0.05));
    lum = clamp(lum, 0.0, 1.0);
    float lift = 0.7 + lum * 1.1;
    return mix(bg, col, lum) * lift;
  }

  float cellAlpha(float mode, float lum, vec2 cell) {
    if (mode > 0.5) return 1.0;
    float rnd = hash2(cell * 1.31 + 0.7);
    float flicker = mix(0.55, 1.0, hash2(cell * 2.17 + floor(uTime * 5.0) * 0.41));
    float hole = mix(0.04, 0.48, rnd) * flicker;
    return mix(hole, 1.0, smoothstep(0.02, 0.18, lum));
  }

  // Pixelated galaxy nebula + field of stars (one colour per LED cell).
  vec3 galaxyPixel(vec2 cell, vec2 gc) {
    vec2 p = (gc - 0.5) * vec2(2.0, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);
    float arm = 0.5 + 0.5 * sin(a * 2.0 + r * 7.5 - uTime * 0.07);
    float neb = fbm(p * 3.2 + vec2(uTime * 0.018, uTime * 0.01));
    float dust = fbm(p * 6.1 - vec2(uTime * 0.012, 0.4));
    vec3 deep = vec3(0.03, 0.01, 0.10);
    vec3 mag = vec3(0.62, 0.14, 0.82);
    vec3 cyan = vec3(0.12, 0.38, 0.95);
    vec3 gold = vec3(0.95, 0.62, 0.22);
    vec3 col = deep;
    col = mix(col, mag, smoothstep(0.32, 0.78, neb) * (0.35 + arm * 0.5));
    col = mix(col, cyan, smoothstep(0.48, 0.92, neb) * (1.0 - r * 0.65));
    col = mix(col, gold, smoothstep(0.62, 1.0, dust) * arm * 0.4);
    float star = step(0.968, hash2(cell * 1.17 + 0.3));
    float tw = 0.45 + 0.55 * hash2(cell + floor(uTime * 4.0) * 0.11);
    col += vec3(1.0, 0.94, 0.82) * star * tw;
    return col;
  }

  // Bright star in the middle of the wall.
  vec3 centerStar(vec2 gc) {
    vec2 p = (gc - 0.5) * vec2(2.0, 1.0);
    float r = length(p);
    float core = smoothstep(0.07, 0.0, r);
    float hx = smoothstep(0.018, 0.0, abs(p.x)) * smoothstep(0.38, 0.0, abs(p.y));
    float hy = smoothstep(0.018, 0.0, abs(p.y)) * smoothstep(0.28, 0.0, abs(p.x));
    float glow = exp(-r * 7.5);
    return vec3(1.0, 0.96, 0.82) * (core * 1.5 + max(hx, hy) * 0.75 + glow * 0.5);
  }

  // All-white supernova: expanding ring, fill, and pixel sparks.
  vec3 starBurst(vec2 cell, vec2 gc, float burst) {
    vec2 p = (gc - 0.5) * vec2(2.0, 1.0);
    float r = length(p);
    float rad = burst * 1.35;
    float ring = smoothstep(0.14, 0.0, abs(r - rad));
    float fill = (1.0 - smoothstep(0.0, rad, r)) * (1.0 - burst * 0.55);
    float rays = pow(max(0.0, sin(atan(p.y, p.x) * 12.0 + uTime * 4.0)), 8.0);
    rays *= smoothstep(1.05, 0.0, r) * burst;
    float spark = step(0.90, hash2(cell + floor(uTime * 18.0))) * burst;
    return vec3(1.0) * (fill * 0.95 + ring * 1.2 + rays * 0.85 + spark);
  }

  // Pixel Earth: oceans, land, ice caps, clouds, on a disc.
  vec3 earthPixel(vec2 gc) {
    vec2 p = (gc - 0.5) * vec2(2.0, 1.0);
    float R = 0.40;
    float d = length(p);
    float inside = smoothstep(R + 0.01, R - 0.01, d);
    float z = sqrt(max(0.0, R * R - d * d));
    vec3 nrm = vec3(p.x / R, p.y / R, z / R);
    float lon = atan(nrm.x, nrm.z) + uTime * 0.14;
    float lat = nrm.y;
    float land = fbm(vec2(lon, lat) * 2.6 + vec2(2.7, 1.1));
    float cloud = fbm(vec2(lon, lat) * 3.4 + vec2(uTime * 0.06, 0.8));
    vec3 ocean = vec3(0.07, 0.16, 0.52);
    vec3 grass = vec3(0.16, 0.46, 0.20);
    vec3 desert = vec3(0.52, 0.42, 0.18);
    vec3 ice = vec3(0.88, 0.93, 0.98);
    vec3 col = ocean;
    col = mix(col, grass, smoothstep(0.50, 0.62, land));
    col = mix(col, desert, smoothstep(0.66, 0.82, land) * (1.0 - abs(lat)));
    col = mix(col, ice, smoothstep(0.70, 0.90, abs(lat)));
    col = mix(col, vec3(0.92, 0.94, 0.98), smoothstep(0.60, 0.84, cloud) * 0.5);
    float lit = 0.42 + 0.58 * clamp(nrm.z, 0.0, 1.0);
    col *= lit;
    vec3 limb = vec3(0.30, 0.55, 1.0) * smoothstep(0.0, 0.07, R - d) * 0.45;
    col += limb * inside;
    return col * inside;
  }

  void main() {
    vec2 cell = floor(vUv * uGrid);
    vec2 cuv = fract(vUv * uGrid);
    vec2 cc = (cell + 0.5) / uGrid;
    float edge = smoothstep(0.0, 0.12, cuv.x) * smoothstep(0.0, 0.12, cuv.y)
               * smoothstep(1.0, 0.88, cuv.x) * smoothstep(1.0, 0.88, cuv.y);

    float lumA = content(uModeA, uShapeA, cc);
    float lumB = content(uModeB, uShapeB, cc);
    vec3 colA = colorFor(uModeA, lumA, cc);
    vec3 colB = colorFor(uModeB, lumB, cc);
    vec3 specCol = mix(colA, colB, uBlend) * edge * uIntensity;
    float used = smoothstep(0.02, 0.18, mix(lumA, lumB, uBlend));
    specCol += vec3(0.05) * uBeat * edge * used;

    // Pixel galaxy behind everything, a star in the centre. On a big drop the
    // star detonates white, then Earth fades in as LED tiles.
    vec3 cosmos = galaxyPixel(cell, cc) + centerStar(cc);
    cosmos = mix(cosmos, earthPixel(cc), uEarth);
    vec3 boom = starBurst(cell, cc, max(uBurst, 0.001));
    cosmos = mix(cosmos, vec3(1.0), clamp(boom * uBurst, 0.0, 1.0));
    cosmos *= edge * uIntensity * (0.72 + uAmp * 0.22);

    vec3 outCol = mix(cosmos, specCol, used);
    float rndA = mix(cellAlpha(uModeA, lumA, cell), cellAlpha(uModeB, lumB, cell), uBlend);
    float alpha = mix(max(rndA, 0.82), 1.0, max(used, max(uBurst, uEarth * 0.7)));
    alpha *= edge * uWall;
    gl_FragColor = vec4(outCol * uWall, alpha);
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
    // fire: bright yellow core, orange body, yellow embers that dim out
    vec3 yellow = vec3(1.0, 0.9, 0.35);
    vec3 orange = vec3(1.0, 0.45, 0.08);
    vec3 col = mix(yellow, orange, smoothstep(0.05, 0.45, vAge));
    col = mix(col, yellow * 0.7, smoothstep(0.55, 0.9, vAge));
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
