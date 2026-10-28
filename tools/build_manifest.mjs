// Build songs/manifest.json: analyses every built-in song with the same
// analyzer + chart generator the game uses, and stores display metadata
// (BPM, length, note counts, level per difficulty).
//   node tools/build_manifest.mjs
import { analyzeAudio, ANALYSIS_SR } from '../js/analyzer.js';
import { generateChart, DIFFICULTIES } from '../js/chart.js';
import { parseMidi, midiToSong } from '../js/midi.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const songsDir = path.join(root, 'songs');

const SONGS = [
  { id: 'neon-drift', title: 'Neon Drift', artist: 'Lyria 3.5', genre: 'Synthwave', file: 'neon-drift.mp3', color: '#50b4ff' },
  { id: 'fiesta-caliente', title: 'Fiesta Caliente', artist: 'Lyria 3.5', genre: 'Reggaeton', file: 'fiesta-caliente.mp3', color: '#ff8a3d' },
  { id: 'sunset-boulevard', title: 'Sunset Boulevard', artist: 'Lyria 3.5', genre: 'City Pop', file: 'sunset-boulevard.mp3', color: '#ff7eb6' },
  { id: 'groove-machine', title: 'Groove Machine', artist: 'Lyria 3.5', genre: 'Funk / Disco', file: 'groove-machine.mp3', color: '#c38bff' },
  { id: 'skyline-run', title: 'Skyline Run', artist: 'Lyria 3.5', genre: 'Nu-Disco', file: 'skyline-run.mp3', color: '#50ff78' },
  { id: 'starlight-stage', title: 'Starlight Stage', artist: 'Lyria 3.5', genre: 'K-Pop Dance', file: 'starlight-stage.mp3', color: '#ffd6f0' },
  { id: 'voltage-rush', title: 'Voltage Rush', artist: 'Lyria 3.5', genre: 'Electro House', file: 'voltage-rush.mp3', color: '#ffc832' },
  { id: 'pixel-quest', title: 'Pixel Quest', artist: 'Lyria 3.5', genre: 'Chiptune', file: 'pixel-quest.mp3', color: '#3dffe0' },
  { id: 'neon-riot', title: 'Neon Riot', artist: 'Lyria 3.5', genre: 'Pop-Punk / J-Rock', file: 'neon-riot.mp3', color: '#ff3d8a' },
  { id: 'hyper-circuit', title: 'Hyper Circuit', artist: 'Lyria 3.5', genre: 'Drum & Bass', file: 'hyper-circuit.mp3', color: '#ff5050' },
  { id: 'fur-elise', title: 'Für Elise', artist: 'Beethoven', genre: 'Classical (MIDI)', file: 'fur_elise.mid', color: '#ff6fd8' },
];

const out = [];
for (const s of SONGS) {
  const file = path.join(songsDir, s.file);
  let an;
  if (s.file.endsWith('.mid')) {
    const buf = fs.readFileSync(file);
    an = midiToSong(parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).analysis;
  } else {
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(ANALYSIS_SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
    an = await analyzeAudio(new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4), ANALYSIS_SR);
  }
  const levels = {};
  for (const d of DIFFICULTIES) {
    const { stats } = generateChart(an, d);
    levels[d] = { level: stats.level, notes: stats.count };
  }
  const entry = { ...s, kind: s.file.endsWith('.mid') ? 'midi' : 'audio', bpm: Math.round(an.bpm), duration: Math.round(an.duration), levels };
  console.log(entry.title, entry.bpm, entry.duration, JSON.stringify(levels));
  out.push(entry);
}
fs.writeFileSync(path.join(songsDir, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
