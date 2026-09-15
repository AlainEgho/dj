/**
 * Pure-JS audio feature extraction shared by the web and native engines.
 * Everything here works on a byte-frequency array + float time-domain array
 * as produced by an AnalyserNode (browser Web Audio API or react-native-audio-api).
 */
import type { AudioFrame } from './types';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface BandRanges {
  bass: [number, number];
  mid: [number, number];
  treble: [number, number];
}

/** Convert Hz ranges to bin indices for a given sample rate / fft size. */
export function computeBandRanges(sampleRate: number, fftSize: number): BandRanges {
  const binHz = sampleRate / fftSize;
  const bin = (hz: number) => Math.max(0, Math.min(fftSize / 2 - 1, Math.round(hz / binHz)));
  return {
    bass: [bin(20), bin(160)],
    mid: [bin(160), bin(2000)],
    treble: [bin(2000), bin(12000)],
  };
}

function bandEnergy(spec: Uint8Array, from: number, to: number): number {
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += spec[i];
  return sum / ((to - from) * 255);
}

/**
 * Stateful feature extractor. Call `process()` once per animation frame.
 * Implements:
 *  - smoothed RMS amplitude with automatic gain normalisation
 *  - bass/mid/treble band energies with per-band auto-gain
 *  - spectral-flux onset detection with adaptive threshold
 *  - BPM estimation via autocorrelation of the onset envelope
 */
export class FeatureExtractor {
  private prevSpectrum: Float32Array;
  private fluxHistory: Float32Array;
  private fluxIndex = 0;
  private fluxCount = 0;

  private onsetEnvelope: Float32Array; // ring buffer for bpm estimation
  private envIndex = 0;
  private envCount = 0;
  private lastFrameTime = 0;
  private frameInterval = 1000 / 60; // running estimate of ms between frames

  private lastBeatTime = 0;
  private beatEnvelope = 0;
  private bpm = 0;
  private bpmConfidence = 0;
  private lastBpmUpdate = 0;

  private smoothAmp = 0;
  private ampGain = 1;
  private bandGain = { bass: 1, mid: 1, treble: 1 };
  private smoothBands = { bass: 0, mid: 0, treble: 0 };

  private bands: BandRanges;
  private spectrumOut: Float32Array;

  private opts: {
    fluxWindow: number;
    envWindow: number;
    minBeatGapMs: number;
    thresholdMultiplier: number;
  };

  constructor(
    private binCount: number,
    sampleRate: number,
    fftSize: number,
    spectrumBins: number,
    opts?: Partial<FeatureExtractor['opts']>,
  ) {
    this.opts = {
      fluxWindow: 43, // ~0.7s @60fps
      envWindow: 512, // ~8.5s @60fps
      minBeatGapMs: 180,
      thresholdMultiplier: 1.6,
      ...opts,
    };
    this.prevSpectrum = new Float32Array(binCount);
    this.fluxHistory = new Float32Array(this.opts.fluxWindow);
    this.onsetEnvelope = new Float32Array(this.opts.envWindow);
    this.bands = computeBandRanges(sampleRate, fftSize);
    this.spectrumOut = new Float32Array(spectrumBins);
  }

  setSampleRate(sampleRate: number, fftSize: number) {
    this.bands = computeBandRanges(sampleRate, fftSize);
  }

  /**
   * 0..1 input sensitivity. High values lower the onset threshold and let the
   * auto-gain open up fully on quiet sources; low values ignore room noise and
   * only react to strong hits.
   */
  setSensitivity(v: number) {
    const s = Math.min(1, Math.max(0, v));
    this.opts.thresholdMultiplier = 2.6 - s * 1.8; // 2.6 .. 0.8
    this.gainFloor = 0.004 + (1 - s) * 0.09; // 0.094 .. 0.004
  }

  private gainFloor = 0.05;

