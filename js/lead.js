// ============================================================
//  In-browser lead-melody estimate (for songs without an offline transcription)
//  Pure functions, no DOM. Called by the analyzer (worker) and Node tools.
//
//  Predominant-pitch tracking in the spirit of Salamon & Gomez (2012), much simplified:
//   1. STFT (4096 / hop 256 @ 22.05 kHz), spectral peaks 100 Hz - 5 kHz with parabolic interpolation
//   2. harmonic summation: every peak votes for the f0s it could be a harmonic of (8 harmonics, 0.8^h)
//      on a half-semitone pitch grid MIDI 50-92, higher registers weighted up (leads sit above the chords)
//   3. Viterbi through the salience with a cost for pitch jumps -> one continuous line
//   4. voicing: frames whose salience is well below the song's typical melody salience are silent
//   5. notes: cut at silences, at pitch changes that hold, and at mix onsets inside a held pitch
//
//  Returns { notes: [[time, dur, midi, strength 0..1], ...] } (same shape as songs/<id>.lead.json).
// ============================================================

const N = 4096, HOP = 256;
const M_LO = 50, M_HI = 92, RES = 2;              // pitch grid: MIDI 50..92 in half semitones
const NB = (M_HI - M_LO) * RES + 1;
const HARM = 8, MAX_PEAKS = 40;

function makeFFT(n) {
  const levels = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0, x = i;
    for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tre = re[b] * cos[k] - im[b] * sin[k], tim = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tre; im[b] = im[a] - tim; re[a] += tre; im[a] += tim;
        }
      }
    }
  };
}

const tick = () => new Promise(r => setTimeout(r, 0));

