// All of the game's sound is synthesized with WebAudio: a warm little music loop that plays
// through service, and short effects for chopping, sizzling, coins and the golden ding.
// Nothing is loaded from a file. The context is created lazily on the first user gesture
// (browsers refuse audio before one), and a single mute flag silences everything.

const CHORDS = [
  [261.63, 329.63, 392.0], // C
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [196.0, 246.94, 293.66], // G
];
const BASS = [130.81, 110.0, 87.31, 98.0];
const MELODY = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 440.0,
  493.88, 523.25, 587.33, 523.25, 440.0, 392.0, 440.0, 523.25];
const STEP_SECONDS = 0.24; // eighth notes at a gentle bistro pace

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let musicTimer = null;
  let step = 0;
  let nextStepAt = 0;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    return true;
  }

  function tone(freq, at, dur, type, gain, slideTo) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  function noise(at, dur, gain, freq, q) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(at);
  }

  function scheduleStep(s, at) {
    const bar = Math.floor(s / 16) % 4;
    const inBar = s % 16;
    if (inBar % 4 === 0) {
      for (const f of CHORDS[bar]) tone(f, at, STEP_SECONDS * 3.6, 'triangle', 0.05);
      tone(BASS[bar], at, STEP_SECONDS * 3.6, 'sine', 0.11);
    }
    if (inBar % 2 === 0) tone(MELODY[(s >> 1) % MELODY.length], at, STEP_SECONDS * 1.7, 'sine', 0.055);
    if (inBar % 4 === 2) noise(at, 0.03, 0.012, 7000, 0.8); // a soft hat tick
  }

  function pumpMusic() {
    if (!ctx) return;
    while (nextStepAt < ctx.currentTime + 0.35) {
      scheduleStep(step, nextStepAt);
      step += 1;
      nextStepAt += STEP_SECONDS;
    }
  }

  return {
    /** Call from any first click/keypress: unlocks audio and starts the loop. */
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!musicTimer) {
        step = 0;
        nextStepAt = ctx.currentTime + 0.06;
        musicTimer = setInterval(pumpMusic, 110);
        pumpMusic();
      }
    },
    toggleMute() {
      muted = !muted;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
      return muted;
    },
    isMuted: () => muted,
    click() { if (ensure() && !muted) tone(660, ctx.currentTime, 0.07, 'triangle', 0.08); },
    chop() { if (ensure() && !muted) { noise(ctx.currentTime, 0.06, 0.16, 1800, 1.2); tone(180, ctx.currentTime, 0.05, 'square', 0.05); } },
    sizzle() { if (ensure() && !muted) noise(ctx.currentTime, 0.35, 0.05, 5200, 0.6); },
    plate() { if (ensure() && !muted) { tone(880, ctx.currentTime, 0.08, 'sine', 0.09); tone(1174, ctx.currentTime + 0.05, 0.1, 'sine', 0.07); } },
    ding() { if (ensure() && !muted) { tone(1318, ctx.currentTime, 0.4, 'sine', 0.12); tone(1975, ctx.currentTime, 0.3, 'sine', 0.05); } },
    coin() {
      if (!ensure() || muted) return;
      const t = ctx.currentTime;
      [988, 1318, 1568].forEach((f, i) => tone(f, t + i * 0.055, 0.16, 'square', 0.045));
    },
    serve() {
      if (!ensure() || muted) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.07, 0.22, 'triangle', 0.08));
    },
    angry() { if (ensure() && !muted) tone(196, ctx.currentTime, 0.3, 'sawtooth', 0.06, 147); },
    trash() { if (ensure() && !muted) noise(ctx.currentTime, 0.15, 0.1, 500, 0.7); },
    pop() { if (ensure() && !muted) tone(520, ctx.currentTime, 0.09, 'sine', 0.09, 880); },
  };
}
