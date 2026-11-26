// ============================================================
//  App shell: menus, library, uploads, settings, calibration
// ============================================================
import { AudioEngine } from './audio.js';
import { Game, LANE_COLORS, AUTOPLAY } from './game.js';
import { resultArt } from './character.js';
import { generateChart, DIFFICULTIES } from './chart.js';
import { analyzeAudio, ANALYZER_VERSION, ANALYSIS_SR, previewStart, PREVIEW_LEN } from './analyzer.js';
import { parseMidi, midiToSong } from './midi.js';
import { storage } from './storage.js';
import { t, lang, setLang, applyI18n } from './i18n.js';
import { DEBUG, DebugLog } from './debug.js';

const API_BASE = 'https://rhythm-game-api.yabipeng.workers.dev';
const DIFF_COLORS = { easy: '#5dffa8', normal: '#5ab8ff', hard: '#ffcb47', expert: '#ff4d5e' };
const UPLOAD_COLORS = ['#ff6fd8', '#6a5cff', '#00d2ff', '#ff9a5a', '#5dffa8', '#ffcb47'];

const $ = id => document.getElementById(id);
const canvas = $('gameCanvas');
const audio = new AudioEngine();
const game = new Game(canvas, audio, { onEnd: r => (tut ? tutorialEnd(r) : showResults(r)) });
if (DEBUG) { game.dbg = new DebugLog(); window.__game = game; }

// ---------- settings ----------
const DEFAULTS = {
  speed: 5, offset: 0, music: 80, hitsound: 45, showTiming: true, noFail: false, autoSubmit: true, playLog: true, character: true, cutin: true, noteStyle: 'bachi', gimmicks: true,
  keys: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'], keyLabels: ['D', 'F', 'J', 'K'],
};
let settings = { ...DEFAULTS, ...safeJSON(localStorage.getItem('rhythmSettings'), {}) };
function safeJSON(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }
function saveSettings() {
  localStorage.setItem('rhythmSettings', JSON.stringify(settings));
  applyVolumes();
  renderKeys();
}
function applyVolumes() {
  if (audio.ctx) audio.setVolumes(Math.pow(settings.music / 100, 1.5), Math.pow(settings.hitsound / 100, 1.5) * 0.9);
}
function unlockAudio() {
  audio.ensure();
  applyVolumes();
}

// ---------- screens ----------
let screen = 'title';
let settingsReturn = 'title';
// big scene changes get a slanted-band wipe; the swap happens while the bands cover the screen
const WIPE = new Set(['title>select', 'select>loading', 'loading>play', 'play>results', 'results>loading', 'results>select', 'pause>select', 'tutorial>select']);
let wipeTimer = 0;
function show(name) {
  const from = screen;
  if (name === 'select') { if (from !== 'select') startPreview(currentSong()); } else stopPreview();
  const apply = () => {
    screen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === name + 'Screen'));
    $('pauseBtn').classList.toggle('hidden', name !== 'play');
    $('tutBanner').classList.toggle('hidden', !(name === 'play' && tut));
    if (name !== 'play') startMenuBg();
  };
  const w = $('wipe');
  if (name !== from && WIPE.has(`${from}>${name}`) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    w.classList.remove('go'); void w.offsetWidth; w.classList.add('go');
    clearTimeout(wipeTimer);
    screen = name;
    // play must switch immediately (the game clock is already running); others swap mid-wipe
    if (name === 'play') apply(); else wipeTimer = setTimeout(apply, 260);
    setTimeout(() => w.classList.remove('go'), 760);
  } else apply();
}
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
  unlockAudio();
  const to = b.dataset.go;
  if (to === 'settings') { settingsReturn = screen; syncSettingsUI(); }
  show(to);
}));

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- song preview ----------
// The song select plays the highlighted song from its preview point (the manifest's `preview`, the loudest
// stretch; uploads compute it from their analysis), PREVIEW_LEN s on a loop with fades. One <audio> element
// streams the file (no full download / decode) and goes through the music bus, so the music volume applies.
// play() is called inside the click that selected the song (mobile browsers need the gesture).
const preview = { el: null, gain: null, id: null, start: 0, timer: 0, urls: new Map() };
function previewEl() {
  if (preview.el) return preview.el;
  const el = new Audio();
  el.preload = 'auto';
  preview.el = el;
  try {
    audio.ensure();
    const src = audio.ctx.createMediaElementSource(el);
    preview.gain = audio.ctx.createGain();
    preview.gain.gain.value = 0;
    src.connect(preview.gain); preview.gain.connect(audio.musicBus);
  } catch { preview.gain = null; }
  // loop the preview window: fade out near its end, then jump back
  el.addEventListener('timeupdate', () => {
    if (!preview.id) return;
    if (el.currentTime >= preview.start + PREVIEW_LEN) { preview.out = false; el.currentTime = preview.start; fadePreview(1, 0.8); }
    else if (!preview.out && el.currentTime >= preview.start + PREVIEW_LEN - 1.2) { preview.out = true; fadePreview(0, 1.0); }
  });
  return el;
}
function fadePreview(to, sec) {
  const g = preview.gain?.gain;
  if (!g) { if (preview.el) preview.el.volume = to; return; }
  const now = audio.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(to, now + sec);
}
async function previewSrc(song) {
  if (song.builtin) return 'songs/' + song.file;
  if (!preview.urls.has(song.id)) {
    const rec = await storage.getSong(song.id).catch(() => null);
    if (!rec?.data) return null;
    preview.urls.set(song.id, URL.createObjectURL(new Blob([rec.data])));
  }
  return preview.urls.get(song.id);
}
function startPreview(song) {
  if (!song || song.kind === 'midi') return stopPreview();
  if (preview.id === song.id && preview.el && !preview.el.paused) return;
  const el = previewEl();
  preview.id = song.id;
  preview.start = song.preview ?? previewStart(song.analysis);
  preview.out = false;
  clearTimeout(preview.timer);
  fadePreview(0, 0.15);
  const go = src => {
    if (!src || preview.id !== song.id) return;
    if (!el.src.endsWith(src)) el.src = src;
    const seek = () => { el.currentTime = preview.start; };
    if (el.readyState >= 1) seek(); else el.addEventListener('loadedmetadata', seek, { once: true });
    el.play().then(() => { if (preview.id === song.id) fadePreview(1, 0.8); }).catch(() => {});
  };
  if (song.builtin) go('songs/' + song.file);   // synchronously, inside the click
  else previewSrc(song).then(go);
}
function stopPreview() {
  preview.id = null;
  if (!preview.el || preview.el.paused) return;
  fadePreview(0, 0.3);
  clearTimeout(preview.timer);
  preview.timer = setTimeout(() => { if (!preview.id) preview.el.pause(); }, 350);
}

// ---------- library ----------
let builtin = [];
let uploads = [];
let selectedId = localStorage.getItem('rhythmSelected') || '';
let difficulty = localStorage.getItem('rhythmDifficulty') || 'normal';
if (!DIFFICULTIES.includes(difficulty)) difficulty = 'normal';
const songCache = new Map();
const bests = safeJSON(localStorage.getItem('rhythmBest'), {});

const allSongs = () => [...builtin, ...uploads];
const currentSong = () => allSongs().find(s => s.id === selectedId) || allSongs()[0];

async function loadLibrary() {
  try {
    const res = await fetch('songs/manifest.json');
    builtin = (await res.json()).map(s => ({ ...s, builtin: true }));
  } catch { builtin = []; }
  renderSongList();                       // built-in songs show right away
  uploads = await storage.listSongs();
  renderSongList();
}