// samples: mono Float32Array; onsetT: sorted onset times (s) of the mix, used for re-attacks
export async function estimateLead(samples, sr, onsetT = [], onProgress) {
  const fft = makeFFT(N), half = N / 2;
  const nF = Math.max(1, Math.ceil(samples.length / HOP));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const binHz = sr / N;
  const kLo = Math.ceil(100 / binHz), kHi = Math.min(half - 2, Math.floor(5000 / binHz));
  const reg = new Float32Array(NB);
  for (let b = 0; b < NB; b++) reg[b] = Math.min(1, Math.max(0.35, (M_LO + b / RES - 45) / 26));

  const sal = new Float32Array(nF * NB);
  const re = new Float64Array(N), im = new Float64Array(N);
  const mag = [new Float32Array(half + 1), new Float32Array(half + 1)];
  const pf = new Float32Array(MAX_PEAKS * 4), pa = new Float32Array(MAX_PEAKS * 4);

  const fill = (f, buf) => {
    const s0 = f * HOP - half;
    for (let i = 0; i < N; i++) { const s = s0 + i; buf[i] = s >= 0 && s < samples.length ? samples[s] * win[i] : 0; }
  };
  const salience = (f, m) => {
    // spectral peaks within 40 dB of the frame's strongest
    let mx = 0;
    for (let k = kLo; k <= kHi; k++) if (m[k] > mx) mx = m[k];
    if (mx < 1e-6) return;
    const floor = mx * 0.01;
    let np = 0;
    for (let k = kLo; k <= kHi && np < pf.length; k++) {
      const v = m[k];
      if (v < floor || v <= m[k - 1] || v < m[k + 1]) continue;
      const a = Math.log(m[k - 1] + 1e-9), b = Math.log(v + 1e-9), c = Math.log(m[k + 1] + 1e-9);
      const den = a - 2 * b + c, p = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
      pf[np] = (k + p) * binHz; pa[np] = Math.sqrt(v / mx); np++;
    }
    // strongest MAX_PEAKS
    if (np > MAX_PEAKS) {
      const idx = Array.from({ length: np }, (_, i) => i).sort((x, y) => pa[y] - pa[x]).slice(0, MAX_PEAKS);
      const f2 = idx.map(i => pf[i]), a2 = idx.map(i => pa[i]);
      for (let i = 0; i < MAX_PEAKS; i++) { pf[i] = f2[i]; pa[i] = a2[i]; }
      np = MAX_PEAKS;
    }
    const row = f * NB;
    for (let i = 0; i < np; i++) {
      let w = pa[i];
      for (let h = 1; h <= HARM; h++, w *= 0.8) {
        const mid = 69 + 12 * Math.log2(pf[i] / h / 440);
        if (mid < M_LO - 1) break;
        if (mid > M_HI + 1) continue;
        const c = (mid - M_LO) * RES;
        for (let b = Math.max(0, Math.ceil(c - RES)); b <= Math.min(NB - 1, Math.floor(c + RES)); b++) {
          const d = (b - c) / RES;                          // semitones, |d| <= 1
          const g = Math.cos(Math.PI / 2 * d);
          sal[row + b] += w * g * g;
        }
      }
    }
    for (let b = 0; b < NB; b++) sal[row + b] *= reg[b];
  };

  for (let f = 0; f < nF; f += 2) {
    fill(f, re);
    if (f + 1 < nF) fill(f + 1, im); else im.fill(0);
    fft(re, im);
    for (let k = 0; k <= half; k++) {
      const nk = (N - k) % N;
      const ar = (re[k] + re[nk]) / 2, ai = (im[k] - im[nk]) / 2, br = (im[k] + im[nk]) / 2, bi = (re[nk] - re[k]) / 2;
      mag[0][k] = Math.hypot(ar, ai); mag[1][k] = Math.hypot(br, bi);
    }
    salience(f, mag[0]);
    if (f + 1 < nF) salience(f + 1, mag[1]);
    if ((f & 511) === 0) { if (onProgress) onProgress(0.7 * f / nF); await tick(); }
  }

  // ---- Viterbi: maximise sum(log salience) - jump cost ----
  const JUMP = 0.35, MAXJ = 12 * RES;                       // cost per semitone; jumps beyond an octave not allowed
  const frameMax = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let m = 0; for (let b = 0; b < NB; b++) m = Math.max(m, sal[f * NB + b]); frameMax[f] = m; }
  const ref = [...frameMax].sort((a, b) => a - b)[Math.floor(nF * 0.9)] || 1;
  let score = new Float32Array(NB), next = new Float32Array(NB);
  const back = new Uint8Array(nF * NB);
  const ls = (f, b) => Math.log(sal[f * NB + b] / ref + 0.02);
  for (let b = 0; b < NB; b++) score[b] = ls(0, b);
  for (let f = 1; f < nF; f++) {
    for (let b = 0; b < NB; b++) {
      let best = -Infinity, bi = b;
      const lo = Math.max(0, b - MAXJ), hi = Math.min(NB - 1, b + MAXJ);
      for (let p = lo; p <= hi; p++) {
        const v = score[p] - JUMP * Math.abs(p - b) / RES;
        if (v > best) { best = v; bi = p; }
      }
      next[b] = best + ls(f, b);
      back[f * NB + b] = bi;
    }
    [score, next] = [next, score];
    if ((f & 2047) === 0) { if (onProgress) onProgress(0.7 + 0.25 * f / nF); await tick(); }
  }
  const path = new Uint8Array(nF);
  let bEnd = 0;
  for (let b = 1; b < NB; b++) if (score[b] > score[bEnd]) bEnd = b;
  path[nF - 1] = bEnd;
  for (let f = nF - 1; f > 0; f--) path[f - 1] = back[f * NB + path[f]];

  // ---- voicing: the path's salience against the song's typical melodic salience ----
  const pathSal = new Float32Array(nF);
  for (let f = 0; f < nF; f++) pathSal[f] = sal[f * NB + path[f]];
  const typ = [...pathSal].sort((a, b) => a - b)[Math.floor(nF * 0.7)] || 1;
  const voiced = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) voiced[f] = pathSal[f] > typ * 0.4 && pathSal[f] > frameMax[f] * 0.6 ? 1 : 0;
  // fill 1-2 frame dropouts
  for (let f = 1; f + 2 < nF; f++) if (!voiced[f] && voiced[f - 1] && (voiced[f + 1] || voiced[f + 2])) voiced[f] = 1;

  // ---- notes ----
  const fps = sr / HOP;
  const notes = [];
  let oi = 0;
  let cur = null;   // { f0, ps: [], s }
  const close = fEnd => {
    if (cur && fEnd - cur.f0 >= Math.round(0.06 * fps)) {
      const ps = cur.ps.slice().sort((a, b) => a - b);
      notes.push([cur.f0 / fps, (fEnd - cur.f0) / fps, Math.round(ps[ps.length >> 1]), cur.s / (fEnd - cur.f0)]);
    }
    cur = null;
  };
  for (let f = 0; f < nF; f++) {
    const t = f / fps;
    const m = M_LO + path[f] / RES;
    if (!voiced[f]) { close(f); continue; }
    if (!cur) { cur = { f0: f, ps: [m], s: pathSal[f] }; continue; }
    const recent = cur.ps.slice(-6).sort((a, b) => a - b), refM = recent[recent.length >> 1];
    let split = false;
    if (Math.abs(m - refM) >= 1) {
      split = true;
      for (let j = f + 1; j < Math.min(nF, f + 3); j++) if (!voiced[j] || Math.abs(M_LO + path[j] / RES - refM) < 1) split = false;
    }
    while (oi < onsetT.length && onsetT[oi] < t - 0.5 * HOP / sr) oi++;
    const onsetHere = oi < onsetT.length && onsetT[oi] < t + 0.5 * HOP / sr;
    if (!split && onsetHere && f - cur.f0 >= Math.round(0.08 * fps)) split = true;
    if (split) { close(f); cur = { f0: f, ps: [m], s: pathSal[f] }; }
    else { cur.ps.push(m); cur.s += pathSal[f]; }
  }
  close(nF);

  const ss = notes.map(n => n[3]).sort((a, b) => a - b);
  const lo = ss[Math.floor(ss.length * 0.05)] || 0, hi = ss[Math.floor(ss.length * 0.98)] || 1;
  if (onProgress) onProgress(1);
  return {
    version: 1,
    source: 'browser',
    notes: notes.map(([t, d, p, s]) => [+t.toFixed(3), +d.toFixed(3), p, +Math.min(1, Math.max(0, (s - lo) / Math.max(1e-9, hi - lo))).toFixed(2)]),
  };
}
