// 孤夜's choreography: a keyframed move library (beats as time unit) + a song timeline (bars).
// Arm vectors are LEFT-side directions in chest space (+x = outward, +y = up, +z = toward the audience);
// the rig mirrors them for the right side. Feet: x = outward from centre, z = forward, y = lift.
import { Rig, lerpPose, clonePose } from './rig.js';

// ---------------- vocabulary ----------------
const A = {
  down:   { up: [0.16, -1, 0.04], lo: [0.1, -1, 0.22], fist: 0.25, tw: 0, ftw: 0, peace: 0 },
  hip:    { up: [0.75, -0.7, -0.15], lo: [-0.7, -0.45, 0.2], fist: 0.45, tw: 0.3, ftw: 0, peace: 0 },
  up:     { up: [0.18, 1, 0.08], lo: [0.08, 1, 0.12], fist: 0.1, tw: 0, ftw: 0, peace: 0 },
  upV:    { up: [0.8, 0.8, 0.12], lo: [0.75, 0.85, 0.15], fist: 0.1, tw: 0, ftw: 0, peace: 0 },
  out:    { up: [1, 0.15, 0.3], lo: [0.85, 0.4, 0.35], fist: 0.1, tw: 0, ftw: -0.3, peace: 0 },
  outLow: { up: [0.85, -0.5, 0.2], lo: [0.85, -0.45, 0.3], fist: 0.1, tw: 0, ftw: 0, peace: 0 },
  front:  { up: [0.15, -0.05, 1], lo: [0.05, 0.05, 1], fist: 0.1, tw: 0, ftw: 0, peace: 0 },
  clap:   { up: [0.35, -0.4, 0.85], lo: [-0.7, 0.15, 0.7], fist: 0, tw: 0, ftw: -0.9, peace: 0 },
  clapOpen: { up: [0.55, -0.45, 0.7], lo: [0.1, 0.25, 0.95], fist: 0, tw: 0, ftw: -0.6, peace: 0 },
  clapHi: { up: [0.32, 0.9, 0.3], lo: [-0.55, 0.85, 0.15], fist: 0, tw: 0, ftw: -0.9, peace: 0 },
  clapHiOpen: { up: [0.7, 0.75, 0.25], lo: [0.45, 0.9, 0.15], fist: 0, tw: 0, ftw: -0.6, peace: 0 },
  punch:  { up: [0.28, 1, 0.2], lo: [0.12, 1, 0.12], fist: 1, tw: 0, ftw: 0, peace: 0 },
  pull:   { up: [0.75, -0.35, 0.35], lo: [0.15, 1, 0.2], fist: 1, tw: 0, ftw: 0, peace: 0 },
  guard:  { up: [1, 0, 0.15], lo: [0.05, 1, 0.2], fist: 0.9, tw: 0, ftw: 0, peace: 0 },
  heart:  { up: [0.6, 0.78, 0.25], lo: [-0.8, 0.5, 0.15], fist: 0.6, tw: 0, ftw: -0.4, peace: 0 },
  chest:  { up: [0.35, -0.85, 0.4], lo: [-0.85, 0.3, 0.45], fist: 0.15, tw: 0, ftw: -0.5, peace: 0 },
  cross:  { up: [0.2, -0.3, 0.95], lo: [-0.95, 0.4, 0.2], fist: 0.5, tw: 0, ftw: 0, peace: 0 },
  reach:  { up: [0.4, 0.3, 0.9], lo: [0.35, 0.35, 0.9], fist: 0, tw: 0, ftw: -0.8, peace: 0 },
  peace:  { up: [0.6, -0.65, 0.45], lo: [-0.35, 0.9, 0.25], fist: 1, tw: 0, ftw: -0.3, peace: 1 },
  point:  { up: [0.75, 0.75, 0.35], lo: [0.7, 0.8, 0.4], fist: 0.7, tw: 0, ftw: 0, peace: 0 },
  wave:   { up: [0.85, 0.55, 0.25], lo: [0.4, 1, 0.2], fist: 0, tw: 0, ftw: -0.5, peace: 0 },
};
const F = {
  stand: { x: 0.1, y: 0, z: 0, yaw: 0.12, pitch: 0 },
  wide:  { x: 0.22, y: 0, z: 0, yaw: 0.25, pitch: 0 },
  out:   { x: 0.3, y: 0, z: 0.02, yaw: 0.3, pitch: 0 },
  touch: { x: 0.04, y: 0.03, z: 0.06, yaw: 0, pitch: -0.45 },
  tapF:  { x: 0.12, y: 0.03, z: 0.25, yaw: 0.2, pitch: -0.5 },
  knee:  { x: 0.1, y: 0.32, z: 0.18, yaw: 0.1, pitch: -0.5 },
  kick:  { x: 0.12, y: 0.25, z: 0.4, yaw: 0.1, pitch: -0.3 },
  back:  { x: 0.1, y: 0.02, z: -0.2, yaw: 0.1, pitch: -0.3 },
  cross: { x: -0.06, y: 0, z: 0.1, yaw: -0.2, pitch: 0 },
};
const L = (arm, extra) => ({ l: { ...arm, ...extra } });
const R = (arm, extra) => ({ r: { ...arm, ...extra } });
const both = (arm) => ({ l: { ...arm }, r: { ...arm } });