function fmtTime(sec) {
  sec = Math.round(sec || 0);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function renderSongList() {
  const list = $('songList');
  list.innerHTML = '';
  const section = label => {
    const d = document.createElement('div');
    d.className = 'section-label';
    d.textContent = label;
    list.appendChild(d);
  };
  const card = song => {
    const b = document.createElement('div');
    b.className = 'song-card' + (song.id === currentSong()?.id ? ' active' : '');
    b.style.setProperty('--c', song.color || '#ff6fd8');
    b.tabIndex = 0;
    const best = bests[`${song.id}|${difficulty}`];
    const sub = [song.artist, song.genre].filter(Boolean).join(' · ');
    b.innerHTML = `<div class="lv"></div><div class="meta"><div class="title"></div><div class="sub"></div></div>` +
      `<div class="best"></div>` + (song.builtin ? '' : `<button class="del" title="${t('up.delete')}">✕</button>`);
    b.querySelector('.lv').textContent = song.levels?.[difficulty]?.level ?? '–';
    b.querySelector('.title').textContent = song.title;
    b.querySelector('.sub').textContent = sub;
    if (best) { b.querySelector('.best').textContent = best.rank; b.querySelector('.best').style.color = best.color; }
    b.addEventListener('click', e => {
      if (e.target.classList.contains('del')) return deleteUpload(song);
      unlockAudio();
      selectSong(song.id);
    });
    b.addEventListener('dblclick', () => startSelected());
    list.appendChild(b);
  };

  section('SONGS');
  builtin.forEach(card);
  section('MY SONGS');
  const up = document.createElement('button');
  up.className = 'upload-card';
  up.title = t('up.title');
  up.textContent = '＋ UPLOAD';
  up.addEventListener('click', () => { unlockAudio(); $('fileInput').click(); });
  list.appendChild(up);
  uploads.forEach(card);
  renderPanel();
}

function selectSong(id) {
  selectedId = id;
  startPreview(currentSong());
  localStorage.setItem('rhythmSelected', id);
  document.querySelectorAll('.song-card').forEach(c => c.classList.remove('active'));
  renderSongList();
  const active = $('songList').querySelector('.song-card.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function renderPanel() {
  const song = currentSong();
  const tabs = $('diffTabs');
  tabs.innerHTML = '';
  for (const d of DIFFICULTIES) {
    const b = document.createElement('button');
    b.className = 'diff-tab' + (d === difficulty ? ' active' : '');
    b.style.setProperty('--dc', DIFF_COLORS[d]);
    const lv = song?.levels?.[d]?.level;
    b.innerHTML = `<b><span>${lv ?? '–'}</span></b>${d}`;
    b.addEventListener('click', () => {
      difficulty = d;
      localStorage.setItem('rhythmDifficulty', d);
      renderSongList();
    });
    tabs.appendChild(b);
  }
  const info = $('selectInfo');
  const jacket = $('jacket');
  if (!song) {
    info.textContent = '＋ UPLOAD'; $('btnStart').disabled = true;
    $('selTitle').textContent = ''; $('jacketGenre').textContent = ''; $('jacketBpm').textContent = '–'; $('jacketTime').textContent = '';
    return;
  }
  $('btnStart').disabled = false;
  if (jacket.dataset.id !== song.id) {
    jacket.dataset.id = song.id;
    jacket.style.setProperty('--c', song.color || '#ff3d8b');
    jacket.classList.remove('swap'); void jacket.offsetWidth; jacket.classList.add('swap');
  }
  $('jacketGenre').textContent = song.genre || song.artist || '';
  $('jacketBpm').textContent = song.bpm || '–';
  $('jacketTime').textContent = song.duration ? fmtTime(song.duration) : '';
  $('selTitle').textContent = song.title;
  const best = bests[`${song.id}|${difficulty}`];
  info.innerHTML = '';
  if (best) {
    const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = best.rank; rk.style.color = best.color;
    const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = best.score.toLocaleString();
    const ac = document.createElement('span'); ac.textContent = `${(best.acc * 100).toFixed(2)}%`;
    info.append(rk, sc, ac);
  } else info.textContent = 'NEW';
}

function levelsFor(analysis) {
  const levels = {};
  for (const d of DIFFICULTIES) {
    const { stats } = generateChart(analysis, d);
    levels[d] = { level: stats.level, notes: stats.count };
  }
  return levels;
}

// ---------- loading / analysis ----------
function setLoading(title, p, hint = '') {
  $('loadingTitle').textContent = title;
  $('loadingBar').style.width = `${Math.round((p || 0) * 100)}%`;
  $('loadingHint').textContent = hint;
}

async function fetchWithProgress(url, onP) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return await res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onP(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

// ?lead=0: charts ignore the lead melody (to compare with the onset-only charts)
const NO_LEAD = new URLSearchParams(location.search).get('lead') === '0';
// opts.lead: estimate the lead melody too (uploads; built-in songs ship an offline transcription)
async function runAnalysis(buffer, onP, opts = {}) {
  const pcm = new Float32Array(await audio.analysisPCM(buffer));
  try {
    return await new Promise((resolve, reject) => {
      const w = new Worker(new URL('./analyzer-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => {
        if (e.data.progress !== undefined) onP(e.data.progress);
        else if (e.data.result) { w.terminate(); resolve(e.data.result); }
        else if (e.data.error) { w.terminate(); reject(new Error(e.data.error)); }
      };
      w.onerror = err => { w.terminate(); reject(err); };
      w.postMessage({ samples: pcm, sr: ANALYSIS_SR, opts });
    });
  } catch (err) {
    console.warn('Worker analysis failed, running on main thread', err);
    return await analyzeAudio(pcm, ANALYSIS_SR, onP, opts);
  }
}

async function prepare(song) {
  if (songCache.has(song.id)) return songCache.get(song.id);
  let entry;
  setLoading(song.title, 0, t('load.loading'));
  if (song.kind === 'midi') {
    const data = song.builtin ? await fetchWithProgress('songs/' + song.file, p => setLoading(song.title, p)) : (await storage.getSong(song.id)).data;
    const s = midiToSong(parseMidi(data));
    entry = { analysis: s.analysis, midiNotes: s.notes };
  } else {
    const rec = song.builtin ? null : await storage.getSong(song.id);
    const data = song.builtin ? await fetchWithProgress('songs/' + song.file, p => setLoading(song.title, p * 0.4, t('load.download'))) : rec.data;
    setLoading(song.title, 0.45, t('load.decode'));
    const buffer = await audio.decode(data);
    const key = `analysis:${song.id}:${ANALYZER_VERSION}`;
    let analysis = song.builtin ? await storage.cacheGet(key) : (rec.analysis?.version === ANALYZER_VERSION ? rec.analysis : null);
    if (!analysis) {
      analysis = await runAnalysis(buffer, p => setLoading(song.title, 0.5 + p * 0.5, t('load.beats')), { lead: !song.builtin && !NO_LEAD });
      if (song.builtin) storage.cachePut(key, analysis);
      else { rec.analysis = analysis; rec.levels = levelsFor(analysis); rec.bpm = Math.round(analysis.bpm); storage.putSong(rec); }
    }
    // built-in songs ship a lead melody transcribed offline (tools/lead/extract_lead.py); it replaces the
    // analyzer's own in-browser estimate
    if (song.builtin && song.lead && !NO_LEAD) {
      const lead = await fetch('songs/' + song.lead).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (lead?.notes) analysis = { ...analysis, lead };
    }
    entry = { analysis, buffer };
  }
  // keep memory bounded
  if (songCache.size >= 3) songCache.delete(songCache.keys().next().value);
  songCache.set(song.id, entry);
  return entry;
}

// ---------- uploads ----------
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm|weba)$/i;
async function addFiles(files) {
  unlockAudio();
  let lastId = null;
  for (const file of files) {
    const isMidi = /\.midi?$/i.test(file.name);
    const isAudio = !isMidi && (file.type.startsWith('audio/') || AUDIO_RE.test(file.name));
    if (!isMidi && !isAudio) { toast(t('err.format', { file: file.name })); continue; }
    if (file.size > 80 * 1024 * 1024) { toast(t('err.big', { file: file.name })); continue; }
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 50);
    show('loading');
    setLoading(title, 0, t('load.read'));
    try {
      const data = await file.arrayBuffer();
      const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rec = {
        id, title, kind: isMidi ? 'midi' : 'audio', data, addedAt: Date.now(), size: file.size,
        artist: isMidi ? 'MIDI' : 'Uploaded', color: UPLOAD_COLORS[uploads.length % UPLOAD_COLORS.length],
      };
      let analysis;
      if (isMidi) {
        const s = midiToSong(parseMidi(data));
        analysis = s.analysis;
        songCache.set(id, { analysis, midiNotes: s.notes });
      } else {
        setLoading(title, 0.05, t('load.decode'));
        const buffer = await audio.decode(data);
        if (buffer.duration < 10) throw new Error(t('err.short'));
        analysis = await runAnalysis(buffer, p => setLoading(title, 0.1 + p * 0.9, t('load.beats')), { lead: !NO_LEAD });
        songCache.set(id, { analysis, buffer });
        rec.analysis = analysis;
      }
      rec.bpm = Math.round(analysis.bpm);
      rec.duration = analysis.duration;
      rec.levels = levelsFor(analysis);
      try { await storage.putSong(rec); }
      catch { toast(t('err.storage')); const { data: _, ...meta } = rec; uploads.unshift({ ...meta, temp: true }); }
      lastId = id;
    } catch (err) {
      console.error(err);
      toast(t('err.read', { file: file.name, err: err.message || err }), 4000);
    }
  }
  const temps = uploads.filter(u => u.temp);
  uploads = [...temps, ...(await storage.listSongs())];
  if (lastId) { selectedId = lastId; localStorage.setItem('rhythmSelected', lastId); toast(t('up.added')); }
  show('select');
  renderSongList();
}

$('fileInput').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) addFiles(files);
});

