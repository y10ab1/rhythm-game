// Per-song dance timelines. Bars count from the song's first downbeat (beat.downbeat in tools/mv_work/dance/<song>.json),
// 4 beats each; fractional bars are fine.
//   plan:     [startBar, bars, move, mirrored]  keyframed moves (choreo.js); with mocap only their expressions
//             and the final `ending` move (from bar `end`) are used
//   sections: { from, to, name }                 name = a MOOD key in show.js (lights, robots, groove)
//   shots:    [fromBar, toBar, kind, opts]       cameras, cut on bar lines (show.js updateCamera)
//   end:      bar where the ending (spin + peace sign) starts: robots park, mocap blends into it
//   mood:     optional per-section overrides of show.js MOOD
// The matching AIST++ motion plan for each song is in mocap_prep.py (PLANS_AIST).

export const TIMELINES = {};

// ---------------- Starlight Stage (Lyria, 125 BPM, 64 bars) ----------------
TIMELINES['starlight-stage'] = {
  end: 62,
  plan: [
    [0, 4, 'intro'],
    [4, 4, 'stepClap'], [8, 4, 'pointHip'],
    [12, 4, 'waveOver'],
    [16, 3, 'clapHigh'], [19, 1, 'tension'],
    [20, 2, 'hookA'], [22, 2, 'hookB'], [24, 2, 'hookA', true], [26, 2, 'hookB', true],
    [28, 4, 'ballad'],
    [32, 4, 'shuffle'], [36, 3, 'bodyRoll'],
    [39, 5, 'waveOver', true],
    [44, 3, 'clapHigh'], [47, 1, 'tension'],
    [48, 2, 'hookA'], [50, 2, 'hookB'], [52, 2, 'hookA', true], [54, 2, 'hookB', true],
    [56, 2, 'hookA'], [58, 2, 'stepClap'], [60, 1, 'pointHip'], [61, 1, 'tension'],
    [62, 8, 'ending'],
  ],
  sections: [
    { from: 0, to: 4, name: 'intro' }, { from: 4, to: 12, name: 'verse' }, { from: 12, to: 16, name: 'build' },
    { from: 16, to: 20, name: 'pre' }, { from: 20, to: 28, name: 'chorus' }, { from: 28, to: 32, name: 'break' },
    { from: 32, to: 39, name: 'verse' }, { from: 39, to: 44, name: 'build' }, { from: 44, to: 48, name: 'pre' },
    { from: 48, to: 56, name: 'chorus' }, { from: 56, to: 62, name: 'final' }, { from: 62, to: 99, name: 'end' },
  ],
  shots: [
    [0, 2, 'crane', { from: [0, 3.6, 11.5], to: [0, 1.9, 7.6], look: [0, 1.35, 0], fov: 36 }],
    [2, 4, 'dolly', { from: [0.5, 1.35, 5.4], to: [0, 1.3, 3.9], look: [0, 1.2, 0], fov: 34 }],
    [4, 6, 'dolly', { from: [-0.6, 1.05, 4.8], to: [0.6, 1.05, 4.6], look: [0, 0.95, 0], fov: 36 }],
    [6, 8, 'dolly', { from: [-1.3, 0.35, 3.3], to: [-0.5, 0.4, 3.0], look: [0, 1.15, 0], fov: 40 }],
    [8, 10, 'orbit', { r: 3.9, y: 1.25, a0: 0.45, a1: 0.8, look: [0, 1.0, 0], fov: 36 }],
    [10, 12, 'dolly', { from: [0.35, 1.48, 1.7], to: [0.15, 1.45, 1.45], look: [0, 1.4, 0], fov: 30 }],
    [12, 16, 'orbit', { r: 5.2, y: 1.7, a0: -0.7, a1: 0.7, look: [0, 1.15, 0], fov: 38 }],
    [16, 19, 'dolly', { from: [0, 3.4, 5.8], to: [0, 2.6, 4.6], look: [0, 1.0, 0], fov: 38 }],
    [19, 20, 'dolly', { from: [0, 1.2, 5.2], to: [0, 1.25, 2.6], look: [0, 1.0, 0], fov: 36, ease: 'in' }],
    [20, 22, 'crane', { from: [0, 3.2, 10], to: [0, 2.0, 7.2], look: [0, 1.3, 0], fov: 36, kick: true }],
    [22, 24, 'orbit', { r: 3.6, y: 1.2, a0: -0.9, a1: 0.9, look: [0, 1.05, 0], fov: 38, kick: true }],
    [24, 26, 'dolly', { from: [1.3, 0.35, 3.3], to: [0.5, 0.4, 3.0], look: [0, 1.15, 0], fov: 42, kick: true }],
    [26, 28, 'dolly', { from: [0, 1.05, 4.3], to: [0, 1.1, 3.8], look: [0, 1.0, 0], fov: 38, kick: true }],
    [28, 30, 'dolly', { from: [0.2, 1.42, 1.9], to: [0.1, 1.45, 1.5], look: [0, 1.38, 0], fov: 30 }],
    [30, 32, 'orbit', { r: 3.2, y: 1.6, a0: 1.2, a1: 0.25, look: [0, 1.25, 0], fov: 34 }],
    [32, 36, 'track', { off: [0, 1.15, 4.4], look: [0, 0.95, 0], fov: 36 }],
    [36, 39, 'orbit', { r: 3.4, y: 1.35, a0: -0.55, a1: -0.25, look: [0, 1.15, 0], fov: 34 }],
    [39, 44, 'orbit', { r: 5.6, y: 2.0, a0: 0.8, a1: -0.8, look: [0, 1.15, 0], fov: 38 }],
    [44, 47, 'dolly', { from: [-0.8, 4.6, 3.6], to: [0.8, 4.2, 3.2], look: [0, 0.8, 0], fov: 40 }],
    [47, 48, 'dolly', { from: [0, 1.2, 5.2], to: [0, 1.25, 2.6], look: [0, 1.0, 0], fov: 36, ease: 'in' }],
    [48, 50, 'crane', { from: [0, 3.6, 11], to: [0, 2.0, 7.0], look: [0, 1.3, 0], fov: 36, kick: true }],
    [50, 52, 'orbit', { r: 3.6, y: 1.2, a0: 0.9, a1: -0.9, look: [0, 1.05, 0], fov: 38, kick: true }],
    [52, 54, 'dolly', { from: [0.3, 1.4, 2.6], to: [-0.3, 1.4, 2.4], look: [0, 1.2, 0], fov: 34, kick: true }],
    [54, 56, 'dolly', { from: [-1.3, 0.35, 3.3], to: [-0.5, 0.4, 3.0], look: [0, 1.15, 0], fov: 42, kick: true }],
    [56, 58, 'dolly', { from: [0, 1.05, 4.6], to: [0, 1.1, 4.0], look: [0, 1.0, 0], fov: 38, kick: true }],
    [58, 60, 'orbit', { r: 3.8, y: 1.3, a0: -0.5, a1: -0.85, look: [0, 1.0, 0], fov: 36, kick: true }],
    [60, 62, 'orbit', { r: 4.2, y: 1.6, a0: 0.9, a1: -0.3, look: [0, 1.05, 0], fov: 38, kick: true }],
    [62, 63, 'dolly', { from: [0, 1.2, 4.4], to: [0, 1.3, 3.2], look: [0, 1.1, 0], fov: 36 }],
    [63, 99, 'dolly', { from: [0.1, 1.38, 2.3], to: [0.05, 1.42, 1.9], look: [0, 1.3, 0], fov: 32, dur: 24 }],
  ],
};