// ---------------- helpers ----------------
function merge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], v);
    else dst[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  }
  return dst;
}
const P = (...parts) => parts.reduce((o, p) => merge(o, p), {});
const smooth = t => t * t * (3 - 2 * t);
const EASE = {
  io: smooth,
  lin: t => t,
  out: t => 1 - (1 - t) * (1 - t) * (1 - t),       // snap into the pose (hits)
  in: t => t * t,
  hold: t => (t < 1 ? 0 : 1),
  snap: t => 1 - Math.pow(1 - t, 5),
};

export function mirror(p) {
  const o = clonePose(p);
  [o.l, o.r] = [o.r, o.l]; [o.lf, o.rf] = [o.rf, o.lf];
  o.root.x = -o.root.x; o.root.yaw = -o.root.yaw;
  o.hips.x = -o.hips.x; o.hips.ry = -o.hips.ry; o.hips.rz = -o.hips.rz;
  for (const k of ['spine', 'chest', 'neck', 'head']) { o[k][1] = -o[k][1]; o[k][2] = -o[k][2]; }
  if (o.expr) [o.expr.blinkLeft, o.expr.blinkRight] = [o.expr.blinkRight, o.expr.blinkLeft];
  return o;
}

// A move = keyframes [beat, partial pose, ease] over `len` beats (looping). Unspecified fields hold.
function move(len, keys, post) {
  const full = [];
  let cur = Rig.base();
  for (const [b, part, ease] of keys) { cur = merge(clonePose(cur), part); full.push({ b, pose: cur, ease: EASE[ease || 'io'] }); }
  if (full[0].b > 0) full.unshift({ b: 0, pose: full[full.length - 1].pose, ease: EASE.io });
  full.push({ b: len, pose: full[0].pose, ease: full[0].ease });
  return { len, full, post };
}

function sampleMove(m, b) {
  const x = ((b % m.len) + m.len) % m.len;
  let i = 0;
  while (i < m.full.length - 2 && m.full[i + 1].b <= x) i++;
  const k0 = m.full[i], k1 = m.full[i + 1];
  const t = k1.b > k0.b ? (x - k0.b) / (k1.b - k0.b) : 1;
  const e = k1.ease(Math.min(1, Math.max(0, t)));
  const p = lerpPose(k0.pose, k1.pose, e);
  // stepping feet lift off the floor between planted positions
  for (const f of ['lf', 'rf']) {
    const d = Math.hypot(k1.pose[f].x - k0.pose[f].x, k1.pose[f].z - k0.pose[f].z);
    if (d > 0.03) p[f].y += Math.min(0.1, 0.05 + d * 0.3) * Math.sin(Math.PI * Math.min(1, t * 1.15));
  }
  if (m.post) m.post(p, x, b);
  return clonePose(p);
}

// ---------------- moves ----------------
const soft = { hips: { y: -0.035 } };
const MOVES = {};

