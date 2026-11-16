// AudioManager: música, efectos y voces. El servidor no reproduce nada: el cliente
// reacciona a los eventos del snapshot ({k:'sfx'} y efectos visuales) y al estado de la sala.
//
//   · Se desbloquea con el primer clic/tecla (política de autoplay de los navegadores).
//   · Buses separados: música, efectos y voces → master. [M] o el botón del HUD silencian.
//   · Archivos de public/audio/ (sfx/, voices/<héroe>/, music/). Lo que falte se sintetiza:
//     - Música: si no existe music/<bioma>.mp3 o music/boss.mp3 se genera una pista chiptune
//       distinta por bioma y una más intensa para los jefes (cambio automático con fundido).
//     - Efectos sin archivo (disparos, tajos, dash, golpes, soltar ítem...) → sintetizador.
//     - Spider-Man 2099: efectos 8-bit sintetizados.
//   · Música: rota entre TODAS las pistas de public/audio/music/ (lista en /audio/music/index.json).
//     Si el nombre de una pista contiene el bioma (aim, futurist, magic, cosmic, menu) se usa para
//     ese bioma; si contiene boss/jefe/epic/battle, para los jefes. Si no hay pistas, chiptune.
//   · Volúmenes independientes (música, efectos, voces), silencio y "cambiar pista" (menú ⚙).

const SFX_FILES = {
  chest: 'sfx/ChestOpen.mp3',
  coin: 'sfx/Coin.mp3',
  impact: 'sfx/HeavyImpact.mp3',
  laser: 'sfx/LaseBlast.mp3',
  magic: 'sfx/MagicImpact.mp3',
  fire: 'sfx/fireWhoosh.mp3',
};

// Voces por héroe y evento (archivos de public/audio/voices/<héroe>/).
const VOICES = {
  ironman: {
    ab: ['ironman/IronmanRepulseBlast.mp3'],
    ult: ['ironman/IronmanUniBeam.mp3', 'ironman/ProtonCannon.mp3'],
    hurt: ['ironman/IronmanDamage.mp3', 'ironman/IronmanDamage2.mp3', 'ironman/IronmanDamage3.mp3'],
    down: ['ironman/IronmanDamage3.mp3'],
    start: ['ironman/IronmanSuperiorAtack.mp3'],
  },
  hulk: {
    ab: ['hulk/GammaChargeHulk.mp3'],
    ult: ['hulk/HulkGrito1.mp3'],
    hurt: ['hulk/YourWeakHulk.mp3'],
    down: ['hulk/HulkDamageDead.mp3'],
    start: ['hulk/WereYouGoHulk.mp3'],
  },
};

// Sonido de cada tipo de proyectil del jugador/enemigo al aparecer.
const SHOT_SFX = {
  laser: 'laser', repulsor: 'laser', drone: 'pew_hi', bolt: 'pew', missile: 'pew_lo', mystic: 'magic',
  hellfire: 'fire', bluefire: 'fire', fire: 'fire', web: 'thwip', webball: 'thwip', web2099: 'thwip',
  dagger: 'swing', edagger: 'swing', shield: 'swing', tendril: 'swing', tendrilE: 'swing', chaos: 'magic',
  mindorb: 'magic', power: 'magic', cosmic: 'magic', jrock: 'swing', rock: 'swing', gamma: 'pew_lo', flask: 'pew_lo',
};

// Temas chiptune por música: [tempo, escala (semitonos), progresión (grados), raíz MIDI, intensidad]
const THEMES = {
  menu:     { bpm: 92,  root: 45, scale: [0, 3, 5, 7, 10], prog: [0, 3, 4, 2], drums: 0 },
  aim:      { bpm: 112, root: 43, scale: [0, 2, 3, 7, 8],  prog: [0, 0, 5, 4], drums: 1 },
  futurist: { bpm: 120, root: 40, scale: [0, 3, 5, 6, 10], prog: [0, 5, 3, 4], drums: 1 },
  magic:    { bpm: 96,  root: 38, scale: [0, 1, 4, 5, 7],  prog: [0, 1, 0, 4], drums: 0 },
  cosmic:   { bpm: 88,  root: 41, scale: [0, 2, 4, 7, 9],  prog: [0, 4, 5, 3], drums: 0 },
  boss:     { bpm: 148, root: 40, scale: [0, 1, 3, 6, 7],  prog: [0, 1, 0, 6], drums: 2 },
};
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const MAX_VOICES = 24;   // sonidos simultáneos como máximo