// ---------------- 星空的歸途 (孤夜's own song, Luci, 95 BPM, bar 0 = beat 2 at 1.41 s, music ends on bar 80) ----------------
// Structure from the vocal stems (本人人聲) + energy: intro riff 0-9, verse 9-19, build 19-25 (backing vocals),
// chorus 25-35, break 35-37, verse 2 37-43, chorus 2 43-47, instrumental 47-58 (dance break), bridge 58-62,
// last chorus 62-76, outro 76-80. Colours after the MV: violet / magenta / cyan neon, a starry sky.
const XK_KICK = { kick: true };
TIMELINES['xingkong-de-guitu'] = {
  end: 79.25,   // spin from 79.25, peace sign on the last hit (bar 80)
  plan: [
    [0, 9, 'intro'],
    [9, 4, 'stepClap'], [13, 4, 'pointHip'], [17, 2, 'waveOver'],
    [19, 5, 'clapHigh'], [24, 1, 'tension'],
    [25, 2, 'hookA'], [27, 2, 'hookB'], [29, 2, 'hookA', true], [31, 2, 'hookB', true], [33, 2, 'hookA'],
    [35, 2, 'ballad'],
    [37, 3, 'shuffle'], [40, 3, 'bodyRoll'],
    [43, 2, 'hookA'], [45, 1, 'hookB'], [46, 1, 'tension'],
    [47, 2, 'hookA'], [49, 2, 'hookB'], [51, 2, 'hookA', true], [53, 2, 'hookB', true], [55, 2, 'shuffle'], [57, 1, 'tension'],
    [58, 4, 'ballad'],
    [62, 2, 'hookA'], [64, 2, 'hookB'], [66, 2, 'hookA', true], [68, 2, 'hookB', true],
    [70, 2, 'hookA'], [72, 2, 'hookB'], [74, 2, 'hookA', true],
    [76, 2, 'stepClap'], [78, 1.25, 'pointHip'],
    [79.25, 8, 'ending'],
  ],
  sections: [
    { from: 0, to: 2, name: 'intro' }, { from: 2, to: 9, name: 'build' }, { from: 9, to: 19, name: 'verse' },
    { from: 19, to: 25, name: 'pre' }, { from: 25, to: 35, name: 'chorus' }, { from: 35, to: 37, name: 'break' },
    { from: 37, to: 43, name: 'verse' }, { from: 43, to: 47, name: 'chorus' }, { from: 47, to: 58, name: 'final' },
    { from: 58, to: 62, name: 'break' }, { from: 62, to: 76, name: 'chorus' }, { from: 76, to: 79.25, name: 'final' },
    { from: 79.25, to: 99, name: 'end' },
  ],
  shots: [
    // intro: down from the stars, then the riff
    [0, 2, 'crane', { from: [0, 5.2, 12.5], to: [0, 2.2, 8.0], look: [0, 1.6, 0], fov: 38 }],
    [2, 4, 'dolly', { from: [0.5, 1.35, 5.6], to: [0, 1.3, 4.0], look: [0, 1.2, 0], fov: 34 }],
    [4, 6, 'orbit', { r: 4.4, y: 1.4, a0: -0.8, a1: -0.3, look: [0, 1.05, 0], fov: 36 }],
    [6, 8, 'dolly', { from: [-1.3, 0.35, 3.3], to: [-0.5, 0.4, 3.0], look: [0, 1.15, 0], fov: 40 }],
    [8, 9, 'dolly', { from: [0, 1.2, 5.2], to: [0, 1.25, 2.8], look: [0, 1.0, 0], fov: 36, ease: 'in' }],
    // verse
    [9, 11, 'track', { off: [0, 1.15, 4.4], look: [0, 0.95, 0], fov: 36 }],
    [11, 13, 'orbit', { r: 3.9, y: 1.25, a0: 0.45, a1: 0.8, look: [0, 1.0, 0], fov: 36 }],
    [13, 15, 'dolly', { from: [0.35, 1.48, 1.8], to: [0.15, 1.45, 1.5], look: [0, 1.4, 0], fov: 30 }],
    [15, 17, 'orbit', { r: 5.2, y: 1.7, a0: -0.6, a1: 0.4, look: [0, 1.15, 0], fov: 38 }],
    [17, 19, 'dolly', { from: [1.3, 0.35, 3.3], to: [0.5, 0.4, 3.0], look: [0, 1.15, 0], fov: 40 }],
    // build
    [19, 21, 'dolly', { from: [0, 3.4, 5.8], to: [0, 2.6, 4.6], look: [0, 1.0, 0], fov: 38 }],
    [21, 23, 'orbit', { r: 5.0, y: 1.5, a0: 0.7, a1: -0.2, look: [0, 1.1, 0], fov: 36 }],
    [23, 24, 'dolly', { from: [-0.4, 1.4, 3.2], to: [0.2, 1.4, 3.0], look: [0, 1.15, 0], fov: 34 }],
    [24, 25, 'dolly', { from: [0, 1.2, 5.2], to: [0, 1.25, 2.6], look: [0, 1.0, 0], fov: 36, ease: 'in' }],
    // chorus 1
    [25, 27, 'crane', { from: [0, 3.2, 10], to: [0, 2.0, 7.2], look: [0, 1.3, 0], fov: 36, ...XK_KICK }],
    [27, 29, 'orbit', { r: 3.6, y: 1.2, a0: -0.9, a1: 0.9, look: [0, 1.05, 0], fov: 38, ...XK_KICK }],
    [29, 31, 'dolly', { from: [1.3, 0.35, 3.3], to: [0.5, 0.4, 3.0], look: [0, 1.15, 0], fov: 42, ...XK_KICK }],
    [31, 33, 'dolly', { from: [0, 1.05, 4.3], to: [0, 1.1, 3.8], look: [0, 1.0, 0], fov: 38, ...XK_KICK }],
    [33, 35, 'orbit', { r: 4.2, y: 1.6, a0: 0.9, a1: -0.3, look: [0, 1.05, 0], fov: 38, ...XK_KICK }],
    // break
    [35, 37, 'dolly', { from: [0.2, 1.42, 1.9], to: [0.1, 1.45, 1.5], look: [0, 1.38, 0], fov: 30 }],
    // verse 2
    [37, 39, 'track', { off: [0, 1.15, 4.4], look: [0, 0.95, 0], fov: 36 }],
    [39, 41, 'orbit', { r: 3.4, y: 1.35, a0: -0.55, a1: -0.15, look: [0, 1.15, 0], fov: 34 }],
    [41, 43, 'dolly', { from: [-0.8, 4.6, 3.6], to: [0.8, 4.2, 3.2], look: [0, 0.8, 0], fov: 40 }],
    // chorus 2
    [43, 45, 'crane', { from: [0, 3.6, 11], to: [0, 2.0, 7.0], look: [0, 1.3, 0], fov: 36, ...XK_KICK }],
    [45, 46, 'orbit', { r: 3.6, y: 1.2, a0: 0.9, a1: 0.2, look: [0, 1.05, 0], fov: 38, ...XK_KICK }],
    [46, 47, 'dolly', { from: [0, 1.2, 5.2], to: [0, 1.25, 2.6], look: [0, 1.0, 0], fov: 36, ease: 'in' }],
    // instrumental: dance break
    [47, 49, 'crane', { from: [0, 4.2, 12], to: [0, 1.8, 6.4], look: [0, 1.2, 0], fov: 36, ...XK_KICK }],
    [49, 51, 'orbit', { r: 3.6, y: 1.2, a0: -1.1, a1: 1.1, look: [0, 1.05, 0], fov: 38, ...XK_KICK }],
    [51, 53, 'dolly', { from: [-1.3, 0.35, 3.3], to: [-0.5, 0.4, 3.0], look: [0, 1.15, 0], fov: 42, ...XK_KICK }],
    [53, 55, 'dolly', { from: [0, 1.05, 4.6], to: [0, 1.1, 4.0], look: [0, 1.0, 0], fov: 38, ...XK_KICK }],
    [55, 57, 'orbit', { r: 3.8, y: 1.3, a0: 1.0, a1: -0.4, look: [0, 1.0, 0], fov: 36, ...XK_KICK }],
    [57, 58, 'dolly', { from: [0.3, 1.4, 2.8], to: [-0.2, 1.4, 2.4], look: [0, 1.2, 0], fov: 34, ...XK_KICK }],
    // bridge: close, then up into the stars
    [58, 60, 'dolly', { from: [0.35, 1.48, 1.9], to: [0.15, 1.45, 1.5], look: [0, 1.4, 0], fov: 30 }],
    [60, 62, 'orbit', { r: 5.6, y: 2.0, a0: 0.8, a1: -0.4, look: [0, 1.2, 0], fov: 38 }],
    // last chorus
    [62, 64, 'crane', { from: [0, 3.6, 11], to: [0, 2.0, 7.0], look: [0, 1.3, 0], fov: 36, ...XK_KICK }],
    [64, 66, 'orbit', { r: 3.6, y: 1.2, a0: 0.9, a1: -0.9, look: [0, 1.05, 0], fov: 38, ...XK_KICK }],
    [66, 68, 'dolly', { from: [0.3, 1.4, 2.6], to: [-0.3, 1.4, 2.4], look: [0, 1.2, 0], fov: 34, ...XK_KICK }],
    [68, 70, 'dolly', { from: [-1.3, 0.35, 3.3], to: [-0.5, 0.4, 3.0], look: [0, 1.15, 0], fov: 42, ...XK_KICK }],
    [70, 72, 'dolly', { from: [0, 1.05, 4.6], to: [0, 1.1, 4.0], look: [0, 1.0, 0], fov: 38, ...XK_KICK }],
    [72, 74, 'orbit', { r: 3.8, y: 1.3, a0: -0.5, a1: -0.95, look: [0, 1.0, 0], fov: 36, ...XK_KICK }],
    [74, 76, 'orbit', { r: 5.2, y: 1.8, a0: -0.9, a1: 0.5, look: [0, 1.1, 0], fov: 38, ...XK_KICK }],
    // outro + ending
    [76, 78, 'orbit', { r: 4.2, y: 1.6, a0: 0.9, a1: 0.2, look: [0, 1.05, 0], fov: 38, ...XK_KICK }],
    [78, 79.25, 'dolly', { from: [0, 1.2, 4.4], to: [0, 1.3, 3.2], look: [0, 1.1, 0], fov: 36 }],
    [79.25, 99, 'dolly', { from: [0.1, 1.38, 2.3], to: [0.05, 1.42, 1.9], look: [0, 1.3, 0], fov: 32, dur: 6 }],
  ],
  mood: {
    intro: { a: 0x3a3dff, b: 0xb04dff, key: 0.6, neon: 0.5, beams: 0.25, spark: 0.7 },
    build: { a: 0xb04dff, b: 0x2fd8ff, key: 0.9, neon: 0.9, beams: 0.6, spark: 0.5 },
    verse: { a: 0xd23dff, b: 0x2fd8ff, key: 1.0, neon: 1.0, beams: 0.5, spark: 0.45 },
    break: { a: 0x2b3bff, b: 0x9a4bff, key: 0.7, neon: 0.45, beams: 0.35, spark: 0.9 },
    end: { a: 0xc84dff, b: 0x6fd8ff, key: 1.0, neon: 1.0, beams: 0.6, spark: 0.9 },
  },
};

export function timeline(song) {
  const t = TIMELINES[song];
  if (!t) throw new Error(`no dance timeline for ${song} (tools/dance/timelines.js)`);
  return t;
}