// intro: back to the audience, turn on bar 3, open up
MOVES.intro = move(16, [
  [0, P(soft, { root: { yaw: Math.PI }, head: [0.35, 0, 0.1], neck: [0.15, 0, 0] }, L(A.hip), R(A.down), { lf: F.stand, rf: { ...F.stand, z: -0.05 }, hips: { x: 0.03, rz: 0.04 }, expr: { happy: 0, blink: 0.5 } })],
  [6, { hips: { x: -0.03, rz: -0.04 } }],
  [8, { root: { yaw: Math.PI * 0.98 }, head: [0.2, 0, 0], hips: { x: 0, rz: 0 } }],
  [10, P({ root: { yaw: 0 }, head: [-0.05, 0.25, 0.05], neck: [0, 0, 0], expr: { happy: 0.6, blink: 0 } }, both(A.outLow), { hips: { x: 0.04, rz: 0.05, y: -0.06 } }), 'io'],
  [12, P(both(A.out), { head: [-0.1, 0, -0.08], chest: [-0.1, 0, 0], hips: { y: -0.02 } }), 'out'],
  [14, P(L(A.hip), R(A.upV), { head: [0, -0.1, 0.12], hips: { x: -0.05, rz: -0.06 }, lf: F.wide, expr: { happy: 0.85 } }), 'snap'],
  [16, {}, 'hold'],
]);

// verse: step-touch with claps
MOVES.stepClap = move(4, [
  [0, P(soft, both(A.outLow), { lf: F.stand, rf: F.out, hips: { x: -0.07, rz: -0.05, y: -0.06 }, head: [0, -0.12, -0.08], chest: [0, -0.1, 0.03] }), 'out'],
  [1, P(both(A.clap), { lf: F.touch, hips: { x: -0.1, y: -0.03 }, head: [0.05, -0.15, -0.1] }), 'snap'],
  [2, P(both(A.outLow), { lf: F.out, rf: F.stand, hips: { x: 0.07, rz: 0.05, y: -0.06 }, head: [0, 0.12, 0.08], chest: [0, 0.1, -0.03] }), 'out'],
  [3, P(both(A.clap), { rf: F.touch, hips: { x: 0.1, y: -0.03 }, head: [0.05, 0.15, 0.1] }), 'snap'],
]);

// verse: point & hip pop, cross, open, shimmy
MOVES.pointHip = move(8, [
  [0, P(soft, R(A.point), L(A.hip), { lf: F.wide, rf: F.wide, hips: { x: 0.07, rz: 0.08, ry: -0.1 }, head: [-0.1, -0.2, -0.05], chest: [0, -0.15, -0.05] }), 'snap'],
  [1, { hips: { x: 0.04, rz: 0.04 }, r: { up: [0.8, 0.65, 0.4] } }],
  [2, P(L(A.point), R(A.hip), { hips: { x: -0.07, rz: -0.08, ry: 0.1 }, head: [-0.1, 0.2, 0.05], chest: [0, 0.15, 0.05] }), 'snap'],
  [3, { hips: { x: -0.04, rz: -0.04 }, l: { up: [0.8, 0.65, 0.4] } }],
  [4, P(both(A.cross), { hips: { x: 0, rz: 0, ry: 0, y: -0.1 }, head: [0.15, 0, 0], chest: [0.12, 0, 0] }), 'out'],
  [5, P(both(A.out), { hips: { y: -0.02 }, head: [-0.12, 0, 0], chest: [-0.12, 0, 0], expr: { happy: 0.9, aa: 0.3 } }), 'snap'],
  [6, P(both(A.hip), { chest: [0, 0, 0], head: [0, 0, 0.1], expr: { aa: 0 } }), 'io'],
  [8, {}, 'io'],
], (p, x) => {
  if (x >= 6) { const s = Math.sin((x - 6) * Math.PI * 4); p.l.sh = [0, 0.15 * s, 0.12 * s]; p.r.sh = [0, -0.15 * s, -0.12 * s]; p.chest[1] += 0.08 * s; }
});

// build: arms overhead swaying, crowd wave
MOVES.waveOver = move(4, [
  [0, P(soft, { l: { up: [0.75, 0.75, 0.15], lo: [0.5, 0.9, 0.1], fist: 0, tw: 0, ftw: -0.5, peace: 0 }, r: { up: [-0.05, 1, 0.15], lo: [-0.35, 0.95, 0.1], fist: 0, tw: 0, ftw: -0.5, peace: 0 } }, { lf: F.wide, rf: F.wide, hips: { x: -0.06, rz: -0.06 }, chest: [0, 0, 0.12], head: [-0.1, 0, 0.1], expr: { happy: 0.6 } })],
  [2, P({ r: { up: [0.75, 0.75, 0.15], lo: [0.5, 0.9, 0.1] }, l: { up: [-0.05, 1, 0.15], lo: [-0.35, 0.95, 0.1] } }, { hips: { x: 0.06, rz: 0.06 }, chest: [0, 0, -0.12], head: [-0.1, 0, -0.1] })],
]);

