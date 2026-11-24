"""Dance motion -> VRM clip on the target song's beat grid.

  aist  <aist_dir> <aist_beats.json> <target_beats.json> <vrm> <out.json> [song]
        AIST++ SMPL rotations (same T-pose rest frame as VRM normalized bones) cut into sections per PLANS_AIST[song]
        (song defaults to the target beats file name, e.g. tools/mv_work/dance/starlight-stage.json).
  kpop  <pose.npz> <video_beats.json> <target_beats.json> <vrm> <out.json> <src_first_beat>
        MediaPipe 3D landmarks -> bone rotations, time-warped beat-to-beat onto the target song.
  smpl  <gvhmr.npz> <video_fps> <video_beats.json> <target_beats.json> <out.json> <src_first_beat>
        GVHMR (video -> SMPL-X) rotations, used like AIST++ and time-warped like kpop. Much steadier than kpop.

Clip format: {fps, n, bones: {vrmBone: [x,y,z,w]*n}, hips: [x,y,z]*n}. Rotations are local, in the character
frame (y up, facing +z, her left = +x), relative to the T-pose rest. hips = root offset (y unused: the player
keeps the lowest foot on the floor).
"""
import sys, json, pickle, struct
import numpy as np
from scipy.spatial.transform import Rotation as R, Slerp
from scipy.signal import butter, filtfilt

FPS = 30

# ---------------- shared ----------------

def load_beats(p):
    b = json.load(open(p))
    return np.array(b['beats']), b


def beat_of(t, B):
    """fractional beat index of time t on beat list B (extrapolates with the edge intervals)"""
    t = np.asarray(t, float)
    i = np.clip(np.searchsorted(B, t) - 1, 0, len(B) - 2)
    return i + (t - B[i]) / (B[i + 1] - B[i])


def time_of(b, B):
    b = np.asarray(b, float)
    i = np.clip(np.floor(b).astype(int), 0, len(B) - 2)
    return B[i] + (b - i) * (B[i + 1] - B[i])


def vrm_rest(path):
    f = open(path, 'rb'); f.read(12); n = struct.unpack('<I', f.read(4))[0]; f.read(4)
    j = json.loads(f.read(n))
    hb = {b['bone']: b['node'] for b in j['extensions']['VRM']['humanoid']['humanBones']}
    tr = lambda b: np.array(j['nodes'][hb[b]].get('translation', [0, 0, 0])) * [-1, 1, -1]   # VRM0 faces -z
    u = lambda v: v / np.linalg.norm(v)
    rest = {}
    for s in ('left', 'right'):
        rest[s] = dict(upArm=u(tr(s + 'LowerArm')), loArm=u(tr(s + 'Hand')), upLeg=u(tr(s + 'LowerLeg')),
                       loLeg=u(tr(s + 'Foot')), foot=u(tr(s + 'Toes')))
    return rest


def quat_continuity(q):
    q = q.copy()
    for i in range(1, len(q)):
        if np.dot(q[i], q[i - 1]) < 0:
            q[i] = -q[i]
    return q


def write_clip(out, bones, hips):
    n = len(hips)
    clip = {'fps': FPS, 'n': n, 'bones': {}, 'hips': np.round(hips, 4).reshape(-1).tolist()}
    for k, q in bones.items():
        clip['bones'][k] = np.round(quat_continuity(q), 4).reshape(-1).tolist()
    json.dump(clip, open(out, 'w'), separators=(',', ':'))
    print('wrote', out, n, 'frames', len(bones), 'bones')


def mirror_q(q):            # reflect across the YZ plane (her left <-> right)
    return q * np.array([1, -1, -1, 1])


def swap_lr(name):
    return name.replace('left', '#').replace('right', 'left').replace('#', 'right')

# ---------------- AIST++ ----------------

SMPL2VRM = {0: 'hips', 1: 'leftUpperLeg', 2: 'rightUpperLeg', 3: 'spine', 4: 'leftLowerLeg', 5: 'rightLowerLeg',
            6: 'chest', 7: 'leftFoot', 8: 'rightFoot', 10: 'leftToes', 11: 'rightToes', 12: 'neck',
            13: 'leftShoulder', 14: 'rightShoulder', 15: 'head', 16: 'leftUpperArm', 17: 'rightUpperArm',
            18: 'leftLowerArm', 19: 'rightLowerArm', 20: 'leftHand', 21: 'rightHand'}

