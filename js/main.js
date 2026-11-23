// ============================================================
//  App shell: menus, library, uploads, settings, calibration
// ============================================================
import { AudioEngine } from './audio.js';
import { Game, LANE_COLORS } from './game.js';
import { resultArt } from './character.js';
import { generateChart, DIFFICULTIES } from './chart.js';
import { analyzeAudio, ANALYZER_VERSION, ANALYSIS_SR } from './analyzer.js';
import { parseMidi, midiToSong } from './midi.js';
import { storage } from './storage.js';
import { t, lang, setLang, applyI18n } from './i18n.js';

const API_BASE = 'https://rhythm-game-api.yabipeng.workers.dev';
const DIFF_COLORS = { easy: '#5dffa8', normal: '#5ab8ff', hard: '#ffcb47', expert: '#ff4d5e' };
const UPLOAD_COLORS = ['#ff6fd8', '#6a5cff', '#00d2ff', '#ff9a5a', '#5dffa8', '#ffcb47'];

const $ = id => document.getElementById(id);
const canvas = $('gameCanvas');
const audio = new AudioEngine();
const game = new Game(canvas, audio, { onEnd: showResults });

// ---------- settings ----------
const DEFAULTS = {
  speed: 5, offset: 0, music: 80, hitsound: 45, showTiming: true, noFail: false, autoSubmit: true, character: true, cutin: true, noteStyle: 'bachi', gimmicks: true,
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
const WIPE = new Set(['title>select', 'select>loading', 'loading>play', 'play>results', 'results>loading', 'results>select', 'pause>select']);
let wipeTimer = 0;
function show(name) {
  const from = screen;
  const apply = () => {
    screen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === name + 'Screen'));
    $('pauseBtn').classList.toggle('hidden', name !== 'play');
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

async function runAnalysis(buffer, onP) {
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
      w.postMessage({ samples: pcm, sr: ANALYSIS_SR });
    });
  } catch (err) {
    console.warn('Worker analysis failed, running on main thread', err);
    return await analyzeAudio(pcm, ANALYSIS_SR, onP);
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
      analysis = await runAnalysis(buffer, p => setLoading(song.title, 0.5 + p * 0.5, t('load.beats')));
      if (song.builtin) storage.cachePut(key, analysis);
      else { rec.analysis = analysis; rec.levels = levelsFor(analysis); rec.bpm = Math.round(analysis.bpm); storage.putSong(rec); }
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
        analysis = await runAnalysis(buffer, p => setLoading(title, 0.1 + p * 0.9, t('load.beats')));
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
    playing = { song, difficulty: diff };
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
  game.stop();
  show('select');
  renderSongList();
}
$('pauseBtn').addEventListener('click', pauseGame);
$('btnResume').addEventListener('click', resumeGame);
$('btnQuit').addEventListener('click', quitGame);
$('btnPauseRetry').addEventListener('click', () => { game.stop(); startSong(playing.song, playing.difficulty); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---------- results ----------
let lastResult = null;
function showResults(r) {
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

  const key = `${song.id}|${diff}`;
  if (!r.failed && (!bests[key] || r.score > bests[key].score)) {
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
  if (!r.failed && settings.autoSubmit) submitScore(true);
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
  } else if (screen === 'title' && e.code === 'Enter') {
    unlockAudio(); show('select');
  }
});
window.addEventListener('keyup', e => {
  const lane = settings.keys.indexOf(e.code);
  if (lane >= 0) game.release(lane, e.timeStamp);
});

// touch / mouse: one pointer per finger, sliding across lanes re-triggers
const pointers = new Map();
const laneCount = [0, 0, 0, 0];
const pDown = (lane, t) => { laneCount[lane]++; game.press(lane, t); };
const pUp = (lane, t) => { laneCount[lane] = Math.max(0, laneCount[lane] - 1); if (!laneCount[lane]) game.release(lane, t); };
canvas.addEventListener('pointerdown', e => {
  if (game.state !== 'playing') return;
  e.preventDefault();
  const lane = game.laneAt(e.clientX);
  pointers.set(e.pointerId, lane);
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  pDown(lane, e.timeStamp);
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || game.state !== 'playing') return;
  const old = pointers.get(e.pointerId), lane = game.laneAfterMove(old, e.clientX);
  if (lane === old) return;
  pointers.set(e.pointerId, lane);
  pUp(old, e.timeStamp);
  pDown(lane, e.timeStamp);
});
const pointerEnd = e => {
  if (!pointers.has(e.pointerId)) return;
  pUp(pointers.get(e.pointerId), e.timeStamp);
  pointers.delete(e.pointerId);
};
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
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
