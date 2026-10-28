#!/usr/bin/env python3
"""Write songs/fur_elise.mid: a steady-tempo, grid-exact arrangement of the
Für Elise A section (theme + bridge), played three times.

Time is written in 16th notes. The file uses 3/4 with one MIDI beat = the
notated 8th note, so the chart generator sees bars / 8ths / 16ths correctly.
"""
import os
import struct

BPM = 156          # notated 8th notes per minute
TPB = 120          # ticks per MIDI beat (= notated 8th)
U = TPB // 2       # one 16th note
BAR = 6            # 16ths per 3/8 bar

NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def p(name):
    acc = 1 if '#' in name else -1 if name[1] == 'b' else 0
    return 12 * (int(name[-1]) + 1) + NAMES[name[0]] + acc


# one bar = list of (16th position, pitch, length in 16ths)
def bar(*events):
    return [(pos, p(n), d) for pos, n, d in events]


S = lambda *names: bar(*[(i, n, 1) for i, n in enumerate(names)])
THEME_RUN = S('E5', 'D#5', 'E5', 'B4', 'D5', 'C5')
RH = {
    'run': THEME_RUN,
    'a': bar((0, 'A4', 2), (3, 'C4', 1), (4, 'E4', 1), (5, 'A4', 1)),
    'b': bar((0, 'B4', 2), (3, 'E4', 1), (4, 'G#4', 1), (5, 'B4', 1)),
    'c': bar((0, 'C5', 2), (3, 'E4', 1), (4, 'E5', 1), (5, 'D#5', 1)),
    'b2': bar((0, 'B4', 2), (3, 'E4', 1), (4, 'C5', 1), (5, 'B4', 1)),
    'end1': bar((0, 'A4', 2), (4, 'E5', 1), (5, 'D#5', 1)),
    'end2': bar((0, 'A4', 2), (3, 'B4', 1), (4, 'C5', 1), (5, 'D5', 1)),
    'br1': bar((0, 'E5', 3), (3, 'G4', 1), (4, 'F5', 1), (5, 'E5', 1)),
    'br2': bar((0, 'D5', 3), (3, 'F4', 1), (4, 'E5', 1), (5, 'D5', 1)),
    'br3': bar((0, 'C5', 3), (3, 'E4', 1), (4, 'D5', 1), (5, 'C5', 1)),
    'br4': bar((0, 'B4', 2), (3, 'E4', 1), (4, 'E5', 1)),
    'br5': bar((1, 'E5', 1), (2, 'E6', 1), (5, 'D#5', 1)),
    'br6': bar((0, 'E5', 1), (3, 'D#5', 1), (4, 'E5', 1), (5, 'D#5', 1)),
    'final': bar((0, 'A4', 6)),
}
LH = {
    'Am': bar((0, 'A2', 1), (1, 'E3', 1), (2, 'A3', 1)),
    'E': bar((0, 'E2', 1), (1, 'E3', 1), (2, 'G#3', 1)),
    'C': bar((0, 'C3', 1), (1, 'G3', 1), (2, 'C4', 1)),
    'G': bar((0, 'G2', 1), (1, 'G3', 1), (2, 'B3', 1)),
    'Eo': bar((0, 'E2', 1), (1, 'E3', 1), (2, 'E4', 1)),
    '-': [],
    'Amf': bar((0, 'A2', 6), (0, 'E3', 6), (0, 'A3', 6), (0, 'C4', 6)),
}

PHRASE = [('run', '-'), ('a', 'Am'), ('b', 'E'), ('c', 'Am'), ('run', '-'), ('a', 'Am'), ('b2', 'E')]
BRIDGE = [('br1', 'C'), ('br2', 'G'), ('br3', 'Am'), ('br4', 'Eo'), ('br5', '-'), ('br6', '-')]


def section(last):
    return (PHRASE + [('end1', 'Am')] + PHRASE + [('end2', 'Am')] + BRIDGE + PHRASE + [last])


def build():
    rh, lh = [], []
    # pickup "E5 D#5" in the last 8th of bar 0
    rh += [(4 * U, p('E5'), U, 92), (5 * U, p('D#5'), U, 88)]
    bars = section(('end1', 'Am')) + section(('end1', 'Am')) + section(('final', 'Amf'))
    for i, (r, l) in enumerate(bars):
        base = (i + 1) * BAR * U
        heavy = len(bars) // 3 <= i < 2 * len(bars) // 3  # second pass: louder, octave bass
        for pos, pitch, d in RH[r]:
            accent = 100 if pos == 0 else 90
            rh.append((base + pos * U, pitch, d * U, min(120, accent + (10 if heavy else 0))))
        for pos, pitch, d in LH[l]:
            lh.append((base + pos * U, pitch, d * U, 66 if heavy else 58))
            if heavy and pos == 0 and d == 1:
                lh.append((base, pitch - 12, U, 62))
    return rh, lh


def varlen(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.insert(0, (n & 0x7F) | 0x80)
        n >>= 7
    return bytes(out)


def track(events):
    """events: (tick, bytes) with absolute ticks."""
    events.sort(key=lambda e: (e[0], e[1][0] & 0xF0 == 0x90))  # note-offs first
    data, last = b'', 0
    for tick, msg in events:
        data += varlen(tick - last) + msg
        last = tick
    data += b'\x00\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + data


def notes_track(notes, ch, program):
    ev = [(0, bytes([0xC0 | ch, program]))]
    for t, pitch, d, vel in notes:
        ev.append((t, bytes([0x90 | ch, pitch, vel])))
        ev.append((t + d - 4, bytes([0x80 | ch, pitch, 0])))
    return track(ev)


def main():
    rh, lh = build()
    mpqn = round(60e6 / BPM)
    meta = track([
        (0, b'\xff\x58\x04\x03\x02\x18\x08'),            # 3/4 (beat = notated 8th)
        (0, b'\xff\x51\x03' + mpqn.to_bytes(3, 'big')),
    ])
    out = b'MThd' + struct.pack('>IHHH', 6, 1, 3, TPB) + meta + notes_track(rh, 0, 0) + notes_track(lh, 1, 0)
    path = os.path.join(os.path.dirname(__file__), '..', 'songs', 'fur_elise.mid')
    with open(path, 'wb') as f:
        f.write(out)
    print('wrote', path, len(out), 'bytes,', len(rh) + len(lh), 'notes')


if __name__ == '__main__':
    main()
