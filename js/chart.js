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
export function generateChart(an, difficulty, seed = 1) {
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
  return { notes, stats: chartStats(notes, an.duration) };
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
