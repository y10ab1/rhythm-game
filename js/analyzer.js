// ============================================================
//  Audio analysis: onset detection + tempo / beat-grid tracking
//  Pure functions, no DOM. Used by the browser (worker) and Node tools.
// ============================================================

export const ANALYZER_VERSION = 5;
export const ANALYSIS_SR = 22050;

const N = 1024;   // FFT size (46 ms @ 22.05 kHz)
const HOP = 128;  // 5.8 ms hop -> fine onset resolution

// Systematic delay of spectral-flux peaks relative to the true attack,
// measured with tools/test_analyzer.mjs on synthetic drum hits.
const ONSET_BIAS_SEC = -0.009;

// ---------- FFT (radix-2, two real frames packed per complex FFT) ----------
function makeFFT(n) {
  const levels = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0, x = i;
    for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / n);
    sin[i] = -Math.sin(2 * Math.PI * i / n);
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tre = re[b] * cos[k] - im[b] * sin[k];
          const tim = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tre; im[b] = im[a] - tim;
          re[a] += tre; im[a] += tim;
        }
      }
    }
  };
}

// ---------- small helpers ----------
function movingAverage(x, radius) {
  const n = x.length, out = new Float32Array(n);
  let acc = 0;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { acc += x[i]; prefix[i + 1] = acc; }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius), b = Math.min(n, i + radius + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

function gaussianSmooth(x, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * (i / sigma) ** 2); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const n = x.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < n) s += x[idx] * k[j + r];
    }
    out[i] = s;
  }
  return out;
}

function percentile(x, p) {
  const vals = [];
  for (let i = 0; i < x.length; i++) if (x[i] > 1e-9) vals.push(x[i]);
  if (!vals.length) return 1;
  vals.sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] || 1;
}

function interp(x, pos) {
  if (pos < 0 || pos >= x.length - 1) return 0;
  const i = Math.floor(pos), f = pos - i;
  return x[i] * (1 - f) + x[i + 1] * f;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const tick = () => new Promise(r => setTimeout(r, 0));

// ============================================================
//  STFT features
// ============================================================
async function computeFeatures(samples, sr, onProgress) {
  const fft = makeFFT(N);
  const half = N / 2;
  const nFrames = Math.max(1, Math.ceil(samples.length / HOP));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);

  const binHz = sr / N;
  const bin = hz => Math.max(1, Math.min(half - 1, Math.round(hz / binHz)));
  const lowA = bin(30), lowB = bin(180), midB = bin(2500), highB = bin(10000);

  const fluxLow = new Float32Array(nFrames);
  const fluxMid = new Float32Array(nFrames);
  const fluxHigh = new Float32Array(nFrames);
  const energyMid = new Float32Array(nFrames); // dB
  const energyAll = new Float32Array(nFrames); // dB
  const centroid = new Float32Array(nFrames);  // log2(Hz)

  // ring buffer of the last 3 log-magnitude spectra (lag-2 SuperFlux)
  const hist = [new Float32Array(half + 1), new Float32Array(half + 1), new Float32Array(half + 1)];
  const re = new Float64Array(N), im = new Float64Array(N);
  const magA = new Float32Array(half + 1), magB = new Float32Array(half + 1);
  const norm = 2 / N;
  const LAMBDA = 1000;

  const fillFrame = (frame, buf) => {
    const start = frame * HOP - half; // centred frames: frame time = frame * HOP / sr
    for (let i = 0; i < N; i++) {
      const s = start + i;
      buf[i] = (s >= 0 && s < samples.length) ? samples[s] * win[i] : 0;
    }
  };

  const processMag = (f, mag) => {
    const cur = hist[f % 3];
    const prev = hist[(f + 1) % 3]; // frame f-2
    let eMid = 0, eAll = 0, cNum = 0, cDen = 0;
    for (let k = 0; k <= half; k++) {
      const m = mag[k];
      cur[k] = Math.log1p(LAMBDA * m);
      const p2 = m * m;
      if (k >= lowA && k <= highB) eAll += p2;
      if (k > lowB && k <= midB) eMid += p2;
      if (k >= lowA && k <= highB) { cNum += k * m; cDen += m; }
    }
    let fl = 0, fm = 0, fh = 0;
    if (f >= 2) {
      for (let k = lowA; k <= highB; k++) {
        const ref = Math.max(prev[k - 1], prev[k], prev[k + 1]);
        const d = cur[k] - ref;
        if (d > 0) {
          if (k <= lowB) fl += d; else if (k <= midB) fm += d; else fh += d;
        }
      }
    }
    fluxLow[f] = fl / (lowB - lowA + 1);
    fluxMid[f] = fm / (midB - lowB);
    fluxHigh[f] = fh / (highB - midB);
    energyMid[f] = 10 * Math.log10(eMid + 1e-12);
    energyAll[f] = 10 * Math.log10(eAll + 1e-12);
    centroid[f] = cDen > 1e-9 ? Math.log2(Math.max(20, (cNum / cDen) * binHz)) : 0;
  };

  for (let f = 0; f < nFrames; f += 2) {
    fillFrame(f, re);
    if (f + 1 < nFrames) fillFrame(f + 1, im); else im.fill(0);
    fft(re, im);
    for (let k = 0; k <= half; k++) {
      const nk = (N - k) % N;
      const ar = (re[k] + re[nk]) / 2, ai = (im[k] - im[nk]) / 2;
      const br = (im[k] + im[nk]) / 2, bi = (re[nk] - re[k]) / 2;
      magA[k] = Math.hypot(ar, ai) * norm;
      magB[k] = Math.hypot(br, bi) * norm;
    }
    processMag(f, magA);
    if (f + 1 < nFrames) processMag(f + 1, magB);
    if ((f & 2047) === 0) {
      if (onProgress) onProgress(0.75 * f / nFrames);
      await tick();
    }
  }

  return { nFrames, fluxLow, fluxMid, fluxHigh, energyMid, energyAll, centroid };
}