// pre-chorus: overhead claps on the beat with alternating heel taps
MOVES.clapHigh = move(2, [
  [0, P(soft, both(A.clapHi), { lf: F.stand, rf: F.tapF, hips: { x: 0.03 }, head: [-0.12, 0, 0], expr: { happy: 0.8 } }), 'snap'],
  [0.5, P(both(A.clapHiOpen), { rf: F.stand })],
  [1, P(both(A.clapHi), { lf: F.tapF, hips: { x: -0.03 } }), 'snap'],
  [1.5, P(both(A.clapHiOpen), { lf: F.stand })],
]);

// tension bar before the chorus: crouch, arms crossed, then coil
MOVES.tension = move(4, [
  [0, P(soft, both(A.cross), { lf: F.wide, rf: F.wide, hips: { y: -0.08 }, head: [0.25, 0, 0], chest: [0.15, 0, 0], expr: { happy: 0.3, blink: 0.3 } }), 'out'],
  [2.5, { hips: { y: -0.2 }, head: [0.4, 0, 0], chest: [0.3, 0, 0], spine: [0.15, 0, 0] }, 'io'],
  [3.75, { hips: { y: -0.24 }, expr: { blink: 0 } }, 'io'],
  [4, {}, 'hold'],
]);

// chorus hook A: burst, heart hands sway, punches, open
MOVES.hookA = move(8, [
  [0, P(both(A.upV), { lf: F.out, rf: F.out, hips: { y: -0.03, x: 0, rz: 0 }, head: [-0.2, 0, 0], chest: [-0.15, 0, 0], spine: [0, 0, 0], expr: { happy: 1, aa: 0.5 } }), 'snap'],
  [1, P(both(A.heart), { lf: F.wide, rf: F.wide, hips: { x: 0.06, rz: 0.06, y: -0.05 }, head: [-0.05, 0, 0.15], chest: [0, 0, -0.05], expr: { aa: 0 } }), 'io'],
  [2, { hips: { x: -0.06, rz: -0.06 }, head: [-0.05, 0, -0.15] }, 'io'],
  [3, { hips: { x: 0.06, rz: 0.06 }, head: [-0.05, 0, 0.15] }, 'io'],
  [4, P(R(A.punch), L(A.guard), { hips: { x: -0.04, rz: -0.03, y: -0.07 }, head: [-0.12, -0.1, 0], lf: F.stand, rf: F.out }), 'snap'],
  [5, P(L(A.punch), R(A.guard), { hips: { x: 0.04, rz: 0.03 }, head: [-0.12, 0.1, 0], lf: F.out, rf: F.stand }), 'snap'],
  [6, P(both(A.pull), { hips: { x: 0, rz: 0, y: -0.1 }, head: [0.1, 0, 0], lf: F.wide, rf: F.wide, expr: { aa: 0.4 } }), 'snap'],
  [7, P(both(A.outLow), { hips: { y: -0.04 }, head: [-0.08, 0, 0], expr: { aa: 0 } }), 'out'],
]);