let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); if (game.state === 'playing') return; dragDepth++; $('dropHint').classList.add('show'); });
window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').classList.remove('show'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('dropHint').classList.remove('show');
  if (game.state === 'playing' || game.state === 'paused') return;
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) addFiles(files);
});

async function deleteUpload(song) {
  if (!confirm(t('up.confirmDelete', { title: song.title }))) return;
  await storage.deleteSong(song.id).catch(() => {});
  songCache.delete(song.id);
  uploads = uploads.filter(u => u.id !== song.id);
  if (preview.id === song.id) stopPreview();
  if (preview.urls.has(song.id)) { URL.revokeObjectURL(preview.urls.get(song.id)); preview.urls.delete(song.id); }
  if (selectedId === song.id) selectedId = '';
  renderSongList();
}

// ---------- play ----------
let playing = null; // { song, difficulty }

async function startSelected() {
  const song = currentSong();
  if (!song) return;
  unlockAudio();
  await startSong(song, difficulty);
}

async function startSong(song, diff) {
  tut = null;
  show('loading');
  // in parallel with the audio: decode 孤夜's art and fetch this song's MV clips, so nothing loads mid-song
  game.char.enabled = settings.character !== false;
  game.char.cutinEnabled = settings.cutin !== false;
  const charReady = game.char.prepare(song.title, song.id);
  try {
    const entry = await prepare(song);
    const { notes, speed } = generateChart(entry.analysis, diff, 1, { gimmicks: settings.gimmicks !== false });
    if (!notes.length) throw new Error(t('err.noNotes'));
    let music;
    if (entry.buffer) music = { type: 'audio', buffer: entry.buffer };
    else {
      const gameTimes = new Set(notes.map(n => n.time));
      music = { type: 'midi', notes: entry.midiNotes, isGameNote: n => gameTimes.has(n.g) };
    }
    playing = { song, difficulty: diff, playId: newId(), startedAt: Date.now(), bpm: entry.analysis.bpm, logged: false };
    applyVolumes();
    await charReady;
    await audio.resume();
    show('play');
    game.resize();
    game.start({
      notes, speed, music, title: song.title, songId: song.id, difficulty: diff,
      beats: entry.analysis.beats, downbeat: entry.analysis.downbeat, barBeats: entry.analysis.barBeats,
      settings,
    });
  } catch (err) {
    console.error(err);
    toast(t('err.load', { err: err.message || err }), 4000);
    show('select');
  }
}
$('btnStart').addEventListener('click', startSelected);

