// audio.js — one job: every sound in the game, synthesised with WebAudio. There are no
// audio files: gunshots are shaped noise bursts with a pitch per weapon kind, the plant
// and defuse cues are plain beeps, the explosion is a filtered noise swell over a
// falling sine, and the round stings are short three-note figures. The context wakes on
// the first user gesture; M mutes the master gain.

/** Create the sound board. Every method is safe to call before unlock() (it stays silent). */
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  /** Wake the context (call from a click). Browsers refuse audio before a gesture. */
  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.42;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  /** A noise burst through a band filter: the body of every gunshot. */
  function noiseBurst(when, dur, freq, gain, type = 'bandpass') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  /** A plain oscillator note with a quick envelope. */
  function tone(when, dur, freq, gain, type = 'square', slideTo = null) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(g).connect(master);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  const SHOT_SHAPE = {
    pistol: { dur: 0.11, freq: 1500, gain: 0.5, thump: 190 },
    smg: { dur: 0.09, freq: 1750, gain: 0.42, thump: 210 },
    shotgun: { dur: 0.24, freq: 800, gain: 0.75, thump: 120 },
    rifle: { dur: 0.13, freq: 1250, gain: 0.55, thump: 160 },
    sniper: { dur: 0.34, freq: 620, gain: 0.85, thump: 90 },
  };

  return {
    unlock,
    /** Toggle the master mute; returns the new state. */
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 0.42;
      return muted;
    },
    isMuted: () => muted,
    /** A gunshot; `vol` is pre-attenuated by the caller for other fighters' distance. */
    shot(kind, vol = 1) {
      if (!ctx) return;
      const s = SHOT_SHAPE[kind] ?? SHOT_SHAPE.rifle;
      const t = ctx.currentTime;
      noiseBurst(t, s.dur, s.freq, s.gain * vol);
      tone(t, s.dur * 0.8, s.thump, 0.35 * vol, 'triangle', s.thump * 0.5);
    },
    /** The empty click of a dry trigger. */
    dry() {
      if (!ctx) return;
      tone(ctx.currentTime, 0.05, 2400, 0.12, 'square');
    },
    /** Two mechanical clicks, out and home. */
    reload() {
      if (!ctx) return;
      const t = ctx.currentTime;
      tone(t, 0.05, 900, 0.16, 'square');
      tone(t + 0.22, 0.05, 650, 0.16, 'square');
      tone(t + 0.45, 0.06, 1100, 0.14, 'square');
    },
    /** The hit tick; a kill gets a second, lower note. */
    hit(kill) {
      if (!ctx) return;
      const t = ctx.currentTime;
      tone(t, 0.06, 2050, 0.22, 'sine');
      if (kill) tone(t + 0.07, 0.12, 1240, 0.26, 'sine');
    },
    /** Plant progress beep; the final one is higher and longer. */
    beep(final) {
      if (!ctx) return;
      tone(ctx.currentTime, final ? 0.3 : 0.09, final ? 1320 : 880, 0.2, 'sine');
    },
    /** The defuse success chirp. */
    defused() {
      if (!ctx) return;
      const t = ctx.currentTime;
      tone(t, 0.1, 990, 0.2, 'sine');
      tone(t + 0.1, 0.18, 1480, 0.2, 'sine');
    },
    /** The charge going off: noise swell, sub thump, long tail. */
    explosion() {
      if (!ctx) return;
      const t = ctx.currentTime;
      noiseBurst(t, 0.9, 300, 0.95, 'lowpass');
      tone(t, 0.8, 110, 0.7, 'sine', 34);
      noiseBurst(t + 0.05, 0.4, 2400, 0.25);
    },
    /** Round sting: three notes up for a win, down for a loss. */
    sting(win) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((freq, i) => tone(t + i * 0.13, 0.22, freq, 0.2, 'triangle'));
    },
    /** The buy menu's till click. */
    buy() {
      if (!ctx) return;
      const t = ctx.currentTime;
      tone(t, 0.05, 1560, 0.16, 'square');
      tone(t + 0.06, 0.09, 2090, 0.14, 'square');
    },
    /** A soft interface click. */
    click() {
      if (!ctx) return;
      tone(ctx.currentTime, 0.05, 1180, 0.14, 'square');
    },
  };
}