# per song: [start bar, bars, sequence, source bar, mirror]. Bars count from the target song's first downbeat
# (beats json 'downbeat'), as in timelines.js. Sequences need an entry in the AIST beats json (aist_beats.py).
PLANS_AIST = {}
PLANS_AIST['starlight-stage'] = [   # 64 bars, 125 BPM
    (0, 4, 'gJB_sFM_cAll_d08_mJB5_ch13', 0, False),     # intro: ballet jazz, open and graceful
    (4, 8, 'gJS_sFM_cAll_d01_mJS3_ch04', 2, False),     # verse: street jazz
    (12, 4, 'gJS_sFM_cAll_d01_mJS3_ch04', 10, False),   # build
    (16, 4, 'gPO_sBM_cAll_d12_mPO5_ch01', 0, False),    # pre-chorus: pop basics
    (20, 8, 'gLH_sFM_cAll_d17_mLH4_ch12', 1, False),    # chorus: LA hip-hop
    (28, 4, 'gJB_sFM_cAll_d08_mJB5_ch13', 4, False),    # break: ballet jazz
    (32, 12, 'gJS_sFM_cAll_d03_mJS3_ch04', 2, True),    # verse 2 (mirrored)
    (44, 4, 'gPO_sBM_cAll_d11_mPO5_ch01', 0, False),    # pre-chorus
    (48, 8, 'gLH_sFM_cAll_d18_mLH4_ch19', 1, False),    # chorus 2
    (56, 8, 'gHO_sFM_cAll_d21_mHO5_ch20', 2, False),    # final: house
]
# 星空的歸途: 80 bars at 95 BPM (sections in timelines.js). Slower sources (90-110 BPM pop / middle hip-hop /
# street jazz) where possible, so the time-warp to 95 BPM stays close to the dancers' own speed.
PLANS_AIST['xingkong-de-guitu'] = [
    (0, 2, 'gJB_sFM_cAll_d08_mJB5_ch13', 0, False),     # intro: ballet jazz, open and graceful
    (2, 7, 'gJB_sFM_cAll_d07_mJB5_ch06', 2, False),     # riff: ballet jazz (another dancer)
    (9, 10, 'gPO_sFM_cAll_d11_mPO1_ch09', 1, False),    # verse: pop (90 BPM)
    (19, 6, 'gJS_sFM_cAll_d01_mJS3_ch04', 2, False),    # build: street jazz
    (25, 10, 'gLH_sFM_cAll_d17_mLH4_ch12', 1, False),   # chorus: LA hip-hop
    (35, 2, 'gJB_sFM_cAll_d08_mJB5_ch13', 4, False),    # break: ballet jazz
    (37, 6, 'gPO_sFM_cAll_d12_mPO1_ch16', 1, True),     # verse 2: pop (mirrored)
    (43, 4, 'gJS_sFM_cAll_d03_mJS3_ch04', 2, False),    # chorus 2: street jazz
    (47, 5, 'gWA_sFM_cAll_d27_mWA0_ch15', 2, False),    # dance break: waacking
    (52, 6, 'gMH_sFM_cAll_d24_mMH3_ch18', 1, False),    # dance break: middle hip-hop
    (58, 4, 'gJB_sFM_cAll_d07_mJB5_ch06', 9, True),     # bridge: ballet jazz (mirrored)
    (62, 8, 'gLH_sFM_cAll_d18_mLH4_ch19', 1, False),    # last chorus: LA hip-hop
    (70, 6, 'gMH_sFM_cAll_d23_mMH3_ch11', 2, False),    # last chorus: middle hip-hop
    (76, 4, 'gPO_sFM_cAll_d10_mPO1_ch02', 4, False),    # outro: pop
]


