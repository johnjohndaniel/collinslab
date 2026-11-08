// Small synthesised soundscape (no audio files): room tone, footsteps, book and page sounds.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    // a few seconds of noise to reuse
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown
    this.brown = buf;
    const white = ctx.createBuffer(1, len, ctx.sampleRate), wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.white = white;
    // Room tone: soft brown noise, low-passed, gently breathing.
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.master); src.start();
    // Occasional distant cup clink from the café.
    const clink = () => { if (!this.muted) this.#clink(); setTimeout(clink, 6000 + Math.random() * 14000); };
    setTimeout(clink, 4000);
  }

  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.8; return this.muted; }

  #noise({ buffer = this.white, type = 'bandpass', freq = 1000, q = 1, dur = 0.2, gain = 0.3, attack = 0.005, sweep = null }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buffer; src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  #clink() {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [freq, a] of [[2630, 0.02], [3910, 0.012], [5200, 0.006]]) {
      const o = ctx.createOscillator(); o.frequency.value = freq * (0.98 + Math.random() * 0.04);
      const g = ctx.createGain(); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      const p = ctx.createStereoPanner(); p.pan.value = 0.6;
      o.connect(g).connect(p).connect(this.master); o.start(t); o.stop(t + 0.65);
    }
  }

  step(strength = 1) { this.#noise({ buffer: this.brown, type: 'lowpass', freq: 380, dur: 0.16, gain: 0.35 * strength, attack: 0.004 }); this.#noise({ type: 'bandpass', freq: 2400, q: 0.8, dur: 0.05, gain: 0.03 * strength }); }
  slide() { this.#noise({ type: 'bandpass', freq: 900, q: 0.6, dur: 0.35, gain: 0.12, attack: 0.05, sweep: 1800 }); }
  thump() { this.#noise({ buffer: this.brown, type: 'lowpass', freq: 300, dur: 0.12, gain: 0.25 }); }
  page() { this.#noise({ type: 'bandpass', freq: 3000, q: 0.7, dur: 0.28, gain: 0.16, attack: 0.03, sweep: 1200 }); }
  cover() { this.#noise({ type: 'lowpass', freq: 1500, dur: 0.22, gain: 0.14, attack: 0.02 }); this.thump(); }
}
