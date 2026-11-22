// ============================================================
//  Chart generation: analysis (audio or MIDI) -> playable notes
// ============================================================

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];

const CONFIG = {
  //          max metric level, target notes/sec @120bpm, min gap (s), chord rate, hold rate, same-lane gap, same-hand gap
  easy:   { maxLevel: 1, nps: 1.45, minGap: 0.40, chord: 0,    hold: 0.10, jack: 0.70, hand: 0,    fillBeats: 4 },
  normal: { maxLevel: 2, nps: 2.7,  minGap: 0.20, chord: 0.04, hold: 0.10, jack: 0.40, hand: 0,    fillBeats: 4 },
  hard:   { maxLevel: 3, nps: 4.4,  minGap: 0.12, chord: 0.10, hold: 0.08, jack: 0.24, hand: 0.15, fillBeats: 2 },
  expert: { maxLevel: 3, nps: 6.6,  minGap: 0.075, chord: 0.17, hold: 0.06, jack: 0.16, hand: 0.11, fillBeats: 2 },
};
const LEVEL_WEIGHT = [1.4, 1.0, 0.72, 0.5];

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

// ---- candidates: audio onsets snapped to the beat grid ----
function audioCandidates(an) {
  const { beats, onsets } = an;
  const ot = onsets.t;
  const used = new Set();
  const out = [];
  const match = (t, tol) => {
    const i = lowerBound(ot, t - tol);
    let best = -1, bestD = tol;
    for (let j = i; j < ot.length && ot[j] <= t + tol; j++) {
      const d = Math.abs(ot[j] - t);
      if (d <= bestD && !used.has(j)) { best = j; bestD = d; }
    }
    return best;
  };
  const make = (t, j, level) => ({
    t, level,
    s: onsets.s[j], c: onsets.c[j], sus: onsets.sus[j],
    lo: onsets.lo[j], hi: onsets.hi[j],
  });

  for (let k = 0; k < beats.length; k++) {
    const b = beats[k];
    const d = k + 1 < beats.length ? beats[k + 1] - b : (k > 0 ? b - beats[k - 1] : 0.5);
    const tol = Math.min(0.035, d * 0.1);
    const beatLevel = ((k - an.downbeat) % 4 + 4) % 4 === 0 ? 0 : 1;

    const jb = match(b, tol);
    if (jb >= 0) { used.add(jb); out.push(make(b, jb, beatLevel)); }

    // straight (16ths) vs triplet subdivision: keep whichever explains more energy
    const straight = [[0.5, 2], [0.25, 3], [0.75, 3]].map(([f, lv]) => [b + f * d, lv, match(b + f * d, tol)]);
    const triplet = [[1 / 3, 3], [2 / 3, 3]].map(([f, lv]) => [b + f * d, lv, match(b + f * d, tol)]);
    const energy = list => list.reduce((s, [, , j]) => s + (j >= 0 ? onsets.s[j] : 0), 0);
    const chosen = energy(triplet) > energy(straight) * 1.3 ? triplet : straight;
    for (const [t, lv, j] of chosen) {
      if (j >= 0 && !used.has(j)) { used.add(j); out.push(make(t, j, lv)); }
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ---- candidates: MIDI onsets keep their exact times and metric level ----
function midiCandidates(an) {
  const o = an.onsets;
  return o.t.map((t, i) => ({ t, level: o.level[i], s: o.s[i], c: o.c[i], sus: o.sus[i], lo: 0, hi: 0 }))
    .sort((a, b) => a.t - b.t);
}

// ============================================================
// opts.gimmicks: add sweeps (Normal+), slides and scroll-speed changes (Hard+) on top of the plain chart.
// The plain chart is the same either way: the gimmicks only re-lane notes, bend holds and add a speed track.
export function generateChart(an, difficulty, seed = 1, opts = {}) {
  const cfg = CONFIG[difficulty] || CONFIG.normal;
  const rand = mulberry32(seed * 7919 + DIFFICULTIES.indexOf(difficulty) + 1);
  const cands = an.kind === 'midi' ? midiCandidates(an) : audioCandidates(an);
  const bpm = an.bpm || 120;
  const beatLen = 60 / bpm;
  if (!cands.length) return { notes: [], stats: chartStats([], 0) };

  // --- 1. select note times ---
  const sArr = cands.map(c => c.s).sort((a, b) => a - b);
  const floor = quantile(sArr, 0.9) * 0.12;
  const span = Math.max(10, cands[cands.length - 1].t - cands[0].t);
  // faster songs are allowed to be denser (but less than linearly)
  const target = Math.round(cfg.nps * Math.pow(bpm / 120, 0.6) * span);
  // if the allowed subdivisions cannot supply enough notes (slow songs,
  // MIDI written in short note values) open up the next level
  let maxLevel = cfg.maxLevel;
  const usable = lv => {
    const ts = cands.filter(c => c.level <= lv && c.s >= floor).map(c => c.t);
    let n = 0, last = -9;
    for (const t of ts) if (t - last >= cfg.minGap) { n++; last = t; }
    return n;
  };
  while (maxLevel < 3 && usable(maxLevel) < target * 0.6) maxLevel++;
  const eligible = cands.filter(c => c.level <= maxLevel && c.s >= floor);

  const order = eligible.map((c, i) => ({ i, p: c.s * LEVEL_WEIGHT[c.level] + rand() * 1e-3 }))
    .sort((a, b) => b.p - a.p);
  const times = []; // sorted chosen times
  const chosenSet = new Set();
  const fits = (t, gap) => {
    const k = lowerBound(times, t);
    return !(k < times.length && times[k] - t < gap - 1e-6) && !(k > 0 && t - times[k - 1] < gap - 1e-6);
  };
  const take = idx => {
    const t = eligible[idx].t;
    times.splice(lowerBound(times, t), 0, t);
    chosenSet.add(idx);
  };
  for (const { i } of order) {
    if (times.length >= target) break;
    if (fits(eligible[i].t, cfg.minGap)) take(i);
  }
  // fill long silences so quiet sections still have something to play
  const fillGap = cfg.fillBeats * beatLen;
  for (let pass = 0; pass < 3; pass++) {
    const snapshot = [...times];
    for (let k = 0; k + 1 < snapshot.length; k++) {
      if (snapshot[k + 1] - snapshot[k] <= fillGap) continue;
      let best = -1;
      for (let i = 0; i < eligible.length; i++) {
        const c = eligible[i];
        if (c.t <= snapshot[k] + beatLen * 0.9 || c.t >= snapshot[k + 1] - beatLen * 0.9 || chosenSet.has(i)) continue;
        if (c.level > 1 && maxLevel > 1 && best >= 0 && eligible[best].level <= 1) continue;
        if (best < 0 || c.s * LEVEL_WEIGHT[c.level] > eligible[best].s * LEVEL_WEIGHT[eligible[best].level]) best = i;
      }
      if (best >= 0 && fits(eligible[best].t, cfg.minGap)) take(best);
    }
  }
  const picked = [...chosenSet].map(i => eligible[i]).sort((a, b) => a.t - b.t);

  // --- 2. hold candidates: notes with the longest sustain and room after them ---
  const holdMin = Math.max(0.35, beatLen * 1.0);
  const holdIdx = new Set();
  if (cfg.hold > 0) {
    const ranked = picked.map((c, i) => ({ i, sus: c.sus })).filter(x => x.sus >= holdMin).sort((a, b) => b.sus - a.sus);
    const maxHolds = Math.round(picked.length * cfg.hold);
    for (const { i } of ranked) {
      if (holdIdx.size >= maxHolds) break;
      if (difficulty === 'easy' && i + 1 < picked.length && picked[i + 1].t - picked[i].t < holdMin + 0.3) continue;
      holdIdx.add(i);
    }
  }

  // --- 3. lane assignment ---
  const cs = picked.map(c => c.c).sort((a, b) => a - b);
  const q1 = quantile(cs, 0.25), q2 = quantile(cs, 0.5), q3 = quantile(cs, 0.75);
  const prefLane = c => (c < q1 ? 0 : c < q2 ? 1 : c < q3 ? 2 : 3);
  const hand = l => (l < 2 ? 0 : 1);

  const notes = [];
  const noteC = new Map();   // note -> pitch / brightness of its onset (for sweep and slide directions)
  const busyUntil = [-1, -1, -1, -1];
  const lastAt = [-9, -9, -9, -9];
  let prevLane = -1, prevT = -9, prevC = null, lastChord = -9;
  const sStrong = quantile(picked.map(c => c.s).sort((a, b) => a - b), 1 - cfg.chord);
  const maxChords = Math.round(picked.length * cfg.chord);
  let chords = 0;
  const recent = [];
  // vary the lane layout per 2-bar phrase so repeated grooves do not
  // become one static pattern (identity / mirror / inner-outer swaps)
  const LAYOUTS = [[0, 1, 2, 3], [3, 2, 1, 0], [1, 0, 3, 2], [0, 2, 1, 3], [2, 3, 0, 1], [3, 1, 2, 0]];
  const phraseLayout = new Map();
  const layoutAt = t => {
    const phrase = Math.floor(Math.max(0, lowerBound(an.beats || [], t) - (an.downbeat || 0)) / 8);
    if (!phraseLayout.has(phrase)) phraseLayout.set(phrase, LAYOUTS[Math.floor(rand() * LAYOUTS.length)]);
    return phraseLayout.get(phrase);
  };

  const choose = (t, pref, exclude) => {
    let best = -1, bestCost = Infinity;
    for (let l = 0; l < 4; l++) {
      if (exclude.includes(l) || busyUntil[l] > t - 0.05) continue;
      const gap = t - lastAt[l];
      let cost = Math.abs(l - pref) * 0.9 + rand() * 0.9;
      if (gap < cfg.jack) cost += 6 * (1 - gap / cfg.jack) + 2;
      if (prevLane >= 0 && cfg.hand > 0 && t - prevT < cfg.hand && hand(l) === hand(prevLane)) cost += 3;
      if (l === prevLane) cost += 0.6;
      cost += 0.45 * recent.filter(x => x === l).length;
      if (cost < bestCost) { bestCost = cost; best = l; }
    }
    return best;
  };

  for (let i = 0; i < picked.length; i++) {
    const c = picked[i];
    const t = c.t;
    // follow the melodic contour a little: rising sound -> move right
    let pref = layoutAt(t)[prefLane(c.c)];
    if (prevC !== null && prevLane >= 0 && t - prevT < beatLen) {
      if (c.c > prevC + 0.15) pref = Math.min(3, Math.max(pref, prevLane + 1));
      else if (c.c < prevC - 0.15) pref = Math.max(0, Math.min(pref, prevLane - 1));
    }
    const lane = choose(t, pref, []);
    if (lane < 0) continue;

    const note = { time: t, lane };
    if (holdIdx.has(i)) {
      let end = t + Math.min(c.sus, beatLen * 4);
      if (difficulty === 'easy' && i + 1 < picked.length) end = Math.min(end, picked[i + 1].t - 0.3);
      // snap the tail to the half-beat grid
      end = t + Math.max(holdMin, Math.round((end - t) / (beatLen / 2)) * (beatLen / 2));
      if (end - t >= holdMin * 0.95) {
        note.end = end;
        busyUntil[lane] = end + 0.08;
      }
    }
    notes.push(note);
    noteC.set(note, c.c);
    lastAt[lane] = Math.max(lastAt[lane], note.end || t);

    // chords on the strongest accents
    if (cfg.chord > 0 && chords < maxChords && c.s >= sStrong && c.level <= (difficulty === 'expert' ? 2 : 1) &&
        t - lastChord >= (difficulty === 'expert' ? 0.2 : 0.4)) {
      const other = hand(lane) === 0 ? 2 + Math.round(rand()) : Math.round(rand());
      const l2 = choose(t, other, [lane]);
      if (l2 >= 0 && hand(l2) !== hand(lane)) {
        notes.push({ time: t, lane: l2 });
        lastAt[l2] = t;
        lastChord = t;
        chords++;
      }
    }
    recent.push(lane);
    if (recent.length > 4) recent.shift();
    prevLane = lane; prevT = t; prevC = c.c;
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  let speed = null;
  if (opts.gimmicks) {
    const di = DIFFICULTIES.indexOf(difficulty);
    const rand2 = mulberry32(seed * 104729 + di * 13 + 5);
    if (di >= 1) addSweeps(notes, noteC, beatLen, cfg, di, rand2);
    if (di >= 2) addSlides(notes, noteC, cands, beatLen, di, rand2);
    if (di >= 2) speed = speedTrack(an, di, beatLen);
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  }
  return { notes, speed, stats: chartStats(notes, an.duration) };
}

// ---- sweeps: 3-4 evenly spaced single notes (8ths or faster) re-laned as a staircase, in the
// direction the melody / brightness moves. Each note keeps its time; they share a sweep id.
function addSweeps(notes, noteC, beatLen, cfg, di, rand) {
  // Normal: quarter-note staircases are fine too
  const maxGap = di >= 2 ? Math.min(0.26, beatLen * 0.55) : Math.min(0.5, beatLen * 1.05), minGap = di >= 3 ? 0.06 : 0.12;
  const len = di >= 2 ? 4 : 3;
  const single = i => notes[i] && !notes[i].end && notes[i - 1]?.time !== notes[i].time && notes[i + 1]?.time !== notes[i].time;
  const holdOver = (lane, t) => notes.some(n => n.end && n.lane === lane && n.time < t + 0.05 && n.end > t - 0.05);
  const spacing = beatLen * (di >= 2 ? 8 : 16);
  let id = 0, lastEnd = -1e9;
  for (let i = 0; i + len <= notes.length; i++) {
    if (notes[i].time - lastEnd < spacing) continue;
    let ok = true;
    const g0 = notes[i + 1].time - notes[i].time;
    if (g0 < minGap || g0 > maxGap) continue;
    for (let k = 0; k < len && ok; k++) {
      if (!single(i + k)) ok = false;
      else if (k > 0) {
        const g = notes[i + k].time - notes[i + k - 1].time;
        if (Math.abs(g - g0) > g0 * 0.35) ok = false;
      }
    }
    if (!ok || rand() > (di >= 3 ? 0.8 : 0.6)) continue;
    const run = notes.slice(i, i + len);
    const dc = (noteC.get(run[len - 1]) ?? 0) - (noteC.get(run[0]) ?? 0);
    const dir = Math.abs(dc) > 1e-6 ? Math.sign(dc) : (rand() < 0.5 ? 1 : -1);
    const start = len === 4 ? (dir > 0 ? 0 : 3) : (dir > 0 ? Math.floor(rand() * 2) : 3 - Math.floor(rand() * 2));
    const lanes = run.map((_, k) => start + dir * k);
    if (run.some((n, k) => holdOver(lanes[k], n.time))) continue;
    // no fast jack into the first step or out of the last one
    const prev = notes.slice(0, i).reverse().find(n => n.lane === lanes[0]);
    const next = notes.slice(i + len).find(n => n.lane === lanes[len - 1]);
    if (prev && run[0].time - (prev.end || prev.time) < cfg.jack * 0.6) continue;
    if (next && next.time - run[len - 1].time < cfg.jack * 0.6) continue;
    run.forEach((n, k) => { n.lane = lanes[k]; n.sweep = id; });
    id++;
    lastEnd = run[len - 1].time;
    i += len - 1;
  }
}

// ---- slides: long holds bend into the neighbouring lane on a beat (one bend, two on long holds),
// toward where the melody goes while the note is held. The lane they move into must be free.
function addSlides(notes, noteC, cands, beatLen, di, rand) {
  const rate = di >= 3 ? 0.6 : 0.4, D = 0.12;
  // lane l free from a to b? Single taps in the way move to another lane at the same time if one is
  // open (not the slide's own lane, nothing within 0.1 s, no hold over it, no note at the same time)
  const clear = (l, own, a, b, self) => {
    const hit = notes.filter(n => n !== self && n.lane === l && (n.end ? n.time < b && n.end > a : n.time > a && n.time < b));
    if (hit.some(n => n.end || n.sweep != null || n.path)) return false;
    const moves = [];
    for (const n of hit) {
      const alt = [0, 1, 2, 3].filter(x => x !== l && x !== own).sort((x, y) => Math.abs(x - l) - Math.abs(y - l))
        .find(x => !notes.some(m => m !== n && m.lane === x && (m.end ? m.time < n.time + 0.1 && m.end > n.time - 0.1 : Math.abs(m.time - n.time) < 0.1)) &&
          !moves.some(([m2, x2]) => x2 === x && Math.abs(m2.time - n.time) < 0.1));
      if (alt == null) return false;
      moves.push([n, alt]);
    }
    for (const [n, x] of moves) n.lane = x;
    return true;
  };
  for (const h of notes) {
    if (!h.end || h.sweep != null) continue;
    const dur = h.end - h.time;
    if (dur < beatLen * 1.25 || rand() > rate) continue;
    const slots = [];
    for (let k = 1; h.time + k * beatLen / 2 < h.end - beatLen * 0.45; k++) slots.push(h.time + k * beatLen / 2);
    if (!slots.length) continue;
    const times = dur >= beatLen * 3 && slots.length >= 2
      ? [slots[Math.floor(slots.length / 3)], slots[Math.floor(slots.length * 2 / 3)]]
      : [slots[Math.floor((slots.length - 1) / 2)]];
    if (times.length === 2 && times[0] === times[1]) times.pop();
    const c0 = noteC.get(h) ?? 0;
    const after = cands.filter(c => c.t > times[0] - 0.05 && c.t < h.end);
    const cAfter = after.length ? after.reduce((s, c) => s + c.c, 0) / after.length : c0;
    let dir = Math.abs(cAfter - c0) > 1e-6 ? Math.sign(cAfter - c0) : (h.lane < 2 ? 1 : -1);
    const zig = times.length === 2 && rand() < 0.4;
    const path = [];
    let cur = h.lane;
    for (let k = 0; k < times.length; k++) {
      if (k === 1 && zig) dir = -dir;
      // the lane must stay free to the hold's end: a later bend may still be rejected
      const free = l => l >= 0 && l <= 3 && clear(l, cur, times[k] - D - 0.25, h.end + 0.12, h);
      let nl = cur + dir;
      if (!free(nl)) { dir = -dir; nl = cur + dir; }
      if (!free(nl)) break;
      path.push({ time: +times[k].toFixed(4), lane: nl });
      cur = nl;
    }
    if (path.length) h.path = path;
  }
}

// ---- scroll speed: per-bar loudness (onset strength) splits the song into quiet / normal / loud
// sections of 4+ bars. Quiet ones scroll at x0.6, loud ones at x1.3 (Hard) or x1.5 (Expert); on Expert a
// loud section that follows a quieter one is preceded by a one-beat brake. Points are linearly
// interpolated (two points close together make a step). Returns [{ time, x }] or null.
function speedTrack(an, di, beatLen) {
  const beats = an.beats || [], bb = an.barBeats || 4;
  if (beats.length < bb * 16) return null;
  const bars = [];
  for (let k = ((an.downbeat || 0) % bb + bb) % bb; k + bb < beats.length; k += bb) bars.push([beats[k], beats[k + bb]]);
  const ot = an.onsets.t, os = an.onsets.s;
  const e = bars.map(([a, b]) => {
    let s = 0;
    for (let j = lowerBound(ot, a); j < ot.length && ot[j] < b; j++) s += os[j];
    return s;
  });
  const sm = e.map((_, i) => (e[Math.max(0, i - 1)] + e[i] * 2 + e[Math.min(e.length - 1, i + 1)]) / 4);
  const med = quantile([...sm].sort((a, b) => a - b), 0.5);
  if (!(med > 0)) return null;
  const cls = sm.map(v => (v < med * 0.55 ? -1 : v > med * 1.3 ? 1 : 0));
  // runs; shorter than 4 bars count as normal
  const runs = [];
  for (let i = 0; i < cls.length;) {
    let j = i; while (j < cls.length && cls[j] === cls[i]) j++;
    runs.push({ a: i, b: j, v: j - i >= 4 ? cls[i] : 0 });
    i = j;
  }
  const fast = di >= 3 ? 1.5 : 1.3, slow = 0.6;
  const pts = [{ time: 0, x: 1 }];
  const push = (time, x) => {
    const last = pts[pts.length - 1];
    if (time <= last.time) time = last.time + 0.001;
    pts.push({ time: +time.toFixed(4), x });
  };
  let cur = 1, prevV = 0;
  for (let ri = 0; ri < runs.length; ri++) {
    const r = runs[ri];
    if (r.v === 0) { prevV = 0; continue; }
    const ts = bars[r.a][0], te = bars[r.b - 1][1];
    const nextLoud = runs[ri + 1]?.v > 0;
    const lastT = () => pts[pts.length - 1].time;
    if (r.v < 0) {
      push(ts, cur); push(ts + beatLen, slow);
      if (nextLoud) push(te - 0.02, slow);   // the loud section starts straight from here
      else { push(te - beatLen, slow); push(te, 1); }
    } else {
      if (prevV < 0) push(ts, fast);
      else if (di >= 3 && ts - beatLen * 1.5 > lastT()) { push(ts - beatLen * 1.5, cur); push(ts - beatLen, 0.4); push(ts - 0.02, 0.4); push(ts, fast); }
      else { push(Math.max(lastT(), ts - beatLen), cur); push(ts, fast); }
      push(te - beatLen * 0.5, fast); push(te, 1);
    }
    cur = 1; prevV = r.v;
  }
  return pts.length > 1 ? pts : null;
}

// ---- difficulty rating (roughly 1-20) ----
export function chartStats(notes, duration) {
  if (!notes.length) return { count: 0, holds: 0, nps: 0, peakNps: 0, level: 1 };
  const span = Math.max(10, notes[notes.length - 1].time - notes[0].time);
  const nps = notes.length / span;
  let peak = 0;
  for (let i = 0, j = 0; i < notes.length; i++) {
    while (notes[i].time - notes[j].time > 6) j++;
    peak = Math.max(peak, (i - j + 1) / 6);
  }
  const level = Math.max(1, Math.min(20, Math.round(nps * 1.35 + peak * 0.55 - 0.3)));
  return {
    count: notes.length,
    holds: notes.filter(n => n.end).length,
    nps: +nps.toFixed(2),
    peakNps: +peak.toFixed(2),
    level,
    duration,
  };
}
