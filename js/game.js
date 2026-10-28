// ============================================================
//  Gameplay: clock, judging, rendering
// ============================================================

export const LANE_COLORS = ['#ff5a6e', '#4fb4ff', '#4fffa0', '#ffcb47'];
const LANE_RGB = [[255, 90, 110], [79, 180, 255], [79, 255, 160], [255, 203, 71]];
const rgba = (lane, a) => `rgba(${LANE_RGB[lane][0]},${LANE_RGB[lane][1]},${LANE_RGB[lane][2]},${a})`;

// Judgement windows (ms, +/-)
export const WINDOWS = { perfect: 42, great: 85, good: 130, bad: 165 };
const TIERS = [
  { key: 'perfect', label: 'PERFECT', win: WINDOWS.perfect, color: '#ffe066', weight: 1, hp: 1.2 },
  { key: 'great', label: 'GREAT', win: WINDOWS.great, color: '#5dffa8', weight: 0.75, hp: 0.8 },
  { key: 'good', label: 'GOOD', win: WINDOWS.good, color: '#5ab8ff', weight: 0.4, hp: 0.2 },
];
const MISS = { key: 'miss', label: 'MISS', color: '#ff4d5e' };
const FONT = '"Segoe UI", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';

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
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.audio = audio;
    this.hooks = hooks; // { onEnd(result) }
    this.state = 'idle';
    this.keyDown = [false, false, false, false];
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
    const fieldW = Math.min(this.W - 24, 440);
    this.laneW = fieldW / 4;
    this.fieldX = (this.W - fieldW) / 2;
    this.fieldW = fieldW;
    this.judgeY = this.H - Math.max(110, this.H * 0.15);
    this.noteH = Math.max(16, Math.min(26, this.laneW * 0.24));
    this.buildSprites();
  }

  laneX(l) { return this.fieldX + this.laneW * (l + 0.5); }

  laneAt(clientX) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * this.W;
    return Math.max(0, Math.min(3, Math.floor((x - this.fieldX) / this.laneW)));
  }

  // pre-render glowing note heads (shadowBlur per frame is expensive and causes hitches)
  buildSprites() {
    const pad = 14, w = this.laneW - 10, h = this.noteH;
    this.sprites = LANE_RGB.map((_, l) => {
      const c = document.createElement('canvas');
      c.width = Math.ceil((w + pad * 2) * this.dpr);
      c.height = Math.ceil((h + pad * 2) * this.dpr);
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      g.shadowBlur = 12; g.shadowColor = rgba(l, 0.75);
      const grad = g.createLinearGradient(0, pad, 0, pad + h);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.18, LANE_COLORS[l]);
      grad.addColorStop(1, rgba(l, 0.75));
      g.fillStyle = grad;
      g.beginPath(); g.roundRect(pad, pad, w, h, h / 2.6); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.roundRect(pad + 5, pad + 3, w - 10, Math.max(2, h * 0.16), 2); g.fill();
      return { canvas: c, w: w + pad * 2, h: h + pad * 2 };
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

  // ---------- lifecycle ----------
  start({ notes, beats, downbeat, barBeats, music, title, difficulty, settings }) {
    this.settings = settings;
    this.title = title;
    this.difficulty = difficulty;
    this.beats = (beats || []).map(b => b * 1000);
    this.downbeat = downbeat || 0;
    this.barBeats = barBeats || 4;
    this.approach = approachMs(settings.speed);

    this.notes = notes.map((n, i) => ({
      id: i, t: n.time * 1000, lane: n.lane, end: n.end ? n.end * 1000 : 0,
      state: 0,      // 0 pending, 1 holding, 2 done(hit), 3 missed
      tail: 0,       // hold tail: 0 pending, 1 ok, 2 released early (GOOD) or head missed
    }));
    this.laneNotes = [[], [], [], []];
    for (const n of this.notes) this.laneNotes[n.lane].push(n);
    this.laneHead = [0, 0, 0, 0];
    this.holding = [null, null, null, null];
    this.total = this.notes.length + this.notes.filter(n => n.end).length;

    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.weightSum = 0;
    this.judged = 0;
    this.combo = 0; this.maxCombo = 0;
    this.hp = 100;
    this.offsets = [];
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
    const leadMs = Math.max(2200, this.approach + 900 - first);

    const ctx = this.audio.ensure();
    this.t0 = ctx.currentTime + 0.12 + leadMs / 1000;
    this.anchorPerf = null;
    if (music.type === 'audio') this.audio.playBuffer(music.buffer, this.t0);
    else this.audio.playMidi(music.notes, this.t0, music.isGameNote);

    this.state = 'playing';
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  async pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    await this.audio.pause();
  }

  async resume() {
    if (this.state !== 'paused') return;
    // a hold whose key was let go during the pause is broken
    for (let l = 0; l < 4; l++) {
      const n = this.holding[l];
      if (n && !this.keyDown[l]) { this.holding[l] = null; this.breakHold(n, this.songTime ?? 0); }
    }
    await this.audio.resume();
    this.anchorPerf = null;
    this.state = 'playing';
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.state = 'idle';
    cancelAnimationFrame(this.raf);
    this.audio.stopMusic(0.25);
    this.audio.resume();
  }

  // ---------- input ----------
  press(lane, perf) {
    if (this.state !== 'playing') return;
    this.keyDown[lane] = true;
    this.beam[lane] = 1;
    if (this.settings.hitsound > 0) this.audio.playTap();
    const t = this.songAt(perf);
    const list = this.laneNotes[lane];
    for (let i = this.laneHead[lane]; i < list.length; i++) {
      const n = list[i];
      if (n.state !== 0) continue;
      const diff = t - n.t; // + late, - early
      if (diff < -WINDOWS.bad) return;              // too early: ignore the press
      if (diff > WINDOWS.good) { this.miss(n); continue; }
      if (diff < -WINDOWS.good) { this.miss(n, true); return; } // early "bad"
      this.hit(n, diff);
      return;
    }
  }

  release(lane, perf) {
    this.keyDown[lane] = false;
    if (this.state !== 'playing') return;
    const n = this.holding[lane];
    if (!n) return;
    this.holding[lane] = null;
    const t = this.songAt(perf);
    if (t >= n.end - WINDOWS.good) this.finishHold(n);
    else this.breakHold(n, t);
  }

  // ---------- judging ----------
  hit(n, diff) {
    const ad = Math.abs(diff);
    const tier = TIERS.find(tr => ad <= tr.win) || TIERS[2];
    this.award(tier);
    this.offsets.push(diff);
    this.meanErr = this.meanErr * 0.9 + diff * 0.1;
    if (tier.key !== 'perfect') { if (diff < 0) this.fast++; else this.slow++; }
    this.lastJudge = { tier, time: performance.now(), diff, lane: n.lane };
    this.errTicks.push({ diff, time: performance.now(), color: tier.color });
    if (this.errTicks.length > 40) this.errTicks.shift();
    this.burst(n.lane, tier);
    if (n.end) { n.state = 1; this.holding[n.lane] = n; }
    else n.state = 2;
  }

  award(tier) {
    this.counts[tier.key]++;
    this.weightSum += tier.weight;
    this.judged++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboPop = 1;
    this.hp = Math.min(100, this.hp + tier.hp);
  }

  miss(n, early) {
    n.state = 3;
    this.registerMiss(n.lane);
    if (n.end) { n.tail = 2; this.registerMiss(n.lane); }
    if (early) this.lastJudge = { tier: MISS, time: performance.now(), diff: -999, lane: n.lane };
  }

  registerMiss(lane) {
    this.counts.miss++;
    this.judged++;
    if (this.combo >= 20) this.effects.push({ type: 'break', time: performance.now() });
    this.combo = 0;
    this.hp = Math.max(0, this.hp - 7);
    this.lastJudge = { tier: MISS, time: performance.now(), diff: 0, lane };
  }

  finishHold(n) {
    n.state = 2; n.tail = 1;
    this.award(TIERS[0]);
    this.burst(n.lane, TIERS[0], true);
  }

  // released early: past the halfway point is a GOOD tail (combo kept), before it a miss
  breakHold(n, t) {
    n.state = 2; n.tail = 2;
    if (t >= n.t + (n.end - n.t) / 2) {
      this.award(TIERS[2]);
      this.lastJudge = { tier: TIERS[2], time: performance.now(), diff: null, lane: n.lane };
    } else {
      this.registerMiss(n.lane);
    }
  }

  // ---------- effects ----------
  burst(lane, tier, small) {
    const now = performance.now();
    this.receptorHit[lane] = 1;
    this.effects.push({ type: 'ring', lane, time: now, color: tier.color, perfect: tier.key === 'perfect' });
    const count = small ? 8 : tier.key === 'perfect' ? 16 : 10;
    const x = this.laneX(lane), y = this.judgeY;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const v = 0.25 + Math.random() * 0.55;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.0018 + Math.random() * 0.0016, size: 1.5 + Math.random() * 2.5, lane });
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

  // ---------- main loop ----------
  loop(now) {
    if (this.state !== 'playing') return;
    const dt = Math.min(50, now - this.lastFrame);
    this.lastFrame = now;
    this.updateClock(now);
    const t = this.songAt(now);
    this.songTime = t;

    // auto-miss late notes, complete holds
    for (let l = 0; l < 4; l++) {
      const list = this.laneNotes[l];
      let h = this.laneHead[l];
      while (h < list.length && list[h].state >= 2) h++;
      this.laneHead[l] = h;
      for (let i = h; i < list.length; i++) {
        const n = list[i];
        if (n.t - t > WINDOWS.good) break;
        if (n.state === 0 && t - n.t > WINDOWS.good) this.miss(n);
      }
      const hn = this.holding[l];
      if (hn && t >= hn.end) { this.holding[l] = null; this.finishHold(hn); }
    }

    if (this.hp <= 0 && !this.settings.noFail) return this.finish(true);
    if (t > this.endMs) return this.finish(false);

    this.render(t, now, dt);
    this.raf = requestAnimationFrame(this.loop);
  }

  finish(failed) {
    this.state = 'ended';
    this.audio.stopMusic(failed ? 0.6 : 1.5);
    this.hooks.onEnd(this.result(failed));
  }

  // ---------- rendering ----------
  render(t, now, dt) {
    const g = this.ctx;
    const { W, H, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background + beat pulse
    let pulse = 0, isBar = false;
    if (this.beats.length) {
      const k = upper(this.beats, t) - 1;
      if (k >= 0) {
        pulse = Math.exp(-(t - this.beats[k]) / 140);
        isBar = ((k - this.downbeat) % this.barBeats + this.barBeats) % this.barBeats === 0;
      }
    }
    g.fillStyle = '#06050d';
    g.fillRect(0, 0, W, H);
    const bg = g.createRadialGradient(W / 2, this.judgeY, 10, W / 2, this.judgeY, H * 0.9);
    bg.addColorStop(0, `rgba(120,60,255,${0.12 + pulse * (isBar ? 0.12 : 0.06)})`);
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // playfield
    const fx = this.fieldX, fw = this.fieldW, lw = this.laneW, jy = this.judgeY;
    const field = g.createLinearGradient(0, 0, 0, H);
    field.addColorStop(0, 'rgba(255,255,255,0.01)');
    field.addColorStop(0.85, 'rgba(255,255,255,0.045)');
    g.fillStyle = field;
    g.fillRect(fx, 0, fw, H);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i <= 4; i++) g.fillRect(Math.round(fx + i * lw) - 0.5, 0, 1, H);

    const pxPerMs = (jy + 30) / this.approach;
    const yOf = time => jy - (time - t) * pxPerMs;

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
    const horizonT = t + this.approach + 200;
    for (let l = 0; l < 4; l++) {
      const list = this.laneNotes[l];
      const x = this.laneX(l);
      for (let i = Math.max(0, this.laneHead[l] - 2); i < list.length; i++) {
        const n = list[i];
        if (n.t > horizonT) break;
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
        g.strokeStyle = e.color;
        g.globalAlpha = (1 - p) * 0.9;
        g.lineWidth = 3 * (1 - p) + 1;
        g.beginPath(); g.ellipse(x, jy, lw * (0.3 + ease * 0.45), nh * (0.6 + ease * 1.2), 0, 0, Math.PI * 2); g.stroke();
        // flash column
        g.globalAlpha = (1 - p) * (e.perfect ? 0.5 : 0.3);
        const col = g.createLinearGradient(0, jy - 120, 0, jy + 10);
        col.addColorStop(0, 'rgba(255,255,255,0)');
        col.addColorStop(1, e.color);
        g.fillStyle = col;
        g.fillRect(x - lw / 2 + 3, jy - 120, lw - 6, 130);
        g.globalAlpha = 1;
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
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.0009 * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      g.globalAlpha = p.life;
      g.fillStyle = LANE_COLORS[p.lane];
      g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + p.life * 0.5), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    this.drawHUD(t, now, dt);
  }

  drawHead(l, x, y, nw, nh) {
    const s = this.sprites[l];
    this.ctx.drawImage(s.canvas, x - s.w / 2, y - s.h / 2, s.w, s.h);
  }

  drawHUD(t, now, dt) {
    const g = this.ctx;
    const { W, H } = this;
    const jy = this.judgeY;
    g.textBaseline = 'middle';

    // combo
    if (this.combo >= 3) {
      this.comboPop = Math.max(0, this.comboPop - dt / 120);
      const s = 1 + this.comboPop * 0.18;
      g.save();
      g.translate(W / 2, H * 0.36);
      g.scale(s, s);
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = `800 52px ${FONT}`;
      g.fillText(this.combo, 0, 0);
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.font = `700 12px ${FONT}`;
      g.fillText('COMBO', 0, 36);
      g.restore();
    }

    // judgement text
    const j = this.lastJudge;
    if (j) {
      const age = now - j.time;
      if (age < 650) {
        const pop = age < 90 ? 1.25 - (age / 90) * 0.25 : 1;
        const a = age < 450 ? 1 : 1 - (age - 450) / 200;
        g.save();
        g.globalAlpha = a;
        g.translate(W / 2, H * 0.36 + 70);
        g.scale(pop, pop);
        g.textAlign = 'center';
        g.fillStyle = j.tier.color;
        g.font = `800 26px ${FONT}`;
        g.fillText(j.tier.label, 0, 0);
        if (this.settings.showTiming && j.diff != null && j.tier.key !== 'perfect' && j.tier.key !== 'miss') {
          g.font = `700 12px ${FONT}`;
          g.fillStyle = j.diff < 0 ? '#5ab8ff' : '#ff9a5a';
          g.fillText(`${j.diff < 0 ? 'FAST' : 'SLOW'} ${Math.round(Math.abs(j.diff))}ms`, 0, 22);
        }
        g.restore();
      }
    }

    // hit error bar
    const barW = Math.min(220, this.fieldW * 0.6), bx = W / 2 - barW / 2, by = jy + this.noteH / 2 + 40;
    const scale = barW / 2 / WINDOWS.good;
    g.fillStyle = 'rgba(90,184,255,0.22)'; g.fillRect(bx, by - 2, barW, 4);
    g.fillStyle = 'rgba(93,255,168,0.3)'; g.fillRect(W / 2 - WINDOWS.great * scale, by - 2, WINDOWS.great * 2 * scale, 4);
    g.fillStyle = 'rgba(255,224,102,0.45)'; g.fillRect(W / 2 - WINDOWS.perfect * scale, by - 2, WINDOWS.perfect * 2 * scale, 4);
    for (const tk of this.errTicks) {
      const age = now - tk.time;
      if (age > 3000) continue;
      g.globalAlpha = 1 - age / 3000;
      g.fillStyle = tk.color;
      g.fillRect(W / 2 + Math.max(-1, Math.min(1, tk.diff / WINDOWS.good)) * barW / 2 - 1, by - 7, 2, 14);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#fff';
    g.beginPath();
    const mx = W / 2 + Math.max(-1, Math.min(1, this.meanErr / WINDOWS.good)) * barW / 2;
    g.moveTo(mx, by - 9); g.lineTo(mx - 4, by - 15); g.lineTo(mx + 4, by - 15); g.fill();

    // score / accuracy
    const target = this.score();
    this.displayScore += (target - this.displayScore) * Math.min(1, dt / 80);
    g.textAlign = 'right';
    g.fillStyle = '#fff';
    g.font = `700 24px ${FONT}`;
    g.fillText(Math.round(this.displayScore).toString().padStart(7, '0'), W - 16, 26);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = `600 13px ${FONT}`;
    g.fillText((this.accuracy() * 100).toFixed(2) + '%', W - 16, 50);

    // hp
    const hpW = 120, hx = 60, hy = 22;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.roundRect(hx, hy, hpW, 6, 3); g.fill();
    g.fillStyle = this.hp > 50 ? '#5dffa8' : this.hp > 25 ? '#ffcb47' : '#ff4d5e';
    g.beginPath(); g.roundRect(hx, hy, hpW * this.hp / 100, 6, 3); g.fill();
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.font = `600 11px ${FONT}`;
    g.fillText(this.title, hx, hy + 22);
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.fillText(this.difficulty.toUpperCase(), hx, hy + 38);

    // progress
    const prog = Math.max(0, Math.min(1, t / this.endMs));
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, H - 3, W, 3);
    const pg = g.createLinearGradient(0, 0, W, 0);
    pg.addColorStop(0, '#ff6fd8'); pg.addColorStop(1, '#6a5cff');
    g.fillStyle = pg; g.fillRect(0, H - 3, W * prog, 3);

    // countdown before the first note
    if (t < 0) {
      const first = this.notes.length ? this.notes[0].t : 0;
      const n = Math.ceil(-t / 1000);
      const frac = (-t % 1000) / 1000;
      g.save();
      g.textAlign = 'center';
      g.globalAlpha = 0.25 + frac * 0.75;
      g.translate(W / 2, H * 0.42);
      g.scale(0.9 + frac * 0.3, 0.9 + frac * 0.3);
      g.fillStyle = '#fff';
      g.font = `800 72px ${FONT}`;
      g.fillText(n <= 3 ? n : 'READY', 0, 0);
      g.restore();
      if (first > 2000) {
        g.textAlign = 'center';
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.font = `600 13px ${FONT}`;
        g.fillText('music starts…', W / 2, H * 0.42 + 56);
      }
    }
  }
}

function upper(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}