// chorus hook B: knee-lift pulls, body wave, wave-step, spin into point
MOVES.hookB = move(8, [
  [0, P(both(A.punch), { rf: F.knee, lf: F.stand, hips: { x: 0.05, y: -0.02, rz: 0.03 }, head: [-0.15, 0, 0], expr: { happy: 1, aa: 0.3 } }), 'snap'],
  [0.5, P(both(A.pull), { rf: F.stand, hips: { y: -0.08 }, expr: { aa: 0 } }), 'out'],
  [1, P(both(A.punch), { lf: F.knee, rf: F.stand, hips: { x: -0.05, y: -0.02, rz: -0.03 } }), 'snap'],
  [1.5, P(both(A.pull), { lf: F.stand, hips: { y: -0.08 } }), 'out'],
  [2, P(both(A.hip), { lf: F.wide, rf: F.wide, hips: { x: 0, rz: 0, y: -0.04 }, head: [0, 0, 0] }), 'io'],
  [4, P(R(A.wave), L(A.hip), { rf: F.out, hips: { x: -0.08, rz: -0.07 }, head: [-0.05, -0.2, -0.1] }), 'io'],
  [5, P({ rf: F.wide, lf: F.wide, hips: { x: 0.05, rz: 0.03 } }), 'io'],
  [5.5, P(both(A.cross), { lf: F.stand, rf: F.stand, hips: { y: -0.08, x: 0, rz: 0 }, head: [0.1, 0, 0] }), 'io'],
  [7.25, P({ root: { yaw: -Math.PI * 2 }, hips: { y: -0.03 } }, both(A.outLow)), 'io'],
  [7.75, P(R(A.point), L(A.hip), { lf: F.wide, rf: F.wide, hips: { x: 0.05, rz: 0.06, y: -0.05 }, head: [-0.12, -0.15, -0.06], expr: { happy: 1 } }), 'snap'],
  [8, { root: { yaw: -Math.PI * 2 } }, 'hold'],
], (p, x) => {
  if (x >= 2 && x < 4) { const w = Math.sin((x - 2) * Math.PI); p.chest[0] += 0.18 * Math.sin((x - 2) * Math.PI * 2); p.hips.z = 0.04 * Math.sin((x - 2) * Math.PI * 2 - 1); p.head[0] -= 0.1 * Math.sin((x - 2) * Math.PI * 2 + 0.8); p.hips.y -= 0.03 * w; }
  if (x >= 4 && x < 5.5) p.r.hand = [0, 0, 0.5 * Math.sin((x - 4) * Math.PI * 4)];
  if (x >= 7.999) p.root.yaw = 0;
});

// break: slow, emotional
MOVES.ballad = move(16, [
  [0, P(soft, both(A.chest), { lf: F.stand, rf: { ...F.stand, z: 0.06 }, head: [0.25, 0, 0.08], expr: { happy: 0.2, relaxed: 0.6, blink: 0.85 } })],
  [4, P({ head: [-0.25, 0.1, 0.05], neck: [-0.1, 0, 0], expr: { blink: 0, relaxed: 0.5, happy: 0.4 } }, R(A.reach)), 'io'],
  [8, P(L(A.reach), R(A.reach), { head: [-0.15, 0, 0], chest: [-0.08, 0, 0], hips: { z: 0.03 } }), 'io'],
  [12, P(both(A.out), { head: [-0.2, 0, 0.12], chest: [-0.1, 0, 0], hips: { z: 0, y: -0.05 }, expr: { happy: 0.7, relaxed: 0.2 } }), 'io'],
  [15, P(both(A.cross), { head: [0.2, 0, 0], hips: { y: -0.12 } }), 'io'],
  [16, {}, 'hold'],
]);

// verse 2: traveling side shuffle with arm rolls
MOVES.shuffle = move(8, [
  [0, P(soft, both(A.guard), { root: { x: 0 }, lf: F.stand, rf: F.out, hips: { x: -0.06, y: -0.07 }, head: [0, -0.15, 0], expr: { happy: 0.7 } }), 'out'],
  [1, { root: { x: -0.3 }, lf: F.stand, rf: F.stand, hips: { x: 0, y: -0.03 } }, 'io'],
  [2, { root: { x: -0.3 }, rf: F.out, hips: { x: -0.06, y: -0.07 } }, 'out'],
  [3, { root: { x: -0.6 }, rf: F.stand, hips: { x: 0, y: -0.03 }, head: [0, 0.15, 0] }, 'io'],
  [4, { root: { x: -0.6 }, lf: F.out, hips: { x: 0.06, y: -0.07 } }, 'out'],
  [5, { root: { x: -0.3 }, lf: F.stand, hips: { x: 0, y: -0.03 } }, 'io'],
  [6, { root: { x: -0.3 }, lf: F.out, hips: { x: 0.06, y: -0.07 } }, 'out'],
  [7, { root: { x: 0 }, lf: F.stand, hips: { x: 0, y: -0.03 }, head: [0, -0.15, 0] }, 'io'],
], (p, x) => {
  // forearms roll around each other in front of the chest
  const a = x * Math.PI * 2;
  p.l.up = [0.55, -0.55, 0.6]; p.r.up = [0.55, -0.55, 0.6];
  p.l.lo = [-0.8, 0.35 * Math.sin(a), 0.5 + 0.3 * Math.cos(a)];
  p.r.lo = [-0.8, -0.35 * Math.sin(a), 0.5 - 0.3 * Math.cos(a)];
  p.l.fist = p.r.fist = 0.8;
});

