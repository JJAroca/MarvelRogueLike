// Render en Canvas 2D: sala, puertas, zonas, botín, enemigos/jefes, héroes, proyectiles, efectos y HUD.
import { lerpPos } from './main.js';
import { heroSpriteKey, ENEMY_SPRITES, dirOf } from './sprites.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RARITY = { common: '#cfd6e0', rare: '#4fa8ff', epic: '#c06bff', legendary: '#ffb52e' };
const FX_LIFE = { slash: 0.16, boom: 0.35, num: 0.8, text: 1.3, bolt: 0.2, beam: 0.35, ring: 0.45, dash: 0.25, spark: 0.25, sprite: 0.6, chest: 1.1 };
// [color, alargado]
const PROJ = {
  web: ['#f4f6ff', 0], webball: ['#ffffff', 0], bolt: ['#9fe8ff', 1], missile: ['#ff9a3a', 1], shield: ['#2a4ad4', 0],
  tendril: ['#f0f0f0', 1], chaos: ['#ff2f6f', 0], dagger: ['#9ff0b0', 1], web2099: ['#6fd8ff', 0],
  orb: ['#ff5a3a', 0], shard: ['#c070ff', 1], rock: ['#8a6a4a', 0], fire: ['#ff7a1a', 0], tendrilE: ['#ff2020', 1],
  edagger: ['#5fe08a', 1], mindorb: ['#ffd21f', 0], power: ['#a052ff', 0], cosmic: ['#b8a8ff', 0],
  hellfire: ['#ff7a1a', 0], bluefire: ['#4fc8ff', 0], mystic: ['#ffb02e', 0], flask: ['#7dff4a', 0], laser: ['#ff2a2a', 1],
  jrock: ['#8a6a4a', 0], repulsor: ['#ff3a3a', 1], gamma: ['#7fe04a', 0], drone: ['#9fe8ff', 1],
};
// Proyectiles dibujados con los PNG de output_effects (miran a la derecha → se giran al ángulo).
const PROJ_IMG = { jrock: ['JuggernautRocks', 5, false], hellfire: ['OrangeFire', 4.5, true], bluefire: ['BlueFire', 4.5, false], mystic: ['StrangeAtack', 5, true], bolt: ['IronManBlast', 5, true], power: ['MagnetoAtack', 4, false], gamma: ['SonicPulse', 4, false] };
const SLOT_FOR = { common: 'slot', rare: 'slot', epic: 'slot_epic', legendary: 'slot_rare' };
const DOOR_COLOR = { next: '#7fffb0', treasure: '#ffd76a', vault: '#5aa0ff', secret: '#5fe08a', floor: '#ff9a3a', galactus: '#b08aff', victory: '#ffd76a' };
const ST = { freeze: 1, burn: 2, bleed: 4, poison: 8, confuse: 16, slow: 32, weaken: 64 };
const ST_COLOR = [['freeze', '#6fd8ff'], ['burn', '#ff7a1a'], ['bleed', '#d01818'], ['poison', '#6ad040'], ['confuse', '#ffd21f'], ['slow', '#8aa0ff'], ['weaken', '#a0a0a0']];

