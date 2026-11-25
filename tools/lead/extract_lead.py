#!/usr/bin/env python3
"""Offline lead-melody extraction for the built-in songs -> songs/<id>.lead.json

    python tools/lead/extract_lead.py [song-id ...]          (default: every audio song in the manifest)
    python tools/lead/extract_lead.py --preview neon-riot    (also writes /tmp/lead-preview/<id>.wav: song + sine lead)

Pipeline
  1. Demucs htdemucs_6s splits the mix into drums / bass / guitar / piano / other / vocals.
  2. basic-pitch transcribes each melodic stem (guitar, piano, other, vocals) polyphonically.
  3. Per stem, the melody line: of the notes starting together (30 ms), the highest loud-enough one (of an
     octave pair, the one nearer the line); a note with a clearly higher note still ringing over it is
     accompaniment and drops out; vibrato / bend fragments (touching notes a semitone apart, no re-attack in the
     stem's onset strength) merge back into one held note.
  4. Per one-second window the stem whose top voice carries the most (loudness x register, vocals preferred)
     is the lead; a majority vote over +-2 s keeps it from flickering between instruments.

Output: { version, stems: {<stem>: seconds as lead}, notes: [[time, dur, midi, strength 0..1], ...] }

Setup (once): uv venv -p 3.11 ~/.venvs/lead
              uv pip install -p ~/.venvs/lead/bin/python torch torchaudio --index-url https://download.pytorch.org/whl/cu128
              uv pip install -p ~/.venvs/lead/bin/python demucs soundfile onnxruntime librosa mir_eval pretty_midi resampy scipy "numpy<2.3"
              uv pip install -p ~/.venvs/lead/bin/python --no-deps basic-pitch
Run with:     ~/.venvs/lead/bin/python tools/lead/extract_lead.py
"""
import json
import logging
import os
import subprocess
import sys

logging.disable(logging.WARNING)
import numpy as np
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
STEM_DIR = os.environ.get('LEAD_STEM_DIR', '/tmp/lead-stems')
MELODIC = ['vocals', 'guitar', 'other', 'piano']
VERSION = 2
WIN = 1.0           # stem-choice window (s)
VOTE = 2            # majority vote over +-VOTE windows


def separate(path, song_id):
    out = os.path.join(STEM_DIR, 'htdemucs_6s', song_id)
    if not os.path.exists(os.path.join(out, 'vocals.wav')):
        subprocess.run([sys.executable, '-m', 'demucs', '-n', 'htdemucs_6s', '-o', STEM_DIR, path],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


_model = None


def transcribe(wav):
    cache = wav + '.notes.json'
    if os.path.exists(cache) and os.path.getmtime(cache) > os.path.getmtime(wav):
        return [tuple(n) for n in json.load(open(cache))]
    notes = _transcribe(wav)
    json.dump(notes, open(cache, 'w'))
    return notes


def _transcribe(wav):
    global _model
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, predict
    if _model is None:
        _model = Model(ICASSP_2022_MODEL_PATH)
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):
        _, _, notes = predict(wav, _model, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=58)
    # (start, end, pitch, amplitude)
    return sorted(((float(a), float(b), int(p), float(v)) for a, b, p, v, *_ in notes), key=lambda n: (n[0], -n[2]))


def stem_level(wav):
    x, _ = sf.read(wav, dtype='float32')
    x = x.mean(1) if x.ndim > 1 else x
    return 10 * np.log10(np.mean(x * x) + 1e-12)


ATTACK = 2.5        # stem onset strength / its local mean above which a note boundary is a real re-attack


def attack_fn(wav):
    """t -> how hard the stem is attacked at t (onset strength over its 0.5 s local mean; ~4+ = picked note,
    vibrato / bend fragments stay around 1-2)"""
    import librosa
    y, sr = librosa.load(wav, sr=22050, mono=True)
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=256, lag=2, max_size=3)
    fps = sr / 256
    k = max(1, int(fps * 0.5))
    loc = np.convolve(env, np.ones(k) / k, mode='same')

    def att(t):
        a, b = max(0, int((t - 0.03) * fps)), int((t + 0.03) * fps) + 1
        if a >= len(env):
            return 0.0
        i = a + int(np.argmax(env[a:b]))
        return float(env[i] / (loc[i] + 1e-9))
    return att