function pauseGame() {
  if (game.state !== 'playing') return;
  game.pause();
  show('pause');
}
function resumeGame() {
  show('play');
  game.resume();
}
function quitGame() {
  logPlay('quit');
  game.stop();
  if (tut) { tutLeave('title')(); return; }
  show('select');
  renderSongList();
}
$('pauseBtn').addEventListener('click', pauseGame);
$('btnResume').addEventListener('click', resumeGame);
$('btnQuit').addEventListener('click', quitGame);
$('btnPauseRetry').addEventListener('click', () => {
  logPlay('retry'); game.stop();
  if (tut) tutTry(tut.step); else startSong(playing.song, playing.difficulty);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
// tab closed or app swiped away mid-song: still log how far they got
window.addEventListener('pagehide', () => { if (game.state === 'playing' || game.state === 'paused') logPlay('closed'); });

// ---------- tutorial ----------
// TUTORIAL on the title screen: the four kinds of notes one at a time. Each step shows the note in a small
// window (a second Game on its own canvas that plays itself, the keys lighting up below it) with one line on
// how to play it; then the player plays the same short chart. At the end, the median hit offset of all the
// steps becomes a one-tap offset fix (校準打擊) when it is clearly off.
const TUT_BEAT = 0.6;   // 100 BPM
const TUT_STEPS = [
  { id: 'tap', chart: at => [0, 1, 2, 3, 3, 2, 1, 0].map((l, i) => ({ time: at(i), lane: l })) },
  { id: 'hold', chart: at => [[1, 0, 2], [2, 3, 5], [0, 6, 8], [3, 9, 11]].map(([l, a, b]) => ({ time: at(a), lane: l, end: at(b) })) },
  { id: 'sweep', chart: at => [[0, 1, 2, 3], [3, 2, 1, 0], [0, 1, 2, 3]].flatMap((ls, k) => ls.map((l, i) => ({ time: at(k * 3 + i / 2), lane: l, sweep: k }))) },
  { id: 'slide', chart: at => [[1, 0, 2, 2, 4], [2, 5, 7, 1, 9], [0, 10, 12, 1, 14]].map(([l, a, bend, to, b]) => ({ time: at(a), lane: l, end: at(b), path: [{ time: at(bend), lane: to }] })) },
];
let tut = null;    // { step, phase: 'card' | 'try' | 'done', offs: [hit offsets], counts }
let demo = null;   // the preview Game
const isTouch = () => matchMedia('(pointer: coarse)').matches;

// backing: a plain drum groove (kick on 1 and 3, snare on 2 and 4, 8th-note hi-hats)
function tutDrums(beats) {
  const h = [];
  for (let b = 0; b < beats; b++) {
    const t = b * TUT_BEAT;
    h.push({ t, kind: b % 2 ? 'snare' : 'kick' }, { t, kind: 'hat', accent: true }, { t: t + TUT_BEAT / 2, kind: 'hat' });
  }
  return h;
}
// count-in: 4 beats before the player's go, half a beat for the looping preview
function tutStart(g, stepIdx, auto) {
  const at = b => (b + (auto ? 0.5 : 4)) * TUT_BEAT;
  const notes = TUT_STEPS[stepIdx].chart(at).sort((a, b) => a.time - b.time || a.lane - b.lane);
  const beats = Math.ceil(Math.max(...notes.map(n => n.end || n.time)) / TUT_BEAT) + 2;
  g.start({
    notes, speed: null, title: 'TUTORIAL', songId: null, difficulty: 'easy',
    music: { type: 'drums', hits: tutDrums(beats) },
    beats: Array.from({ length: beats }, (_, i) => i * TUT_BEAT), downbeat: 0, barBeats: 4,
    settings: { ...settings, noFail: true, cutin: false, character: auto ? false : settings.character }, auto,
  });
}
function demoGame() {
  if (!demo) {
    demo = new Game($('tutCanvas'), audio, {
      onEnd: () => setTimeout(() => { if (tut?.phase === 'card' && screen === 'tutorial') tutStart(demo, tut.step, true); }, 700),
    });
    demo.mini = true;
    new ResizeObserver(() => demo.resize()).observe($('tutCanvas'));
  }
  return demo;
}
// the keys under the preview light up while the demo presses / holds them
function tutPads() {
  if (tut?.phase !== 'card' || !demo) return;
  [...$('tutPads').children].forEach((el, l) => el.classList.toggle('on', demo.state === 'playing' && (demo.beam[l] > 0.7 || !!demo.holding[l])));
  requestAnimationFrame(tutPads);
}
function stopDemo() { if (demo && demo.state !== 'idle') demo.stop(); }

function tutButtons(list) {
  const box = $('tutBtns');
  box.innerHTML = '';
  list.forEach(([label, fn, primary]) => {
    const b = document.createElement('button');
    b.className = 'btn' + (primary ? ' primary' : '');
    b.textContent = label;
    b.onclick = () => fn(b);
    box.appendChild(b);
  });
}
async function tutCard(i) {
  unlockAudio();
  const id = TUT_STEPS[i].id;
  tut = { ...(tut || { offs: [], counts: { perfect: 0, great: 0, good: 0, miss: 0 } }), step: i, phase: 'card' };
  $('tutStepNo').textContent = `${i + 1} / ${TUT_STEPS.length}`;
  $('tutTitle').textContent = t(`tut.${id}`);
  $('tutSub').textContent = t(`tut.${id}.${isTouch() ? 'touch' : 'key'}`);
  $('tutScreen').classList.remove('done');
  $('tutPads').innerHTML = '';
  for (let l = 0; l < 4; l++) {
    const d = document.createElement('div');
    d.className = 'key';
    d.textContent = isTouch() ? '' : settings.keyLabels[l];
    d.style.color = LANE_COLORS[l];
    d.style.borderColor = LANE_COLORS[l] + '88';
    $('tutPads').appendChild(d);
  }
  tutButtons([[t('tut.try'), () => tutTry(i), true]]);
  show('tutorial');
  await audio.resume();
  tutStart(demoGame(), i, true);
  requestAnimationFrame(tutPads);
}
async function tutTry(i) {
  stopDemo();
  tut.phase = 'try';
  playing = { song: { id: `tutorial-${TUT_STEPS[i].id}`, title: 'Tutorial', builtin: true, kind: 'midi' }, difficulty: 'easy', playId: newId(), startedAt: Date.now(), bpm: 100, logged: false };
  game.char.enabled = settings.character !== false;
  game.char.cutinEnabled = false;
  await game.char.prepare('tutorial', null, 1500);
  await audio.resume();
  $('tutBanner').textContent = `${t(`tut.${TUT_STEPS[i].id}`)}  ${i + 1} / ${TUT_STEPS.length}`;
  show('play');
  game.resize();
  tutStart(game, i, false);
}
function tutorialEnd(r) {
  logPlay(r.failed ? 'failed' : 'clear', r);
  // timing: taps and hold heads (sweep steps are judged loosely, slide bends only count lateness)
  for (const n of game.notes) if (n.sweep == null && n.off != null) tut.offs.push(n.off);
  for (const k in tut.counts) tut.counts[k] += r.counts[k];
  if (tut.step + 1 < TUT_STEPS.length) return tutCard(tut.step + 1);
  tutDone();
}
function tutDone() {
  tut.phase = 'done';
  localStorage.setItem('rhythmTutDone', '1');
  $('btnTutorial').classList.remove('new');
  $('tutScreen').classList.add('done');
  $('tutStepNo').textContent = '';
  $('tutTitle').textContent = t('tut.done');
  const c = tut.counts;
  $('tutSub').innerHTML = ['perfect', 'great', 'good', 'miss'].filter(k => c[k] || k !== 'good').map(k => `<b>${c[k]}</b> ${k.toUpperCase()}`).join(' · ');
  const play = [t('tut.play'), tutLeave('select')];
  const again = [t('tut.again'), () => { tut = null; tutCard(0); }];
  // trimmed median of the hit offsets (relative to the current offset setting)
  const offs = [...tut.offs].sort((a, b) => a - b);
  const trimmed = offs.slice(Math.floor(offs.length * 0.15), Math.ceil(offs.length * 0.85));
  const m = trimmed.length ? Math.round(trimmed[trimmed.length >> 1]) : 0;
  if (offs.length >= 10 && Math.abs(m) >= 10) {
    tutButtons([[t('tut.calibrate'), b => {
      const from = settings.offset;
      settings.offset += m; saveSettings();
      b.disabled = true; b.textContent = '✓';
      $('tutSub').textContent = `Offset ${from > 0 ? '+' : ''}${from} → ${settings.offset > 0 ? '+' : ''}${settings.offset} ms`;
    }, true], play, again]);
  } else tutButtons([[...play, true], again]);
  show('tutorial');
}
const tutLeave = to => () => { stopDemo(); game.stop(); tut = null; show(to); if (to === 'select') renderSongList(); };
$('btnTutorial').addEventListener('click', () => { tut = null; tutCard(0); });
$('btnTutBack').addEventListener('click', () => tutLeave('title')());
if (!localStorage.getItem('rhythmTutDone')) $('btnTutorial').classList.add('new');

// ---------- play log ----------
// One record per play (cleared, failed, quit, retried or closed mid-song) for tuning charts and difficulty:
// result, settings, device type and each reached note's timing. Anonymous id, no IP; off in Settings.
// Stored by the API worker (worker/, table plays). Not sent for ?auto=1 or ?debug=1 plays.
function newId() { return crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
function clientId() {
  let id = localStorage.getItem('rhythmClientId');
  if (!id) { id = newId(); localStorage.setItem('rhythmClientId', id); }
  return id;
}
function logPlay(outcome, r) {
  if (!playing || playing.logged || AUTOPLAY || DEBUG || settings.playLog === false) return;
  if (!game.notes) return;
  playing.logged = true;
  try {
    const { song, difficulty: diff } = playing;
    r = r || game.result(false);
    const log = game.playLog();
    const body = JSON.stringify({
      v: 1, play_id: playing.playId, client_id: clientId(), player_name: playerName(),
      song_id: song.id, song_title: song.title, builtin: !!song.builtin, kind: song.kind || 'audio',
      difficulty: diff, level: song.levels?.[diff]?.level ?? null, bpm: Math.round(playing.bpm || song.bpm || 0) || null,
      outcome, score: r.score, accuracy: +(r.accuracy * 100).toFixed(2), max_combo: r.maxCombo,
      perfect: r.counts.perfect, great: r.counts.great, good: r.counts.good, miss: r.counts.miss,
      fast: r.fast, slow: r.slow, median_offset: Math.round(r.medianOffset || 0), rank: r.rank,
      notes_total: log.notesTotal, song_ms: log.songMs, end_ms: log.endMs,
      wall_ms: Date.now() - playing.startedAt, pauses: log.pauses,
      settings: {
        speed: settings.speed, offset: settings.offset, noFail: !!settings.noFail, gimmicks: settings.gimmicks !== false,
        noteStyle: settings.noteStyle, character: !!settings.character, cutin: !!settings.cutin, showTiming: !!settings.showTiming,
        music: settings.music, hitsound: settings.hitsound, keys: settings.keyLabels?.join(''),
      },
      device: {
        presses: log.presses, touch: log.touchPresses, w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
        touchScreen: navigator.maxTouchPoints > 0, ua: navigator.userAgent.slice(0, 200), lang, host: location.host,
      },
      notes: log.notes,
    });
    const url = API_BASE + '/api/play';
    // text/plain: no CORS preflight, and sendBeacon still gets it out while the page is closing
    if (!(navigator.sendBeacon && body.length < 60000 && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })))) {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: body.length < 60000 }).catch(() => {});
    }
  } catch (err) { console.warn('play log', err); }
}