export class Renderer {
  constructor(canvas, S) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.S = S;
    this.fx = [];
    this.flash = 0;
    this.time = 0;
    this.last = performance.now();
    this.anim = new Map();   // id → estado de animación (dirección, movimiento, inicio de ataque)
  }

  // Estado de animación de una entidad a partir de su movimiento interpolado.
  animState(id, x, y, angle, attacking) {
    const now = this.time;
    let s = this.anim.get(id);
    if (!s) { s = { lx: x, ly: y, moving: false, mvT: -1, mvA: Math.PI / 2, atk0: -1 }; this.anim.set(id, s); }
    const dx = x - s.lx, dy = y - s.ly;
    if (dx * dx + dy * dy > 0.15) { s.moving = true; s.mvT = now; s.mvA = Math.atan2(dy, dx); }
    else if (now - s.mvT > 0.12) s.moving = false;
    s.lx = x; s.ly = y; s.seen = now;
    if (attacking) { if (s.atk0 < 0) s.atk0 = now; } else s.atk0 = -1;
    s.dir = dirOf(angle);   // siempre según el apuntado (cursor), no según el movimiento
    return s;
  }

  // Dibuja una entidad con su hoja de sprites; devuelve false si no hay hoja (→ respaldo).
  drawSprite(key, id, x, y, angle, attacking, size, opts = {}) {
    const sp = this.S.sprites;
    if (!sp || !sp.has(key)) return false;
    const st = this.animState(id, x, y, angle, attacking);
    if (opts.downed) {
      const { anim } = sp.pick(key, 'walk', Math.PI / 2);
      sp.draw(this.ctx, key, anim, 0, x, y + size / 2, size, Math.PI / 2);   // tumbado en el suelo
      return true;
    }
    const fps = this.S.sprites.m.fps || { walk: 8, attack: 12 };
    let pk, frame;
    if (opts.hint && sp.entry(key).anims[opts.hint]) { pk = sp.pick(key, 'walk', angle, opts.hint); frame = Math.floor(this.time * fps.walk); }
    else if (st.atk0 >= 0) { pk = sp.pick(key, 'attack', angle); frame = Math.floor((this.time - st.atk0) * fps.attack); }
    else { pk = sp.pick(key, 'walk', angle); frame = st.moving ? Math.floor(this.time * fps.walk) : 0; }
    // Volteo horizontal (ctx.scale(-1, 1)) según hacia dónde apunta, aunque camine hacia atrás.
    sp.draw(this.ctx, key, pk.anim, frame, x, y + (opts.feet || 0), size, 0, pk.flip);
    return true;
  }

  pushFx(list) {
    const me = this.S.snap && this.S.snap.P.find((q) => q.i === this.S.me);
    for (const f of list || []) {
      if (f.k === 'flash') { this.flash = 0.6; continue; }
      if (f.k === 'sfx') { this.S.audio.play(f.s, me ? Math.hypot(me.x - f.x, me.y - f.y) : 0); continue; }
      f.life = FX_LIFE[f.k] || 0.4;
      f.born = performance.now();
      f.t = 0;
      if (f.k === 'num') { f.vx = (Math.random() - 0.5) * 30; }
      this.fx.push(f);
    }
    if (this.fx.length > 500) this.fx.splice(0, this.fx.length - 500);
  }

  draw() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const S = this.S, snap = S.snap, ctx = this.ctx;
    const W = innerWidth, H = innerHeight, dpr = devicePixelRatio || 1;
    if (this.c.width !== Math.round(W * dpr) || this.c.height !== Math.round(H * dpr)) {
      this.c.width = Math.round(W * dpr);
      this.c.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);
    if (!snap) return;

    const room = snap.room;
    const scale = Math.max(0.45, Math.min(W / 1280, H / 760));
    const me = snap.P.find((p) => p.i === S.me);
    const [mx, my] = me ? lerpPos(me.i, me.x, me.y) : [room.w / 2, room.h / 2];
    const vw = W / scale, vh = H / scale;
    const cam = S.cam;
    cam.scale = scale;
    cam.x = room.w <= vw ? room.w / 2 : clamp(mx, vw / 2, room.w - vw / 2);
    cam.y = room.h <= vh ? room.h / 2 : clamp(my, vh / 2, room.h - vh / 2);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (W / 2 - cam.x * scale), dpr * (H / 2 - cam.y * scale));

    this.drawRoom(room);
    this.drawDoors(snap, me);
    this.drawHazards(snap.H);
    this.drawPickups(snap.K);
    this.drawEnemies(snap);
    this.drawPlayers(snap);
    this.drawProjectiles(snap.R);
    this.drawFx(dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHud(snap, me, W, H);
    if (room.tr || this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      ctx.fillStyle = `rgba(0,0,0,${room.tr ? 0.6 : this.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ───────── Mundo ─────────
  // Fondo: tesela del BIOMA del piso (fijado por el jefe sorteado). Es el mismo en todas
  // las salas del piso; si la imagen no está, se usa el color del tema con rejilla.
  drawRoom(room) {
    const ctx = this.ctx;
    const stage = room.bg && this.S.sprites.stages[room.bg];
    if (stage) {
      if (!this.patterns) this.patterns = {};
      const pat = this.patterns[room.bg] || (this.patterns[room.bg] = ctx.createPattern(stage, 'repeat'));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, room.w, room.h);
      ctx.fillStyle = 'rgba(8,10,16,0.32)';            // oscurecer para que resalten los personajes
      ctx.fillRect(0, 0, room.w, room.h);
      if (room.tn) { ctx.fillStyle = room.tn; ctx.fillRect(0, 0, room.w, room.h); }
    } else {
      ctx.fillStyle = room.th || '#20242e';
      ctx.fillRect(0, 0, room.w, room.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 80; x < room.w; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, room.h); }
      for (let y = 80; y < room.h; y += 80) { ctx.moveTo(0, y); ctx.lineTo(room.w, y); }
      ctx.stroke();
    }
    if (room.ty === 'boss' || room.ty === 'secret') {
      ctx.strokeStyle = (room.ac || '#fff') + '33';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(room.w / 2, room.h / 2, Math.min(room.w, room.h) * 0.38, 0, TAU); ctx.stroke();
    }
    ctx.strokeStyle = room.ac || '#556';
    ctx.lineWidth = 14;
    ctx.strokeRect(-7, -7, room.w + 14, room.h + 14);
  }

  drawDoors(snap, me) {
    const ctx = this.ctx;
    const alive = snap.P.filter((p) => !p.dn).length;
    for (const d of snap.D) {
      const [, x, y, w, h, kind, label, count, hidden] = d;
      if (hidden) {
        // Pista sutil: destellos que solo se ven al acercarse.
        if (!me) continue;
        const dist = Math.hypot(me.x - x, me.y - y);
        if (dist > 340) continue;
        const a = (1 - dist / 340) * 0.5;
        for (let i = 0; i < 6; i++) {
          const ph = this.time * 1.7 + i * 1.1;
          const sx = x + Math.cos(ph * 1.3 + i) * 40, sy = y + Math.sin(ph + i * 2) * 30;
          ctx.fillStyle = `rgba(120,255,170,${a * (0.5 + 0.5 * Math.sin(ph * 3))})`;
          ctx.beginPath(); ctx.arc(sx, sy, 3, 0, TAU); ctx.fill();
        }
        continue;
      }
      const col = DOOR_COLOR[kind] || '#fff';
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
      ctx.fillStyle = col + '22';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 + pulse * 2;
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = col;
      ctx.font = 'bold 16px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, clamp(x, 120, snap.room.w - 120), y - h / 2 - 10);
      if (count > 0) { ctx.font = 'bold 22px Segoe UI'; ctx.fillText(`${count}/${alive}`, x, y + 8); }
    }
  }

  drawHazards(H) {
    const ctx = this.ctx;
    for (const h of H) {
      const [, kind, x, y, r, tele, color, angle, len, width, tx, ty] = h;
      if (kind === 'beam') {
        const ex = x + Math.cos(angle) * len, ey = y + Math.sin(angle) * len;
        ctx.lineCap = 'round';
        if (tele > 0) {
          ctx.strokeStyle = color + '66'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = color + '55'; ctx.lineWidth = width * 1.8;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = width * 0.7;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = width * 0.2;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        }
        ctx.lineCap = 'butt';
        continue;
      }
      if (kind === 'pfire') { // rastro de la Moto Infernal
        for (let i = 0; i < 3; i++) {
          const fl = r * (0.55 + 0.25 * Math.sin(this.time * 14 + i * 2 + x * 0.1));
          ctx.fillStyle = color + (i === 0 ? '55' : i === 1 ? '88' : 'cc');
          ctx.beginPath(); ctx.arc(x + Math.sin(this.time * 9 + i) * 4, y - i * 5, fl * (1 - i * 0.25), 0, TAU); ctx.fill();
        }
        continue;
      }
      if (kind === 'tether') {
        ctx.strokeStyle = color; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x, y);
        const n = 12;
        for (let i = 1; i <= n; i++) {
          const t = i / n, nx = -(ty - y), ny = tx - x, l = Math.hypot(nx, ny) || 1;
          const wob = Math.sin(t * 10 + this.time * 15) * 8 * Math.sin(t * Math.PI);
          ctx.lineTo(x + (tx - x) * t + (nx / l) * wob, y + (ty - y) * t + (ny / l) * wob);
        }
        ctx.stroke();
        continue;
      }
      if (tele > 0) {
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
        ctx.fillStyle = color + '40';
        ctx.beginPath(); ctx.arc(x, y, r * (1 - tele), 0, TAU); ctx.fill();
        if (kind === 'meteor') {
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(x - 60 * tele, y - 260 * tele, 12 + 6 * (1 - tele), 0, TAU); ctx.fill();
        }
      } else {
        const p = 0.3 + 0.1 * Math.sin(this.time * 8 + x);
        ctx.fillStyle = color + Math.round(p * 255).toString(16).padStart(2, '0');
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      }
    }
  }

  drawPickups(K) {
    const ctx = this.ctx;
    for (const k of K) {
      const [id, kind, , , extra, rar] = k;
      const [x, y] = lerpPos(id, k[2], k[3]);
      const bob = Math.sin(this.time * 4 + id) * 3;
      if (kind === 'chest') {
        if (!this.S.sprites.drawChest(ctx, rar || 'tech', false, x, y + 14, 58)) {
          ctx.fillStyle = '#7a5020'; ctx.fillRect(x - 20, y - 14, 40, 28);
          ctx.fillStyle = '#d8b44a'; ctx.fillRect(x - 20, y - 14, 40, 8); ctx.fillRect(x - 4, y - 8, 8, 10);
          ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 2; ctx.strokeRect(x - 20, y - 14, 40, 28);
        }
      } else if (kind === 'item') {
        const col = RARITY[rar] || '#fff';
        const it = this.S.items[extra];
        const icon = it && it.icon && this.S.sprites.items[it.icon];
        ctx.shadowColor = col; ctx.shadowBlur = 18;
        ctx.fillStyle = col + '44';
        ctx.beginPath(); ctx.arc(x, y + bob, icon ? 20 : 11, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        if (icon) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(icon, x - 18, y + bob - 18, 36, 36);
        } else {
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y + bob, 11, 0, TAU); ctx.fill();
          ctx.fillStyle = '#0b0d14'; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center';
          ctx.fillText('✦', x, y + bob + 4);
        }
        ctx.textAlign = 'center';
        if (it) { ctx.fillStyle = col; ctx.font = '12px Segoe UI'; ctx.fillText(it.name, x, y + bob - 26); }
      } else if (kind === 'heart') {
        ctx.fillStyle = '#ff4a6a';
        ctx.beginPath();
        ctx.arc(x - 5, y + bob - 2, 6, 0, TAU); ctx.arc(x + 5, y + bob - 2, 6, 0, TAU);
        ctx.moveTo(x - 11, y + bob); ctx.lineTo(x, y + bob + 12); ctx.lineTo(x + 11, y + bob);
        ctx.fill();
      } else if (kind === 'gem') {
        const g = this.S.gems[extra];
        const col = g ? g.color : '#fff';
        ctx.save(); ctx.translate(x, y + bob); ctx.rotate(this.time);
        ctx.shadowColor = col; ctx.shadowBlur = 30; ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(13, 0); ctx.lineTo(0, 18); ctx.lineTo(-13, 0); ctx.closePath(); ctx.fill();
        ctx.restore(); ctx.shadowBlur = 0;
        if (g) { ctx.fillStyle = col; ctx.font = 'bold 14px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(g.name, x, y - 30); }
      } else if (kind === 'decoy') {
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.time * 12);
        this.drawHero(extra, x, y, rar || 0, {});
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#5fe08a'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(x, y, 24, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  drawEnemies(snap) {
    const ctx = this.ctx;
    for (const e of snap.E) {
      const [id, type, , , hp, mh, r, f, face, hint] = e;
      const [x, y] = lerpPos(id, e[2], e[3]);
      if (f & 1024) { // apareciendo
        ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.arc(x, y, r + 6 * Math.sin(this.time * 10), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      if (f & 512) { // campo magnético de Magneto
        ctx.strokeStyle = `rgba(200,100,255,${0.35 + 0.2 * Math.sin(this.time * 10)})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, y, 270, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(180,80,255,0.06)';
        ctx.fill();
      }
      if (f & 4096) { // telegrafía de embestida
        ctx.strokeStyle = 'rgba(255,60,60,0.55)'; ctx.lineWidth = r * 1.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(face) * 260, y + Math.sin(face) * 260); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      if (f & 128) { // aliado
        ctx.strokeStyle = '#ff4fa0'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, r + 6, 0, TAU); ctx.stroke();
      }
      if (f & 2048) {
        ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 4, 0, TAU); ctx.stroke();
      }
      // Sprite animado si existe la hoja; si no, figura geométrica de respaldo.
      const skey = ENEMY_SPRITES[type];
      const ssize = skey && this.S.sprites.has(skey) ? (this.S.sprites.entry(skey).cell === 96 ? Math.max(r * 3.2, 96) : r * 4.4) : 0;
      const drawn = ssize && this.drawSprite(skey, id, x, y, face, !!(f & 16384), ssize, { feet: r * 0.9, hint: f & 32768 ? 'stunned' : hint });
      if (!drawn) this.drawEnemyBody(type, x, y, r, face, f);
      if (f & 32768) this.stars(x, y - (ssize ? ssize * 0.85 : r + 16), '#ffd76a');   // ATURDIDO
      if (f & 8192) { ctx.fillStyle = `rgba(255,255,255,${drawn ? 0.22 : 0.55})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
      if (f & ST.freeze) { ctx.fillStyle = 'rgba(120,220,255,0.45)'; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, TAU); ctx.fill(); }
      // estados
      let sx = x - 12;
      for (const [k, col] of ST_COLOR) {
        if (f & ST[k]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, y - r - 14, 3.5, 0, TAU); ctx.fill(); sx += 8; }
      }
      if (!(f & 256) && hp < mh) this.bar(x - r, y - r - 9, r * 2, 4, hp / mh, f & 128 ? '#ff4fa0' : '#ff4a4a');
    }
  }

  drawEnemyBody(type, x, y, r, face, f) {
    const ctx = this.ctx;
    const boss = this.S.bosses[type];
    const col = boss ? boss.color : this.S.enemies[type]?.color || '#888';
    const t = this.time;
    ctx.save();
    ctx.translate(x, y);
    switch (type) {
      case 'symbiote':
      case 'carnage': {
        const spikes = type === 'carnage' ? 14 : 8;
        ctx.fillStyle = col;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const a = (i / (spikes * 2)) * TAU + t * (type === 'carnage' ? 2 : 1);
          const rr = i % 2 ? r * 0.75 : r * (1.25 + 0.15 * Math.sin(t * 9 + i));
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#1a0000'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, r * (0.3 + i * 0.18), t * 3 + i, t * 3 + i + 2); ctx.stroke(); }
        break;
      }
      case 'dormammu': {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          const fl = r * (1.3 + 0.25 * Math.sin(t * 10 + i * 1.7));
          ctx.fillStyle = i % 2 ? '#ffb02e' : '#ff5a1a';
          ctx.beginPath();
          ctx.moveTo(Math.cos(a - 0.3) * r * 0.9, Math.sin(a - 0.3) * r * 0.9);
          ctx.lineTo(Math.cos(a) * fl, Math.sin(a) * fl);
          ctx.lineTo(Math.cos(a + 0.3) * r * 0.9, Math.sin(a + 0.3) * r * 0.9);
          ctx.fill();
        }
        this.circle(0, 0, r, '#ff7a1a');
        this.circle(0, 0, r * 0.72, '#3a1030');
        break;
      }
      case 'galactus': {
        this.circle(0, 0, r, '#4a3a9a');
        ctx.fillStyle = '#7a5ad8';
        ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 0.5); ctx.lineTo(-r * 0.9, -r * 1.6); ctx.lineTo(-r * 0.35, -r * 0.8);
        ctx.lineTo(r * 0.35, -r * 0.8); ctx.lineTo(r * 0.9, -r * 1.6); ctx.lineTo(r * 0.7, -r * 0.5); ctx.closePath(); ctx.fill();
        this.circle(0, 0, r * 0.75, '#6a5acd');
        this.circle(0, r * 0.05, r * 0.42, '#8fb4ff');
        ctx.strokeStyle = '#c8b8ff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, r + 6 + 4 * Math.sin(t * 3), 0, TAU); ctx.stroke();
        break;
      }
      default:
        this.circle(0, 0, r, col);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    }
    // adornos por tipo
    if (type === 'magneto') {
      ctx.fillStyle = '#6a2a8a';
      ctx.beginPath(); ctx.arc(0, 0, r * 1.15, face + Math.PI - 1, face + Math.PI + 1); ctx.lineTo(0, 0); ctx.fill();
      this.circle(0, 0, r * 0.85, '#b8323e');
      ctx.fillStyle = '#7a1a24';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.85, face - 2.4, face + 2.4, true); ctx.fill();
    } else if (type === 'loki') {
      ctx.strokeStyle = '#d8b44a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(s * r * 0.4, -r * 0.7);
        ctx.quadraticCurveTo(s * r * 1.1, -r * 1.2, s * r * 0.7, -r * 1.7); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    } else if (type === 'thanos') {
      ctx.strokeStyle = '#c9a23a'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, TAU); ctx.stroke();
      const gx = Math.cos(face) * r * 1.05, gy = Math.sin(face) * r * 1.05;
      this.circle(gx, gy, 10, '#c9a23a');
      const order = this.S.gemOrder;
      order.forEach((g, i) => this.circle(gx + Math.cos(i) * 5, gy + Math.sin(i) * 5, 2.2, this.S.gems[g].color));
    } else if (type === 'brute' || type === 'mindless') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-r * 0.6, -r * 0.15, r * 1.2, r * 0.3);
    } else if (type === 'shooter' || type === 'acolyte' || type === 'herald') {
      ctx.strokeStyle = type === 'herald' ? '#ffffff' : '#222'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(face) * (r + 9), Math.sin(face) * (r + 9)); ctx.stroke();
    } else if (type === 'mystic') {
      ctx.strokeStyle = `rgba(220,150,255,${0.5 + 0.4 * Math.sin(t * 6)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, TAU); ctx.stroke();
    }
    // ojos
    if (type !== 'dormammu' && type !== 'galactus') {
      const ex = Math.cos(face) * r * 0.45, ey = Math.sin(face) * r * 0.45;
      const px = -Math.sin(face) * r * 0.28, py = Math.cos(face) * r * 0.28;
      const eyeCol = type === 'mindless' ? '#ffee66' : '#ffffff';
      const er = Math.max(2.2, r * 0.14);
      this.circle(ex + px, ey + py, er, eyeCol);
      this.circle(ex - px, ey - py, er, eyeCol);
    } else if (type === 'dormammu') {
      this.circle(-r * 0.25, -r * 0.1, r * 0.11, '#ffe066');
      this.circle(r * 0.25, -r * 0.1, r * 0.11, '#ffe066');
    }
    ctx.restore();
  }

  drawPlayers(snap) {
    const ctx = this.ctx;
    for (const p of snap.P) {
      const [x, y] = lerpPos(p.i, p.x, p.y);
      const isMe = p.i === this.S.me;
      let alpha = 1;
      if (p.iv) alpha = isMe ? 0.45 : 0.25;
      if (p.gd && !p.dn && Math.floor(this.time * 14) % 2) alpha *= 0.6;
      if (p.bz) { ctx.fillStyle = `rgba(255,40,40,${0.2 + 0.15 * Math.sin(this.time * 12)})`; ctx.beginPath(); ctx.arc(x, y, 28, 0, TAU); ctx.fill(); }
      if (p.av) { ctx.strokeStyle = '#6a8cff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 24, 0, TAU); ctx.stroke(); }
      const pr = p.r || 16;
      const key = heroSpriteKey(p.c, p.fm);
      const sp = this.S.sprites;
      const size = key && sp.has(key) ? (sp.entry(key).cell === 96 ? 92 : p.fm === 'banner' ? 58 : 64) : 0;
      if (isMe) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y + pr * 0.95, pr + 4, 6, 0, 0, TAU); ctx.stroke(); }
      if (p.c === 'ghostrider' && p.ft > 0) { // Moto Infernal activa: aura de fuego
        ctx.fillStyle = `rgba(255,${p.fm === 'blue' ? 200 : 120},40,${0.25 + 0.1 * Math.sin(this.time * 20)})`;
        ctx.beginPath(); ctx.ellipse(x, y + pr * 0.7, pr * 2, pr * 0.9, 0, 0, TAU); ctx.fill();
      }
      if (p.as) { // Forma Astral: fantasma translúcido
        alpha *= 0.42;
        ctx.fillStyle = `rgba(140,232,255,${0.18 + 0.08 * Math.sin(this.time * 5)})`;
        ctx.beginPath(); ctx.arc(x, y, pr + 14, 0, TAU); ctx.fill();
      }
      if (!p.dn) this.drawAuras(p, x, y, pr);
      ctx.globalAlpha = alpha;
      const drawn = size && this.drawSprite(key, p.i, x, y, p.a, !!p.ak, size, { feet: pr * 0.95, downed: !!p.dn });
      if (!drawn) this.drawHero(p.c, x, y, p.a, { downed: p.dn, mode: p.m, berserk: p.bz });
      ctx.globalAlpha = 1;
      if (p.sh > 0 && !p.dn) { // burbuja del Escudo de Reactor Arc
        const k = clamp(p.sh / (p.sm || 1), 0, 1);
        ctx.strokeStyle = `rgba(80,216,255,${0.25 + 0.35 * k})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y - pr * 0.3, pr + 14, pr + 20, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = `rgba(80,216,255,${0.06 + 0.06 * k})`; ctx.fill();
      }
      if (p.sn) this.stars(x, y - (size ? size * 0.85 : 34), '#ffd76a');
      if (p.dr && !p.dn) { // Dron Espía orbitando
        const dx = x + Math.cos(this.time * 2.4) * 30, dy = y - 34 + Math.sin(this.time * 2.4) * 8;
        this.circle(dx, dy, 6, '#c8d0dc'); this.circle(dx, dy, 2.5, '#ff3a3a');
        ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(dx - 9, dy - 4); ctx.lineTo(dx + 9, dy - 4); ctx.stroke();
      }
      if (p.st & ST.freeze) { ctx.fillStyle = 'rgba(120,220,255,0.45)'; ctx.beginPath(); ctx.arc(x, y, pr + 2, 0, TAU); ctx.fill(); }
      if (p.st & ST.confuse) { ctx.fillStyle = '#ffd21f'; ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('?', x, y - size * 0.75 - 8); }
      if (p.dn) {
        // Círculo de progreso [F] alrededor del héroe tumbado.
        const R = Math.max(30, size * 0.55);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#7fff9a'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p.rv, 0, 1)); ctx.stroke();
        ctx.fillStyle = '#0b0d14cc'; this.round(x - 15, y - R - 26, 30, 22, 5); ctx.fill();
        ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 14px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText('[F]', x, y - R - 10);
        ctx.fillStyle = p.dt < 6 ? '#ff6060' : '#ff9a9a'; ctx.font = 'bold 12px Segoe UI';
        ctx.fillText(`CAÍDO · Astral en ${Math.ceil(p.dt)} s`, x, y + R + 16);
      }
      if (p.as) { ctx.fillStyle = '#8fe8ff'; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('FORMA ASTRAL', x, y + pr + 18); }
      const top = size ? y + pr * 0.95 - size * 0.86 : y - 26;
      ctx.fillStyle = isMe ? '#ffffff' : '#cfd6e0';
      ctx.font = '12px Segoe UI'; ctx.textAlign = 'center';
      if (!p.dn) { ctx.fillText(p.n, x, top - 8); this.bar(x - 18, top - 4, 36, 4, p.hp / p.mh, p.as ? '#8fe8ff' : '#5fe08a'); }
      else ctx.fillText(p.n, x, y - Math.max(30, size * 0.55) - 32);
    }
  }

  drawHero(charId, x, y, a, o) {
    const ctx = this.ctx;
    const c = this.S.chars[charId] || { color: '#888', color2: '#fff', letter: '?' };
    const r = 16;
    const body = o.downed ? '#555' : c.color;
    ctx.save();
    ctx.translate(x, y);
    // capa / detalle trasero
    if (charId === 'thor' || charId === 'loki' || charId === 'scarlet') {
      ctx.fillStyle = charId === 'thor' ? '#c0262d' : charId === 'loki' ? '#0f4a22' : '#7a0a24';
      ctx.beginPath(); ctx.arc(0, 0, r * 1.25, a + Math.PI - 0.9, a + Math.PI + 0.9); ctx.lineTo(0, 0); ctx.fill();
    }
    this.circle(0, 0, r, body);
    ctx.strokeStyle = o.downed ? '#777' : c.color2; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    // arma / detalle hacia donde apunta
    const fx = Math.cos(a), fy = Math.sin(a);
    if (!o.downed) {
      switch (charId) {
        case 'wolverine':
        case 'spider2099':
          ctx.strokeStyle = charId === 'wolverine' ? (o.berserk ? '#ff6060' : '#e0e6f0') : '#ff3a6a'; ctx.lineWidth = 2;
          for (let i = -1; i <= 1; i++) {
            const px = -fy * i * 5, py = fx * i * 5;
            ctx.beginPath(); ctx.moveTo(fx * r + px, fy * r + py); ctx.lineTo(fx * (r + 14) + px, fy * (r + 14) + py); ctx.stroke();
          }
          break;
        case 'thor':
          ctx.save(); ctx.translate(fx * (r + 6), fy * (r + 6)); ctx.rotate(a);
          ctx.fillStyle = '#9aa4b4'; ctx.fillRect(-2, -8, 10, 16); ctx.restore();
          break;
        case 'cap':
          this.circle(fx * (r + 2), fy * (r + 2), 9, '#c0262d');
          this.circle(fx * (r + 2), fy * (r + 2), 6, '#e8e8f0');
          this.circle(fx * (r + 2), fy * (r + 2), 3.5, '#2a4ad4');
          break;
        case 'ironman':
          this.circle(fx * (r + 3), fy * (r + 3), 4, '#9fe8ff');
          break;
        default:
          this.circle(fx * (r + 3), fy * (r + 3), 3.5, c.color2);
      }
    }
    // emblema
    if (charId === 'ironman') this.circle(0, 0, 5, o.downed ? '#888' : '#9fe8ff');
    else if (charId === 'venom') {
      ctx.fillStyle = '#f2f2f2';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(fx * 6 - fy * s * 6, fy * 6 + fx * s * 6, 6, 3.5, a + s * 0.6, 0, TAU);
        ctx.fill();
      }
      if (o.mode) { ctx.strokeStyle = '#8a8aa0'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    } else {
      ctx.fillStyle = o.downed ? '#999' : c.color2;
      ctx.font = 'bold 14px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(charId === 'cap' ? '★' : c.letter, 0, 1);
      ctx.textBaseline = 'alphabetic';
    }
    if (charId === 'loki') {
      ctx.strokeStyle = '#d8b44a'; ctx.lineWidth = 3;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 6, -12); ctx.quadraticCurveTo(s * 16, -18, s * 11, -26); ctx.stroke(); }
    }
    if (charId === 'scarlet') {
      ctx.fillStyle = '#ff3a6a';
      ctx.beginPath(); ctx.moveTo(-9, -13); ctx.lineTo(-5, -24); ctx.lineTo(0, -15); ctx.lineTo(5, -24); ctx.lineTo(9, -13); ctx.fill();
    }
    ctx.restore();
  }

  drawProjectiles(R) {
    const ctx = this.ctx;
    for (const pr of R) {
      const [id, , , r, kind, mine, ang] = pr;
      const [x, y] = lerpPos(id, pr[1], pr[2]);
      const [col, long] = PROJ[kind] || ['#fff', 0];
      if (kind === 'shield') {
        this.circle(x, y, r, '#c0262d'); this.circle(x, y, r * 0.7, '#e8e8f0'); this.circle(x, y, r * 0.4, '#2a4ad4');
        continue;
      }
      const pim = PROJ_IMG[kind];
      if (pim && this.S.sprites.drawFx(ctx, pim[0], x, y, r * pim[1], pim[2] ? ang : this.time * 6)) continue;
      if (!mine) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, TAU); ctx.fill(); }
      if (long) {
        ctx.strokeStyle = col; ctx.lineWidth = r * 1.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * r * 3, y - Math.sin(ang) * r * 3); ctx.lineTo(x, y); ctx.stroke();
        ctx.lineCap = 'butt';
      } else {
        ctx.shadowColor = col; ctx.shadowBlur = r > 10 ? 18 : 8;
        this.circle(x, y, r, col);
        ctx.shadowBlur = 0;
      }
      if (kind === 'rock') { ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
    }
  }

  drawFx(dt) {
    const ctx = this.ctx;
    const now = performance.now();
    for (const f of this.fx) {
      f.t = (now - f.born) / 1000;
      const k = f.t / f.life;
      if (k >= 1) continue;
      ctx.globalAlpha = 1 - k;
      switch (f.k) {
        case 'slash':
          ctx.strokeStyle = f.c; ctx.lineWidth = 6 * (1 - k) + 2;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.7 + 0.3 * k), f.a - f.arc / 2, f.a + f.arc / 2); ctx.stroke();
          break;
        case 'boom':
          ctx.fillStyle = f.c;
          ctx.globalAlpha = (1 - k) * 0.5;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, TAU); ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = f.c; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.3 + 0.7 * k), 0, TAU); ctx.stroke();
          break;
        case 'num':
          ctx.fillStyle = f.c; ctx.font = `bold ${f.cr ? 18 : 13}px Segoe UI`; ctx.textAlign = 'center';
          ctx.fillText(f.v + (f.cr ? '!' : ''), f.x + f.vx * k, f.y - 30 * k);
          break;
        case 'text':
          ctx.fillStyle = f.c; ctx.font = 'bold 15px Segoe UI'; ctx.textAlign = 'center';
          ctx.fillText(f.s, f.x, f.y - 20 * k);
          break;
        case 'bolt': {
          ctx.strokeStyle = f.c; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(f.x1, f.y1);
          for (let i = 1; i < 6; i++) {
            const t = i / 6;
            ctx.lineTo(f.x1 + (f.x2 - f.x1) * t + (Math.random() - 0.5) * 22, f.y1 + (f.y2 - f.y1) * t + (Math.random() - 0.5) * 22);
          }
          ctx.lineTo(f.x2, f.y2); ctx.stroke();
          break;
        }
        case 'beam':
          ctx.strokeStyle = f.c; ctx.lineWidth = f.w * (1 - k * 0.5); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(f.a) * f.len, f.y + Math.sin(f.a) * f.len); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = f.w * 0.3;
          ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(f.a) * f.len, f.y + Math.sin(f.a) * f.len); ctx.stroke();
          ctx.lineCap = 'butt';
          break;
        case 'dash':
          ctx.fillStyle = f.c;
          for (let i = 0; i < 4; i++) { ctx.globalAlpha = (1 - k) * 0.25; ctx.beginPath(); ctx.arc(f.x + Math.cos(f.a) * i * 14, f.y + Math.sin(f.a) * i * 14, 14 - i * 2, 0, TAU); ctx.fill(); }
          break;
        case 'sprite': // PNG de output_effects (explosión, grieta del suelo...)
          ctx.globalAlpha = 1 - k * k;
          this.S.sprites.drawFx(ctx, f.s, f.x, f.y, (f.sz || 120) * (0.7 + 0.3 * k), 0);
          break;
        case 'chest': // cofre abierto que se desvanece
          ctx.globalAlpha = 1 - k;
          this.S.sprites.drawChest(ctx, f.tier || 'tech', true, f.x, f.y + 14, 58);
          break;
        case 'spark':
          ctx.strokeStyle = f.c; ctx.lineWidth = 2;
          for (let i = 0; i < 5; i++) { const a = i * 1.3; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(a) * 16 * k, f.y + Math.sin(a) * 16 * k); ctx.stroke(); }
          break;
        default: break;
      }
    }
    ctx.globalAlpha = 1;
    this.fx = this.fx.filter((f) => f.t < f.life);
  }

  // ───────── HUD ─────────
  drawHud(snap, me, W, H) {
    const ctx = this.ctx, S = this.S, room = snap.room;
    ctx.textAlign = 'left';
    let tagsH = 0;
    // Limpieza ocasional de estados de animación de entidades que ya no existen.
    if (Math.random() < 0.02) for (const [id, s] of this.anim) if (this.time - s.seen > 2) this.anim.delete(id);

    // Panel propio
    if (me) {
      const c = S.chars[me.c];
      const hasFrame = !!this.S.sprites.ui.hp_frame;
      const shY = hasFrame ? 112 : 64;              // barra de escudo (si hay)
      const abY = (hasFrame ? 112 : 64) + (me.sm > 0 ? 34 : 0);
      ctx.fillStyle = 'rgba(10,12,20,0.75)'; this.round(12, 12, 304, abY + 50, 10); ctx.fill();
      if (me.sm > 0 && !this.framedBar('shield_frame', 30, shY, 200, me.sh / me.sm, '#40d8ff', `${me.sh}`)) {
        this.bar(24, shY + 4, 200, 8, me.sh / me.sm, '#40d8ff');
      }
      ctx.fillStyle = c.color2; ctx.font = 'bold 15px Segoe UI'; ctx.fillText(`${c.name}`, 24, 34);
      ctx.fillStyle = '#8a93b4'; ctx.font = '12px Segoe UI'; ctx.fillText(me.n, 24 + ctx.measureText(c.name).width * 1.25 + 10, 34);
      if (!this.framedBar('hp_frame', 18, 40, 290, me.hp / me.mh, me.bz ? '#ff4040' : '#e23040', `${me.hp} / ${me.mh}`)) {
        this.bar(24, 42, 276, 14, me.hp / me.mh, me.bz ? '#ff4040' : '#5fe08a');
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText(`${me.hp} / ${me.mh}`, 162, 53);
      }
      ctx.textAlign = 'left';
      const labels = [['Espacio', 'Dash'], ['Shift', 'Habilidad'], ['Q', c.noUlt ? 'PASIVA' : 'Ulti']];
      for (let i = 0; i < 3; i++) {
        const bx = 24 + i * 94, by = abY;
        const cd = me.cd[i], cm = me.cm[i] || 1;
        const ready = cd <= 0 && !(i === 2 && c.noUlt);
        ctx.fillStyle = ready ? 'rgba(60,140,90,0.55)' : 'rgba(40,46,70,0.8)'; this.round(bx, by, 86, 44, 6); ctx.fill();
        if (!ready && cd > 0) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx, by + 44 * (1 - cd / cm), 86, 44 * (cd / cm)); }
        ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 11px Segoe UI'; ctx.fillText(labels[i][0], bx + 6, by + 15);
        ctx.fillStyle = '#e6e9f5'; ctx.font = '12px Segoe UI'; ctx.fillText(labels[i][1], bx + 6, by + 33);
        if (cd > 0) { ctx.textAlign = 'right'; ctx.font = 'bold 13px Segoe UI'; ctx.fillText(cd.toFixed(1), bx + 80, by + 15); ctx.textAlign = 'left'; }
      }
      // indicadores especiales
      const tags = [];
      if (me.c === 'venom') tags.push([me.m ? 'MODO SIGILO' : 'MODO TANQUE', '#e8e8f0']);
      if (me.c === 'wolverine') tags.push([me.bz ? '¡BERSERKER!' : 'Regenerando', me.bz ? '#ff5050' : '#ffe14a']);
      if (me.c === 'spider2099') tags.push([me.ur ? 'Disp. temporal: usado' : 'Disp. temporal: listo', me.ur ? '#777' : '#6fd8ff']);
      if (me.c === 'ironman') tags.push(me.fm === 'hulkbuster' ? ['HULK-BUSTER', '#f2c230'] : [`Armadura ${S.inv.filter((id) => S.items[id]?.tags.includes('armor')).length}/3 → Hulk-Buster`, '#f2c230']);
      if (me.c === 'ghostrider') {
        if (me.fm === 'blue') tags.push(['FUEGO AZUL', '#4fc8ff']);
        tags.push(me.ft > 0 ? [`MOTO INFERNAL ${me.ft.toFixed(1)} s`, '#ff8a1a'] : [`Moto: ${me.bk}/15 bajas`, '#ffb060']);
      }
      if (me.c === 'hulk') tags.push(me.fm === 'banner' ? [`BANNER — Hulk vuelve en ${Math.ceil(me.ft)} s`, '#b09aff'] : ['HULK', '#7fe04a']);
      if (me.c === 'strange') { const n = S.inv.filter((id) => S.items[id]?.tags.includes('mystic')).length; tags.push([n >= 2 ? 'Sello: CURA + INMUNIDAD' : `Místicos ${n}/2 → inmunidad`, '#ffb02e']); }
      if (me.as) tags.push(['FORMA ASTRAL (25% daño)', '#8fe8ff']);
      if (me.iv) tags.push(['INVISIBLE', '#9ff0b0']);
      if (me.av) tags.push(['¡VENGADORES!', '#6a8cff']);
      if (me.sn) tags.push(['¡ATURDIDO!', '#ffd76a']);
      tags.forEach(([t, col], i) => { ctx.fillStyle = col; ctx.font = 'bold 12px Segoe UI'; ctx.fillText(t, 24, abY + 72 + i * 16); });
      tagsH = tags.length * 16 + (abY - 64);
    }

    // Equipo
    let ty = 136 + tagsH + 4;
    for (const p of snap.P) {
      if (p.i === S.me) continue;
      const c = S.chars[p.c];
      ctx.fillStyle = 'rgba(10,12,20,0.6)'; this.round(12, ty, 200, 30, 6); ctx.fill();
      this.circle(26, ty + 15, 8, c.color);
      ctx.fillStyle = p.dn ? '#ff8080' : p.as ? '#8fe8ff' : '#e6e9f5'; ctx.font = '12px Segoe UI';
      ctx.fillText(p.dn ? `${p.n} (CAÍDO ${Math.ceil(p.dt)} s)` : p.as ? `${p.n} (ASTRAL)` : p.n, 40, ty + 13);
      this.bar(40, ty + 18, 160, 6, p.dn ? p.rv : p.hp / p.mh, p.dn ? '#7fff9a' : '#5fe08a');
      ty += 36;
    }

    // Centro superior: piso / sala / oleada
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd76a'; ctx.font = 'bold 15px Segoe UI';
    ctx.fillText(`Piso ${room.fl} · ${room.nm}`, W / 2, 26);
    ctx.font = '13px Segoe UI'; ctx.fillStyle = '#cfd8ff';
    let sub = '';
    if (room.cl) sub = 'Sala despejada — todos a una puerta para avanzar';
    else if (room.ty === 'combat' || room.ty === 'vault') sub = `Oleada ${Math.max(1, room.wv[0])}/${room.wv[1]}`;
    if (sub) ctx.fillText(sub, W / 2, 46);

    // Barra del jefe
    const boss = snap.E.find((e) => e[0] === snap.boss);
    if (boss) {
      const b = S.bosses[boss[1]];
      // No pisa las ranuras de ítems (abajo a la izquierda): si no cabe centrada, sube.
      const slotsW = S.inv.length ? 12 + 6 * 48 + 8 + 12 : 0;
      const bw = Math.max(260, Math.min(640, W - 540));
      const fits = W / 2 - bw / 2 - 10 >= slotsW;
      const by = fits || !S.inv.length ? H - 64 : H - 64 - (Math.ceil(Math.min(S.inv.length, 12) / 6) * 48 + 44);
      ctx.fillStyle = 'rgba(10,12,20,0.8)'; this.round(W / 2 - bw / 2 - 10, by, bw + 20, 46, 8); ctx.fill();
      ctx.fillStyle = b.color; ctx.font = 'bold 14px Segoe UI';
      ctx.fillText(`${b.name} — ${b.title}`, W / 2, by + 18);
      this.bar(W / 2 - bw / 2, by + 26, bw, 12, boss[4] / boss[5], b.color);
    }

    // Gemas
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8a93b4'; ctx.font = '11px Segoe UI'; ctx.fillText('GEMAS DEL INFINITO', W - 16, 22);
    S.gemOrder.forEach((g, i) => {
      const gm = S.gems[g], has = snap.gems.includes(g);
      const gx = W - 24 - (5 - i) * 26, gy = 40;
      ctx.save(); ctx.translate(gx, gy);
      ctx.fillStyle = has ? gm.color : 'rgba(255,255,255,0.06)';
      ctx.strokeStyle = gm.color; ctx.lineWidth = 2;
      if (has) { ctx.shadowColor = gm.color; ctx.shadowBlur = 12; }
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 10); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    });

    // Ítems: ranuras del HUD (menu/Barras.jpg) con el icono de cada ítem
    ctx.textAlign = 'left';
    const inv = S.inv;
    if (inv.length) this.drawItemSlots(inv, H);
    this.drawPickupCard(W);

    // Flechas hacia las puertas fuera de pantalla
    if (room.cl && me) {
      const cam = S.cam;
      for (const d of snap.D) {
        if (d[8]) continue;
        const sx = (d[1] - cam.x) * cam.scale + W / 2, sy = (d[2] - cam.y) * cam.scale + H / 2;
        if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
        const a = Math.atan2(sy - H / 2, sx - W / 2);
        const ax = clamp(sx, 40, W - 40), ay = clamp(sy, 40, H - 40);
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
        ctx.fillStyle = DOOR_COLOR[d[5]] || '#fff';
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.fill();
        ctx.restore();
      }
    }

    ctx.textAlign = 'center';
    if (me && me.dn) {
      ctx.fillStyle = '#ff8080'; ctx.font = 'bold 22px Segoe UI';
      ctx.fillText(`Has caído — un aliado debe mantener [F] 10 s a tu lado (${Math.round(me.rv * 100)}%)`, W / 2, H / 2 + 90);
      ctx.font = 'bold 16px Segoe UI'; ctx.fillStyle = '#8fe8ff';
      ctx.fillText(`Forma Astral en ${Math.ceil(me.dt)} s`, W / 2, H / 2 + 116);
    } else if (me && me.as) {
      ctx.fillStyle = '#8fe8ff'; ctx.font = 'bold 18px Segoe UI';
      ctx.fillText('FORMA ASTRAL: 25% de daño e intangible hasta limpiar la sala', W / 2, H - 90);
    } else if (me) {
      // ¿Hay un aliado caído cerca? → aviso de reanimación.
      const near = snap.P.find((o) => o.dn && o.i !== me.i && Math.hypot(o.x - me.x, o.y - me.y) < 75);
      if (near) {
        ctx.fillStyle = '#0b0d14cc'; this.round(W / 2 - 190, H / 2 + 70, 380, 34, 8); ctx.fill();
        ctx.fillStyle = me.rf ? '#7fff9a' : '#ffd76a'; ctx.font = 'bold 17px Segoe UI';
        ctx.fillText(me.rf ? `Reanimando a ${near.n}… ${Math.round(near.rv * 100)}%` : `Mantén [F] para reanimar a ${near.n}`, W / 2, H / 2 + 93);
      }
    }
    if (me && (me.st & ST.confuse)) { ctx.fillStyle = 'rgba(255,210,31,0.08)'; ctx.fillRect(0, 0, W, H); }
  }

  // Barra con el marco del HUD (hp_frame / shield_frame). Devuelve false si no hay imagen.
  framedBar(key, x, y, w, v, col, label) {
    const ctx = this.ctx, sp = this.S.sprites;
    const im = sp.ui[key], e = sp.uiEntry(key);
    if (!im || !e || !e.inner) return false;
    const k = w / e.w, h = e.h * k;
    const [ix, iy, iw, ih] = e.inner.map((q) => q * k);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, x, y, w, h);
    ctx.fillStyle = '#16161f'; ctx.fillRect(x + ix, y + iy, iw, ih);       // vaciar el relleno dibujado
    ctx.fillStyle = col; ctx.fillRect(x + ix, y + iy, iw * clamp(v, 0, 1), ih);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x + ix, y + iy, iw * clamp(v, 0, 1), Math.max(1, ih * 0.22));
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(10, Math.round(ih * 0.62))}px Segoe UI`; ctx.textAlign = 'center';
    ctx.fillText(label, x + ix + iw / 2, y + iy + ih * 0.78);
    ctx.textAlign = 'left';
    return true;
  }

  drawItemSlots(inv, H) {
    const ctx = this.ctx, S = this.S, sp = S.sprites;
    const shown = inv.slice(-12);
    const sz = 44, gap = 4, cols = 6, rows = Math.ceil(shown.length / cols);
    const x0 = 12, y0 = H - 16 - rows * (sz + gap) - 16;
    ctx.fillStyle = 'rgba(10,12,20,0.6)'; this.round(x0, y0 - 4, cols * (sz + gap) + 8, rows * (sz + gap) + 24, 8); ctx.fill();
    ctx.fillStyle = '#8a93b4'; ctx.font = '11px Segoe UI'; ctx.fillText(`ÍTEMS (${inv.length})`, x0 + 6, y0 + 10);
    ctx.imageSmoothingEnabled = false;
    shown.forEach((id, i) => {
      const it = S.items[id] || {};
      const sx = x0 + 4 + (i % cols) * (sz + gap), sy = y0 + 16 + Math.floor(i / cols) * (sz + gap);
      const slot = sp.ui[SLOT_FOR[it.rarity] || 'slot'];
      if (slot) ctx.drawImage(slot, sx, sy, sz, sz);
      else { ctx.strokeStyle = RARITY[it.rarity] || '#fff'; ctx.lineWidth = 2; ctx.strokeRect(sx + 2, sy + 2, sz - 4, sz - 4); }
      const icon = it.icon && sp.items[it.icon];
      if (icon) ctx.drawImage(icon, sx + 7, sy + 7, sz - 14, sz - 14);
      else { ctx.fillStyle = RARITY[it.rarity] || '#fff'; ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('✦', sx + sz / 2, sy + sz / 2 + 6); ctx.textAlign = 'left'; }
      ctx.fillStyle = RARITY[it.rarity] || '#fff'; ctx.fillRect(sx + 6, sy + sz - 5, sz - 12, 2);
    });
  }

  // Aviso del último ítem recogido: icono + nombre + efecto (3,5 s).
  drawPickupCard(W) {
    const g = this.S.got;
    if (!g) return;
    const t = (performance.now() - g.t) / 1000;
    if (t > 3.5) { this.S.got = null; return; }
    const it = this.S.items[g.id];
    if (!it) return;
    const ctx = this.ctx;
    const a = t < 0.2 ? t / 0.2 : t > 3 ? (3.5 - t) / 0.5 : 1;
    const col = RARITY[it.rarity] || '#fff';
    ctx.globalAlpha = a;
    ctx.font = 'bold 15px Segoe UI';
    const w = Math.max(300, Math.min(560, ctx.measureText(it.desc).width + 110));
    const x = W / 2 - w / 2, y = 60 + (1 - a) * -10;
    ctx.fillStyle = 'rgba(10,12,20,0.88)'; this.round(x, y, w, 64, 10); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    const slot = this.S.sprites.ui[SLOT_FOR[it.rarity] || 'slot'];
    ctx.imageSmoothingEnabled = false;
    if (slot) ctx.drawImage(slot, x + 8, y + 6, 52, 52);
    const icon = it.icon && this.S.sprites.items[it.icon];
    if (icon) ctx.drawImage(icon, x + 15, y + 13, 38, 38);
    ctx.textAlign = 'left';
    ctx.fillStyle = col; ctx.font = 'bold 15px Segoe UI'; ctx.fillText(it.name, x + 70, y + 26);
    ctx.fillStyle = '#e6e9f5'; ctx.font = '13px Segoe UI'; ctx.fillText(it.desc, x + 70, y + 46);
    ctx.globalAlpha = 1;
  }

  // Auras sutiles de los ítems equipados (color de cada ítem con aura) + destello al recoger.
  drawAuras(p, x, y, pr) {
    const ctx = this.ctx;
    const au = p.au || [];
    au.forEach((col, i) => {
      for (let j = 0; j < 3; j++) {
        const a = this.time * (1.4 + i * 0.3) + j * (TAU / 3) + i;
        const px = x + Math.cos(a) * (pr + 10), py = y - pr * 0.2 + Math.sin(a) * (pr * 0.55) - ((this.time * 30 + j * 13) % 26);
        ctx.globalAlpha = 0.45;
        this.circle(px, py, 2.2, col);
      }
    });
    if (au.length) {
      ctx.globalAlpha = 0.12 + 0.05 * Math.sin(this.time * 3);
      ctx.fillStyle = au[au.length - 1];
      ctx.beginPath(); ctx.ellipse(x, y + pr * 0.85, pr + 10, 7, 0, 0, TAU); ctx.fill();
    }
    if (p.pk) {
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.time * 14);
      ctx.strokeStyle = p.pk; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x, y - pr * 0.3, pr + 16, pr + 24, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Estrellitas de aturdimiento girando.
  stars(x, y, col) {
    const ctx = this.ctx;
    ctx.fillStyle = col; ctx.font = 'bold 14px Segoe UI'; ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      const a = this.time * 5 + i * (TAU / 3);
      ctx.fillText('★', x + Math.cos(a) * 16, y + Math.sin(a) * 5);
    }
  }

  // ───────── Utilidades ─────────
  circle(x, y, r, col) { const ctx = this.ctx; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  bar(x, y, w, h, v, col) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(v, 0, 1), h);
  }
  round(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
}
