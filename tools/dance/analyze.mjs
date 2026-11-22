// Beat grid + per-beat energy for a song -> JSON (input for the choreography).
import { analyzeAudio, ANALYSIS_SR } from '../../js/analyzer.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [, , inPath, outPath] = process.argv;
const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', inPath, '-ac', '1', '-ar', String(ANALYSIS_SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const a = await analyzeAudio(samples, ANALYSIS_SR);
// RMS energy per beat (normalized 0..1) and low-band kick strength
const rms = (t0, t1) => { const i0 = Math.max(0, Math.floor(t0 * ANALYSIS_SR)), i1 = Math.min(samples.length, Math.floor(t1 * ANALYSIS_SR)); let s = 0; for (let i = i0; i < i1; i++) s += samples[i] * samples[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
const P = 60 / a.bpm;
const energy = a.beats.map(t => rms(t, t + P));
const mx = Math.max(...energy);
writeFileSync(outPath, JSON.stringify({ bpm: a.bpm, duration: a.duration, downbeat: a.downbeat, beats: a.beats, energy: energy.map(e => +(e / mx).toFixed(3)) }));
console.log('bpm', a.bpm, 'beats', a.beats.length, 'first', a.beats.slice(0, 4), 'downbeat', a.downbeat);
// energy per 8 bars, coarse
const bar = []; for (let i = 0; i < energy.length; i += 4) bar.push((energy.slice(i, i + 4).reduce((x, y) => x + y, 0) / 4 / mx).toFixed(2));
console.log(bar.join(' '));