// ---------- debug log (?debug=1) ----------
// sent to /debug-log on the page's own server (tools/debug-server.py); a download otherwise
function showDebugUpload(r) {
  const dbg = game.dbg;
  dbg.finish(r);
  let box = $('resDebug');
  if (!box) {
    box = document.createElement('div');
    box.id = 'resDebug';
    box.className = 'res-offset';
    $('resOffset').after(box);
  }
  box.innerHTML = '';
  const status = document.createElement('span');
  const s = dbg.stats;
  status.textContent = `DEBUG：MISS 沒收到 ${s.missNoPress}／隔壁 ${s.missNeighbour}／時機 ${s.missOffTime}，跳點 ${s.jump}，取消 ${s.cancel} · 上傳中…`;
  const dl = document.createElement('button');
  dl.className = 'btn small';
  dl.textContent = '下載紀錄';
  const data = JSON.stringify(dbg.export());
  const name = `debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  dl.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  box.append(status, dl);
  fetch('debug-log?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data })
    .then(res => { if (!res.ok) throw new Error(res.status); status.textContent = status.textContent.replace('上傳中…', '已上傳 ✓'); })
    .catch(() => { status.textContent = status.textContent.replace('上傳中…', '無法上傳，請按下載'); });
}

// ---------- results ----------
let lastResult = null;
function showResults(r) {
  logPlay(r.failed ? 'failed' : 'clear', r);
  const { song, difficulty: diff } = playing;
  show('results');
  $('resSong').textContent = song.title;
  $('resDiff').textContent = diff.toUpperCase();
  $('resDiff').style.setProperty('--dc', DIFF_COLORS[diff]);
  const rank = $('resRank');
  rank.textContent = r.rank;
  rank.style.color = r.color;
  rank.classList.remove('stamp'); void rank.offsetWidth; rank.classList.add('stamp');
  $('resAcc').textContent = `${(r.accuracy * 100).toFixed(2)}%`;
  const total = Math.max(1, r.counts.perfect + r.counts.great + r.counts.good + r.counts.miss);
  const bars = { perfect: 'barPerfect', great: 'barGreat', good: 'barGood', miss: 'barMiss' };
  for (const k in bars) { $(bars[k]).style.width = '0'; }
  $('resAccBar').style.width = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const k in bars) $(bars[k]).style.width = `${(r.counts[k] / total) * 100}%`;
    $('resAccBar').style.width = `${r.accuracy * 100}%`;
  }));
  countUp($('resScore'), r.score, 1100);
  countUp($('resPerfect'), r.counts.perfect, 800);
  countUp($('resGreat'), r.counts.great, 800);
  countUp($('resGood'), r.counts.good, 800);
  countUp($('resMiss'), r.counts.miss, 800);
  countUp($('resCombo'), r.maxCombo, 900);
  const badge = $('resBadge');
  badge.className = 'res-badge' + (r.failed ? ' fail' : '');
  badge.textContent = r.failed ? 'FAILED'
    : r.counts.miss + r.counts.good + r.counts.great === 0 ? 'ALL PERFECT'
    : r.counts.miss === 0 ? 'FULL COMBO' : '';
  $('resFastSlow').textContent = `${r.fast} / ${r.slow}`;
  const art = resultArt(r.rank);
  $('resArt').classList.toggle('hidden', !settings.character);
  $('resLine').classList.toggle('hidden', !settings.character);
  if (settings.character) {
    $('resArt').src = art.src;
    $('resArt').style.animation = 'none'; void $('resArt').offsetWidth; $('resArt').style.animation = '';
    $('resLine').textContent = art.line;
  }

  // only speak up about timing when it is clearly off
  const off = $('resOffset');
  off.innerHTML = '';
  if (r.hits >= 20 && Math.abs(r.medianOffset) >= 8) {
    const m = Math.round(r.medianOffset);
    off.textContent = `${m > 0 ? 'LATE' : 'EARLY'} ${Math.abs(m)}ms`;
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = `Offset → ${settings.offset + m}`;
    b.onclick = () => { settings.offset += m; saveSettings(); b.disabled = true; b.textContent = '✓'; };
    off.appendChild(b);
  }
  if (game.dbg) showDebugUpload(r);

  const key = `${song.id}|${diff}`;
  if (!AUTOPLAY && !r.failed && (!bests[key] || r.score > bests[key].score)) {
    bests[key] = { score: r.score, rank: r.rank, color: r.color, acc: r.accuracy };
    localStorage.setItem('rhythmBest', JSON.stringify(bests));
  }

  lastResult = {
    song_name: song.title, difficulty: diff, score: r.score,
    accuracy: +(r.accuracy * 100).toFixed(2), max_combo: r.maxCombo,
    perfect: r.counts.perfect, great: r.counts.great, good: r.counts.good, miss: r.counts.miss, rank: r.rank,
  };
  resultFailed = !!r.failed;
  $('btnSubmit').disabled = !!r.failed;
  $('btnSubmit').textContent = t('res.submit');
  $('submitStatus').textContent = r.failed ? t('res.failedNoSubmit') : '';
  $('playerName').value = playerName();
  nameSubmitted = '';
  if (AUTOPLAY) { $('btnSubmit').disabled = true; $('submitStatus').textContent = 'AUTO'; }
  else if (!r.failed && settings.autoSubmit) submitScore(true);
}
function countUp(el, to, ms, delay = 380) {
  const t0 = performance.now() + delay;
  el.textContent = '0';
  const step = now => {
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
$('btnRetry').addEventListener('click', () => startSong(playing.song, playing.difficulty));
$('btnResBack').addEventListener('click', () => { game.stop(); show('select'); renderSongList(); });

// ---------- leaderboard ----------
let lbReturn = 'title';
let nameSubmitted = '', resultFailed = false;
async function submitScore(auto = false) {
  const name = $('playerName').value.trim();
  if (!name) return $('playerName').focus();
  setPlayerName(name, false);
  const btn = $('btnSubmit'), st = $('submitStatus');
  btn.disabled = true; btn.textContent = '…';
  st.style.color = ''; st.textContent = auto ? t('res.submitting', { name }) : '';
  try {
    const res = await fetch(API_BASE + '/api/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lastResult, player_name: name }),
    });
    const data = await res.json();
    if (data.success) {
      nameSubmitted = name;
      btn.textContent = t('res.done');
      st.textContent = t('res.position', { name, pos: data.position }); st.style.color = '#5dffa8';
    }
    else { btn.disabled = false; btn.textContent = t('res.submit'); st.textContent = data.error || t('res.submitFailed'); st.style.color = '#ff4d5e'; }
  } catch {
    btn.disabled = false; btn.textContent = t('res.submit'); st.textContent = t('res.network'); st.style.color = '#ff4d5e';
  }
}
$('btnSubmit').addEventListener('click', () => submitScore(false));

// ---------- player name (auto-assigned, cached in localStorage) ----------
const NAME_ADJ = ['Neon', 'Swift', 'Lucky', 'Cosmic', 'Turbo', 'Pixel', 'Sunny', 'Mellow', 'Jazzy', 'Funky', 'Stellar', 'Hyper', 'Cyber', 'Groovy', 'Sonic', 'Velvet'];
const NAME_ANI = ['Fox', 'Panda', 'Otter', 'Tiger', 'Koala', 'Falcon', 'Bunny', 'Whale', 'Lynx', 'Cat', 'Wolf', 'Dolphin', 'Owl', 'Shiba', 'Penguin', 'Gecko'];
const pick = a => a[Math.floor(Math.random() * a.length)];
function randomName() {
  return `${pick(NAME_ADJ)}${pick(NAME_ANI)}_${Math.floor(Math.random() * 900 + 100)}`.slice(0, 20);
}
function playerName() {
  let n = (localStorage.getItem('rhythmPlayerName') || '').trim();
  if (!n) { n = randomName(); localStorage.setItem('rhythmPlayerName', n); }
  return n;
}
function setPlayerName(n, syncInputs = true) {
  n = n.trim().slice(0, 20);
  if (!n) return;
  localStorage.setItem('rhythmPlayerName', n);
  if (syncInputs) { $('playerName').value = n; $('setName').value = n; }
}
function rerollName() {
  setPlayerName(randomName());
  if (lastResult && !resultFailed) { $('btnSubmit').disabled = false; $('btnSubmit').textContent = t('res.submit'); }
}
playerName();
$('btnNameDice').addEventListener('click', rerollName);
$('btnSetNameDice').addEventListener('click', rerollName);
$('playerName').addEventListener('input', e => {
  $('setName').value = e.target.value;
  if (!resultFailed && e.target.value.trim() !== nameSubmitted) { $('btnSubmit').disabled = false; $('btnSubmit').textContent = t('res.submit'); }
});
$('setName').addEventListener('change', e => {
  const n = e.target.value.trim();
  if (n) setPlayerName(n); else e.target.value = playerName();
});
$('setAutoSubmit').addEventListener('change', e => { settings.autoSubmit = e.target.checked; saveSettings(); });
$('setPlayLog').addEventListener('change', e => { settings.playLog = e.target.checked; saveSettings(); });

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

async function loadLeaderboard(tab) {
  document.querySelectorAll('.lb-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const msg = $('lbMsg'), table = $('lbTable'), body = $('lbBody');
  msg.style.display = 'block'; msg.textContent = t('lb.loading');
  table.style.display = 'none'; body.innerHTML = '';
  try {
    let url = API_BASE + '/api/leaderboard?limit=30';
    if (tab === 'song' && playing) url += `&song=${encodeURIComponent(playing.song.title)}&difficulty=${playing.difficulty}`;
    const data = await (await fetch(url)).json();
    const list = data.leaderboard || [];
    if (!list.length) { msg.textContent = t('lb.empty'); return; }
    table.querySelector('thead').innerHTML = tab === 'global'
      ? `<tr><th class="c-no">#</th><th class="c-pl">${t('lb.player')}</th><th class="c-sc">${t('lb.score')}</th><th class="c-rk">${t('lb.rank')}</th></tr>`
      : `<tr><th class="c-no">#</th><th class="c-pl">${t('lb.player')}</th><th class="c-sc">${t('lb.score')}</th><th class="c-ac">${t('lb.acc')}</th><th class="c-rk">${t('lb.rank')}</th></tr>`;
    list.forEach((e, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = tab === 'global'
        ? `<td>${i + 1}</td><td><div class="nm">${esc(e.player_name)}</div><div class="sg">${esc(e.song_name)}</div></td><td>${Number(e.score).toLocaleString()}</td><td>${esc(e.rank)}</td>`
        : `<td>${i + 1}</td><td><div class="nm">${esc(e.player_name)}</div></td><td>${Number(e.score).toLocaleString()}</td><td>${typeof e.accuracy === 'number' ? e.accuracy.toFixed(1) + '%' : '-'}</td><td>${esc(e.rank)}</td>`;
      body.appendChild(tr);
    });
    msg.style.display = 'none';
    table.style.display = 'table';
  } catch {
    msg.textContent = t('lb.failed');
  }
}
function openLeaderboard(fromResults) {
  lbReturn = fromResults ? 'results' : 'title';
  document.querySelector('.lb-tab[data-tab="song"]').style.display = fromResults ? '' : 'none';
  show('leaderboard');
  loadLeaderboard(fromResults ? 'song' : 'global');
}
$('btnTitleLeaderboard').addEventListener('click', () => openLeaderboard(false));
$('btnResLeaderboard').addEventListener('click', () => openLeaderboard(true));
$('btnLbBack').addEventListener('click', () => show(lbReturn));
document.querySelectorAll('.lb-tab').forEach(t => t.addEventListener('click', () => loadLeaderboard(t.dataset.tab)));