export class AudioManager {
  constructor(base = '/audio/') {
    this.base = base;
    this.ctx = null;
    this.buf = {};
    this.missing = new Set();
    this.last = {};
    this.voiceT = {};
    this.muted = false;
    this.music = { key: null, src: null, gain: null, seq: null };
    this.wantMusic = null;
    this.vol = { music: 0.6, sfx: 0.8, voice: 0.9 };
    this.tracks = [];        // pistas de public/audio/music/
    this.rot = {};           // posición de rotación por clave
    this.variant = 0;        // variante de la música generada (Cambiar pista sin archivos)
    this.trackName = '—';
    this.onTrack = null;
    try {
      this.muted = localStorage.getItem('mrl-mute') === '1';
      const v = JSON.parse(localStorage.getItem('mrl-vol') || 'null');
      if (v) Object.assign(this.vol, v);
    } catch (e) { /* sin almacenamiento */ }
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
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.bus = {};
    for (const k of ['music', 'sfx', 'voice']) {
      this.bus[k] = this.ctx.createGain();
      this.bus[k].gain.value = this.busGain(k);
      this.bus[k].connect(this.master);
    }
    fetch(this.base + 'music/index.json').then((r) => (r.ok ? r.json() : [])).then((list) => {
      this.tracks = Array.isArray(list) ? list : [];
      if (this.tracks.length && this.wantMusic) this.setMusic(this.wantMusic, true);
    }).catch(() => {});
    for (const f of Object.values(SFX_FILES)) this.load(f);
    for (const ev of Object.values(VOICES)) for (const list of Object.values(ev)) list.forEach((f) => this.load('voices/' + f));
    if (this.wantMusic) this.setMusic(this.wantMusic, true);
  }

