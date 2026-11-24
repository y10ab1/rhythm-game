// ============================================================
//  Debug mode: ?debug=1 turns it on (remembered), ?debug=0 off.
//  While playing it draws every finger (where it is, the lane it counts for, its trail), flags
//  pointercancel and "jumps" (a held finger leaping across lanes in one event: the touch screen
//  merging two fingers into one), and says why each note was missed. The whole run (touches,
//  presses, judgements, chart, screen) is recorded for upload / download from the results screen.
// ============================================================
import { LANE_COLORS, WINDOWS } from './game.js';

export const DEBUG = (() => {
  try {
    const q = new URLSearchParams(location.search).get('debug');
    if (q === '0') localStorage.removeItem('rhythmDebug');
    else if (q != null) localStorage.setItem('rhythmDebug', '1');
    return localStorage.getItem('rhythmDebug') === '1';
  } catch { return false; }
})();

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const JUMP_LANES = 0.6;   // a held finger moving this far in one event, within JUMP_MS, counts as a jump
const JUMP_MS = 50;

export class DebugLog {
  begin(game, meta) {
    this.game = game;
    this.perf0 = performance.now();
    const s = game.settings;
    this.meta = {
      ...meta, ua: navigator.userAgent, started: new Date().toISOString(),
      W: game.W, H: game.H, dpr: window.devicePixelRatio, maxTouchPoints: navigator.maxTouchPoints,
      laneW: r1(game.laneW), judgeY: r1(game.judgeY), horizonY: r1(game.horizonY), farRatio: game.farRatio,
      persp: game.persp, offset: s.offset, speed: s.speed, gimmicks: s.gimmicks,
    };
    this.notes = game.notes.map(n => ({
      id: n.id, t: Math.round(n.t), lane: n.lane, end: n.end ? Math.round(n.end) : 0,
      path: n.path ? n.path.map(p => [Math.round(p.t), p.lane]) : null, sweep: n.sweep,
    }));
    this.ev = [];
    this.stats = { down: 0, up: 0, cancel: 0, jump: 0, maxFingers: 0, missNoPress: 0, missNeighbour: 0, missOffTime: 0, missWhileHolding: 0, early: 0, breaks: 0 };
    this.last = new Map();     // pointerId -> { pos, perf, lpos, lperf }
    this.trails = new Map();   // pointerId -> [{ x, y, at }]
    this.rings = [];           // finger-down flashes
    this.presses = [];         // { lane, s }
    this.jumps = [];           // song times of jumps
    this.lines = [];           // recent notable events, shown on screen
    this.result = null;
  }

  song(perf) { return Math.round(this.game.songAt(perf ?? performance.now())); }
  holdMask() { return this.game.holding.reduce((m, n, l) => (n ? m | (1 << l) : m), 0); }
  push(o) {
    o.p = Math.round(performance.now() - this.perf0);
    this.ev.push(o);
  }
  say(text, color = '#fff') {
    this.lines.push({ text, color, at: performance.now() });
    if (this.lines.length > 7) this.lines.shift();
  }

