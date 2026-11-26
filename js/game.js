// ============================================================
//  Gameplay: clock, judging, rendering
// ============================================================

import { Character, PETAL } from './character.js';
import { FONT } from './i18n.js';

export const LANE_COLORS = ['#ff5a6e', '#4fb4ff', '#4fffa0', '#ffcb47'];
const LANE_RGB = [[255, 90, 110], [79, 180, 255], [79, 255, 160], [255, 203, 71]];
const rgba = (lane, a) => `rgba(${LANE_RGB[lane][0]},${LANE_RGB[lane][1]},${LANE_RGB[lane][2]},${a})`;

// Judgement windows (ms, +/-)
// ?auto=1 plays the chart by itself (scores are not submitted)
export const AUTOPLAY = typeof location !== 'undefined' && new URLSearchParams(location.search).get('auto') === '1';
export const WINDOWS = { perfect: 42, great: 85, good: 130, bad: 165 };
const SWEEP_LENIENCY = 1.3;   // sweep steps are judged with windows this much wider
// slides are about where the finger is, not when it crosses a line: from SLIDE_EARLY ms before a bend
// a finger in the lane it bends into takes it over (PERFECT up to the bend, then late tiers), and a
// finger counts as there once it is within SLIDE_REACH lanes of the boundary
const SLIDE_EARLY = 300;
const SLIDE_REACH = 0.15;
const TIERS = [
  { key: 'perfect', label: 'PERFECT', win: WINDOWS.perfect, color: '#ffe066', weight: 1, hp: 1.2 },
  { key: 'great', label: 'GREAT', win: WINDOWS.great, color: '#5dffa8', weight: 0.75, hp: 0.8 },
  { key: 'good', label: 'GOOD', win: WINDOWS.good, color: '#5ab8ff', weight: 0.4, hp: 0.2 },
];
const MISS = { key: 'miss', label: 'MISS', color: '#ff4d5e' };
const DIFF_HUD = { easy: '#5dffa8', normal: '#5ab8ff', hard: '#ffcb47', expert: '#ff4d5e' };

export const NOTE_STYLES = ['bachi', 'slab', 'sakura', 'glass'];

function blossom(g, cx, cy, r, fill) {
  g.fillStyle = fill;
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 - Math.PI / 2;
    g.beginPath(); g.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.36, r * 0.6, a + Math.PI / 2, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#ffd27a';
  g.beginPath(); g.arc(cx, cy, r * 0.2, 0, Math.PI * 2); g.fill();
}

// note head sprites, drawn into the box (x, y, w, h)
const drawNoteSprite = {
  // 三味線 plectrum (撥): a fan, wide curved striking edge toward the player, gold rim
  bachi(g, l, x, y, w, h) {
    const x0 = x + w * 0.01, x1 = x + w * 0.99, bot = y + h * 0.78, top = y + h * 0.04;
    const fan = () => {
      g.beginPath();
      g.moveTo(x + w * 0.27, top); g.lineTo(x + w * 0.73, top);
      g.lineTo(x1, bot); g.quadraticCurveTo(x + w / 2, y + h * 1.04, x0, bot);
      g.closePath();
    };
    g.shadowBlur = 12; g.shadowColor = rgba(l, 0.8);
    const grad = g.createLinearGradient(0, top, 0, y + h);
    grad.addColorStop(0, rgba(l, 0.8)); grad.addColorStop(1, LANE_COLORS[l]);
    g.fillStyle = grad; fan(); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#ffe29a'; g.lineWidth = 2; g.lineJoin = 'round'; fan(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x + w * 0.2, bot - h * 0.06); g.quadraticCurveTo(x + w / 2, y + h * 0.9, x + w * 0.8, bot - h * 0.06); g.stroke();
  },
  // white top on a coloured base: a slab with some depth (BanG Dream / SEKAI style)
  slab(g, l, x, y, w, h) {
    const th = h * 0.28, fh = h - th, r = Math.min(5, fh / 3);
    g.fillStyle = rgba(l, 0.95);
    g.beginPath(); g.roundRect(x, y + th, w, fh, r); g.fill();
    g.shadowBlur = 12; g.shadowColor = rgba(l, 0.85);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(x, y, w, fh, r); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = LANE_COLORS[l]; g.lineWidth = 3;
    g.beginPath(); g.roundRect(x + 1.5, y + 1.5, w - 3, fh - 3, r); g.stroke();
  },
  // coloured capsule with a white blossom in the middle
  sakura(g, l, x, y, w, h) {
    g.shadowBlur = 12; g.shadowColor = rgba(l, 0.8);
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, LANE_COLORS[l]); grad.addColorStop(1, rgba(l, 0.72));
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, h / 2); g.stroke();
    blossom(g, x + w / 2, y + h / 2, h * 0.62, '#ffffff');
  },
  // see-through capsule with a bright rim: she shows through the notes
  glass(g, l, x, y, w, h) {
    g.fillStyle = rgba(l, 0.2);
    g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
    g.shadowBlur = 10; g.shadowColor = rgba(l, 0.9);
    g.strokeStyle = LANE_COLORS[l]; g.lineWidth = 3.2;
    g.beginPath(); g.roundRect(x + 1.6, y + 1.6, w - 3.2, h - 3.2, h / 2); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath(); g.roundRect(x + h * 0.6, y + h * 0.22, w - h * 1.2, Math.max(2, h * 0.17), h * 0.09); g.fill();
  },
};

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.max(0, Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2));
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
  };
}

export function approachMs(speed) {
  return 2600 * Math.pow(0.84, speed - 1);
}

export function rankFor(acc, counts, failed) {
  if (failed) return { rank: 'F', color: '#ff3b4e' };
  if (counts.miss === 0 && counts.good === 0 && counts.great === 0) return { rank: 'SS', color: '#ffe066' };
  if (acc >= 0.98 && counts.miss === 0) return { rank: 'SS', color: '#ffe066' };
  if (acc >= 0.95) return { rank: 'S', color: '#ffd23f' };
  if (acc >= 0.9) return { rank: 'A', color: '#5dffa8' };
  if (acc >= 0.8) return { rank: 'B', color: '#5ab8ff' };
  if (acc >= 0.7) return { rank: 'C', color: '#ffcb47' };
  return { rank: 'D', color: '#ff7a5a' };
}

export class Game {
  constructor(canvas, audio, hooks) {
    this.canvas = canvas;
    // alpha: 孤夜's dance video shows through from under the canvas
    this.ctx = canvas.getContext('2d');
    this.audio = audio;
    this.hooks = hooks; // { onEnd(result) }
    this.state = 'idle';
    this.keyDown = [false, false, false, false];
    this.pointers = new Map();          // pointerId -> { lane, x, y } (canvas px)
    this.laneCount = [0, 0, 0, 0];      // fingers on each lane
    this.dbg = null;                    // DebugLog when ?debug=1
    this.char = new Character();
    this.resize();
    this.loop = this.loop.bind(this);
  }