// verse 2: body roll + hair flip
MOVES.bodyRoll = move(4, [
  [0, P(soft, L(A.hip), R(A.down), { lf: F.wide, rf: F.wide, expr: { happy: 0.6 } })],
  [2, P(R(A.up), { head: [-0.2, 0.3, 0] })],
  [3, P(R(A.outLow), { head: [0.15, -0.5, 0.2] }), 'snap'],
  [3.6, { head: [0, -0.1, 0.05] }],
], (p, x) => {
  if (x < 2) { const a = x * Math.PI; p.chest[0] += 0.22 * Math.sin(a * 2); p.spine[0] += 0.12 * Math.sin(a * 2 - 0.9); p.hips.z = 0.05 * Math.sin(a * 2 - 1.8); p.head[0] -= 0.12 * Math.sin(a * 2 + 0.9); p.hips.y -= 0.05 * Math.sin(a); }
});

// ending: spin, then peace sign + wink, hold
MOVES.ending = move(16, [
  [0, P(soft, both(A.upV), { lf: F.out, rf: F.out, expr: { happy: 1, aa: 0.4 } }), 'snap'],
  [1, P(both(A.outLow), { lf: F.stand, rf: F.stand, hips: { y: -0.1 }, expr: { aa: 0 } }), 'io'],
  [2.5, P({ root: { yaw: Math.PI * 2 }, hips: { y: -0.03 } }, both(A.up)), 'io'],
  [3, P(R(A.peace), L(A.hip), { root: { yaw: Math.PI * 2 }, lf: F.wide, rf: { ...F.stand, z: 0.08, pitch: -0.2 }, hips: { x: 0.06, rz: 0.08, y: -0.05 }, head: [0.02, -0.12, -0.18], chest: [0, -0.1, -0.05], expr: { happy: 1, blinkRight: 1 } }), 'snap'],
  [16, {}, 'hold'],
], (p, x) => { if (x >= 3) p.root.yaw = 0; });

// ---------------- timeline ----------------
// per song, see timelines.js; [startBar, bars, move, mirrored]
let PLAN = [], SECTIONS = [];
export function useTimeline(tl) { PLAN = tl.plan; SECTIONS = tl.sections; }

const BLEND = 0.5;   // beats of cross-fade between moves
export function poseAt(b, energy = 0.7) {
  const segs = PLAN.map(([s, n, name, mir]) => ({ from: s * 4, to: (s + n) * 4, name, mir }));
  let i = segs.findIndex(s => b < s.to);
  if (i < 0) i = segs.length - 1;
  const seg = segs[i];
  const local = Math.max(0, b - seg.from);
  const evalSeg = (s, lb) => { const m = MOVES[s.name]; const p = sampleMove(m, s.name === 'intro' || s.name === 'ending' || s.name === 'ballad' || s.name === 'tension' ? Math.min(lb, m.len - 1e-3) : lb); return s.mir ? mirror(p) : p; };
  let p = evalSeg(seg, local);
  if (i > 0 && local < BLEND) {
    const prev = segs[i - 1];
    const q = evalSeg(prev, b - prev.from);
    p = lerpPose(q, p, smooth(local / BLEND));
  }
  // groove layer: knees dip on every beat, head nods (scaled by the music's energy)
  const sec = SECTIONS.find(s => b >= s.from * 4 && b < s.to * 4) || SECTIONS[SECTIONS.length - 1];
  const calm = sec.name === 'intro' || sec.name === 'break' || sec.name === 'end' || seg.name === 'tension';
  const amp = calm ? 0.004 : 0.012 + 0.03 * energy;
  const ph = b - Math.floor(b);
  const dip = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * ph), 3);
  p.hips.y -= amp * dip;
  p.head[0] += amp * 1.6 * dip;
  p.chest[0] += amp * 0.8 * dip;
  // a little breathing so holds never freeze
  p.chest[0] += 0.015 * Math.sin(b * Math.PI / 4);
  return { pose: p, section: sec.name, move: seg.name };
}