// ---------- settings UI ----------
const bindRange = (id, out, key, fmt = v => v) => {
  const el = $(id);
  el.addEventListener('input', () => {
    settings[key] = +el.value;
    $(out).textContent = fmt(settings[key]);
    saveSettings();
  });
};
bindRange('setSpeed', 'outSpeed', 'speed');
bindRange('setOffset', 'outOffset', 'offset', v => `${v > 0 ? '+' : ''}${v}ms`);
bindRange('setMusic', 'outMusic', 'music');
bindRange('setHit', 'outHit', 'hitsound');
$('setTiming').addEventListener('change', e => { settings.showTiming = e.target.checked; saveSettings(); });
$('setNoFail').addEventListener('change', e => { settings.noFail = e.target.checked; saveSettings(); });
$('setChar').addEventListener('change', e => { settings.character = e.target.checked; saveSettings(); });
document.querySelectorAll('#setFx button').forEach(b => b.addEventListener('click', () => {
  settings.cutin = b.dataset.v === 'full'; saveSettings(); syncSettingsUI();
}));
document.querySelectorAll('#setNote button').forEach(b => b.addEventListener('click', () => {
  settings.noteStyle = b.dataset.v; saveSettings(); syncSettingsUI();
}));
document.querySelectorAll('#setGimmick button').forEach(b => b.addEventListener('click', () => {
  settings.gimmicks = b.dataset.v === 'on'; saveSettings(); syncSettingsUI();
}));
$('setHit').addEventListener('change', () => { unlockAudio(); audio.playTap(); });