  pointer(kind, id, x, y, pos, lane, perf, e) {
    const now = performance.now();
    const o = { k: kind, id, x: r1(x), y: r1(y), pos: r2(pos), lane, s: this.song(perf), hold: this.holdMask(), n: this.game.pointers.size };
    if (e) {
      o.pt = e.pointerType; o.w = r1(e.width || 0); o.h = r1(e.height || 0); o.pr = r2(e.pressure || 0);
      o.age = Math.round(now - e.timeStamp);   // how old the browser's timeStamp was on arrival
      if (o.age >= 45 && kind !== 'move') {
        this.stats.stale = (this.stats.stale || 0) + 1;
        this.say(`時間戳過舊 ${o.age}ms（${kind} L${lane + 1}）已改用到達時間`, '#c9a0ff');
      }
    }
    const prev = this.last.get(id);
    if (kind === 'down') {
      this.stats.down++;
      this.stats.maxFingers = Math.max(this.stats.maxFingers, this.game.pointers.size);
      this.rings.push({ x, y, lane, at: now });
      this.trails.set(id, [{ x, y, at: now }]);
      this.last.set(id, { pos, perf, lpos: pos, lperf: perf });
      this.push(o);
      return;
    }
    if (kind === 'move') {
      const tr = this.trails.get(id);
      if (tr) { tr.push({ x, y, at: now }); while (tr.length && now - tr[0].at > 350) tr.shift(); }
      if (prev) {
        if (Math.abs(pos - prev.pos) > JUMP_LANES && perf - prev.perf < JUMP_MS) {
          this.stats.jump++;
          this.jumps.push(o.s);
          this.push({ ...o, k: 'jump', from: r2(prev.pos), dt: r1(perf - prev.perf) });
          this.say(`跳點 #${id % 1000} ${prev.pos.toFixed(1)}→${pos.toFixed(1)}（${Math.round(perf - prev.perf)}ms）`, '#ff9a5a');
        }
        prev.pos = pos; prev.perf = perf;
        // moves are thinned out: log on a real change or every 80 ms
        if (Math.abs(pos - prev.lpos) < 0.1 && perf - prev.lperf < 80) return;
        prev.lpos = pos; prev.lperf = perf;
      }
      this.push(o);
      return;
    }
    // up / cancel
    this.stats[kind === 'cancel' ? 'cancel' : 'up']++;
    if (kind === 'cancel') this.say(`pointercancel #${id % 1000}（系統搶走了這根手指）`, '#ff4d5e');
    this.trails.delete(id);
    this.last.delete(id);
    this.push(o);
  }

  press(lane, s, res) {
    this.presses.push({ lane, s });
    if (this.presses.length > 64) this.presses.shift();
    this.push({ k: 'press', lane, s: Math.round(s), res, hold: this.holdMask() });
  }

  // why a note went by without being hit
  diagnose(n) {
    const t = n.t;
    const near = (lane, a, b) => this.presses.find(p => p.lane === lane && p.s >= t + a && p.s <= t + b);
    const own = near(n.lane, -400, WINDOWS.good + 20);
    const nb = [n.lane - 1, n.lane + 1].map(l => near(l, -WINDOWS.good, WINDOWS.good)).find(Boolean);
    const jump = this.jumps.some(s => Math.abs(s - t) < 200);
    if (own) return { why: 'off-time', d: Math.round(own.s - t), jump };
    if (nb) return { why: 'neighbour', lane: nb.lane, d: Math.round(nb.s - t), jump };
    return { why: 'no-press', jump };
  }

  judge(kind, n, tier, diff, extra) {
    const hold = this.holdMask() & ~(1 << n.lane);
    const o = { k: 'j', kind, id: n.id, lane: n.lane, cur: n.cur, nt: Math.round(n.t), s: this.song(), tier, hold, ...extra };
    if (diff != null) o.diff = Math.round(diff);
    const L = l => `L${l + 1}`;
    const tag = hold ? ' · 長音中' : '';
    if (kind === 'miss') {
      const d = this.diagnose(n);
      Object.assign(o, d);
      if (hold) this.stats.missWhileHolding++;
      if (d.why === 'no-press') {
        this.stats.missNoPress++;
        this.say(`MISS ${L(n.lane)} 沒收到按壓${tag}${d.jump ? ' · 有跳點' : ''}`, '#ff4d5e');
      } else if (d.why === 'neighbour') {
        this.stats.missNeighbour++;
        this.say(`MISS ${L(n.lane)} 按到隔壁 ${L(d.lane)}（${d.d > 0 ? '+' : ''}${d.d}ms）${tag}`, '#ffcb47');
      } else {
        this.stats.missOffTime++;
        this.say(`MISS ${L(n.lane)} 有按但時機差 ${d.d > 0 ? '+' : ''}${d.d}ms${tag}`, '#5ab8ff');
      }
    } else if (kind === 'early') {
      this.stats.early++;
      this.say(`太早 ${L(n.lane)}${tag}`, '#5ab8ff');
    } else if (kind === 'break') {
      this.stats.breaks++;
      const why = { released: '放開了', 'bend-passed': '轉折點過了沒滑過去', 'float-expired': '放開後沒接上' }[extra?.why] || extra?.why || '';
      this.say(`長音斷 ${L(n.cur)} ${why}`, '#ff7a5a');
    } else if (kind === 'shift') {
      this.say(`滑 ${L(extra.from)}→${L(extra.to)} ${o.diff > 0 ? '+' : ''}${o.diff}ms ${tier.toUpperCase()}`, '#5dffa8');
    }
    this.push(o);
  }

