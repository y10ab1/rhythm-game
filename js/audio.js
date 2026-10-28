// ============================================================
//  Audio engine: context, latency-aware clock, hit sounds, music
// ============================================================
import { ANALYSIS_SR } from './analyzer.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.midiTimer = null;
    this.musicSource = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    // gentle limiter so hit sounds on top of loud music do not clip
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -6; this.comp.knee.value = 6; this.comp.ratio.value = 8;
    this.comp.attack.value = 0.002; this.comp.release.value = 0.12;
    this.comp.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.comp);
    this.tapBuffer = this.renderTap();
    this.clickBuffers = [this.renderClick(1500), this.renderClick(2200)];
    return ctx;
  }

  setVolumes(music, sfx) {
    this.ensure();
    this.musicBus.gain.value = music;
    this.sfxBus.gain.value = sfx;
  }

  // Context time that is reaching the speakers at performance time `perf`.
  heardTime(perf = performance.now()) {
    const ctx = this.ctx;
    if (!ctx) return 0;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts.performanceTime > 0 && ts.contextTime > 0) {
        return ts.contextTime + (perf - ts.performanceTime) / 1000;
      }
    }
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return ctx.currentTime - latency + (perf - performance.now()) / 1000;
  }

  // --- pre-rendered sounds (no node graph building on the hot path) ---
  renderTap() {
    const sr = this.ctx.sampleRate, len = Math.round(sr * 0.07);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const click = Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 140) * 0.45;
      const noise = rnd() * Math.exp(-t * 320) * 0.5;
      const body = Math.sin(2 * Math.PI * (180 + 260 * Math.exp(-t * 70)) * t) * Math.exp(-t * 45) * 0.55;
      d[i] = (click + noise + body) * 0.8;
    }
    return buf;
  }

  renderClick(freq) {
    const sr = this.ctx.sampleRate, len = Math.round(sr * 0.05);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 90) * 0.8;
    }
    return buf;
  }

  playTap() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.tapBuffer;
    src.connect(this.sfxBus);
    src.start();
  }

  scheduleClick(when, accent) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.clickBuffers[accent ? 1 : 0];
    src.connect(this.sfxBus);
    src.start(when);
    return src;
  }

  // --- decoding ---
  async decode(arrayBuffer) {
    this.ensure();
    const copy = arrayBuffer.slice(0);
    return await new Promise((res, rej) => {
      const p = this.ctx.decodeAudioData(copy, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }

  // Mono, ANALYSIS_SR copy of a decoded buffer for the beat analyser.
  async analysisPCM(buffer) {
    const len = Math.ceil(buffer.duration * ANALYSIS_SR);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    try {
      const off = new OAC(1, len, ANALYSIS_SR);
      const src = off.createBufferSource();
      src.buffer = buffer;
      src.connect(off.destination);
      src.start();
      const rendered = await off.startRendering();
      return rendered.getChannelData(0);
    } catch {
      // fallback: naive downmix + decimation
      const ratio = buffer.sampleRate / ANALYSIS_SR;
      const out = new Float32Array(len);
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      for (let i = 0; i < len; i++) {
        const j = Math.floor(i * ratio);
        let s = 0;
        for (const ch of chans) s += ch[j] || 0;
        out[i] = s / chans.length;
      }
      return out;
    }
  }

  // --- music playback ---
  playBuffer(buffer, when) {
    this.stopMusic();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    src.connect(g); g.connect(this.musicBus);
    src.start(when);
    this.musicSource = { src, gain: g };
  }

  // Simple piano-ish synth for MIDI songs, scheduled ahead on the audio clock.
  playMidi(notes, t0, isGameNote) {
    this.stopMusic();
    const ctx = this.ctx;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 5200;
    g.connect(lp); lp.connect(this.musicBus);
    let idx = 0;
    const voice = (n, at) => {
      const f = 440 * Math.pow(2, (n.pitch - 69) / 12);
      const vol = (n.vel / 127) * (isGameNote(n) ? 0.22 : 0.1);
      const dur = Math.min(n.dur, 2.5);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(vol, at + 0.004);
      env.gain.exponentialRampToValueAtTime(vol * 0.35, at + 0.25);
      env.gain.setValueAtTime(vol * 0.35, at + Math.max(0.26, dur));
      env.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.26, dur) + 0.25);
      env.connect(g);
      const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
      const g2 = ctx.createGain(); g2.gain.value = 0.3;
      o1.connect(env); o2.connect(g2); g2.connect(env);
      const stop = at + Math.max(0.26, dur) + 0.3;
      o1.start(at); o2.start(at); o1.stop(stop); o2.stop(stop);
    };
    const pump = () => {
      const horizon = ctx.currentTime + 0.25;
      while (idx < notes.length && t0 + notes[idx].t < horizon) {
        const n = notes[idx++];
        voice(n, Math.max(ctx.currentTime, t0 + n.t));
      }
      if (idx >= notes.length) clearInterval(this.midiTimer);
    };
    pump();
    this.midiTimer = setInterval(pump, 30);
    this.musicSource = { gain: g, midi: true };
  }

  stopMusic(fade = 0) {
    clearInterval(this.midiTimer);
    this.midiTimer = null;
    const m = this.musicSource;
    this.musicSource = null;
    if (!m || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (fade > 0) {
      m.gain.gain.setValueAtTime(m.gain.gain.value, now);
      m.gain.gain.linearRampToValueAtTime(0, now + fade);
      if (m.src) try { m.src.stop(now + fade + 0.05); } catch {}
      setTimeout(() => m.gain.disconnect(), (fade + 0.3) * 1000);
    } else {
      if (m.src) try { m.src.stop(); } catch {}
      m.gain.disconnect();
    }
  }

  async pause() {
    this.paused = true;
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  async resume() {
    this.paused = false;
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
  }
}