function syncSettingsUI() {
  $('setSpeed').value = settings.speed; $('outSpeed').textContent = settings.speed;
  $('setOffset').value = settings.offset; $('outOffset').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset}ms`;
  $('setMusic').value = settings.music; $('outMusic').textContent = settings.music;
  $('setHit').value = settings.hitsound; $('outHit').textContent = settings.hitsound;
  $('setTiming').checked = settings.showTiming;
  $('setNoFail').checked = settings.noFail;
  $('setChar').checked = settings.character;
  document.querySelectorAll('#setFx button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'full') === settings.cutin)));
  document.querySelectorAll('#setNote button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === settings.noteStyle)));
  document.querySelectorAll('#setGimmick button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'on') === (settings.gimmicks !== false))));
  $('setAutoSubmit').checked = settings.autoSubmit;
  $('setPlayLog').checked = settings.playLog !== false;
  $('setName').value = playerName();
  renderKeys();
  syncLangUI();
}

// ---------- language (js/i18n.js) ----------
function syncLangUI() {
  document.querySelectorAll('.lang-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === lang)));
}
document.querySelectorAll('.lang-seg button').forEach(b => b.addEventListener('click', () => {
  if (setLang(b.dataset.v)) renderSongList();   // static text is swapped by applyI18n; the song list is built in JS
  syncLangUI();
}));
applyI18n();
syncLangUI();
$('btnSettingsBack').addEventListener('click', () => show(settingsReturn === 'settings' || settingsReturn === 'calibrate' ? 'title' : settingsReturn));

function renderKeys() {
  for (const id of ['titleKeys', 'settingsKeys']) {
    const box = $(id);
    box.innerHTML = '';
    settings.keyLabels.forEach((k, i) => {
      const d = document.createElement('div');
      d.className = 'key';
      d.textContent = k;
      d.style.color = LANE_COLORS[i];
      d.style.borderColor = LANE_COLORS[i] + '88';
      box.appendChild(d);
    });
  }
}

let rebind = null;
$('btnRebind').addEventListener('click', () => {
  rebind = { codes: [], labels: [] };
  toast(t('key.first'), 8000);
});
function keyLabel(e) {
  if (e.code === 'Space') return 'SPC';
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key.replace('Arrow', '').slice(0, 5).toUpperCase();
}

// ---------- calibration ----------
let cal = null;
$('btnCalibrate').addEventListener('click', () => { unlockAudio(); show('calibrate'); resetCal(); });
$('btnCalBack').addEventListener('click', () => { stopCal(); syncSettingsUI(); show('settings'); });
$('btnCalStart').addEventListener('click', startCal);
$('btnCalApply').addEventListener('click', () => {
  if (!cal?.result && cal?.result !== 0) return;
  settings.offset = cal.result;
  saveSettings();
  toast(t('offset.set', { ms: `${settings.offset > 0 ? '+' : ''}${settings.offset}` }));
  stopCal(); syncSettingsUI(); show('settings');
});
function resetCal() {
  $('calCount').textContent = '';
  $('calResult').textContent = '';
  $('btnCalApply').classList.add('hidden');
  $('btnCalStart').classList.remove('hidden');
  $('btnCalStart').textContent = t('cal.start');
}
async function startCal() {
  unlockAudio();
  await audio.resume();
  stopCal();
  const ctx = audio.ctx;
  const interval = 0.5, beatsN = 24, lead = 4;
  cal = { start: ctx.currentTime + 0.8, interval, beatsN, lead, taps: [], srcs: [] };
  for (let i = 0; i < beatsN; i++) cal.srcs.push(audio.scheduleClick(cal.start + i * interval, i % 4 === 0));
  $('btnCalStart').classList.add('hidden');
  $('btnCalApply').classList.add('hidden');
  $('calResult').textContent = '';
  const ring = $('calRing');
  const frame = () => {
    if (!cal) return;
    const heard = audio.heardTime(performance.now());
    const rel = heard - cal.start;
    const k = Math.floor(rel / interval);
    ring.classList.toggle('beat', rel >= 0 && rel % interval < 0.07);
    $('calCount').textContent = rel < 0 ? '' : k < lead ? String(lead - k) : String(cal.taps.length);
    if (rel > beatsN * interval + 0.3) return finishCal();
    cal.raf = requestAnimationFrame(frame);
  };
  cal.raf = requestAnimationFrame(frame);
}
function calTap(perf) {
  if (!cal || cal.done) return;
  const ring = $('calRing');
  ring.classList.add('tap');
  setTimeout(() => ring.classList.remove('tap'), 80);
  const heard = audio.heardTime(perf);
  const k = Math.round((heard - cal.start) / cal.interval);
  if (k < cal.lead || k >= cal.beatsN) return;
  const d = (heard - (cal.start + k * cal.interval)) * 1000;
  if (Math.abs(d) < 220) cal.taps.push(d);
}
function finishCal() {
  cancelAnimationFrame(cal.raf);
  cal.done = true;
  $('calRing').classList.remove('beat');
  const taps = [...cal.taps].sort((a, b) => a - b);
  $('btnCalStart').classList.remove('hidden');
  $('btnCalStart').textContent = t('cal.again');
  if (taps.length < 8) { $('calResult').textContent = t('cal.few'); return; }
  // drop outliers, then take the median
  const trimmed = taps.slice(Math.floor(taps.length * 0.15), Math.ceil(taps.length * 0.85));
  const med = trimmed[trimmed.length >> 1];
  const spread = Math.sqrt(trimmed.reduce((s, v) => s + (v - med) ** 2, 0) / trimmed.length);
  cal.result = Math.round(med);
  $('calResult').innerHTML = t('cal.result', { ms: `${cal.result > 0 ? '+' : ''}${cal.result}`, spread: Math.round(spread), n: taps.length });
  $('btnCalApply').classList.remove('hidden');
}
function stopCal() {
  if (!cal) return;
  cancelAnimationFrame(cal.raf);
  for (const s of cal.srcs) try { s.stop(); } catch {}
  cal = null;
}
$('calibrateScreen').addEventListener('pointerdown', e => {
  if (e.target.closest('button')) return;
  calTap(e.timeStamp);
});

// ---------- input ----------
window.addEventListener('keydown', e => {
  if (rebind) {
    e.preventDefault();
    if (e.code === 'Escape') { rebind = null; toast(t('key.cancel')); return; }
    if (rebind.codes.includes(e.code)) return;
    rebind.codes.push(e.code); rebind.labels.push(keyLabel(e));
    if (rebind.codes.length === 4) {
      settings.keys = rebind.codes; settings.keyLabels = rebind.labels;
      rebind = null; saveSettings(); toast(t('key.done'));
    } else toast(t('key.next', { n: rebind.codes.length + 1 }), 8000);
    return;
  }
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;

  if (game.state === 'playing') {
    const lane = settings.keys.indexOf(e.code);
    if (lane >= 0) {
      e.preventDefault();
      if (!e.repeat) game.press(lane, e.timeStamp);
      return;
    }
    if (e.code === 'Escape') pauseGame();
    return;
  }
  if (e.repeat) return;
  if (screen === 'calibrate' && cal && !cal.done) {
    if (e.code !== 'Escape') { e.preventDefault(); calTap(e.timeStamp); return; }
  }
  if (screen === 'pause') {
    if (e.code === 'Escape') resumeGame();
  } else if (screen === 'results') {
    if (e.code === 'KeyR') startSong(playing.song, playing.difficulty);
    if (e.code === 'Escape') { game.stop(); show('select'); renderSongList(); }
  } else if (screen === 'select') {
    const songs = allSongs();
    const i = songs.findIndex(s => s.id === currentSong()?.id);
    if (e.code === 'ArrowDown' && i < songs.length - 1) { e.preventDefault(); selectSong(songs[i + 1].id); }
    if (e.code === 'ArrowUp' && i > 0) { e.preventDefault(); selectSong(songs[i - 1].id); }
    const di = DIFFICULTIES.indexOf(difficulty);
    if (e.code === 'ArrowRight' && di < 3) { difficulty = DIFFICULTIES[di + 1]; localStorage.setItem('rhythmDifficulty', difficulty); renderSongList(); }
    if (e.code === 'ArrowLeft' && di > 0) { difficulty = DIFFICULTIES[di - 1]; localStorage.setItem('rhythmDifficulty', difficulty); renderSongList(); }
    if (e.code === 'Enter') startSelected();
    if (e.code === 'Escape') show('title');
  } else if (screen === 'tutorial') {
    if (e.code === 'Enter') { e.preventDefault(); $('tutBtns').querySelector('button:not(:disabled)')?.click(); }
    if (e.code === 'Escape') tutLeave('title')();
  } else if (screen === 'title' && e.code === 'Enter') {
    unlockAudio(); show('select');
  }
});
window.addEventListener('keyup', e => {
  const lane = settings.keys.indexOf(e.code);
  if (lane >= 0) game.release(lane, e.timeStamp);
});

// touch / mouse: one pointer per finger (Game tracks lanes, slides and sliding across lanes)
// The event's timeStamp is the more precise press time, but iOS Safari hands a second finger (and its
// lift) the timeStamp of a finger already held down: debug logs showed taps stamped up to 700 ms in
// the past, judged as far too early while a hold was being held. Normally a stamp arrives 15-33 ms old
// (Safari delivers touches on frames); one older than STALE_MS is not believed, and the press is put
// at its arrival time minus the usual delivery delay instead.
const STALE_MS = 45;
let usualAge = 20;
const stampOf = e => {
  const now = performance.now(), age = now - e.timeStamp;
  if (e.timeStamp > 0 && age >= 0 && age < STALE_MS) {
    usualAge += (age - usualAge) * 0.05;
    return e.timeStamp;
  }
  return now - usualAge;
};
canvas.addEventListener('pointerdown', e => {
  if (game.state !== 'playing') return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  game.touchDown(e.pointerId, e.clientX, e.clientY, stampOf(e), e);
});
canvas.addEventListener('pointermove', e => game.touchMove(e.pointerId, e.clientX, e.clientY, stampOf(e), e));
canvas.addEventListener('pointerup', e => game.touchUp(e.pointerId, stampOf(e), false, e));
canvas.addEventListener('pointercancel', e => game.touchUp(e.pointerId, stampOf(e), true, e));
canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('resize', () => game.resize());

// ---------- menu background ----------
let bgRunning = false;
function startMenuBg() {
  if (bgRunning) return;
  bgRunning = true;
  requestAnimationFrame(menuBg);
}
const bgImg = new Image();
bgImg.src = 'assets/guye/bg.jpg';
const bgBlurImg = new Image();
bgBlurImg.src = 'assets/guye/bg_blur.jpg';
// one pre-rendered five-lobed plum petal sprite
const petal = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const p = c.getContext('2d');
  p.translate(24, 24);
  const gr = p.createRadialGradient(0, 0, 2, 0, 0, 22);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, '#ffb3d4'); gr.addColorStop(1, 'rgba(255,61,139,0)');
  p.fillStyle = gr;
  for (let i = 0; i < 5; i++) { p.beginPath(); p.ellipse(0, -10, 7, 11, 0, 0, Math.PI * 2); p.fill(); p.rotate(Math.PI * 2 / 5); }
  return c;
})();
const PETALS = Array.from({ length: 26 }, (_, i) => ({
  x: Math.random(), y: Math.random(), s: 0.35 + Math.random() * 0.7,
  vx: 0.012 + Math.random() * 0.02, vy: 0.02 + Math.random() * 0.03, r: Math.random() * 6, vr: (Math.random() - 0.5) * 1.6, ph: i,
}));
let bgLast = 0;
function menuBg(now) {
  if (game.state === 'playing' || game.state === 'paused') { bgRunning = false; return; }
  const dt = Math.min(0.05, (now - (bgLast || now)) / 1000); bgLast = now;
  const g = game.ctx, { W, H, dpr } = game;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0b0716';
  g.fillRect(0, 0, W, H);
  // slow Ken-Burns drift over the key art
  const sharp = screen === 'title' || screen === 'results';
  const img = sharp ? bgImg : bgBlurImg;
  if (img.complete && img.naturalWidth) {
    const t = now / 1000;
    const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight) * (1.08 + 0.03 * Math.sin(t * 0.07));
    const iw = img.naturalWidth * sc, ih = img.naturalHeight * sc;
    g.globalAlpha = sharp ? 0.55 : 0.7;
    g.drawImage(img, (W - iw) / 2 + Math.sin(t * 0.05) * W * 0.02, (H - ih) / 2 + Math.cos(t * 0.04) * H * 0.015, iw, ih);
  }
  // diagonal light streaks
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const k = ((now / 1000) * (0.05 + i * 0.013) + i * 0.27) % 1;
    const x = -W * 0.3 + k * W * 1.6;
    const gr = g.createLinearGradient(x - 80, 0, x + 80, 0);
    const col = i % 2 ? '63,212,255' : '255,61,139';
    gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(0.5, `rgba(${col},0.10)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.globalAlpha = 1;
    g.fillStyle = gr;
    g.save(); g.translate(x, H / 2); g.transform(1, 0, -0.45, 1, 0, 0); g.fillRect(-80, -H, 160, H * 2); g.restore();
  }
  // drifting petals
  for (const p of PETALS) {
    p.x += p.vx * dt + Math.sin(now / 1300 + p.ph) * 0.0004; p.y += p.vy * dt; p.r += p.vr * dt;
    if (p.y > 1.08) { p.y = -0.08; p.x = Math.random() * 0.9 - 0.1; }
    if (p.x > 1.08) p.x = -0.08;
    const sz = 30 * p.s;
    g.globalAlpha = 0.25 + 0.35 * p.s;
    g.save(); g.translate(p.x * W, p.y * H); g.rotate(p.r); g.scale(1, 0.6 + 0.4 * Math.sin(now / 700 + p.ph));
    g.drawImage(petal, -sz / 2, -sz / 2, sz, sz); g.restore();
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  requestAnimationFrame(menuBg);
}

// handy for debugging from the console
window.rhythm = { game, audio, settings: () => settings };

// ---------- init ----------
syncSettingsUI();
renderKeys();
show('title');
loadLibrary();
