// ============================================================
//  孤夜 (Guye): on-stage character, her robots 黑白無常, FEVER gauge, cut-in
//  Drawn into the game canvas; purely visual (never affects score).
// ============================================================

const BASE = 'assets/guye/';
const FONT = '"Segoe UI", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';

function load(name) {
  const img = new Image();
  img.decoding = 'async';
  img.src = BASE + name;
  return img;
}
const ok = img => img && img.complete && img.naturalWidth > 0;

export const ART = {
  stage: 'stage.webp', stageGray: 'stage_gray.webp', heart: 'heart.webp',
  hands: 'hands.webp', invite: 'invite.webp', kneel: 'kneel.webp', kneelGray: 'kneel_gray.webp',
  robotBlack: 'robot_black.webp', robotWhite: 'robot_white.webp', bgBlur: 'bg_blur.jpg', face: 'face.webp',
};

// 黑白無常: her two robots. Each sheet is 10 camera angles side by side (same crop, so they line up).
// 8 = facing us (idle), 1 / 6 = turned left toward the lanes (firing), FEVER cycles through a few angles.
export const ROBOT_FRAMES = 10;
const ROBOT_IDLE = 8;
const ROBOT_FIRE = [1, 6];
const ROBOT_FEVER = [[0, 9, 2, 8], [9, 0, 8, 3]];
// FEVER glow behind each robot, pre-rendered (shadowBlur on a sprite every frame halves the frame rate on phones)
const ROBOT_GLOW = typeof document === 'undefined' ? [] : ['255,61,139', '200,235,255'].map(col => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const p = c.getContext('2d'), gr = p.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, `rgba(${col},0.75)`); gr.addColorStop(0.45, `rgba(${col},0.3)`); gr.addColorStop(1, `rgba(${col},0)`);
  p.fillStyle = gr; p.fillRect(0, 0, 128, 128);
  return c;
});

const LINES = {
  start: ['跟上我的節奏吧♪', '準備好了嗎？', '今晚就交給我吧'],
  combo: ['不錯嘛～', '就是這樣！', '再快一點也沒問題吧？', '手感很好喔♪'],
  fever: ['全開了喔！', '一起嗨起來！'],
  break: ['欸？走神了喔', '沒關係，再來！', '呼…跟緊一點'],
  lowHp: ['撐住啊！'],
  stage: ['舞台開始！', '看好了喔♪', '這才是真正的我！'],
};
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// glowing cut-in text, rendered once per size at 2x (shadowBlur on big text every frame stalls phones)
const glowCache = new Map();
function drawGlowText(g, text, px, blur, x, y) {
  const key = `${text}|${px}|${blur}`;
  let c = glowCache.get(key);
  if (!c) {
    const s = 2, pad = blur * 2;
    c = document.createElement('canvas');
    let p = c.getContext('2d');
    p.font = `italic 900 ${px}px ${FONT}`;
    c.lw = Math.ceil(p.measureText(text).width + px * 0.3) + pad * 2;
    c.lh = Math.ceil(px * 1.4) + pad * 2;
    c.pad = pad;
    c.width = c.lw * s; c.height = c.lh * s;
    p = c.getContext('2d');
    p.scale(s, s);
    p.font = `italic 900 ${px}px ${FONT}`; p.textAlign = 'left'; p.textBaseline = 'middle';
    p.shadowColor = '#ff3d8b'; p.shadowBlur = blur * s; p.fillStyle = '#fff';
    p.fillText(text, pad, c.lh / 2);
    glowCache.set(key, c);
  }
  g.drawImage(c, x - c.pad, y - c.lh / 2, c.lw, c.lh);
}

// where 孤夜's face is inside stage.webp (fraction of the image), for speech bubbles
const STAGE_HEAD = { x: 0.53, y: 0.2 };
const FEVER_MS = 8000;
const CUTIN_MS = 1350;
const CUTIN_COMPACT_MS = 1000;

// one pre-rendered plum petal, shared by every petal particle
const PETAL = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 40;
  const p = c.getContext('2d', { willReadFrequently: true }); // CPU-backed: a GPU sprite made at load can come back blank
  p.translate(20, 20);
  const gr = p.createRadialGradient(0, 0, 1, 0, 0, 18);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#ffb3d4'); gr.addColorStop(1, 'rgba(255,61,139,0)');
  p.fillStyle = gr;
  for (let i = 0; i < 5; i++) { p.beginPath(); p.ellipse(0, -8, 6, 9, 0, 0, Math.PI * 2); p.fill(); p.rotate(Math.PI * 2 / 5); }
  return c;
})();
export { PETAL };

// MV background clips, one set per song (tools/generate_mv.py writes them + mv/manifest.json):
//   songs[id] = { clips: [{ src, track }], fever: { src, track, at } }
// track = 孤夜's horizontal centre in the clip (0..1) every 0.25 s, measured with Gemini and smoothed; the
// game frames her with it (phones only show a strip). The regular clips play in turn while the MV stage is
// on; FEVER jumps to the song's FEVER clip at `at` seconds. Songs without their own MV (uploads) get a
// shuffled mix of every song's clips.
// A song can instead have one full-length dance performance (tools/dance, rendered 3D):
//   songs[id].dance = { src, track, body, dur, av1, hd, portrait: { ... } }
// `src` is framed for wide screens, `portrait` for phones (her upper body in the top half). It is one
// plain video that plays with the song from its first beat to its end on its own element; the MV stage
// only fades it in and out (never paused or seeked for that). Files over Cloudflare's 25 MiB limit are
// stored in parts by the deploy script and joined again by the Worker, so the browser sees one file.
const MV_BASE = BASE + 'mv/';
// dance skeleton (order of BODY_JOINTS in tools/dance/show.js) and the capsules xrayMask builds from it;
// widths are fractions of her neck-to-hips length on screen (sleeves and hair make the arms/head wide)
const BJ = { headTop: 0, headMid: 1, neck: 2, chest: 3, hips: 4, lKnee: 12, lFoot: 13, rKnee: 15, rFoot: 16 };
const BODY_SEGS = [
  [0, 1, 0.42], [1, 2, 0.36], [2, 3, 0.4], [3, 4, 0.4],
  [2, 5, 0.22], [5, 6, 0.2], [6, 7, 0.26], [2, 8, 0.22], [8, 9, 0.2], [9, 10, 0.26],
  [4, 11, 0.28], [11, 12, 0.19], [12, 13, 0.15], [4, 14, 0.28], [14, 15, 0.19], [15, 16, 0.15],
];
const XRAY = 0.85;   // how much of the lanes' dark body she shows through (1 = none of it over her)
const MV_COMBO = 30;   // the MV stage appears at this combo, a miss fades it out again

let mvLib = null;
function mvLibrary() {
  if (!mvLib) {
    mvLib = typeof fetch === 'undefined' ? Promise.resolve({ songs: {} })
      : fetch(MV_BASE + 'manifest.json').then(r => (r.ok ? r.json() : { songs: {} })).catch(() => { mvLib = null; return { songs: {} }; });
  }
  return mvLib;
}

// big screen with a mouse: worth the ~5 MB per clip of the 1440p versions
function mvHd() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: fine)').matches && Math.min(window.innerWidth, window.innerHeight) >= 600
    && window.innerWidth * (window.devicePixelRatio || 1) >= 1400;
}

