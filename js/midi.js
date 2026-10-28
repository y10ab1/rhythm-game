// ============================================================
//  MIDI parsing -> timed notes + an analysis object for charting
// ============================================================

export function parseMidi(arrayBuffer) {
  const data = new DataView(arrayBuffer);
  let offset = 0;
  const readStr = len => { let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(data.getUint8(offset++)); return s; };
  const read8 = () => data.getUint8(offset++);
  const read16 = () => { const v = data.getUint16(offset); offset += 2; return v; };
  const read32 = () => { const v = data.getUint32(offset); offset += 4; return v; };
  const readVarLen = () => {
    let val = 0;
    for (let i = 0; i < 4; i++) { const b = read8(); val = (val << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
    return val;
  };

  if (readStr(4) !== 'MThd') throw new Error('Not a valid MIDI file');
  const headerLen = read32();
  const format = read16();
  const numTracks = read16();
  const division = read16();
  offset = 8 + headerLen;
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');

  const tracks = [];
  for (let t = 0; t < numTracks && offset < data.byteLength; t++) {
    const id = readStr(4);
    const len = read32();
    if (id !== 'MTrk') { offset += len; t--; continue; }
    const end = offset + len;
    const events = [];
    let running = 0, tick = 0;
    while (offset < end) {
      tick += readVarLen();
      let status = data.getUint8(offset);
      if (status & 0x80) { offset++; if (status < 0xf0) running = status; } else status = running;
      const type = status & 0xf0;
      if (type === 0x90 || type === 0x80) {
        const note = read8(), vel = read8();
        events.push({ tick, type: type === 0x90 && vel > 0 ? 'on' : 'off', ch: status & 0x0f, note, vel });
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
        offset += 2;
      } else if (type === 0xc0 || type === 0xd0) {
        offset += 1;
      } else if (status === 0xff) {
        const meta = read8(), mlen = readVarLen();
        const bytes = new Uint8Array(arrayBuffer, offset, mlen);
        offset += mlen;
        if (meta === 0x51 && mlen >= 3) events.push({ tick, type: 'tempo', tempo: (bytes[0] << 16) | (bytes[1] << 8) | bytes[2] });
        if (meta === 0x58 && mlen >= 2) events.push({ tick, type: 'timesig', num: bytes[0], den: 1 << bytes[1] });
      } else if (status === 0xf0 || status === 0xf7) {
        offset += readVarLen();
      }
    }
    offset = end;
    tracks.push(events);
  }
  return { format, ticksPerBeat: division, tracks };
}

export function midiToSong(midi) {
  const tpb = midi.ticksPerBeat;
  const all = midi.tracks.flat();
  const tempos = all.filter(e => e.type === 'tempo').sort((a, b) => a.tick - b.tick);
  const sig = all.filter(e => e.type === 'timesig').sort((a, b) => a.tick - b.tick)[0] || { num: 4, den: 4 };
  const barTicks = Math.round(sig.num * tpb * 4 / sig.den);

  const tickToSec = tick => {
    let sec = 0, prev = 0, tempo = 500000;
    for (const tc of tempos) {
      if (tc.tick > tick) break;
      sec += (tc.tick - prev) * tempo / tpb / 1e6;
      prev = tc.tick; tempo = tc.tempo;
    }
    return sec + (tick - prev) * tempo / tpb / 1e6;
  };

  // pair note on/off per track
  const notes = [];
  for (const track of midi.tracks) {
    const open = {};
    for (const e of track) {
      const key = e.ch * 128 + e.note;
      if (e.type === 'on') {
        if (e.ch === 9) continue; // skip GM percussion channel
        (open[key] ||= []).push(e);
      } else if (e.type === 'off' && open[key]?.length) {
        const s = open[key].shift();
        notes.push({ tick: s.tick, t: tickToSec(s.tick), pitch: s.note, vel: s.vel, dur: Math.max(0.05, tickToSec(e.tick) - tickToSec(s.tick)) });
      }
    }
    for (const list of Object.values(open)) for (const s of list) notes.push({ tick: s.tick, t: tickToSec(s.tick), pitch: s.note, vel: s.vel, dur: 0.3 });
  }
  notes.sort((a, b) => a.t - b.t || b.pitch - a.pitch);
  if (!notes.length) throw new Error('No notes found in this MIDI file');

  // cluster simultaneous notes into onsets
  const onsets = { t: [], s: [], c: [], sus: [], level: [] };
  for (let i = 0; i < notes.length;) {
    let j = i;
    while (j < notes.length && notes[j].t - notes[i].t < 0.02) j++;
    const group = notes.slice(i, j);
    const top = group.reduce((a, b) => (b.pitch > a.pitch ? b : a));
    const maxVel = Math.max(...group.map(n => n.vel));
    const tk = group[0].tick;
    for (const n of group) n.g = group[0].t;
    const level = tk % barTicks === 0 ? 0 : tk % tpb === 0 ? 1 : tk % (tpb / 2) === 0 ? 2 : 3;
    onsets.t.push(group[0].t);
    onsets.s.push((maxVel / 127) * (0.75 + 0.25 * Math.min(1, group.length / 3)));
    onsets.c.push(top.pitch / 12); // pitch drives lane choice
    onsets.sus.push(top.dur);
    onsets.level.push(level);
    i = j;
  }

  const lastTick = Math.max(...notes.map(n => n.tick));
  const beats = [];
  for (let tk = 0; tk <= lastTick + tpb; tk += tpb) beats.push(tickToSec(tk));
  const duration = Math.max(...notes.map(n => n.t + n.dur)) + 0.5;
  const firstTempo = tempos.length ? tempos[0].tempo : 500000;

  return {
    notes,
    analysis: {
      kind: 'midi',
      duration,
      bpm: 60e6 / firstTempo,
      beats,
      downbeat: 0,
      barBeats: barTicks / tpb,
      onsets,
    },
  };
}