  process(freq: Uint8Array, timeDomain: Float32Array, now: number): AudioFrame {
    // ---- frame timing ------------------------------------------------
    if (this.lastFrameTime > 0) {
      const dt = now - this.lastFrameTime;
      if (dt > 1 && dt < 200) this.frameInterval = this.frameInterval * 0.9 + dt * 0.1;
    }
    this.lastFrameTime = now;

    // ---- amplitude ---------------------------------------------------
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < timeDomain.length; i++) {
      const v = timeDomain[i];
      sumSq += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, timeDomain.length));
    // auto gain: track a slowly-decaying maximum so quiet mics still fill the range
    this.ampGain = Math.max(rms, this.ampGain * 0.9995, this.gainFloor);
    const normAmp = clamp01(rms / this.ampGain);
    this.smoothAmp += (normAmp - this.smoothAmp) * (normAmp > this.smoothAmp ? 0.5 : 0.12);

    // ---- bands -------------------------------------------------------
    const rawBass = bandEnergy(freq, this.bands.bass[0], this.bands.bass[1]);
    const rawMid = bandEnergy(freq, this.bands.mid[0], this.bands.mid[1]);
    const rawTreble = bandEnergy(freq, this.bands.treble[0], this.bands.treble[1]);
    const bands = this.smoothBands;
    const gains = this.bandGain;
    gains.bass = Math.max(rawBass, gains.bass * 0.999, 0.05);
    gains.mid = Math.max(rawMid, gains.mid * 0.999, 0.05);
    gains.treble = Math.max(rawTreble, gains.treble * 0.999, 0.03);
    const nb = clamp01(rawBass / gains.bass);
    const nm = clamp01(rawMid / gains.mid);
    const nt = clamp01(rawTreble / gains.treble);
    bands.bass += (nb - bands.bass) * (nb > bands.bass ? 0.6 : 0.15);
    bands.mid += (nm - bands.mid) * (nm > bands.mid ? 0.5 : 0.15);
    bands.treble += (nt - bands.treble) * (nt > bands.treble ? 0.7 : 0.2);

    // ---- spectral flux (onset strength) -------------------------------
    // Weighted towards the low end where kicks live; hats/cymbals above 2kHz
    // count for much less so "beat" tracks the pulse rather than every onset.
    let flux = 0;
    const lowEnd = this.bands.mid[0];
    const highStart = this.bands.treble[0];
    for (let i = 0; i < this.binCount; i++) {
      const cur = freq[i] / 255;
      const diff = cur - this.prevSpectrum[i];
      if (diff > 0) flux += i < lowEnd ? diff * 3.5 : i < highStart ? diff * 0.8 : diff * 0.3;
      this.prevSpectrum[i] = cur;
    }
    flux /= this.binCount;

    this.fluxHistory[this.fluxIndex] = flux;
    this.fluxIndex = (this.fluxIndex + 1) % this.fluxHistory.length;
    if (this.fluxCount < this.fluxHistory.length) this.fluxCount++;

    let mean = 0;
    for (let i = 0; i < this.fluxCount; i++) mean += this.fluxHistory[i];
    mean /= Math.max(1, this.fluxCount);
    let variance = 0;
    for (let i = 0; i < this.fluxCount; i++) {
      const d = this.fluxHistory[i] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / Math.max(1, this.fluxCount));
    const threshold = mean + std * this.opts.thresholdMultiplier + 0.002;

    let beat = false;
    if (flux > threshold && now - this.lastBeatTime > this.opts.minBeatGapMs && this.fluxCount > 10) {
      beat = true;
      this.lastBeatTime = now;
      this.beatEnvelope = 1;
    } else {
      // exponential decay tuned to ~150ms half-life
      this.beatEnvelope *= Math.pow(0.5, this.frameInterval / 150);
    }

    // ---- onset envelope for BPM ---------------------------------------
    this.onsetEnvelope[this.envIndex] = Math.max(0, flux - mean);
    this.envIndex = (this.envIndex + 1) % this.onsetEnvelope.length;
    if (this.envCount < this.onsetEnvelope.length) this.envCount++;
    if (now - this.lastBpmUpdate > 1000 && this.envCount > this.onsetEnvelope.length * 0.5) {
      this.lastBpmUpdate = now;
      this.estimateBpm();
    }

    // ---- beat phase -----------------------------------------------------
    let beatPhase = 0;
    if (this.bpm > 0) {
      const period = 60000 / this.bpm;
      beatPhase = ((now - this.lastBeatTime) % period) / period;
    }

    // ---- downsampled spectrum --------------------------------------------
    const out = this.spectrumOut;
    const ratio = this.binCount / out.length;
    for (let i = 0; i < out.length; i++) {
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
      let m = 0;
      for (let j = from; j < to; j++) if (freq[j] > m) m = freq[j];
      const v = m / 255;
      out[i] += (v - out[i]) * (v > out[i] ? 0.7 : 0.25);
    }

    return {
      amplitude: this.smoothAmp,
      peak: clamp01(peak / this.ampGain),
      bass: bands.bass,
      mid: bands.mid,
      treble: bands.treble,
      beat,
      beatEnvelope: this.beatEnvelope,
      bpm: this.bpm,
      bpmConfidence: this.bpmConfidence,
      beatPhase,
      spectrum: out,
      time: now,
    };
  }

  /**
   * Autocorrelate the onset envelope over lags that map to 60-180 BPM and pick
   * the strongest peak. Cheap enough to run once per second.
   */
  private estimateBpm() {
    const n = this.envCount;
    const env = this.onsetEnvelope;
    const start = this.envIndex; // oldest sample once the ring is full
    const lin = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      lin[i] = env[(start + i) % env.length];
      mean += lin[i];
    }
    mean /= n;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      lin[i] -= mean;
      energy += lin[i] * lin[i];
    }
    if (energy < 1e-9) {
      this.bpmConfidence = 0;
      return;
    }

    const msPerFrame = this.frameInterval;
    const minLag = Math.max(2, Math.floor(60000 / 180 / msPerFrame));
    const maxLag = Math.min(n - 2, Math.ceil(60000 / 60 / msPerFrame));
    const at = (lag: number) => {
      if (lag < minLag || lag > maxLag) return 0;
      let acc = 0;
      for (let i = 0; i + lag < n; i++) acc += lin[i] * lin[i + lag];
      return acc / (n - lag); // normalise so long lags are not penalised
    };
    let bestLag = 0;
    let bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const v = at(lag);
      if (v > bestVal) {
        bestVal = v;
        bestLag = lag;
      }
    }
    if (bestLag === 0) return;

    // Parabolic interpolation around the peak for sub-frame precision
    const y0 = at(bestLag - 1);
    const y1 = bestVal;
    const y2 = at(bestLag + 1);
    const denom = y0 - 2 * y1 + y2;
    const offset = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
    const lagMs = (bestLag + offset) * msPerFrame;
    let bpm = 60000 / lagMs;
    // fold into the 70-170 range that covers most dance music
    while (bpm < 70) bpm *= 2;
    while (bpm > 170) bpm /= 2;

    const confidence = clamp01(bestVal / (energy / n));
    if (this.bpm === 0 || Math.abs(bpm - this.bpm) > 12) this.bpm = bpm;
    else this.bpm += (bpm - this.bpm) * 0.3;
    this.bpmConfidence = this.bpmConfidence * 0.5 + confidence * 0.5;
  }

  reset() {
    this.prevSpectrum.fill(0);
    this.fluxHistory.fill(0);
    this.onsetEnvelope.fill(0);
    this.fluxIndex = this.fluxCount = this.envIndex = this.envCount = 0;
    this.bpm = 0;
    this.bpmConfidence = 0;
    this.beatEnvelope = 0;
    this.smoothAmp = 0;
    this.spectrumOut.fill(0);
  }
}

export function emptyFrame(spectrumBins: number): AudioFrame {
  return {
    amplitude: 0,
    peak: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: false,
    beatEnvelope: 0,
    bpm: 0,
    bpmConfidence: 0,
    beatPhase: 0,
    spectrum: new Float32Array(spectrumBins),
    time: 0,
  };
}