// ============================================================
//  Tempo estimation + beat grid
// ============================================================
function estimateTempo(tempoOdf, fps) {
  const n = tempoOdf.length;
  const novelty = new Float32Array(n);
  const avg = movingAverage(tempoOdf, Math.round(0.2 * fps));
  for (let i = 0; i < n; i++) novelty[i] = Math.max(0, tempoOdf[i] - avg[i]);

  const minLag = Math.floor(60 * fps / 220);
  const maxLag = Math.min(n - 1, Math.ceil(4 * 60 * fps / 60));
  const acf = new Float32Array(maxLag + 2);
  for (let L = minLag; L <= maxLag + 1 && L < n; L++) {
    let s = 0;
    for (let i = L; i < n; i++) s += novelty[i] * novelty[i - L];
    acf[L] = s / (n - L);
  }

  let best = 120, bestScore = -1;
  for (let bpm = 62; bpm <= 210; bpm += 0.25) {
    const L = 60 * fps / bpm;
    let sc = interp(acf, L) + 0.5 * interp(acf, 2 * L);
    if (4 * L <= maxLag) sc += 0.25 * interp(acf, 4 * L);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 125) / 0.85) ** 2);
    const score = sc * prior;
    if (score > bestScore) { bestScore = score; best = bpm; }
  }
  return best;
}

function combScore(odf, P, phi) {
  let s = 0, c = 0;
  for (let x = phi; x < odf.length - 1; x += P) { s += interp(odf, x); c++; }
  return c ? s / c : 0;
}

// Fit a constant-tempo grid (period P frames, phase phi) precisely to the odf.
function fitGrid(odfS, bpm0, fps) {
  const P0 = 60 * fps / bpm0;
  let best = { P: P0, phi: 0, score: -1 };
  const search = (Pmin, Pmax, Pstep, phiStep, phiRange) => {
    for (let P = Pmin; P <= Pmax; P += Pstep) {
      const [a, b] = phiRange ? phiRange : [0, P];
      for (let phi = a; phi < b; phi += phiStep) {
        const s = combScore(odfS, P, ((phi % P) + P) % P);
        if (s > best.score) best = { P, phi: ((phi % P) + P) % P, score: s };
      }
    }
  };
  search(P0 * 0.985, P0 * 1.015, P0 * 0.0005, 0.5);
  const c = best;
  search(c.P - P0 * 0.0006, c.P + P0 * 0.0006, P0 * 0.00005, 0.1, [c.phi - 0.6, c.phi + 0.6]);
  return best;
}