def top_voice(notes, att):
    """the stem's melody line: the highest sounding note, held notes kept whole"""
    loud = [n for n in notes if n[3] >= 0.33]
    out, i, prev = [], 0, None
    while i < len(loud):
        j = i
        while j + 1 < len(loud) and loud[j + 1][0] - loud[i][0] < 0.03:
            j += 1
        grp = loud[i:j + 1]
        amax = max(n[3] for n in grp)
        cand = [n for n in grp if n[3] >= amax * 0.7]
        best = max(cand, key=lambda n: n[2])
        # octave / twelfth pairs (a harmonic transcribed as a second note): of the two, the one nearer the line
        # so far (lower on a tie or at the start), so the line does not flip an octave
        rel = [n for n in cand if n is not best and abs(best[2] - n[2]) in (12, 19, 24)]
        if rel:
            pair = [best] + rel
            ref = prev[2] if prev else min(n[2] for n in pair)
            best = min(pair, key=lambda n: (abs(n[2] - ref), n[2]))
        out.append(best)
        prev = best
        i = j + 1
    # accompaniment under a held melody note: drop a note when a clearly higher note is still ringing over it
    # (when the lead rests, the highest sounding note -- a riff, a chord top -- is the line)
    kept = []
    for n in out:
        if any(m[0] < n[0] - 0.03 and m[1] > n[0] + 0.05 and m[2] > n[2] + 2 and m[3] >= 0.4 for m in loud):
            continue
        # ... but not in the short gaps of a staccato line: far below the last line note, it has to be a real rest
        if kept and n[2] < kept[-1][2] - 9 and n[0] - kept[-1][1] < 0.3:
            continue
        kept.append(n)
    # vibrato / bends come out as a chain of touching notes a semitone apart: merge them into one held note
    # unless the stem is really re-attacked at the boundary
    merged = []
    for n in kept:
        if merged:
            m = merged[-1]
            if n[0] - m['end'] < 0.05 and abs(n[2] - m['p0']) <= 1 and att(n[0]) < ATTACK:
                m['end'] = max(m['end'], n[1])
                m['dur'][n[2]] = m['dur'].get(n[2], 0) + n[1] - n[0]
                m['amp'] = max(m['amp'], n[3])
                continue
        merged.append({'start': n[0], 'end': n[1], 'p0': n[2], 'dur': {n[2]: n[1] - n[0]}, 'amp': n[3]})
    # a new note cuts the previous one short; the held pitch is the one sounding longest
    res = []
    for k, m in enumerate(merged):
        end = m['end']
        if k + 1 < len(merged):
            end = min(end, merged[k + 1]['start'])
        if end - m['start'] >= 0.05:
            res.append((m['start'], end, max(m['dur'], key=m['dur'].get), m['amp']))
    return res


def extract(song_id, path):
    stems = separate(path, song_id)
    voices, gain = {}, {}
    for st in MELODIC:
        wav = os.path.join(stems, st + '.wav')
        gain[st] = stem_level(wav)
        voices[st] = top_voice(transcribe(wav), attack_fn(wav))
    ref = max(gain.values())
    duration = max((n[1] for v in voices.values() for n in v), default=0)
    nw = int(duration / WIN) + 1

    score = np.zeros((len(MELODIC), nw))
    for si, st in enumerate(MELODIC):
        # quiet stems (bleed) count less: -12 dB under the loudest melodic stem halves the score
        g = 2 ** ((gain[st] - ref) / 12)
        for a, b, p, v in voices[st]:
            reg = min(1.0, max(0.3, (p - 45) / 24))
            score[si, int(a / WIN)] += v * reg * g * (1.4 if st == 'vocals' else 1.0)
    choice = np.where(score.max(0) > 0.6, score.argmax(0), -1)
    voted = choice.copy()
    for w in range(nw):
        seg = choice[max(0, w - VOTE): w + VOTE + 1]
        seg = seg[seg >= 0]
        if len(seg) and choice[w] >= 0:
            vals, cnt = np.unique(seg, return_counts=True)
            voted[w] = vals[np.argmax(cnt)]

    notes = []
    for si, st in enumerate(MELODIC):
        for a, b, p, v in voices[st]:
            if voted[int(a / WIN)] == si:
                notes.append([a, b - a, p, v])
    notes.sort()
    stem_secs = {st: float((voted == si).sum() * WIN) for si, st in enumerate(MELODIC)}
    return {
        'version': VERSION,
        'stems': stem_secs,
        'notes': [[round(t, 3), round(d, 3), p, round(v, 2)] for t, d, p, v in notes],
    }


def preview(song_id, path, lead):
    """song at -6 dB + a sine on every lead note, for listening checks"""
    os.makedirs('/tmp/lead-preview', exist_ok=True)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    mix = np.frombuffer(raw, dtype=np.float32).copy() * 0.5
    for t, d, p, s in lead['notes']:
        a, b = int(t * 44100), min(len(mix), int((t + d) * 44100))
        if b <= a:
            continue
        k = np.arange(b - a) / 44100
        env = np.minimum(1, np.minimum(k / 0.005, (d - k) / 0.02)).clip(0, 1)
        mix[a:b] += 0.22 * env * np.sin(2 * np.pi * 440 * 2 ** ((p - 69) / 12) * k)
    out = f'/tmp/lead-preview/{song_id}.wav'
    sf.write(out, np.clip(mix, -1, 1), 44100)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    want_preview = '--preview' in sys.argv
    manifest = json.load(open(os.path.join(ROOT, 'songs', 'manifest.json'), encoding='utf-8'))
    songs = [s for s in manifest if s.get('kind') == 'audio' and (not args or s['id'] in args)]
    for s in songs:
        path = os.path.join(ROOT, 'songs', s['file'])
        lead = extract(s['id'], path)
        out = os.path.join(ROOT, 'songs', s['id'] + '.lead.json')
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(lead, f, separators=(',', ':'))
        msg = f"{s['id']:20s} {len(lead['notes']):5d} lead notes  stems {lead['stems']}"
        if want_preview:
            msg += '  preview ' + preview(s['id'], path, lead)
        print(msg, flush=True)


if __name__ == '__main__':
    main()
