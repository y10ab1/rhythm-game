// Chart quality report: node tools/chart_report.mjs
import { analyzeAudio, ANALYSIS_SR } from '../js/analyzer.js';
import { generateChart, DIFFICULTIES } from '../js/chart.js';
import { parseMidi, midiToSong } from '../js/midi.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('songs/manifest.json', 'utf8'));
for (const s of manifest) {
  let an;
  if (s.kind === 'midi') {
    const b = fs.readFileSync('songs/' + s.file);
    an = midiToSong(parseMidi(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))).analysis;
  } else {
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', 'songs/' + s.file, '-ac', '1', '-ar', String(ANALYSIS_SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
    an = await analyzeAudio(new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4), ANALYSIS_SR);
  }
  for (const d of DIFFICULTIES) {
    const { notes, stats } = generateChart(an, d);
    const times = new Map();
    for (const n of notes) times.set(n.time, (times.get(n.time) || 0) + 1);
    const chordNotes = [...times.values()].filter(v => v > 1).length;
    const lanes = [0, 0, 0, 0];
    notes.forEach(n => lanes[n.lane]++);
    let fastJacks = 0, overlaps = 0;
    const last = [null, null, null, null];
    for (const n of notes) {
      const p = last[n.lane];
      if (p) {
        if (n.time - (p.end || p.time) < 0.3) fastJacks++;
        if (p.end && n.time < p.end) overlaps++;
      }
      last[n.lane] = n;
    }
    console.log(`${s.title.padEnd(14)} ${d.padEnd(7)} Lv${String(stats.level).padStart(2)} notes ${String(stats.count).padStart(4)} nps ${stats.nps} holds ${stats.holds} chords ${chordNotes} lanes ${lanes.join('/')} jacks<300ms ${fastJacks} holdOverlap ${overlaps}`);
  }
}