def aist(aist_dir, beats_json, target_json, vrm, out, song=None):
    import os
    song = song or os.path.splitext(os.path.basename(target_json))[0]
    plan = PLANS_AIST[song]
    sb = json.load(open(beats_json))
    TB, tmeta = load_beats(target_json)
    dur = tmeta['duration']
    t = np.arange(0, dur, 1 / FPS)
    tb = beat_of(t, TB) - tmeta.get('downbeat', 0)   # target beat of each output frame, from the first downbeat
    names = sorted(set(SMPL2VRM.values()))
    segs = []
    for (bar0, nbar, seq, srcbar, mir) in plan:
        d = pickle.load(open(f'{aist_dir}/motions/{seq}.pkl', 'rb'))
        p = d['smpl_poses'].reshape(-1, 24, 3)
        rots = {j: R.from_rotvec(p[:, j]) for j in range(24)}
        rots[6] = rots[6] * rots[9]                  # no upperChest on this model: fold spine3 into chest
        trans = d['smpl_trans'] / d['smpl_scaling']
        # face the audience: remove the segment's mean yaw
        fwd = rots[0].apply([0, 0, 1])
        P = 60 / sb[seq]['bpm']
        s0 = sb[seq]['t0'] + srcbar * 4 * P
        f0, f1 = int(s0 * 60), min(len(p), int((s0 + nbar * 4 * P) * 60))
        if (s0 + nbar * 4 * P) * 60 > len(p):
            print(f'  note: {seq} bar {srcbar}+{nbar} runs past its end ({len(p) / 60:.1f} s), holds the last frame')
        yaw = np.arctan2(np.mean(fwd[f0:f1, 0]), np.mean(fwd[f0:f1, 2]))
        unyaw = R.from_euler('y', -yaw)
        rots[0] = unyaw * rots[0]
        pos = unyaw.apply(trans - trans[f0:f1].mean(0)) * 0.55     # travel scaled down for the stage
        pos[:, 1] = 0
        segs.append(dict(bar0=bar0, nbar=nbar, seq=seq, s0=s0, P=P, rots=rots, pos=pos, mir=mir, n=len(p)))

    def sample(sg, b):
        """local rotations (quat arrays per VRM bone) + root pos at target beats b"""
        st = sg['s0'] + (b - sg['bar0'] * 4) * sg['P']
        fi = np.clip(st * 60, 0, sg['n'] - 1.001)
        i0 = np.floor(fi).astype(int); a = fi - i0
        res = {}
        for j, nm in SMPL2VRM.items():
            r = sg['rots'][j]
            q0, q1 = r[i0].as_quat(), r[i0 + 1].as_quat()
            q1 = np.where((np.sum(q0 * q1, 1) < 0)[:, None], -q1, q1)
            q = q0 * (1 - a)[:, None] + q1 * a[:, None]
            q /= np.linalg.norm(q, axis=1, keepdims=True)
            if sg['mir']:
                q = mirror_q(q); nm = swap_lr(nm)
            res[nm] = q
        pos = sg['pos'][i0] * (1 - a)[:, None] + sg['pos'][i0 + 1] * a[:, None]
        if sg['mir']:
            pos = pos * [-1, 1, 1]
        return res, pos

    bones = {nm: np.zeros((len(t), 4)) for nm in names}
    hips = np.zeros((len(t), 3))
    BLEND = 1.0                                       # beats of cross-fade into each new section
    for k, sg in enumerate(segs):
        lo = sg['bar0'] * 4 if k else -1e9
        hi = (sg['bar0'] + sg['nbar']) * 4 if k < len(segs) - 1 else 1e9
        m = (tb >= lo) & (tb < hi)
        res, pos = sample(sg, tb[m])
        if k:
            w = np.clip((tb[m] - lo) / BLEND, 0, 1); w = w * w * (3 - 2 * w)
            prev, ppos = sample(segs[k - 1], tb[m])
            for nm in names:
                a, b2 = prev[nm], res[nm]
                b2 = np.where((np.sum(a * b2, 1) < 0)[:, None], -b2, b2)
                q = a * (1 - w)[:, None] + b2 * w[:, None]
                res[nm] = q / np.linalg.norm(q, axis=1, keepdims=True)
            pos = ppos * (1 - w)[:, None] + pos * w[:, None]
        for nm in names:
            bones[nm][m] = res[nm]
        hips[m] = pos
    write_clip(out, bones, hips)

# ---------------- K-pop video (MediaPipe) ----------------

