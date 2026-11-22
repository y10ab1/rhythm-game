"""Estimate the music beat grid of AIST++ sequences from the motion (the music itself is no longer downloadable).
BPM comes from the music id (AIST Dance DB: m??0..5 = 80..130 BPM, house 110..135). Phase: kinematic beats
(local minima of joint speed, as in the AIST++ paper's beat-alignment score) are matched against the grid.
usage: python -I aist_beats.py <aist_dir> <seq> [<seq> ...]   -> prints JSON {seq: {bpm, t0, score}}
"""
import sys, json, pickle
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import argrelextrema

root, seqs = sys.argv[1], sys.argv[2:]
FPS = 60.0


def bpm_of(seq):
    m = seq.split('_')[4]           # e.g. mJS3
    k = int(m[3])
    return (110, 115, 120, 125, 130, 135)[k] if m.startswith('mHO') else 80 + 10 * k


out = {}
for s in seqs:
    kp = pickle.load(open(f'{root}/keypoints3d/{s}.pkl', 'rb'))
    x = kp['keypoints3d_optim']                     # (N,17,3)
    v = np.linalg.norm(np.diff(x, axis=0), axis=2).mean(1) * FPS
    v = gaussian_filter1d(v, 2)
    mins = argrelextrema(v, np.less, order=5)[0] / FPS
    bpm = bpm_of(s)
    P = 60 / bpm
    best = None
    for b in [bpm]:
        P = 60 / b
        for ph in np.linspace(0, P, 120, endpoint=False):
            d = ((mins - ph) / P + 0.5) % 1 - 0.5          # distance to nearest grid beat, in beats
            sc = np.exp(-(d * P) ** 2 / (2 * 0.05 ** 2)).mean()
            if best is None or sc > best[0]:
                best = (sc, b, ph)
    sc, b, ph = best
    # chance level: same score with random phase
    rnd = np.mean([np.exp(-(((((mins - r) / (60 / b)) + 0.5) % 1 - 0.5) * 60 / b) ** 2 / 0.005).mean() for r in np.random.rand(50) * 60 / b])
    out[s] = {'bpm': round(float(b), 3), 't0': round(float(ph), 4), 'score': round(float(sc), 3), 'chance': round(float(rnd), 3),
              'dur': round(len(x) / FPS, 2)}
print(json.dumps(out, indent=1))