// AV1 only where the device decodes it in hardware (mediaCapabilities' powerEfficient): software AV1
// decoding next to the game's own drawing made the dance stutter and freeze on some machines. H.264 is
// hardware-decoded nearly everywhere. ?mvcodec=av1|h264 forces one (debugging).
let av1Ok = null;
// a video element parked under the game canvas: screen-sized and all but invisible
const HIDDEN_VIDEO = 'position:fixed;left:0;top:0;width:100vw;height:100vh;opacity:0.01;pointer-events:none;z-index:-1;object-fit:fill';
const MV_DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('mvdebug');
function mvAv1() {
  if (av1Ok) return av1Ok;
  const force = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mvcodec');
  if (force) return (av1Ok = Promise.resolve(force === 'av1'));
  const mc = typeof navigator !== 'undefined' && navigator.mediaCapabilities;
  if (!mc) return (av1Ok = Promise.resolve(false));
  return (av1Ok = mc.decodingInfo({ type: 'file', video: {
    contentType: 'video/mp4; codecs="av01.0.08M.08"', width: 1920, height: 1080, bitrate: 1500000, framerate: 30 } })
    .then(r => !!(r.supported && r.smooth && r.powerEfficient)).catch(() => false));
}

function seedHash(text) {
  let h = 2166136261;
  for (const ch of String(text || '')) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function mvPlan(lib, songId, seed) {
  const own = lib.songs?.[songId];
  if (own?.dance) return { clips: [], fever: null, dance: own.dance };
  if (own && own.clips?.length) return { clips: own.clips, fever: own.fever || null };
  const all = Object.values(lib.songs || {});
  const clips = all.flatMap(s => s.clips || []);
  const fevers = all.map(s => s.fever).filter(Boolean);
  // small deterministic shuffle so each uploaded song always gets the same clips in the same order
  let h = seedHash(seed);
  for (let i = clips.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [clips[i], clips[j]] = [clips[j], clips[i]];
  }
  return { clips: clips.slice(0, 6), fever: fevers.length ? fevers[seedHash(seed + '♪') % fevers.length] : null };
}

// Plays the clips on muted <video> elements: 0 and 1 take turns for the regular clips (the next one is
// already decoded when the current one ends), 2 holds the FEVER clip, paused and already seeked to its
// burst, so neither the MV opening nor FEVER has to load or seek anything at that moment (that used to
// stall the frame). Clips are fetched as blobs before the song starts: blob URLs seek and loop on iOS
// Safari whether or not the server does range requests.
const FEVER_EL = 2;
class MvPlayer {
  constructor() {
    this.url = new Map();   // src -> blob URL once fetched
    this.req = new Map();   // src -> fetch promise
    this.els = [];
    this.cur = -1;          // element on screen
    this.prev = -1;         // element shown before it (its last frame covers a cut)
    this.clip = null;       // clip on screen
    this.plan = { clips: [], fever: null };
    this.pos = 0;
    this.cutAt = -1e9;
    this.want = false;      // the game wants it playing
    this.gen = 0;           // bumps on every start(), to drop stale callbacks
    this.key = null;
    this.dance = null;      // full-length dance clip for this song (synced to the song), see mvPlan
    this.songT = 0;         // song time in seconds, set by the game every frame
    this.portrait = () => false;
    this.seekAt = -1e9;
    this.seekLat = 0.2;     // measured seek time (s), see sync
  }

  fetchClip(c) {
    if (!c) return Promise.resolve(null);
    if (!this.req.has(c.src) && typeof fetch !== 'undefined') {
      // desktops get the 1440p upscale (hd/); phones, and any clip without one, the 720p file
      // clips with an AV1 encode (same size, much sharper) use it where AV1 is hardware-decoded (mvAv1)
      let pre = '';
      const get = src => fetch(MV_BASE + pre + src).then(r => (r.ok ? r.blob() : null));
      this.req.set(c.src, (c.av1 ? mvAv1() : Promise.resolve(false)).then(av1 => { pre = av1 ? 'av1/' : ''; if (c === this.dance) this.av1Used = av1; })
        .then(() => (mvHd() ? get('hd/' + c.src).catch(() => null) : null))
        .then(b => b || get(c.src))
        .then(b => { if (b) this.url.set(c.src, URL.createObjectURL(b)); return this.url.get(c.src) || null; })
        .catch(() => { this.req.delete(c.src); return null; }));
    }
    return this.req.get(c.src) || Promise.resolve(null);
  }

  preload() { mvLibrary(); }

  el(i) {
    if (!this.els[i]) {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      // in the DOM, screen-sized, under the (opaque) game canvas: some iOS versions stop decoding detached
      // videos, and WebKit may throttle or pause muted videos it considers too small or off screen
      v.style.cssText = HIDDEN_VIDEO;
      v.addEventListener('seeked', () => {
        if (this.seekT0 == null) return;
        // how long a seek really takes here (slow on iOS Safari): the next one aims that far ahead
        const lat = Math.min(0.8, (performance.now() - this.seekT0) / 1000);
        this.seekLat = this.seekLat * 0.5 + lat * 0.5;
        this.seekT0 = null;
      });
      v.addEventListener('ended', () => { if (this.els[this.cur] === v) this.advance(); });
      document.body.appendChild(v);
      this.els[i] = v;
    }
    return this.els[i];
  }

  // put clip c into element e at time t, paused (no reload / no seek when it is already there)
  cue(e, c, t = 0) {
    const v = this.el(e), u = this.url.get(c.src);
    if (!u) return;
    if (v.dataset.src !== c.src) {
      v.src = u; v.dataset.src = c.src;
    }
    if (Math.abs(v.currentTime - t) > 0.04) { try { v.currentTime = t; } catch { /* not seekable yet */ } }
    if (!v.paused) v.pause();
  }

  // a regular slot (0/1) that is not on screen, preferring one that already holds clip c
  slotFor(c) {
    const free = [0, 1].filter(i => i !== this.cur);
    return free.find(i => this.els[i]?.dataset.src === c.src) ?? free[0];
  }

  // Load the song's clips and park them, decoded, in their elements. Awaited (with a timeout) while the
  // song is loading, and again (all cached by then) when the game starts.
  async start(seed, songId) {
    const gen = ++this.gen;
    this.want = false;
    for (const v of this.els) v && v.pause();
    this.cur = -1; this.prev = -1; this.clip = null; this.pos = 0;
    const lib = await mvLibrary();
    if (gen !== this.gen) return;
    this.plan = mvPlan(lib, songId, seed);
    const d = this.plan.dance;
    this.dance = d ? (this.portrait() && d.portrait ? d.portrait : d) : null;
    this.bodyData = null;
    if (this.dance?.body && typeof fetch !== 'undefined') {
      fetch(MV_BASE + this.dance.body).then(r => (r.ok ? r.json() : null))
        .then(b => { if (b && gen === this.gen) this.bodyData = b; }).catch(() => {});
    }
    if (this.dance) {
      this.songT = 0;   // (still the last song's time until the game's first sync)
      const d = this.dance, av1 = d.av1 ? await mvAv1() : false;
      if (gen !== this.gen) return;
      this.av1Used = av1;
      // streamed straight from its URL (no blob: it starts before the whole file has arrived)
      this.url.set(d.src, MV_BASE + (av1 ? 'av1/' : '') + (d.hd && mvHd() && !this.portrait() ? 'hd/' : '') + d.src);
      this.cue(0, d, 0);
      return;
    }
    const [first, second] = this.plan.clips, fever = this.plan.fever;
    await Promise.all([
      this.fetchClip(first).then(u => { if (u && gen === this.gen && this.cur < 0) this.cue(0, first); }),
      this.fetchClip(fever).then(u => { if (u && gen === this.gen && this.cur !== FEVER_EL) this.cue(FEVER_EL, fever, fever.at); }),
    ]);
    if (gen !== this.gen || !second) return;
    this.fetchClip(second).then(u => { if (u && gen === this.gen && this.cur < 0) this.cue(1, second); });
  }

  // swap the visible element to e, showing clip c from time t
  show(e, c, t, now) {
    if (this.cur >= 0 && this.cur !== e) this.els[this.cur].pause();
    this.cue(e, c, t);
    if (this.clip) this.cutAt = now;
    const left = this.cur;
    this.prev = this.cur; this.cur = e; this.clip = c;
    this.play(now);
    if (!this.dance) this.prepNext();
    // FEVER clip left the screen: park it at its burst again, for the next FEVER
    const f = this.plan.fever;
    if (left === FEVER_EL && e !== FEVER_EL && f) this.cue(FEVER_EL, f, f.at);
  }

  nextClip() {
    const cl = this.plan.clips;
    return cl.length ? cl[(this.pos + 1) % cl.length] : null;
  }

  // fetch the clip after the current one and cue it in a hidden regular element
  prepNext() {
    const n = this.nextClip(), gen = this.gen;
    this.fetchClip(n).then(u => {
      if (!u || gen !== this.gen || this.nextClip() !== n) return;
      const e = this.slotFor(n);
      if (e !== this.cur) this.cue(e, n);
    });
  }

  // current clip ended: next clip if it has arrived, otherwise replay this one
  advance(now = performance.now()) {
    if (this.dance) return;   // the dance ends with the song: hold its last frame
    const n = this.nextClip();
    if (n && this.url.get(n.src)) { this.pos = (this.pos + 1) % this.plan.clips.length; this.show(this.slotFor(n), n, 0, now); }
    else if (this.cur >= 0) { const v = this.els[this.cur]; v.currentTime = 0; this.play(now); this.prepNext(); }
  }

  // FEVER: cut straight to the song's FEVER clip (already parked at its burst)
  fever(now) {
    const f = this.plan.fever;
    if (this.dance) return;
    if (!f || !this.url.get(f.src) || !this.want || this.cur === FEVER_EL) return;
    this.show(FEVER_EL, f, f.at, now);
  }

  // the dance's time in the song
  danceT() {
    const v = this.els[this.cur];
    return v && this.clip === this.dance ? v.currentTime : 0;
  }

  play(now = performance.now()) {
    this.want = true;
    if (!this.clip && this.dance) {
      // opening seek: aim ahead by the measured seek time so it lands on the song clock
      if (this.url.get(this.dance.src)) this.show(0, this.dance, this.clampT(this.songT + this.seekLat, 0), now);
      return;
    }
    if (!this.clip) {
      const first = this.plan.clips[this.pos];
      if (first && this.url.get(first.src)) this.show(this.slotFor(first), first, 0, now);
      return;
    }
    if (this.dance) return;   // sync() starts it on the song clock
    const v = this.els[this.cur];
    if (v && v.paused) v.play().catch(() => {});
  }
  clampT(t, e = this.cur) {
    const v = this.els[e];
    return Math.max(0, Math.min(t, (v && v.duration) ? v.duration - 0.05 : t));
  }

  // dance: keep the video on the song clock. Drift is corrected by nudging the playback rate (up to
  // +-15%, invisible in a dance); a seek only for a big jump (stage reopened, tab switch, stall), aimed
  // ahead by the measured seek time and never while one is in flight. Seeking whenever it was 0.25 s off
  // used to loop on iOS Safari: a seek took longer than that, so the video landed behind again, seeked
  // again, and showed one frozen pose meanwhile.
  sync(t, now = performance.now()) {
    this.songT = t;
    const v = this.els[this.cur];
    if (!this.dance || !this.want || !v || this.clip !== this.dance) return;
    if (t < 0 || (v.duration && t >= v.duration - 0.05)) { if (!v.paused) v.pause(); return; }
    if (v.paused) v.play().catch(() => {});
    if (v.seeking) { this.dbg(v, t); return; }
    // stalled: playing but the picture has not moved for a while (decoder starved / throttled)
    if (v.currentTime !== this.lastVT) { this.lastVT = v.currentTime; this.movedAt = now; }
    // (not while it waits for data still on its way: a seek would not help)
    const stalled = !v.paused && v.readyState >= 3 && now - (this.movedAt ?? now) > 600;
    const drift = v.currentTime - t;
    // on screen it never seeks (an iOS seek shows one frozen pose for a while): speed nudges only
    if (!this.visible && (Math.abs(drift) > 0.6 || stalled) && now - this.seekAt > 1500) {
      this.seekAt = now; this.movedAt = now; this.seeks = (this.seeks || 0) + 1;
      v.playbackRate = 1;
      this.seekT0 = now;
      try { v.currentTime = this.clampT(t + this.seekLat + 0.03); } catch { /* not seekable yet */ }
    } else {
      const lim = Math.abs(drift) > 0.6 ? 0.3 : 0.15;   // far off while visible: catch up faster
      const rate = Math.abs(drift) < 0.03 ? 1 : Math.min(1 + lim, Math.max(1 - lim, 1 - drift * 0.5));
      if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
    }
    this.dbg(v, t);
  }

  // ?mvdebug: the dance video's state on screen (for phones, where there is no console)
  dbg(v, t) {
    if (!MV_DEBUG) return;
    const now = performance.now();
    if (now - (this.dbgAt || 0) < 200) return;
    this.dbgAt = now;
    if (!this.dbgEl) {
      this.dbgEl = document.createElement('div');
      this.dbgEl.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99;font:11px/1.3 monospace;color:#0f0;background:rgba(0,0,0,.6);padding:3px 5px;pointer-events:none;white-space:pre';
      document.body.appendChild(this.dbgEl);
    }
    const src = (v.dataset.src || '') + (this.av1Used ? ' av1' : ' h264');
    this.dbgEl.textContent = `${src} ${v.videoWidth}x${v.videoHeight}\n` +
      `song ${t.toFixed(2)} vid ${v.currentTime.toFixed(2)} drift ${(v.currentTime - t).toFixed(2)} rate ${v.playbackRate.toFixed(2)}\n` +
      `paused ${v.paused} seeking ${v.seeking} ready ${v.readyState} seeks ${this.seeks || 0} lat ${this.seekLat.toFixed(2)}` +
      ` buf ${v.buffered.length ? v.buffered.start(0).toFixed(0) + '-' + v.buffered.end(v.buffered.length - 1).toFixed(0) : '-'}`;
  }

  pause() {
    this.want = false;
    for (const v of this.els) v && v.pause();
  }
  // the dance is shown by the <video> element itself, placed under the canvas (see drawMv)
  place(v, x, y, w, h) {
    const st = v.style;
    st.opacity = '1'; st.left = x + 'px'; st.top = y + 'px'; st.width = w + 'px'; st.height = h + 'px';
    this.placed = v;
  }
  unplace() {
    if (this.placed) { this.placed.style.cssText = HIDDEN_VIDEO; this.placed = null; }
  }

  // the element to draw, once it has a frame
  frame() {
    if (!this.clip) return null;
    const ready = v => (v && v.readyState >= 2 && v.videoWidth ? v : null);
    // right after a cut the new clip may need a frame or two: keep the last frame of the old one
    return ready(this.els[this.cur]) || ready(this.els[this.prev]);
  }
  // dance only: her skeleton in the frame right now, BODY_JOINTS points as [x, y] (0..1 of the video)
  body() {
    const b = this.bodyData, v = this.els[this.cur];
    if (!b || !v || this.clip !== this.dance) return null;
    const n = b.n, frames = b.f.length / (n * 2);
    const k = Math.max(0, Math.min(frames - 1, this.danceT() * b.fps));
    const i = Math.floor(k), j = Math.min(frames - 1, i + 1), u = k - i;
    const out = [];
    for (let p = 0; p < n; p++) {
      const a = (i * n + p) * 2, c = (j * n + p) * 2;
      out.push([(b.f[a] + (b.f[c] - b.f[a]) * u) / 1000, (b.f[a + 1] + (b.f[c + 1] - b.f[a + 1]) * u) / 1000]);
    }
    return out;
  }
  // where she stands right now in the current clip
  focus() {
    const dance = !!this.clip && this.clip === this.dance;
    const m = dance ? this.dance : this.clip, v = this.els[this.cur];
    if (!m || !v || !m.track?.length) return 0.5;
    const tr = m.track, k = Math.max(0, Math.min(tr.length - 1, (dance ? this.danceT() : v.currentTime) * 4));
    const i = Math.floor(k), j = Math.min(tr.length - 1, i + 1);
    return tr[i] + (tr[j] - tr[i]) * (k - i);
  }
}

export class Character {
  constructor() {
    this.img = {};
    for (const [k, f] of Object.entries(ART)) this.img[k] = load(f);
    this.mv = new MvPlayer();
    this.mv.portrait = () => this.mode !== 'side';
    this.mv.preload();
    this.enabled = true;
    this.cutinEnabled = true;   // 'full' presentation; false = light (no cut-in, no afterimage, fewer petals)
    this.warmed = false;
  }

  // Decode every image and push it through a canvas once, so the first time a pose / the FEVER cut-in
  // art appears mid-song it doesn't stall a frame on a synchronous decode + texture upload.
  warm() {
    if (this.warmed || typeof document === 'undefined') return Promise.resolve();
    const c = document.createElement('canvas'); c.width = c.height = 4;
    const g = c.getContext('2d');
    return Promise.all(Object.values(this.img).map(img =>
      (img.decode ? img.decode() : Promise.resolve()).then(() => { try { g.drawImage(img, 0, 0, 4, 4); } catch { /* not loaded */ } }, () => {}),
    )).then(() => { this.warmed = Object.values(this.img).every(ok); });
  }

  // while the song loads: decode the art and fetch + park this song's MV clips (resolves within `ms`)
  prepare(seed, songId, ms = 5000) {
    const jobs = [this.warm()];
    if (this.enabled && this.cutinEnabled) jobs.push(this.mv.start(seed, songId));
    return Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, ms))]);
  }

  // ---------- lifecycle ----------
  reset(now, seed = '', songId = null) {
    this.bump = 0;
    this.missAt = -1e9;
    this.pose = null;           // { img, until, scale } temporary standing pose
    this.poseFade = 0;
    this.lastPoseImg = null;
    this.fever = 0;
    this.feverUntil = 0;
    this.cutinAt = -1e9;
    this.beams = [];
    this.petals = [];
    this.lastBeat = -1;
    this.bars = 0;
    this.bubble = { text: pick(LINES.start), at: now + 2200, dur: 2400 };
    this.lowHpSaid = false;
    this.fig = null;
    // MV background: on with the character in standard presentation, off in light mode
    this.mvOn = this.enabled && this.cutinEnabled;
    this.stageOn = false;       // MV earned by combo
    this.stageA = 0;            // its fade
    this.camF = null;
    this.mv.pause();
    this.mv.unplace();
    if (this.mvOn) this.mv.start(seed, songId);
  }

  pauseMv() { this.mv.pause(); }
  stopMv() { this.mv.pause(); this.mv.unplace(); }
  resumeMv() { if (this.mvOn && (this.stageOn || this.mv.dance)) this.mv.play(); }

  // an MV frame is on screen: the 2D stage figure stays hidden so she isn't shown twice
  mvFrame() { return this.mvOn && this.mode !== 'off' ? this.mv.frame() : null; }

  get compact() { return this.mode === 'behind'; }
  cutinMs() { return this.compact ? CUTIN_COMPACT_MS : CUTIN_MS; }

  // the game asks for the playfield placement; 'side' leaves room for 孤夜 on the right
  layout(W, H) {
    const side = this.enabled && W >= 760 && W / H >= 1.15;
    this.mode = !this.enabled ? 'off' : side ? 'side' : 'behind';
    return null; // the game centres the field (a perspective neck on wide screens)
  }

  // ---------- events from the game ----------
  onHit(lane, tierKey, now, combo) {
    if (this.mode === 'off') return;
    this.bump = 1;
    this.beams.push({ lane, at: now, d: lane < 2 ? 0 : 1 });
    if (this.beams.length > 12) this.beams.shift();
    if (now >= this.feverUntil) {
      this.fever += tierKey === 'perfect' ? 0.022 : tierKey === 'great' ? 0.014 : 0.005;
      if (this.fever >= 1) {
        this.fever = 1;
        this.feverUntil = now + FEVER_MS;
        const ms = this.cutinEnabled ? this.cutinMs() : 0;
        if (this.cutinEnabled) this.cutinAt = now;
        this.say(pick(LINES.fever), now, 1800, ms);
        this.burstPetals(now, 26);
        if (this.mvOn) { this.openStage(now, false); this.mv.fever(now); }
      }
    }
    if (combo >= MV_COMBO && !this.stageOn && this.mvOn) this.openStage(now, true);
    if (combo > 0 && combo % 50 === 0) {
      this.setPose(this.img.heart, now, 2400, 1.18);
      this.say(pick(LINES.combo), now);
      this.burstPetals(now, 16);
    }
  }

  onMiss(now, brokenCombo) {
    if (this.mode === 'off') return;
    this.missAt = now;
    if (this.stageOn && now >= this.feverUntil) this.stageOn = false;
    if (now >= this.feverUntil) this.fever = Math.max(0, this.fever - 0.12);
    if (brokenCombo >= 20) this.say(pick(LINES.break), now);
  }

  onHp(hp, now) {
    if (hp < 25 && !this.lowHpSaid) { this.lowHpSaid = true; this.say(pick(LINES.lowHp), now); }
    if (hp > 50) this.lowHpSaid = false;
  }

  // the MV stage lights up: flash, petals, a line from her
  openStage(now, announce) {
    if (this.stageOn) return;
    this.stageOn = true;
    this.mv.play(now);
    this.mv.cutAt = now;
    if (announce) { this.say(pick(LINES.stage), now, 1800); this.burstPetals(now, 18); }
  }

  say(text, now, dur = 2000, delay = 0) {
    this.bubble = { text, at: now + delay, dur };
  }

  setPose(img, now, ms, scale) {
    this.pose = { img, until: now + ms, scale };
  }

  burstPetals(now, n) {
    if (!this.cutinEnabled) n = Math.round(n / 3);
    for (let i = 0; i < n; i++) {
      this.petals.push({
        x: Math.random(), y: -0.05 - Math.random() * 0.25, s: 0.5 + Math.random() * 0.8,
        vx: (Math.random() - 0.3) * 0.00012, vy: 0.00028 + Math.random() * 0.00026,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.006, born: now,
      });
    }
  }

  inFever(now) { return now < this.feverUntil; }

  // ---------- drawing ----------
  // behind everything: background art + 孤夜 herself.  beat = { k, frac, isBar }
  drawBack(g, game, now, pulse, beat = { k: 0, frac: 0, isBar: false }) {
    if (this.mode === 'off') return;
    const { W, H } = game;
    const dt = Math.min(50, now - (this.lastDraw || now)); this.lastDraw = now;
    const fever = this.inFever(now);
    const bg = this.img.bgBlur;
    // MV stage: plays while earned, fades in fast and out a little slower, paused once hidden
    // (a dance plays the whole song, shown or not: only its fade follows the stage)
    if (this.mvOn && game.state === 'playing') {
      if (this.stageOn || this.mv.dance) this.mv.play(now);
      else if (this.stageA < 0.01 && this.mv.want) this.mv.pause();
    }
    // seeks freeze the picture on iOS: the dance only seeks while it is hidden
    this.mv.visible = this.stageA > 0.01;
    this.mv.sync((game.songTime ?? 0) / 1000, now);
    const video = this.mvFrame();
    const goal = this.stageOn && video ? 1 : 0;
    this.stageA += (goal - this.stageA) * Math.min(1, dt / (goal ? 220 : 380));
    if (this.stageA < 0.005) this.stageA = 0;
    const mvA = video ? this.stageA : 0;
    if (mvA < 1 && ok(bg)) {
      const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight) * (1.04 + 0.01 * pulse);
      const bw = bg.naturalWidth * s, bh = bg.naturalHeight * s;
      g.globalAlpha = this.mode === 'side' ? 0.34 : 0.22;
      g.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
      g.globalAlpha = 1;
    }
    this.mvRect = null;
    this.mvPlaced = false;
    if (mvA > 0) this.drawMv(g, game, video, now, pulse, mvA);
    // the dance element stays laid out, full size and opaque (covered by the canvas) while it is hidden:
    // iOS throttles or stops decoding a video it thinks is invisible, which made it fall behind
    if (!this.mvPlaced) {
      const dv = this.mv.dance && this.mv.clip === this.mv.dance && this.mv.want ? this.mv.els[this.mv.cur] : null;
      if (dv) { if (this.mv.placed !== dv) this.mv.place(dv, 0, 0, W, H); } else this.mv.unplace();
    }
    // fever: pink wash pulsing on the beat
    if (fever) {
      const left = Math.min(1, (this.feverUntil - now) / 600);
      g.fillStyle = `rgba(255,61,139,${(0.06 + pulse * 0.08) * left})`;
      g.fillRect(0, 0, W, H);
    }

    // count bars; every 8 bars she changes to a standing pose for a bar or two (wide screens)
    if (beat.k !== this.lastBeat) {
      this.lastBeat = beat.k;
      if (beat.isBar) {
        this.bars++;
        if (this.mode === 'side' && this.bars % 8 === 0 && !(this.pose && now < this.pose.until)) {
          const img = this.lastPoseImg === this.img.hands ? this.img.invite : this.img.hands;
          this.lastPoseImg = img;
          this.setPose(img, now, 2600, 1.12);
        }
      }
    }

    // stage light beams from the top, flaring on each bar
    if (this.cutinEnabled) {
      const flare = beat.isBar ? pulse : pulse * 0.35;
      if (flare > 0.02 || fever) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        const base = 0;
        const span = W - base;
        for (let i = 0; i < 3; i++) {
          const x = base + span * (0.2 + i * 0.32);
          const ang = Math.sin(now / 1400 + i * 2) * 0.35;
          const a = (fever ? 0.08 : 0) + flare * 0.16;
          const gr = g.createLinearGradient(x, 0, x + Math.sin(ang) * H, H);
          const col = i === 1 ? '63,212,255' : '255,61,139';
          gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
          g.fillStyle = gr;
          g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x + 6, 0);
          g.lineTo(x + Math.sin(ang) * H + 90, H); g.lineTo(x + Math.sin(ang) * H - 90, H); g.closePath(); g.fill();
        }
        g.restore();
      }
    }

    const fig = this.figureRect(game);
    if (!fig) return;
    if (mvA > 0.99) { this.fig = fig; this.drawPetals(g, W, H, now, dt); return; }
    const missA = Math.max(0, 1 - (now - this.missAt) / 380);
    const shake = missA > 0 ? Math.sin(now * 0.09) * 6 * missA : 0;
    this.bump *= Math.pow(0.86, dt / 16.7);
    // dance: sway one way per beat, squash a little on the downbeat
    const sway = Math.sin(Math.PI * (beat.k + beat.frac)) * 0.014;
    const squash = beat.isBar ? pulse * 0.022 : pulse * 0.01;
    const lift = -this.bump * 7;

    const poseOn = this.pose && now < this.pose.until;
    this.poseFade += ((poseOn ? 1 : 0) - this.poseFade) * Math.min(1, 0.18 * dt / 16.7);
    if (!poseOn && this.poseFade < 0.01) this.pose = null;
    const baseA = (this.mode === 'side' ? 1 : 0.3) * (1 - mvA);

    const drawFig = (img, alpha, rect, extra) => {
      if (!ok(img) || alpha <= 0.01) return;
      g.save();
      g.globalAlpha = alpha * baseA;
      if (extra) g.globalCompositeOperation = 'lighter';
      g.translate(rect.cx + shake + (extra ? extra.dx : 0), rect.bottom + lift);
      g.rotate(sway);
      g.scale(1 + squash * 0.6, 1 - squash);
      g.drawImage(img, -rect.w / 2, -rect.h, rect.w, rect.h);
      g.restore();
    };
    const standRect = (img, scale) => {
      const h = fig.h * scale, w = h * (img.naturalWidth / img.naturalHeight || 0.65);
      return { cx: fig.cx + fig.w * 0.05, bottom: fig.bottom + fig.h * 0.12, w, h };
    };
    const stageA = 1 - this.poseFade;
    // FEVER afterimage: two faint glowing copies trailing the figure
    if (fever && this.cutinEnabled) {
      const off = 8 + pulse * 10;
      const img = this.pose && this.poseFade > 0.5 ? this.pose.img : this.img.stage;
      const rect = img === this.img.stage ? fig : standRect(img, this.pose.scale);
      drawFig(img, 0.16, rect, { dx: -off });
      drawFig(img, 0.16, rect, { dx: off });
    }
    drawFig(this.img.stage, stageA * (1 - missA * 0.85), fig);
    drawFig(this.img.stageGray, stageA * missA * 0.85, fig);
    if (this.pose && this.poseFade > 0.01) drawFig(this.pose.img, this.poseFade, standRect(this.pose.img, this.pose.scale));
    this.fig = fig;
    this.drawPetals(g, W, H, now, dt);
  }

  // See-through lanes: game.drawNeck cuts this silhouette out of the neck's dark body (the beat lines,
  // notes, strings and judge row are drawn on top as usual), so 孤夜 stays visible behind the lanes
  // without the notes losing contrast, and the video is still drawn only once. The silhouette is soft
  // capsules along her skeleton (exported per frame by tools/dance), drawn into a small canvas: scaling
  // it up feathers the edge for free. Returns null when there is nothing to cut.
  xrayMask(game) {
    const r = this.mvRect, pts = r && this.mv.body();
    if (!pts || this.mode === 'off') return null;
    const P = pts.map(([u, v]) => [r.x + u * r.vw, r.y + v * r.vh]);
    const s = Math.hypot(P[BJ.neck][0] - P[BJ.hips][0], P[BJ.neck][1] - P[BJ.hips][1]);
    if (s < 8) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = s * 0.75;
    x0 = Math.floor(Math.max(0, x0 - pad)); y0 = Math.floor(Math.max(0, y0 - pad));
    x1 = Math.ceil(Math.min(game.W, x1 + pad)); y1 = Math.ceil(Math.min(game.H, y1 + pad));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 4 || bh < 4) return null;
    // mask at 1/6 resolution
    const M = 6, mw = Math.ceil(bw / M), mh = Math.ceil(bh / M);
    const mc = this.xrMask || (this.xrMask = document.createElement('canvas'));
    if (mc.width < mw || mc.height < mh) { mc.width = Math.max(mc.width, mw); mc.height = Math.max(mc.height, mh); }
    const m = mc.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, mc.width, mc.height);
    m.setTransform(1 / M, 0, 0, 1 / M, -x0 / M, -y0 / M);
    m.strokeStyle = '#fff'; m.lineCap = 'round'; m.lineJoin = 'round';
    const mid = (a, b) => [(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2];
    const seg = (a, b, w) => {
      m.lineWidth = 2 * w * s;
      m.beginPath(); m.moveTo(a[0], a[1]); m.lineTo(b[0] + 0.01, b[1]); m.stroke();
    };
    for (const [a, b, w] of BODY_SEGS) seg(P[a], P[b], w);
    // kimono skirt: hips down to between the knees and shins
    seg(P[BJ.hips], mid(BJ.lKnee, BJ.rKnee), 0.42);
    seg(P[BJ.hips], mid(BJ.lFoot, BJ.rFoot), 0.3);
    // keep the judge row readable: the see-through fades out toward the judge line
    m.setTransform(1 / M, 0, 0, 1 / M, -x0 / M, -y0 / M);
    m.globalCompositeOperation = 'destination-in';
    const jy = game.judgeY, fade = m.createLinearGradient(0, jy - game.H * 0.3, 0, jy);
    fade.addColorStop(0, 'rgba(255,255,255,1)'); fade.addColorStop(1, 'rgba(255,255,255,0.25)');
    m.fillStyle = fade; m.fillRect(x0, y0, bw, bh);
    m.globalCompositeOperation = 'source-over';

    return { mask: mc, M, mw, mh, x0, y0, bw, bh, alpha: XRAY * r.a };
  }

  // MV clip as the stage. Wide screens frame 孤夜 in the area right of the lanes; narrow screens
  // centre her behind the lanes. Dimmed so the notes stay readable; a short flash hides clip cuts.
  drawMv(g, game, v, now, pulse, a = 1) {
    const { W, H } = game;
    const side = this.mode === 'side';
    const vw0 = v.videoWidth, vh0 = v.videoHeight;
    // wide screens: she dances right of the neck, the video fills the whole screen; a dance rendered
    // with `center` puts her behind the middle of the neck instead (xrayMask thins the lanes over her)
    const centred = side && this.mv.dance?.center;
    const target = side && !centred ? (game.bx(4, game.judgeY) + W) / 2 : W / 2;
    // follow her smoothly; snap on a cut
    const raw = this.mv.focus();
    if (this.camF == null || this.camCut !== this.mv.cutAt) { this.camF = raw; this.camCut = this.mv.cutAt; }
    else this.camF += (raw - this.camF) * 0.06;
    const f = Math.min(0.9, Math.max(0.1, this.camF));
    // smallest width that puts her at `target` and covers everything from `need` to the right edge
    // (wide screens: only right of the lanes must be covered, the lanes have an opaque backing)
    const need = 0;
    const cover = Math.max(H * vw0 / vh0, W - need);
    let vw = Math.max(cover, (target - need) / f, (W - target) / (1 - f));
    // wide screens: the video fills the screen; only a mild zoom is allowed for nudging her right,
    // otherwise she gets cropped (head cut off, only her body showing)
    if (side) vw = Math.min(vw, cover * 1.3);
    vw *= 1 + 0.008 * pulse;
    const vh = vw * vh0 / vw0;
    const x = Math.min(need, Math.max(W - vw, target - f * vw));
    // keep the top of the frame (her head) in view on wide screens
    // (the dance is framed with her head near the top: on tall screens keep that part, not the middle)
    const y = side ? (H - vh) * 0.12 : (H - vh) * (this.mv.dance ? 0.15 : 0.5);
    const va = (side ? 1 : 0.9) * a;
    if (this.mv.dance && this.mv.clip === this.mv.dance && v === this.mv.els[this.mv.cur]) {
      // the dance: copying a big video frame into the canvas every frame stalls iOS Safari (the picture
      // freezes), so the <video> element itself shows under the canvas, which is cut to the same alpha
      g.save();
      g.globalCompositeOperation = 'destination-out'; g.globalAlpha = va; g.fillStyle = '#000';
      g.fillRect(x, y, vw, vh);
      g.restore();
      this.mv.place(v, x, y, vw, vh);
      this.mvPlaced = true;
    } else {
      g.globalAlpha = va;
      // default (bilinear) smoothing: 'high' on a full-screen video frame costs GPU time every frame
      g.imageSmoothingEnabled = true;
      g.drawImage(v, x, y, vw, vh);
      g.globalAlpha = 1;
    }
    this.mvRect = { v, x, y, vw, vh, a };
    if (x > 0) {
      // soften the video's left edge into the background
      const fade = g.createLinearGradient(x, 0, x + 140, 0);
      fade.addColorStop(0, 'rgba(6,5,13,1)'); fade.addColorStop(1, 'rgba(6,5,13,0)');
      g.fillStyle = fade;
      g.globalAlpha = a;
      g.fillRect(x, 0, 140, H);
      g.globalAlpha = 1;
    }
    // dim, plus a darker band behind the lanes is drawn by the game; a miss briefly darkens the stage
    const missA = Math.max(0, 1 - (now - this.missAt) / 380);
    g.fillStyle = `rgba(6,5,13,${((side ? 0.18 : 0.1) + missA * 0.3) * a})`;
    g.fillRect(0, 0, W, H);
    const cut = 1 - (now - this.mv.cutAt) / 260;
    if (cut > 0) {
      g.fillStyle = `rgba(255,190,225,${cut * 0.55})`;
      g.fillRect(0, 0, W, H);
    }
  }

  drawPetals(g, W, H, now, dt) {
    // petals drifting down (behind the lanes)
    if (PETAL && this.petals.length) {
      for (let i = this.petals.length - 1; i >= 0; i--) {
        const p = this.petals[i];
        p.x += p.vx * dt + Math.sin((now + i * 300) / 500) * 0.0003; p.y += p.vy * dt; p.r += p.vr * dt;
        if (p.y > 1.1) { this.petals.splice(i, 1); continue; }
        const sz = 22 * p.s;
        g.save();
        g.globalAlpha = 0.85;
        g.translate(p.x * W, p.y * H); g.rotate(p.r); g.scale(1, 0.6 + 0.4 * Math.sin(now / 260 + i));
        g.drawImage(PETAL, -sz / 2, -sz / 2, sz, sz);
        g.restore();
      }
    }
  }

  figureRect(game) {
    const { W, H } = game;
    const img = this.img.stage;
    const ar = ok(img) ? img.naturalWidth / img.naturalHeight : 1.384;
    if (this.mode === 'side') {
      const left = W * 0.68;
      const areaW = W - left;
      const h = Math.min(H * 0.8, areaW * 1.25 / ar);
      const w = h * ar;
      return { cx: left + areaW * 0.62, bottom: H * 0.99, w, h };
    }
    // narrow screens: big and faint behind the lanes
    const w = Math.min(W * 1.25, H * 1.05 * ar), h = w / ar;
    return { cx: W * 0.55, bottom: H * 0.9, w, h };
  }

  // drones + beams (wide), fever edge glow (narrow); over the lanes but under the HUD
  drawMid(g, game, now, pulse) {
    if (this.mode === 'off') return;
    const { W, H } = game;
    if (this.inFever(now)) {
      // neon glow hugging both screen edges while FEVER lasts
      const left = Math.min(1, (this.feverUntil - now) / 600);
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const [x0, dir] of [[0, 1], [W, -1]]) {
        const gr = g.createLinearGradient(x0, 0, x0 + dir * 26, 0);
        gr.addColorStop(0, `rgba(255,61,139,${(0.35 + pulse * 0.35) * left})`);
        gr.addColorStop(1, 'rgba(255,61,139,0)');
        g.fillStyle = gr;
        g.fillRect(dir > 0 ? 0 : W - 26, 0, 26, H);
      }
      g.restore();
    }
    if (this.mode !== 'side') { this.beams.length = 0; return; }
    // the MV has its own drones: the 2D ones step aside while it plays so they don't cover her
    const droneA = 1 - (this.mvFrame() ? this.stageA : 0);
    if (droneA < 0.02) { this.beams.length = 0; if (!game.arcs) this.drawGauge(g, game, now); return; }
    // 黑 (top) and 白 (bottom)
    const robots = [this.img.robotBlack, this.img.robotWhite];
    // 黑 left of the neck, 白 right of it, above the arc gauges
    const size = Math.min(92, H * 0.11);
    const dy = Math.max(H * 0.24, 120);
    const spots = [{ x: game.bx(0, dy) - size * 1.1, y: dy }, { x: game.bx(4, dy) + size * 1.1, y: dy }];
    const pos = spots.map((p, k) => ({
      x: p.x, y: p.y + Math.sin(now * 0.0022 + k * 2.1) * 7 - pulse * 3,
    }));

    // beams from the drones to the hit receptor
    g.globalCompositeOperation = 'lighter';
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      const a = (now - b.at) / 200;
      if (a >= 1) { this.beams.splice(i, 1); continue; }
      const p = pos[b.d];
      const tx = game.laneX(b.lane), ty = game.judgeY;
      const col = game.laneColor(b.lane);
      g.globalAlpha = (1 - a) * 0.9 * droneA;
      g.strokeStyle = col;
      g.lineWidth = 1 + 3 * (1 - a);
      g.beginPath(); g.moveTo(p.x, p.y + size * 0.15); g.lineTo(tx, ty); g.stroke();
      g.globalAlpha = (1 - a) * 0.5 * droneA;
      g.fillStyle = col;
      g.beginPath(); g.arc(p.x, p.y + size * 0.15, size * 0.18 * (1 - a) + 2, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    const fever = this.inFever(now);
    g.globalAlpha = droneA;
    pos.forEach((p, k) => {
      const sheet = robots[k];
      if (!ok(sheet)) return;
      // angle: FEVER turns on every beat, a recent beam from this robot faces the lanes, else idle
      let frame = ROBOT_IDLE;
      const fired = this.beams.some(b => b.d === k && now - b.at < 160);
      if (fever) frame = ROBOT_FEVER[k][Math.max(0, this.lastBeat) % ROBOT_FEVER[k].length];
      else if (fired) frame = ROBOT_FIRE[k];
      const sw = sheet.naturalWidth / ROBOT_FRAMES, sh = sheet.naturalHeight;
      const h = size * 1.25, w = h * sw / sh;
      if (fever && ROBOT_GLOW[k]) {
        const r = h * (0.85 + pulse * 0.25);
        g.globalCompositeOperation = 'lighter';
        g.drawImage(ROBOT_GLOW[k], p.x - r, p.y - r, r * 2, r * 2);
        g.globalCompositeOperation = 'source-over';
      }
      g.drawImage(sheet, frame * sw, 0, sw, sh, p.x - w / 2, p.y - h / 2, w, h);
    });
    g.globalAlpha = 1;
    if (!game.arcs) this.drawGauge(g, game, now);
  }

  feverLevel(now) {
    return this.inFever(now) ? (this.feverUntil - now) / FEVER_MS : this.fever;
  }

  // vertical FEVER gauge right of the playfield (wide screens)
  drawGauge(g, game, now) {
    const x = game.fieldX + game.fieldW + 6;
    const top = game.H * 0.22, bot = game.judgeY;
    const h = bot - top;
    const fever = this.inFever(now);
    const v = this.feverLevel(now);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.roundRect(x, top, 5, h, 2); g.fill();
    const grad = g.createLinearGradient(0, bot, 0, top);
    grad.addColorStop(0, '#ff3d8b'); grad.addColorStop(0.6, '#b04dff'); grad.addColorStop(1, '#3fd4ff');
    g.fillStyle = grad;
    if (fever) g.globalAlpha = 0.7 + 0.3 * Math.sin(now * 0.02);
    g.beginPath(); g.roundRect(x, bot - h * v, 5, h * v, 2); g.fill();
    g.globalAlpha = 1;
    g.save();
    g.translate(x + 2.5, top - 10);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 9px ${FONT}`;
    g.fillStyle = fever ? '#ff7ab8' : 'rgba(255,255,255,0.4)';
    g.fillText('FEVER', 0, 0);
    g.restore();
  }

  // over everything: speech + FEVER cut-in
  drawFront(g, game, now) {
    if (this.mode === 'off') return;
    if (this.compact) this.drawAvatar(g, game, now);
    else this.drawBubble(g, game, now);
    if (this.cutinEnabled) {
      if (this.compact) this.drawCutinCompact(g, game, now);
      else this.drawCutin(g, game, now);
    }
  }

  // narrow screens: a small face icon in the top-left whose ring is the FEVER gauge,
  // with her one-line remark beside it (the bottom of the screen sits under the thumbs)
  drawAvatar(g, game, now) {
    const r = 19, cx = 12 + r, cy = 92;
    const fever = this.inFever(now);
    const v = this.feverLevel(now);
    g.save();
    // ring track + fill (clockwise from the top)
    g.lineWidth = 3.5;
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.beginPath(); g.arc(cx, cy, r + 3.5, 0, Math.PI * 2); g.stroke();
    const grad = g.createLinearGradient(cx - r, cy + r, cx + r, cy - r);
    grad.addColorStop(0, '#ff3d8b'); grad.addColorStop(0.6, '#b04dff'); grad.addColorStop(1, '#3fd4ff');
    g.strokeStyle = grad;
    if (fever) g.globalAlpha = 0.75 + 0.25 * Math.sin(now * 0.02);
    g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r + 3.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, v)); g.stroke();
    g.globalAlpha = 1;
    if (fever && ROBOT_GLOW[0]) {
      const gr = r * 1.9;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(ROBOT_GLOW[0], cx - gr, cy - gr, gr * 2, gr * 2);
      g.globalCompositeOperation = 'source-over';
    }
    const missA = Math.max(0, 1 - (now - this.missAt) / 380);
    const face = this.img.face;
    const bump = 1 + this.bump * 0.08;
    if (ok(face)) {
      g.translate(cx + (missA ? Math.sin(now * 0.09) * 3 * missA : 0), cy);
      g.scale(bump, bump);
      g.drawImage(face, -r, -r, r * 2, r * 2);
    }
    g.restore();

    // remark beside the face
    const b = this.bubble;
    if (!b) return;
    const age = now - b.at;
    if (age < 0 || age > b.dur) return;
    if (this.cutinEnabled && now - this.cutinAt < this.cutinMs()) return;
    const a = Math.min(1, age / 150, (b.dur - age) / 250);
    const slide = 1 - Math.pow(1 - Math.min(1, age / 180), 3);
    g.save();
    g.globalAlpha = a * 0.92;
    g.font = `700 12px ${FONT}`;
    const tw = Math.min(g.measureText(b.text).width, game.W - cx - r - 40);
    const x = cx + r + 12 - (1 - slide) * 14, ph = 24, pw = tw + 18;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath(); g.roundRect(x, cy - ph / 2, pw, ph, 10); g.fill();
    g.beginPath(); g.moveTo(x + 1, cy - 4); g.lineTo(x - 6, cy); g.lineTo(x + 1, cy + 4); g.fill();
    g.fillStyle = '#2a1030'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(b.text, x + 9, cy + 1, tw);
    g.restore();
  }

  drawBubble(g, game, now) {
    const b = this.bubble;
    if (!b || !this.fig) return;
    const age = now - b.at;
    if (age < 0 || age > b.dur) return;
    if (this.cutinEnabled && now - this.cutinAt < CUTIN_MS) return;
    const a = Math.min(1, age / 150, (b.dur - age) / 250);
    const fig = this.fig;
    let x = fig.cx - fig.w / 2 + fig.w * STAGE_HEAD.x - fig.w * 0.2;
    let y = fig.bottom - fig.h + fig.h * STAGE_HEAD.y - 24;
    if (game.arcs) {   // wide screens: top-right, clear of the score on the right arc
      y = Math.max(70, game.H * 0.12);
      x = (game.bx(4, y) + game.W) / 2 + 20;
    }
    g.save();
    g.globalAlpha = a;
    g.font = `700 15px ${FONT}`;
    const tw = g.measureText(b.text).width;
    const pw = tw + 26, ph = 34;
    x = Math.max(pw / 2 + 8, Math.min(game.W - pw / 2 - 8, x));
    const pop = age < 120 ? 0.85 + 0.15 * (age / 120) : 1;
    g.translate(x, y); g.scale(pop, pop);
    g.fillStyle = 'rgba(255,255,255,0.94)';
    g.beginPath(); g.roundRect(-pw / 2, -ph / 2, pw, ph, 12); g.fill();
    g.beginPath(); g.moveTo(pw * 0.18, ph / 2 - 1); g.lineTo(pw * 0.32, ph / 2 + 10); g.lineTo(pw * 0.34, ph / 2 - 1); g.fill();
    g.strokeStyle = '#ff3d8b'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(-pw / 2, -ph / 2, pw, ph, 12); g.stroke();
    g.fillStyle = '#2a1030'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(b.text, 0, 1);
    g.restore();
  }

  // narrow screens: her portrait slides in from the right edge for under a second,
  // inside a slanted translucent panel in the upper-right corner
  drawCutinCompact(g, game, now) {
    const ms = CUTIN_COMPACT_MS;
    const age = now - this.cutinAt;
    if (age < 0 || age > ms) return;
    const { W, H } = game;
    const ease = t => 1 - Math.pow(1 - t, 3);
    const k = age < 200 ? 1 - ease(age / 200) : age > ms - 220 ? ease((age - (ms - 220)) / 220) : 0;
    const pw = W * 0.58, ph = Math.min(150, H * 0.19);
    const x0 = W - pw + k * pw * 1.05, y0 = 66;
    g.save();
    g.globalAlpha = 0.86;
    g.beginPath();
    g.moveTo(x0 + 30, y0); g.lineTo(W + 40, y0); g.lineTo(W + 40, y0 + ph); g.lineTo(x0, y0 + ph); g.closePath();
    const grad = g.createLinearGradient(x0, 0, W, 0);
    grad.addColorStop(0, 'rgba(255,61,139,0.85)'); grad.addColorStop(1, 'rgba(122,60,255,0.75)');
    g.fillStyle = grad; g.fill();
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.2)';
    for (let i = 0; i < 6; i++) g.fillRect(x0 + ((i * 97 + age * 1.4) % pw), y0 + ((i * 29) % ph), pw * 0.3, 2);
    const img = this.img.heart;
    if (ok(img)) {
      const ih = ph * 2.3, iw = ih * img.naturalWidth / img.naturalHeight;
      g.globalAlpha = 1;
      g.drawImage(img, x0 + pw * 0.62 - iw / 2, y0 - ph * 0.12, iw, ih);
    }
    drawGlowText(g, 'FEVER!!', Math.round(ph * 0.26), 12, x0 + 22, y0 + ph * 0.72);
    g.restore();
  }

  drawCutin(g, game, now) {
    const age = now - this.cutinAt;
    if (age < 0 || age > CUTIN_MS) return;
    const { W, H } = game;
    const ease = t => 1 - Math.pow(1 - t, 3);
    let off;
    if (age < 220) off = -1 + ease(age / 220);
    else if (age < CUTIN_MS - 260) off = 0.03 * ((age - 220) / (CUTIN_MS - 480));
    else off = 0.03 + ease((age - (CUTIN_MS - 260)) / 260) * 1.1;

    // wide screens: the band lives right of the playfield and never covers the lanes
    const bandH = Math.max(120, Math.min(220, H * 0.24));
    const cy = Math.max(H * 0.3, 90 + bandH / 2);
    const x0 = (game.persp ? game.bx(4, cy - bandH / 2) : game.fieldX + game.fieldW) + 14, areaW = W - x0;
    const skew = Math.tan(-8 * Math.PI / 180);
    g.save();
    g.beginPath(); g.rect(x0, 0, areaW, H); g.clip();
    g.translate(x0, 0);
    g.translate(off * areaW * 1.2, cy);
    g.transform(1, skew, 0, 1, 0, 0);
    g.beginPath(); g.rect(-areaW * 0.2, -bandH / 2, areaW * 1.4, bandH);
    const grad = g.createLinearGradient(0, 0, areaW, 0);
    grad.addColorStop(0, 'rgba(255,61,139,0.88)');
    grad.addColorStop(0.55, 'rgba(122,60,255,0.85)');
    grad.addColorStop(1, 'rgba(63,212,255,0.85)');
    g.fillStyle = grad; g.fill();
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 9; i++) {
      const ly = -bandH / 2 + ((i * 37 + age * 0.05) % bandH);
      g.fillRect(-areaW * 0.2 + ((i * 131 + age * 1.6) % (areaW * 1.4)), ly, areaW * 0.25, 2);
    }
    g.transform(1, -skew, 0, 1, 0, 0);
    const img = this.img.heart;
    if (ok(img)) {
      const ih = bandH * 2.1, iw = ih * img.naturalWidth / img.naturalHeight;
      const xi = areaW * 0.7;
      g.drawImage(img, xi - iw / 2, -bandH * 0.45 + skew * xi, iw, ih);
    }
    g.translate(0, skew * areaW * 0.1);
    const fs = Math.round(bandH * 0.36);
    drawGlowText(g, 'FEVER!!', fs, 18, areaW * 0.07, -fs * 0.15);
    g.restore();
  }
}

// menu / results art, picked by rank
export function resultArt(rank) {
  if (rank === 'F') return { src: BASE + ART.kneelGray, line: '下次一定可以的…再來一次？' };
  if (rank === 'SS' || rank === 'S') return { src: BASE + ART.heart, line: rank === 'SS' ? '完美！你就是我的最佳拍檔♡' : '好厲害！給你一個愛心♡' };
  if (rank === 'A' || rank === 'B') return { src: BASE + ART.hands, line: '很棒喔！再一次就更完美了' };
  return { src: BASE + ART.kneel, line: '節奏還差一點點，再陪我練練吧' };
}
