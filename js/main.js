// ============================================================
//  App shell: menus, library, uploads, settings, calibration
// ============================================================
import { AudioEngine } from './audio.js';
import { Game, LANE_COLORS } from './game.js';
import { generateChart, DIFFICULTIES } from './chart.js';
import { analyzeAudio, ANALYZER_VERSION, ANALYSIS_SR } from './analyzer.js';
import { parseMidi, midiToSong } from './midi.js';
import { storage } from './storage.js';

const API_BASE = 'https://rhythm-game-api.yabipeng.workers.dev';
const DIFF_COLORS = { easy: '#5dffa8', normal: '#5ab8ff', hard: '#ffcb47', expert: '#ff4d5e' };
const UPLOAD_COLORS = ['#ff6fd8', '#6a5cff', '#00d2ff', '#ff9a5a', '#5dffa8', '#ffcb47'];

const $ = id => document.getElementById(id);
const canvas = $('gameCanvas');
const audio = new AudioEngine();
const game = new Game(canvas, audio, { onEnd: showResults });

// ---------- settings ----------
const DEFAULTS = {
  speed: 5, offset: 0, music: 80, hitsound: 45, showTiming: true, noFail: false,
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
function show(name) {
  screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === name + 'Screen'));
  $('pauseBtn').classList.toggle('hidden', name !== 'play');
  if (name !== 'play') startMenuBg();
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
    const sub = [song.artist, song.genre, song.bpm ? `${song.bpm} BPM` : '', fmtTime(song.duration)].filter(Boolean).join(' · ');
    b.innerHTML = `<div class="stripe"></div><div class="meta"><div class="title"></div><div class="sub"></div></div>` +
      `<div class="best"></div>` + (song.builtin ? '' : `<button class="del" title="Delete">✕</button>`);
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

  section('BUILT-IN  ·  Lyria 3.5 & MIDI');
  builtin.forEach(card);
  section('MY SONGS  ·  上傳的歌曲');
  const up = document.createElement('button');
  up.className = 'upload-card';
  up.innerHTML = '＋ 上傳歌曲 Upload song<small>MP3 · WAV · OGG · M4A · FLAC · MIDI — 也可以直接拖放檔案到這裡</small>';
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
    b.innerHTML = `<b>${lv ?? '–'}</b>${d}`;
    b.addEventListener('click', () => {
      difficulty = d;
      localStorage.setItem('rhythmDifficulty', d);
      renderSongList();
    });
    tabs.appendChild(b);
  }
  const info = $('selectInfo');
  if (!song) { info.textContent = '上傳一首歌開始玩'; $('btnStart').disabled = true; return; }
  $('btnStart').disabled = false;
  const lv = song.levels?.[difficulty];
  const best = bests[`${song.id}|${difficulty}`];
  info.textContent = [
    lv ? `${lv.notes} notes` : '',
    best ? `Best ${best.score.toLocaleString()} · ${best.rank} · ${(best.acc * 100).toFixed(2)}%` : 'No play yet',
  ].filter(Boolean).join('   ·   ');
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
  setLoading(song.title, 0, 'Loading…');
  if (song.kind === 'midi') {
    const data = song.builtin ? await fetchWithProgress('songs/' + song.file, p => setLoading(song.title, p)) : (await storage.getSong(song.id)).data;
    const s = midiToSong(parseMidi(data));
    entry = { analysis: s.analysis, midiNotes: s.notes };
  } else {
    const rec = song.builtin ? null : await storage.getSong(song.id);
    const data = song.builtin ? await fetchWithProgress('songs/' + song.file, p => setLoading(song.title, p * 0.4, 'Downloading…')) : rec.data;
    setLoading(song.title, 0.45, 'Decoding…');
    const buffer = await audio.decode(data);
    const key = `analysis:${song.id}:${ANALYZER_VERSION}`;
    let analysis = song.builtin ? await storage.cacheGet(key) : (rec.analysis?.version === ANALYZER_VERSION ? rec.analysis : null);
    if (!analysis) {
      analysis = await runAnalysis(buffer, p => setLoading(song.title, 0.5 + p * 0.5, '分析節拍中 Detecting beats…'));
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
    if (!isMidi && !isAudio) { toast(`不支援的檔案格式：${file.name}`); continue; }
    if (file.size > 80 * 1024 * 1024) { toast(`檔案太大（>80MB）：${file.name}`); continue; }
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 50);
    show('loading');
    setLoading(title, 0, 'Reading file…');
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
        setLoading(title, 0.05, 'Decoding…');
        const buffer = await audio.decode(data);
        if (buffer.duration < 10) throw new Error('歌曲太短（至少 10 秒）');
        analysis = await runAnalysis(buffer, p => setLoading(title, 0.1 + p * 0.9, '分析節拍中 Detecting beats…'));
        songCache.set(id, { analysis, buffer });
        rec.analysis = analysis;
      }
      rec.bpm = Math.round(analysis.bpm);
      rec.duration = analysis.duration;
      rec.levels = levelsFor(analysis);
      try { await storage.putSong(rec); }
      catch { toast('瀏覽器儲存空間不足，這首歌只會保留到關閉頁面'); const { data: _, ...meta } = rec; uploads.unshift({ ...meta, temp: true }); }
      lastId = id;
    } catch (err) {
      console.error(err);
      toast(`無法讀取 ${file.name}：${err.message || err}`, 4000);
    }
  }
  const temps = uploads.filter(u => u.temp);
  uploads = [...temps, ...(await storage.listSongs())];
  if (lastId) { selectedId = lastId; localStorage.setItem('rhythmSelected', lastId); toast('已加入歌曲！選擇難度後開始'); }
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
  if (!confirm(`刪除「${song.title}」？`)) return;
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
  try {
    const entry = await prepare(song);
    const { notes } = generateChart(entry.analysis, diff);
    if (!notes.length) throw new Error('No playable notes found');
    let music;
    if (entry.buffer) music = { type: 'audio', buffer: entry.buffer };
    else {
      const gameTimes = new Set(notes.map(n => n.time));
      music = { type: 'midi', notes: entry.midiNotes, isGameNote: n => gameTimes.has(n.g) };
    }
    playing = { song, difficulty: diff };
    applyVolumes();
    await audio.resume();
    show('play');
    game.resize();
    game.start({
      notes, music, title: song.title, difficulty: diff,
      beats: entry.analysis.beats, downbeat: entry.analysis.downbeat, barBeats: entry.analysis.barBeats,
      settings,
    });
  } catch (err) {
    console.error(err);
    toast('載入失敗：' + (err.message || err), 4000);
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
  $('resSong').textContent = `${song.title} · ${diff.toUpperCase()}`;
  $('resRank').textContent = r.rank;
  $('resRank').style.color = r.color;
  $('resScore').textContent = r.score.toLocaleString();
  $('resAcc').textContent = `${(r.accuracy * 100).toFixed(2)}%`;
  $('resPerfect').textContent = r.counts.perfect;
  $('resGreat').textContent = r.counts.great;
  $('resGood').textContent = r.counts.good;
  $('resMiss').textContent = r.counts.miss;
  $('resCombo').textContent = r.maxCombo;
  $('resFastSlow').textContent = `${r.fast} / ${r.slow}`;

  const off = $('resOffset');
  off.innerHTML = '';
  if (r.hits >= 20 && Math.abs(r.medianOffset) >= 8) {
    const m = Math.round(r.medianOffset);
    off.textContent = `你的打擊平均${m > 0 ? '偏晚' : '偏早'} ${Math.abs(m)}ms`;
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = `Offset ${settings.offset} → ${settings.offset + m}`;
    b.onclick = () => { settings.offset += m; saveSettings(); b.disabled = true; b.textContent = 'Applied ✓'; };
    off.appendChild(b);
  } else if (r.hits >= 20) {
    off.textContent = `平均誤差 ${Math.round(r.medianOffset)}ms — 時間校正良好 👍`;
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
  $('btnSubmit').disabled = !!r.failed;
  $('btnSubmit').textContent = 'Submit';
  $('submitStatus').textContent = r.failed ? 'Failed runs cannot be submitted' : '';
  $('playerName').value = localStorage.getItem('rhythmPlayerName') || '';
}
$('btnRetry').addEventListener('click', () => startSong(playing.song, playing.difficulty));
$('btnResBack').addEventListener('click', () => { game.stop(); show('select'); renderSongList(); });

// ---------- leaderboard ----------
let lbReturn = 'title';
async function submitScore() {
  const name = $('playerName').value.trim();
  if (!name) return $('playerName').focus();
  localStorage.setItem('rhythmPlayerName', name);
  const btn = $('btnSubmit'), st = $('submitStatus');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch(API_BASE + '/api/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lastResult, player_name: name }),
    });
    const data = await res.json();
    if (data.success) { btn.textContent = 'Done'; st.textContent = `#${data.position} on this song`; st.style.color = '#5dffa8'; }
    else { btn.disabled = false; btn.textContent = 'Submit'; st.textContent = data.error || 'Submit failed'; st.style.color = '#ff4d5e'; }
  } catch {
    btn.disabled = false; btn.textContent = 'Submit'; st.textContent = 'Network error'; st.style.color = '#ff4d5e';
  }
}
$('btnSubmit').addEventListener('click', submitScore);

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

