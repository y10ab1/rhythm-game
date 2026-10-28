// Accuracy test for js/analyzer.js.
//   node tools/test_analyzer.mjs            -> synthetic drum tests
//   node tools/test_analyzer.mjs file.mp3   -> analyse a real file (needs ffmpeg)
import { analyzeAudio, ANALYSIS_SR } from '../js/analyzer.js';
import { execFileSync } from 'node:child_process';

const sr = ANALYSIS_SR;

function synth(bpm, seconds, { swingNoise = 0, offset = 0.5 } = {}) {
  const out = new Float32Array(Math.round(seconds * sr));
  const beat = 60 / bpm;
  const truth = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const put = (t, fn, len) => {
    const s0 = Math.round(t * sr);
    for (let i = 0; i < len * sr && s0 + i < out.length; i++) out[s0 + i] += fn(i / sr);
  };
  for (let k = 0; offset + k * beat < seconds - 1; k++) {
    const t = offset + k * beat + (rnd() - 0.5) * swingNoise;
    truth.push(t);
    // kick on every beat, snare on 2 & 4, hats on 8ths
    put(t, x => Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-x * 30)) * x) * Math.exp(-x * 12) * 0.8, 0.3);
    if (k % 2 === 1) put(t, x => (rnd() * 2 - 1) * Math.exp(-x * 25) * 0.4 + Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x * 20) * 0.3, 0.2);
    put(t + beat / 2, x => (rnd() * 2 - 1) * Math.exp(-x * 80) * 0.15, 0.05);
    // a pad so the signal is not silent between hits
  }
  for (let i = 0; i < out.length; i++) out[i] += Math.sin(2 * Math.PI * 220 * i / sr) * 0.03;
  return { out, truth };
}

function nearestErr(truth, onsets) {
  const errs = [];
  for (const t of truth) {
    let best = Infinity;
    for (const o of onsets) if (Math.abs(o - t) < Math.abs(best)) best = o - t;
    if (Math.abs(best) < 0.05) errs.push(best * 1000);
  }
  errs.sort((a, b) => a - b);
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  return { found: errs.length, of: truth.length, meanMs: mean.toFixed(2), medianMs: errs[errs.length >> 1]?.toFixed(2), maxAbs: Math.max(...errs.map(Math.abs)).toFixed(2) };
}

async function file(path) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const t0 = Date.now();
  const a = await analyzeAudio(samples, sr);
  console.log(path, { ms: Date.now() - t0, bpm: a.bpm, steady: a.steady, beats: a.beats.length, firstBeat: a.beats[0], downbeat: a.downbeat, onsets: a.onsets.t.length, duration: a.duration });
  // How well do strong onsets sit on the grid?
  const beatSet = a.beats;
  const errs = [];
  a.onsets.t.forEach((t, i) => {
    if (a.onsets.s[i] < 0.5) return;
    let best = Infinity;
    for (let k = 0; k < beatSet.length - 1; k++) {
      const d = beatSet[k + 1] - beatSet[k];
      for (let q = 0; q < 4; q++) { const g = beatSet[k] + q * d / 4; if (Math.abs(t - g) < Math.abs(best)) best = t - g; }
    }
    errs.push(best * 1000);
  });
  errs.sort((x, y) => x - y);
  const within = errs.filter(e => Math.abs(e) < 20).length;
  console.log('  strong onsets near 16th grid:', within, '/', errs.length, 'median err ms', errs[errs.length >> 1]?.toFixed(1));
  return a;
}

if (process.argv.length > 2) {
  for (const p of process.argv.slice(2)) await file(p);
} else {
  for (const bpm of [88, 120, 140, 174]) {
    const { out, truth } = synth(bpm, 40);
    const a = await analyzeAudio(out, sr);
    const beatErr = nearestErr(truth, a.beats);
    const onsetErr = nearestErr(truth, a.onsets.t);
    console.log(`bpm ${bpm}: detected ${a.bpm} steady=${a.steady} beats ${JSON.stringify(beatErr)} onsets ${JSON.stringify(onsetErr)}`);
  }
  const { out, truth } = synth(126, 40, { swingNoise: 0.012 });
  const a = await analyzeAudio(out, sr);
  console.log('humanised 126:', a.bpm, nearestErr(truth, a.beats), nearestErr(truth, a.onsets.t));
}