  load(path) {
    if (this.buf[path] || this.missing.has(path)) return Promise.resolve(this.buf[path] || null);
    return fetch(this.base + path).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => (ab ? this.ctx.decodeAudioData(ab) : null))
      .then((b) => { if (b) this.buf[path] = b; else this.missing.add(path); return b; })
      .catch(() => { this.missing.add(path); return null; });
  }

  get isMuted() { return this.muted; }

  // Volúmenes 0..1 por bus (la música base es más baja que los efectos).
  busGain(k) { return (k === 'music' ? 0.55 : k === 'sfx' ? 0.8 : 1) * this.vol[k]; }
  setVolume(k, v) {
    this.vol[k] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('mrl-vol', JSON.stringify(this.vol)); } catch (e) { /* ignore */ }
    if (this.bus && this.bus[k]) this.bus[k].gain.setTargetAtTime(this.busGain(k), this.ctx.currentTime, 0.05);
  }

  // Pistas candidatas para una clave (bioma / boss / menu).
  candidates(key) {
    const t = this.tracks;
    if (!t.length) return [];
    const bossRe = /boss|jefe|epic|battle|fight/i;
    if (key === 'boss') { const b = t.filter((f) => bossRe.test(f)); return b.length ? b : t; }
    const named = t.filter((f) => f.toLowerCase().includes(key));
    if (named.length) return named;
    const normal = t.filter((f) => !bossRe.test(f));
    return normal.length ? normal : t;
  }

  // "Cambiar pista": siguiente canción de la rotación (o variante de la música generada).
  nextTrack() {
    if (!this.wantMusic) return;
    if (this.candidates(this.wantMusic).length) this.rot[this.wantMusic] = (this.rot[this.wantMusic] || 0) + 1;
    else this.variant++;
    this.setMusic(this.wantMusic, true);
  }
  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('mrl-mute', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // Los AudioBufferSourceNode son de un solo uso por diseño de Web Audio (no se pueden
  // reiniciar); lo caro son los AudioBuffer, que se decodifican una vez y se reutilizan.
  // Además se limita la polifonía para no acumular nodos en combates intensos.
  playBuffer(b, bus, vol, rate = 1) {
    if (this.active >= MAX_VOICES) return null;
    this.active = (this.active || 0) + 1;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.bus[bus]);
    src.onended = () => { this.active--; src.disconnect(); g.disconnect(); };
    src.start();
    return src;
  }

  // Efecto con nombre lógico; dist = distancia al propio héroe (atenuación).
  play(name, dist = 0, opts = {}) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const gap = opts.gap != null ? opts.gap : 0.05;
    if (this.last[name] && now - this.last[name] < gap) return;   // anti-saturación
    this.last[name] = now;
    const vol = Math.max(0, 1 - dist / 1100) * (opts.vol || 1);
    if (vol <= 0.02) return;
    if (name.startsWith('chip_')) { this.chip(name, vol); return; }
    const file = SFX_FILES[name];
    if (file && this.buf[file]) { this.playBuffer(this.buf[file], 'sfx', vol * (name === 'coin' ? 0.6 : 0.8), opts.rate || 1); return; }
    this.synth(name, vol);
  }

  // Voces: solo una a la vez por héroe y con pausa entre frases.
  voice(charId, ev, dist = 0, mine = false) {
    if (!this.ctx || this.muted) return false;
    const list = VOICES[charId] && VOICES[charId][ev];
    if (!list) return false;
    const now = this.ctx.currentTime;
    if (now < (this.voiceT[charId] || 0)) return false;
    const f = 'voices/' + list[Math.floor(Math.random() * list.length)];
    const b = this.buf[f];
    if (!b) return false;
    const vol = (mine ? 1 : 0.6) * Math.max(0, 1 - dist / 1300);
    if (vol <= 0.05) return false;
    this.voiceT[charId] = now + Math.max(2.2, b.duration + 0.6);
    this.playBuffer(b, 'voice', vol);
    return true;
  }

  // Eventos de sonido del servidor ({k:'sfx', s, c}).
  event(f, dist, mine) {
    const s = f.s;
    if (s === 'ab' || s === 'ult' || s === 'hurt' || s === 'down') {
      const spoke = f.c && this.voice(f.c, s, dist, mine);
      if (s === 'ab' && !spoke) this.play('ab', dist);
      else if (s === 'ult') this.play('ult', dist);
      else if (s === 'hurt') this.play('hurt', dist, { gap: 0.15 });
      else if (s === 'down') this.play('down', dist);
      return;
    }
    this.play(s, dist);
  }

  // ───────── Música ─────────
  // key: 'menu' | bioma ('aim', 'futurist', 'magic', 'cosmic') | 'boss' | null (silencio)
  setMusic(key, force = false) {
    this.wantMusic = key;
    if (!this.ctx || (!force && this.music.key === key)) return;
    const old = this.music;
    const fadeOut = (m) => {
      if (!m || !m.gain) return;
      const t = this.ctx.currentTime;
      m.gain.gain.cancelScheduledValues(t);
      m.gain.gain.setTargetAtTime(0, t, 0.5);
      if (m.seq) m.seq.stop = true;
      if (m.src) setTimeout(() => { try { m.src.stop(); } catch (e) { /* ya parado */ } }, 2500);
    };
    fadeOut(old);
    this.music = { key, src: null, gain: null, seq: null };
    if (!key) return;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.bus.music);
    g.gain.setTargetAtTime(1, this.ctx.currentTime, 0.8);
    this.music.gain = g;
    const mine = this.music;
    const list = this.candidates(key);
    if (!list.length) {   // sin archivos: música generada (con variantes)
      const th = Object.assign({}, THEMES[key] || THEMES.menu);
      const v = this.variant % 4;
      th.root += [0, 3, -2, 5][v]; th.bpm = Math.round(th.bpm * [1, 1.08, 0.94, 1.15][v]);
      th.prog = v % 2 ? th.prog.slice().reverse() : th.prog;
      mine.seq = this.chiptune(th, g);
      this.trackName = `Chiptune · ${key}${v ? ` (variante ${v + 1})` : ''}`;
      if (this.onTrack) this.onTrack(this.trackName);
      return;
    }
    // Rotación: cada vez que cambia el bioma/jefe o termina una canción, la siguiente de la lista.
    const pickNext = () => list[(this.rot[key] = this.rot[key] || 0) % list.length];
    const playFile = (file) => {
      this.load(`music/${file}`).then((b) => {
        if (this.music !== mine) return;
        if (!b) { mine.seq = this.chiptune(THEMES[key] || THEMES.menu, g); return; }
        const src = this.ctx.createBufferSource();
        src.buffer = b;
        src.loop = list.length === 1;
        src.connect(g); src.start();
        mine.src = src;
        this.trackName = file.replace(/\.[a-z0-9]+$/i, '');
        if (this.onTrack) this.onTrack(this.trackName);
        src.onended = () => { if (this.music === mine && !src.loop) { this.rot[key]++; playFile(pickNext()); } };
      });
    };
    playFile(pickNext());
    if (!force) this.rot[key]++;   // la próxima vez que suene esta clave, otra pista
  }

  // Secuenciador chiptune simple con planificación anticipada (bajo + arpegio + percusión).
  chiptune(th, out) {
    const seq = { stop: false };
    const c = this.ctx;
    const step = 60 / th.bpm / 2;          // corcheas
    let t = c.currentTime + 0.1, i = 0;
    const note = (type, f, t0, dur, vol) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.05);
    };
    const hatBuf = this.noiseBuffer(0.04, 1);   // un solo buffer para todos los golpes de hi-hat
    const hat = (t0, vol) => {
      const b = hatBuf;
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = b; f.type = 'highpass'; f.frequency.value = 6000;
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.04);
      s.connect(f).connect(g).connect(out); s.start(t0);
    };
    const kick = (t0, vol) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(130, t0); o.frequency.exponentialRampToValueAtTime(40, t0 + 0.15);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.18);
      o.connect(g).connect(out); o.start(t0); o.stop(t0 + 0.2);
    };
    const tick = () => {
      if (seq.stop) return;
      while (t < c.currentTime + 0.4) {
        const bar = Math.floor(i / 8) % th.prog.length, pos = i % 8;
        const deg = th.prog[bar];
        const rootN = th.root + th.scale[deg % th.scale.length] + (deg >= th.scale.length ? 12 : 0);
        if (pos % 2 === 0) note('triangle', midi(rootN - 12 + (pos === 4 ? 7 : 0)), t, step * 1.8, 0.22);
        const arp = [0, 2, 4, 2, 1, 3, 4, 3][pos];
        const an = th.root + 12 + th.scale[(deg + arp) % th.scale.length];
        note('square', midi(an), t, step * 0.8, th.drums === 2 ? 0.05 : 0.035);
        if (th.drums >= 1 && pos % 2 === 1) hat(t, 0.04);
        if (th.drums >= 1 && (pos === 0 || (th.drums === 2 && pos === 4))) kick(t, 0.35);
        if (th.drums === 2 && pos % 2 === 0) hat(t, 0.025);
        t += step; i++;
      }
      setTimeout(tick, 120);
    };
    tick();
    return seq;
  }

  // ───────── Síntesis de efectos ─────────
  tone(type, f0, f1, t0, dur, vol, bus = 'sfx') {
    if (this.active >= MAX_VOICES) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(this.bus[bus]);
    this.active = (this.active || 0) + 1;
    o.onended = () => { this.active--; o.disconnect(); g.disconnect(); };
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  // Buffer de ruido reutilizado (antes se generaba uno nuevo en cada efecto).
  noiseBuffer(dur, crunchy) {
    const k = `${dur}|${crunchy}`;
    this.noiseCache = this.noiseCache || new Map();
    let b = this.noiseCache.get(k);
    if (b) return b;
    const c = this.ctx, len = Math.max(1, Math.floor(c.sampleRate * dur));
    b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { if (i % crunchy === 0) v = Math.random() * 2 - 1; d[i] = v; }
    this.noiseCache.set(k, b);
    return b;
  }

  noise(t0, dur, vol, hp = 1800, crunchy = 1) {
    if (this.active >= MAX_VOICES) return;
    const c = this.ctx, b = this.noiseBuffer(dur, crunchy);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = b; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f).connect(g).connect(this.bus.sfx);
    this.active = (this.active || 0) + 1;
    s.onended = () => { this.active--; s.disconnect(); f.disconnect(); g.disconnect(); };
    s.start(t0);
  }

  synth(name, vol) {
    const t = this.ctx.currentTime + 0.003, v = 0.12 * vol;
    switch (name) {
      case 'pew': this.tone('square', 900, 260, t, 0.09, v * 0.7); break;
      case 'pew_hi': this.tone('square', 1500, 700, t, 0.05, v * 0.4); break;
      case 'pew_lo': this.tone('sawtooth', 420, 120, t, 0.14, v * 0.7); break;
      case 'thwip': this.noise(t, 0.08, v * 0.9, 3000); this.tone('sine', 1200, 500, t, 0.06, v * 0.5); break;
      case 'swing': this.noise(t, 0.1, v * 0.8, 1200); break;
      case 'dash': this.noise(t, 0.16, v, 900); this.tone('sine', 300, 700, t, 0.12, v * 0.4); break;
      case 'hit': this.tone('square', 180, 90, t, 0.05, v * 0.6); break;
      case 'hurt': this.tone('sawtooth', 260, 120, t, 0.12, v * 0.8); break;
      case 'boom': this.noise(t, 0.35, v * 1.5, 120, 3); this.tone('sine', 120, 40, t, 0.3, v * 1.6); break;
      case 'impact': this.noise(t, 0.4, v * 1.6, 80, 4); this.tone('sine', 90, 30, t, 0.4, v * 2); break;
      case 'drop': this.tone('square', 660, 330, t, 0.08, v * 0.6); this.tone('square', 440, 220, t + 0.06, 0.08, v * 0.5); break;
      case 'ab': this.tone('square', 330, 990, t, 0.15, v * 0.6); break;
      case 'ult': [262, 330, 392, 523].forEach((f, i) => this.tone('square', f, f, t + i * 0.05, 0.16, v * 0.6)); this.noise(t + 0.2, 0.3, v, 500); break;
      case 'down': [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.09, 0.14, v)); break;
      case 'portal': this.tone('sine', 220, 440, t, 0.5, v * 0.6); this.tone('sine', 330, 660, t + 0.1, 0.5, v * 0.4); break;
      case 'click': this.tone('square', 1200, 1200, t, 0.03, v * 0.4); break;
      case 'chest': case 'coin': case 'laser': case 'magic': case 'fire': this.tone('square', 880, 1320, t, 0.08, v * 0.5); break;
      default: break;
    }
  }

  // ── Spider-Man 2099: 8-bit ──
  chip(name, vol) {
    const t = this.ctx.currentTime + 0.005;
    const v = 0.16 * vol;
    if (name === 'chip_dash') {
      this.tone('square', 220, 1320, t, 0.12, v);
      this.noise(t, 0.1, v * 0.6, 2500, 6);
    } else if (name === 'chip_ab') {
      [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, t + i * 0.035, 0.07, v));
    } else if (name === 'chip_ult') {
      [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('square', f, f * 1.01, t + i * 0.05, 0.1, v));
      this.tone('triangle', 110, 55, t, 0.4, v * 1.4);
      this.noise(t + 0.25, 0.2, v * 0.5, 4000, 6);
    }
  }
}

export { SHOT_SFX };