  finish(result) {
    this.result = { score: result.score, accuracy: result.accuracy, counts: result.counts, maxCombo: result.maxCombo, failed: result.failed };
  }

  export() {
    return { v: 1, meta: this.meta, stats: this.stats, result: this.result, notes: this.notes, ev: this.ev };
  }

  // ---------- overlay ----------
  draw(g, game, t, now) {
    const { W, H } = game;
    g.save();
    g.globalCompositeOperation = 'source-over';
    // which lane a touch at the bottom of the screen counts for
    g.font = '600 12px ui-monospace, monospace';
    g.textAlign = 'center';
    for (let l = 0; l < 4; l++) {
      const y = H - 14;
      g.fillStyle = LANE_COLORS[l]; g.globalAlpha = 0.7;
      g.fillText(`L${l + 1}`, game.bx(l + 0.5, y), y);
    }
    g.globalAlpha = 1;
    // finger-down flashes
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i], a = (now - r.at) / 350;
      if (a > 1) { this.rings.splice(i, 1); continue; }
      g.strokeStyle = LANE_COLORS[r.lane]; g.globalAlpha = 1 - a; g.lineWidth = 3;
      g.beginPath(); g.arc(r.x, r.y, 20 + a * 30, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
    // fingers
    for (const [id, p] of game.pointers) {
      const tr = this.trails.get(id), col = LANE_COLORS[p.lane];
      if (tr && tr.length > 1) {
        g.strokeStyle = col; g.globalAlpha = 0.5; g.lineWidth = 3;
        g.beginPath(); g.moveTo(tr[0].x, tr[0].y);
        for (const q of tr) g.lineTo(q.x, q.y);
        g.stroke(); g.globalAlpha = 1;
      }
      const holding = !!game.holding[p.lane];
      g.fillStyle = holding ? col : 'rgba(0,0,0,0.35)';
      g.globalAlpha = holding ? 0.45 : 1;
      g.beginPath(); g.arc(p.x, p.y, 28, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = col; g.lineWidth = 3;
      g.beginPath(); g.arc(p.x, p.y, 28, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff';
      g.fillText(`L${p.lane + 1}`, p.x, p.y - 34);
      g.fillText(game.lanePos(p.x, p.y).toFixed(2), p.x, p.y + 4);
    }
    // panel
    const s = this.stats, x = 8, w = Math.min(300, W - 16);
    const rows = [
      [`DEBUG  手指 ${game.pointers.size}（最多 ${s.maxFingers}）`, '#ffe066'],
      [`按下 ${s.down}  放開 ${s.up}  取消 ${s.cancel}  跳點 ${s.jump}  舊戳 ${s.stale || 0}`, '#fff'],
      [`MISS：沒收到 ${s.missNoPress} · 隔壁 ${s.missNeighbour} · 時機 ${s.missOffTime}`, '#fff'],
      [`  其中長音中 ${s.missWhileHolding} · 太早 ${s.early} · 長音斷 ${s.breaks}`, '#fff'],
      ...this.lines.map(l => [l.text, l.color, Math.max(0.35, 1 - (now - l.at) / 6000)]),
    ];
    const y0 = Math.max(90, H * 0.2), lh = 16;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x - 4, y0 - 13, w, rows.length * lh + 8);
    g.textAlign = 'left';
    rows.forEach(([text, color, a = 1], i) => {
      g.globalAlpha = a; g.fillStyle = color;
      g.fillText(text, x, y0 + i * lh, w - 8);
    });
    g.restore();
  }
}