  // ---------- layout ----------
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, rect.width);
    this.H = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.char.layout(this.W, this.H);
    // wide screens: a perspective highway styled as a shamisen neck, centred, with arc gauges both sides.
    // fieldX/fieldW/laneW describe the judge line (scale 1); the neck narrows toward the horizon.
    // every screen draws the shamisen neck (persp); only wide ones get the side arc gauges (arcs).
    this.arcs = this.W >= 760 && this.W / this.H >= 1.15;
    this.persp = true;
    let fieldW;
    if (this.arcs) {
      const nearHalf = Math.min(this.W * 0.2, this.H * 0.4, 380);
      fieldW = nearHalf * 2;
      this.judgeY = this.H - Math.max(96, this.H * 0.2);
      this.horizonY = this.H * 0.05;
      this.farRatio = 0.26;
    } else {
      // phones: a gentler taper so the far end stays wide enough to read, horizon below the top HUD
      fieldW = Math.min(this.W - 24, 440);
      this.judgeY = this.H - Math.max(110, this.H * 0.15);
      this.horizonY = Math.max(64, this.H * 0.08);
      this.farRatio = 0.52;
    }
    this.laneW = fieldW / 4;
    this.fieldX = (this.W - fieldW) / 2;
    this.fieldW = fieldW;
    this.noteH = Math.max(16, Math.min(26, this.laneW * 0.2));
    this.strings = [0, 0, 0, 0, 0];   // vibration of each lane boundary (1..3 are the strings)
    this.stringPulses = [];          // light running up a string after a hit (100+ combo)
    this.buildSprites();
  }

  // perspective helpers. z = 0 at the judge line, 1 at the horizon (negative below the judge line)
  sOfZ(z) { return 1 / (1 + (1 / this.farRatio - 1) * z); }
  yOfS(s) { return this.judgeY - (this.judgeY - this.horizonY) * (1 - s) / (1 - this.farRatio); }
  // scale at a screen y (linear in y for a flat plane seen in perspective)
  sOfY(y) { return 1 - (this.judgeY - y) * (1 - this.farRatio) / (this.judgeY - this.horizonY); }
  // x of lane boundary b (0..4; fractional = inside a lane) at screen y
  bx(b, y) { return this.centerX + (b - 2) * this.laneW * (this.persp ? this.sOfY(y) : 1); }

  laneX(l) { return this.fieldX + this.laneW * (l + 0.5); }
  laneColor(l) { return LANE_COLORS[l]; }
  get centerX() { return this.fieldX + this.fieldW / 2; }

  // ---------- touch ----------
  // client -> canvas px
  toCanvas(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    return [(cx - r.left) / r.width * this.W, (cy - r.top) / r.height * this.H];
  }
  // lane coordinate of a canvas point (lane l spans [l, l+1), centre l + 0.5). It follows the drawn neck,
  // which widens below the judge line where the thumbs actually are, so a touch counts for the lane it
  // visibly lands in.
  lanePos(x, y) {
    const s = this.persp ? Math.max(this.farRatio, this.sOfY(Math.max(this.horizonY, y))) : 1;
    return (x - this.centerX) / (this.laneW * s) + 2;
  }
  laneOfPos(pos) { return Math.max(0, Math.min(3, Math.floor(pos))); }

  touchDown(id, cx, cy, perf, e) {
    if (this.state !== 'playing') return;
    const [x, y] = this.toCanvas(cx, cy), pos = this.lanePos(x, y), lane = this.laneOfPos(pos);
    this.pointers.set(id, { lane, x, y });
    this.dbg?.pointer('down', id, x, y, pos, lane, perf, e);
    this.fingerOn(lane, perf);
  }
  touchMove(id, cx, cy, perf, e) {
    const p = this.pointers.get(id);
    if (!p || this.state !== 'playing') return;
    [p.x, p.y] = this.toCanvas(cx, cy);
    this.dbg?.pointer('move', id, p.x, p.y, this.lanePos(p.x, p.y), p.lane, perf, e);
    this.trackFinger(p, perf);
  }
  touchUp(id, perf, cancel, e) {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    this.dbg?.pointer(cancel ? 'cancel' : 'up', id, p.x, p.y, this.lanePos(p.x, p.y), p.lane, perf, e);
    this.fingerOff(p.lane, perf);
  }
  fingerOn(lane, perf) { this.laneCount[lane]++; if (this.state === 'playing') this.touchPresses++; this.press(lane, perf); }
  fingerOff(lane, perf) {
    this.laneCount[lane] = Math.max(0, this.laneCount[lane] - 1);
    if (!this.laneCount[lane]) this.release(lane, perf);
  }

  // A finger moved (or, on a slide, a frame went by): the lane it now counts for.
  // Holding a hold note it stays on its lane: drifting off would break the hold and "press" the
  // neighbouring lane, eating that lane's next note as an early miss. A slide is the exception: from
  // SLIDE_EARLY before a bend, a finger that is in (or just short of) the lane it bends into carries it
  // over. Checked every frame too, so a finger that got there early and stopped still takes it.
  // A free finger only switches once well inside the next lane (a resting finger wobbles otherwise).
  trackFinger(p, perf) {
    if (this.state !== 'playing') return;
    const pos = this.lanePos(p.x, p.y), h = this.holding[p.lane];
    if (h) {
      const b = h.path && h.seg < h.path.length ? h.path[h.seg] : null;
      if (!b || this.holding[b.lane]) return;
      const t = this.songAt(perf);
      if (t < b.t - SLIDE_EARLY) return;
      const into = b.lane > p.lane ? pos - b.lane : b.lane + 1 - pos;   // lanes past the boundary
      if (into < -SLIDE_REACH) return;
      const old = p.lane;
      this.laneCount[old] = Math.max(0, this.laneCount[old] - 1);
      this.keyDown[old] = this.laneCount[old] > 0;
      p.lane = b.lane;
      this.laneCount[b.lane]++;
      this.keyDown[b.lane] = true;
      this.beam[b.lane] = 1;
      this.shiftSlide(h, b.lane, t, 'touch');
      return;
    }
    if (Math.abs(pos - (p.lane + 0.5)) < 0.75) return;
    const lane = this.laneOfPos(pos);
    if (lane === p.lane) return;
    const old = p.lane;
    p.lane = lane;
    this.fingerOff(old, perf);
    this.fingerOn(lane, perf);
  }

  // pre-render glowing note heads (shadowBlur per frame is expensive and causes hitches).
  // settings.noteStyle: bachi (三味線 plectrum, default), slab (white top on a coloured base), sakura
  // (capsule with a blossom), glass (see-through capsule with a bright rim)
  buildSprites() {
    const pad = 14, w = this.laneW - 10, h = this.noteH;
    this.noteStyle = NOTE_STYLES.includes(this.settings?.noteStyle) ? this.settings.noteStyle : 'bachi';
    // the plectrum and the slab are drawn taller than the capsules (their shape needs the height)
    const hh = this.noteStyle === 'bachi' ? h * 1.25 : this.noteStyle === 'slab' ? h * 1.15 : h;
    this.sprites = LANE_RGB.map((_, l) => {
      const c = document.createElement('canvas');
      c.width = Math.ceil((w + pad * 2) * this.dpr);
      c.height = Math.ceil((hh + pad * 2) * this.dpr);
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      drawNoteSprite[this.noteStyle](g, l, pad, pad, w, hh);
      return { canvas: c, w: w + pad * 2, h: hh + pad * 2 };
    });
  }

  // ---------- song clock ----------
  // raw position from the audio clock (what is being heard right now)
  rawSongMs(perf) {
    return (this.audio.heardTime(perf) - this.t0) * 1000 - this.settings.offset;
  }
  // smoothed clock: performance.now() extrapolation slowly slaved to the audio clock
  updateClock(now) {
    const raw = this.rawSongMs(now);
    if (this.anchorPerf == null) { this.anchorPerf = now; this.anchorSong = raw; return; }
    const pred = this.anchorSong + (now - this.anchorPerf);
    const err = raw - pred;
    if (Math.abs(err) > 35) { this.anchorPerf = now; this.anchorSong = raw; }
    else this.anchorSong += err * 0.06;
  }
  songAt(perf) {
    if (this.anchorPerf == null) return this.rawSongMs(perf);
    return this.anchorSong + (perf - this.anchorPerf);
  }

  // ---------- scroll speed (soflan) ----------
  // speed: [{ time (s), x }] linearly interpolated; scrollPos(t) is its integral in ms, so the
  // distance of a note from the judge line is scrollPos(note) - scrollPos(now). Judging never changes.
  buildScroll(speed) {
    const pts = (speed || []).map(p => ({ t: p.time * 1000, x: Math.max(0.2, p.x) })).sort((a, b) => a.t - b.t);
    this.scroll = pts.length ? pts : null;
    this.speedMarks = [];
    this.markIdx = 0;
    this.minSpeed = 1;
    if (!pts.length) return;
    pts[0].c = pts[0].t;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      b.c = a.c + (a.x + b.x) / 2 * (b.t - a.t);
      if (Math.abs(b.x - a.x) > 0.1) this.speedMarks.push({ t: b.t, x: b.x, up: b.x > a.x });
    }
    this.minSpeed = Math.min(1, ...pts.map(p => p.x));
  }
  scrollPos(time) {
    const p = this.scroll;
    if (!p) return time;
    if (time <= p[0].t) return p[0].c - p[0].x * (p[0].t - time);
    const i = Math.min(p.length - 1, upperT(p, time) - 1), a = p[i];
    if (i === p.length - 1) return a.c + a.x * (time - a.t);
    const b = p[i + 1], dt = time - a.t, slope = (b.x - a.x) / Math.max(1e-6, b.t - a.t);
    return a.c + a.x * dt + slope * dt * dt / 2;
  }
  speedAt(time) {
    const p = this.scroll;
    if (!p) return 1;
    if (time <= p[0].t) return p[0].x;
    const i = upperT(p, time) - 1;
    if (i >= p.length - 1) return p[p.length - 1].x;
    const a = p[i], b = p[i + 1];
    return a.x + (b.x - a.x) * (time - a.t) / Math.max(1e-6, b.t - a.t);
  }

  // ---------- lifecycle ----------
  start({ notes, speed, beats, downbeat, barBeats, music, title, songId, difficulty, settings }) {
    this.settings = settings;
    this.title = title;
    this.difficulty = difficulty;
    this.beats = (beats || []).map(b => b * 1000);
    this.downbeat = downbeat || 0;
    this.barBeats = barBeats || 4;
    this.approach = approachMs(settings.speed);
    this.char.enabled = settings.character !== false;
    this.char.cutinEnabled = settings.cutin !== false;
    this.resize();
    this.char.reset(performance.now(), title, songId);

    this.notes = notes.map((n, i) => ({
      id: i, t: n.time * 1000, lane: n.lane, end: n.end ? n.end * 1000 : 0,
      state: 0,      // 0 pending, 1 holding, 2 done(hit), 3 missed
      tail: 0,       // hold tail: 0 pending, 1 ok, 2 released early (GOOD) or head missed
      // slide: the lanes it bends into, each judged when the next key takes over; cur = lane held now
      path: n.path && n.end ? n.path.map(p => ({ t: p.time * 1000, lane: p.lane })) : null, seg: 0, cur: n.lane,
      sweep: n.sweep ?? null,
    }));
    this.sweeps = new Map();
    for (const n of this.notes) if (n.sweep != null) {
      if (!this.sweeps.has(n.sweep)) this.sweeps.set(n.sweep, { notes: [], missed: false });
      this.sweeps.get(n.sweep).notes.push(n);
    }
    this.laneNotes = [[], [], [], []];
    for (const n of this.notes) this.laneNotes[n.lane].push(n);
    this.laneHead = [0, 0, 0, 0];
    this.holding = [null, null, null, null];
    this.floating = [];   // slides let go just before a bend: the next key may still pick them up
    this.pointers.clear();
    this.laneCount = [0, 0, 0, 0];
    this.lastPress = [-1e9, -1e9, -1e9, -1e9];   // song time of each lane's last press (debug: why a miss)
    this.total = this.notes.length + this.notes.filter(n => n.end).length + this.notes.reduce((s, n) => s + (n.path?.length || 0), 0);
    this.buildScroll(speed);

    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.weightSum = 0;
    this.judged = 0;
    this.combo = 0; this.maxCombo = 0;
    this.hp = 100;
    this.offsets = [];
    this.presses = 0; this.touchPresses = 0;   // play log: keyboard or touch
    this.pauses = 0;
    this.fast = 0; this.slow = 0;
    this.lastJudge = null;
    this.effects = []; this.particles = []; this.errTicks = [];
    this.beam = [0, 0, 0, 0];
    this.receptorHit = [0, 0, 0, 0];
    this.comboPop = 0;
    this.displayScore = 0;
    this.meanErr = 0;

    const first = this.notes.length ? this.notes[0].t : 0;
    const last = this.notes.reduce((m, n) => Math.max(m, n.end || n.t), 0);
    this.endMs = Math.max(last + 1800, 3000);
    this.lastNoteMs = last || Infinity;
    this.startPerf = performance.now();
    this.lastMilestone = 0;
    const leadMs = Math.max(2200, this.approach / this.minSpeed + 900 - first);

    const ctx = this.audio.ensure();
    this.t0 = ctx.currentTime + 0.12 + leadMs / 1000;
    this.anchorPerf = null;
    this.chorus = music.type === 'audio' ? findChorus(music.buffer, this.beats, this.downbeat, this.barBeats) : [];
    this.fx = { mv: 0, chorus: 0, sakura: 0, cam: 0, chorusAt: -1e9, chorusN: 0, inChorus: false };
    if (music.type === 'audio') this.audio.playBuffer(music.buffer, this.t0);
    else this.audio.playMidi(music.notes, this.t0, music.isGameNote);

    this.dbg?.begin(this, { title, songId, difficulty });
    this.state = 'playing';
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  async pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pauses++;
    this.char.pauseMv();
    await this.audio.pause();
  }

  async resume() {
    if (this.state !== 'paused') return;
    // a hold whose key was let go during the pause is broken
    for (let l = 0; l < 4; l++) {
      const n = this.holding[l];
      if (n && !this.keyDown[l]) { this.holding[l] = null; this.breakHold(n, this.songTime ?? 0); }
    }
    for (const n of this.floating) this.breakHold(n, this.songTime ?? 0);
    this.floating = [];
    await this.audio.resume();
    this.anchorPerf = null;
    this.state = 'playing';
    this.char.resumeMv();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.state = 'idle';
    this.char.stopMv();
    cancelAnimationFrame(this.raf);
    this.audio.stopMusic(0.25);
    this.audio.resume();
  }

  // ---------- input ----------
  press(lane, perf) {
    if (this.state !== 'playing') return;
    this.keyDown[lane] = true;
    this.presses++;
    this.beam[lane] = 1;
    if (this.settings.hitsound > 0) this.audio.playTap();
    const t = this.songAt(perf);
    this.lastPress[lane] = t;
    if (this.slideShift(lane, t)) return;
    const list = this.laneNotes[lane];
    for (let i = this.laneHead[lane]; i < list.length; i++) {
      const n = list[i];
      if (n.state !== 0) continue;
      const diff = t - n.t; // + late, - early
      const k = n.sweep != null ? SWEEP_LENIENCY : 1;
      if (diff < -WINDOWS.bad * k) { this.dbg?.press(lane, t, 'idle'); return; }   // too early: ignore the press
      if (diff > WINDOWS.good * k) { this.miss(n); continue; }
      if (diff < -WINDOWS.good * k) { this.dbg?.press(lane, t, 'early'); this.miss(n, true); return; } // early "bad"
      this.dbg?.press(lane, t, 'hit');
      this.hit(n, diff, k);
      return;
    }
    this.dbg?.press(lane, t, 'idle');
  }

  // a key pressed near a holding slide's next bend, in the lane it bends into, takes the slide over
  slideShift(lane, t) {
    for (const n of [...this.holding, ...this.floating]) {
      if (!n?.path || n.seg >= n.path.length) continue;
      const p = n.path[n.seg];
      if (p.lane !== lane || (this.holding[lane] && this.holding[lane] !== n)) continue;
      const diff = t - p.t;
      if (diff < -SLIDE_EARLY || diff > WINDOWS.good) continue;
      this.dbg?.press(lane, t, 'shift');
      this.shiftSlide(n, lane, t, 'key');
      return true;
    }
    return false;
  }

  // the slide n moves on into `lane` (its next bend). Getting there early is fine; late costs.
  shiftSlide(n, lane, t, how) {
    const p = n.path[n.seg], diff = t - p.t;
    if (this.holding[n.cur] === n) this.holding[n.cur] = null;
    this.floating = this.floating.filter(x => x !== n);
    const late = Math.max(0, diff);
    const tier = TIERS.find(tr => late <= tr.win * 1.3) || TIERS[2];
    this.dbg?.judge('shift', n, tier.key, diff, { how, from: n.cur, to: lane });
    this.award(tier, lane);
    this.lastJudge = { tier, time: performance.now(), diff: null, lane };
    this.effects.push({ type: 'shift', from: n.cur, to: lane, time: performance.now(), color: tier.color });
    this.burst(lane, tier, true);
    n.cur = lane; n.seg++;
    this.holding[lane] = n;
  }

  release(lane, perf) {
    this.keyDown[lane] = false;
    if (this.state !== 'playing') return;
    const n = this.holding[lane];
    if (!n) return;
    this.holding[lane] = null;
    const t = this.songAt(perf);
    if (n.path && n.seg < n.path.length) {
      // let go just before a bend (lifted to re-tap, or keys swapped in the wrong order): keep it alive
      const p = n.path[n.seg];
      if (t >= p.t - SLIDE_EARLY) { n.floatUntil = p.t + WINDOWS.good; this.floating.push(n); }
      else this.breakHold(n, t, 'released');
      return;
    }
    if (t >= n.end - WINDOWS.good) this.finishHold(n);
    else this.breakHold(n, t, 'released');
  }

  // ---------- judging ----------
  hit(n, diff, k = 1) {
    const ad = Math.abs(diff) / k;
    const tier = TIERS.find(tr => ad <= tr.win) || TIERS[2];
    this.dbg?.judge('hit', n, tier.key, diff);
    this.award(tier, n.lane);
    this.offsets.push(diff);
    n.off = diff;
    this.meanErr = this.meanErr * 0.9 + diff * 0.1;
    if (tier.key !== 'perfect') { if (diff < 0) this.fast++; else this.slow++; }
    this.lastJudge = { tier, time: performance.now(), diff, lane: n.lane };
    this.errTicks.push({ diff, time: performance.now(), color: tier.color });
    if (this.errTicks.length > 40) this.errTicks.shift();
    this.burst(n.lane, tier);
    if (n.end) { n.state = 1; this.holding[n.lane] = n; }
    else n.state = 2;
    if (n.sweep != null) {
      const sw = this.sweeps.get(n.sweep);
      if (!sw.missed && sw.notes.every(x => x.state === 2)) this.sweepDone(sw);
    }
  }

  // every step of a sweep hit: a streak of light runs along the judge line and all strings ring
  sweepDone(sw) {
    const now = performance.now();
    const a = sw.notes[0].lane, b = sw.notes[sw.notes.length - 1].lane;
    this.effects.push({ type: 'sweep', from: a, to: b, time: now });
    this.strumAt = now;
    const n = sw.notes.length * 6;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), lane = Math.round(a + (b - a) * u);
      const x = this.laneX(a) + (this.laneX(b) - this.laneX(a)) * u;
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const v = 0.25 + Math.random() * 0.45;
      this.particles.push({ x, y: this.judgeY, vx: Math.cos(ang) * v + Math.sign(b - a) * 0.15, vy: Math.sin(ang) * v, life: 1, decay: 0.002 + Math.random() * 0.0015, size: 1.6 + Math.random() * 1.4, lane, spark: true, white: i % 2 === 0 });
    }
  }

  award(tier, lane) {
    this.counts[tier.key]++;
    this.weightSum += tier.weight;
    this.judged++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboPop = 1;
    this.hp = Math.min(100, this.hp + tier.hp);
    if (lane != null) this.char.onHit(lane, tier.key, performance.now(), this.combo);
  }

  miss(n, early) {
    this.dbg?.judge(early ? 'early' : 'miss', n, 'miss', null);
    n.state = 3;
    this.registerMiss(n.lane);
    if (n.end) { n.tail = 2; this.registerMiss(n.lane); }
    if (n.path) for (; n.seg < n.path.length; n.seg++) this.registerMiss(n.lane);
    if (n.sweep != null) this.sweeps.get(n.sweep).missed = true;
    if (early) this.lastJudge = { tier: MISS, time: performance.now(), diff: -999, lane: n.lane };
  }

  registerMiss(lane) {
    this.counts.miss++;
    this.judged++;
    if (this.combo >= 20) this.effects.push({ type: 'break', time: performance.now() });
    this.char.onMiss(performance.now(), this.combo);
    this.combo = 0;
    this.hp = Math.max(0, this.hp - 7);
    this.lastJudge = { tier: MISS, time: performance.now(), diff: 0, lane };
  }

  finishHold(n) {
    this.dbg?.judge('tail', n, 'perfect', null);
    n.state = 2; n.tail = 1;
    this.award(TIERS[0], n.lane);
    this.burst(n.lane, TIERS[0], true);
  }

  // released early: past the halfway point is a GOOD tail (combo kept), before it a miss
  breakHold(n, t, why) {
    this.dbg?.judge('break', n, t >= n.t + (n.end - n.t) / 2 ? 'good' : 'miss', null, { why, seg: n.seg, bends: n.path?.length || 0 });
    n.state = 2; n.tail = 2;
    if (n.path) for (; n.seg < n.path.length; n.seg++) this.registerMiss(n.cur);   // bends never reached
    if (t >= n.t + (n.end - n.t) / 2) {
      this.award(TIERS[2], n.lane);
      this.lastJudge = { tier: TIERS[2], time: performance.now(), diff: null, lane: n.lane };
    } else {
      this.registerMiss(n.lane);
    }
  }

  // ---------- effects ----------
  burst(lane, tier, small) {
    const now = performance.now();
    this.receptorHit[lane] = 1;
    const ring = tier.key === 'perfect' ? 1 : 0.7;
    this.strings[lane] = Math.max(this.strings[lane], ring);
    this.strings[lane + 1] = Math.max(this.strings[lane + 1], ring);
    if (this.persp && this.combo >= 100 && !small) {
      for (const b of [lane, lane + 1]) if (b >= 1 && b <= 3) this.stringPulses.push({ b, at: now });
      if (this.stringPulses.length > 24) this.stringPulses.splice(0, this.stringPulses.length - 24);
    }
    this.effects.push({ type: 'ring', lane, time: now, color: tier.color, perfect: tier.key === 'perfect', small, mv: this.fx?.mv || 0 });
    // sparks: streaks thrown up and pulled down by gravity, with a few spinning diamond shards
    const count = small ? 6 : tier.key === 'perfect' ? 13 : 9;
    const x = this.laneX(lane), y = this.judgeY;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
      const v = 0.35 + Math.random() * 0.6;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.0024 + Math.random() * 0.0016, size: 1.6 + Math.random() * 1.2, lane, spark: true, white: i % 3 !== 0 });
    }
    for (let i = 0; i < (small ? 0 : 3); i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.6 + (Math.random() - 0.5) * 0.3;
      const v = 0.18 + Math.random() * 0.12;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.0022, size: 3 + Math.random() * 1.5, lane, shard: true, rot: Math.random() * 6 });
    }
    const storm = (this.fx?.sakura || 0) > 0.5;
    if ((tier.key === 'perfect' || storm) && !small && PETAL && this.char.mode !== 'off') {
      for (let i = 0; i < (storm ? 5 : 3); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const v = 0.18 + Math.random() * 0.25;
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.0013, size: 9 + Math.random() * 6, lane, petal: true, rot: Math.random() * 6 });
      }
    }
  }

  score() {
    if (!this.total) return 0;
    return Math.round(900000 * this.weightSum / this.total + 100000 * this.maxCombo / this.total);
  }

  accuracy() { return this.judged ? this.weightSum / this.judged : 1; }

  result(failed) {
    const sorted = [...this.offsets].sort((a, b) => a - b);
    const median = sorted.length ? sorted[sorted.length >> 1] : 0;
    const acc = this.judged ? this.weightSum / this.total : 0;
    return {
      score: this.score(), accuracy: acc, maxCombo: this.maxCombo, counts: { ...this.counts },
      fast: this.fast, slow: this.slow, medianOffset: median, hits: sorted.length,
      offsets: this.offsets, failed, ...rankFor(acc, this.counts, failed),
    };
  }

  // play log (sent by main.js): how far the player got, and every note reached as
  // [time ms, lane, offset ms (+ late, null = miss), flags: 1 hold, 2 slide, 4 sweep, 8 hold let go early]
  playLog() {
    const notes = [];
    for (const n of this.notes || []) {
      if (n.state === 0) continue;
      const f = (n.end ? 1 : 0) | (n.path ? 2 : 0) | (n.sweep != null ? 4 : 0) | (n.tail === 2 && n.state !== 3 ? 8 : 0);
      notes.push([Math.round(n.t), n.lane, n.state === 3 || n.off == null ? null : Math.round(n.off), f]);
    }
    return {
      notes, notesTotal: this.notes?.length || 0, judgedTotal: this.total || 0,
      songMs: Math.round(Math.max(0, this.songTime || 0)), endMs: Math.round(this.endMs || 0),
      presses: this.presses || 0, touchPresses: this.touchPresses || 0, pauses: this.pauses || 0,
    };
  }

  // ---------- main loop ----------
  loop(now) {
    if (this.state !== 'playing') return;
    const dt = Math.min(50, now - this.lastFrame);
    this.lastFrame = now;
    this.updateClock(now);
    const t = this.songAt(now);
    this.songTime = t;

    // fingers resting on a slide: carry it over once its bend is near, even if they stopped moving
    for (const p of this.pointers.values()) if (this.holding[p.lane]?.path) this.trackFinger(p, now);

    if (AUTOPLAY) this.autoPlay(t);

    // auto-miss late notes, complete holds
    for (let l = 0; l < 4; l++) {
      const list = this.laneNotes[l];
      let h = this.laneHead[l];
      while (h < list.length && list[h].state >= 2) h++;
      this.laneHead[l] = h;
      for (let i = h; i < list.length; i++) {
        const n = list[i];
        if (n.t - t > WINDOWS.good) break;
        if (n.state === 0 && t - n.t > WINDOWS.good * (n.sweep != null ? SWEEP_LENIENCY : 1)) this.miss(n);
      }
      const hn = this.holding[l];
      // a slide whose bend went by without the next key taking over
      if (hn?.path && hn.seg < hn.path.length && t > hn.path[hn.seg].t + WINDOWS.good) { this.holding[l] = null; this.breakHold(hn, t, 'bend-passed'); continue; }
      if (hn && t >= hn.end) { this.holding[l] = null; this.finishHold(hn); }
    }
    for (let i = this.floating.length - 1; i >= 0; i--) {
      const n = this.floating[i];
      if (t > n.floatUntil) { this.floating.splice(i, 1); this.breakHold(n, t, 'float-expired'); }
    }
    // passing a scroll-speed change: flash the neck and ring the strings
    while (this.markIdx < this.speedMarks.length && this.speedMarks[this.markIdx].t <= t) {
      const m = this.speedMarks[this.markIdx++];
      this.effects.push({ type: 'speed', time: now, x: m.x, up: m.up });
      if (m.up) this.strumAt = now;
    }

    this.char.onHp(this.hp, now);
    if (this.hp <= 0 && !this.settings.noFail) return this.finish(true);
    if (t > this.endMs) return this.finish(false);

    this.render(t, now, dt);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ?auto=1: every note hit dead on time, holds held, slides followed (for watching a chart)
  autoPlay(t) {
    for (let l = 0; l < 4; l++) {
      const list = this.laneNotes[l];
      for (let i = this.laneHead[l]; i < list.length; i++) {
        const n = list[i];
        if (n.t > t) break;
        if (n.state === 0) { this.beam[l] = 1; this.hit(n, 0); }
      }
    }
    for (const n of [...this.holding]) {
      if (n?.path && n.seg < n.path.length && n.path[n.seg].t <= t) { this.beam[n.path[n.seg].lane] = 1; this.shiftSlide(n, n.path[n.seg].lane, t, 'auto'); }
    }
  }

  finish(failed) {
    this.state = 'ended';
    this.char.stopMv();
    this.audio.stopMusic(failed ? 0.6 : 1.5);
    this.hooks.onEnd(this.result(failed));
  }

  // ---------- rendering ----------
  render(t, now, dt) {
    const g = this.ctx;
    const { W, H, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background + beat pulse
    let pulse = 0, isBar = false, beatK = 0, beatFrac = 0;
    if (this.beats.length) {
      const k = upper(this.beats, t) - 1;
      if (k >= 0) {
        pulse = Math.exp(-(t - this.beats[k]) / 140);
        isBar = ((k - this.downbeat) % this.barBeats + this.barBeats) % this.barBeats === 0;
        beatK = k;
        const next = this.beats[k + 1] ?? this.beats[k] + 500;
        beatFrac = Math.min(1, (t - this.beats[k]) / Math.max(1, next - this.beats[k]));
      }
    }
    g.fillStyle = '#06050d';
    g.fillRect(0, 0, W, H);
    const bg = g.createRadialGradient(this.centerX, this.judgeY, 10, this.centerX, this.judgeY, H * 0.9);
    bg.addColorStop(0, `rgba(120,60,255,${0.12 + pulse * (isBar ? 0.12 : 0.06)})`);
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    this.char.drawBack(g, this, now, pulse, { k: beatK, frac: beatFrac, isBar });
    this.updateFx(t, dt);

    const fx = this.fieldX, fw = this.fieldW, lw = this.laneW, jy = this.judgeY;
    const nw = lw - 10, nh = this.noteH;
    const cam = this.camTransform(g, t, pulse, isBar);
    if (this.persp) this.drawNeck(t, now, dt, pulse);
    else this.drawFlatField(t, now, dt, pulse);

    // hit effects
    g.globalCompositeOperation = 'lighter';
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      const age = now - e.time;
      if (e.type === 'ring') {
        const dur = 320;
        if (age > dur) { this.effects.splice(i, 1); continue; }
        const p = age / dur, ease = 1 - Math.pow(1 - p, 3);
        const x = this.laneX(e.lane);
        const big = 1 + 0.7 * (e.mv || 0);   // 孤夜 on stage: bigger hit effects
        g.strokeStyle = e.color;
        g.globalAlpha = (1 - p) * 0.9;
        g.lineWidth = 3 * (1 - p) + 1;
        g.beginPath(); g.ellipse(x, jy, lw * (0.3 + ease * 0.45) * big, nh * (0.6 + ease * 1.2) * big, 0, 0, Math.PI * 2); g.stroke();
        // light pillar up the lane: gold on PERFECT, the lane's colour otherwise; it shoots up the neck
        // and fades toward the horizon
        g.globalAlpha = (1 - p) * (e.perfect ? 0.62 : 0.42);
        const top = this.persp ? jy - (jy - this.horizonY) * (0.35 + 0.45 * ease) : jy - 120 - 160 * ease;
        const col = g.createLinearGradient(0, top, 0, jy + 10);
        col.addColorStop(0, 'rgba(255,255,255,0)');
        col.addColorStop(0.7, e.perfect ? 'rgba(255,217,138,0.6)' : rgba(e.lane, 0.6));
        col.addColorStop(1, e.perfect ? '#ffd98a' : LANE_COLORS[e.lane]);
        g.fillStyle = col;
        if (this.persp) {
          const l = e.lane;
          g.beginPath();
          g.moveTo(this.bx(l + 0.04, top), top); g.lineTo(this.bx(l + 0.96, top), top);
          g.lineTo(this.bx(l + 0.96, jy + 10), jy + 10); g.lineTo(this.bx(l + 0.04, jy + 10), jy + 10);
          g.closePath(); g.fill();
        } else g.fillRect(x - lw / 2 + 3, top, lw - 6, jy + 10 - top);
        // spinning diamond spark
        const d = (nh * 0.7 + ease * lw * 0.42) * big;
        g.globalAlpha = (1 - p) * 0.85;
        g.lineWidth = 2;
        g.strokeStyle = e.perfect ? '#fff' : e.color;
        g.save(); g.translate(x, jy); g.rotate(ease * 0.8);
        g.strokeRect(-d / 2, -d / 2, d, d);
        g.restore();
        if (e.perfect && !e.small) {
          // impact frame: for ~2 frames the note is a big white silhouette (a punch of weight), then a
          // long cross flare along the judge line
          if (age < 55) {
            g.globalCompositeOperation = 'source-over';
            g.globalAlpha = 0.95;
            g.fillStyle = '#fff';
            const iw = lw * 0.95, ih = nh * 1.35;
            g.beginPath(); g.roundRect(x - iw / 2, jy - ih / 2, iw, ih, ih * 0.35); g.fill();
            g.globalCompositeOperation = 'lighter';
          }
          const q = Math.min(1, age / 220);
          if (q < 1) {
            const L = lw * (0.6 + q * 0.5) * big, Lv = L * 0.55, th = 2.2;
            g.fillStyle = '#fff3c4';
            g.globalAlpha = 1 - q;
            g.beginPath(); g.moveTo(x - L, jy); g.lineTo(x, jy - th); g.lineTo(x + L, jy); g.lineTo(x, jy + th); g.closePath(); g.fill();
            g.beginPath(); g.moveTo(x, jy - Lv); g.lineTo(x + th, jy); g.lineTo(x, jy + Lv * 0.5); g.lineTo(x - th, jy); g.closePath(); g.fill();
          }
        }
        g.globalAlpha = 1;
      } else if (e.type === 'milestone') {
        // a band of light sweeping up the whole neck
        const dur = 420;
        if (age > dur) { this.effects.splice(i, 1); continue; }
        const sw = age / 420;
        if (sw < 1) {
          const hy = this.persp ? this.horizonY : 0;
          const y = H - (H - hy) * (1 - Math.pow(1 - sw, 2)), band = (H - hy) * 0.22;
          const gr = g.createLinearGradient(0, y - band, 0, y + band * 0.3);
          gr.addColorStop(0, 'rgba(255,230,160,0)'); gr.addColorStop(0.75, `rgba(255,230,160,${0.6 * (1 - sw * 0.5)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          const y0 = Math.max(hy, y - band), y1 = Math.min(H, y + band * 0.3);
          if (this.persp) { this.neckPath(y0, y1); g.fill(); } else g.fillRect(fx, y0, fw, y1 - y0);
        }
      } else if (e.type === 'shift') {
        // slide taken over: a bright arc hops from the old lane to the new one
        const dur = 380;
        if (age > dur) { this.effects.splice(i, 1); continue; }
        const p = age / dur, u = 1 - Math.pow(1 - Math.min(1, age / 160), 3);
        const x0 = this.laneX(e.from), x2 = this.laneX(e.to), x1 = (x0 + x2) / 2, y1 = jy - lw * 0.7;
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(x0, jy); g.quadraticCurveTo(x1, y1, x2, jy);
        g.globalAlpha = (1 - p) * 0.45; g.strokeStyle = LANE_COLORS[e.to]; g.lineWidth = 12 * (1 - p) + 2; g.stroke();
        g.globalAlpha = 1 - p; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.stroke();
        const bx = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * x1 + u * u * x2, by = (1 - u) * (1 - u) * jy + 2 * (1 - u) * u * y1 + u * u * jy;
        g.fillStyle = '#fff'; g.beginPath(); g.arc(bx, by, 5 * (1 - p) + 2, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      } else if (e.type === 'sweep') {
        // the whole sweep hit: a blade of light along the judge line, then SWEEP! stamped above
        const dur = 760;
        if (age > dur) { this.effects.splice(i, 1); continue; }
        const p = age / dur, dir = Math.sign(e.to - e.from) || 1;
        const x0 = this.laneX(e.from) - dir * lw * 0.5, x1 = this.laneX(e.to) + dir * lw * 0.5;
        const xh = x0 + (x1 - x0) * (1 - Math.pow(1 - Math.min(1, age / 170), 2));
        const gr = g.createLinearGradient(x0, 0, xh + dir, 0);
        gr.addColorStop(0, 'rgba(255,190,90,0)'); gr.addColorStop(1, `rgba(255,248,215,${1 - p})`);
        g.fillStyle = gr;
        const xa = Math.min(x0, xh), xw = Math.abs(xh - x0);
        g.fillRect(xa, jy - 4 * (1 - p) - 1, xw, 8 * (1 - p) + 2);
        g.globalAlpha = (1 - p) * 0.35; g.fillRect(xa, jy - 22, xw, 44); g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        g.save();
        g.globalAlpha = p < 0.7 ? 1 : (1 - p) / 0.3;
        g.translate(this.centerX, jy - this.noteH * (this.arcs ? 6.6 : 7.2));
        g.transform(1, 0, -0.2, 1, 0, 0);
        const sc = age < 90 ? 1.7 - 0.7 * age / 90 : 1 + 0.04 * Math.sin(age / 40);
        g.scale(sc, sc);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `italic 900 26px ${FONT}`;
        g.fillStyle = 'rgba(60,20,0,0.75)'; g.fillText('SWEEP!', 3, 3);
        const tg = g.createLinearGradient(-60, 0, 60, 0);
        tg.addColorStop(0, '#ffe27a'); tg.addColorStop(0.5, '#fff'); tg.addColorStop(1, '#ffb04a');
        g.fillStyle = tg; g.fillText('SWEEP!', 0, 0);
        g.restore();
        g.globalCompositeOperation = 'lighter';
      } else if (e.type === 'speed') {
        // the neck flashes in the new speed's colour and the change is announced
        const dur = 700;
        if (age > dur) { this.effects.splice(i, 1); continue; }
        const p = age / dur, col = e.up ? '255,110,70' : '80,200,255';
        g.fillStyle = `rgba(${col},${0.22 * (1 - p)})`;
        if (this.persp) { this.neckPath(this.horizonY, H); g.fill(); } else g.fillRect(fx, 0, fw, H);
        g.globalCompositeOperation = 'source-over';
        const label = Math.abs(e.x - 1) < 0.05 ? 'NORMAL' : e.x < 0.5 ? 'BRAKE' : e.up ? 'SPEED UP' : 'SLOW DOWN';
        g.save();
        g.globalAlpha = p < 0.6 ? 1 : (1 - p) / 0.4;
        g.translate(this.centerX + (1 - Math.min(1, age / 120)) * (e.up ? -40 : 40), this.horizonY + (jy - this.horizonY) * 0.32);
        g.transform(1, 0, -0.2, 1, 0, 0);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `italic 900 24px ${FONT}`;
        g.fillStyle = 'rgba(11,7,22,0.7)'; g.fillText(label, 3, 3);
        g.fillStyle = `rgb(${col})`; g.fillText(label, 0, 0);
        g.font = `italic 900 13px ${FONT}`;
        g.fillStyle = '#fff'; g.fillText(`×${e.x.toFixed(1)}`, 0, 20);
        g.restore();
        g.globalCompositeOperation = 'lighter';
      } else if (e.type === 'break') {
        if (age > 400) { this.effects.splice(i, 1); continue; }
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(255,40,60,${0.12 * (1 - age / 400)})`;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'lighter';
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.spark ? 0.0018 : 0.0009) * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      g.globalAlpha = p.life;
      if (p.petal) {
        p.rot += dt * 0.006;
        const sz = p.size * 2;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.drawImage(PETAL, -sz / 2, -sz / 2, sz, sz);
        g.restore();
        continue;
      }
      if (p.spark) {
        g.strokeStyle = p.white ? '#fff0c8' : LANE_COLORS[p.lane];
        g.lineWidth = p.size;
        g.beginPath(); g.moveTo(p.x - p.vx * 30, p.y - p.vy * 30); g.lineTo(p.x, p.y); g.stroke();
        continue;
      }
      g.fillStyle = LANE_COLORS[p.lane];
      if (p.shard) {
        p.rot += dt * 0.012;
        const r = p.size;
        g.beginPath(); g.moveTo(p.x + Math.cos(p.rot) * r, p.y + Math.sin(p.rot) * r); g.lineTo(p.x - Math.sin(p.rot) * r * 0.6, p.y + Math.cos(p.rot) * r * 0.6);
        g.lineTo(p.x - Math.cos(p.rot) * r, p.y - Math.sin(p.rot) * r); g.lineTo(p.x + Math.sin(p.rot) * r * 0.6, p.y - Math.cos(p.rot) * r * 0.6); g.closePath(); g.fill();
        continue;
      }
      g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + p.life * 0.5), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (cam) g.restore();
    this.drawSakura(g, now);

    this.char.drawMid(g, this, now, pulse);
    this.drawHUD(t, now, dt);
    this.char.drawFront(g, this, now);
    this.dbg?.draw(g, this, t, now);
  }

  // outline of the neck between screen rows y0..y1 (wide screens)
  neckPath(y0, y1, b0 = 0, b1 = 4, g = this.ctx) {
    g.beginPath();
    g.moveTo(this.bx(b0, y0), y0); g.lineTo(this.bx(b1, y0), y0);
    g.lineTo(this.bx(b1, y1), y1); g.lineTo(this.bx(b0, y1), y1);
    g.closePath();
  }

  // the neck's lacquered body (wood, sheen, grain, fever glow), into context g
  drawNeckBody(g, pulse, feverOn) {
    const { H } = this;
    const jy = this.judgeY, hy = this.horizonY;
    // neck body: fades out toward the horizon so the MV shows through up there
    this.neckPath(hy, H, 0, 4, g);
    const wood = g.createLinearGradient(0, hy, 0, H);
    const topA = this.arcs ? 0 : 0.5;   // phones: lanes sit on the MV, keep the far end solid enough
    wood.addColorStop(0, `rgba(26,12,20,${topA})`);
    wood.addColorStop(0.35, `rgba(26,12,20,${Math.max(0.55, topA + 0.12)})`);
    wood.addColorStop(0.8, 'rgba(30,13,20,0.84)');
    wood.addColorStop(1, 'rgba(20,9,14,0.92)');
    g.fillStyle = wood; g.fill();
    // lacquer sheen down the middle + grain lines converging to the horizon
    g.save();
    this.neckPath(hy, H, 0, 4, g); g.clip();
    const sheen = g.createLinearGradient(this.fieldX, 0, this.fieldX + this.fieldW, 0);
    sheen.addColorStop(0, 'rgba(255,120,170,0)');
    sheen.addColorStop(0.5, `rgba(255,150,200,${0.05 + pulse * 0.04})`);
    sheen.addColorStop(1, 'rgba(255,120,170,0)');
    g.fillStyle = sheen; g.fillRect(this.fieldX - 40, hy, this.fieldW + 80, H - hy);
    g.strokeStyle = 'rgba(255,200,170,0.035)';
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const b = 0.15 + i * 0.27 + Math.sin(i * 7.3) * 0.08;
      g.beginPath(); g.moveTo(this.bx(b, hy), hy); g.lineTo(this.bx(b, H), H); g.stroke();
    }
    if (feverOn) {
      const fl = g.createLinearGradient(0, hy, 0, jy);
      fl.addColorStop(0, 'rgba(255,61,139,0)');
      fl.addColorStop(1, `rgba(255,140,190,${0.1 + pulse * 0.1})`);
      g.fillStyle = fl; g.fillRect(this.fieldX - 40, hy, this.fieldW + 80, jy - hy);
    }
    // the neck breathes with the beat; a chorus warms it up, the sakura storm turns it gold
    const fx = this.fx || {};
    // mixed into one colour so it costs a single fill
    let tr = 0, tgc = 0, tb = 0, ta = 0;
    for (const [r, gg, bb, a] of [[255, 120, 190, pulse * 0.06], [255, 70, 120, (fx.chorus || 0) * 0.2], [255, 196, 110, (fx.sakura || 0) * 0.16]]) {
      tr += r * a; tgc += gg * a; tb += bb * a; ta += a;
    }
    if (ta >= 0.004) {
      const c = `${Math.round(tr / ta)},${Math.round(tgc / ta)},${Math.round(tb / ta)}`, a = Math.min(0.4, ta);
      const tg = g.createLinearGradient(0, hy, 0, H);
      tg.addColorStop(0, `rgba(${c},0)`); tg.addColorStop(0.6, `rgba(${c},${a})`); tg.addColorStop(1, `rgba(${c},${a * 0.6})`);
      g.fillStyle = tg; g.fillRect(this.fieldX - 40, hy, this.fieldW + 80, H - hy);
    }
    g.restore();
  }

  // ---------- wide screens: the shamisen neck ----------
  // Lacquered dark wood running to the horizon; the three strings are the lane dividers, so notes slide
  // down *between* the strings and land in the four cells of the fingerboard grid at the judge line.
  drawNeck(t, now, dt, pulse) {
    const g = this.ctx;
    const { H } = this;
    const jy = this.judgeY, hy = this.horizonY, lw = this.laneW;
    const feverOn = this.char.inFever(now) && this.char.mode !== 'off';

    // neck body. 孤夜 dancing behind the neck shows through it: inside her silhouette (char.xrayMask) the
    // body is drawn on a small layer with the silhouette cut out; notes, strings and frets stay on top
    const xr = this.char.xrayMask(this);
    if (!xr) this.drawNeckBody(g, pulse, feverOn);
    else {
      g.save();
      g.beginPath(); g.rect(0, 0, this.W, H); g.rect(xr.x0, xr.y0, xr.bw, xr.bh); g.clip('evenodd');
      this.drawNeckBody(g, pulse, feverOn);
      g.restore();
      const dpr = this.dpr, ow = Math.ceil(xr.bw * dpr), oh = Math.ceil(xr.bh * dpr);
      const lc = this.xrLayer || (this.xrLayer = document.createElement('canvas'));
      if (lc.width < ow || lc.height < oh) { lc.width = Math.max(lc.width, ow); lc.height = Math.max(lc.height, oh); }
      const L = lc.getContext('2d');
      L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, ow, oh);
      L.setTransform(dpr, 0, 0, dpr, -xr.x0 * dpr, -xr.y0 * dpr);
      this.drawNeckBody(L, pulse, feverOn);
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.globalCompositeOperation = 'destination-out'; L.globalAlpha = xr.alpha;
      L.drawImage(xr.mask, 0, 0, xr.mw, xr.mh, 0, 0, Math.round(xr.mw * xr.M * dpr), Math.round(xr.mh * xr.M * dpr));
      L.globalCompositeOperation = 'source-over'; L.globalAlpha = 1;
      g.drawImage(lc, 0, 0, ow, oh, xr.x0, xr.y0, ow / dpr, oh / dpr);
    }

    // beat / bar lines: fret bars sliding down the neck
    const st = this.scrollPos(t);
    const zOf = time => (this.scrollPos(time) - st) / this.approach;
    if (this.beats.length) {
      let k = Math.max(0, upper(this.beats, t - 200) - 1);
      for (; k < this.beats.length; k++) {
        const z = zOf(this.beats[k]);
        if (z > 1.02) break;
        if (z < 0) continue;
        const y = this.yOfS(this.sOfZ(z));
        const bar = ((k - this.downbeat) % this.barBeats + this.barBeats) % this.barBeats === 0;
        const fade = Math.min(1, (1 - z) * 4);
        g.fillStyle = bar ? `rgba(255,220,190,${0.2 * fade})` : `rgba(255,220,190,${0.06 * fade})`;
        const x0 = this.bx(0, y), x1 = this.bx(4, y);
        g.fillRect(x0, Math.round(y), x1 - x0, bar ? 2 : 1);
      }
    }

    // beat ripples: a line of light pushed from the judge line toward the horizon on every beat,
    // brighter on the bar's first beat
    if (this.beats.length) {
      const k = upper(this.beats, t) - 1;
      for (let i = 0; i < 3 && k - i >= 0; i++) {
        const u = (t - this.beats[k - i]) / 1100;
        if (u >= 1 || u < 0) continue;
        const bar = ((k - i - this.downbeat) % this.barBeats + this.barBeats) % this.barBeats === 0;
        const y = this.yOfS(this.sOfZ(u * 0.9));
        g.strokeStyle = `rgba(255,215,240,${(1 - u) * (bar ? 0.55 : 0.22)})`;
        g.lineWidth = (bar ? 2.5 : 1.2) * this.sOfY(y) + 0.5;
        g.beginPath(); g.moveTo(this.bx(0, y), y); g.lineTo(this.bx(4, y), y); g.stroke();
      }
    }

    // key beams between the strings
    this.drawSpeedFx(g, t, now, zOf);
    for (let l = 0; l < 4; l++) {
      if (!this.keyDown[l]) this.beam[l] = Math.max(0, this.beam[l] - dt / 140);
      const b = this.keyDown[l] ? 1 : this.beam[l];
      if (b <= 0.01) continue;
      const top = jy - (jy - hy) * 0.55;
      const beam = g.createLinearGradient(0, top, 0, jy);
      beam.addColorStop(0, rgba(l, 0));
      beam.addColorStop(1, rgba(l, 0.24 * b));
      g.fillStyle = beam;
      this.neckPath(top, jy, l + 0.03, l + 0.97); g.fill();
    }

    // fingerboard grid at the bottom: a row of four cells on the judge line, more frets below it
    const cellH = this.noteH * 1.9;
    const cy0 = jy - cellH / 2, cy1 = jy + cellH / 2;
    g.fillStyle = 'rgba(8,4,8,0.5)';
    this.neckPath(cy0, H); g.fill();
    for (let l = 0; l < 4; l++) {
      this.receptorHit[l] = Math.max(0, this.receptorHit[l] - dt / 180);
      const down = this.keyDown[l];
      const a = down ? 0.34 : 0.05 + this.receptorHit[l] * 0.45;
      this.neckPath(cy0 + 2, cy1 - 2, l + 0.06, l + 0.94);
      g.fillStyle = rgba(l, a); g.fill();
      g.lineWidth = down ? 2 : 1.4;
      g.strokeStyle = rgba(l, down ? 0.95 : 0.45);
      g.stroke();
    }
    // fret bars: the cell row's edges, then smaller frets spaced in perspective toward the screen bottom
    g.fillStyle = 'rgba(232,200,140,0.75)';
    for (const y of [cy0, cy1]) { const x0 = this.bx(0, y); g.fillRect(x0, y - 1, this.bx(4, y) - x0, 2); }
    g.fillStyle = 'rgba(232,200,140,0.18)';
    for (let i = 1; i < 6; i++) {
      const y = cy1 + i * cellH * (1 + i * 0.15);
      if (y > H) break;
      const x0 = this.bx(0, y); g.fillRect(x0, y, this.bx(4, y) - x0, 1);
    }
    // 勘所-style inlay dots between the cells under the grid
    g.fillStyle = 'rgba(255,230,200,0.35)';
    for (let l = 0; l < 4; l++) {
      const y = cy1 + cellH * 0.9;
      if (y < H) { g.beginPath(); g.arc(this.bx(l + 0.5, y), y, 2.2, 0, Math.PI * 2); g.fill(); }
    }
    // key labels in the cells' lower half
    g.font = `600 12px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let l = 0; l < 4; l++) {
      const y = cy1 + 16;
      g.fillStyle = this.keyDown[l] ? LANE_COLORS[l] : 'rgba(255,255,255,0.3)';
      g.fillText(this.settings.keyLabels[l], this.bx(l + 0.5, y), y);
    }

    // neck edges: neon trim, brighter on the beat; thicker and hotter in a chorus, gold in the sakura storm
    const ch = this.fx.chorus, sk = this.fx.sakura;
    for (const [b, col] of [[0, sk > 0.5 ? '255,214,120' : '255,61,139'], [4, sk > 0.5 ? '255,160,200' : '63,212,255']]) {
      const eg = g.createLinearGradient(0, hy, 0, H);
      eg.addColorStop(0, `rgba(${col},${0.25 * ch})`);
      eg.addColorStop(0.7, `rgba(${col},${Math.min(1, 0.55 + pulse * 0.4 + ch * 0.3)})`);
      eg.addColorStop(1, `rgba(${col},${0.3 + ch * 0.3})`);
      g.strokeStyle = eg;
      g.lineWidth = 2 + ch * 1.5;
      g.beginPath(); g.moveTo(this.bx(b, hy), hy); g.lineTo(this.bx(b, H), H); g.stroke();
      g.globalAlpha = 0.22 + pulse * 0.25 + ch * 0.2;
      g.lineWidth = 7 + ch * 6;
      g.stroke();
      g.globalAlpha = 1;
    }
    // chorus: embers rising along both edges
    if (ch > 0.02 && this.char.cutinEnabled !== false) {
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const u = (now / 1100 + i / 14) % 1, y = H - u * (H - hy), sc = this.sOfY(y);
        for (const b of [0, 4]) {
          g.fillStyle = `rgba(255,${130 + (i * 9) % 90},90,${ch * (1 - u) * 0.85})`;
          g.beginPath(); g.arc(this.bx(b, y) + (b ? -3 : 3) * sc + Math.sin(now / 130 + i * 1.7 + b) * 3 * sc, y, 2.6 * sc + 0.8, 0, Math.PI * 2); g.fill();
        }
      }
      g.globalCompositeOperation = 'source-over';
    }

    // notes, between the strings
    this.drawNotesPersp(t, now, dt, zOf);

    // the three strings (silk), on top of the notes' edges; they ring when a neighbouring lane is hit.
    // Higher combo, livelier strings: 50 gold with a steady glow, 100 light pulses running up the
    // strings on every hit + overtones, 200 colours cycling and sparks shed along them.
    const tier = this.combo >= 200 ? 3 : this.combo >= 100 ? 2 : this.combo >= 50 ? 1 : 0;
    if (tier > (this.stringTier || 0)) this.strumAt = now;   // tier up: strum all three, left to right
    this.stringTier = tier;
    const strumAge = now - (this.strumAt ?? -1e9);
    const decay = Math.pow(0.0025, dt / 1000);
    const yTop = hy + 6, yBot = H, uj = (jy - yTop) / (yBot - yTop);
    const hue = (now * 0.12) % 360;
    const strCol = b => tier >= 3 ? `hsl(${(hue + b * 40) % 360},100%,82%)`
      : feverOn ? 'rgba(255,215,235,0.92)' : tier >= 1 ? 'rgba(255,224,150,0.92)' : 'rgba(250,240,225,0.78)';
    const glowCol = b => tier >= 3 ? `hsl(${(hue + b * 40) % 360},100%,62%)`
      : feverOn || tier >= 2 ? '#ff7ab8' : tier >= 1 ? '#ffc65a' : '#ffd9a8';
    for (let b = 1; b <= 3; b++) {
      const sweep = strumAge - (b - 1) * 70;
      if (sweep >= 0 && sweep < dt + 1) this.strings[b] = Math.max(this.strings[b], 1.3);
      this.strings[b] *= decay;
      const amp = this.strings[b] * (1 + tier * 0.3);
      g.strokeStyle = strCol(b);
      g.lineWidth = 1.6 + tier * 0.25;
      g.beginPath();
      const N = amp > 0.02 ? 28 : 1;
      const w = now * 0.09 + b;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const y = yTop + (yBot - yTop) * u;
        let d = 0;
        if (N > 1) {
          // plucked at the judge line: the bend peaks there (a soft triangle), not mid-string
          d = (u < uj ? Math.sin(Math.PI / 2 * u / uj) : Math.sin(Math.PI / 2 * (1 - u) / (1 - uj))) * Math.sin(w);
          if (tier >= 2) d += 0.35 * Math.sin(2 * Math.PI * u) * Math.sin(2 * w + 1);   // overtone
          d *= amp * 9 * this.sOfY(y);
        }
        const x = this.bx(b, y) + d;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      const glow = Math.max(amp > 0.02 ? Math.min(1, amp) * 0.5 : 0, tier >= 1 ? 0.12 + tier * 0.05 + pulse * 0.1 : 0);
      if (glow > 0.01) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = glow;
        g.lineWidth = 6 + tier * 1.5;
        g.strokeStyle = glowCol(b);
        g.stroke();
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    }
    // light pulses racing from the fingerboard up to the horizon (100+ combo)
    g.globalCompositeOperation = 'lighter';
    for (let i = this.stringPulses.length - 1; i >= 0; i--) {
      const p = this.stringPulses[i];
      const k = (now - p.at) / 420;
      if (k >= 1) { this.stringPulses.splice(i, 1); continue; }
      const head = jy - (jy - yTop) * (1 - Math.pow(1 - k, 2));
      const tail = Math.min(jy, head + (jy - yTop) * 0.22);
      const gr = g.createLinearGradient(0, head, 0, tail);
      const c = tier >= 3 ? `hsla(${(hue + p.b * 40) % 360},100%,70%,` : 'rgba(255,190,225,';
      gr.addColorStop(0, c + (1 - k) + ')'); gr.addColorStop(1, c + '0)');
      g.strokeStyle = gr;
      g.lineWidth = 4 * this.sOfY(head) + 1;
      g.beginPath(); g.moveTo(this.bx(p.b, head), head); g.lineTo(this.bx(p.b, tail), tail); g.stroke();
      g.fillStyle = `rgba(255,255,255,${1 - k})`;
      g.beginPath(); g.arc(this.bx(p.b, head), head, 2.5 * this.sOfY(head) + 1, 0, Math.PI * 2); g.fill();
    }
    // sparks shed along the strings (200+ combo)
    if (tier >= 3 && Math.random() < dt / 40) {
      const b = 1 + Math.floor(Math.random() * 3);
      const y = yTop + (jy - yTop) * (0.3 + Math.random() * 0.7);
      this.particles.push({ x: this.bx(b, y), y, vx: (Math.random() - 0.5) * 0.12, vy: -0.05 - Math.random() * 0.1, life: 0.9, decay: 0.0022, size: 1.2 + Math.random() * 1.6, lane: Math.min(3, b - (Math.random() < 0.5 ? 1 : 0)) });
    }
    g.globalCompositeOperation = 'source-over';

    // judge line across the cells
    const jl = g.createLinearGradient(this.fieldX, 0, this.fieldX + this.fieldW, 0);
    jl.addColorStop(0, 'rgba(255,255,255,0.2)');
    jl.addColorStop(0.5, `rgba(255,255,255,${0.6 + pulse * 0.25})`);
    jl.addColorStop(1, 'rgba(255,255,255,0.2)');
    g.fillStyle = jl;
    g.fillRect(this.fieldX, jy - 1, this.fieldW, 2);
  }

  drawNotesPersp(t, now, dt, zOf) {
    const g = this.ctx;
    const { H } = this;
    const jy = this.judgeY;
    const span = 0.84;                       // note width as a share of the space between strings
    const yz = z => this.yOfS(this.sOfZ(z));
    const zMin = -0.12;                      // just past the judge line
    this.drawSweeps(g, t, now, zOf, yz);
    for (let l = 0; l < 4; l++) {
      const list = this.laneNotes[l];
      for (let i = Math.max(0, this.laneHead[l] - 2); i < list.length; i++) {
        const n = list[i];
        const z = zOf(n.t);
        if (z > 1.05) break;
        if (n.state === 2 && !n.end) continue;
        if (n.path) {
          this.drawSlide(g, n, t, now, dt, zOf, yz, zMin);
          if (n.state !== 0 && n.state !== 3) continue;
        } else if (n.end) {
          const holdingNow = n.state === 1;
          if (n.state === 2 && n.tail === 1) continue;
          const zh = holdingNow ? 0 : Math.max(zMin, z);
          const zt = Math.min(1.05, zOf(n.end));
          if (zt > zh) {
            const yh = yz(zh), yt = yz(zt);
            const dead = n.state === 3 || n.tail === 2;
            const body = g.createLinearGradient(0, yt, 0, yh);
            const thin = this.noteStyle === 'glass' ? 0.5 : 1;
            body.addColorStop(0, dead ? 'rgba(120,120,140,0.1)' : rgba(l, (holdingNow ? 0.35 : 0.16) * thin));
            body.addColorStop(1, dead ? 'rgba(120,120,140,0.25)' : rgba(l, (holdingNow ? 0.75 : 0.42) * thin));
            g.fillStyle = body;
            const m = (1 - span * 0.72) / 2;
            this.neckPath(yt, yh, l + m, l + 1 - m); g.fill();
            if (!dead) this.holdTrim(g, l, yt, yh, m);
            if (holdingNow) {
              g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2;
              g.beginPath(); g.moveTo(this.bx(l + 0.5, yt), yt); g.lineTo(this.bx(l + 0.5, yh), yh); g.stroke();
              if (Math.random() < dt / 30) this.particles.push({ x: this.laneX(l) + (Math.random() - 0.5) * this.laneW * 0.5, y: jy, vx: (Math.random() - 0.5) * 0.08, vy: -0.25 - Math.random() * 0.3, life: 0.8, decay: 0.003, size: 1.5 + Math.random() * 2, lane: l });
              this.strings[l] = Math.max(this.strings[l], 0.35); this.strings[l + 1] = Math.max(this.strings[l + 1], 0.35);
            }
            g.fillStyle = dead ? 'rgba(150,150,170,0.4)' : rgba(l, 0.85);
            const capB = yt + 5 * this.sOfY(yt);
            this.neckPath(yt, capB, l + m, l + 1 - m); g.fill();
          }
          if (holdingNow) continue;
        }
        if (z < zMin - 0.1) continue;
        const s = this.sOfZ(Math.max(-0.4, z));
        const y = this.yOfS(s);
        if (y > H + 30) continue;
        const fade = Math.min(1, (1.05 - z) * 6);
        g.globalAlpha = (n.state === 3 ? 0.25 : 1) * fade;
        const sp = this.sprites[l];
        const kx = this.laneW * span / (this.laneW - 10);
        // 孤夜 on stage: notes leave afterimages, grow a little and get a white edge
        const mv = n.state === 3 ? 0 : this.fx.mv;
        if (mv > 0.02) {
          for (let k = 3; k >= 1; k--) {
            const zk = Math.max(-0.4, z) + k * 0.028, sk = this.sOfZ(zk), yk = this.yOfS(sk);
            g.globalAlpha = fade * mv * 0.18 * (4 - k) / 3;
            g.drawImage(sp.canvas, this.bx(l + 0.5, yk) - sp.w * sk * kx / 2, yk - sp.h * sk / 2, sp.w * sk * kx, sp.h * sk);
          }
          g.globalAlpha = (n.state === 3 ? 0.25 : 1) * fade;
        }
        const grow = 1 + 0.12 * mv;
        const w = sp.w * s * kx * grow, h = sp.h * s * grow;
        g.drawImage(sp.canvas, this.bx(l + 0.5, y) - w / 2, y - h / 2, w, h);
        if (mv > 0.02) {
          const nw2 = this.laneW * span * s * 0.8 * grow;
          g.fillStyle = `rgba(255,255,255,${0.85 * mv * fade})`;
          g.fillRect(this.bx(l + 0.5, y) - nw2 / 2, y + this.noteH * s * 0.62, nw2, Math.max(1, 1.6 * s));
        }
        g.globalAlpha = 1;
      }
    }
  }

  // ---------- gimmick notes ----------
  // slide: a ribbon that bends into the next lane just before each bend point, with an arrow-marked
  // head where the next key takes over. While held its core flows toward the player, and the lane it
  // bends into lights up with arrows on the judge line shortly before the bend.
  drawSlide(g, n, t, now, dt, zOf, yz, zMin) {
    if (n.state === 2 && n.tail === 1) return;
    const holdingNow = n.state === 1;
    const dead = n.state === 3 || n.tail === 2;
    const D = 110, jy = this.judgeY;
    const keys = [[n.t, n.lane]];
    let ln = n.lane;
    for (const p of n.path) { keys.push([p.t - D, ln], [p.t, p.lane]); ln = p.lane; }
    keys.push([n.end, ln]);
    const laneAt = time => {
      for (let i = 1; i < keys.length; i++) {
        if (time > keys[i][0]) continue;
        const [t0, l0] = keys[i - 1], [t1, l1] = keys[i];
        return l0 + (l1 - l0) * Math.max(0, Math.min(1, (time - t0) / Math.max(1, t1 - t0)));
      }
      return ln;
    };
    const t0 = holdingNow ? Math.max(n.t, t) : n.t;
    const ts = [t0];
    for (const [kt] of keys) if (kt > t0 && kt < n.end) ts.push(kt);
    for (let x = t0 + 24; x < n.end; x += 24) ts.push(x);
    ts.push(n.end);
    ts.sort((a, b) => a - b);
    const L = [], R = [], C = [];
    for (const time of ts) {
      let z = zOf(time);
      if (z > 1.05) break;
      z = Math.max(holdingNow ? 0 : zMin, z);
      const y = yz(z), s = this.sOfY(y), lp = laneAt(time);
      const cx = this.bx(lp + 0.5, y), hw = this.laneW * 0.3 * s;
      L.push([cx - hw, y]); R.push([cx + hw, y]); C.push([cx, y]);
    }
    if (C.length < 2) return;
    const poly = pts => { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); };
    g.beginPath(); poly(L);
    for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
    g.closePath();
    const yTop = C[C.length - 1][1], yBot = C[0][1];
    const body = g.createLinearGradient(0, yTop, 0, Math.max(yTop + 1, yBot));
    if (dead) { body.addColorStop(0, 'rgba(120,120,140,0.1)'); body.addColorStop(1, 'rgba(120,120,140,0.28)'); }
    else {
      body.addColorStop(0, 'rgba(122,60,255,0.2)');
      body.addColorStop(0.6, `rgba(170,110,255,${holdingNow ? 0.5 : 0.38})`);
      body.addColorStop(1, rgba(n.cur, holdingNow ? 0.8 : 0.55));
    }
    g.fillStyle = body; g.fill();
    if (!dead) {
      g.strokeStyle = 'rgba(225,205,255,0.85)'; g.lineWidth = 1.4;
      g.beginPath(); poly(L); g.stroke();
      g.beginPath(); poly(R); g.stroke();
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (holdingNow) {
        g.setLineDash([10, 12]); g.lineDashOffset = now * 0.3;
        g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3;
      } else { g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.6; }
      g.beginPath(); poly(C); g.stroke();
      g.restore();
    }
    // bend heads: the target lane's note with a double chevron pointing where the slide goes
    let prev = n.lane;
    for (let k = 0; k < n.path.length; k++) {
      const p = n.path[k], from = prev;
      prev = p.lane;
      if (k < n.seg || dead) continue;
      const z = zOf(p.t);
      if (z > 1.05 || z < zMin) continue;
      const s = this.sOfZ(z), y = this.yOfS(s), x = this.bx(p.lane + 0.5, y);
      const sp = this.sprites[p.lane], kx = this.laneW * 0.84 / (this.laneW - 10);
      const w = sp.w * s * kx * 0.8, h = sp.h * s * 0.8;
      g.drawImage(sp.canvas, x - w / 2, y - h / 2, w, h);
      this.chevrons(g, x, y, Math.sign(p.lane - from), 7 * s + 2, '#fff');
    }
    if (holdingNow) {
      const lx = C[0][0];
      if (Math.random() < dt / 25) this.particles.push({ x: lx + (Math.random() - 0.5) * this.laneW * 0.4, y: jy, vx: (Math.random() - 0.5) * 0.1, vy: -0.25 - Math.random() * 0.3, life: 0.8, decay: 0.003, size: 1.5 + Math.random() * 2, lane: n.cur });
      this.strings[n.cur] = Math.max(this.strings[n.cur], 0.35); this.strings[n.cur + 1] = Math.max(this.strings[n.cur + 1], 0.35);
      // the next bend is coming: light the cell it bends into and point at it
      const p = n.path[n.seg];
      if (p && p.t - t < 480 && p.t - t > -WINDOWS.good) {
        const blink = 0.5 + 0.5 * Math.sin(now / 45);
        const cellH = this.noteH * 1.9;
        this.neckPath(jy - cellH / 2 + 2, jy + cellH / 2 - 2, p.lane + 0.06, p.lane + 0.94);
        g.fillStyle = rgba(p.lane, 0.25 + 0.35 * blink); g.fill();
        const dir = Math.sign(p.lane - n.cur);
        for (let i = 0; i < 3; i++) {
          const u = ((now / 260) + i / 3) % 1;
          const xx = this.laneX(n.cur) + (this.laneX(p.lane) - this.laneX(n.cur)) * u;
          g.globalAlpha = Math.sin(Math.PI * u);
          this.chevrons(g, xx, jy, dir, 8, LANE_COLORS[p.lane]);
        }
        g.globalAlpha = 1;
      }
    }
  }

  chevrons(g, x, y, dir, r, color) {
    if (!dir) return;
    g.strokeStyle = color; g.lineWidth = Math.max(1.5, r * 0.32); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const off of [-0.45, 0.45]) {
      const cx = x + off * r * dir;
      g.beginPath(); g.moveTo(cx - r * 0.4 * dir, y - r * 0.6); g.lineTo(cx + r * 0.4 * dir, y); g.lineTo(cx - r * 0.4 * dir, y + r * 0.6); g.stroke();
    }
  }

  // sweep: a golden lightning ribbon joining the steps that are still to come, from the last one hit
  drawSweeps(g, t, now, zOf, yz) {
    if (!this.sweeps.size) return;
    const jy = this.judgeY;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const sw of this.sweeps.values()) {
      const ns = sw.notes;
      if (zOf(ns[0].t) > 1.05 || ns.every(x => x.state >= 2)) continue;
      const pts = ns.filter(x => x.state === 0).map(x => {
        const y = yz(Math.max(-0.1, zOf(x.t)));
        return [this.bx(x.lane + 0.5, y), y, this.sOfY(y)];
      });
      const lastHit = [...ns].reverse().find(x => x.state === 2);
      if (lastHit && pts.length) pts.unshift([this.bx(lastHit.lane + 0.5, jy), jy, 1]);
      if (pts.length < 2) continue;
      const s = pts.reduce((a, p) => a + p[2], 0) / pts.length;
      const fade = Math.min(1, (1.05 - zOf(ns[0].t)) * 5);
      const path = () => {
        g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
        // a little zigzag between steps: lightning, not a ruler line
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          const j = Math.sin(now / 40 + i * 2.1) * 4 * s;
          g.lineTo((x0 + x1) / 2 + j, (y0 + y1) / 2 - j * 0.5);
          g.lineTo(x1, y1);
        }
      };
      path();
      g.globalAlpha = fade * (sw.missed ? 0.25 : 0.4 + 0.2 * Math.sin(now / 70));
      g.strokeStyle = sw.missed ? '#8888aa' : '#ffb84a'; g.lineWidth = 12 * s;
      g.stroke();
      g.globalAlpha = fade * (sw.missed ? 0.4 : 0.95);
      g.strokeStyle = sw.missed ? '#aaaacc' : '#fff3c8'; g.lineWidth = 2.6 * s + 0.6;
      g.stroke();
      // a gold diamond halo behind every step to come
      if (!sw.missed) for (const [x, y, ps] of pts.slice(lastHit ? 1 : 0)) {
        const d = this.laneW * 0.36 * ps;
        g.globalAlpha = fade * 0.9;
        g.strokeStyle = '#ffd36a'; g.lineWidth = 2 * ps + 0.5;
        g.beginPath(); g.moveTo(x, y - d * 0.6); g.lineTo(x + d, y); g.lineTo(x, y + d * 0.6); g.lineTo(x - d, y); g.closePath(); g.stroke();
      }
    }
    g.restore();
  }

  // scroll-speed changes: a coloured gate on the neck with the new speed written beside it, streaks of
  // wind while fast, a cool tint while slow
  drawSpeedFx(g, t, now, zOf) {
    if (!this.scroll) return;
    const jy = this.judgeY, hy = this.horizonY;
    const yz = z => this.yOfS(this.sOfZ(z));
    g.save();
    for (const m of this.speedMarks) {
      const z = zOf(m.t);
      if (z < 0) continue;
      if (z > 1.02) break;
      const y = yz(z), s = this.sOfY(y);
      const col = m.up ? '255,110,70' : '80,200,255';
      const fade = Math.min(1, (1 - z) * 4);
      const x0 = this.bx(0, y), x1 = this.bx(4, y);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(${col},${0.3 * fade})`; g.fillRect(x0, y - 6 * s, x1 - x0, 12 * s);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(${col},${0.9 * fade})`; g.fillRect(x0, y - 1.5 * s, x1 - x0, 3 * s);
      g.font = `italic 900 ${Math.round(9 + 7 * s)}px ${FONT}`;
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = `rgba(${col},${fade})`;
      g.fillText(`${m.up ? '▲' : '▼'} ×${m.x.toFixed(1)}`, x1 + 6 * s, y);
    }
    const x = this.speedAt(t);
    if (x > 1.12) {
      const a = Math.min(1, (x - 1) / 0.5);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 16; i++) {
        const b = 0.15 + ((i * 0.618) % 1) * 3.7;
        const u = (now * x / 650 + i * 0.137) % 1;
        const z0 = 1 - u, z1 = Math.max(-0.1, z0 - 0.2);
        const y0 = yz(z0), y1 = yz(z1);
        const gr = g.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(0, 'rgba(255,200,170,0)'); gr.addColorStop(1, `rgba(255,225,205,${0.5 * a})`);
        g.strokeStyle = gr; g.lineWidth = 1 + 1.6 * this.sOfY(y1);
        g.beginPath(); g.moveTo(this.bx(b, y0), y0); g.lineTo(this.bx(b, y1), y1); g.stroke();
      }
    } else if (x < 0.88) {
      const a = Math.min(1, (1 - x) / 0.5);
      g.globalCompositeOperation = 'lighter';
      this.neckPath(hy, jy, 0, 4, g);
      g.fillStyle = `rgba(60,140,255,${a * (0.09 + 0.04 * Math.sin(now / 320))})`; g.fill();
    }
    g.restore();
  }

  // state of the in-play effects, eased every frame. fx.mv: 孤夜's dance on stage; chorus: inside a
  // loud section (findChorus); sakura: 100+ combo (the blossom storm); cam: 50+ combo (camera motion).
  // 輕量 (cutin off) keeps the cheap ones (beat ripples, pillars, milestones, camera) only.
  updateFx(t, dt) {
    const f = this.fx, rich = this.char.cutinEnabled !== false && this.char.mode !== 'off';
    const ease = (v, goal, ms) => { const n = v + (goal - v) * Math.min(1, dt / ms); return Math.abs(n - goal) < 0.003 ? goal : n; };
    f.mv = rich ? (this.char.stageA || 0) : 0;
    const inC = this.chorus.some(([a, b]) => t >= a && t < b);
    if (inC && !f.inChorus) { f.chorusAt = t; f.chorusN++; }
    f.inChorus = inC;
    f.chorus = ease(f.chorus, inC && rich ? 1 : 0, inC ? 500 : 900);
    f.sakura = ease(f.sakura, rich && this.combo >= 100 ? 1 : 0, this.combo >= 100 ? 600 : 250);
    f.cam = ease(f.cam, this.combo >= 50 ? 1 : 0, 400);
  }

  // 50+ combo: the neck kicks a little on the beat (more on the bar) and leans briefly as a chorus
  // starts. Anchored on the judge line's centre, so where the notes are hit barely moves.
  camTransform(g, t, pulse, isBar) {
    const f = this.fx;
    if (f.cam < 0.01) return false;
    const kick = pulse * (isBar ? 0.028 : 0.012) * f.cam;
    const u = (t - f.chorusAt) / 1600;
    const tilt = u >= 0 && u < 1 ? Math.sin(Math.PI * u) * 0.03 * (f.chorusN % 2 ? 1 : -1) * f.cam : 0;
    const cx = this.centerX, cy = this.judgeY;
    g.save();
    g.translate(cx, cy); g.rotate(tilt); g.scale(1 + kick, 1 + kick); g.translate(-cx, -cy);
    return true;
  }

  // 100+ combo: blossoms drifting down the whole screen
  drawSakura(g, now) {
    const a = this.fx.sakura;
    if (a < 0.01 || !PETAL) return;
    const n = this.arcs ? 30 : 18;
    for (let i = 0; i < n; i++) {
      const per = 5200 + (i * 397) % 2600;
      const u = (now / per + i * 0.37) % 1;
      const x = ((i * 0.618) % 1) * this.W + Math.sin(now / 900 + i) * 24;
      const y = -20 + u * (this.H + 40);
      const sz = (14 + (i * 7) % 12) * (this.arcs ? 1.2 : 1);
      g.globalAlpha = a * 0.85 * Math.min(1, u * 8, (1 - u) * 8);
      g.save(); g.translate(x, y); g.rotate(now / 700 * (i % 2 ? 1 : -1) + i);
      g.drawImage(PETAL, -sz / 2, -sz / 2, sz, sz);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // the hold body's edges, per note style: gold (bachi), white (slab), the lane colour (glass),
  // blossoms along the middle (sakura)
  holdTrim(g, l, yt, yh, m) {
    const st = this.noteStyle;
    if (st === 'sakura') {
      const step = 0.1, zOfY = y => (1 / this.sOfY(y) - 1) / (1 / this.farRatio - 1);
      const z0 = zOfY(yh), z1 = zOfY(yt);
      for (let z = Math.ceil(z0 / step) * step + step / 2; z < z1; z += step) {
        const y = this.yOfS(this.sOfZ(z)), s = this.sOfY(y);
        blossom(g, this.bx(l + 0.5, y), y, this.laneW * 0.07 * s, 'rgba(255,255,255,0.5)');
      }
      return;
    }
    g.strokeStyle = st === 'bachi' ? 'rgba(232,194,106,0.9)' : st === 'slab' ? 'rgba(255,255,255,0.7)' : LANE_COLORS[l];
    g.lineWidth = st === 'glass' ? 1.6 : 1.2;
    for (const b of [l + m, l + 1 - m]) { g.beginPath(); g.moveTo(this.bx(b, yt), yt); g.lineTo(this.bx(b, yh), yh); g.stroke(); }
  }

  // ---------- narrow screens: the flat 4-lane field ----------
  drawFlatField(t, now, dt, pulse) {
    const g = this.ctx;
    const { H } = this;
    const fx = this.fieldX, fw = this.fieldW, lw = this.laneW, jy = this.judgeY;
    if (this.char.mode !== 'off') {
      // opaque-ish lane backing so the art never hurts note readability
      g.fillStyle = this.char.mode === 'side' ? 'rgba(6,5,13,0.86)' : 'rgba(6,5,13,0.62)';
      g.fillRect(fx, 0, fw, H);
    }
    const field = g.createLinearGradient(0, 0, 0, H);
    field.addColorStop(0, 'rgba(255,255,255,0.01)');
    field.addColorStop(0.85, 'rgba(255,255,255,0.045)');
    g.fillStyle = field;
    g.fillRect(fx, 0, fw, H);
    const feverOn = this.char.inFever(now) && this.char.mode !== 'off';
    if (feverOn) {
      const fl = g.createLinearGradient(0, 0, 0, jy);
      fl.addColorStop(0, 'rgba(255,61,139,0)');
      fl.addColorStop(1, `rgba(255,140,190,${0.08 + pulse * 0.08})`);
      g.fillStyle = fl;
      g.fillRect(fx, 0, fw, jy);
    }
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 1; i < 4; i++) g.fillRect(Math.round(fx + i * lw) - 0.5, 0, 1, H);
    // neon field edges, brighter on the beat
    for (const [ex, col] of [[fx, '255,61,139'], [fx + fw, '63,212,255']]) {
      const eg = g.createLinearGradient(0, 0, 0, H);
      eg.addColorStop(0, `rgba(${col},0)`);
      eg.addColorStop(0.75, `rgba(${col},${0.5 + pulse * 0.4})`);
      eg.addColorStop(1, `rgba(${col},0.2)`);
      g.fillStyle = eg;
      g.fillRect(ex - 1, 0, 2, H);
      g.globalAlpha = 0.25 + pulse * 0.25;
      g.fillRect(ex - 4, 0, 8, H);
      g.globalAlpha = 1;
    }

    const pxPerMs = (jy + 30) / this.approach;
    const st = this.scrollPos(t);
    const yOf = time => jy - (this.scrollPos(time) - st) * pxPerMs;

    // beat / bar lines
    if (this.beats.length) {
      let k = Math.max(0, upper(this.beats, t - 200) - 1);
      for (; k < this.beats.length; k++) {
        const y = yOf(this.beats[k]);
        if (y < -10) break;
        if (y > jy) continue;
        const bar = ((k - this.downbeat) % this.barBeats + this.barBeats) % this.barBeats === 0;
        g.fillStyle = bar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
        g.fillRect(fx, Math.round(y), fw, bar ? 2 : 1);
      }
    }

    // key beams
    for (let l = 0; l < 4; l++) {
      if (!this.keyDown[l]) this.beam[l] = Math.max(0, this.beam[l] - dt / 140);
      const b = this.keyDown[l] ? 1 : this.beam[l];
      if (b <= 0.01) continue;
      const beam = g.createLinearGradient(0, jy - H * 0.45, 0, jy);
      beam.addColorStop(0, rgba(l, 0));
      beam.addColorStop(1, rgba(l, 0.22 * b));
      g.fillStyle = beam;
      g.fillRect(fx + l * lw + 1, jy - H * 0.45, lw - 2, H * 0.45);
    }

    // notes
    const nw = lw - 10, nh = this.noteH;
    for (let l = 0; l < 4; l++) {
      const list = this.laneNotes[l];
      const x = this.laneX(l);
      for (let i = Math.max(0, this.laneHead[l] - 2); i < list.length; i++) {
        const n = list[i];
        if (yOf(n.t) < -60) break;
        if (n.state === 2 && !n.end) continue;
        if (n.end) {
          const holdingNow = n.state === 1;
          if (n.state === 2 && n.tail === 1) continue;
          const headY = holdingNow ? jy : yOf(n.t);
          const tailY = yOf(n.end);
          if (headY < -20) continue;
          const top = Math.max(-20, tailY), bot = Math.min(H + 20, headY);
          if (bot > top) {
            const dead = n.state === 3 || n.tail === 2;
            const body = g.createLinearGradient(0, top, 0, bot);
            body.addColorStop(0, dead ? 'rgba(120,120,140,0.12)' : rgba(l, holdingNow ? 0.35 : 0.18));
            body.addColorStop(1, dead ? 'rgba(120,120,140,0.25)' : rgba(l, holdingNow ? 0.75 : 0.42));
            g.fillStyle = body;
            g.beginPath(); g.roundRect(x - nw * 0.36, top, nw * 0.72, bot - top, 6); g.fill();
            if (holdingNow) {
              g.fillStyle = 'rgba(255,255,255,0.5)';
              g.fillRect(x - 1.5, top, 3, bot - top);
              if (Math.random() < dt / 30) this.particles.push({ x: x + (Math.random() - 0.5) * nw * 0.6, y: jy, vx: (Math.random() - 0.5) * 0.08, vy: -0.25 - Math.random() * 0.3, life: 0.8, decay: 0.003, size: 1.5 + Math.random() * 2, lane: l });
            }
            // tail cap
            g.fillStyle = dead ? 'rgba(150,150,170,0.4)' : rgba(l, 0.85);
            g.beginPath(); g.roundRect(x - nw * 0.36, top, nw * 0.72, 6, 3); g.fill();
          }
          if (holdingNow) continue;
        }
        if (n.state === 3) {
          const y = yOf(n.t);
          if (y > H + 30) continue;
          g.globalAlpha = 0.25;
          this.drawHead(l, x, y, nw, nh);
          g.globalAlpha = 1;
          continue;
        }
        const y = yOf(n.t);
        if (y < -40 || y > H + 40) continue;
        this.drawHead(l, x, y, nw, nh);
      }
    }

    // judge line + receptors
    const jl = g.createLinearGradient(fx, 0, fx + fw, 0);
    jl.addColorStop(0, 'rgba(255,255,255,0.15)');
    jl.addColorStop(0.5, `rgba(255,255,255,${0.55 + pulse * 0.25})`);
    jl.addColorStop(1, 'rgba(255,255,255,0.15)');
    g.fillStyle = jl;
    g.fillRect(fx, jy - 1.5, fw, 3);
    for (let l = 0; l < 4; l++) {
      const x = this.laneX(l);
      this.receptorHit[l] = Math.max(0, this.receptorHit[l] - dt / 180);
      const down = this.keyDown[l];
      const s = down ? 0.92 : 1;
      const rw = nw * s, rh = nh * s;
      g.lineWidth = 2;
      g.strokeStyle = rgba(l, down ? 0.95 : 0.4);
      g.fillStyle = rgba(l, down ? 0.28 : 0.06 + this.receptorHit[l] * 0.4);
      g.beginPath(); g.roundRect(x - rw / 2, jy - rh / 2, rw, rh, rh / 2.6); g.fill(); g.stroke();
      g.fillStyle = down ? LANE_COLORS[l] : 'rgba(255,255,255,0.28)';
      g.font = `600 12px ${FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(this.settings.keyLabels[l], x, jy + nh / 2 + 18);
    }

  }

  drawHead(l, x, y, nw, nh) {
    const s = this.sprites[l];
    this.ctx.drawImage(s.canvas, x - s.w / 2, y - s.h / 2, s.w, s.h);
  }

  // wide screens: two elliptical arc gauges hugging the neck. Left: combo + FEVER, right: score + HP.
  drawArcs(t, now, dt) {
    const g = this.ctx;
    const jy = this.judgeY, cx = this.centerX;
    const rx = this.fieldW / 2 + Math.min(80, this.W * 0.05);
    const ry = (jy - this.horizonY) * 0.45;
    const cy = jy - ry * 0.25;
    const bot = Math.asin(0.25), top = Math.asin(0.75), span = bot + top;
    const fever = this.char.mode !== 'off';
    const inFever = fever && this.char.inFever(now);
    const lv = fever ? this.char.feverLevel(now) : Math.max(0, Math.min(1, t / this.endMs));
    const segs = 12, gap = 0.005;
    const ang = (side, u) => side < 0 ? Math.PI - bot + u * span : bot - u * span;
    const pt = (side, u, out = 0) => {
      const a = ang(side, u);
      return [cx + (rx + out) * Math.cos(a), cy + (ry + out) * Math.sin(a)];
    };
    const arc = (side, u0, u1) => {
      const a0 = ang(side, u0), a1 = ang(side, u1);
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, a0, a1, side > 0);
    };
    const gauge = (side, v, colorAt, pulseOn) => {
      g.lineWidth = 12; g.lineCap = 'butt';
      for (let i = 0; i < segs; i++) {
        const u0 = i / segs + gap, u1 = (i + 1) / segs - gap;
        arc(side, u0, u1);
        g.strokeStyle = 'rgba(255,255,255,0.08)'; g.stroke();
        const f = Math.max(0, Math.min(1, v * segs - i));
        if (f <= 0) continue;
        arc(side, u0, u0 + (u1 - u0) * f);
        g.globalAlpha = pulseOn ? 0.65 + 0.35 * Math.sin(now * 0.02) : 1;
        g.strokeStyle = colorAt(i / segs); g.stroke();
        g.globalAlpha = 1;
      }
      // thin outer rail
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.ellipse(cx, cy, rx + 11, ry + 11, 0, ang(side, 0), ang(side, 1), side > 0); g.stroke();
    };
    g.save();
    // left: FEVER (or song progress when 孤夜 is off)
    const fcol = u => u < 0.5 ? '#ff3d8b' : u < 0.8 ? '#b04dff' : '#3fd4ff';
    gauge(-1, lv, fcol, inFever);
    // right: HP
    const hpCol = this.hp > 50 ? '#5dffa8' : this.hp > 25 ? '#ffcb47' : '#ff4d5e';
    gauge(1, this.hp / 100, () => hpCol, this.hp <= 25);

    // end labels
    g.font = `italic 900 10px ${FONT}`;
    g.textBaseline = 'middle';
    let [lx, ly] = pt(-1, 1, 4);
    g.textAlign = 'right';
    g.fillStyle = inFever ? '#ff7ab8' : 'rgba(255,255,255,0.45)';
    g.fillText(fever ? 'FEVER' : 'PROGRESS', lx - 6, ly - 8);
    [lx, ly] = pt(1, 1, 4);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText('LIFE', lx + 6, ly - 8);

    // combo, outside the left arc
    const [ax, ay] = pt(-1, 0.42, 22);
    if (this.combo >= 3 && t <= this.lastNoteMs + 250) {
      this.comboPop = Math.max(0, this.comboPop - dt / 120);
      const s = 1 + this.comboPop * 0.16;
      const gold = this.combo >= 100;
      g.save();
      g.translate(ax, ay);
      g.transform(1, 0, -0.14, 1, 0, 0);
      g.shadowColor = 'rgba(6,5,13,0.75)'; g.shadowBlur = 14;
      g.scale(s, s);
      g.textAlign = 'right';
      const fs = Math.round(Math.min(60, this.H * 0.07));
      g.font = `italic 900 ${fs}px ${FONT}`;
      g.fillStyle = gold ? 'rgba(255,140,60,0.75)' : 'rgba(255,61,139,0.8)';
      g.fillText(this.combo, 4, 4);
      const cg = g.createLinearGradient(0, -fs / 2, 0, fs / 2);
      cg.addColorStop(0, '#fff'); cg.addColorStop(1, gold ? '#ffe27a' : '#ffd0e6');
      g.fillStyle = cg;
      g.fillText(this.combo, 0, 0);
      g.font = `italic 900 12px ${FONT}`;
      g.fillStyle = gold ? '#ffe27a' : '#ff7ab8';
      g.fillText('C O M B O', -2, fs * 0.62);
      g.restore();
    }

    // score + accuracy, outside the right arc
    const [bx2, by2] = pt(1, 0.42, 22);
    g.save();
    g.translate(bx2, by2);
    g.transform(1, 0, -0.14, 1, 0, 0);
    g.shadowColor = 'rgba(6,5,13,0.75)'; g.shadowBlur = 14;
    g.textAlign = 'left';
    const ss = Math.round(Math.min(36, this.H * 0.042));
    g.font = `italic 900 ${ss}px ${FONT}`;
    g.fillStyle = 'rgba(63,212,255,0.55)';
    const sc = Math.round(this.displayScore).toString().padStart(7, '0');
    g.fillText(sc, 3, 3);
    g.fillStyle = '#fff';
    g.fillText(sc, 0, 0);
    g.font = `italic 900 11px ${FONT}`;
    g.fillStyle = '#7fe3ff';
    g.fillText('S C O R E', 2, ss * 0.72);
    g.font = `italic 800 13px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.fillText((this.accuracy() * 100).toFixed(2) + '%', 2, ss * 0.72 + 18);
    g.restore();
    g.restore();
  }

  // wide screens: a slanted panel in the empty space left of the neck (mirrors 孤夜's card on the right):
  // song title, difficulty and the judgement counts so far
  drawSidePanel() {
    const g = this.ctx;
    const { W, H } = this;
    const x = Math.max(28, W * 0.035), y = Math.max(56, H * 0.08);
    const pw = Math.round(Math.max(190, Math.min(250, W * 0.13)));
    const rows = [...TIERS, MISS];
    const rh = 22, ph = 64 + rows.length * rh + 26;
    const cut = 14;
    g.save();
    g.fillStyle = 'rgba(11,7,22,0.6)';
    g.beginPath(); g.moveTo(x + cut, y); g.lineTo(x + pw, y); g.lineTo(x + pw - cut, y + ph); g.lineTo(x, y + ph); g.closePath(); g.fill();
    g.fillStyle = '#ff3d8b';
    g.beginPath(); g.moveTo(x + cut, y); g.lineTo(x + cut + 4, y); g.lineTo(x + 4, y + ph); g.lineTo(x, y + ph); g.closePath(); g.fill();
    const ix = x + 24, iw = pw - 48;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = `italic 900 18px ${FONT}`;
    g.fillText(this.title, ix, y + 24, iw);
    g.fillStyle = DIFF_HUD[this.difficulty] || '#fff';
    g.font = `italic 900 11px ${FONT}`;
    g.fillText(this.difficulty.toUpperCase(), ix, y + 46);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(ix, y + 58, iw, 1);
    rows.forEach((r, i) => {
      const ry = y + 72 + i * rh;
      g.textAlign = 'left'; g.fillStyle = r.color; g.font = `italic 900 11px ${FONT}`;
      g.fillText(r.label, ix - i * 1.5, ry);
      g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = `italic 800 15px ${FONT}`;
      g.fillText(String(this.counts[r.key]), ix + iw - i * 1.5, ry);
    });
    const my = y + 72 + rows.length * rh + 4;
    g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = `italic 900 10px ${FONT}`;
    g.fillText('MAX COMBO', ix - rows.length * 1.5, my);
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = `italic 800 15px ${FONT}`;
    g.fillText(String(this.maxCombo), ix + iw - rows.length * 1.5, my);
    g.restore();
  }

  drawHUD(t, now, dt) {
    const g = this.ctx;
    const { W, H } = this;
    const jy = this.judgeY;
    g.textBaseline = 'middle';

    // combo: slanted italic numerals with a pink offset shadow; gold from 100
    if (this.arcs) this.drawArcs(t, now, dt);
    else if (this.combo >= 3 && t <= this.lastNoteMs + 250) {
      this.comboPop = Math.max(0, this.comboPop - dt / 120);
      const s = 1 + this.comboPop * 0.16;
      const gold = this.combo >= 100;
      g.save();
      g.translate(this.centerX, H * 0.36);
      g.transform(1, 0, -0.14, 1, 0, 0);
      g.scale(s, s);
      g.textAlign = 'center';
      g.font = `italic 900 58px ${FONT}`;
      g.fillStyle = gold ? 'rgba(255,140,60,0.75)' : 'rgba(255,61,139,0.8)';
      g.fillText(this.combo, 4, 4);
      const cg = g.createLinearGradient(0, -26, 0, 24);
      cg.addColorStop(0, '#fff'); cg.addColorStop(1, gold ? '#ffe27a' : '#ffd0e6');
      g.fillStyle = cg;
      g.fillText(this.combo, 0, 0);
      g.font = `italic 900 12px ${FONT}`;
      g.fillStyle = gold ? '#ffe27a' : '#ff7ab8';
      g.fillText('C O M B O', 0, 38);
      g.restore();
    }
    // milestone flash every 50 combo
    if (this.combo > 0 && this.combo % 50 === 0 && this.lastMilestone !== this.combo) {
      this.lastMilestone = this.combo;
      this.effects.push({ type: 'milestone', time: now, combo: this.combo });
      this.strumAt = now;   // all three strings ring
    }

    // judgement text: slides in from the side, italic, colored offset
    const j = this.lastJudge;
    if (j) {
      const age = now - j.time;
      if (age < 600) {
        const miss = j.tier.key === 'miss';
        const inK = Math.min(1, age / 110), ease = 1 - Math.pow(1 - inK, 3);
        const a = age < 420 ? 1 : 1 - (age - 420) / 180;
        g.save();
        g.globalAlpha = a;
        // hits are stamped: in at 1.6x, a slight overshoot below 1, then settled; a miss slides in
        const slide = miss ? (1 - ease) * -26 : 0;
        g.translate(this.centerX + slide, this.arcs ? jy - this.noteH * 3.4 : H * 0.36 + 72);
        g.transform(1, 0, -0.2, 1, 0, 0);
        const pop = miss ? 1.2 - ease * 0.2 : age < 70 ? 1.6 - 0.7 * (age / 70) : age < 140 ? 0.9 + 0.1 * ((age - 70) / 70) : 1;
        g.scale(pop, pop);
        g.textAlign = 'center';
        g.font = `italic 900 28px ${FONT}`;
        g.fillStyle = miss ? 'rgba(80,0,20,0.8)' : 'rgba(30,10,60,0.8)';
        g.fillText(j.tier.label, 3, 3);
        if (j.tier.key === 'perfect') {
          const pg = g.createLinearGradient(-70, 0, 70, 0);
          pg.addColorStop(0, '#ffe27a'); pg.addColorStop(0.5, '#fff'); pg.addColorStop(1, '#ff9ad0');
          g.fillStyle = pg;
        } else g.fillStyle = j.tier.color;
        g.fillText(j.tier.label, 0, 0);
        const sh = (age - 90) / 260;
        if (!miss && j.tier.key !== 'good' && sh > 0 && sh < 1) {
          // shine: a white band crossing the letters, clipped to them by source-atop
          const tw = g.measureText(j.tier.label).width, bx0 = -tw / 2 - 20 + sh * (tw + 40);
          const sg = g.createLinearGradient(bx0 - 14, -12, bx0 + 14, 12);
          sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.95)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
          g.globalCompositeOperation = 'source-atop';
          g.fillStyle = sg; g.fillText(j.tier.label, 0, 0);
          g.globalCompositeOperation = 'source-over';
        }
        if (this.settings.showTiming && j.diff != null && j.tier.key !== 'perfect' && !miss) {
          g.font = `italic 800 11px ${FONT}`;
          g.fillStyle = j.diff < 0 ? '#5ab8ff' : '#ff9a5a';
          g.fillText(`${j.diff < 0 ? 'FAST' : 'SLOW'}`, 0, 22);
        }
        g.restore();
      }
    }

    // hit error bar
    const cx = this.centerX;
    const barW = Math.min(220, this.fieldW * 0.6), bx = cx - barW / 2, by = jy + this.noteH * (this.persp ? 0.95 : 0.5) + (this.persp ? 38 : 40);
    const scale = barW / 2 / WINDOWS.good;
    g.fillStyle = 'rgba(90,184,255,0.22)'; g.fillRect(bx, by - 2, barW, 4);
    g.fillStyle = 'rgba(93,255,168,0.3)'; g.fillRect(cx - WINDOWS.great * scale, by - 2, WINDOWS.great * 2 * scale, 4);
    g.fillStyle = 'rgba(255,224,102,0.45)'; g.fillRect(cx - WINDOWS.perfect * scale, by - 2, WINDOWS.perfect * 2 * scale, 4);
    for (const tk of this.errTicks) {
      const age = now - tk.time;
      if (age > 3000) continue;
      g.globalAlpha = 1 - age / 3000;
      g.fillStyle = tk.color;
      g.fillRect(cx + Math.max(-1, Math.min(1, tk.diff / WINDOWS.good)) * barW / 2 - 1, by - 7, 2, 14);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#fff';
    g.beginPath();
    const mx = cx + Math.max(-1, Math.min(1, this.meanErr / WINDOWS.good)) * barW / 2;
    g.moveTo(mx, by - 9); g.lineTo(mx - 4, by - 15); g.lineTo(mx + 4, by - 15); g.fill();

    // score / accuracy: italic numerals on a slanted plate
    const target = this.score();
    this.displayScore += (target - this.displayScore) * Math.min(1, dt / 80);
    const narrow = W < 520;
    const plateW = narrow ? 128 : 178;
    g.save();
    if (this.arcs) g.globalAlpha = 0;   // wide screens: score lives on the right arc
    g.fillStyle = 'rgba(11,7,22,0.55)';
    g.beginPath(); g.moveTo(W - plateW, 8); g.lineTo(W, 8); g.lineTo(W, 60); g.lineTo(W - plateW - 14, 60); g.closePath(); g.fill();
    g.textAlign = 'right';
    g.fillStyle = '#fff';
    g.font = `italic 900 ${narrow ? 20 : 26}px ${FONT}`;
    g.fillText(Math.round(this.displayScore).toString().padStart(7, '0'), W - 14, 28);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = `italic 800 12px ${FONT}`;
    g.fillText((this.accuracy() * 100).toFixed(2) + '%', W - 14, 49);
    g.restore();

    // hp: slanted segmented gauge
    const hpW = narrow ? 96 : 130, hx = 60, hy = 20;
    const segs = 12, sw = hpW / segs;
    const hpCol = this.hp > 50 ? '#5dffa8' : this.hp > 25 ? '#ffcb47' : '#ff4d5e';
    const lit = this.hp / 100 * segs;
    for (let i = 0; i < (this.arcs ? 0 : segs); i++) {
      const x = hx + i * sw;
      const f = Math.max(0, Math.min(1, lit - i));
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.beginPath(); g.moveTo(x + 3, hy); g.lineTo(x + sw - 1, hy); g.lineTo(x + sw - 4, hy + 8); g.lineTo(x, hy + 8); g.closePath(); g.fill();
      if (f > 0) {
        g.globalAlpha = f * (this.hp <= 25 ? 0.6 + 0.4 * Math.sin(now / 90) : 1);
        g.fillStyle = hpCol; g.fill();
        g.globalAlpha = 1;
      }
    }
    if (this.arcs) this.drawSidePanel();   // wide screens: title + live judgements in the top-left
    else {
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = `italic 800 11px ${FONT}`;
      g.fillText(this.title, hx, hy + 24);
      g.fillStyle = DIFF_HUD[this.difficulty] || '#fff';
      g.font = `italic 900 10px ${FONT}`;
      g.fillText(this.difficulty.toUpperCase(), hx, hy + 39);
    }

    // progress
    const prog = Math.max(0, Math.min(1, t / this.endMs));
    // current scroll speed while it is off x1.0
    if (this.scroll) {
      const sx = this.speedAt(t);
      if (Math.abs(sx - 1) > 0.04) {
        g.save();
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.translate(cx, Math.max(14, this.horizonY - 12));
        g.transform(1, 0, -0.18, 1, 0, 0);
        g.font = `italic 900 14px ${FONT}`;
        g.fillStyle = sx > 1 ? '#ff8a5a' : '#6fd0ff';
        g.fillText(`${sx > 1 ? '▲' : '▼'} SPEED ×${sx.toFixed(2)}`, 0, 0);
        g.restore();
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, H - 3, W, 3);
    const pg = g.createLinearGradient(0, 0, W, 0);
    pg.addColorStop(0, '#ff6fd8'); pg.addColorStop(1, '#6a5cff');
    g.fillStyle = pg; g.fillRect(0, H - 3, W * prog, 3);

    // intro: song title card slides across on a slanted band, then the countdown
    if (t < 0) {
      const since = now - (this.startPerf || now);
      if (since < 1900) {
        const k = since / 1900;
        const slide = k < 0.18 ? 1 - Math.pow(1 - k / 0.18, 3) : k > 0.82 ? 1 + Math.pow((k - 0.82) / 0.18, 3) : 1;
        const y = H < 500 ? H * 0.2 : H * 0.3;
        g.save();
        g.translate((slide - 1) * W, 0);
        g.fillStyle = 'rgba(255,61,139,0.92)';
        g.beginPath(); g.moveTo(0, y - 34); g.lineTo(W, y - 46); g.lineTo(W, y + 30); g.lineTo(0, y + 42); g.closePath(); g.fill();
        g.fillStyle = 'rgba(11,7,22,0.85)';
        g.beginPath(); g.moveTo(0, y - 26); g.lineTo(W, y - 38); g.lineTo(W, y + 22); g.lineTo(0, y + 34); g.closePath(); g.fill();
        g.translate(cx, y);
        g.transform(1, 0, -0.18, 1, 0, 0);
        g.textAlign = 'center';
        g.fillStyle = '#fff';
        g.font = `italic 900 ${Math.min(34, W / 14)}px ${FONT}`;
        g.fillText(this.title, 0, -4);
        g.fillStyle = DIFF_HUD[this.difficulty] || '#fff';
        g.font = `italic 900 11px ${FONT}`;
        g.fillText(this.difficulty.toUpperCase(), 0, 20);
        g.restore();
      }
      const n = Math.ceil(-t / 1000);
      if (n <= 3) {
        const frac = (-t % 1000) / 1000;
        g.save();
        g.textAlign = 'center';
        g.globalAlpha = 0.25 + frac * 0.75;
        g.translate(cx, H * 0.46);
        g.transform(1, 0, -0.15, 1, 0, 0);
        g.scale(0.9 + frac * 0.35, 0.9 + frac * 0.35);
        g.font = `italic 900 80px ${FONT}`;
        g.fillStyle = 'rgba(255,61,139,0.8)'; g.fillText(n, 5, 5);
        g.fillStyle = '#fff'; g.fillText(n, 0, 0);
        g.restore();
      }
    }

    // outro banner once the last note is done
    if (t > this.lastNoteMs + 250) {
      const k = Math.min(1, (t - this.lastNoteMs - 250) / 260);
      const fc = this.counts.miss === 0;
      const ap = fc && this.counts.good === 0 && this.counts.great === 0;
      const label = ap ? 'ALL PERFECT' : fc ? 'FULL COMBO' : 'CLEAR';
      const y = H * 0.42;
      g.save();
      const ease = 1 - Math.pow(1 - k, 3);
      g.globalAlpha = ease;
      const bandH = 70 * ease;
      const bg = g.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, fc ? '#ffe27a' : '#ff3d8b'); bg.addColorStop(0.5, fc ? '#ff9ad0' : '#7a3cff'); bg.addColorStop(1, fc ? '#3fd4ff' : '#3fd4ff');
      g.fillStyle = bg;
      g.beginPath(); g.moveTo(0, y - bandH / 2 + 10); g.lineTo(W, y - bandH / 2 - 10); g.lineTo(W, y + bandH / 2 - 10); g.lineTo(0, y + bandH / 2 + 10); g.closePath(); g.fill();
      g.translate(cx, y);
      g.transform(1, 0, -0.2, 1, 0, 0);
      g.scale(1.6 - ease * 0.6, 1.6 - ease * 0.6);
      g.textAlign = 'center';
      g.font = `italic 900 ${Math.min(44, W / 11)}px ${FONT}`;
      g.fillStyle = 'rgba(11,7,22,0.55)'; g.fillText(label, 4, 4);
      g.fillStyle = '#fff'; g.fillText(label, 0, 0);
      g.restore();
    }
  }
}

// Chorus-like sections from loudness: RMS per bar, smoothed over neighbouring bars; runs of 4+ bars
// above the song's 80th percentile (clearly above its median) count, widened to adjacent bars that are
// loud on their own (smoothing pulls a section's first bar down). Returns [[startMs, endMs], ...].
function findChorus(buffer, beats, downbeat, barBeats) {
  if (!buffer || beats.length < barBeats * 8) return [];
  const sr = buffer.sampleRate, ch = buffer.getChannelData(0), step = 8;
  const bars = [];
  for (let k = ((downbeat % barBeats) + barBeats) % barBeats; k + barBeats < beats.length; k += barBeats) bars.push([beats[k], beats[k + barBeats]]);
  const e = bars.map(([a, b]) => {
    const i0 = Math.floor(a / 1000 * sr), i1 = Math.min(ch.length, Math.floor(b / 1000 * sr));
    let sum = 0, n = 0;
    for (let i = i0; i < i1; i += step) { sum += ch[i] * ch[i]; n++; }
    return n ? Math.sqrt(sum / n) : 0;
  });
  const sm = e.map((_, i) => (e[Math.max(0, i - 1)] + e[i] * 2 + e[Math.min(e.length - 1, i + 1)]) / 4);
  const sorted = [...sm].sort((a, b) => a - b);
  const hi = sorted[Math.floor(sorted.length * 0.8)], med = sorted[sorted.length >> 1];
  if (hi < med * 1.1) return [];   // flat dynamics: no clear chorus
  const out = [];
  for (let i = 0; i < sm.length;) {
    if (sm[i] < hi) { i++; continue; }
    let j = i; while (j < sm.length && sm[j] >= hi * 0.92) j++;
    if (j - i >= 4) {
      let a = i, b = j;
      while (a > 0 && e[a - 1] >= hi * 0.95) a--;
      while (b < e.length && e[b] >= hi * 0.95) b++;
      out.push([bars[a][0], bars[b - 1][1]]);
    }
    i = j;
  }
  return out;
}

function upper(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}

function upperT(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t <= x) lo = m + 1; else hi = m; }
  return lo;
}
