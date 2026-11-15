// Sonido del cliente. El servidor no reproduce nada: manda eventos {k:'sfx', s, x, y}
// dentro de los efectos del snapshot y aquí se reproducen con volumen según la distancia.
//   · Archivos de public/audio/sfx/ (cofre, moneda, impacto, láser, magia, fuego).
//   · Spider-Man 2099: efectos 8-bit SINTETIZADOS con WebAudio (onda cuadrada + ruido).
// [M] silencia / activa el sonido.

const FILES = {
  chest: 'sfx/ChestOpen.mp3',
  coin: 'sfx/Coin.mp3',
  impact: 'sfx/HeavyImpact.mp3',
  laser: 'sfx/LaseBlast.mp3',
  magic: 'sfx/MagicImpact.mp3',
  fire: 'sfx/fireWhoosh.mp3',
};

export class AudioFx {
  constructor(base = '/audio/') {
    this.base = base;
    this.ctx = null;
    this.buf = {};
    this.last = {};
    this.muted = false;
    try { this.muted = localStorage.getItem('mrl-mute') === '1'; } catch (e) { /* sin almacenamiento */ }
    // El navegador solo permite audio tras un gesto del usuario.
    const unlock = () => { this.init(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    for (const [k, f] of Object.entries(FILES)) {
      fetch(this.base + f).then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => ab && this.ctx.decodeAudioData(ab))
        .then((b) => { if (b) this.buf[k] = b; })
        .catch(() => { /* archivo ausente: se ignora */ });
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('mrl-mute', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  // vol 0..1 según la distancia al propio héroe.
  play(name, dist = 0) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < 0.06) return;   // anti-saturación
    this.last[name] = now;
    const vol = Math.max(0, 1 - dist / 1100);
    if (vol <= 0.02) return;
    if (name.startsWith('chip_')) { this.chip(name, vol); return; }
    const b = this.buf[name];
    if (!b) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    g.gain.value = vol * (name === 'coin' ? 0.6 : 0.8);
    src.connect(g).connect(this.master);
    src.start();
  }

  // ── Sintetizador 8-bit (Spider-Man 2099) ──
  tone(type, f0, f1, t0, dur, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  noise(t0, dur, vol, hp = 1800) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * dur);
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { if (i % 6 === 0) v = Math.random() * 2 - 1; d[i] = v; }   // ruido "crujiente" tipo NES
    const s = c.createBufferSource();
    s.buffer = b;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0);
  }

  chip(name, vol) {
    const t = this.ctx.currentTime + 0.005;
    const v = 0.16 * vol;
    if (name === 'chip_dash') {          // barrido ascendente + soplido
      this.tone('square', 220, 1320, t, 0.12, v);
      this.noise(t, 0.1, v * 0.6, 2500);
    } else if (name === 'chip_ab') {     // arpegio rápido (balanceo)
      [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, t + i * 0.035, 0.07, v));
    } else if (name === 'chip_ult') {    // power-up: arpegio largo + pulso grave
      [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('square', f, f * 1.01, t + i * 0.05, 0.1, v));
      this.tone('triangle', 110, 55, t, 0.4, v * 1.4);
      this.noise(t + 0.25, 0.2, v * 0.5, 4000);
    }
  }
}