async function loadLeaderboard(tab) {
  document.querySelectorAll('.lb-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const msg = $('lbMsg'), table = $('lbTable'), body = $('lbBody');
  msg.style.display = 'block'; msg.textContent = 'Loading…';
  table.style.display = 'none'; body.innerHTML = '';
  try {
    let url = API_BASE + '/api/leaderboard?limit=30';
    if (tab === 'song' && playing) url += `&song=${encodeURIComponent(playing.song.title)}&difficulty=${playing.difficulty}`;
    const data = await (await fetch(url)).json();
    const list = data.leaderboard || [];
    if (!list.length) { msg.textContent = 'No scores yet'; return; }
    table.querySelector('thead').innerHTML = tab === 'global'
      ? '<tr><th>#</th><th>Player</th><th>Song</th><th>Score</th><th>Rank</th></tr>'
      : '<tr><th>#</th><th>Player</th><th>Score</th><th>Acc</th><th>Rank</th></tr>';
    list.forEach((e, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = tab === 'global'
        ? `<td>${i + 1}</td><td>${esc(e.player_name)}</td><td>${esc(e.song_name)}</td><td>${Number(e.score).toLocaleString()}</td><td>${esc(e.rank)}</td>`
        : `<td>${i + 1}</td><td>${esc(e.player_name)}</td><td>${Number(e.score).toLocaleString()}</td><td>${typeof e.accuracy === 'number' ? e.accuracy.toFixed(1) + '%' : '-'}</td><td>${esc(e.rank)}</td>`;
      body.appendChild(tr);
    });
    msg.style.display = 'none';
    table.style.display = 'table';
  } catch {
    msg.textContent = 'Failed to load leaderboard';
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
$('setHit').addEventListener('change', () => { unlockAudio(); audio.playTap(); });

function syncSettingsUI() {
  $('setSpeed').value = settings.speed; $('outSpeed').textContent = settings.speed;
  $('setOffset').value = settings.offset; $('outOffset').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset}ms`;
  $('setMusic').value = settings.music; $('outMusic').textContent = settings.music;
  $('setHit').value = settings.hitsound; $('outHit').textContent = settings.hitsound;
  $('setTiming').checked = settings.showTiming;
  $('setNoFail').checked = settings.noFail;
  renderKeys();
}
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
  toast('請依序按下第 1 軌的按鍵…', 8000);
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
  toast(`Offset 已設為 ${settings.offset > 0 ? '+' : ''}${settings.offset}ms`);
  stopCal(); syncSettingsUI(); show('settings');
});
function resetCal() {
  $('calCount').textContent = '';
  $('calResult').textContent = '';
  $('btnCalApply').classList.add('hidden');
  $('btnCalStart').classList.remove('hidden');
  $('btnCalStart').textContent = 'Start';
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
  $('btnCalStart').textContent = 'Again';
  if (taps.length < 8) { $('calResult').textContent = '點擊次數太少，請再試一次'; return; }
  // drop outliers, then take the median
  const trimmed = taps.slice(Math.floor(taps.length * 0.15), Math.ceil(taps.length * 0.85));
  const med = trimmed[trimmed.length >> 1];
  const spread = Math.sqrt(trimmed.reduce((s, v) => s + (v - med) ** 2, 0) / trimmed.length);
  cal.result = Math.round(med);
  $('calResult').innerHTML = `測得延遲 <b>${cal.result > 0 ? '+' : ''}${cal.result}ms</b>（穩定度 ±${Math.round(spread)}ms，${taps.length} 次）`;
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
    if (e.code === 'Escape') { rebind = null; toast('已取消'); return; }
    if (rebind.codes.includes(e.code)) return;
    rebind.codes.push(e.code); rebind.labels.push(keyLabel(e));
    if (rebind.codes.length === 4) {
      settings.keys = rebind.codes; settings.keyLabels = rebind.labels;
      rebind = null; saveSettings(); toast('按鍵已更新');
    } else toast(`請按下第 ${rebind.codes.length + 1} 軌的按鍵…`, 8000);
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
  const lane = game.laneAt(e.clientX), old = pointers.get(e.pointerId);
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
function menuBg(now) {
  if (game.state === 'playing' || game.state === 'paused') { bgRunning = false; return; }
  const g = game.ctx, { W, H, dpr } = game;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#06050d';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.025)';
  g.fillRect(game.fieldX, 0, game.fieldW, H);
  for (let i = 0; i < 14; i++) {
    const lane = (i * 7) % 4;
    const speed = 0.05 + (i % 5) * 0.012;
    const y = ((now * speed / 1000 + i * 0.137) % 1.2 - 0.1) * H;
    const s = game.sprites[lane];
    g.globalAlpha = 0.12;
    g.drawImage(s.canvas, game.laneX(lane) - s.w / 2, y - s.h / 2, s.w, s.h);
  }
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