// ============================================================
//  Main entry
// ============================================================
export async function analyzeAudio(samples, sr = ANALYSIS_SR, onProgress) {
  const fps = sr / HOP;
  const duration = samples.length / sr;
  const feat = await computeFeatures(samples, sr, onProgress);
  const { nFrames } = feat;

  // normalise bands so they are comparable
  const nl = percentile(feat.fluxLow, 0.97), nm = percentile(feat.fluxMid, 0.97), nh = percentile(feat.fluxHigh, 0.97);
  const lo = new Float32Array(nFrames), mi = new Float32Array(nFrames), hi = new Float32Array(nFrames);
  const odf = new Float32Array(nFrames);
  const tempoOdf = new Float32Array(nFrames);
  const gridOdf = new Float32Array(nFrames);
  const lowOdf = new Float32Array(nFrames);

  // silence gate: ignore flux in frames far below the track's loud level
  const loud = percentile(feat.energyAll.map(v => v + 120), 0.95) - 120;
  for (let i = 0; i < nFrames; i++) {
    const gate = feat.energyAll[i] > loud - 45 ? 1 : 0;
    lo[i] = gate * feat.fluxLow[i] / nl;
    mi[i] = gate * feat.fluxMid[i] / nm;
    hi[i] = gate * feat.fluxHigh[i] / nh;
    odf[i] = (lo[i] + mi[i] + 0.7 * hi[i]) / 2.7;
    tempoOdf[i] = lo[i] * 1.2 + mi[i];
    gridOdf[i] = lo[i] * 1.2 + mi[i] + 0.5 * hi[i];
    lowOdf[i] = lo[i];
  }
  if (onProgress) onProgress(0.8);
  await tick();

  // ---- onset peak picking ----
  const thr = movingAverage(odf, Math.round(0.15 * fps));
  const W = 3, minGapFrames = Math.round(0.03 * fps);
  const onsets = { t: [], s: [], lo: [], mi: [], hi: [], c: [], sus: [] };
  let lastPeak = -1e9;
  const onsetFrames = [];
  for (let i = W; i < nFrames - W; i++) {
    const v = odf[i];
    if (v < thr[i] * 1.25 + 0.05) continue;
    let isMax = true;
    for (let j = i - W; j <= i + W; j++) if (odf[j] > v || (odf[j] === v && j < i)) { isMax = false; break; }
    if (!isMax) continue;
    if (i - lastPeak < minGapFrames) {
      const prev = onsetFrames[onsetFrames.length - 1];
      if (prev !== undefined && odf[prev] < v) onsetFrames[onsetFrames.length - 1] = i, lastPeak = i;
      continue;
    }
    onsetFrames.push(i);
    lastPeak = i;
  }
  for (let n = 0; n < onsetFrames.length; n++) {
    const i = onsetFrames[n];
    const a = odf[i - 1], b = odf[i], c = odf[i + 1];
    const den = a - 2 * b + c;
    const p = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
    const t = (i + p) / fps - ONSET_BIAS_SEC;
    const band = arr => Math.max(arr[i - 1], arr[i], arr[i + 1]);

    // sustain: how long mid-band energy stays up without a new strong attack
    const peakE = Math.max(...Array.from(feat.energyMid.subarray(i, Math.min(nFrames, i + 5))));
    const nextStrong = onsetFrames.slice(n + 1).find(j => odf[j] > b * 0.5);
    const limit = Math.min(nFrames, i + Math.round(4 * fps), nextStrong ?? nFrames);
    let j = i + 4;
    while (j < limit && feat.energyMid[j] > peakE - 9) j++;
    const sus = Math.max(0, (j - i) / fps);

    onsets.t.push(+t.toFixed(4));
    onsets.s.push(+b.toFixed(4));
    onsets.lo.push(+band(lo).toFixed(3));
    onsets.mi.push(+band(mi).toFixed(3));
    onsets.hi.push(+band(hi).toFixed(3));
    onsets.c.push(+feat.centroid[Math.min(nFrames - 1, i + 2)].toFixed(3));
    onsets.sus.push(+sus.toFixed(3));
  }
  if (onProgress) onProgress(0.85);
  await tick();

  // ---- tempo & grid ----
  const bpm0 = estimateTempo(tempoOdf, fps);
  const odfS = gaussianSmooth(gridOdf, 1.5);
  const lowS = gaussianSmooth(lowOdf, 1.5);

  // The autocorrelation peak can lock onto a 2/3, 3/2 or octave relative.
  // Verify candidates by how many strong onsets land on their 16th grid
  // (minus what a grid that dense would catch by chance).
  const strongIdx = onsets.s.map((s, i) => i).filter(i => onsets.s[i] > 0.35);
  const gridFit = (P, phi, sub) => {
    const step = P / sub, tol = 0.012 * fps;
    let hit = 0;
    for (const i of strongIdx) {
      const f = (onsets.t[i] + ONSET_BIAS_SEC) * fps;
      const r = (((f - phi) % step) + step) % step;
      if (Math.min(r, step - r) < tol) hit++;
    }
    const raw = hit / Math.max(1, strongIdx.length);
    return { raw, fit: raw - Math.min(1, 2 * tol / step) };
  };
  const cands = [];
  for (const r of [1, 2, 0.5, 1.5, 2 / 3, 0.75, 4 / 3]) {
    const b = bpm0 * r;
    if (b < 60 || b > 215) continue;
    const g = fitGrid(odfS, b, fps);
    cands.push({ ...g, ...gridFit(g.P, g.phi, 4), bpm: 60 * fps / g.P });
  }
  cands.sort((a, b) => b.fit - a.fit);
  // A grid twice as fast always fits at least as well; between octave
  // relatives with equal raw fit, take the more plausible tempo.
  const prior = c => Math.exp(-0.5 * (Math.log2(c.bpm / 115) / 0.85) ** 2);
  const top = cands[0];
  const octave = cands.filter(c => {
    const r = c.bpm / top.bpm;
    return (Math.abs(r - 1) < 0.01 || Math.abs(r - 2) < 0.02 || Math.abs(r - 0.5) < 0.01) && c.raw >= top.raw - 0.03;
  });
  const pick = octave.sort((a, b) => prior(b) - prior(a))[0];
  let { P, phi } = pick;

  // resolve on-beat vs off-beat: kicks usually land on the beat
  if (combScore(lowS, P, (phi + P / 2) % P) > combScore(lowS, P, phi) * 1.15) phi = (phi + P / 2) % P;

  // Octave: a backbeat (snare) sitting on the off-beat 8ths means the
  // real beat is twice as fast (e.g. drum & bass read as 87 instead of 174).
  const midS = gaussianSmooth(mi, 1.5);
  const onBeat = combScore(midS, P, phi), offBeat = combScore(midS, P, (phi + P / 2) % P);
  // (a dembow-style snare/rim on the "and" must not outvote kicks that clearly sit on the beat)
  const kickOn = combScore(lowS, P, phi), kickOff = combScore(lowS, P, (phi + P / 2) % P);
  if (60 * fps / P < 100 && offBeat > onBeat * 0.8 && kickOff > kickOn * 0.5) {
    const g = fitGrid(odfS, 2 * 60 * fps / P, fps);
    P = g.P; phi = g.phi;
    if (combScore(lowS, P, (phi + P / 2) % P) > combScore(lowS, P, phi) * 1.15) phi = (phi + P / 2) % P;
  } else if (60 * fps / P > 200) {
    P *= 2;
  }

  // Fine phase: align the grid to the median of nearby strong onsets.
  const devs = [];
  for (const i of strongIdx) {
    const f = (onsets.t[i] + ONSET_BIAS_SEC) * fps;
    const r = (((f - phi) % P) + P) % P;
    const d = r > P / 2 ? r - P : r;
    if (Math.abs(d) < 0.02 * fps) devs.push(d);
  }
  if (devs.length > 8) phi += median(devs);

  const firstT = onsets.t.length ? onsets.t[0] : 0;
  const lastT = onsets.t.length ? onsets.t[onsets.t.length - 1] : duration;
  const startFrame = Math.max(0, firstT * fps - P);
  const endFrame = Math.min(nFrames - 1, lastT * fps + P);
  const k0 = Math.ceil((startFrame - phi) / P), k1 = Math.floor((endFrame - phi) / P);
  const gridFrames = [];
  for (let k = k0; k <= k1; k++) gridFrames.push(phi + k * P);

  // ---- local drift correction (only applied to unsteady recordings) ----
  const maxShift = P * 0.1;
  const shifts = gridFrames.map((_, k) => {
    let bestD = 0, bestS = -1;
    for (let d = -maxShift; d <= maxShift; d += 0.5) {
      let s = 0;
      for (let j = Math.max(0, k - 4); j <= Math.min(gridFrames.length - 1, k + 4); j++) s += interp(odfS, gridFrames[j] + d);
      if (s > bestS) { bestS = s; bestD = d; }
    }
    return bestD;
  });
  const steadyFrac = shifts.filter(d => Math.abs(d) / fps < 0.012).length / Math.max(1, shifts.length);
  let beatFrames = gridFrames;
  if (steadyFrac < 0.75) {
    const smooth = shifts.map((_, k) => median(shifts.slice(Math.max(0, k - 4), k + 5)));
    beatFrames = gridFrames.map((g, k) => g + smooth[k]);
  }
  const beats = beatFrames.map(f => +(f / fps - ONSET_BIAS_SEC).toFixed(4));

  // ---- downbeat: which beat (mod 4) carries the most low-end ----
  let downbeat = 0, bestDb = -1;
  for (let o = 0; o < 4; o++) {
    let s = 0;
    for (let k = o; k < beatFrames.length; k += 4) s += interp(lowS, beatFrames[k]);
    if (s > bestDb) { bestDb = s; downbeat = o; }
  }

  if (onProgress) onProgress(1);
  return {
    version: ANALYZER_VERSION,
    kind: 'audio',
    duration: +duration.toFixed(3),
    bpm: +(60 * fps / P).toFixed(2),
    steady: steadyFrac >= 0.75,
    beats,
    downbeat,
    onsets,
  };
}