def nrm(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def frame(e1, e3hint):
    """rotation matrices with columns (e1, e2, e3): e1 exact, e3 = hint made orthogonal"""
    e1 = nrm(e1)
    e3 = nrm(e3hint - e1 * np.sum(e3hint * e1, -1, keepdims=True))
    e2 = np.cross(e3, e1)
    return np.stack([e1, e2, e3], -1)


def rest_frame(e1, e3):
    return frame(np.asarray(e1, float)[None], np.asarray(e3, float)[None])[0]


def swing(a, b):
    """minimal rotation taking unit vectors a -> b (arrays)"""
    a, b = nrm(a), nrm(b)
    ax = np.cross(a, b); s = np.linalg.norm(ax, axis=-1); c = np.sum(a * b, -1)
    ang = np.arctan2(s, c)
    ax = np.where(s[..., None] > 1e-8, ax / np.maximum(s[..., None], 1e-9), [1, 0, 0])
    return R.from_rotvec(ax * ang[..., None])


def twisted(Gsw, axis, want, conf, ref_local, sigma=3.0):
    """Gsw: twist-free swing rotation; rotate about `axis` so Gsw(ref_local) points at `want` (perp. part).
    The twist angle is unwrapped and smoothed with confidence weights, so near-straight limbs (no bend
    plane) borrow the twist of their confident neighbours instead of flipping."""
    from scipy.ndimage import gaussian_filter1d
    ref = Gsw.apply(ref_local)
    ref = nrm(ref - axis * np.sum(ref * axis, -1, keepdims=True))
    wnt = nrm(want - axis * np.sum(want * axis, -1, keepdims=True))
    th = np.arctan2(np.sum(np.cross(ref, wnt) * axis, -1), np.sum(ref * wnt, -1))
    th = np.unwrap(th)
    c = np.clip(conf.reshape(-1), 1e-3, 1)
    th = gaussian_filter1d(th * c, sigma) / gaussian_filter1d(c, sigma)
    return R.from_rotvec(axis * th[:, None]) * Gsw


def lowpass_rot(r, cut, fps):
    q = quat_continuity(r.as_quat())
    b, a = butter(2, cut / (fps / 2))
    q = filtfilt(b, a, q, axis=0)
    return R.from_quat(q / np.linalg.norm(q, axis=1, keepdims=True))


def kpop(npz, vbeats_json, target_json, vrm, out, src_first_beat):
    d = np.load(npz)
    fps = float(d['fps']); W, H = d['size']
    world, img, ok = d['world'].astype(float), d['img'].astype(float), d['ok'].astype(bool)
    n = len(ok); tv = np.arange(n) / fps
    # fill missing frames, then low-pass (MediaPipe jitters; dance accents survive 6 Hz)
    idx = np.where(ok)[0]
    for arr in (world, img):
        for j in range(33):
            for c in range(3):
                arr[:, j, c] = np.interp(np.arange(n), idx, arr[idx, j, c])
    bb, aa = butter(2, 6 / (fps / 2))
    P = filtfilt(bb, aa, world[..., :3], axis=0)
    P = P * [1, -1, -1]                                # MediaPipe (x right, y down, z away) -> character frame

    J = lambda i: P[:, i]
    mid = lambda a, b: (J(a) + J(b)) / 2
    pelvis, neck = mid(23, 24), mid(11, 12)
    up = neck - pelvis
    rest = vrm_rest(vrm)
    I = np.eye(3)

    G = {}                                             # global rotations (R objects)
    G['hips'] = R.from_matrix(frame(J(23) - J(24), np.cross(J(23) - J(24), up)) @ rest_frame([1, 0, 0], [0, 0, 1]).T)
    # chest: shoulder line + spine; nose direction keeps it from flipping
    Gc = R.from_matrix(frame(J(11) - J(12), np.cross(J(11) - J(12), up)) @ rest_frame([1, 0, 0], [0, 0, 1]).T)
    rel = G['hips'].inv() * Gc
    half = R.from_rotvec(rel.as_rotvec() * 0.5)
    G['spine'] = G['hips'] * half
    G['chest'] = Gc
    # head from the ears + nose; nose sits ~15deg below the ear line at rest
    ears = mid(7, 8)
    Gh = R.from_matrix(frame(J(7) - J(8), J(0) - ears) @ rest_frame([1, 0, 0], [0, 0, 1]).T) * R.from_euler('x', -0.26)
    relh = Gc.inv() * Gh
    relh = R.from_rotvec(relh.as_rotvec() * 0.85)      # MediaPipe overshoots head turns
    G['neck'] = Gc * R.from_rotvec(relh.as_rotvec() * 0.4)
    G['head'] = Gc * relh

    for s, (sh, el, wr, pk, ix, hp, kn, an, he, ft) in {
            'left': (11, 13, 15, 17, 19, 23, 25, 27, 29, 31), 'right': (12, 14, 16, 18, 20, 24, 26, 28, 30, 32)}.items():
        rs = rest[s]
        # ---- arm ----
        dua, dla = nrm(J(el) - J(sh)), nrm(J(wr) - J(el))
        bend = dla - dua * np.sum(dla * dua, -1, keepdims=True)
        bl = np.linalg.norm(bend, axis=-1, keepdims=True)
        # twist: the elbow bend plane (forearm folds toward rest +z); smoothed through straight-arm frames
        sw = swing(Gc.apply(rs['upArm']), dua) * Gc
        w = np.clip((bl - 0.12) / 0.3, 0, 1)
        G[s + 'UpperArm'] = twisted(sw, dua, bend, w, [0, 0, 1])
        G[s + 'LowerArm'] = swing(G[s + 'UpperArm'].apply(rs['loArm']), dla) * G[s + 'UpperArm']
        # hand: index/pinky knuckles give direction + palm; damped and low-passed (noisy)
        hdir = (J(ix) + J(pk)) / 2 - J(wr)
        Fh = rest_frame(rs['loArm'], [0, 0, 1])
        Gh_ = R.from_matrix(frame(hdir, J(ix) - J(pk)) @ Fh.T)
        relh_ = lowpass_rot(G[s + 'LowerArm'].inv() * Gh_, 3, fps)
        G[s + 'Hand'] = G[s + 'LowerArm'] * R.from_rotvec(np.clip(relh_.as_rotvec(), -1.2, 1.2) * 0.4)
        # ---- leg ----
        dul, dll = nrm(J(kn) - J(hp)), nrm(J(an) - J(kn))
        bend = dll - dul * np.sum(dll * dul, -1, keepdims=True)
        bl = np.linalg.norm(bend, axis=-1, keepdims=True)
        toe = nrm(J(ft) - J(he))                                    # foot forward
        w = np.clip((bl - 0.1) / 0.25, 0, 1)
        # knee points where the shin folds away from; when straight, the toes say where the knee faces
        want = -nrm(bend) * w + toe * (1 - w)
        swl = swing(G['hips'].apply(rs['upLeg']), dul) * G['hips']
        G[s + 'UpperLeg'] = twisted(swl, dul, want, np.maximum(w, 0.5), [0, 0, 1])
        G[s + 'LowerLeg'] = swing(G[s + 'UpperLeg'].apply(rs['loLeg']), dll) * G[s + 'UpperLeg']
        G[s + 'Foot'] = swing(G[s + 'LowerLeg'].apply(rs['foot']), J(ft) - J(an)) * G[s + 'LowerLeg']

    parent = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck'}
    for s in ('left', 'right'):
        parent.update({s + 'UpperArm': 'chest', s + 'LowerArm': s + 'UpperArm', s + 'Hand': s + 'LowerArm',
                       s + 'UpperLeg': 'hips', s + 'LowerLeg': s + 'UpperLeg', s + 'Foot': s + 'LowerLeg'})
    local = {k: (G[k] if p is None else G[p].inv() * G[k]) for k, p in parent.items()}
    for k in local:                                    # feet are the noisiest landmarks
        if k.endswith('Foot'):
            local[k] = lowpass_rot(local[k], 4, fps)

    # root travel from the image: x from the hip position, depth from the apparent body size
    torso_px = np.linalg.norm((img[:, 11, :2] + img[:, 12, :2]) / 2 - (img[:, 23, :2] + img[:, 24, :2]) / 2, axis=1)
    torso_m = np.median(np.linalg.norm(up, axis=1))
    bl2, al2 = butter(2, 0.8 / (fps / 2))
    tpx = filtfilt(bl2, al2, torso_px)
    u = filtfilt(bl2, al2, (img[:, 23, 0] + img[:, 24, 0]) / 2)
    scale = torso_m / np.median(tpx)
    fpx = 1.0 * W
    d0 = fpx * torso_m / np.median(tpx)
    x = (u - np.median(u)) * scale
    z = d0 * (1 - np.median(tpx) / tpx)                # bigger on screen -> closer -> +z
    root = np.stack([np.clip(x * 0.7, -1.3, 1.3), np.zeros(n), np.clip(z * 0.5, -0.8, 0.8)], 1)

    # beat-to-beat time warp: target beat k <- video beat src_first_beat + k
    TB, tmeta = load_beats(target_json)
    VB, _ = load_beats(vbeats_json)
    t = np.arange(0, tmeta['duration'], 1 / FPS)
    src_t = time_of(beat_of(t, TB) + src_first_beat, VB)
    fi = np.clip(src_t * fps, 0, n - 1.001)
    i0 = np.floor(fi).astype(int); a = fi - i0
    bones = {}
    for k, r in local.items():
        q = quat_continuity(r.as_quat())
        q0, q1 = q[i0], q[i0 + 1]
        qq = q0 * (1 - a)[:, None] + q1 * a[:, None]
        bones[k] = qq / np.linalg.norm(qq, axis=1, keepdims=True)
    hips = root[i0] * (1 - a)[:, None] + root[i0 + 1] * a[:, None]
    write_clip(out, bones, hips)


# ---------------- dance video via GVHMR (SMPL-X rotations) ----------------

def smpl(gv_npz, src_fps, vbeats_json, target_json, out, src_first_beat):
    """GVHMR world-grounded SMPL-X body rotations (same joint order as SMPL 0-21, so the AIST++ mapping applies),
    time-warped beat-to-beat onto the target song like kpop(). gv_npz from GVHMR (export_gvhmr.py)."""
    d = np.load(gv_npz)
    fps = float(src_fps)
    go, bp, tr = d['global_orient'], d['body_pose'].reshape(len(d['global_orient']), 21, 3), d['transl']
    n = len(go)
    rots = {0: R.from_rotvec(go)}
    for j in range(1, 22):
        rots[j] = R.from_rotvec(bp[:, j - 1])
    rots[6] = rots[6] * rots[9]                      # no upperChest on this model: fold spine3 into chest

    TB, tmeta = load_beats(target_json)
    VB, _ = load_beats(vbeats_json)
    t = np.arange(0, tmeta['duration'], 1 / FPS)
    src_t = time_of(beat_of(t, TB) + src_first_beat, VB)
    fi = np.clip(src_t * fps, 0, n - 1.001)
    i0 = np.floor(fi).astype(int); a = fi - i0
    f0, f1 = i0.min(), i0.max() + 2

    # face the audience: remove the mean yaw of the used span
    fwd = rots[0].apply([0, 0, 1])
    yaw = np.arctan2(np.mean(fwd[f0:f1, 0]), np.mean(fwd[f0:f1, 2]))
    unyaw = R.from_euler('y', -yaw)
    rots[0] = unyaw * rots[0]
    pos = unyaw.apply(tr - tr[f0:f1].mean(0)) * 0.6   # travel scaled down for the stage
    pos[:, 1] = 0
    pos = np.clip(pos, [-1.3, 0, -0.8], [1.3, 0, 0.8])

    bones = {}
    for j, nm in SMPL2VRM.items():
        if j >= 22:
            continue
        q = quat_continuity(rots[j].as_quat())
        qq = q[i0] * (1 - a)[:, None] + q[i0 + 1] * a[:, None]
        bones[nm] = qq / np.linalg.norm(qq, axis=1, keepdims=True)
    hips = pos[i0] * (1 - a)[:, None] + pos[i0 + 1] * a[:, None]
    write_clip(out, bones, hips)


if __name__ == '__main__':
    mode, *a = sys.argv[1:]
    if mode == 'aist':
        aist(*a)
    elif mode == 'smpl':
        smpl(*a[:5], int(a[5]))
    else:
        kpop(*a[:5], int(a[5]))
